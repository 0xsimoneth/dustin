import { utf8ByteLength } from "../bytes.js";
import { canonicalJson, sha256Hex } from "../canonical-json.js";
import { MIN_BASE_FEE } from "../config/fees.js";
import { DustinError } from "../errors/dustin-error.js";
import { TESTNET_PASSPHRASE } from "../config/network.js";
import type { AccountSnapshot } from "../inspect/snapshot.js";
import { assetKey } from "../inspect/snapshot.js";
import { partialNow, workBeforeMerge } from "./blockers.js";
import { feeSummary } from "./fees.js";
import { MAX_OPERATIONS, groupUnits, type GroupedTransaction } from "./grouping.js";
import { sequenceGuard } from "./guard.js";
import type {
  Blocker,
  ClosePlan,
  CloseStep,
  OperationDescriptor,
  PlanOptions,
  PlanStatus,
  PlannedTransaction,
  SequenceGuard,
  StepSubject,
} from "./model.js";
import { orderClose, type PlanUnit } from "./order.js";
import { recoverySummary } from "./recovery.js";

/** Default longest sequence-guard wait the executor absorbs: 120 ledgers, about 10 minutes. */
export const DEFAULT_MAX_WAIT_LEDGERS = 120;

/** Default path-payment slippage: 100 bps (1%), the value the ladder applies when none is given. */
export const DEFAULT_SLIPPAGE_BPS = 100;

/**
 * The planner: a pure function of the snapshot and the options. No I/O, no clock, no key; the
 * same inputs give the same plan and the same `planHash` (PRD FR-07, FR-10, NFR-05).
 */
