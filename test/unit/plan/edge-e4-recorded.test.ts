import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { containsSecretSeed } from "../../../src/errors/redact.js";
import type { EdgeVariantRole } from "../../../src/fixture/edge.js";
import { inspectAccount } from "../../../src/inspect/inspect.js";
import type { ClosePlan } from "../../../src/plan/model.js";
import { planClose } from "../../../src/plan/plan-close.js";
import { EDGE_E4_DIR, edgeManifest, edgeRecordedReader } from "../../helpers/edge-ledger.js";

// The rows E4-S3 added to the edge profile, at the planner and offline (docs/edge-cases-and-test-
// matrix.md section 4): X-03, X-07, X-08 and X-11, planned from the Horizon JSON recorded right
// after the live build edge-20260928T205933Z-3a366d (test/fixtures/horizon/edge-e4/), with GET
// requests only.

const manifest = edgeManifest(EDGE_E4_DIR);
const a = manifest.accounts;

async function plan(role: EdgeVariantRole): Promise<ClosePlan> {
  const { reader } = edgeRecordedReader({}, EDGE_E4_DIR);
  return planClose(
    { account: a[role], destination: a.destination, feeSponsor: a.sponsor },
    { reader },
  );
}
const kinds = (p: ClosePlan) => p.steps.map((s) => s.kind);
const credit = (code: string) => ({ type: "credit_alphanum4", code, issuer: a.plainIssuer });

describe("the recorded edge fixture of E4-S3 at the planner", () => {
  it("plans every variant, the thirteen of the current recipe, exactly as the manifest expects, with GET requests only", async () => {
    expect(manifest.variants).toHaveLength(13);
    for (const v of manifest.variants) {
      const { reader, requests } = edgeRecordedReader({}, EDGE_E4_DIR);
      const p = await planClose(
        { account: v.account, destination: a.destination, feeSponsor: a.sponsor },
        { reader },
      );
      expect(
        {
          status: p.status,
          blockers: p.blockers.map((b) => b.code),
          unclosable: p.unclosable.map((u) => u.code),
          steps: kinds(p),
        },
        v.name,
      ).toEqual(v.expected);
      expect(
        requests.filter((r) => r.method !== "GET"),
        v.name,
      ).toEqual([]);
    }
  });

  it("holds public data only: no seed in any recorded file, and zero spendable XLM on every variant", () => {
    for (const file of readdirSync(EDGE_E4_DIR)) {
      expect(containsSecretSeed(readFileSync(join(EDGE_E4_DIR, file), "utf8")), file).toBe(false);
    }
    for (const v of manifest.variants) expect(v.spendable, v.name).toBe("0.0000000");
  });
});

describe("X-07: offer types (recorded)", () => {
  it("X-07 (recorded): cancels the buy offer, the passive offer and the offer selling XLM with manageSellOffer amount 0, each with its own assets and price as Horizon lists it", async () => {
    const p = await plan("offerTypes");
    expect(p.status).toBe("closable");
    const cancels = p.steps.filter((s) => s.kind === "cancel_offer").map((s) => s.operation);
    expect(cancels).toEqual([
      {
        type: "manageSellOffer",
        offerId: "835929",
        selling: { type: "native" },
        buying: credit("OFA"),
        amount: "0",
        price: { n: 1, d: 1 },
      },
      // The buy offer (buy 0.0000002 XLM at 2 OFB per XLM) as Horizon stores it: selling OFB, 1/2.
      {
        type: "manageSellOffer",
        offerId: "835930",
        selling: credit("OFB"),
        buying: { type: "native" },
        amount: "0",
        price: { n: 1, d: 2 },
      },
      // The passive offer: a cancellation needs no passive flag, only the offer id.
      {
        type: "manageSellOffer",
        offerId: "835931",
        selling: credit("OFA"),
        buying: credit("OFB"),
        amount: "0",
        price: { n: 1, d: 1 },
      },
    ]);
  });

  it("X-07 (recorded): spendable is computed net of the XLM selling liability, so the account holds zero spendable above its minimum", async () => {
    const p = await plan("offerTypes");
    expect(p.reserve).toEqual({
      balance: "3.5000010",
      minimum: "3.5000000",
      spendable: "0.0000000",
      baseReserve: "0.5000000",
    });
    const { reader } = edgeRecordedReader({}, EDGE_E4_DIR);
    const s = await inspectAccount(a.offerTypes, { destination: a.destination, reader });
    if (!s.exists) throw new Error("offer-types missing");
    expect(s.native.sellingLiabilities).toBe("0.0000010");
    // Everything goes in one fee-bumped transaction: the cancellations first, then the burns and
    // removals, then the merge, which carries the 3.5000010 XLM to the destination.
    expect(p.transactions).toHaveLength(1);
    expect(p.recovery.xlmToDestination).toBe("3.5000010");
  });
});

