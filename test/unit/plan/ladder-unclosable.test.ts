import { beforeAll, describe, expect, it } from "vitest";
import type { ExistingAccountSnapshot, TrustlineInfo } from "../../../src/inspect/snapshot.js";
import { chooseRung } from "../../../src/plan/ladder.js";
import type { ClosePlan, CloseStep, UnclosableItem } from "../../../src/plan/model.js";
import { planFromSnapshot } from "../../../src/plan/plan.js";
import { copy, messy, messySnapshot } from "../../helpers/snapshots.js";

/**
 * Story E3-S2 at the planner: the destination transfer (rung 3), the order option of canonical
 * decision 8, and balances no rung can dispose of (AC-E3-S2-3, AC-E3-S2-4), with matrix rows X-06
 * (destination trustline states) and X-11 (the account's own offers are the only liquidity).
 */

let base: ExistingAccountSnapshot;
beforeAll(async () => {
  base = await messySnapshot();
});

const line = (s: ExistingAccountSnapshot, code: string): TrustlineInfo =>
  s.trustlines.find((t) => t.asset.code === code)!;
const disposalOf = (plan: ClosePlan, code: string): CloseStep | undefined =>
  plan.steps.find(
    (s) =>
      s.kind === "dispose_balance" &&
      s.subject.type === "trustline" &&
      s.subject.asset.code === code,
  );
const itemOf = (plan: ClosePlan, code: string): UnclosableItem | undefined =>
  plan.unclosable.find((u) => u.subject.type === "trustline" && u.subject.asset.code === code);
const options = (extra: { preferDestination?: boolean; memo?: string } = {}) => ({
  destination: messy.destination,
  feeSponsor: messy.sponsor,
  ...extra,
});
/** The recorded issuer turned SEP-29 memo-required (config.memo_required = "1"). */
const memoRequiredIssuer = (s: ExistingAccountSnapshot) => {
  s.issuers.find((i) => i.account === messy.issuer)!.memoRequired = true;
  return s;
};
const destinationLine = (s: ExistingAccountSnapshot, code: string) =>
  s.destination!.trustlines.find((t) => t.asset.code === code)!;

describe("AC-E3-S2-3 (planner): an item no route can dispose of", () => {
  it("AC-E3-S2-3: a memo-required issuer without a memo leaves DUSTB and SPTA with no route; DUSTC goes to the destination", () => {
    const plan = planFromSnapshot(memoRequiredIssuer(copy(base)), options());

    expect(plan.status).toBe("partial");
    expect(plan.steps.some((s) => s.kind === "merge")).toBe(false);
    expect(disposalOf(plan, "DUSTA")!.disposal!.rung).toBe("path_payment");
    // Rung 2 is ruled out, so the SOW order reaches rung 3 for the asset the destination trusts.
    const dustc = disposalOf(plan, "DUSTC")!.disposal!;
    expect(dustc).toMatchObject({ rung: "send_to_destination", to: messy.destination });
    expect(dustc.ruledOut.map((r) => r.rung)).toEqual(["path_payment", "return_to_issuer"]);
    expect(dustc.ruledOut[0]!.reason).toMatch(/no strict-send path/);
    expect(dustc.ruledOut[1]!.reason).toMatch(/requires a memo \(SEP-29\)/);
    for (const code of ["DUSTB", "SPTA"]) {
      const item = itemOf(plan, code)!;
      expect(item.code).toBe("NO_DISPOSAL_ROUTE");
      expect(item.rungsRuledOut?.map((r) => r.rung)).toEqual([
        "path_payment",
        "return_to_issuer",
        "send_to_destination",
      ]);
      expect(item.rungsRuledOut![2]!.reason).toBe(`the destination holds no ${code} trustline`);
      // The reason lists every rung; the remedy names a fix for each.
      expect(item.reason).toMatch(/path payment: .*; return to issuer: .*; send to destination: /);
      expect(item.remedy).toMatch(/^Make one route possible, then run the plan again: /);
      expect(item.remedy).toContain(`pass the memo that issuer ${messy.issuer} requires (--memo`);
      expect(item.remedy).toContain(
        `open a ${code}:${messy.issuer} trustline on the destination account ${messy.destination}`,
      );
      expect(item.remedy).toContain(`a market that buys ${code} for XLM`);
    }
    // Their trustlines stay; everything else is planned.
    const removed = plan.steps
      .filter((s) => s.kind === "remove_trustline")
      .map((s) => (s.subject.type === "trustline" ? s.subject.asset.code : s.subject.type));
    expect(removed).toEqual(["DUSTC", "DUSTA"]);
  });

  it("AC-E3-S2-3: a memo reopens the return to the issuer", () => {
    const plan = planFromSnapshot(memoRequiredIssuer(copy(base)), options({ memo: "dust-123" }));
    expect(plan.status).toBe("closable");
    for (const code of ["DUSTB", "DUSTC", "SPTA"])
      expect(disposalOf(plan, code)!.disposal!.rung).toBe("return_to_issuer");
  });
});

