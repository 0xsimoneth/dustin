import { beforeAll, describe, expect, it } from "vitest";
import { replanDrift, rungOneAssets, withPathsOnlyFor } from "../../../src/execute/replan.js";
import { assetKey, type ExistingAccountSnapshot } from "../../../src/inspect/snapshot.js";
import { planFromSnapshot } from "../../../src/plan/plan.js";
import type { LedgerReader } from "../../../src/reader/ledger-reader.js";
import { copy, messy, messySnapshot } from "../../helpers/snapshots.js";

let base: ExistingAccountSnapshot;
beforeAll(async () => {
  base = await messySnapshot();
});
const opts = () => ({ destination: messy.destination, feeSponsor: messy.sponsor });
const plan = (s: ExistingAccountSnapshot) => planFromSnapshot(s, opts());
const line = (s: ExistingAccountSnapshot, code: string) =>
  s.trustlines.find((t) => t.asset.code === code)!;

/** The snapshot after the cleanup transaction: offers, data and three trustlines gone. */
function afterCleanup(): ExistingAccountSnapshot {
  const s = copy(base);
  s.offers = [];
  s.data = [];
  s.trustlines = s.trustlines.filter((t) => t.asset.code === "DUSTA");
  line(s, "DUSTA").sellingLiabilities = "0.0000000";
  s.subentryCount = 1;
  return s;
}

describe("replanDrift (a mid-run re-plan may only drop applied steps and move down the ladder)", () => {
  it("accepts the same plan, and one that lost the steps already applied", () => {
    const approved = plan(base);
    expect(replanDrift(approved, plan(base))).toEqual([]);
    expect(replanDrift(approved, plan(afterCleanup()))).toEqual([]);
  });

  it("accepts an asset moving down the ladder, and one falling off it", () => {
    const approved = plan(base);
    const noMarket = afterCleanup();
    noMarket.quotes.find((q) => q.asset.code === "DUSTA")!.quote = null;
    const down = plan(noMarket);
    expect(down.steps.find((s) => s.kind === "dispose_balance")!.disposal!.rung).toBe(
      "return_to_issuer",
    );
    expect(replanDrift(approved, down)).toEqual([]);

    const frozen = afterCleanup();
    Object.assign(line(frozen, "DUSTA"), { authorized: false });
    const off = plan(frozen);
    expect(off.status).toBe("partial");
    expect(replanDrift(approved, off)).toEqual([]);
  });

  it("flags an asset moving up the ladder", () => {
    const withMarket = copy(base);
    const dustb = line(withMarket, "DUSTB");
    withMarket.quotes.find((q) => q.asset.code === "DUSTB")!.quote = {
      sourceAmount: dustb.balance,
      destinationAmount: "0.0000003",
      path: [],
    };
    const drift = replanDrift(plan(base), plan(withMarket));
    expect(drift.join("; ")).toMatch(/DUSTB moved up the ladder/);
  });

  it("flags a new data entry, a new offer and a larger balance", () => {
    const s = copy(base);
    s.data.push({ name: "late", valueBase64: "MQ==" });
    s.offers.push({ ...s.offers[0]!, id: "999999999" });
    line(s, "DUSTC").balance = "0.0000009";
    const drift = replanDrift(plan(base), plan(s)).join("; ");
    expect(drift).toMatch(/data entry late/);
    expect(drift).toMatch(/offer 999999999/);
    expect(drift).toMatch(/DUSTC balance grew from 0.0000005 to 0.0000009/);
  });

  it("flags a merge the approved plan did not have", () => {
    const partial = copy(base);
    Object.assign(line(partial, "DUSTB"), { authorized: false });
    const approved = plan(partial);
    expect(approved.steps.some((s) => s.kind === "merge")).toBe(false);
    expect(replanDrift(approved, plan(base)).join("; ")).toMatch(/merge/);
  });
});

describe("withPathsOnlyFor", () => {
  it("offers strict-send paths only to the allowed assets", async () => {
    const calls: string[] = [];
    const inner = {
      source: "test",
      strictSendPathsToNative: (asset: { code: string }) => {
        calls.push(asset.code);
        return Promise.resolve([{ source_amount: "1", destination_amount: "1", path: [] }]);
      },
      account: () => Promise.resolve(null),
    } as unknown as LedgerReader;
    const dusta = line(base, "DUSTA").asset;
    const dustb = line(base, "DUSTB").asset;
    const reader = withPathsOnlyFor(inner, new Set([assetKey(dustb)]));
    expect(await reader.strictSendPathsToNative(dusta, "1")).toEqual([]);
    expect(await reader.strictSendPathsToNative(dustb, "1")).toHaveLength(1);
    expect(calls).toEqual(["DUSTB"]);
    expect(reader.source).toBe("test");
    expect(await reader.account("G")).toBeNull();
  });

  it("knows which assets a plan sells on rung 1", () => {
    expect([...rungOneAssets(plan(base))]).toEqual([assetKey(line(base, "DUSTA").asset)]);
  });
});
