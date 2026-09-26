import {
  Asset,
  Keypair,
  LiquidityPoolAsset,
  LiquidityPoolFeeV18,
  getLiquidityPoolId,
} from "@stellar/stellar-sdk";
import { beforeAll, describe, expect, it } from "vitest";
import type { HorizonAccount } from "../../../src/inspect/horizon-types.js";
import type { ExistingAccountSnapshot, TrustlineInfo } from "../../../src/inspect/snapshot.js";
import type { ClosePlan } from "../../../src/plan/model.js";
import { derivePoolAssets } from "../../../src/plan/order.js";
import { planFromSnapshot } from "../../../src/plan/plan.js";
import { planClose } from "../../../src/plan/plan-close.js";
import { horizonJson } from "../../../src/reader/horizon-json.js";
import { horizonReader } from "../../../src/reader/ledger-reader.js";
import { randomSnapshot } from "../../helpers/generate.js";
import {
  MESSY_DIR,
  TESTNET_HORIZON,
  loadRecorded,
  recordedFetch,
} from "../../helpers/recorded-horizon.js";
import { copy, messy, messySnapshot } from "../../helpers/snapshots.js";

// Review finding R13: when GET /liquidity_pools/{id} answers 404 the planner derives the pool's
// assets from the pool id itself. A pool id is SHA-256 of the pool parameters: both assets in
// lexicographic order and the 30 bps fee (CAP-38,
// https://github.com/stellar/stellar-protocol/blob/master/core/cap-0038.md).

let base: ExistingAccountSnapshot;
beforeAll(async () => {
  base = await messySnapshot();
});
const opts = () => ({ destination: messy.destination });
const key = (code: string) => `${code}:${messy.issuer}`;

function sdkAsset(k: string): Asset {
  if (k === "native") return Asset.native();
  const [code, issuer] = k.split(":");
  return new Asset(code!, issuer);
}

/** The pool id of two assets, computed independently with the SDK. */
function poolIdOf(x: string, y: string): string {
  const [assetA, assetB] = [sdkAsset(x), sdkAsset(y)].sort((a, b) => Asset.compare(a, b)) as [
    Asset,
    Asset,
  ];
  return Buffer.from(
    getLiquidityPoolId("constant_product", { assetA, assetB, fee: LiquidityPoolFeeV18 }),
  ).toString("hex");
}

function withPool(poolId: string, balance: string, assets: string[] | null) {
  const s = copy(base);
  s.poolShares.push({ poolId, balance, sponsor: null, assets });
  return s;
}

/** Everything the plan hash and the executor depend on; warnings may differ. */
const structure = (p: ClosePlan) => ({
  status: p.status,
  steps: p.steps,
  transactions: p.transactions,
  unclosable: p.unclosable,
  blockers: p.blockers,
  planHash: p.planHash,
});

const creditRemovals = (p: ClosePlan) =>
  p.steps.filter((st) => st.kind === "remove_trustline" && st.subject.type === "trustline");

