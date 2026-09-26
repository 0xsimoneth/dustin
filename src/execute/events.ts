import type { ClosePlan, PlannedTransaction } from "../plan/model.js";
import type { CloseStatus } from "./report.js";

/**
 * Progress events of a close. `round` is 0 for the plan the run started with and n for the n-th
 * re-plan; `attempt` counts the envelopes of one planned transaction (a rebuild adds one).
 */
export type CloseEvent =
  | { type: "plan"; plan: ClosePlan; round?: number }
  | { type: "drift"; action: "abort" | "replan"; previousPlanHash: string; planHash: string }
  | { type: "preflight"; index: number; ok: boolean; detail: string }
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
