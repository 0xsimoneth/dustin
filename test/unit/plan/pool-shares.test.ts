import { beforeAll, describe, expect, it } from "vitest";
import type { ExistingAccountSnapshot } from "../../../src/inspect/snapshot.js";
import { planFromSnapshot } from "../../../src/plan/plan.js";
import { renderPlan } from "../../../src/render/plan-text.js";
import { copy, messy, messySnapshot } from "../../helpers/snapshots.js";

let base: ExistingAccountSnapshot;
beforeAll(async () => {
  base = await messySnapshot();
});
const opts = () => ({ destination: messy.destination });
const POOL = "cd".repeat(32);
const DUSTC = () => `DUSTC:${messy.issuer}`;

function withPool(balance: string, assets: string[] | null, sponsor: string | null = null) {
  const s = copy(base);
  s.poolShares.push({ poolId: POOL, balance, sponsor, assets });
  return s;
}

// Architecture section 4.4: an empty pool-share trustline is just a trustline and is removed
// normally; ChangeTrustOp takes the pool's full representation (its two assets in lexicographic
// order and the 30 bps fee) and a pool-share trustline holds two base reserves
// (https://developers.stellar.org/docs/learn/fundamentals/liquidity-on-stellar-sdex-liquidity-pools#trustlines).
describe("pool-share trustlines", () => {
  it("removes an empty pool-share trustline before its pool's asset trustline, and closes", () => {
    const plan = planFromSnapshot(withPool("0.0000000", ["native", DUSTC()]), opts());
    expect(plan.status).toBe("closable");
    expect(plan.blockers).toEqual([]);
    expect(plan.unclosable).toEqual([]);

    const pool = plan.steps.find((st) => st.subject.type === "pool_share")!;
    expect(pool).toMatchObject({
      kind: "remove_trustline",
      threshold: "medium",
      operation: {
        type: "changeTrust",
        asset: { type: "liquidity_pool_shares", poolId: POOL, assets: ["native", DUSTC()] },
        limit: "0",
      },
      reserveReleasedTo: { to: "account" },
    });
    expect(pool.reason).toMatch(/two base reserves \(1\.0000000 XLM\)/);

    // DUSTC is referenced by the pool (CHANGE_TRUST_CANNOT_DELETE) until the share line is gone.
    const dustc = plan.steps.find(
      (st) =>
        st.kind === "remove_trustline" &&
        st.subject.type === "trustline" &&
        st.subject.asset.code === "DUSTC",
    )!;
    expect(dustc.dependsOn).toContain(pool.id);
    expect(plan.steps.indexOf(dustc)).toBeGreaterThan(plan.steps.indexOf(pool));
    expect(renderPlan(plan)).toContain(`remove pool-share trustline ${POOL.slice(0, 4)}`);
  });

  it("returns a sponsored empty pool-share line's two reserves to its sponsor", () => {
    const plan = planFromSnapshot(
      withPool("0.0000000", ["native", DUSTC()], messy.reserveSponsor),
      opts(),
    );
    const pool = plan.steps.find((st) => st.subject.type === "pool_share")!;
    expect(pool.reserveReleasedTo).toEqual({ to: "sponsor", sponsor: messy.reserveSponsor });
    const credit = plan.recovery.reservesReturnedToSponsors.find(
      (r) => r.sponsor === messy.reserveSponsor,
    )!;
    expect(credit.entries).toContain(`pool share ${POOL}`);
    // SPTA's trustline (1 reserve) plus the pool share (2 reserves).
    expect(credit.xlm).toBe("1.5000000");
  });

  it("still blocks the merge while shares are held, and keeps the pool's asset trustline", () => {
    const plan = planFromSnapshot(withPool("1.0000000", ["native", DUSTC()]), opts());
    expect(plan.status).toBe("blocked");
    expect(plan.blockers.map((b) => b.code)).toEqual(["LIQUIDITY_POOL_SHARES"]);
    expect(plan.unclosable.map((u) => u.code)).toEqual(["POOL_ASSET_TRUSTLINE"]);
    expect(plan.steps.some((st) => st.subject.type === "pool_share")).toBe(false);
  });

  // Review finding R13: POOL is not the id of any pair of this account's assets, so the pool
  // cannot be resolved and any trustline may be one of its assets (test/unit/plan/pool-resolution.test.ts).
  it("reports an empty pool-share line whose pool cannot be resolved and keeps every trustline", () => {
    const plan = planFromSnapshot(withPool("0.0000000", null), opts());
    expect(plan.status).toBe("partial");
    expect(plan.blockers).toEqual([]);
    expect(plan.unclosable[0]).toMatchObject({
      code: "LIQUIDITY_POOL_SHARES",
      subject: { type: "pool_share", poolId: POOL, balance: "0.0000000", sponsor: null },
    });
    expect(
      plan.unclosable.map((u) => [
        u.code,
        u.subject.type === "trustline" ? u.subject.asset.code : u.subject.type,
      ]),
    ).toEqual([
      ["LIQUIDITY_POOL_SHARES", "pool_share"],
      ["POOL_ASSET_TRUSTLINE", "DUSTA"],
      ["POOL_ASSET_TRUSTLINE", "DUSTB"],
      ["POOL_ASSET_TRUSTLINE", "DUSTC"],
      ["POOL_ASSET_TRUSTLINE", "SPTA"],
    ]);
    expect(plan.steps.some((st) => st.kind === "remove_trustline")).toBe(false);
  });
});