describe("X-11: the account's own offer is the only liquidity (recorded)", () => {
  it("X-11 (recorded): Horizon quotes OFA to XLM only through the account's own offer selling XLM for OFA; the planner rules the sale out and returns OFA to its issuer", async () => {
    const { reader } = edgeRecordedReader({}, EDGE_E4_DIR);
    const s = await inspectAccount(a.offerTypes, { destination: a.destination, reader });
    if (!s.exists) throw new Error("offer-types missing");
    expect(s.quotes.find((q) => q.asset.code === "OFA")?.quote).toEqual({
      sourceAmount: "0.0000003",
      destinationAmount: "0.0000003",
      path: [],
    });
    const p = await plan("offerTypes");
    const ofa = p.steps.find(
      (st) =>
        st.kind === "dispose_balance" &&
        st.subject.type === "trustline" &&
        st.subject.asset.code === "OFA",
    )!;
    expect(ofa.disposal).toMatchObject({ rung: "return_to_issuer", to: a.plainIssuer });
    expect(ofa.disposal!.ruledOut[0]).toEqual({
      rung: "path_payment",
      reason:
        "the quoted path may use this account's own offer 835929, which the plan cancels first",
    });
    // The offer that could have filled the sale is cancelled before the burn, in the same transaction.
    const ids = p.steps.map((st) => st.id);
    const cancel = p.steps.find(
      (st) => st.subject.type === "offer" && st.subject.offerId === "835929",
    )!;
    expect(ids.indexOf(cancel.id)).toBeLessThan(ids.indexOf(ofa.id));
    expect(cancel.txIndex).toBe(ofa.txIndex);
  });
});

describe("X-08: the stale offer's plan (recorded)", () => {
  it("X-08 (recorded): offer-stale plans the cancellation of its OFC offer, the return of OFC to its issuer, the removal and the merge in one transaction", async () => {
    const p = await plan("offerStale");
    expect(p.status).toBe("closable");
    expect(p.transactions).toHaveLength(1);
    expect(p.steps.map((s) => s.operation.type)).toEqual([
      "manageSellOffer",
      "payment",
      "changeTrust",
      "accountMerge",
    ]);
    expect(p.steps[0]!.operation).toMatchObject({ offerId: "835932", amount: "0" });
  });
});

describe("X-03: claimable balances claimable by the account (recorded)", () => {
  it("X-03 (recorded): the claimant's plan is closable, a merge alone, and warns about the two balances that name it", async () => {
    const p = await plan("claimant");
    expect(p.status).toBe("closable");
    expect(kinds(p)).toEqual(["merge"]);
    expect(p.warnings).toEqual([
      `This account is a claimant of 2 claimable balances: 1 of CBA issued by ${a.plainIssuer} (0.0000002 CBA) and 1 of XLM (0.0000001 XLM); ` +
        "ids 00000000aec5198b1d7be01d746656c19365387922fc2b4bed090c2cbe2dbb07e9e8942d, 00000000e03686dc54488f51d0bf6f6a735303a29962a3e40867420516b3d805441a6fee. " +
        "The merge does not touch them: they stay on the ledger, and after the merge this account can no longer claim them unless it is created again; any other claimant their predicates allow can still claim them. " +
        "To keep them, claim them before the close (ClaimClaimableBalance, sourced by this account, with a trustline for an asset other than XLM); claimable balance cleanup is out of scope.",
    ]);
  });

  it("X-03 (recorded): the inspector carries what the claimant page lists: id, asset, amount and the sponsor that pays each reserve", async () => {
    const { reader, requests } = edgeRecordedReader({}, EDGE_E4_DIR);
    const s = await inspectAccount(a.claimant, { destination: a.destination, reader });
    if (!s.exists) throw new Error("claimant missing");
    expect(s.claimableBalancesClaimable).toEqual([
      {
        id: "00000000aec5198b1d7be01d746656c19365387922fc2b4bed090c2cbe2dbb07e9e8942d",
        asset: `CBA:${a.plainIssuer}`,
        amount: "0.0000002",
        sponsor: a.plainIssuer,
      },
      {
        id: "00000000e03686dc54488f51d0bf6f6a735303a29962a3e40867420516b3d805441a6fee",
        asset: "native",
        amount: "0.0000001",
        sponsor: a.plainIssuer,
      },
    ]);
    expect(requests).toContainEqual({
      method: "GET",
      path: `/claimable_balances?claimant=${a.claimant}&limit=200`,
    });
  });

  it("warns on no other variant: none of them is named as a claimant", async () => {
    for (const v of manifest.variants.filter((x) => x.role !== "claimant")) {
      const p = await plan(v.role);
      expect(p.warnings.join(" "), v.name).not.toMatch(/claimant of/);
    }
  });
});
