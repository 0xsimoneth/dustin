import type { ErrorStage } from "../errors/dustin-error.js";
import type { ClosePlan, CloseStep, PlannedTransaction } from "../plan/model.js";
import type { LedgerReader } from "../reader/ledger-reader.js";
import { hashHex } from "../sponsor/fee-bump.js";
import type { Signer } from "../sponsor/signer.js";
import type { FeeSponsor } from "../sponsor/sponsor.js";
import { buildInnerTransaction } from "../tx/build-inner.js";
import { explainCodes, rejectionAction } from "./classify.js";
import type { CloseEvent } from "./events.js";
import type { StopReason, SubmittedTransaction } from "./report.js";
import type { ResultCodes } from "./result-codes.js";
import {
  lookupTransaction,
  outcomeFromRecord,
  submitAndConfirm,
  type SubmitOutcome,
  type Submitter,
} from "./submit.js";

export interface AttemptSettings {
  /** Seconds of validity of each inner transaction. */
  timeoutSeconds: number;
  pollIntervalMs: number;
  graceSeconds: number;
  /** First pause after a 429, doubled each time. */
  backoffMs: number;
  /** Envelopes per planned transaction, the first included. */
  maxAttempts: number;
  /** Posts of one envelope after a 429. */
  maxRateLimitRetries: number;
  /** How long to wait, beyond a time bound and the grace, for a ledger that closed after it. */
  ledgerWaitSeconds: number;
  /** Local clock in milliseconds; it only measures how long waits last. */
  now: () => number;
  sleep: (ms: number) => Promise<void>;
}

export interface AttemptContext {
  /** The plan the transaction belongs to, and its round (0 for the plan the run started with). */
  plan: ClosePlan;
  round: number;
  reader: LedgerReader;
  submitter: Submitter;
  accountSigner: Signer;
  sponsor: FeeSponsor;
  /** The sponsor's cap on the bid per operation. */
  maxBaseFeeStroops: number;
  explorerBaseUrl: string;
  settings: AttemptSettings;
  /** Adds an envelope to the report and publishes the report. */
  record(entry: SubmittedTransaction): void;
  /** Publishes the report after an entry changed. */
  changed(): void;
  emit(event: CloseEvent): void;
  /** Tells the run which stage it is in, for the report of an interrupted run. */
  enter(stage: ErrorStage): void;
}

export type TransactionOutcome =
  | { kind: "applied"; entry: SubmittedTransaction; resultXdr: string }
  | { kind: "failed"; entry: SubmittedTransaction; codes: ResultCodes }
  | { kind: "stopped"; stop: StopReason }
  /**
   * The account's sequence number moved on while an earlier envelope of this transaction was
   * never seen on the ledger: the rest must be planned again from the ledger, never sent again at
   * a new sequence number (review finding 1; ADR-0006 `TX_BAD_SEQ`: "else replan").
   */
  | { kind: "replan"; entry: SubmittedTransaction; codes: ResultCodes; reason: string };

const short = (hash: string) => `${hash.slice(0, 8)}...`;

export function recordOutcome(entry: SubmittedTransaction, outcome: SubmitOutcome): void {
  entry.result = outcome.kind;
  switch (outcome.kind) {
    case "applied":
      entry.ledger = outcome.ledger;
      entry.feeChargedStroops = outcome.feeChargedStroops;
      delete entry.explanation;
      return;
    case "failed":
      entry.resultCodes = outcome.codes;
      entry.ledger = outcome.ledger ?? null;
      entry.feeChargedStroops = outcome.feeChargedStroops ?? null;
      entry.explanation = explainCodes(outcome.codes, outcome.status);
      return;
    case "rejected":
      entry.resultCodes = outcome.codes;
      entry.explanation = explainCodes(outcome.codes, outcome.status);
      return;
    case "unknown":
      entry.explanation = outcome.mayStillApply
        ? "Not found by hash, and no ledger has closed past its time bound yet, so it may still apply."
        : "Not found by hash after its time bound passed, so it can never apply.";
  }
}

