import type { FetchLike } from "../reader/horizon-json.js";

export interface ResultCodes {
  transaction?: string;
  innerTransaction?: string;
  operations?: string[];
}

/**
 * - applied: included and successful;
 * - failed: included but failed (sequence number and fee consumed), e.g. tx_fee_bump_inner_failed;
 * - rejected: refused before inclusion (nothing consumed), e.g. tx_bad_seq, tx_insufficient_fee;
 * - unknown: not found by hash after its time bound passed, so it can never apply.
 */
export type SubmitOutcome =
  | { kind: "applied"; hash: string; ledger: number; feeChargedStroops: number; resultXdr: string }
  | { kind: "failed"; hash: string; status: number; codes: ResultCodes; ledger?: number }
  | { kind: "rejected"; hash: string; status: number; codes: ResultCodes }
  | { kind: "unknown"; hash: string };

interface TransactionRecord {
  hash: string;
  ledger: number;
  successful: boolean;
  fee_charged: string;
  result_xdr: string;
}

export interface Submitter {
  submit(
    envelopeXdr: string,
  ): Promise<{ status: number; body: unknown } | { networkError: unknown }>;
  transaction(hash: string): Promise<TransactionRecord | null>;
}

/** Horizon `POST /transactions` and `GET /transactions/{hash}`. The only write path in Dustin. */
export function horizonSubmitter(
  horizonUrl: string,
  options: { fetch?: FetchLike; timeoutMs?: number } = {},
): Submitter {
  const doFetch: FetchLike = options.fetch ?? ((url, init) => fetch(url, init));
  const timeoutMs = options.timeoutMs ?? 60_000;
  return {
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
      try {
        const response = await doFetch(`${horizonUrl}/transactions/${hash}`, {
          headers: { accept: "application/json" },
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (!response.ok) return null;
        return (await response.json()) as TransactionRecord;
      } catch {
        return null;
      }
    },
  };
}

/**
 * Included in the ledger but failed: sequence number and fee consumed. A fee bump reports
 * `tx_fee_bump_inner_failed` both for an inner transaction that failed on the ledger (inner code
 * `tx_failed`) and for one refused at validation (e.g. inner `tx_bad_auth_extra` or `tx_bad_seq`,
 * nothing consumed; day-1 experiment 3), so the inner code decides.
 */
function includedFailure(codes: { transaction?: string; inner_transaction?: string }): boolean {
  if (codes.transaction === "tx_failed") return true;
  return (
    codes.transaction === "tx_fee_bump_inner_failed" && codes.inner_transaction === "tx_failed"
  );
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Submits one envelope and learns its fate. A 504 or a lost connection is not a failure: the
 * transaction may still land, so the same envelope is looked up by hash until its upper time bound
 * (plus a grace of two ledgers) has passed; after that it can never apply, and only then may the
 * caller rebuild for the same sequence number (architecture 7.3; Horizon timeout guidance:
 * https://developers.stellar.org/docs/data/apis/horizon/api-reference/errors/http-status-codes/horizon-specific/timeout).
 */
export async function submitAndConfirm(
  submitter: Submitter,
  envelope: { xdr: string; hash: string; maxTime: number },
  options: { pollIntervalMs?: number; graceSeconds?: number; now?: () => number } = {},
): Promise<SubmitOutcome> {
  const now = options.now ?? (() => Date.now() / 1000);
  const response = await submitter.submit(envelope.xdr);
  if ("status" in response) {
    const body = response.body as
      | (TransactionRecord & {
          extras?: {
            result_codes?: {
              transaction?: string;
              inner_transaction?: string;
              operations?: string[];
            };
          };
        })
      | null;
    if (response.status === 200 && body?.successful) {
      return {
        kind: "applied",
        hash: envelope.hash,
        ledger: body.ledger,
        feeChargedStroops: Number.parseInt(body.fee_charged, 10) || 0,
        resultXdr: body.result_xdr,
      };
    }
    const raw = body?.extras?.result_codes;
    if (response.status === 400 && raw) {
      const codes: ResultCodes = {
        ...(raw.transaction ? { transaction: raw.transaction } : {}),
        ...(raw.inner_transaction ? { innerTransaction: raw.inner_transaction } : {}),
        ...(raw.operations ? { operations: raw.operations } : {}),
      };
      return includedFailure(raw)
        ? { kind: "failed", hash: envelope.hash, status: 400, codes }
        : { kind: "rejected", hash: envelope.hash, status: 400, codes };
    }
  }
  // 504, 5xx, 429 or a lost connection: poll by hash.
  const deadline = envelope.maxTime + (options.graceSeconds ?? 10);
  for (;;) {
    const record = await submitter.transaction(envelope.hash);
    if (record) {
      return record.successful
        ? {
            kind: "applied",
            hash: envelope.hash,
            ledger: record.ledger,
            feeChargedStroops: Number.parseInt(record.fee_charged, 10) || 0,
            resultXdr: record.result_xdr,
          }
        : { kind: "failed", hash: envelope.hash, status: 200, codes: {}, ledger: record.ledger };
    }
    if (now() > deadline) return { kind: "unknown", hash: envelope.hash };
    await sleep(options.pollIntervalMs ?? 2000);
  }
}
