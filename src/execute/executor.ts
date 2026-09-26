import { formatStroops, toStroops } from "../amounts.js";
import { assertTestnetPassphrase, resolveConfig, type DustinConfig } from "../config/network.js";
import { DustinError } from "../errors/dustin-error.js";
import { destinationBaseAccount } from "../inspect/address.js";
import type { HorizonAccount } from "../inspect/horizon-types.js";
import { reserveFromHorizon } from "../inspect/reserve.js";
import { sequenceGuard } from "../plan/guard.js";
import type { ClosePlan, CloseStep, PlannedTransaction } from "../plan/model.js";
import { planClose } from "../plan/plan-close.js";
import { horizonJson } from "../reader/horizon-json.js";
import { horizonReader, type LedgerReader } from "../reader/ledger-reader.js";
import { hashHex } from "../sponsor/fee-bump.js";
import type { Signer } from "../sponsor/signer.js";
import { FeeSponsor } from "../sponsor/sponsor.js";
import { buildInnerTransaction } from "../tx/build-inner.js";
import {
  mergeAmountFromResultXdr,
  type CloseReport,
  type CloseStatus,
  type SubmittedTransaction,
} from "./report.js";
import { horizonSubmitter, submitAndConfirm, type Submitter } from "./submit.js";

export type { CloseReport, CloseStatus } from "./report.js";

export interface Signers {
  /** Signs the inner transactions: the closing account's key, a wallet or a device. */
  account: Signer;
  /** Signs only the fee-bump envelopes and pays every fee. */
  feeSponsor: Signer;
}

export type CloseEvent =
  | { type: "plan"; plan: ClosePlan }
  | { type: "drift"; action: "abort" | "replan"; previousPlanHash: string; planHash: string }
  | { type: "preflight"; index: number; ok: boolean; detail: string }
  | { type: "tx:building"; index: number; phase: PlannedTransaction["phase"]; opCount: number }
  | { type: "tx:submitted"; index: number; hash: string; explorerUrl: string }
  | { type: "tx:confirmed"; index: number; hash: string; ledger: number; feeChargedStroops: number }
  | { type: "tx:failed"; index: number; hash: string; result: string; detail: string }
  | { type: "verified"; accountExists: boolean }
  | { type: "done"; status: CloseStatus };

export interface ExecuteOptions {
  /** The literal `true`: executing is irreversible, so the caller must say so. */
  confirm: true;
  /** Run the cleanup even when the plan cannot end in a merge; default false. */
  allowPartial?: boolean;
  /** When the account changed since the plan: stop (default) or continue with the fresh plan. */
  onDrift?: "abort" | "replan";
  onEvent?: (event: CloseEvent) => void;
  config?: DustinConfig;
  reader?: LedgerReader;
  submitter?: Submitter;
  /** Per-close sponsor budget in stroops; default from the plan (5 XLM). */
  budgetStroops?: number;
  maxBaseFeeStroops?: number;
  /** Seconds of validity for each inner transaction; default 120. */
  timeoutSeconds?: number;
  pollIntervalMs?: number;
}

/**
 * Executes a close plan (SOW Deliverable 2). Every transaction is an inner transaction signed by
 * the account and wrapped in a fee bump signed by the sponsor (ADR-0003). Before anything is signed
 * the account is re-inspected and re-planned; a changed plan aborts unless `onDrift: "replan"`.
 * A merge in its own transaction runs only after a fresh preflight. The ledger is the source of
 * truth: running again after any stop continues from wherever the account is.
 */
