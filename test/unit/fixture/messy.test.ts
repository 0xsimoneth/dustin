import { Keypair } from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";
import { toStroops } from "../../../src/amounts.js";
import { MESSY, messySteps } from "../../../src/fixture/messy.js";

const roles = {
  sponsor: Keypair.random().publicKey(),
  reserveSponsor: Keypair.random().publicKey(),
  issuer: Keypair.random().publicKey(),
  marketMaker: Keypair.random().publicKey(),
  destination: Keypair.random().publicKey(),
  fixture: Keypair.random().publicKey(),
};

describe("messy recipe", () => {
  it("meets SOW Appendix B by construction", () => {
    expect(MESSY.assets.filter((a) => toStroops(a.dust) > 0n).length).toBeGreaterThanOrEqual(3);
    expect(MESSY.offers.length).toBeGreaterThanOrEqual(1);
    expect(MESSY.dataEntry.name.length).toBeGreaterThan(0);
  });

  it("has 4 trustlines, 1 of them sponsored, 2 offers and 1 data entry", () => {
    expect(MESSY.assets).toHaveLength(4);
    expect(MESSY.assets.filter((a) => a.sponsored)).toHaveLength(1);
    expect(MESSY.offers).toHaveLength(2);
    expect(MESSY.expected.subentryCount).toBe(7);
    expect(MESSY.expected.numSponsored).toBe(1);
  });

  it("never sells XLM, so native selling liabilities stay 0", () => {
    for (const offer of MESSY.offers) expect(offer.selling).not.toBe("native");
  });

  it("prices the fixture's own DUSTA offer above the market maker's bid so it cannot fill", () => {
    const own = MESSY.offers.find(
      (o) => o.selling === MESSY.marketMakerBid.asset && o.buying === "native",
    );
    expect(own).toBeDefined();
    expect(Number(own!.price)).toBeGreaterThan(Number(MESSY.marketMakerBid.price));
  });

  it("keeps each offer within the dust it sells", () => {
    for (const offer of MESSY.offers) {
      const asset = MESSY.assets.find((a) => a.code === offer.selling)!;
      expect(toStroops(offer.amount)).toBeLessThanOrEqual(toStroops(asset.dust));
    }
  });

  it("builds ordered steps whose fixture-sourced transactions are fee-bumped", () => {
    const steps = messySteps(roles);
    expect(steps.map((s) => s.name)).toEqual([
      "create-accounts",
      "trustlines",
      "sponsored-trustline",
      "dust-payments",
      "market-maker-bid",
      "offers-and-data",
    ]);
    for (const step of steps.filter((s) => s.source !== "sponsor"))
      expect(step.feeBumped).toBe(true);
    const sandwich = steps.find((s) => s.name === "sponsored-trustline")!;
    expect(sandwich.signers).toEqual(expect.arrayContaining(["fixture", "reserveSponsor"]));
    expect(sandwich.signers).not.toContain("sponsor");
    const opCount = steps.reduce((n, s) => n + s.operations.length, 0);
    expect(opCount).toBe(5 + 5 + 3 + 4 + 1 + 3);
  });
});
