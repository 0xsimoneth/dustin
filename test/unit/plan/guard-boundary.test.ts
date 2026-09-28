import { describe, expect, it } from "vitest";
import { sequenceGuard } from "../../../src/plan/guard.js";

// Story E3-S4, AC-E3-S4-4. stellar-core refuses a merge with ACCOUNT_MERGE_SEQNUM_TOO_FAR when the
// account's sequence number at apply time is at or above getStartingSequenceNumber(header), that is
// ledgerSeq << 32, for the ledger the merge applies in (MergeOpFrame::isSeqnumTooFar,
// https://github.com/stellar/stellar-core/blob/master/src/transactions/MergeOpFrame.cpp; the docs:
// "It must be less than (ledgerSeq << 32)",
// https://developers.stellar.org/docs/learn/fundamentals/transactions/list-of-operations#account-merge).
// The transaction consumes its sequence number before the operation runs, so the number the check
// sees is the merge transaction's own: the "sequence at merge".

const shifted = (ledger: number) => BigInt(ledger) << 32n;
/** L: the ledger the merge applies in. */
const L = 4_913_400;

describe("AC-E3-S4-4: the sequence guard at the boundary", () => {
  it("AC-E3-S4-4: with L the ledger the merge applies in, a sequence at merge of (L << 32) - 1 passes and L << 32 is blocked", () => {
    // The earliest ledger a merge can land in is the one after the ledger observed.
    const passes = sequenceGuard({
      sequence: (shifted(L) - 2n).toString(),
      observedLedger: L - 1,
      mergeTxIndex: 0,
    });
    expect(passes).toMatchObject({
      sequenceAtMerge: (shifted(L) - 1n).toString(),
      earliestLedger: L,
      ok: true,
      unblocksAtLedger: null,
      etaSeconds: null,
    });

    const blocked = sequenceGuard({
      sequence: (shifted(L) - 1n).toString(),
      observedLedger: L - 1,
      mergeTxIndex: 0,
    });
    expect(blocked).toMatchObject({
      sequenceAtMerge: shifted(L).toString(),
      earliestLedger: L,
      ok: false,
      // The first ledger whose starting sequence number is above L << 32.
      unblocksAtLedger: L + 1,
      etaSeconds: 2 * 5,
    });
  });

  it("AC-E3-S4-4 as the story writes it: account sequence (L << 32) - 2 passes, (L << 32) - 1 is blocked", () => {
    const at = (sequence: bigint) =>
      sequenceGuard({ sequence: sequence.toString(), observedLedger: L - 1, mergeTxIndex: 0 }).ok;
    expect(at(shifted(L) - 2n)).toBe(true);
    expect(at(shifted(L) - 1n)).toBe(false);
    // A sequence number bumped to exactly L << 32 (BumpSequence to (L << 32)) is blocked in L too.
    expect(at(shifted(L))).toBe(false);
  });

  it("AC-E3-S4-4, the planner's form: earliestLedger = observed + 1, sequence at merge = sequence + index + 1", () => {
    // The merge is the third transaction (index 2): the cleanup and the sale each consume one
    // sequence number first.
    const observed = L - 1;
    const passes = sequenceGuard({
      sequence: (shifted(L) - 4n).toString(),
      observedLedger: observed,
      mergeTxIndex: 2,
    });
    expect(passes.earliestLedger).toBe(observed + 1);
    expect(passes.sequenceAtMerge).toBe((shifted(L) - 1n).toString());
    expect(passes.ok).toBe(true);

    const blocked = sequenceGuard({
      sequence: (shifted(L) - 3n).toString(),
      observedLedger: observed,
      mergeTxIndex: 2,
    });
    expect(blocked.sequenceAtMerge).toBe(shifted(L).toString());
    expect(blocked).toMatchObject({ ok: false, unblocksAtLedger: L + 1 });
  });

  it("names as unblocksAtLedger the first ledger in which the merge passes, for any sequence at merge", () => {
    for (const offset of [0n, 1n, 2n, 3n, (1n << 32n) - 2n, (1n << 32n) - 1n]) {
      const sequenceAtMerge = shifted(L + 20) + offset;
      const guard = sequenceGuard({
        sequence: (sequenceAtMerge - 1n).toString(),
        observedLedger: L,
        mergeTxIndex: 0,
      });
      const first = guard.unblocksAtLedger!;
      // Passes in `first`, fails in the ledger before it.
      expect(sequenceAtMerge < shifted(first)).toBe(true);
      expect(sequenceAtMerge < shifted(first - 1)).toBe(false);
      expect(guard.etaSeconds).toBe((first - L) * 5);
    }
  });

  it("stays ok once the ledger has passed, since ledgers only grow and the sequence at merge is fixed", () => {
    // Sequence at merge (L + 3) << 32: the merge can land from ledger L + 4, so the guard holds from
    // an observed ledger of L + 3 on.
    const sequence = (shifted(L + 3) - 1n).toString();
    const ok = (observed: number) =>
      sequenceGuard({ sequence, observedLedger: observed, mergeTxIndex: 0 }).ok;
    expect([L, L + 1, L + 2, L + 3, L + 4, L + 100].map(ok)).toEqual([
      false,
      false,
      false,
      true,
      true,
      true,
    ]);
  });
});
