import { assertPause, timerSleep, type Sleep } from "../config/pauses.js";
import type { FetchLike } from "../reader/horizon-json.js";
import { feeChargedFromResultXdr, resultCodesFromXdr, type ResultCodes } from "./result-codes.js";

export type { ResultCodes } from "./result-codes.js";

/**
 * - applied: included and successful;
 * - failed: included but failed (sequence number and fee consumed), e.g. tx_fee_bump_inner_failed
 *   with inner tx_failed;
 * - rejected: refused before inclusion (nothing consumed), e.g. tx_bad_seq, tx_insufficient_fee,
 *   a 400 without result codes or a 429 (status tells which);
 * - unknown: not found by hash (Horizon answered 404) after its upper time bound passed, so it
 *   never applied and never can; only then may a replacement for the same sequence number be
 *   built. Three flags mark the exceptions, when the envelope must not be replaced:
 *   `mayStillApply` (no ledger has closed past the time bound yet), `lookupError` (the last
 *   lookups by hash failed, so whether it applied is not known; review finding 1) and
 *   `sequenceUsed` (the account shows its sequence number used, so the 404 came from a Horizon
 *   behind, or another transaction took the number; edge case E5).
 */
export type SubmitOutcome =
  | { kind: "applied"; hash: string; ledger: number; feeChargedStroops: number; resultXdr: string }
  | {
      kind: "failed";
      hash: string;
      status: number;
      codes: ResultCodes;
      ledger?: number;
      feeChargedStroops?: number;
      resultXdr?: string;
    }
  | { kind: "rejected"; hash: string; status: number; codes: ResultCodes }
  | {
      kind: "unknown";
      hash: string;
      mayStillApply?: boolean;
      lookupError?: string;
      /** Horizon answered 404, but the account shows the envelope's sequence number used. */
      sequenceUsed?: boolean;
    };

export interface TransactionRecord {
  hash: string;
  ledger: number;
  successful: boolean;
  fee_charged: string;
  result_xdr: string;
}

/**
 * What a lookup by hash proves: the transaction was included (`found`), Horizon does not know it
 * (`missing`, HTTP 404), or nothing at all (`error`: a 429, a 5xx, a timeout or an unreadable
 * body). Only `missing` counts as not found; an `error` never lets an envelope be replaced.
 */
export type TransactionLookup =
  | { kind: "found"; record: TransactionRecord }
  | { kind: "missing" }
  | { kind: "error"; detail: string };

export interface Submitter {
  submit(
    envelopeXdr: string,
  ): Promise<{ status: number; body: unknown } | { networkError: unknown }>;
  /** The transaction by hash, or null; a null cannot tell a 404 from a failed lookup. */
  transaction(hash: string): Promise<TransactionRecord | null>;
  /**
   * The three-state lookup. A submitter without it is read through `transaction`, whose null is
   * then taken as an error: safe, since the executor never rebuilds on an error.
   */
  lookup?(hash: string): Promise<TransactionLookup>;
}

/**
 * Looks a transaction up by hash with whatever the submitter offers (review finding 1). A lookup
 * that throws or rejects, the three-state one of an injected submitter included, is a failed
 * lookup: it proves nothing and never escapes as an exception (review round 3, R3-16).
 */
export async function lookupTransaction(
  submitter: Submitter,
  hash: string,
): Promise<TransactionLookup> {
  try {
    if (submitter.lookup) return await submitter.lookup(hash);
    const record = await submitter.transaction(hash);
    return record
      ? { kind: "found", record }
      : { kind: "error", detail: "the submitter cannot tell a missing transaction from an error" };
  } catch (error) {
    return { kind: "error", detail: error instanceof Error ? error.message : String(error) };
  }
}

