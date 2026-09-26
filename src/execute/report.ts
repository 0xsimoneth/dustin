import { xdr } from "@stellar/stellar-sdk";
import type { DustinErrorCode, ErrorStage, ErrorVerdict } from "../errors/dustin-error.js";
import type { Blocker, DisposalRung, TransactionPhase, UnclosableItem } from "../plan/model.js";
import type { ResultCodes, SubmitOutcome } from "./submit.js";

export type CloseStatus = "closed" | "partial" | "aborted" | "failed";

/**
 * One submitted envelope. A planned transaction can have several: a rebuild after an expiry, a
 * refused bid or a sequence clash creates a new envelope with a new hash, and every hash ever
 * submitted is kept (PRD NFR-03).
 */
export interface SubmittedTransaction {
  /** Index of the planned transaction within its plan (see `round`). */
  index: number;
  phase: TransactionPhase;
  stepIds: string[];
  /** Times this envelope was posted; after a 429 the same envelope is posted again. */
  attempts: number;
  /** 1-based: which envelope of this planned transaction this is; a rebuild adds one. */
  attempt: number;
  /** The plan the transaction belongs to: 0 is the plan the run started with, n the n-th re-plan. */
  round: number;
  /** The inner transaction's sequence number. A rebuild after an expiry or a refused bid keeps it. */
  sequence: string;
  /** The sponsor's bid per operation for this envelope, in stroops. */
  baseFeeStroops: number;
  /** The inner transaction's upper time bound, in Unix seconds. */
  maxTime: number;
  /** Why this envelope replaced the previous one of the same planned transaction. */
  rebuiltBecause?: string;
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
  /** What the result codes mean, when the envelope did not apply. */
  explanation?: string;
}

/** A step of the plan the run started with, and what became of it. */
export interface StepOutcome {
  stepId: string;
  status: "applied" | "failed" | "not_run";
  txIndex: number;
  txHash?: string;
  /** The disposal rung the step applied with; after a fallback it differs from the plan (FR-12). */
  rung?: DisposalRung;
  /** The plan round that applied the step, when it was not the first. */
  round?: number;
  /** Times the step failed on the ledger, with the last codes and what they mean (AC-E2-S3-4). */
  failures?: number;
  resultCodes?: ResultCodes;
  explanation?: string;
}

/** Machine-readable reasons a run stopped early or did not start. */
export type StopCode =
  | "PLAN_CHANGED"
  | "PLAN_NOT_CLOSABLE"
  | "NOTHING_TO_EXECUTE"
  | "ACCOUNT_MISSING"
  | "OVER_BUDGET"
  | "OPERATION_FAILED"
  | "STEP_FAILED_TWICE"
  | "REPLAN_LIMIT"
  | "TRANSACTION_REJECTED"
  | "SEQUENCE_CONFLICT"
  | "FEE_LIMIT"
  | "RETRY_LIMIT"
  | "OUTCOME_UNKNOWN"
  | "MERGE_PREFLIGHT_FAILED"
  | "SEQNUM_TOO_FAR"
  | "ACCOUNT_STILL_EXISTS";

export interface StopReason {
  /** A run outcome, or the code of the DustinError that interrupted the run. */
  code: StopCode | DustinErrorCode;
  stage: ErrorStage;
  /**
   * What may be done next (docs/adr/ADR-0006-error-taxonomy.md): `replan` means running the close
   * again, which plans the rest from the ledger; `stop` means something must change first.
   */
  verdict: ErrorVerdict;
  detail: string;
  round?: number;
  txIndex?: number;
  hash?: string;
  /** The step (of the plan the run started with) the stop concerns. */
  stepId?: string;
  resultCodes?: ResultCodes;
  /** For a sequence-number stop: the first ledger the merge can land in. */
  unblocksAtLedger?: number;
}

/** A re-plan made during the run (architecture section 7.2). */
export interface ReplanRecord {
  /** The plan round it starts: 1 for the first re-plan. */
  round: number;
  at: string;
  planHash: string;
  /** The transaction whose failure forced it. */
  trigger: {
    round: number;
    txIndex: number;
    hash: string;
    stepId: string | null;
    resultCodes: ResultCodes;
    explanation: string;
  };
  /** Assets whose strict-send sale failed, offered no path payment from then on ("CODE:ISSUER"). */
  demoted: string[];
  /** What differs from the approved plan beyond applied steps and moves down the ladder. */
  drift: string[];
  /** Transactions left in the new plan. */
  transactions: number;
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
  /** The same, machine-readable; null when the run did everything it could. */
  stop: StopReason | null;
  startedAt: string;
  finishedAt: string | null;
  transactions: SubmittedTransaction[];
  steps: StepOutcome[];
  replans: ReplanRecord[];
  unclosable: UnclosableItem[];
  blockers: Blocker[];
  warnings: string[];
  recovery: {
    /** The merged balance read from the merge result; null if no merge applied. */
    mergedXlm: string | null;
    reservesReturnedToSponsors: Array<{ sponsor: string; xlm: string; entries: string[] }>;
    feesPaidByAccount: "0";
    /** Fees charged to the sponsor by every included transaction, failed ones too. */
    feesPaidBySponsorStroops: number;
  };
  verification: {
    accountExists: boolean;
    horizonStatus: 200 | 404;
    checkedAt: string;
    accountUrl: string;
    /** Horizon had ingested at least this ledger when it answered. */
    ledger?: number;
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