export async function executeClose(
  plan: ClosePlan,
  signers: Signers,
  options: ExecuteOptions,
): Promise<CloseReport> {
  if (options.confirm !== true) {
    throw new DustinError(
      "CONFIRMATION_REQUIRED",
      "executeClose needs `confirm: true`; nothing was executed.",
      {
        stage: "config",
        remedy:
          "Show the plan to the account holder and pass confirm: true only after they approve it.",
      },
    );
  }
  assertTestnetPassphrase(plan.network.passphrase);
  const accountKey = signers.account.publicKey();
  const sponsorKey = signers.feeSponsor.publicKey();
  if (accountKey !== plan.account) {
    throw new DustinError(
      "WRONG_SIGNER",
      `The account signer is ${accountKey}, not the account ${plan.account}.`,
      {
        stage: "config",
        remedy: "Set DUSTIN_ACCOUNT_SECRET to the secret key of the account being closed.",
      },
    );
  }
  if (sponsorKey === plan.account) {
    throw new DustinError(
      "INVALID_ADDRESS",
      "The fee sponsor must be a different account from the one being closed.",
      {
        stage: "config",
      },
    );
  }
  if (plan.feeSponsor && plan.feeSponsor !== sponsorKey) {
    throw new DustinError(
      "WRONG_SIGNER",
      `The sponsor signer is ${sponsorKey}, but the plan names ${plan.feeSponsor}.`,
      {
        stage: "config",
        remedy:
          "Set DUSTIN_SPONSOR_SECRET to the sponsor's secret key, or plan again with --sponsor.",
      },
    );
  }

  const config = resolveConfig(options.config);
  const reader = options.reader ?? horizonReader(horizonJson(config.horizonUrl));
  const submitter = options.submitter ?? horizonSubmitter(config.horizonUrl);
  const emit = (event: CloseEvent) => options.onEvent?.(event);

  const fresh = await planClose(
    {
      account: plan.account,
      destination: plan.destination,
      feeSponsor: sponsorKey,
      ...(plan.memo ? { memo: plan.memo } : {}),
      ...(plan.ladderOrder === "prefer-destination" ? { preferDestination: true } : {}),
      ...(options.maxBaseFeeStroops !== undefined
        ? { maxBaseFeeStroops: options.maxBaseFeeStroops }
        : {}),
      ...(options.budgetStroops !== undefined ? { budgetStroops: options.budgetStroops } : {}),
    },
    { reader },
  );
  emit({ type: "plan", plan: fresh });

  const report: CloseReport = {
    schemaVersion: 1,
    kind: "dustin-close-report",
    network: { passphrase: fresh.network.passphrase, horizon: fresh.network.horizon },
    account: plan.account,
    destination: plan.destination,
    feeSponsor: sponsorKey,
    planHash: fresh.planHash,
    status: "aborted",
    message: null,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    transactions: [],
    steps: fresh.steps.map((s) => ({ stepId: s.id, status: "not_run", txIndex: s.txIndex })),
    unclosable: fresh.unclosable,
    blockers: fresh.blockers,
    warnings: [...fresh.warnings],
    recovery: {
      mergedXlm: null,
      reservesReturnedToSponsors: [],
      feesPaidByAccount: "0",
      feesPaidBySponsorStroops: 0,
    },
    verification: null,
  };
  const finish = (status: CloseStatus, message: string | null) => {
    report.status = status;
    report.message = message;
    report.finishedAt = new Date().toISOString();
    emit({ type: "done", status });
    return report;
  };

  if (fresh.planHash !== plan.planHash) {
    const action = options.onDrift ?? "abort";
    emit({ type: "drift", action, previousPlanHash: plan.planHash, planHash: fresh.planHash });
    if (action === "abort") {
      return finish(
        "aborted",
        `The account changed since the plan was made (plan hash ${plan.planHash} is now ${fresh.planHash}); nothing was submitted. Review the new plan and run again.`,
      );
    }
  }
  if (fresh.status !== "closable" && !options.allowPartial) {
    return finish(
      "aborted",
      `The plan cannot end in a merge (status ${fresh.status}); nothing was submitted. Allow a partial close (--partial) to run everything else.`,
    );
  }
  if (fresh.transactions.length === 0) return finish("aborted", "The plan has nothing to execute.");
  if (plan.destination === sponsorKey) {
    report.warnings.push(
      "The destination is also the fee sponsor: it pays the fees and receives the merged XLM.",
    );
  }

  // Canonical decision 7: refuse to start when the sponsor cannot cover the close budget.
  const ledgerNow = await reader.latestLedger();
  const budget = options.budgetStroops ?? fresh.fees.budgetStroops;
  const sponsorAccount = await reader.account(sponsorKey);
  const sponsorSpendable = sponsorAccount
    ? reserveFromHorizon(sponsorAccount, BigInt(ledgerNow.base_reserve_in_stroops)).spendable
    : -1n;
  if (sponsorSpendable < BigInt(budget)) {
    throw new DustinError(
      "SPONSOR_UNDERFUNDED",
      sponsorAccount
        ? `The fee sponsor ${sponsorKey} can spend ${formatStroops(sponsorSpendable)} XLM, less than the close budget of ${formatStroops(BigInt(budget))} XLM.`
        : `The fee sponsor ${sponsorKey} does not exist.`,
      {
        stage: "sponsor",
        remedy: "Fund the fee sponsor (on testnet, from Friendbot) and run the close again.",
      },
    );
  }
  const sponsor = new FeeSponsor(signers.feeSponsor, {
    networkPassphrase: fresh.network.passphrase,
    budgetStroops: budget,
    maxBaseFeeStroops: options.maxBaseFeeStroops ?? fresh.fees.maxBaseFeeStroops,
  });

  const byId = new Map(fresh.steps.map((s) => [s.id, s]));
  const stepStatus = (ids: string[], status: "applied" | "failed", hash: string) => {
    for (const outcome of report.steps) {
      if (ids.includes(outcome.stepId)) Object.assign(outcome, { status, txHash: hash });
    }
  };
  let mergeApplied = false;

  for (const tx of fresh.transactions) {
    const steps = tx.stepIds.map((id) => byId.get(id)!);
    if (tx.index > 0 && steps.some((s) => s.kind === "merge")) {
      const preflight = await mergePreflight(reader, fresh);
      emit({ type: "preflight", index: tx.index, ...preflight });
      if (!preflight.ok)
        return verifyAndFinish(
          "failed",
          `Merge preflight failed: ${preflight.detail}. The merge was not submitted.`,
        );
    }
    emit({ type: "tx:building", index: tx.index, phase: tx.phase, opCount: tx.opCount });
    const entry = await submitOne(tx, steps);
    if (entry.result !== "applied") {
      const codes = entry.resultCodes
        ? [
            entry.resultCodes.transaction,
            entry.resultCodes.innerTransaction,
            ...(entry.resultCodes.operations ?? []),
          ]
            .filter(Boolean)
            .join(", ")
        : "no result codes";
      return verifyAndFinish(
        "failed",
        `Transaction ${tx.index + 1} (${tx.phase}) ended ${entry.result}: ${codes}. Run the close again to continue from the current state.`,
      );
    }
  }
  return verifyAndFinish(mergeApplied ? "closed" : "partial", null);

  async function submitOne(
    tx: PlannedTransaction,
    steps: CloseStep[],
  ): Promise<SubmittedTransaction> {
    const account = await reader.account(plan.account);
    if (!account)
      throw new DustinError("ACCOUNT_NOT_FOUND", `The account ${plan.account} no longer exists.`, {
        stage: "build",
      });
    const ledger = await reader.latestLedger();
    // Time bounds from Horizon's clock, not the local one (edge case T-07).
    const maxTime =
      Math.floor(Date.parse(ledger.closed_at) / 1000) + (options.timeoutSeconds ?? 120);
    const inner = buildInnerTransaction({
      account: plan.account,
      sequence: account.sequence,
      operations: steps.map((s) => s.operation),
      networkPassphrase: fresh.network.passphrase,
      maxTime,
      memo: fresh.memo,
    });
    await signers.account.sign(inner);
    const bump = await sponsor.wrap(inner, fresh.fees.baseFeeStroops);
    const hash = hashHex(bump);
    const entry: SubmittedTransaction = {
      index: tx.index,
      phase: tx.phase,
      stepIds: tx.stepIds,
      attempts: 1,
      hash,
      innerHash: hashHex(inner),
      result: "pending",
      ledger: null,
      feeChargedStroops: null,
      feeAccount: sponsorKey,
      innerEnvelopeXdr: inner.toXDR(),
      feeBumpEnvelopeXdr: bump.toXDR(),
      explorerUrl: `${config.explorerBaseUrl}/tx/${hash}`,
    };
    report.transactions.push(entry);
    emit({ type: "tx:submitted", index: tx.index, hash, explorerUrl: entry.explorerUrl });
    const outcome = await submitAndConfirm(
      submitter,
      { xdr: entry.feeBumpEnvelopeXdr, hash, maxTime },
      options.pollIntervalMs !== undefined ? { pollIntervalMs: options.pollIntervalMs } : {},
    );
    entry.result = outcome.kind;
    if (outcome.kind === "applied") {
      entry.ledger = outcome.ledger;
      entry.feeChargedStroops = outcome.feeChargedStroops;
      report.recovery.feesPaidBySponsorStroops += outcome.feeChargedStroops;
      stepStatus(tx.stepIds, "applied", hash);
      if (steps.some((s) => s.kind === "merge")) {
        mergeApplied = true;
        const merged = mergeAmountFromResultXdr(outcome.resultXdr);
        report.recovery.mergedXlm = merged === null ? null : formatStroops(merged);
      }
      emit({
        type: "tx:confirmed",
        index: tx.index,
        hash,
        ledger: outcome.ledger,
        feeChargedStroops: outcome.feeChargedStroops,
      });
    } else {
      if (outcome.kind === "failed" || outcome.kind === "rejected")
        entry.resultCodes = outcome.codes;
      if (outcome.kind === "failed") stepStatus(tx.stepIds, "failed", hash);
      emit({
        type: "tx:failed",
        index: tx.index,
        hash,
        result: outcome.kind,
        detail: JSON.stringify(entry.resultCodes ?? {}),
      });
    }
    return entry;
  }

  async function verifyAndFinish(
    status: CloseStatus,
    message: string | null,
  ): Promise<CloseReport> {
    const account = await reader.account(plan.account);
    report.verification = {
      accountExists: account !== null,
      horizonStatus: account === null ? 404 : 200,
      checkedAt: new Date().toISOString(),
      accountUrl: `${config.explorerBaseUrl}/account/${plan.account}`,
    };
    emit({ type: "verified", accountExists: account !== null });
    const applied = new Set(
      report.steps.filter((s) => s.status === "applied").map((s) => s.stepId),
    );
    report.recovery.reservesReturnedToSponsors = fresh.recovery.reservesReturnedToSponsors.filter(
      () => status === "closed",
    );
    if (status !== "closed") {
      // Only sponsored trustlines actually removed so far returned their reserve.
      const removed = fresh.steps.filter(
        (s) =>
          applied.has(s.id) &&
          s.kind === "remove_trustline" &&
          s.reserveReleasedTo?.to === "sponsor",
      );
      const bySponsor = new Map<string, { units: bigint; entries: string[] }>();
      for (const s of removed) {
        if (s.reserveReleasedTo?.to !== "sponsor") continue;
        // A pool-share trustline holds two base reserves, any other trustline one.
        const [units, entry] =
          s.subject.type === "pool_share"
            ? [2n, `pool share ${s.subject.poolId}`]
            : s.subject.type === "trustline"
              ? [1n, `trustline ${s.subject.asset.code}:${s.subject.asset.issuer}`]
              : [0n, ""];
        if (units === 0n) continue;
        const current = bySponsor.get(s.reserveReleasedTo.sponsor) ?? { units: 0n, entries: [] };
        bySponsor.set(s.reserveReleasedTo.sponsor, {
          units: current.units + units,
          entries: [...current.entries, entry],
        });
      }
      report.recovery.reservesReturnedToSponsors = [...bySponsor.entries()].map(
        ([sponsor, { units, entries }]) => ({
          sponsor,
          xlm: formatStroops(units * toStroops(fresh.reserve.baseReserve)),
          entries,
        }),
      );
    }
    if (status === "closed" && account !== null) {
      return finish(
        "failed",
        "The merge was reported applied but the account still exists; check it on the explorer.",
      );
    }
    return finish(status, message);
  }
}

