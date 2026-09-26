import { beforeAll, describe, expect, it } from "vitest";
import type { ExistingAccountSnapshot } from "../../../src/inspect/snapshot.js";
import { planFromSnapshot } from "../../../src/plan/plan.js";
import { randomSnapshot } from "../../helpers/generate.js";
import { copy, messy, messySnapshot } from "../../helpers/snapshots.js";

let base: ExistingAccountSnapshot;
beforeAll(async () => {
  base = await messySnapshot();
});
const opts = () => ({ destination: messy.destination, feeSponsor: messy.sponsor });

describe("planFromSnapshot on the recorded fixture", () => {
  it("groups into cleanup, the isolated DUSTA sale and the merge", () => {
    const plan = planFromSnapshot(base, opts());
    expect(plan.status).toBe("closable");
    expect(plan.transactions.map((t) => [t.phase, t.opCount])).toEqual([
      ["cleanup", 9],
      ["convert", 2],
      ["merge", 1],
    ]);
    expect(plan.steps.map((s) => s.txIndex)).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 2]);
    expect(plan.steps.at(-1)!.kind).toBe("merge");
  });

  it("bids fee_charged p80 per operation, inner fee 0, the sponsor pays (ops + 1) per transaction", () => {
    const plan = planFromSnapshot(base, opts());
    const bid = plan.fees.baseFeeStroops;
    expect(bid).toBe(Math.max(100, base.feeStats.feeChargedP80, base.feeStats.lastLedgerBaseFee));
    expect(plan.fees.basis).toBe("fee_stats");
    expect(plan.transactions.map((t) => t.innerFeeStroops)).toEqual([0, 0, 0]);
    expect(plan.fees.perTransactionStroops).toEqual([10 * bid, 3 * bid, 2 * bid]);
    expect(plan.fees.totalStroops).toBe(15 * bid);
    expect(plan.fees.budgetStroops).toBe(50_000_000);
    expect(plan.fees.withinBudget).toBe(true);
    expect(plan.fees.payer).toBe(messy.sponsor);
    expect(plan.recovery.feesPaidByAccount).toBe("0");
    for (const s of plan.steps) expect(s.feeEstimateStroops).toBe(bid);
  });

  it("honours an override and the cap", () => {
    expect(planFromSnapshot(base, { ...opts(), baseFeeStroops: 100 }).fees).toMatchObject({
      baseFeeStroops: 100,
      basis: "override",
      totalStroops: 1500,
    });
    const surge = copy(base);
    surge.feeStats.feeChargedP80 = 10_000_000;
    expect(planFromSnapshot(surge, opts()).fees.baseFeeStroops).toBe(1_000_000);
  });

  it("appends the merge to the cleanup when there is no path payment", () => {
    const s = copy(base);
    s.quotes.find((q) => q.asset.code === "DUSTA")!.quote = null;
    const plan = planFromSnapshot(s, opts());
    expect(plan.transactions.map((t) => [t.phase, t.opCount])).toEqual([["cleanup", 12]]);
    expect(plan.transactions[0]!.reason).toMatch(/merge/);
  });

  it("carries the sequence guard on the merge", () => {
    const plan = planFromSnapshot(base, opts());
    expect(plan.sequenceGuard).toMatchObject({
      ok: true,
      earliestLedger: base.observed.ledger + 1,
    });
    expect(plan.sequenceGuard!.sequenceAtMerge).toBe((BigInt(base.sequence) + 3n).toString());
  });

  it("waits for a near guard with a separate merge, and blocks a far one", () => {
    const near = copy(base);
    near.sequence = (BigInt(near.observed.ledger + 3) << 32n).toString();
    const n = planFromSnapshot(near, opts());
    expect(n.status).toBe("closable");
    expect(n.sequenceGuard).toMatchObject({
      ok: false,
      unblocksAtLedger: near.observed.ledger + 4,
    });
    expect(n.warnings.join(" ")).toMatch(/wait/);
    expect(n.transactions.at(-1)!.phase).toBe("merge");
    const far = copy(base);
    far.sequence = (BigInt(far.observed.ledger + 100_000) << 32n).toString();
    const f = planFromSnapshot(far, opts());
    expect(f.status).toBe("blocked");
    expect(f.blockers.map((b) => b.code)).toEqual(["SEQNUM_TOO_FAR"]);
    expect(f.steps.some((s) => s.kind === "merge")).toBe(false);
    expect(f.steps.length).toBe(11);
  });

  it("hashes the structure, not the fees or the quotes", () => {
    const a = planFromSnapshot(base, opts());
    expect(a.planHash).toMatch(/^[0-9a-f]{64}$/);
    expect(planFromSnapshot(base, opts()).planHash).toBe(a.planHash);
    expect(planFromSnapshot(base, { ...opts(), baseFeeStroops: 5000 }).planHash).toBe(a.planHash);
    const moved = copy(base);
    moved.quotes.find((q) => q.asset.code === "DUSTA")!.quote!.destinationAmount = "0.0000009";
    expect(planFromSnapshot(moved, opts()).planHash).toBe(a.planHash);
    expect(planFromSnapshot(base, { ...opts(), preferDestination: true }).planHash).not.toBe(
      a.planHash,
    );
  });

  it("is JSON-stable, holds no secret and keeps every reason non-empty", () => {
    const plan = planFromSnapshot(base, opts());
    expect(JSON.parse(JSON.stringify(plan))).toEqual(plan);
    expect(JSON.stringify(plan)).not.toMatch(/(?<![A-Z2-7])S[A-Z2-7]{55}(?![A-Z2-7])/);
    for (const t of plan.transactions) expect(t.reason.length).toBeGreaterThan(20);
  });

  it("keeps the fixture's reasons stable", () => {
    const plan = planFromSnapshot(base, opts());
    expect({
      steps: plan.steps.map((s) => `${s.id} ${s.kind}: ${s.reason}`),
      transactions: plan.transactions.map((t) => `${t.index} ${t.phase}: ${t.reason}`),
    }).toMatchSnapshot();
  });

  it("plans a missing account as blocked with no steps", () => {
    const plan = planFromSnapshot(
      {
        schemaVersion: 1,
        account: base.account,
        exists: false,
        observed: base.observed,
        feeStats: base.feeStats,
        destination: base.destination,
        snapshotHash: "h",
      },
      opts(),
    );
    expect(plan).toMatchObject({
      status: "blocked",
      steps: [],
      transactions: [],
      sequenceGuard: null,
    });
    expect(plan.blockers.map((b) => b.code)).toEqual(["ACCOUNT_MISSING"]);
  });
});

describe("grouping at the 100-operation limit", () => {
  it("splits 150 offer cancellations and keeps the merge last", () => {
    const s = randomSnapshot(7, { offers: 150, trustlines: 3 });
    for (const t of s.trustlines) Object.assign(t, { authorized: true, balance: "0.0000000" });
    const plan = planFromSnapshot(s, { destination: s.destination!.account });
    const cleanup = plan.transactions.filter((t) => t.phase === "cleanup");
    expect(cleanup.length).toBeGreaterThanOrEqual(2);
    expect(cleanup[0]!.opCount).toBe(100);
    expect(plan.transactions.at(-1)!.stepIds.at(-1)).toBe(plan.steps.at(-1)!.id);
    expect(plan.steps.at(-1)!.kind).toBe("merge");
  });
});
