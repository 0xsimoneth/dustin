import type { SequenceGuard } from "./model.js";

/** Seconds per ledger on testnet, observed on 2026-09-26 (32 ledgers in 160 s); for ETAs only. */
export const SECONDS_PER_LEDGER = 5;

/**
 * ACCOUNT_MERGE_SEQNUM_TOO_FAR guard (docs/README.md canonical decision 10). stellar-core's
 * MergeOpFrame fails when the account's sequence number at apply time is >= ledgerSeq << 32
 * (https://github.com/stellar/stellar-core/blob/master/src/transactions/MergeOpFrame.cpp); each
 * earlier inner transaction consumes one sequence number, and the merge can land at the earliest in
 * the ledger after the one observed. BumpSequence can only raise a sequence number, so waiting is
 * the only remedy (day-1 experiment 5).
 */
export function sequenceGuard(input: {
  sequence: string;
  observedLedger: number;
  mergeTxIndex: number;
}): SequenceGuard {
  const sequenceAtMerge = BigInt(input.sequence) + BigInt(input.mergeTxIndex) + 1n;
  const earliestLedger = input.observedLedger + 1;
  const ok = sequenceAtMerge < BigInt(earliestLedger) << 32n;
  const unblocksAtLedger = ok ? null : Number(sequenceAtMerge >> 32n) + 1;
  return {
    sequenceAtMerge: sequenceAtMerge.toString(),
    earliestLedger,
    ok,
    unblocksAtLedger,
    etaSeconds:
      unblocksAtLedger === null
        ? null
        : (unblocksAtLedger - input.observedLedger) * SECONDS_PER_LEDGER,
  };
}
