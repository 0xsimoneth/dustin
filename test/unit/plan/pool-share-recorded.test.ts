import { readFileSync } from "node:fs";
import { join } from "node:path";
import { LiquidityPoolAsset } from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";
import type { ClosePlan } from "../../../src/plan/model.js";
import { planClose } from "../../../src/plan/plan-close.js";
import { horizonJson } from "../../../src/reader/horizon-json.js";
import { horizonReader } from "../../../src/reader/ledger-reader.js";
import { buildInnerTransaction } from "../../../src/tx/build-inner.js";
import { TESTNET_HORIZON, loadRecorded, recordedFetch } from "../../helpers/recorded-horizon.js";

// Horizon responses recorded on the public testnet by test/testnet/pool-share-removal.test.ts
// (DUSTIN_RECORD=1) just before Dustin closed the account: a holder with an empty pool-share
// trustline of the LPA / LPB pool and its two empty asset trustlines. That close removed the
// share trustline, LPA, LPB and merged, in this order, in one fee-bumped transaction.
const DIR = "test/fixtures/horizon/pool-share";
const manifest = JSON.parse(readFileSync(join(DIR, "manifest.json"), "utf8")) as {
  accounts: { holder: string; destination: string; sponsor: string };
  poolId: string;
  poolAssets: [string, string];
};

async function plan(overrides: Record<string, unknown> = {}): Promise<ClosePlan> {
  const { fetch } = recordedFetch(loadRecorded(DIR), overrides);
  return planClose(
    {
      account: manifest.accounts.holder,
      destination: manifest.accounts.destination,
      feeSponsor: manifest.accounts.sponsor,
      baseFeeStroops: 100,
    },
    { reader: horizonReader(horizonJson(TESTNET_HORIZON, { fetch, retries: 0, backoffMs: 0 })) },
  );
}

describe("a recorded testnet account with an empty pool-share trustline", () => {
  it("plans the share trustline first, then its asset trustlines, then the merge", async () => {
    const p = await plan();
    expect(p.status).toBe("closable");
    expect(p.steps.map((s) => s.operation)).toEqual([
      {
        type: "changeTrust",
        asset: {
          type: "liquidity_pool_shares",
          poolId: manifest.poolId,
          assets: manifest.poolAssets,
        },
        limit: "0",
      },
      ...manifest.poolAssets.map((key) => {
        const [code, issuer] = key.split(":");
        return {
          type: "changeTrust",
          asset: { type: "credit_alphanum4", code, issuer },
          limit: "0",
        };
      }),
      { type: "accountMerge", destination: manifest.accounts.destination },
    ]);
    expect(p.transactions).toHaveLength(1);
    expect(p.recovery.xlmToDestination).toBe("5.0000000");
  });

  it("plans exactly the same close when Horizon answers 404 for the pool (review finding R13)", async () => {
    const listed = await plan();
    const hidden = await plan({ [`/liquidity_pools/${manifest.poolId}`]: undefined });
    expect(hidden.planHash).toBe(listed.planHash);
    expect(hidden.steps).toEqual(listed.steps);
    expect(hidden.warnings).toContain(
      `Liquidity pool ${manifest.poolId} was not found on Horizon; its assets ${manifest.poolAssets.join(" / ")} were derived from the pool id.`,
    );
  });

  it("builds the share trustline removal as the SDK's pool asset for this pool id", async () => {
    const p = await plan({ [`/liquidity_pools/${manifest.poolId}`]: undefined });
    const inner = buildInnerTransaction({
      account: manifest.accounts.holder,
      sequence: "1",
      operations: p.steps.map((s) => s.operation),
      networkPassphrase: "Test SDF Network ; September 2015",
      maxTime: 1_790_000_000,
    });
    const [share] = inner.operations;
    expect(share?.type).toBe("changeTrust");
    const line = (share as { line: unknown }).line;
    expect(line).toBeInstanceOf(LiquidityPoolAsset);
    expect((line as LiquidityPoolAsset).toString()).toBe(`liquidity_pool:${manifest.poolId}`);
  });
});
