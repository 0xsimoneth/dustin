import { beforeAll, describe, expect, it } from "vitest";
import type { ExistingAccountSnapshot } from "../../../src/inspect/snapshot.js";
import { planFromSnapshot } from "../../../src/plan/plan.js";
import { copy, messy, messySnapshot } from "../../helpers/snapshots.js";

// Story E3-S4: how the planner wires the sequence guard into the plan (src/plan/plan.ts): within
// `maxWaitLedgers` the merge runs alone and the executor waits for it; beyond, the merge is left
// out behind a SEQNUM_TOO_FAR blocker.

let base: ExistingAccountSnapshot;
beforeAll(async () => {
  base = await messySnapshot();
});
const opts = () => ({ destination: messy.destination, feeSponsor: messy.sponsor });

/** The recorded fixture with nothing left to clean up: native XLM only. */
function bare(s: ExistingAccountSnapshot): ExistingAccountSnapshot {
  const b = copy(s);
  b.trustlines = [];
  b.poolShares = [];
  b.offers = [];
  b.data = [];
  b.quotes = [];
  b.subentryCount = 0;
  b.numSponsored = 0;
  return b;
}

describe("the planner's sequence guard wiring (E3-S4)", () => {
  it("records the bound it applied in plan.options.maxWaitLedgers, 120 ledgers by default", () => {
    expect(planFromSnapshot(base, opts()).options?.maxWaitLedgers).toBe(120);
    expect(planFromSnapshot(base, { ...opts(), maxWaitLedgers: 7 }).options?.maxWaitLedgers).toBe(
      7,
    );
  });

  it("waits up to the bound and blocks one ledger beyond it", () => {
    const at = (ahead: number, maxWaitLedgers?: number) => {
      const s = copy(base);
      // The merge is the third transaction: sequence at merge = sequence + 3, so it can land from
      // ledger observed + ahead + 1, `ahead + 1` ledgers after the one observed.
      s.sequence = (BigInt(s.observed.ledger + ahead) << 32n).toString();
      return planFromSnapshot(s, { ...opts(), ...(maxWaitLedgers ? { maxWaitLedgers } : {}) });
    };
    expect(at(119).status).toBe("closable");
    expect(at(119).sequenceGuard).toMatchObject({
      ok: false,
      unblocksAtLedger: base.observed.ledger + 120,
    });
    expect(at(120).status).toBe("blocked");
    expect(at(120).blockers.map((b) => b.code)).toEqual(["SEQNUM_TOO_FAR"]);
    expect(at(9, 10).status).toBe("closable");
    expect(at(10, 10).status).toBe("blocked");
  });

  it("says the cleanup runs first when there is one", () => {
    const s = copy(base);
    s.sequence = (BigInt(s.observed.ledger + 3) << 32n).toString();
    const plan = planFromSnapshot(s, opts());
    expect(plan.warnings.join(" ")).toMatch(
      /The cleanup runs first; the executor waits before submitting the merge\./,
    );
    expect(plan.transactions.at(-1)!.reason).toMatch(
      /The merge runs alone after the cleanup because it must wait until ledger/,
    );
  });

  it("does not speak of a cleanup when the merge is the plan's only transaction", () => {
    const s = bare(base);
    // The merge is the only transaction: sequence at merge = sequence + 1, so it can land from
    // ledger observed + 4.
    s.sequence = (BigInt(s.observed.ledger + 3) << 32n).toString();
    const plan = planFromSnapshot(s, opts());
    expect(plan.transactions.map((t) => t.phase)).toEqual(["merge"]);
    const warning = plan.warnings.find((w) => w.includes("sequence number"))!;
    expect(warning).not.toMatch(/cleanup/);
    expect(warning).toMatch(
      new RegExp(
        `the merge must wait until ledger ${base.observed.ledger + 4} \\(about 20 s\\)\\. Nothing needs cleaning up first; the executor waits before submitting the merge\\.`,
      ),
    );
    expect(plan.transactions[0]!.reason).toBe(
      `The merge must wait until ledger ${base.observed.ledger + 4} for the sequence guard; the executor waits before submitting it.`,
    );
  });
});