export function planFromSnapshot(s: AccountSnapshot, options: PlanOptions): ClosePlan {
  validatePlanOptions(options);
  const feeSponsor = options.feeSponsor ?? null;
  const common = {
    schemaVersion: 1 as const,
    kind: "dustin-close-plan" as const,
    network: { passphrase: TESTNET_PASSPHRASE, horizon: s.observed.source },
    account: s.account,
    destination: s.destination?.account ?? options.destination,
    feeSponsor,
    memo: options.memo ?? null,
    options: {
      slippageBps: options.slippageBps ?? DEFAULT_SLIPPAGE_BPS,
      maxOpsPerTransaction: Math.min(
        options.maxOpsPerTransaction ?? MAX_OPERATIONS,
        MAX_OPERATIONS,
      ),
      maxWaitLedgers: options.maxWaitLedgers ?? DEFAULT_MAX_WAIT_LEDGERS,
    },
    observed: { ledger: s.observed.ledger, closedAt: s.observed.closedAt },
    reserve: s.exists
      ? { balance: s.native.balance, ...s.reserve }
      : {
          balance: "0.0000000",
          minimum: "0.0000000",
          spendable: "0.0000000",
          baseReserve: "0.0000000",
        },
    snapshotHash: s.snapshotHash,
    ladderOrder: options.preferDestination ? ("prefer-destination" as const) : ("sow" as const),
  };

  if (!s.exists) {
    const blockers: Blocker[] = [
      {
        code: "ACCOUNT_MISSING",
        reason:
          "The account does not exist on the testnet ledger (Horizon answered 404); it may already be closed.",
        remedy: "Check the address; if the account was merged, there is nothing left to close.",
        permanent: true,
      },
    ];
    const plan: Omit<ClosePlan, "planHash"> = {
      ...common,
      status: "blocked",
      steps: [],
      transactions: [],
      unclosable: [],
      blockers,
      warnings: [],
      recovery: {
        xlmToDestination: "0.0000000",
        nativeBalance: "0.0000000",
        quotedProceedsXlm: "0.0000000",
        reservesReturnedToSponsors: [],
        feesPaidByAccount: "0",
      },
      fees: feeSummary([], s.feeStats, options, feeSponsor ?? "fee_sponsor"),
      sequenceGuard: null,
    };
    return { ...plan, planHash: structuralHash(plan) };
  }

  const maxOps = Math.min(options.maxOpsPerTransaction ?? MAX_OPERATIONS, MAX_OPERATIONS);
  const ordered = orderClose(s, options);
  const blockers = [...ordered.blockers];
  const warnings = [...ordered.warnings];
  let status: PlanStatus = ordered.status;
  let units: PlanUnit[] = ordered.units;
  let grouped = groupUnits(units, { maxOps, separateMerge: false });
  // The grouping the plan hash sees: the one without a wait for the sequence guard. A near guard
  // puts the merge in a transaction of its own, and the merge joins the cleanup again once the
  // guard clears; that regrouping depends only on time, so it must not change the hash (review
  // finding CA-11, PRD decision D-10). A merge that is dropped for a far guard is dropped here too.
  let hashedGrouping = grouped;
  let guard: SequenceGuard | null = null;

  const mergeIndex = (txs: GroupedTransaction[]) =>
    txs.findIndex((t) => t.steps.some((st) => st.kind === "merge"));
  const guardFor = (txs: GroupedTransaction[]) =>
    sequenceGuard({
      sequence: s.sequence,
      observedLedger: s.observed.ledger,
      mergeTxIndex: mergeIndex(txs),
    });
  if (mergeIndex(grouped) >= 0) {
    guard = guardFor(grouped);
    if (!guard.ok && guard.unblocksAtLedger !== null) {
      const waitLedgers = guard.unblocksAtLedger - s.observed.ledger;
      if (waitLedgers <= (options.maxWaitLedgers ?? DEFAULT_MAX_WAIT_LEDGERS)) {
        // Run the cleanup and the sales now and let the merge wait on its own.
        grouped = groupUnits(units, { maxOps, separateMerge: true });
        guard = guardFor(grouped);
        // Named from the phases, so a sale is never called the cleanup (closing review CP-17).
        const work = workBeforeMerge(beforeMerge(grouped));
        const first = work
          ? `${capital(work.what)} ${work.plural ? "run" : "runs"} first`
          : "Nothing needs cleaning up first";
        warnings.push(
          `The account's sequence number is ahead of the ledger: the merge must wait until ledger ${guard.unblocksAtLedger} (about ${guard.etaSeconds} s). ${first}; the executor waits before submitting the merge.`,
        );
      } else {
        units = units.filter((u) => u.phase !== "merge");
        blockers.push({
          code: "SEQNUM_TOO_FAR",
          reason: `The account's sequence number is ahead of the ledger, so a merge is refused (ACCOUNT_MERGE_SEQNUM_TOO_FAR) until ledger ${guard.unblocksAtLedger}, about ${Math.ceil((guard.etaSeconds ?? 0) / 60)} minutes from now.`,
          // --partial only when something runs before the merge (closing review CP-2).
          remedy:
            "Wait until that ledger and run the plan again; a sequence number can only go up, so nothing else helps." +
            partialNow(units.map((u) => u.phase)),
          permanent: false,
        });
        grouped = groupUnits(units, { maxOps, separateMerge: false });
        hashedGrouping = grouped;
        status = "blocked";
      }
    }
  }

  const fees = feeSummary(
    grouped.map((t) => t.steps.length),
    s.feeStats,
    options,
    feeSponsor ?? "fee_sponsor",
  );
  const steps: CloseStep[] = grouped.flatMap((t, index) =>
    t.steps.map((step) => ({ ...step, txIndex: index, feeEstimateStroops: fees.baseFeeStroops })),
  );
  const transactions: PlannedTransaction[] = grouped.map((t, index) => ({
    index,
    phase: t.phase,
    stepIds: t.steps.map((step) => step.id),
    opCount: t.steps.length,
    innerFeeStroops: 0,
    feeBumpFeeStroops: fees.perTransactionStroops[index] ?? 0,
    reason: transactionReason(t, grouped, guard),
  }));

  const plan: Omit<ClosePlan, "planHash"> = {
    ...common,
    status,
    ladderOrder: ordered.ladderOrder,
    steps,
    transactions,
    unclosable: ordered.unclosable,
    blockers,
    warnings,
    recovery: recoverySummary(s, steps),
    fees,
    sequenceGuard: steps.some((step) => step.kind === "merge") ? guard : null,
  };
  return { ...plan, planHash: structuralHash(plan, hashedGrouping) };
}

