import { beforeAll, describe, expect, it } from "vitest";
import type { ExistingAccountSnapshot, TrustlineInfo } from "../../../src/inspect/snapshot.js";
import { chooseRung } from "../../../src/plan/ladder.js";
import { copy, messy, messySnapshot } from "../../helpers/snapshots.js";

let base: ExistingAccountSnapshot;
beforeAll(async () => {
  base = await messySnapshot();
});

const line = (s: ExistingAccountSnapshot, code: string): TrustlineInfo =>
  s.trustlines.find((t) => t.asset.code === code)!;
const defaults = { order: "sow" as const, slippageBps: 100, memo: null };

describe("chooseRung on the recorded fixture", () => {
  it("sells DUSTA by path payment to the account itself with destMin below the quote", () => {
    const r = chooseRung(base, line(base, "DUSTA"), defaults);
    if (!r.ok) throw new Error(r.reason);
    expect(r.decision).toMatchObject({
      rung: "path_payment",
      amount: "0.0000007",
      to: messy.fixture,
      quotedXlm: "0.0000007",
      destMinXlm: "0.0000007",
      fallbackRungs: ["return_to_issuer", "send_to_destination"].filter(
        (x) => x === "return_to_issuer",
      ),
    });
  });

  it("returns DUSTB and SPTA to the issuer because no path exists", () => {
    for (const code of ["DUSTB", "SPTA"]) {
      const r = chooseRung(base, line(base, code), defaults);
      if (!r.ok) throw new Error(r.reason);
      expect(r.decision.rung).toBe("return_to_issuer");
      expect(r.decision.to).toBe(messy.issuer);
      expect(r.decision.ruledOut.map((x) => x.rung)).toContain("path_payment");
    }
  });

  it("keeps the SOW order for DUSTC but sends it to the destination with prefer-destination", () => {
    const sow = chooseRung(base, line(base, "DUSTC"), defaults);
    const pref = chooseRung(base, line(base, "DUSTC"), {
      ...defaults,
      order: "prefer-destination",
    });
    if (!sow.ok || !pref.ok) throw new Error("expected routes");
    expect(sow.decision.rung).toBe("return_to_issuer");
    expect(sow.decision.fallbackRungs).toEqual(["send_to_destination"]);
    expect(pref.decision.rung).toBe("send_to_destination");
    expect(pref.decision.to).toBe(messy.destination);
    expect(pref.decision.fallbackRungs).toEqual(["return_to_issuer"]);
  });

  it("never lets destMin fall below one stroop", () => {
    const s = copy(base);
    s.quotes.find((q) => q.asset.code === "DUSTA")!.quote!.destinationAmount = "0.0000001";
    const r = chooseRung(s, line(s, "DUSTA"), defaults);
    if (!r.ok) throw new Error(r.reason);
    expect(r.decision.destMinXlm).toBe("0.0000001");
  });
});

describe("chooseRung edge cases", () => {
  it("reports a deauthorized trustline as unclosable, naming the issuer", () => {
    const s = copy(base);
    Object.assign(line(s, "DUSTB"), { authorized: false, authorizedToMaintainLiabilities: false });
    const r = chooseRung(s, line(s, "DUSTB"), defaults);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("TRUSTLINE_NOT_AUTHORIZED");
    expect(r.reason).toContain(messy.issuer);
    expect(r.remedy).toMatch(/authorize|claw/);
  });

  it("distinguishes authorized-to-maintain-liabilities", () => {
    const s = copy(base);
    Object.assign(line(s, "DUSTB"), { authorized: false, authorizedToMaintainLiabilities: true });
    const r = chooseRung(s, line(s, "DUSTB"), defaults);
    expect(r.ok ? "ok" : r.code).toBe("MAINTAIN_LIABILITIES_ONLY");
  });

  it("still burns when the issuer account was merged away (day-1 experiment 4)", () => {
    const s = copy(base);
    s.issuers[0]!.exists = false;
    const r = chooseRung(s, line(s, "DUSTB"), defaults);
    if (!r.ok) throw new Error(r.reason);
    expect(r.decision.rung).toBe("return_to_issuer");
  });

  it("rules out a memo-required issuer without a memo and falls to the destination or unclosable", () => {
    const s = copy(base);
    s.issuers[0]!.memoRequired = true;
    const c = chooseRung(s, line(s, "DUSTC"), defaults);
    if (!c.ok) throw new Error(c.reason);
    expect(c.decision.rung).toBe("send_to_destination");
    const b = chooseRung(s, line(s, "DUSTB"), defaults);
    expect(b.ok ? "ok" : b.code).toBe("NO_DISPOSAL_ROUTE");
    const withMemo = chooseRung(s, line(s, "DUSTB"), { ...defaults, memo: "123" });
    expect(withMemo.ok && withMemo.decision.rung).toBe("return_to_issuer");
  });

  it("checks the destination trustline's authorization and room", () => {
    const s = copy(base);
    s.destination!.trustlines[0]!.limit = "0.0000001";
    const pref = chooseRung(s, line(s, "DUSTC"), { ...defaults, order: "prefer-destination" });
    if (!pref.ok) throw new Error(pref.reason);
    expect(pref.decision.rung).toBe("return_to_issuer");
    expect(pref.decision.ruledOut.find((x) => x.rung === "send_to_destination")?.reason).toMatch(
      /room/,
    );
  });

  it("does not trust a quote that may run through the account's own offer", () => {
    const s = copy(base);
    // An own offer selling XLM for DUSTA is exactly the liquidity a DUSTA -> XLM sale consumes.
    s.offers.push({
      id: "999",
      selling: { type: "native" },
      buying: line(s, "DUSTA").asset,
      amount: "1.0000000",
      price: { n: 1, d: 1 },
      sponsor: null,
      lastModifiedLedger: null,
    });
    const r = chooseRung(s, line(s, "DUSTA"), defaults);
    if (!r.ok) throw new Error(r.reason);
    expect(r.decision.rung).toBe("return_to_issuer");
    expect(r.decision.ruledOut.find((x) => x.rung === "path_payment")?.reason).toMatch(
      /own offer 999/,
    );
  });
});
