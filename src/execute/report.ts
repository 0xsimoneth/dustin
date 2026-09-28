import { xdr } from "@stellar/stellar-sdk";
import type { DustinErrorCode, ErrorStage, ErrorVerdict } from "../errors/dustin-error.js";
import type { Blocker, DisposalRung, TransactionPhase, UnclosableItem } from "../plan/model.js";
import type { ResultCodes, SubmitOutcome } from "./submit.js";

/**
 * How a close ended. A returned report, and the one a thrown DustinError carries, always has one
 * of the four final statuses. `running` appears only in the copies published through `onReport`
 * (and so in the CLI's `--report` file) while the run is in progress, so a copy left behind by a
 * run that was killed says it never finished instead of claiming an outcome (blind review BH1).
 *
 * - `closed`: a merge of this run applied, seen by hash or proven by the account being gone after
 *   this run posted a merge envelope that could have applied: one `pending` mid-POST, or one
 *   `unknown` that may still apply (`mayStillApply`), may have applied (`sequenceUsed`) or could
 *   not be looked up (`lookupError`). Not one refused or failed on the ledger (review round 3,
 *   R3-1), nor one the run itself found gone past its time bound with its sequence number unused
 *   ("it can never apply", no flag; closing review CX-1): with only such envelopes the account's
 *   removal is someone else's, and the run keeps its stop (`failed`, CLI exit 5). The price: a
 *   merge that applied while a lagging account read showed its number unused, and whose record
 *   Horizon never returns, is reported `failed`, not `closed`; running the close again then finds
 *   the account gone (ACCOUNT_MISSING, nothing submitted). It does not by itself say the account
 *   was verified gone:
 *   a verified close is `closed` with `verification.accountExists === false` and no `stop`.
 *   `closed` with `verification.accountExists === true` means Horizon still returned the account
 *   at the final check (`stop.code` ACCOUNT_STILL_EXISTS, and the message says so), and `closed`
 *   with `verification` null means the run was interrupted after the merge and before the final
 *   check (edge case E10). A merge found applied only after a stop (a lookup that settled) makes
 *   the run `closed` too. The CLI exits 0 only for a verified close (review round 3, R3-10).
 * - `partial`: everything that could run ran; the account still exists because of the unclosable
 *   items and blockers.
 * - `aborted`: the run stopped before submitting anything.
 * - `failed`: the run stopped part-way, after something was submitted, and no merge of this run
 *   applied; running the close again continues from the ledger.
 */
export type CloseStatus = "running" | "closed" | "partial" | "aborted" | "failed";

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
  /**
   * Set only while `result` is `unknown` (blind review BH3): true when no ledger had closed past
   * the time bound, so the envelope may still apply; false when it cannot apply any more (not
   * found after its bound, its sequence number used, or its bound passed while lookups failed, in
   * which case it may have applied already; `explanation` says which).
   */
  mayStillApply?: boolean;
  /**
   * Set only while `result` is `unknown`: Horizon did not find the envelope by hash, but its
   * sequence number is known used, because the account showed it used (edge case E5) or a later
   * envelope for the same number was refused with `tx_bad_seq`. It may have applied where Horizon
   * has not caught up, or another transaction used the number; either way it cannot apply any more.
   */
  sequenceUsed?: true;
  /**
   * Set only while `result` is `unknown`: why its outcome could not be settled, because the last
   * lookups by hash failed (the HTTP status or the error) or a read the wait needed failed (the
   * latest ledger or the account, and why). Whether it applied is not known (review round 3,
   * R3-22; blind review BH-13).
   */
  lookupError?: string;
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
  /**
   * What the codes of the last failure mean; or, for a step that counts as applied without a
   * confirmation by hash (its envelope applied unseen before a verified close), why it counts.
   */
  explanation?: string;
}

