import { DEFAULT_MAX_BASE_FEE, MIN_BASE_FEE, baseFeeFromFeeStats } from "../config/fees.js";
import type { FeeSummary, PlanOptions } from "./model.js";

/** Default per-close sponsor budget: 5 XLM (docs/README.md canonical decision 7). */
export const DEFAULT_BUDGET_STROOPS = 50_000_000;

/**
 * The sponsor's bid for each fee-bumped transaction is base x (operations + 1), because the fee
 * bump itself counts as one operation (CAP-15). The inner fee is 0. The ledger charges its clearing
 * fee, usually far below the bid (day-1 experiment 1).
 */
export function feeSummary(
  opCounts: number[],
  feeStats: { lastLedgerBaseFee: number; feeChargedP80: number },
  options: PlanOptions,
  payer: string,
): FeeSummary {
  const maxBaseFeeStroops = options.maxBaseFeeStroops ?? DEFAULT_MAX_BASE_FEE;
  const override = options.baseFeeStroops;
  const baseFeeStroops =
    override !== undefined
      ? Math.max(MIN_BASE_FEE, Math.floor(override))
      : baseFeeFromFeeStats(
          {
            last_ledger_base_fee: String(feeStats.lastLedgerBaseFee),
            fee_charged: { p80: String(feeStats.feeChargedP80) },
          },
          maxBaseFeeStroops,
        );
  const perTransactionStroops = opCounts.map((ops) => baseFeeStroops * (ops + 1));
  const totalStroops = perTransactionStroops.reduce((sum, fee) => sum + fee, 0);
  const budgetStroops = options.budgetStroops ?? DEFAULT_BUDGET_STROOPS;
  return {
    baseFeeStroops,
    basis: override !== undefined ? "override" : "fee_stats",
    maxBaseFeeStroops,
    perTransactionStroops,
    totalStroops,
    budgetStroops,
    withinBudget: totalStroops <= budgetStroops,
    payer,
  };
}