/**
 * Submits one planned transaction until it is on the ledger, fails there, or cannot go on
 * (E2-S3; architecture sections 4.6, 4.7 and 7; docs/adr/ADR-0006-error-taxonomy.md):
 *
 * - a 504, 5xx or lost connection is looked up by hash until the envelope's time bound has passed
 *   and a ledger closed after it (`submitAndConfirm`); found means confirmed, with no second POST;
 * - an envelope that can never apply any more (not found after that, or refused with
 *   `tx_too_late`) is rebuilt for the same sequence number with fresh time bounds; after an
 *   expiry the bid is raised too. Nothing is rebuilt while the old envelope can still apply, so
 *   Dustin never relies on the 10x replace-by-fee rule
 *   (https://developers.stellar.org/docs/build/guides/transactions/fee-bump-transactions#replace-by-fee);
 * - `tx_insufficient_fee` is rebuilt with the bid doubled, up to the cap and within the budget;
 *   an envelope refused for its fee was never queued, and any envelopes for one sequence number
 *   can apply at most once between them;
 * - `tx_bad_seq` first looks the earlier envelopes of this transaction up by hash (one may have
 *   applied after all), then re-reads the account's sequence number and rebuilds once; a second
 *   `tx_bad_seq` stops;
 * - a 429 posts the same envelope again after an exponential pause, a bounded number of times;
 * - anything else refused stops, with the codes and what they mean.
 */