/** The phases of the transactions that run before the merge. */
const beforeMerge = (txs: readonly GroupedTransaction[]) =>
  txs.filter((t) => t.phase !== "merge").map((t) => t.phase);

const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

function transactionReason(
  t: GroupedTransaction,
  all: GroupedTransaction[],
  guard: SequenceGuard | null,
): string {
  if (t.phase === "convert") {
    const sale = t.steps.find((step) => step.kind === "dispose_balance");
    const code = sale?.subject.type === "trustline" ? sale.subject.asset.code : "the asset";
    return `Market-dependent sale of ${code} isolated with its trustline removal, so a moved market cannot roll back the rest of the close.`;
  }
  if (t.phase === "merge") {
    if (guard && !guard.ok) {
      const work = workBeforeMerge(beforeMerge(all));
      return work === null
        ? `The merge must wait until ledger ${guard.unblocksAtLedger} for the sequence guard; the executor waits before submitting it.`
        : `The merge runs alone after ${work.what} because it must wait until ledger ${guard.unblocksAtLedger} for the sequence guard.`;
    }
    if (all.length === 1) return "Nothing to clean up: the merge is the only operation.";
    if (all.some((x) => x.phase === "convert")) {
      return "The merge runs alone after a fresh preflight, because the path payments before it depend on the market and could change the plan.";
    }
    return "The merge runs alone because the cleanup filled the 100-operation limit.";
  }
  const cleanups = all.filter((x) => x.phase === "cleanup");
  const part =
    cleanups.length > 1
      ? ` Part ${cleanups.indexOf(t) + 1} of ${cleanups.length}: the cleanup exceeds 100 operations.`
      : "";
  const merges = t.steps.some((step) => step.kind === "merge")
    ? " No step depends on the market, so the merge is the last operation and the account closes in this transaction."
    : "";
  return `Deterministic cleanup with no market dependency (offer cancellations, returns to issuers, transfers to the destination, removal of emptied trustlines and data entries), grouped into one fee-bumped transaction of at most 100 operations.${part}${merges}`;
}

function subjectKey(subject: StepSubject): string {
  switch (subject.type) {
    case "offer":
      return `offer:${subject.offerId}`;
    case "trustline":
      return `trustline:${assetKey(subject.asset)}:${subject.balance}`;
    case "data":
      return `data:${subject.name}`;
    case "pool_share":
      return `pool:${subject.poolId}`;
    case "account":
      return `account:${subject.destination}`;
  }
}

function structuralOperation(op: OperationDescriptor): unknown {
  if (op.type === "pathPaymentStrictSend") {
    // destMin and the path come from the market quote, not from the structure of the plan.
    const { destMin: _destMin, path: _path, ...rest } = op;
    return rest;
  }
  return op;
}

/**
 * sha256 of the plan's structure: steps, order, grouping, rungs and blockers; no fees, quotes or
 * prose. Of the recorded options only the slippage bound is hashed (review finding R12): it sets
 * every `destMin`, which is left out above because it moves with the market, so without it a
 * changed bound would pass silently. `maxOpsPerTransaction` and `maxWaitLedgers` need no entry:
 * they act only through the grouping and the blockers, which are hashed. The default slippage is
 * left out so that plans made before the options were recorded keep their hash.
 *
 * The grouping hashed is `grouping` when given: the plan's grouping without the wait for a near
 * sequence guard (review finding CA-11, PRD decision D-10). `unblocksAtLedger` and the wait
 * estimate were never hashed; with the regrouping left out too, a guard that clears while the
 * confirmation waits is not drift. A plan without a near guard hashes exactly as before.
 */
