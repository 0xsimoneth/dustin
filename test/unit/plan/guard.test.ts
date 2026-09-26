import { describe, expect, it } from "vitest";
import { sequenceGuard } from "../../../src/plan/guard.js";

const L = 4_874_459;
const shifted = (ledger: number) => BigInt(ledger) << 32n;

describe("sequenceGuard (stellar-core MergeOpFrame: seqNum >= ledgerSeq << 32 fails)", () => {
  it("passes a normal account", () => {
    const g = sequenceGuard({
      sequence: (shifted(L - 100) + 5n).toString(),
      observedLedger: L,
      mergeTxIndex: 2,
    });
    expect(g).toMatchObject({
      ok: true,
      unblocksAtLedger: null,
      etaSeconds: null,
      earliestLedger: L + 1,
    });
    expect(g.sequenceAtMerge).toBe((shifted(L - 100) + 8n).toString());
  });

  it("is exact at the boundary", () => {
    // sequenceAtMerge = sequence + mergeTxIndex + 1
    const justBelow = sequenceGuard({
      sequence: (shifted(L + 1) - 2n).toString(),
      observedLedger: L,
      mergeTxIndex: 0,
    });
    expect(justBelow.ok).toBe(true);
    const atLimit = sequenceGuard({
      sequence: (shifted(L + 1) - 1n).toString(),
      observedLedger: L,
      mergeTxIndex: 0,
    });
    expect(atLimit).toMatchObject({ ok: false, unblocksAtLedger: L + 2, etaSeconds: 10 });
  });

  it("reports the ledger and ETA after a far bump", () => {
    const g = sequenceGuard({
      sequence: shifted(L + 720).toString(),
      observedLedger: L,
      mergeTxIndex: 1,
    });
    expect(g).toMatchObject({ ok: false, unblocksAtLedger: L + 721, etaSeconds: 721 * 5 });
  });
});