describe("derivePoolAssets", () => {
  it("finds a pool's assets from its id, in the protocol's order: type, then code, then issuer", () => {
    const xlmDustc = poolIdOf("native", key("DUSTC"));
    const sptaDusta = poolIdOf(key("DUSTA"), key("SPTA"));
    const found = derivePoolAssets([xlmDustc, sptaDusta], base.trustlines);
    expect(found.get(xlmDustc)).toEqual(["native", key("DUSTC")]);
    // SPTA (4 characters, credit_alphanum4) sorts before DUSTA (credit_alphanum12).
    expect(found.get(sptaDusta)).toEqual([key("SPTA"), key("DUSTA")]);
    // The SDK's own pool asset names the same pool.
    const lp = new LiquidityPoolAsset(sdkAsset(key("SPTA")), sdkAsset(key("DUSTA")), 30);
    expect(lp.toString()).toBe(`liquidity_pool:${sptaDusta}`);
  });

  it("finds nothing when a pool uses an asset outside the account's trustlines", () => {
    // An issuer may hold shares of a pool with its own asset without a trustline for it
    // (stellar-core ChangeTrustOpFrame::tryIncrementPoolUseCount), so such a pool is not found.
    const own = poolIdOf("native", `OWN:${messy.fixture}`);
    expect(derivePoolAssets([own, "cd".repeat(32)], base.trustlines).size).toBe(0);
  });

  it("skips an asset the SDK rejects instead of throwing", () => {
    const broken: TrustlineInfo = {
      ...base.trustlines[0]!,
      asset: { type: "credit_alphanum12", code: "NOT-A-CODE", issuer: messy.issuer },
    };
    const id = poolIdOf("native", key("DUSTB"));
    expect(derivePoolAssets([id], [broken, ...base.trustlines]).get(id)).toEqual([
      "native",
      key("DUSTB"),
    ]);
  });

  it("matches the id whatever its hex case", () => {
    const id = poolIdOf("native", key("DUSTB"));
    expect(derivePoolAssets([id.toUpperCase()], base.trustlines).get(id.toUpperCase())).toEqual([
      "native",
      key("DUSTB"),
    ]);
  });
});