describe("AC-E3-S2-4 (planner): a destination trustline without room", () => {
  it("AC-E3-S2-4: falls back to the burn when the destination rung has no room", () => {
    const s = copy(base);
    destinationLine(s, "DUSTC").limit = "0.0000004";
    const plan = planFromSnapshot(s, options({ preferDestination: true }));
    const dustc = disposalOf(plan, "DUSTC")!;
    expect(dustc.disposal!.rung).toBe("return_to_issuer");
    expect(dustc.disposal!.ruledOut.find((r) => r.rung === "send_to_destination")?.reason).toBe(
      "the destination's DUSTC trustline has no room for 0.0000005",
    );
    expect(plan.status).toBe("closable");
  });

  it("AC-E3-S2-4: with no rung left, the remedy says: raise the destination's trustline limit for DUSTC", () => {
    const s = memoRequiredIssuer(copy(base));
    destinationLine(s, "DUSTC").limit = "0.0000004";
    const r = chooseRung(s, line(s, "DUSTC"), { order: "sow", slippageBps: 100, memo: null });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("NO_DISPOSAL_ROUTE");
    expect(r.remedy).toContain(
      "raise the destination's trustline limit for DUSTC (it has room for 0.0000004 of the 0.0000005 to send)",
    );
    expect(r.ruledOut.map((x) => x.rung)).toEqual([
      "path_payment",
      "return_to_issuer",
      "send_to_destination",
    ]);
  });
});

describe("X-06 (planner): destination trustline states", () => {
  // DST holds DUSTC authorized with an ample limit; DST-L holds it with limit = balance (no room);
  // DST-U holds it unauthorized. Rung 3 is chosen only for the first, with --prefer-destination;
  // the others fall to the burn with the stated reason.
  const states: Array<[string, (s: ExistingAccountSnapshot) => void, string, RegExp | null]> = [
    ["authorized, ample limit", () => undefined, "send_to_destination", null],
    [
      "limit equal to its balance",
      (s) => Object.assign(destinationLine(s, "DUSTC"), { balance: "1000.0000000" }),
      "return_to_issuer",
      /has no room for 0\.0000005/,
    ],
    [
      "not authorized",
      (s) => Object.assign(destinationLine(s, "DUSTC"), { authorized: false }),
      "return_to_issuer",
      /trustline is not authorized/,
    ],
  ];
  for (const [name, change, rung, why] of states) {
    it(`X-06: a destination DUSTC trustline ${name} gives ${rung}`, () => {
      const s = copy(base);
      change(s);
      const plan = planFromSnapshot(s, options({ preferDestination: true }));
      const dustc = disposalOf(plan, "DUSTC")!;
      expect(plan.ladderOrder).toBe("prefer-destination");
      expect(dustc.disposal!.rung).toBe(rung);
      if (why) {
        expect(
          dustc.disposal!.ruledOut.find((r) => r.rung === "send_to_destination")?.reason,
        ).toMatch(why);
      }
    });
  }
});

describe("X-11 (planner): the account's own offers are the only liquidity", () => {
  it("X-11: a quote that only the account's own offer can fill is not trusted, so DUSTA is burned", () => {
    const s = copy(base);
    // The only DUSTA -> XLM liquidity is this account's own offer selling XLM for DUSTA, which
    // the plan cancels first (edge case B-24). A planner that trusted /paths would plan a sale
    // that fails with op_too_few_offers once the offer is gone (op_cross_self if it were not).
    s.offers.push({
      id: "999",
      selling: { type: "native" },
      buying: line(s, "DUSTA").asset,
      amount: "0.0000007",
      price: { n: 1, d: 1 },
      sponsor: null,
      lastModifiedLedger: null,
    });
    const plan = planFromSnapshot(s, options());
    const dusta = disposalOf(plan, "DUSTA")!;
    expect(dusta.disposal!.rung).toBe("return_to_issuer");
    expect(dusta.disposal!.ruledOut.find((r) => r.rung === "path_payment")?.reason).toMatch(
      /own offer 999/,
    );
    expect(plan.transactions.map((t) => t.phase)).toEqual(["cleanup"]);
    // The own offer is cancelled before the burn, in the same transaction.
    const cancel = plan.steps.find(
      (st) =>
        st.kind === "cancel_offer" && st.subject.type === "offer" && st.subject.offerId === "999",
    )!;
    expect(dusta.dependsOn).toContain(cancel.id);
  });
});