/** Fresh facts before a merge that runs in its own transaction (architecture rule R7). */
async function mergePreflight(
  reader: LedgerReader,
  plan: ClosePlan,
): Promise<{ ok: boolean; detail: string }> {
  const [account, destination, ledger] = await Promise.all([
    reader.account(plan.account),
    reader.account(destinationBaseAccount(plan.destination)),
    reader.latestLedger(),
  ]);
  if (!account) return { ok: false, detail: "the account no longer exists" };
  const left = leftovers(account);
  if (left.length > 0) return { ok: false, detail: `the account still holds ${left.join(", ")}` };
  if (account.num_sponsoring > 0)
    return { ok: false, detail: `the account sponsors ${account.num_sponsoring} reserve(s)` };
  if (!plan.destination.startsWith("M") && !destination)
    return { ok: false, detail: "the destination no longer exists" };
  const guard = sequenceGuard({
    sequence: account.sequence,
    observedLedger: ledger.sequence,
    mergeTxIndex: 0,
  });
  if (!guard.ok) {
    return {
      ok: false,
      detail: `the sequence guard blocks the merge until ledger ${guard.unblocksAtLedger}`,
    };
  }
  return {
    ok: true,
    detail: "no subentries left, nothing sponsored, destination exists, sequence guard ok",
  };
}

function leftovers(account: HorizonAccount): string[] {
  const lines = account.balances.filter((b) => b.asset_type !== "native");
  const trustlines = lines.length;
  // A pool-share trustline counts as two subentries.
  const trustlineSubentries = lines.reduce(
    (n, b) => n + (b.asset_type === "liquidity_pool_shares" ? 2 : 1),
    0,
  );
  const data = Object.keys(account.data).length;
  const nonSignerSubentries =
    account.subentry_count - account.signers.filter((s) => s.key !== account.account_id).length;
  const offers = Math.max(0, nonSignerSubentries - trustlineSubentries - data);
  return [
    ...(trustlines ? [`${trustlines} trustline(s)`] : []),
    ...(offers ? [`${offers} offer(s)`] : []),
    ...(data ? [`${data} data entr${data === 1 ? "y" : "ies"}`] : []),
  ];
}
