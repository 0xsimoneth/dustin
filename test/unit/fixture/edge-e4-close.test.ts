import { FeeBumpTransaction, TransactionBuilder } from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";
import { formatStroops, toStroops } from "../../../src/amounts.js";
import { executeClose, type ExecuteOptions } from "../../../src/execute/executor.js";
import { horizonSubmitter } from "../../../src/execute/submit.js";
import type { EdgeVariantRole } from "../../../src/fixture/edge.js";
import { planClose } from "../../../src/plan/plan-close.js";
import { horizonJson, type FetchLike } from "../../../src/reader/horizon-json.js";
import { horizonReader } from "../../../src/reader/ledger-reader.js";
import type { Signer } from "../../../src/sponsor/signer.js";
import { EDGE_E4_DIR, edgeLedger } from "../../helpers/edge-ledger.js";
import type { FakeLedger } from "../../helpers/fake-ledger.js";
import { noSleep } from "../../helpers/no-sleep.js";
import { TESTNET_HORIZON } from "../../helpers/recorded-horizon.js";

// The offline twins of the live X-03, X-07 and X-08 tests: the edge fixture of E4-S3 as recorded
// right after its live build (test/fixtures/horizon/edge-e4/), closed on the fake ledger
// (test/helpers/fake-ledger.ts), which applies the protocol rules Dustin depends on and answers
// with Horizon's result codes. It checks no signature, so the signers need only the public keys.
// (In test/unit/fixture/ rather than test/unit/execute/, whose files belong to the executor's
// owner in this session.)

const TESTNET = "Test SDF Network ; September 2015";
const signerFor = (publicKey: string): Signer => ({
  publicKey: () => publicKey,
  sign: () => undefined,
});

/**
 * The recorded fixture behind a Horizon client. `beforeFirstPost` changes the fake ledger once,
 * right before the first envelope is posted: after the executor planned and signed, as the live
 * test's counterparty does (edge case C-04).
 */
function edge(beforeFirstPost?: (ledger: FakeLedger) => void) {
  const { ledger, manifest } = edgeLedger(EDGE_E4_DIR);
  let acted = false;
  const fetch: FetchLike = (url, init) => {
    if (beforeFirstPost && !acted && (init?.method ?? "GET") === "POST") {
      acted = true;
      beforeFirstPost(ledger);
    }
    return ledger.fetch(url, init);
  };
  const reader = horizonReader(horizonJson(TESTNET_HORIZON, { fetch, retries: 0 }));
  const deps: Partial<ExecuteOptions> = {
    reader,
    submitter: horizonSubmitter(TESTNET_HORIZON, { fetch }),
    sleep: noSleep,
  };
  const account = (role: EdgeVariantRole) => manifest.accounts[role];
  const plan = (role: EdgeVariantRole) =>
    planClose(
      {
        account: account(role),
        destination: manifest.accounts.destination,
        feeSponsor: manifest.accounts.sponsor,
      },
      { reader },
    );
  const run = async (role: EdgeVariantRole) =>
    executeClose(
      await plan(role),
      { account: signerFor(account(role)), feeSponsor: signerFor(manifest.accounts.sponsor) },
      { confirm: true, ...deps },
    );
  return { ledger, manifest, account, run };
}

/** Each submitted envelope's fee source, inner source and operation types. */
function submitted(xdrs: string[]) {
  return xdrs.map((xdr) => {
    const bump = TransactionBuilder.fromXDR(xdr, TESTNET);
    if (!(bump instanceof FeeBumpTransaction)) throw new Error("not a fee bump");
    return {
      feeSource: bump.feeSource,
      source: bump.innerTransaction.source,
      innerFee: bump.innerTransaction.fee,
      ops: bump.innerTransaction.operations.map((op) => op.type),
    };
  });
}

const native = (ledger: FakeLedger, id: string) => formatStroops(ledger.native(id));