describe("a pool whose Horizon lookup returned null", () => {
  it("is resolved from its id and planned exactly as if Horizon had returned it", () => {
    const id = poolIdOf("native", key("DUSTC"));
    const known = planFromSnapshot(withPool(id, "0.0000000", ["native", key("DUSTC")]), opts());
    const derived = planFromSnapshot(withPool(id, "0.0000000", null), opts());
    expect(structure(derived)).toEqual(structure(known));
    expect(derived.status).toBe("closable");
    expect(derived.warnings).toContain(
      `Liquidity pool ${id} was not found on Horizon; its assets native / ${key("DUSTC")} were derived from the pool id.`,
    );

    // The share line goes first and unblocks DUSTC (CHANGE_TRUST_CANNOT_DELETE until then).
    const pool = derived.steps.find((st) => st.subject.type === "pool_share")!;
    expect(pool.operation).toEqual({
      type: "changeTrust",
      asset: { type: "liquidity_pool_shares", poolId: id, assets: ["native", key("DUSTC")] },
      limit: "0",
    });
    const dustc = creditRemovals(derived).find(
      (st) => st.subject.type === "trustline" && st.subject.asset.code === "DUSTC",
    )!;
    expect(dustc.dependsOn).toContain(pool.id);
    expect(derived.steps.indexOf(dustc)).toBeGreaterThan(derived.steps.indexOf(pool));
  });

  it("resolves a pool of two credit assets and removes the share line before both", () => {
    const id = poolIdOf(key("DUSTB"), key("DUSTC"));
    const plan = planFromSnapshot(withPool(id, "0.0000000", null), opts());
    expect(plan.status).toBe("closable");
    const pool = plan.steps.find((st) => st.subject.type === "pool_share")!;
    expect(pool.operation).toMatchObject({
      asset: { poolId: id, assets: [key("DUSTB"), key("DUSTC")] },
    });
    for (const code of ["DUSTB", "DUSTC"]) {
      const removal = creditRemovals(plan).find(
        (st) => st.subject.type === "trustline" && st.subject.asset.code === code,
      )!;
      expect(removal.dependsOn).toContain(pool.id);
      expect(plan.steps.indexOf(removal)).toBeGreaterThan(plan.steps.indexOf(pool));
    }
  });

  it("marks only the resolved pool's asset trustlines when shares are held", () => {
    const id = poolIdOf("native", key("DUSTC"));
    const known = planFromSnapshot(withPool(id, "1.0000000", ["native", key("DUSTC")]), opts());
    const derived = planFromSnapshot(withPool(id, "1.0000000", null), opts());
    expect(structure(derived)).toEqual(structure(known));
    expect(derived.status).toBe("blocked");
    expect(derived.blockers.map((b) => b.code)).toEqual(["LIQUIDITY_POOL_SHARES"]);
    expect(
      derived.unclosable.map((u) => [
        u.code,
        u.subject.type === "trustline" ? u.subject.asset.code : u.subject.type,
      ]),
    ).toEqual([["POOL_ASSET_TRUSTLINE", "DUSTC"]]);
    // The other trustlines are still cleaned up for a --partial run.
    expect(creditRemovals(derived)).toHaveLength(3);
  });

  it("keeps every trustline when the pool cannot be resolved, so --partial cannot hit CHANGE_TRUST_CANNOT_DELETE", () => {
    const own = poolIdOf("native", `OWN:${messy.fixture}`);
    const plan = planFromSnapshot(withPool(own, "0.0000000", null), opts());
    expect(plan.status).toBe("partial");
    expect(plan.blockers).toEqual([]);
    expect(plan.unclosable.map((u) => u.code)).toEqual([
      "LIQUIDITY_POOL_SHARES",
      "POOL_ASSET_TRUSTLINE",
      "POOL_ASSET_TRUSTLINE",
      "POOL_ASSET_TRUSTLINE",
      "POOL_ASSET_TRUSTLINE",
    ]);
    const kept = plan.unclosable.filter((u) => u.code === "POOL_ASSET_TRUSTLINE");
    for (const u of kept) {
      expect(u.reason).toMatch(new RegExp(`may belong to liquidity pool ${own}`));
      expect(u.reason).toMatch(/CHANGE_TRUST_CANNOT_DELETE/);
    }
    // No trustline is touched: only the offers and the data entry go.
    expect(plan.steps.map((st) => st.kind)).toEqual([
      "cancel_offer",
      "cancel_offer",
      "remove_data",
    ]);
    expect(plan.warnings[0]).toBe(
      `Liquidity pool ${own} was not found on Horizon and no pair of this account's assets hashes to its id; every asset trustline stays, because any of them may belong to the pool.`,
    );
  });

  it("keeps every trustline when shares of an unresolved pool are held", () => {
    const plan = planFromSnapshot(withPool("cd".repeat(32), "2.0000000", null), opts());
    expect(plan.status).toBe("blocked");
    expect(plan.blockers.map((b) => b.code)).toEqual(["LIQUIDITY_POOL_SHARES"]);
    expect(plan.unclosable.filter((u) => u.code === "POOL_ASSET_TRUSTLINE")).toHaveLength(4);
    expect(plan.steps.some((st) => st.kind === "remove_trustline")).toBe(false);
  });

  it("still removes a resolved empty share line when another pool cannot be resolved", () => {
    const resolvable = poolIdOf("native", key("DUSTB"));
    const s = withPool(resolvable, "0.0000000", null);
    s.poolShares.push({
      poolId: "cd".repeat(32),
      balance: "0.0000000",
      sponsor: null,
      assets: null,
    });
    const plan = planFromSnapshot(s, opts());
    expect(plan.status).toBe("partial");
    const removals = plan.steps.filter((st) => st.kind === "remove_trustline");
    expect(removals.map((st) => st.subject)).toEqual([
      { type: "pool_share", poolId: resolvable, balance: "0.0000000", sponsor: null },
    ]);
    expect(plan.unclosable.map((u) => u.code)).toEqual([
      "LIQUIDITY_POOL_SHARES",
      "POOL_ASSET_TRUSTLINE",
      "POOL_ASSET_TRUSTLINE",
      "POOL_ASSET_TRUSTLINE",
      "POOL_ASSET_TRUSTLINE",
    ]);
    expect(plan.unclosable[1]!.reason).toMatch(/may belong to liquidity pool cdcd/);
  });

  it("lists every unresolved pool in the reason when there are several", () => {
    const s = withPool("cd".repeat(32), "0.0000000", null);
    s.poolShares.push({
      poolId: "ef".repeat(32),
      balance: "0.0000000",
      sponsor: null,
      assets: null,
    });
    const plan = planFromSnapshot(s, opts());
    const kept = plan.unclosable.find((u) => u.code === "POOL_ASSET_TRUSTLINE")!;
    expect(kept.reason).toContain(
      `may belong to one of the liquidity pools ${"cd".repeat(32)}, ${"ef".repeat(32)}`,
    );
  });

  it("is resolved by planClose when GET /liquidity_pools/{id} answers 404", async () => {
    const id = poolIdOf("native", key("DUSTC"));
    const recorded = loadRecorded(MESSY_DIR);
    const account = structuredClone(recorded.get(`/accounts/${messy.fixture}`)) as HorizonAccount;
    // Horizon's shape of a pool-share balance: no asset code or issuer, two subentries.
    account.balances.unshift({
      asset_type: "liquidity_pool_shares",
      liquidity_pool_id: id,
      balance: "0.0000000",
      limit: "922337203685.4775807",
      is_authorized: false,
      is_authorized_to_maintain_liabilities: false,
    });
    account.subentry_count += 2;
    const { fetch, requests } = recordedFetch(recorded, {
      [`/accounts/${messy.fixture}`]: account,
    });
    const reader = horizonReader(horizonJson(TESTNET_HORIZON, { fetch, retries: 0, backoffMs: 0 }));
    const plan = await planClose(
      { account: messy.fixture, destination: messy.destination, baseFeeStroops: 100 },
      { reader },
    );
    // The pool was asked for, and the recording has no answer: a 404.
    expect(requests).toContainEqual({ method: "GET", path: `/liquidity_pools/${id}` });
    expect(plan.status).toBe("closable");
    expect(plan.steps.find((st) => st.subject.type === "pool_share")?.operation).toEqual({
      type: "changeTrust",
      asset: { type: "liquidity_pool_shares", poolId: id, assets: ["native", key("DUSTC")] },
      limit: "0",
    });
    expect(plan.recovery.xlmToDestination).toBe("4.0000007");
  });
});