/**
 * A blocker found while the run executed rather than in the plan: a step that failed on the
 * ledger twice (AC-E2-S3-4). It sits next to the plan's blockers in `CloseReport.blockers`, with
 * the step, its last result codes and a remedy.
 */
export interface RunBlocker {
  code: "STEP_FAILED_TWICE";
  reason: string;
  remedy: string;
  /** Fixing what makes the step fail, or allowing a partial close, unblocks it. */
  permanent: false;
  /** The step of the plan the run started with. */
  stepId: string;
  resultCodes: ResultCodes;
}

/** Machine-readable reasons a run stopped early or did not start. */
export type StopCode =
  | "PLAN_CHANGED"
  /**
   * The fresh plan made before signing recovers less XLM than the plan the caller approved, for
   * example because a sale's quote got worse while the confirmation waited; the plan hash leaves
   * quotes out, so it does not show this (review BH-7). What a plan recovers is the account's
   * balance plus the quoted sales: `recovery.xlmToDestination` when it merges, what the account
   * keeps when it does not (closing review CX-2).
   */
  | "XLM_TO_DESTINATION_FELL"
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
  /**
   * For a drift stop before anything was signed: the XLM the approved plan and the fresh plan
   * recover, when the fresh amount is lower (review BH-7): the account's balance plus the quoted
   * sales, which is the XLM the destination would receive when the plan merges and the XLM the
   * account would keep when it does not (closing review CX-2).
   */
  xlmToDestination?: { approved: string; fresh: string };
  /**
   * For OUTCOME_UNKNOWN: the upper time bound (Unix seconds) of the envelope `hash`, which may
   * still apply or may have applied. A re-run must wait until a ledger has closed after it: until
   * then a new envelope for the same sequence number could only replace it with a tenfold bid,
   * which Dustin never relies on (canonical decision 7).
   */
  maxTime?: number;
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
 * A reserve sponsor as Horizon showed it (story E3-S3). Removing a sponsored entry moves no XLM: it
 * lowers the sponsor's `num_sponsoring`, and with it the sponsor's minimum balance
 * (https://developers.stellar.org/docs/build/guides/transactions/sponsored-reserves#effect-on-minimum-balance).
 */
export interface SponsorState {
  /** Reserves the sponsor pays for other accounts' entries (Horizon `num_sponsoring`). */
  numSponsoring: number;
  /** Its XLM balance; a close should leave it unchanged, since the fee sponsor pays every fee. */
  balance: string;
  /** (2 + subentries + num_sponsoring - num_sponsored) x base reserve, from the same read. */
  minimumBalance: string;
  /** The latest ledger Horizon reported just before this read. */
  ledger: number;
}

/**
 * What Horizon showed for one reserve sponsor before the first submission and after the final
 * check, next to the reserves the plans attribute to it (`reservesReturnedToSponsors`).
 */
export interface SponsorObservation {
  sponsor: string;
  /**
   * Read before the first submission. Null when the read failed (a warning says so) or when only a
   * re-plan named the sponsor.
   */
  before: SponsorState | null;
  /** Read after the final check; null when the read failed (a warning says so) or never ran. */
  after: SponsorState | null;
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
  /** The plan's blockers, and any the run found (a step that failed twice). */
  blockers: Array<Blocker | RunBlocker>;
  warnings: string[];
  recovery: {
    /** The merged balance read from the merge result; null if no merge applied. */
    mergedXlm: string | null;
    reservesReturnedToSponsors: Array<{ sponsor: string; xlm: string; entries: string[] }>;
    feesPaidByAccount: "0";
    /** Fees charged to the sponsor by every included transaction, failed ones too. */
    feesPaidBySponsorStroops: number;
    /**
     * The reserve sponsors the plans name, as Horizon showed them before the first submission and
     * after the final check (story E3-S3): the observed side of `reservesReturnedToSponsors`.
     * Empty when no entry of the account is sponsored; absent in reports written before E3-S3.
     */
    sponsorsObserved?: SponsorObservation[];
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