describe("X-07 (recorded, offline): the offer-types account closes", () => {
  it("X-07 (recorded, offline): cancels the three offers, burns OFA and OFB, removes both trustlines and merges in one fee bump paid by the sponsor", async () => {
    const w = edge();
    const id = w.account("offerTypes");
    const before = native(w.ledger, w.manifest.accounts.destination);
    const report = await w.run("offerTypes");
    expect(report.status).toBe("closed");
    expect(report.verification).toMatchObject({ accountExists: false });
    expect(submitted(w.ledger.submissions)).toEqual([
      {
        feeSource: w.manifest.accounts.sponsor,
        source: id,
        innerFee: "0",
        ops: [
          "manageSellOffer",
          "manageSellOffer",
          "manageSellOffer",
          "payment",
          "changeTrust",
          "payment",
          "changeTrust",
          "accountMerge",
        ],
      },
    ]);
    expect(w.ledger.accounts.has(id)).toBe(false);
    // The destination receives the whole balance, the 0.0000010 XLM the offer locked included.
    expect(toStroops(native(w.ledger, w.manifest.accounts.destination)) - toStroops(before)).toBe(
      toStroops("3.5000010"),
    );
  });
});

describe("X-08 (recorded, offline): a stale offer filled between plan and execution", () => {
  /** The counterparty's fill as the ledger shows it afterwards: the offer gone, OFC sold for XLM. */
  const fill = (w: ReturnType<typeof edge>) => (ledger: FakeLedger) => {
    const id = w.account("offerStale");
    const account = ledger.accounts.get(id)!;
    ledger.offers.set(id, []);
    account.subentry_count -= 1;
    const ofc = account.balances.find((b) => b.asset_code === "OFC")!;
    ofc.balance = "0.0000000";
    ofc.selling_liabilities = "0.0000000";
    const xlm = account.balances.find((b) => b.asset_type === "native")!;
    xlm.balance = formatStroops(toStroops(xlm.balance) + toStroops("0.0000005"));
  };

  it("X-08 (recorded, offline): the cancellation fails with op_offer_not_found, the executor re-plans without the offer and the account closes", async () => {
    const w = edge();
    const stale = edge(fill(w));
    const id = stale.account("offerStale");
    const destination = stale.manifest.accounts.destination;
    const before = native(stale.ledger, destination);
    const report = await stale.run("offerStale");
    expect(report.status).toBe("closed");
    expect(report.verification).toMatchObject({ accountExists: false });
    expect(report.transactions.map((t) => t.result)).toEqual(["failed", "applied"]);
    expect(report.transactions[0]!.resultCodes?.operations?.[0]).toBe("op_offer_not_found");
    expect(report.replans).toHaveLength(1);
    expect(report.replans[0]!.trigger.resultCodes.operations).toContain("op_offer_not_found");
    expect(report.replans[0]!.drift).toEqual([]);
    // The fresh plan has no offer to cancel and nothing to burn: the empty trustline goes, then the merge.
    expect(submitted(stale.ledger.submissions).map((s) => s.ops)).toEqual([
      ["manageSellOffer", "payment", "changeTrust", "accountMerge"],
      ["changeTrust", "accountMerge"],
    ]);
    for (const s of submitted(stale.ledger.submissions)) {
      expect(s).toMatchObject({
        feeSource: stale.manifest.accounts.sponsor,
        source: id,
        innerFee: "0",
      });
    }
    expect(stale.ledger.accounts.has(id)).toBe(false);
    // The merge carries the whole balance, the 0.0000005 XLM the counterparty paid included (the
    // fake ledger returns no result XDR, so the report's mergedXlm stays null offline).
    expect(toStroops(native(stale.ledger, destination)) - toStroops(before)).toBe(
      toStroops("2.0000005"),
    );
  });
});

describe("X-03 (recorded, offline): the claimant closes, and its claimable balances stay", () => {
  it("X-03 (recorded, offline): the merge closes the claimant, the report repeats the warning, and both balances still name it afterwards", async () => {
    const w = edge();
    const id = w.account("claimant");
    const ids = w.ledger.claimableBalances.map((b) => b.id).sort();
    expect(ids).toHaveLength(2);
    const report = await w.run("claimant");
    expect(report.status).toBe("closed");
    expect(report.warnings.join(" ")).toMatch(/This account is a claimant of 2 claimable balances/);
    expect(submitted(w.ledger.submissions).map((s) => s.ops)).toEqual([["accountMerge"]]);
    expect(w.ledger.accounts.has(id)).toBe(false);
    const after = (await (
      await w.ledger.fetch(`${TESTNET_HORIZON}/claimable_balances?claimant=${id}&limit=200`)
    ).json()) as { _embedded: { records: Array<{ id: string }> } };
    expect(after._embedded.records.map((b) => b.id).sort()).toEqual(ids);
  });
});