describe("pool resolution over generated snapshots", () => {
  it("gives the same plan with or without Horizon's answer whenever the pool id is real", () => {
    let pools = 0;
    for (let seed = 1; seed <= 600; seed++) {
      const s = randomSnapshot(seed, { variety: true });
      const pool = s.poolShares[0];
      if (!pool?.assets) continue;
      // The generator's pool ids are placeholders; give the pool its real id.
      pool.poolId = poolIdOf(pool.assets[0]!, pool.assets[1]!);
      const destination = s.destination!.account;
      const known = planFromSnapshot(s, { destination });
      const hidden = copy(s);
      hidden.poolShares[0]!.assets = null;
      const derived = planFromSnapshot(hidden, { destination });
      try {
        expect(structure(derived)).toEqual(structure(known));
      } catch (error) {
        throw new Error(`seed ${seed}: ${(error as Error).message}`, { cause: error });
      }
      pools++;
    }
    // The generator draws a pool with known assets for roughly 1 seed in 12.
    expect(pools).toBeGreaterThan(20);
  });

  it("never plans a credit trustline removal while an unresolved pool share exists", () => {
    let pools = 0;
    for (let seed = 1; seed <= 600; seed++) {
      const s = randomSnapshot(seed, { variety: true });
      const pool = s.poolShares[0];
      if (!pool) continue;
      pool.assets = null;
      pool.poolId = poolIdOf(
        "native",
        `OWN:${Keypair.fromRawEd25519Seed(Buffer.alloc(32, 9)).publicKey()}`,
      );
      const plan = planFromSnapshot(s, { destination: s.destination!.account });
      expect(creditRemovals(plan), `seed ${seed}`).toEqual([]);
      expect(
        plan.steps.some((st) => st.kind === "merge"),
        `seed ${seed}`,
      ).toBe(false);
      pools++;
    }
    expect(pools).toBeGreaterThan(20);
  });
});