export async function submitPlannedTransaction(
  ctx: AttemptContext,
  tx: PlannedTransaction,
  steps: CloseStep[],
): Promise<TransactionOutcome> {
  const { plan, settings } = ctx;
  const stop = (
    code: StopReason["code"],
    verdict: StopReason["verdict"],
    detail: string,
    extra: Partial<StopReason> = {},
  ): TransactionOutcome => ({
    kind: "stopped",
    stop: { code, stage: "submit", verdict, detail, round: ctx.round, txIndex: tx.index, ...extra },
  });
  const label = `Transaction ${tx.index + 1} (${tx.phase})`;

  ctx.enter("build");
  const account = await ctx.reader.account(plan.account);
  if (!account) {
    return stop(
      "ACCOUNT_MISSING",
      "stop",
      `The account ${plan.account} no longer exists, so ${label.toLowerCase()} was not built.`,
    );
  }
  let sequence = account.sequence;
  let bid = plan.fees.baseFeeStroops;
  let badSeq = 0;
  let rebuiltBecause: string | undefined;
  const envelopes: SubmittedTransaction[] = [];

  // The highest bid the cap and the budget allow for this transaction's next sequence number.
  const ceiling = () =>
    Math.min(
      ctx.maxBaseFeeStroops,
      Math.floor(
        ctx.sponsor.headroomStroops(plan.account, (BigInt(sequence) + 1n).toString()) /
          (tx.opCount + 1),
      ),
    );

  for (let attempt = 1; ; attempt++) {
    if (attempt > settings.maxAttempts) {
      return stop(
        "RETRY_LIMIT",
        "replan",
        `${label} was built ${settings.maxAttempts} times without landing (last: ${rebuiltBecause ?? "unknown"}). Run the close again later; it continues from the ledger.`,
      );
    }
    if (ceiling() < bid) {
      return stop(
        "FEE_LIMIT",
        "replan",
        `${label} needs a bid of ${bid} stroops per operation, but the close budget allows at most ${ceiling()} for it; nothing more was signed. Raise the budget or wait for network fees to fall, then run the close again.`,
      );
    }
    ctx.enter("build");
    ctx.emit({
      type: "tx:building",
      index: tx.index,
      phase: tx.phase,
      opCount: tx.opCount,
      attempt,
      round: ctx.round,
    });
    const ledger = await ctx.reader.latestLedger();
    // Time bounds from Horizon's clock, not the local one (edge case T-07).
    const maxTime = Math.floor(Date.parse(ledger.closed_at) / 1000) + settings.timeoutSeconds;
    const inner = buildInnerTransaction({
      account: plan.account,
      sequence,
      operations: steps.map((s) => s.operation),
      networkPassphrase: plan.network.passphrase,
      maxTime,
      memo: plan.memo,
    });
    await ctx.accountSigner.sign(inner);
    ctx.enter("sponsor");
    const bump = await ctx.sponsor.wrap(inner, bid);
    const hash = hashHex(bump);
    const entry: SubmittedTransaction = {
      index: tx.index,
      phase: tx.phase,
      stepIds: tx.stepIds,
      attempts: 0,
      attempt,
      round: ctx.round,
      sequence: inner.sequence,
      baseFeeStroops: Number(bump.fee) / (inner.operations.length + 1),
      maxTime,
      ...(rebuiltBecause ? { rebuiltBecause } : {}),
      hash,
      innerHash: hashHex(inner),
      result: "pending",
      ledger: null,
      feeChargedStroops: null,
      feeAccount: bump.feeSource,
      innerEnvelopeXdr: inner.toXDR(),
      feeBumpEnvelopeXdr: bump.toXDR(),
      explorerUrl: `${ctx.explorerBaseUrl}/tx/${hash}`,
    };
    envelopes.push(entry);
    ctx.record(entry);
    ctx.emit({
      type: "tx:submitted",
      index: tx.index,
      hash,
      explorerUrl: entry.explorerUrl,
      attempt,
      round: ctx.round,
    });

    ctx.enter("submit");
    const outcome = await postWithBackoff(ctx, entry, maxTime);
    recordOutcome(entry, outcome);
    // An applied transaction is published by the orchestrator once it has recorded the steps
    // (and the merge), so no observer ever sees it half recorded (review finding 3).
    if (outcome.kind === "applied") return { kind: "applied", entry, resultXdr: outcome.resultXdr };
    ctx.changed();
    ctx.emit({
      type: "tx:failed",
      index: tx.index,
      hash,
      result: outcome.kind,
      detail: entry.explanation ?? "",
    });
    if (outcome.kind === "failed") return { kind: "failed", entry, codes: outcome.codes };

    if (outcome.kind === "unknown") {
      // Review finding 7: the stop names the envelope and its time bound, so a caller can wait for
      // a ledger past it before running again; until then a new envelope for the same sequence
      // number could only replace it with a tenfold bid (canonical decision 7).
      const wait = `Run the close again only after a ledger has closed after ${new Date(maxTime * 1000).toISOString()} (its time bound, ${maxTime}): until then it may still apply, and a new envelope for the same sequence number could only replace it with a tenfold bid, which Dustin never relies on. The run then continues from the ledger.`;
      if (outcome.lookupError) {
        // A lookup that failed proves nothing: the envelope may have applied (review finding 1).
        return stop(
          "OUTCOME_UNKNOWN",
          "replan",
          `${label} (${hash}) could not be looked up by hash (${outcome.lookupError}), so whether it applied is not known; nothing was rebuilt. ${wait}`,
          { hash, maxTime },
        );
      }
      if (outcome.mayStillApply) {
        return stop(
          "OUTCOME_UNKNOWN",
          "replan",
          `${label} (${hash}) was not found, and no ledger has closed past its time bound yet; nothing was rebuilt. ${wait}`,
          { hash, maxTime },
        );
      }
      rebuiltBecause = `envelope ${short(hash)} was not found after its time bound passed, so it can never apply`;
      const raised = Math.min(bid * 2, ceiling());
      if (raised > bid) bid = raised;
      continue;
    }

    const rejection = rejectionAction(outcome);
    switch (rejection.action) {
      case "backoff":
        return stop(
          "RETRY_LIMIT",
          "replan",
          `Horizon kept answering HTTP 429 for ${label.toLowerCase()} (${settings.maxRateLimitRetries + 1} posts); nothing was accepted. Run the close again later.`,
          { hash },
        );
      case "rebuild":
        rebuiltBecause = `envelope ${short(hash)} was refused with tx_too_late`;
        continue;
      case "raise-fee": {
        const raised = Math.min(bid * 2, ceiling());
        if (raised <= bid) {
          const limit =
            bid >= ctx.maxBaseFeeStroops
              ? `the cap of ${ctx.maxBaseFeeStroops} stroops per operation`
              : "the close budget";
          return stop(
            "FEE_LIMIT",
            "replan",
            `The network wants more than ${bid} stroops per operation for ${label.toLowerCase()} and ${limit} allows no more. Raise it or wait for network fees to fall, then run the close again.`,
            { hash, resultCodes: outcome.codes },
          );
        }
        rebuiltBecause = `envelope ${short(hash)} was refused with tx_insufficient_fee at ${bid} stroops per operation`;
        bid = raised;
        continue;
      }
      case "resequence": {
        // First, an earlier envelope of this transaction that was never seen on the ledger may be
        // what used the sequence number: look it up before anything else, the second time too
        // (edge case E1), so an applied envelope is never reported as a conflict.
        const unseen = envelopes.slice(0, -1).filter((e) => e.result === "unknown");
        const earlier = await findEarlier(ctx, unseen);
        if (earlier) return earlier;
        badSeq += 1;
        if (badSeq >= 2) {
          return stop(
            "SEQUENCE_CONFLICT",
            "replan",
            `${label} was refused with tx_bad_seq twice: another transaction is using the account's sequence numbers. Stop the other client and run the close again.`,
            { hash, resultCodes: outcome.codes },
          );
        }
        if (unseen.length > 0) {
          // Still not seen: the operations may have applied with it, so sending them again at the
          // account's new sequence number could apply them twice. Plan the rest from the ledger.
          return {
            kind: "replan",
            entry,
            codes: outcome.codes,
            reason: `${label} was refused with tx_bad_seq while an earlier envelope of it (${short(unseen.at(-1)!.hash)}) was never seen on the ledger, so the rest is planned again from the ledger instead of sending the same operations at a new sequence number.`,
          };
        }
        const fresh = await ctx.reader.account(plan.account);
        if (!fresh) {
          return stop("ACCOUNT_MISSING", "stop", `The account ${plan.account} no longer exists.`);
        }
        rebuiltBecause = `envelope ${short(hash)} was refused with tx_bad_seq; the account's sequence number is now ${fresh.sequence}`;
        // Every envelope signed for the old sequence number was refused (none is unseen), and
        // another transaction consumed it, so none can ever be charged: its bids leave the budget
        // before the rebuild at the new number (edge case E7).
        if (fresh.sequence !== sequence) {
          ctx.sponsor.release(plan.account, (BigInt(sequence) + 1n).toString());
        }
        sequence = fresh.sequence;
        continue;
      }
      case "source-missing": {
        // The closing account is gone: an earlier envelope of this transaction may have merged it
        // without the run seeing it (review finding 2). Nothing can be rebuilt for a missing account.
        const unseen = envelopes.slice(0, -1).filter((e) => e.result === "unknown");
        const earlier = await findEarlier(ctx, unseen);
        if (earlier) return earlier;
        return stop(
          "ACCOUNT_MISSING",
          "stop",
          `${label} was refused because the account ${plan.account} no longer exists (tx_no_source_account).`,
          { hash, resultCodes: outcome.codes },
        );
      }
      case "stop":
        return stop("TRANSACTION_REJECTED", "stop", `${label} was refused: ${rejection.reason}`, {
          hash,
          resultCodes: outcome.codes,
        });
    }
  }
}

