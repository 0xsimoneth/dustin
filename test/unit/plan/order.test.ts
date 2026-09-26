import { beforeAll, describe, expect, it } from "vitest";
import type { ExistingAccountSnapshot } from "../../../src/inspect/snapshot.js";
import { orderClose, type OrderResult } from "../../../src/plan/order.js";
import { copy, messy, messySnapshot } from "../../helpers/snapshots.js";

let base: ExistingAccountSnapshot;
beforeAll(async () => {
  base = await messySnapshot();
});

const opts = { destination: messy.destination };
const steps = (r: OrderResult) => r.units.flatMap((u) => u.steps);
const describeStep = (s: ReturnType<typeof steps>[number]) =>
  s.kind === "cancel_offer"
    ? `cancel ${s.subject.type === "offer" ? s.subject.offerId : ""}`
    : s.kind === "dispose_balance"
      ? `${s.disposal!.rung} ${s.subject.type === "trustline" ? s.subject.asset.code : ""}`
      : s.kind === "remove_trustline"
        ? `remove ${s.subject.type === "trustline" ? s.subject.asset.code : ""}`
        : s.kind === "remove_data"
          ? `data ${s.subject.type === "data" ? s.subject.name : ""}`
          : "merge";

describe("orderClose on the recorded fixture", () => {
  it("orders offers, cleanup pairs, data, the path payment pair, then the merge", () => {
    const r = orderClose(base, opts);
    expect(r.status).toBe("closable");
    expect(steps(r).map(describeStep)).toEqual([
      "cancel 826680",
      "cancel 826681",
      "return_to_issuer DUSTB",
      "remove DUSTB",
      "return_to_issuer DUSTC",
      "remove DUSTC",
      "return_to_issuer SPTA",
      "remove SPTA",
      "data dustin.fixture",
      "path_payment DUSTA",
      "remove DUSTA",
      "merge",
    ]);
    expect(r.units.map((u) => [u.phase, u.steps.length])).toEqual([
      ["cleanup", 1],
      ["cleanup", 1],
      ["cleanup", 2],
      ["cleanup", 2],
      ["cleanup", 2],
      ["cleanup", 1],
      ["convert", 2],
      ["merge", 1],
    ]);
  });

  it("never lets a step depend on a later one, and the merge depends on every removal", () => {
    const all = steps(orderClose(base, opts));
    const position = new Map(all.map((s, i) => [s.id, i]));
    for (const s of all)
      for (const d of s.dependsOn) expect(position.get(d)!).toBeLessThan(position.get(s.id)!);
    const merge = all.at(-1)!;
    const removals = all.filter(
      (s) => s.kind === "remove_trustline" || s.kind === "remove_data" || s.kind === "cancel_offer",
    );
    expect(merge.dependsOn).toEqual(expect.arrayContaining(removals.map((s) => s.id)));
    expect(merge.threshold).toBe("high");
  });

  it("removes a sponsored trustline like any other and attributes its reserve to the sponsor", () => {
    const spta = steps(orderClose(base, opts)).find(
      (s) =>
        s.kind === "remove_trustline" &&
        s.subject.type === "trustline" &&
        s.subject.asset.code === "SPTA",
    )!;
    expect(spta.operation).toEqual({
      type: "changeTrust",
      asset: spta.subject.type === "trustline" ? spta.subject.asset : null,
      limit: "0",
    });
    expect(spta.reserveReleasedTo).toEqual({ to: "sponsor", sponsor: messy.reserveSponsor });
    expect(spta.reason).toContain(messy.reserveSponsor);
  });

  it("cancels offers with their own assets and price, amount 0", () => {
    const cancel = steps(orderClose(base, opts))[0]!;
    expect(cancel.operation).toMatchObject({
      type: "manageSellOffer",
      offerId: "826680",
      amount: "0",
      price: { n: 100, d: 1 },
    });
  });

  it("has a non-empty reason on every step", () => {
    for (const s of steps(orderClose(base, opts))) expect(s.reason.length).toBeGreaterThan(20);
  });

  it("puts the merge into the cleanup when no path payment exists", () => {
    const s = copy(base);
    s.quotes.find((q) => q.asset.code === "DUSTA")!.quote = null;
    const r = orderClose(s, opts);
    expect(r.units.map((u) => u.phase)).not.toContain("convert");
    expect(r.units.at(-1)!.phase).toBe("merge");
  });
});

