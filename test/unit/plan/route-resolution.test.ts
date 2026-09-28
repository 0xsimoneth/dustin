import { beforeAll, describe, expect, it } from "vitest";
import { inspectAccount } from "../../../src/inspect/inspect.js";
import type { ExistingAccountSnapshot } from "../../../src/inspect/snapshot.js";
import type { CloseStep } from "../../../src/plan/model.js";
import { planFromSnapshot } from "../../../src/plan/plan.js";
import { horizonJson } from "../../../src/reader/horizon-json.js";
import { horizonReader, type LedgerReader } from "../../../src/reader/ledger-reader.js";
import {
  MESSY_DIR,
  TESTNET_HORIZON,
  loadRecorded,
  recordedFetch,
} from "../../helpers/recorded-horizon.js";
import { copy, messy, messySnapshot } from "../../helpers/snapshots.js";

// Story E2-S5 (live disposal-route resolution), the parts of AC-E2-S5-3 and task 7 that had no
// test of their own (docs/stories/2-5-disposal-route-resolution.md, tasks 5 to 7). A payment to an
// issuer whose account was merged away still burns the balance (day-1 experiment 4,
// docs/progress-log.md; docs/README.md open question 3), so the merged issuer changes the reason,
// not the route.

let base: ExistingAccountSnapshot;
beforeAll(async () => {
  base = await messySnapshot();
});

const plan = (s: ExistingAccountSnapshot, extra: { preferDestination?: boolean } = {}) =>
  planFromSnapshot(s, {
    destination: messy.destination,
    feeSponsor: messy.sponsor,
    baseFeeStroops: 100,
    ...extra,
  });
const disposalOf = (steps: CloseStep[], code: string) =>
  steps.find(
    (s) =>
      s.kind === "dispose_balance" &&
      s.subject.type === "trustline" &&
      s.subject.asset.code === code,
  );

describe("E2-S5 AC-3: a merged issuer and a destination that trusts the asset", () => {
  it("burns by default, keeps the destination as the fallback and says the issuer is gone", () => {
    const s = copy(base);
    s.issuers.forEach((i) => (i.exists = false));
    const p = plan(s);
    const dustc = disposalOf(p.steps, "DUSTC")!;
    expect(dustc.disposal).toMatchObject({
      rung: "return_to_issuer",
      to: messy.issuer,
      fallbackRungs: ["send_to_destination"],
    });
    expect(dustc.reason).toContain(
      "The issuer account no longer exists; a payment to it still burns the balance (verified on testnet, 2026-09-26).",
    );
    expect(dustc.operation).toMatchObject({ type: "payment", destination: messy.issuer });
    expect(p.status).toBe("closable");
  });

  it("sends the balance to the destination with prefer-destination, the burn as the fallback", () => {
    const s = copy(base);
    s.issuers.forEach((i) => (i.exists = false));
    const p = plan(s, { preferDestination: true });
    expect(p.ladderOrder).toBe("prefer-destination");
    const dustc = disposalOf(p.steps, "DUSTC")!;
    expect(dustc.disposal).toMatchObject({
      rung: "send_to_destination",
      to: messy.destination,
      fallbackRungs: ["return_to_issuer"],
    });
    expect(dustc.operation).toMatchObject({ type: "payment", destination: messy.destination });
    // The balances the destination does not trust still burn.
    expect(disposalOf(p.steps, "DUSTB")?.disposal?.rung).toBe("return_to_issuer");
  });
});

describe("E2-S5 AC-3: an item no route can dispose of names all three failed rungs", () => {
  it("lists every rung and why it failed, in the reason and in rungsRuledOut", () => {
    const s = copy(base);
    // No path for DUSTB already; a memo-required issuer without a memo rules out the burn, and the
    // destination holds no DUSTB trustline.
    s.issuers.forEach((i) => (i.memoRequired = true));
    const p = plan(s);
    const item = p.unclosable.find(
      (u) => u.subject.type === "trustline" && u.subject.asset.code === "DUSTB",
    );
    expect(item?.code).toBe("NO_DISPOSAL_ROUTE");
    expect(item?.rungsRuledOut?.map((r) => r.rung)).toEqual([
      "path_payment",
      "return_to_issuer",
      "send_to_destination",
    ]);
    for (const r of item?.rungsRuledOut ?? []) expect(r.reason.length).toBeGreaterThan(0);
    expect(item?.reason).toMatch(/path payment: .*return to issuer: .*send to destination: /);
    expect(item?.reason).toContain("requires a memo (SEP-29)");
    expect(item?.reason).toContain("holds no DUSTB trustline");
    expect(item?.remedy.length).toBeGreaterThan(0);
    expect(p.status).toBe("partial");
    expect(p.steps.some((step) => step.kind === "merge")).toBe(false);
    // DUSTC is trusted by the destination, so it still has a route.
    expect(disposalOf(p.steps, "DUSTC")?.disposal?.rung).toBe("send_to_destination");
  });
});

describe("E2-S5 task 7: the inspector's quote and the planned path", () => {
  /** The recorded fixture's reader, with the strict-send answers for DUSTA replaced. */
  function readerWithDustaPaths(records: unknown[]): LedgerReader {
    const { fetch } = recordedFetch(loadRecorded(MESSY_DIR));
    const reader = horizonReader(horizonJson(TESTNET_HORIZON, { fetch, retries: 0 }));
    return {
      ...reader,
      strictSendPathsToNative: (asset, amount) =>
        asset.code === "DUSTA"
          ? Promise.resolve(records as Awaited<ReturnType<LedgerReader["strictSendPathsToNative"]>>)
          : reader.strictSendPathsToNative(asset, amount),
    };
  }
  const hop = { asset_type: "credit_alphanum4", asset_code: "DUSTB", asset_issuer: messy.issuer };

  it("keeps the answer that pays the most XLM, skips one below a stroop, and plans its path", async () => {
    const reader = readerWithDustaPaths([
      { source_amount: "0.0000007", destination_amount: "0.0000000", path: [] },
      { source_amount: "0.0000007", destination_amount: "0.0000005", path: [] },
      { source_amount: "0.0000007", destination_amount: "0.0000009", path: [hop] },
    ]);
    const s = await inspectAccount(messy.fixture, { destination: messy.destination, reader });
    if (!s.exists) throw new Error("recorded fixture missing");
    const quote = s.quotes.find((q) => q.asset.code === "DUSTA");
    expect(quote?.quote).toMatchObject({
      destinationAmount: "0.0000009",
      path: [{ type: "credit_alphanum4", code: "DUSTB", issuer: messy.issuer }],
    });
    const p = plan(s);
    const dusta = disposalOf(p.steps, "DUSTA")!;
    expect(dusta.disposal).toMatchObject({ rung: "path_payment", quotedXlm: "0.0000009" });
    expect(dusta.operation).toMatchObject({
      type: "pathPaymentStrictSend",
      path: [{ type: "credit_alphanum4", code: "DUSTB", issuer: messy.issuer }],
    });
  });

  it("treats answers that all round to zero as no path, so the balance goes to its issuer", async () => {
    const reader = readerWithDustaPaths([
      { source_amount: "0.0000007", destination_amount: "0.0000000", path: [] },
    ]);
    const s = await inspectAccount(messy.fixture, { destination: messy.destination, reader });
    if (!s.exists) throw new Error("recorded fixture missing");
    const p = plan(s);
    expect(disposalOf(p.steps, "DUSTA")?.disposal?.rung).toBe("return_to_issuer");
  });
});