/**
 * Looks up the earlier envelopes of a transaction that were never seen on the ledger (they ended
 * `unknown`; refused ones cannot have applied). One found on the ledger is the transaction's
 * outcome after all; null means none was found.
 */
async function findEarlier(
  ctx: AttemptContext,
  unseen: SubmittedTransaction[],
): Promise<TransactionOutcome | null> {
  for (const earlier of unseen) {
    const lookup = await lookupTransaction(ctx.submitter, earlier.hash);
    if (lookup.kind !== "found") continue;
    const found = outcomeFromRecord(earlier.hash, lookup.record);
    recordOutcome(earlier, found);
    if (found.kind === "applied") {
      return { kind: "applied", entry: earlier, resultXdr: found.resultXdr };
    }
    ctx.changed();
    if (found.kind === "failed") return { kind: "failed", entry: earlier, codes: found.codes };
  }
  return null;
}

/**
 * Posts the envelope and learns its fate; after a 429 (Horizon's rate limiter,
 * https://developers.stellar.org/docs/data/apis/horizon/api-reference/structure/rate-limiting)
 * posts the same envelope again after `backoffMs`, doubled each time, at most
 * `maxRateLimitRetries` more times.
 */
async function postWithBackoff(
  ctx: AttemptContext,
  entry: SubmittedTransaction,
  maxTime: number,
): Promise<SubmitOutcome> {
  const { settings } = ctx;
  for (let retry = 0; ; retry++) {
    entry.attempts += 1;
    const outcome = await submitAndConfirm(
      ctx.submitter,
      { xdr: entry.feeBumpEnvelopeXdr, hash: entry.hash, maxTime },
      {
        pollIntervalMs: settings.pollIntervalMs,
        graceSeconds: settings.graceSeconds,
        ledgerWaitSeconds: settings.ledgerWaitSeconds,
        now: () => settings.now() / 1000,
        sleep: settings.sleep,
        ledgerCloseTime: async () => Date.parse((await ctx.reader.latestLedger()).closed_at) / 1000,
      },
    );
    const limited = outcome.kind === "rejected" && outcome.status === 429;
    if (!limited || retry >= settings.maxRateLimitRetries) return outcome;
    // Published as it happens (AC-E2-S3-6): posted `attempts` times, still pending.
    ctx.changed();
    await settings.sleep(settings.backoffMs * 2 ** retry);
  }
}