function structuralHash(
  plan: Omit<ClosePlan, "planHash">,
  grouping?: readonly GroupedTransaction[],
): string {
  const slippageBps = plan.options?.slippageBps ?? DEFAULT_SLIPPAGE_BPS;
  const txIndexOf = new Map<string, number>();
  grouping?.forEach((t, index) => t.steps.forEach((step) => txIndexOf.set(step.id, index)));
  const transactions = grouping
    ? grouping.map((t) => ({ phase: t.phase, stepIds: t.steps.map((step) => step.id) }))
    : plan.transactions.map((t) => ({ phase: t.phase, stepIds: t.stepIds }));
  return sha256Hex(
    canonicalJson({
      account: plan.account,
      destination: plan.destination,
      memo: plan.memo,
      ...(slippageBps !== DEFAULT_SLIPPAGE_BPS ? { slippageBps } : {}),
      status: plan.status,
      ladderOrder: plan.ladderOrder,
      steps: plan.steps.map((step) => ({
        id: step.id,
        kind: step.kind,
        txIndex: txIndexOf.get(step.id) ?? step.txIndex,
        dependsOn: step.dependsOn,
        subject: subjectKey(step.subject),
        rung: step.disposal?.rung ?? null,
        to: step.disposal?.to ?? null,
        operation: structuralOperation(step.operation),
      })),
      transactions,
      unclosable: plan.unclosable.map((u) => ({ code: u.code, subject: subjectKey(u.subject) })),
      blockers: plan.blockers.map((b) => b.code),
    }),
  );
}

/** Memo text is at most 28 bytes (https://developers.stellar.org/docs/learn/fundamentals/transactions/operations-and-transactions#memo). */
export const MAX_MEMO_BYTES = 28;

function invalid(detail: string): DustinError {
  return new DustinError("CONFIG_INVALID", `Invalid plan option: ${detail}.`, { stage: "plan" });
}

/** Rejects option values that would silently produce a wrong plan. */
export function validatePlanOptions(o: PlanOptions): void {
  const isInt = (n: number) => Number.isSafeInteger(n);
  if (
    o.slippageBps !== undefined &&
    (!isInt(o.slippageBps) || o.slippageBps < 0 || o.slippageBps > 10_000)
  ) {
    throw invalid("slippageBps must be a whole number of basis points from 0 to 10000");
  }
  if (
    o.baseFeeStroops !== undefined &&
    (!isInt(o.baseFeeStroops) || o.baseFeeStroops < MIN_BASE_FEE)
  ) {
    throw invalid(`baseFeeStroops must be a whole number of at least ${MIN_BASE_FEE}`);
  }
  if (
    o.maxBaseFeeStroops !== undefined &&
    (!isInt(o.maxBaseFeeStroops) || o.maxBaseFeeStroops < MIN_BASE_FEE)
  ) {
    throw invalid(`maxBaseFeeStroops must be a whole number of at least ${MIN_BASE_FEE}`);
  }
  if (o.budgetStroops !== undefined && (!isInt(o.budgetStroops) || o.budgetStroops <= 0)) {
    throw invalid("budgetStroops must be a positive whole number");
  }
  // A disposal and its trustline removal travel together, so a transaction needs room for two.
  if (
    o.maxOpsPerTransaction !== undefined &&
    (!isInt(o.maxOpsPerTransaction) || o.maxOpsPerTransaction < 2)
  ) {
    throw invalid("maxOpsPerTransaction must be a whole number of at least 2");
  }
  if (o.maxWaitLedgers !== undefined && (!isInt(o.maxWaitLedgers) || o.maxWaitLedgers < 0)) {
    throw invalid("maxWaitLedgers must be a whole number of at least 0");
  }
  if (o.memo !== undefined && utf8ByteLength(o.memo) > MAX_MEMO_BYTES) {
    throw invalid(`memo must be at most ${MAX_MEMO_BYTES} bytes`);
  }
}