/** Horizon `POST /transactions` and `GET /transactions/{hash}`. The only write path in Dustin. */
export function horizonSubmitter(
  horizonUrl: string,
  options: { fetch?: FetchLike; timeoutMs?: number } = {},
): Submitter {
  const doFetch: FetchLike = options.fetch ?? ((url, init) => fetch(url, init));
  const timeoutMs = options.timeoutMs ?? 60_000;
  const lookup = async (hash: string): Promise<TransactionLookup> => {
    let response: Response;
    try {
      response = await doFetch(`${horizonUrl}/transactions/${hash}`, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      return { kind: "error", detail: error instanceof Error ? error.message : String(error) };
    }
    if (response.status === 404) return { kind: "missing" };
    if (!response.ok) return { kind: "error", detail: `HTTP ${response.status}` };
    try {
      return { kind: "found", record: (await response.json()) as TransactionRecord };
    } catch {
      return { kind: "error", detail: "a response body that is not JSON" };
    }
  };
  return {
    lookup,
    async submit(envelopeXdr) {
      try {
        const response = await doFetch(`${horizonUrl}/transactions`, {
          method: "POST",
          headers: {
            "content-type": "application/x-www-form-urlencoded",
            accept: "application/json",
          },
          body: `tx=${encodeURIComponent(envelopeXdr)}`,
          signal: AbortSignal.timeout(timeoutMs),
        });
        let body: unknown = null;
        try {
          body = await response.json();
        } catch {
          body = null;
        }
        return { status: response.status, body };
      } catch (networkError) {
        return { networkError };
      }
    },
    async transaction(hash) {
      const found = await lookup(hash);
      return found.kind === "found" ? found.record : null;
    },
  };
}

/**
 * Included in the ledger but failed: sequence number and fee consumed. A fee bump reports
 * `tx_fee_bump_inner_failed` both for an inner transaction that failed on the ledger (inner code
 * `tx_failed`) and for one refused at validation (e.g. inner `tx_bad_auth_extra` or `tx_bad_seq`,
 * nothing consumed; day-1 experiment 3), so the inner code decides.
 */
function includedFailure(codes: ResultCodes): boolean {
  if (codes.transaction === "tx_failed") return true;
  return codes.transaction === "tx_fee_bump_inner_failed" && codes.innerTransaction === "tx_failed";
}

interface HorizonSubmitBody {
  successful?: boolean;
  ledger?: number;
  fee_charged?: string;
  result_xdr?: string;
  extras?: {
    result_xdr?: string;
    result_codes?: { transaction?: string; inner_transaction?: string; operations?: string[] };
  };
}

/** What a record found by `GET /transactions/{hash}` proves: it was included, applied or failed. */
export function outcomeFromRecord(hash: string, record: TransactionRecord): SubmitOutcome {
  if (record.successful) {
    return {
      kind: "applied",
      hash,
      ledger: record.ledger,
      feeChargedStroops: Number.parseInt(record.fee_charged, 10) || 0,
      resultXdr: record.result_xdr,
    };
  }
  // Only included transactions have a record, so this one consumed its sequence number and fee.
  // The record carries result_xdr but no result codes: rebuild them (review finding R11).
  return {
    kind: "failed",
    hash,
    status: 200,
    codes: resultCodesFromXdr(record.result_xdr) ?? {},
    ledger: record.ledger,
    feeChargedStroops: Number.parseInt(record.fee_charged, 10) || 0,
    resultXdr: record.result_xdr,
  };
}

/**
 * What Horizon's answer to the POST proves, or null when it proves nothing (a 5xx or a 504: the
 * envelope may have reached the network and may still be included).
 */
function fromResponse(hash: string, status: number, raw: unknown): SubmitOutcome | null {
  const body = raw as HorizonSubmitBody | null;
  if (status === 200 && body?.successful === true) {
    return {
      kind: "applied",
      hash,
      ledger: body.ledger ?? 0,
      feeChargedStroops: Number.parseInt(body.fee_charged ?? "0", 10) || 0,
      resultXdr: body.result_xdr ?? "",
    };
  }
  if (status === 200 && body?.successful === false) {
    return outcomeFromRecord(hash, {
      hash,
      ledger: body.ledger ?? 0,
      successful: false,
      fee_charged: body.fee_charged ?? "0",
      result_xdr: body.result_xdr ?? "",
    });
  }
  const raw400 = body?.extras?.result_codes;
  if (status === 400 && raw400) {
    const codes: ResultCodes = {
      ...(raw400.transaction ? { transaction: raw400.transaction } : {}),
      ...(raw400.inner_transaction ? { innerTransaction: raw400.inner_transaction } : {}),
      ...(raw400.operations ? { operations: raw400.operations } : {}),
    };
    if (!includedFailure(codes)) return { kind: "rejected", hash, status, codes };
    const resultXdr = body?.extras?.result_xdr;
    const fee = resultXdr ? feeChargedFromResultXdr(resultXdr) : null;
    return {
      kind: "failed",
      hash,
      status,
      codes,
      ...(fee !== null ? { feeChargedStroops: fee } : {}),
      ...(resultXdr ? { resultXdr } : {}),
    };
  }
  // Refused before it reached the network: a 400 without result codes (for example a malformed
  // envelope), a 429 from Horizon's per-IP rate limiter
  // (https://developers.stellar.org/docs/data/apis/horizon/api-reference/structure/rate-limiting)
  // or any other 4xx. Nothing was accepted, so there is nothing to wait for (review finding R11).
  if (status >= 400 && status < 500) return { kind: "rejected", hash, status, codes: {} };
  return null;
}

export interface ConfirmOptions {
  /** Pause between lookups by hash; default 2000 ms, at least 200 (src/config/pauses.ts). */
  pollIntervalMs?: number;
  /** How long to keep looking after the upper time bound; default 10 s. */
  graceSeconds?: number;
  /** Local clock in Unix seconds. With `ledgerCloseTime` it only measures how long the wait lasts. */
  now?: () => number;
  /** Default a timer; tests that must not wait pass one that returns at once. */
  sleep?: Sleep;
  /**
   * Close time (Unix seconds) of the latest ledger Horizon has ingested. When given, the deadline
   * comes from the ledger's clock: an envelope is reported gone only once a ledger closed after its
   * upper time bound, whatever the local clock says. Without it, the local clock decides.
   */
  ledgerCloseTime?: () => Promise<number>;
  /** How long to wait, beyond the time bound and the grace, for such a ledger; default 60 s. */
  ledgerWaitSeconds?: number;
  /**
   * Whether the envelope's sequence number has been used, read from the account. A 404 is trusted
   * only when it has not (edge case E5): Horizon instances behind one address may lag each other,
   * and a 404 carries no ledger to tell (testnet Horizon sent no Latest-Ledger header on
   * GET /transactions/{hash}, observed 2026-09-27). Horizon's own check covers only a read replica
   * behind its primary database, answering 503 stale history
   * (https://github.com/stellar/stellar-horizon/blob/main/internal/httpx/middleware.go,
   * ReplicaSyncCheckMiddleware, commit 5519313; installed by internal/httpx/router.go only with a
   * primary database, commit f043341). Whether the testnet address serves instances that lag each
   * other is not verified; the check costs one account read.
   */
  sequenceUsed?: () => Promise<boolean>;
}

/**
 * Submits one envelope and learns its fate. A 504, a 5xx or a lost connection is not a failure: the
 * transaction may still land, so the same envelope is looked up by hash until its upper time bound
 * has passed. Time bounds are checked against ledger close times
 * (https://developers.stellar.org/docs/learn/fundamentals/transactions/operations-and-transactions#time-bounds),
 * so with `ledgerCloseTime` the envelope is declared gone only after a ledger closed past its
 * `maxTime` and a last lookup still finds nothing; only then may the caller build a replacement for
 * the same sequence number (architecture 7.3; Horizon timeout guidance:
 * https://developers.stellar.org/docs/data/apis/horizon/api-reference/errors/http-status-codes/horizon-specific/timeout).
 */
export async function submitAndConfirm(
  submitter: Submitter,
  envelope: { xdr: string; hash: string; maxTime: number },
  options: ConfirmOptions = {},
): Promise<SubmitOutcome> {
  assertPause("pollIntervalMs", options.pollIntervalMs, "config");
  const response = await submitter.submit(envelope.xdr);
  if ("status" in response) {
    const known = fromResponse(envelope.hash, response.status, response.body);
    if (known && (known.kind === "failed" || known.kind === "rejected") && ambiguous(known)) {
      return settleInclusion(submitter, known, options.sequenceUsed);
    }
    if (known) return known;
  }
  return options.ledgerCloseTime
    ? confirmByLedgerClock(submitter, envelope, options, options.ledgerCloseTime)
    : confirmByLocalClock(submitter, envelope, options);
}

/**
 * A 400 answering `tx_failed`, or for a fee bump `tx_fee_bump_inner_failed` whatever the inner
 * code, does not say whether the transaction was included (edge case E6): stellar-core answers
 * txFAILED when an operation fails its checks at validation, before any inclusion
 * (https://github.com/stellar/stellar-core/blob/master/src/transactions/TransactionFrame.cpp,
 * commit bb32c8a: `op->checkValid` failing, or operation signatures failing, set txFAILED), and a
 * fee bump included in a ledger can still fail its inner transaction with another code (a
 * `tx_too_late` at apply time, with its sequence number used and the fee charged).
 */
function ambiguous(outcome: { status: number; codes: ResultCodes }): boolean {
  return (
    outcome.status === 400 &&
    (outcome.codes.transaction === "tx_failed" ||
      outcome.codes.transaction === "tx_fee_bump_inner_failed")
  );
}

/**
 * The ledger decides (edge case E6): a record by hash means included (sequence number used, fee
 * charged); a 404 means refused at validation, nothing used. A lookup that fails leaves the
 * reading of the codes (included when the inner code is `tx_failed`).
 *
 * A 404 can come from a Horizon behind the one that answered the POST, so, as in the wait for an
 * unconfirmed envelope (edge case E5), the account's sequence number is the witness (review round
 * 3, R3-8): an answer that reads as an included failure (inner `tx_failed`, or an inner
 * `tx_too_late` at apply time) stays included while the account shows the envelope's number used,
 * or cannot be read. Only then would a refusal let the caller rebuild at a number that is used,
 * or give back a bid that was charged. An answer with no included reading (`tx_bad_seq`, for which
 * a used number is the refusal itself) keeps its reading.
 */
async function settleInclusion(
  submitter: Submitter,
  answered: Extract<SubmitOutcome, { kind: "failed" | "rejected" }>,
  sequenceUsed?: () => Promise<boolean>,
): Promise<SubmitOutcome> {
  const lookup = await lookupTransaction(submitter, answered.hash);
  if (lookup.kind === "found") {
    const recorded = outcomeFromRecord(answered.hash, lookup.record);
    if (recorded.kind !== "failed") return recorded;
    // A record whose result cannot be decoded still means included; the answer's codes describe it.
    return {
      ...recorded,
      status: answered.status,
      codes: Object.keys(recorded.codes).length > 0 ? recorded.codes : answered.codes,
    };
  }
  const reading = includedReading(answered);
  if (reading && sequenceUsed) {
    let used: boolean | null;
    try {
      used = await sequenceUsed();
    } catch {
      used = null;
    }
    if (used !== false) return reading;
  }
  if (lookup.kind === "error") return answered;
  return {
    kind: "rejected",
    hash: answered.hash,
    status: answered.status,
    codes: answered.codes,
  };
}

/**
 * The answer read as a failure included in a ledger, when it can be one: inner `tx_failed`
 * (an operation failed), or inner `tx_too_late` (the ledger that included the fee bump closed after
 * the inner time bound). The fee is not known without the record.
 */
function includedReading(
  answered: Extract<SubmitOutcome, { kind: "failed" | "rejected" }>,
): Extract<SubmitOutcome, { kind: "failed" }> | null {
  if (answered.kind === "failed") return answered;
  if (answered.codes.innerTransaction !== "tx_too_late") return null;
  return { kind: "failed", hash: answered.hash, status: answered.status, codes: answered.codes };
}

/** Without a ledger clock: look the envelope up until the local clock passes its bound. */
async function confirmByLocalClock(
  submitter: Submitter,
  envelope: { hash: string; maxTime: number },
  options: ConfirmOptions,
): Promise<SubmitOutcome> {
  const now = options.now ?? (() => Date.now() / 1000);
  const deadline = envelope.maxTime + (options.graceSeconds ?? 10);
  for (;;) {
    const found = await lookupTransaction(submitter, envelope.hash);
    if (found.kind === "found") return outcomeFromRecord(envelope.hash, found.record);
    if (now() > deadline) {
      return found.kind === "error"
        ? { kind: "unknown", hash: envelope.hash, lookupError: found.detail }
        : { kind: "unknown", hash: envelope.hash };
    }
    await (options.sleep ?? timerSleep)(options.pollIntervalMs ?? 2000);
  }
}

/**
 * With a ledger clock: the time bound is judged by ledger close times, and the local clock only
 * measures how long the wait has lasted, so a skewed local clock can neither end the wait early
 * nor make it endless. Horizon is asked for the latest close time once at the start, and again
 * only when that reading plus the time waited says the bound has probably passed.
 */
async function confirmByLedgerClock(
  submitter: Submitter,
  envelope: { hash: string; maxTime: number },
  options: ConfirmOptions,
  ledgerCloseTime: () => Promise<number>,
): Promise<SubmitOutcome> {
  const now = options.now ?? (() => Date.now() / 1000);
  const started = now();
  let firstClose: number | null = null;
  // Set once a ledger closed after maxTime: no later ledger can include the envelope (close times
  // only grow), and every earlier ledger is already ingested, so a 404 from then on is conclusive.
  let pastBound = false;
  for (;;) {
    const found = await lookupTransaction(submitter, envelope.hash);
    if (found.kind === "found") return outcomeFromRecord(envelope.hash, found.record);
    if (pastBound && found.kind === "missing") {
      // A 404 the account contradicts comes from a Horizon behind the one that read the account.
      if (options.sequenceUsed && (await options.sequenceUsed())) {
        return { kind: "unknown", hash: envelope.hash, sequenceUsed: true };
      }
      return { kind: "unknown", hash: envelope.hash };
    }
    firstClose ??= await ledgerCloseTime();
    const waited = now() - started;
    if (
      !pastBound &&
      firstClose + waited > envelope.maxTime &&
      (await ledgerCloseTime()) > envelope.maxTime
    ) {
      pastBound = true;
      continue;
    }
    // A failed lookup proves nothing, so it is only tried again, within the same bound.
    const limit =
      envelope.maxTime -
      firstClose +
      (options.graceSeconds ?? 10) +
      (options.ledgerWaitSeconds ?? 60);
    if (waited > limit) {
      return {
        kind: "unknown",
        hash: envelope.hash,
        ...(pastBound ? {} : { mayStillApply: true }),
        ...(found.kind === "error" ? { lookupError: found.detail } : {}),
      };
    }
    await (options.sleep ?? timerSleep)(options.pollIntervalMs ?? 2000);
  }
}
