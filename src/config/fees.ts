/** Network minimum inclusion fee per operation, in stroops. */
export const MIN_BASE_FEE = 100;
/** Default cap on the bid per operation: 0.1 XLM (docs/architecture.md section 4.1). */
export const DEFAULT_MAX_BASE_FEE = 1_000_000;

export interface FeeStatsLike {
  last_ledger_base_fee: string;
  fee_charged: { p80: string };
}

/**
 * The per-operation bid: max(last ledger base fee, fee_charged p80), at least the network minimum
 * and at most the cap (docs/README.md canonical decision 7). Testnet has real surge pricing, so a
 * fixed 100-stroop bid is not enough; the fee actually charged is the ledger's clearing fee, not the
 * bid (observed on 2026-09-26: bid 82,746, charged 100 per operation).
 */
export function baseFeeFromFeeStats(
  stats: FeeStatsLike,
  maxBaseFee = DEFAULT_MAX_BASE_FEE,
): number {
  const parse = (value: string) => {
    const n = Number.parseInt(value, 10);
    return Number.isFinite(n) ? n : 0;
  };
  const bid = Math.max(
    MIN_BASE_FEE,
    parse(stats.last_ledger_base_fee),
    parse(stats.fee_charged.p80),
  );
  return Math.min(bid, Math.max(maxBaseFee, MIN_BASE_FEE));
}
