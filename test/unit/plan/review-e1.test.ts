import { beforeAll, describe, expect, it } from "vitest";
import type { ExistingAccountSnapshot } from "../../../src/inspect/snapshot.js";
import { chooseRung } from "../../../src/plan/ladder.js";
import { orderClose } from "../../../src/plan/order.js";
import { planFromSnapshot } from "../../../src/plan/plan.js";
import { recoverySummary } from "../../../src/plan/recovery.js";
import { randomSnapshot } from "../../helpers/generate.js";
import { copy, messy, messySnapshot } from "../../helpers/snapshots.js";

let base: ExistingAccountSnapshot;
beforeAll(async () => {
  base = await messySnapshot();
});
const opts = () => ({ destination: messy.destination });
const line = (s: ExistingAccountSnapshot, code: string) =>
  s.trustlines.find((t) => t.asset.code === code)!;

describe("Epic 1 review findings", () => {
  it("treats liquidity pool shares as a merge blocker, so the plan is blocked", () => {
    const s = copy(base);
    s.poolShares.push({
      poolId: "ab".repeat(32),
      balance: "1.0000000",
      sponsor: null,
      assets: ["native", `DUSTC:${messy.issuer}`],
    });
    const plan = planFromSnapshot(s, opts());
    expect(plan.status).toBe("blocked");
    expect(plan.blockers.map((b) => b.code)).toContain("LIQUIDITY_POOL_SHARES");
    expect(plan.unclosable.map((u) => u.code)).toContain("POOL_ASSET_TRUSTLINE");
  });

  it("rounds the slippage up so destMin sits below a dust quote", () => {
    const r = chooseRung(base, line(base, "DUSTA"), { order: "sow", slippageBps: 100, memo: null });
    if (!r.ok) throw new Error(r.reason);
    expect(r.decision.destMinXlm).toBe("0.0000006");
  });

  it("requires the low threshold too, because the transaction source must meet it", () => {
    const s = copy(base);
    s.thresholds = { low: 5, medium: 1, high: 1 };
    const r = orderClose(s, opts());
    expect(r.status).toBe("blocked");
    expect(r.units).toEqual([]);
    expect(r.blockers.map((b) => b.code)).toContain("THRESHOLD_UNMET");
  });

  it("never picks the account itself as a destination for a balance", () => {
    const s = copy(base);
    s.destination!.baseAccount = s.account;
    s.destination!.trustlines = s.trustlines.map((t) => ({
      asset: t.asset,
      balance: "0.0000000",
      limit: "1000.0000000",
      buyingLiabilities: "0.0000000",
      authorized: true,
    }));
    const r = chooseRung(s, line(s, "DUSTB"), {
      order: "prefer-destination",
      slippageBps: 100,
      memo: null,
    });
    if (!r.ok) throw new Error(r.reason);
    expect(r.decision.rung).toBe("return_to_issuer");
  });

  it("keeps market data out of the plan hash, including the quoted path", () => {
    const a = planFromSnapshot(base, opts());
    const moved = copy(base);
    moved.quotes.find((q) => q.asset.code === "DUSTA")!.quote!.path = [
      { type: "credit_alphanum4", code: "HOP", issuer: messy.issuer },
    ];
    expect(planFromSnapshot(moved, opts()).planHash).toBe(a.planHash);
  });

  it("explains a merge-only transaction truthfully", () => {
    const s = randomSnapshot(21, { offers: 0, trustlines: 0 });
    s.data = [];
    const plan = planFromSnapshot(s, { destination: s.destination!.account });
    expect(plan.transactions[0]!.reason).toMatch(/nothing to clean up/i);
  });

  it("attributes sponsored offers only when the plan cancels them", () => {
    const s = copy(base);
    s.offers[0]!.sponsor = messy.marketMaker;
    expect(recoverySummary(s, []).reservesReturnedToSponsors).toEqual([]);
  });

  it("validates the planner options", () => {
    for (const bad of [
      { slippageBps: 0.5 },
      { slippageBps: -1 },
      { baseFeeStroops: Number.NaN },
      { baseFeeStroops: 50 },
      { maxOpsPerTransaction: 1 },
      { budgetStroops: 0 },
      { maxBaseFeeStroops: 10 },
    ]) {
      expect(() => planFromSnapshot(base, { ...opts(), ...bad }), JSON.stringify(bad)).toThrow(
        expect.objectContaining({ code: "CONFIG_INVALID" }),
      );
    }
  });

  it("orders trustlines by code point, not by locale", () => {
    const s = copy(base);
    const lower = {
      ...line(s, "DUSTA"),
      asset: { ...line(s, "DUSTA").asset, code: "dusta" },
      balance: "0.0000000",
    };
    s.trustlines.push(lower);
    s.trustlines.sort(() => 0);
    const codes = orderClose(s, opts())
      .units.flatMap((u) => u.steps)
      .filter((st) => st.kind === "remove_trustline")
      .map((st) => (st.subject.type === "trustline" ? st.subject.asset.code : ""));
    // Upper-case letters sort before lower-case ones by code point.
    expect(codes.indexOf("dusta")).toBeGreaterThan(codes.indexOf("DUSTC"));
  });

  it("explains a block when only the cleanup's medium threshold is out of reach", () => {
    // Found by the property test: weight 1 meets high 1 but not medium 2, so nothing can be signed.
    const s = randomSnapshot(11, { offers: 0, trustlines: 0 });
    s.thresholds = { low: 0, medium: 2, high: 1 };
    const plan = planFromSnapshot(s, { destination: s.destination!.account });
    expect(plan.status).toBe("blocked");
    expect(plan.steps).toEqual([]);
    expect(plan.blockers.map((b) => b.code)).toEqual(["THRESHOLD_UNMET"]);
    expect(plan.blockers[0]!.reason).toMatch(/cleanup needs weight 2/);
  });
});