describe("orderClose blockers and unclosable items", () => {
  const codes = (r: OrderResult) => [
    ...r.blockers.map((b) => b.code),
    ...r.unclosable.map((u) => u.code),
  ];

  it("reports a frozen balance, keeps the rest of the cleanup and drops the merge", () => {
    const s = copy(base);
    // A frozen line reports both flags false (day-1 experiment 13); an authorized line reports both true.
    Object.assign(
      s.trustlines.find((t) => t.asset.code === "DUSTB")!,
      {
        authorized: false,
        authorizedToMaintainLiabilities: false,
      },
    );
    const r = orderClose(s, opts);
    expect(r.status).toBe("partial");
    expect(codes(r)).toEqual(["TRUSTLINE_NOT_AUTHORIZED"]);
    const kinds = steps(r).map(describeStep);
    expect(kinds).not.toContain("merge");
    expect(kinds).not.toContain("remove DUSTB");
    expect(kinds).toContain("cancel 826681"); // the offer buying DUSTB is still cancelled
    expect(r.unclosable[0]!.remedy.length).toBeGreaterThan(10);
  });

  it("detects merge blockers with remedies", () => {
    const s = copy(base);
    s.flags.authImmutable = true;
    s.numSponsoring = 1;
    s.claimableBalancesSponsored = 1;
    const r = orderClose(s, opts);
    expect(r.status).toBe("blocked");
    expect(codes(r)).toEqual(expect.arrayContaining(["AUTH_IMMUTABLE_SET", "IS_SPONSOR"]));
    expect(r.blockers.find((b) => b.code === "IS_SPONSOR")!.reason).toMatch(/claimable/);
    for (const b of r.blockers) expect(b.remedy.length).toBeGreaterThan(10);
    expect(steps(r).map(describeStep)).not.toContain("merge");
  });

  it("detects thresholds the master key cannot meet", () => {
    const high = copy(base);
    high.thresholds.high = 2;
    const r1 = orderClose(high, opts);
    expect(codes(r1)).toContain("THRESHOLD_UNMET");
    expect(steps(r1).length).toBeGreaterThan(0); // cleanup (medium) is still signable
    const medium = copy(base);
    medium.thresholds.medium = 2;
    medium.thresholds.high = 2;
    expect(steps(orderClose(medium, opts))).toEqual([]);
    const disabled = copy(base);
    disabled.masterWeight = 0;
    const r3 = orderClose(disabled, opts);
    expect(codes(r3)).toContain("MASTER_KEY_DISABLED");
    expect(steps(r3)).toEqual([]);
  });

  it("detects destination problems", () => {
    const missing = copy(base);
    missing.destination!.exists = false;
    expect(codes(orderClose(missing, opts))).toContain("DESTINATION_MISSING");
    const memo = copy(base);
    memo.destination!.memoRequired = true;
    expect(codes(orderClose(memo, opts))).toContain("DESTINATION_REQUIRES_MEMO");
    expect(codes(orderClose(memo, { ...opts, memo: "42" }))).not.toContain(
      "DESTINATION_REQUIRES_MEMO",
    );
    const self = copy(base);
    self.destination!.baseAccount = self.account;
    expect(codes(orderClose(self, opts))).toContain("DESTINATION_IS_SELF");
  });

  it("blocks the merge on pool shares and reports the pool's asset trustlines as unclosable", () => {
    const s = copy(base);
    const dustc = s.trustlines.find((t) => t.asset.code === "DUSTC")!;
    s.poolShares.push({
      poolId: "ab".repeat(32),
      balance: "1.0000000",
      sponsor: null,
      assets: ["native", `DUSTC:${dustc.asset.issuer}`],
    });
    const r = orderClose(s, opts);
    expect(r.status).toBe("blocked");
    expect(codes(r)).toEqual(
      expect.arrayContaining(["LIQUIDITY_POOL_SHARES", "POOL_ASSET_TRUSTLINE"]),
    );
    const kinds = steps(r).map(describeStep);
    expect(kinds).not.toContain("remove DUSTC");
    expect(kinds).not.toContain("return_to_issuer DUSTC");
  });

  it("removes a zero-balance trustline even when it is not authorized", () => {
    const s = copy(base);
    Object.assign(
      s.trustlines.find((t) => t.asset.code === "DUSTB")!,
      { authorized: false, balance: "0.0000000" },
    );
    const r = orderClose(s, opts);
    expect(steps(r).map(describeStep)).toContain("remove DUSTB");
    expect(r.status).toBe("closable");
  });
});
