import type { ClosePlan, PlannedTransaction } from "../plan/model.js";
import type { CloseStatus } from "./report.js";

/**
 * Progress events of a close. `round` is 0 for the plan the run started with and n for the n-th
 * re-plan; `attempt` counts the envelopes of one planned transaction (a rebuild adds one).
 */
export type CloseEvent =
  | { type: "plan"; plan: ClosePlan; round?: number }
  | {
      type: "drift";
      action: "abort" | "replan";
      previousPlanHash: string;
      planHash: string;
      /**
       * Set when the fresh plan sends less XLM to the destination than the approved plan
       * (`recovery.xlmToDestination`), which the plan hash alone does not show (review BH-7).
       */
      xlmToDestination?: { approved: string; fresh: string };
    }
  | { type: "preflight"; index: number; ok: boolean; detail: string }
  /**
   * The executor waits before a merge for the sequence guard (story E3-S4): the merge fails with
   * ACCOUNT_MERGE_SEQNUM_TOO_FAR in any ledger before `untilLedger`, so it is submitted only once
   * Horizon reports the ledger before it closed. `state` is "start" when the wait begins and "end"
   * when it is over; `currentLedger` is the latest ledger Horizon reported at that moment and
   * `index` the merge's transaction in its plan. A wait that runs out ends the run with the stop
   * SEQNUM_TOO_FAR instead of an "end" event.
   */
  | {
      type: "wait";
      reason: "sequence";
      state: "start" | "end";
      index: number;
      untilLedger: number;
      currentLedger: number;
    }
  | {
      type: "tx:building";
      index: number;
      phase: PlannedTransaction["phase"];
      opCount: number;
      attempt?: number;
      round?: number;
    }
  | {
      type: "tx:submitted";
      index: number;
      hash: string;
      explorerUrl: string;
      attempt?: number;
      round?: number;
    }
  | { type: "tx:confirmed"; index: number; hash: string; ledger: number; feeChargedStroops: number }
  | { type: "tx:failed"; index: number; hash: string; result: string; detail: string }
  | { type: "verified"; accountExists: boolean }
  | { type: "done"; status: CloseStatus };
