import { Account, MuxedAccount } from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";
import { mergePreflight } from "../../../src/execute/preflight.js";
import type { ClosePlan } from "../../../src/plan/model.js";
import { planClose } from "../../../src/plan/plan-close.js";
import { horizonJson } from "../../../src/reader/horizon-json.js";
import { horizonReader } from "../../../src/reader/ledger-reader.js";
import { FakeLedger } from "../../helpers/fake-ledger.js";
import { TESTNET_HORIZON } from "../../helpers/recorded-horizon.js";
import { messy } from "../../helpers/snapshots.js";

const MEMO_REQUIRED = Buffer.from("1").toString("base64");
const muxed = (g: string) => new MuxedAccount(new Account(g, "0"), "42").accountId();

/** The fake ledger after the cleanup and the sale: only the merge is left to run. */
async function readyToMerge(destination = messy.destination, memo?: string) {
  const ledger = FakeLedger.messy();
  const reader = horizonReader(
    horizonJson(TESTNET_HORIZON, { fetch: ledger.fetch, retries: 0, backoffMs: 0 }),
  );
  const plan: ClosePlan = await planClose(
    {
      account: messy.fixture,
      destination,
      feeSponsor: messy.sponsor,
      ...(memo ? { memo } : {}),
    },
    { reader },
  );
  const account = ledger.accounts.get(messy.fixture)!;
  account.balances = account.balances.filter((b) => b.asset_type === "native");
  account.data = {};
  account.subentry_count = 0;
  account.num_sponsored = 0;
  ledger.offers.set(messy.fixture, []);
  return { ledger, reader, plan };
}

describe("mergePreflight", () => {
  it("passes when nothing is left, nothing is sponsored, the destination exists and the guard holds", async () => {
    const { reader, plan } = await readyToMerge();
    expect(await mergePreflight(reader, plan, { mergeOnly: true })).toMatchObject({ ok: true });
  });

  it("re-checks the base account of a muxed destination (review finding R9)", async () => {
    const { ledger, reader, plan } = await readyToMerge(muxed(messy.destination));
    expect(plan.destination.startsWith("M")).toBe(true);
    expect(await mergePreflight(reader, plan, { mergeOnly: true })).toMatchObject({ ok: true });
    ledger.accounts.delete(messy.destination);
    expect(await mergePreflight(reader, plan, { mergeOnly: true })).toEqual({
      ok: false,
      detail: "the destination no longer exists",
    });
  });

  it("re-reads the destination's SEP-29 marker and needs a memo when it is set (review finding R10)", async () => {
    const bare = await readyToMerge();
    bare.ledger.accounts.get(messy.destination)!.data["config.memo_required"] = MEMO_REQUIRED;
    const refused = await mergePreflight(bare.reader, bare.plan, { mergeOnly: true });
    expect(refused.ok).toBe(false);
    expect(refused.detail).toMatch(/memo.*SEP-29/);

    const withMemo = await readyToMerge(messy.destination, "invoice 7");
    withMemo.ledger.accounts.get(messy.destination)!.data["config.memo_required"] = MEMO_REQUIRED;
    expect(await mergePreflight(withMemo.reader, withMemo.plan, { mergeOnly: true })).toMatchObject(
      {
        ok: true,
      },
    );

    // SEP-29 does not apply to a muxed destination: the muxed id already names the recipient.
    const mux = await readyToMerge(muxed(messy.destination));
    mux.ledger.accounts.get(messy.destination)!.data["config.memo_required"] = MEMO_REQUIRED;
    expect(await mergePreflight(mux.reader, mux.plan, { mergeOnly: true })).toMatchObject({
      ok: true,
    });
  });

  it("checks for leftover subentries only when the merge runs alone", async () => {
    const { ledger, reader, plan } = await readyToMerge();
    const account = ledger.accounts.get(messy.fixture)!;
    account.data = { late: "MQ==" };
    account.subentry_count = 1;
    expect(await mergePreflight(reader, plan, { mergeOnly: true })).toEqual({
      ok: false,
      detail: "the account still holds 1 data entry",
    });
    // A merge that follows removals in its own transaction: they clear the subentries first.
    expect(await mergePreflight(reader, plan, { mergeOnly: false })).toMatchObject({ ok: true });
  });

  it("stops at the sequence guard with the unblocking ledger", async () => {
    const { ledger, reader, plan } = await readyToMerge();
    ledger.accounts.get(messy.fixture)!.sequence = (BigInt(ledger.ledgerSeq + 5) << 32n).toString();
    const result = await mergePreflight(reader, plan, { mergeOnly: true });
    expect(result).toMatchObject({ ok: false, unblocksAtLedger: ledger.ledgerSeq + 6 });
    expect(result.detail).toMatch(new RegExp(`until ledger ${ledger.ledgerSeq + 6}`));
  });
});
