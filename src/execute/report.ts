import { xdr } from "@stellar/stellar-sdk";
import type { Blocker, TransactionPhase, UnclosableItem } from "../plan/model.js";
import type { ResultCodes, SubmitOutcome } from "./submit.js";

export type CloseStatus = "closed" | "partial" | "aborted" | "failed";

export interface SubmittedTransaction {
  index: number;
  phase: TransactionPhase;
  stepIds: string[];
  attempts: number;
  /** Outer (fee-bump) hash: the one explorers show. */
  hash: string;
  innerHash: string;
  result: SubmitOutcome["kind"] | "pending";
  ledger: number | null;
  feeChargedStroops: number | null;
  feeAccount: string;
  innerEnvelopeXdr: string;
  feeBumpEnvelopeXdr: string;
  explorerUrl: string;
  resultCodes?: ResultCodes;
}

export interface StepOutcome {
  stepId: string;
  status: "applied" | "failed" | "not_run";
  txIndex: number;
  txHash?: string;
}

/**
 * The report of one close: safe to publish (public keys, hashes and envelopes only; envelopes
 * carry signatures, never secrets). Written as the run progresses, so a failed run still has every
 * hash (PRD FR-18, NFR-03).
 */
export interface CloseReport {
  schemaVersion: 1;
  kind: "dustin-close-report";
  network: { passphrase: string; horizon: string };
  account: string;
  destination: string;
  feeSponsor: string;
  planHash: string;
  status: CloseStatus;
  /** Why the run stopped or did not start, in one sentence. */
  message: string | null;
  startedAt: string;
  finishedAt: string | null;
  transactions: SubmittedTransaction[];
  steps: StepOutcome[];
  unclosable: UnclosableItem[];
  blockers: Blocker[];
  warnings: string[];
  recovery: {
    /** The merged balance read from the merge result; null if no merge applied. */
    mergedXlm: string | null;
    reservesReturnedToSponsors: Array<{ sponsor: string; xlm: string; entries: string[] }>;
    feesPaidByAccount: "0";
    feesPaidBySponsorStroops: number;
  };
  verification: {
    accountExists: boolean;
    horizonStatus: 200 | 404;
    checkedAt: string;
    accountUrl: string;
  } | null;
}

interface UnionLike {
  type: string;
  [key: string]: unknown;
}

/**
 * The merged amount from a transaction result: `accountMergeResult.sourceAccountBalance` of the
 * merge operation, inside the inner result of a fee bump. SDK 17.1.0 decodes XDR unions as objects
 * with a `type` field (`lib/esm/xdr/util.js`); the path was checked on a day-1 testnet merge.
 */
export function mergeAmountFromResultXdr(resultXdr: string): bigint | null {
  try {
    const decoded = xdr.TransactionResult.fromXDR(resultXdr, "base64") as unknown as {
      result: UnionLike;
    };
    let result = decoded.result;
    if (result.type === "txFeeBumpInnerSuccess") {
      const pair = result.innerResultPair as { result: { result: UnionLike } };
      result = pair.result.result;
    }
    if (result.type !== "txSuccess") return null;
    for (const op of result.results as Array<{ tr?: UnionLike }>) {
      const tr = op.tr;
      if (tr?.type === "accountMerge") {
        const merge = tr.accountMergeResult as {
          type: string;
          sourceAccountBalance: bigint | number | string;
        };
        if (merge.type === "accountMergeSuccess") return BigInt(merge.sourceAccountBalance);
      }
    }
    return null;
  } catch {
    return null;
  }
}
