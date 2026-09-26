import { Keypair } from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";
import type { OperationDescriptor } from "../../../src/plan/model.js";
import { FakeLedger } from "../../helpers/fake-ledger.js";
import { TESTNET_HORIZON } from "../../helpers/recorded-horizon.js";
import { messy } from "../../helpers/snapshots.js";
import { submitToFakeLedger } from "../../helpers/submit-ops.js";

// The pool rules of the fake ledger, checked against the protocol (review finding R14): CAP-38
// (https://github.com/stellar/stellar-protocol/blob/master/core/cap-0038.md) and stellar-core
// ChangeTrustOpFrame::doApply, SponsorshipUtils computeMultiplier.

const LPA = `LPA:${messy.issuer}`;
const LPB = `LPB:${messy.issuer}`;
const holderKey = (n: number) => Keypair.fromRawEd25519Seed(Buffer.alloc(32, 40 + n)).publicKey();

function setup(options: { lines?: string[]; authorized?: boolean } = {}) {
  const ledger = FakeLedger.messy();
  const holder = holderKey(0);
  ledger.accounts.set(holder, FakeLedger.plainAccount(holder, "5.0000000", ledger.ledgerSeq));
  for (const line of options.lines ?? [LPA, LPB]) {
    ledger.addTrustline(holder, line, { authorized: options.authorized ?? true });
  }
  return { ledger, holder };
}

const removePool = (poolId: string, assets: [string, string]): OperationDescriptor => ({
  type: "changeTrust",
  asset: { type: "liquidity_pool_shares", poolId, assets },
  limit: "0",
});
const removeLine = (key: string): OperationDescriptor => {
  const [code, issuer] = key.split(":") as [string, string];
  return {
    type: "changeTrust",
    asset: { type: code.length <= 4 ? "credit_alphanum4" : "credit_alphanum12", code, issuer },
    limit: "0",
  };
};
const get = async (ledger: FakeLedger, path: string) => {
  const response = await ledger.fetch(`${TESTNET_HORIZON}${path}`);
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
};

describe("fake ledger: creating pool-share trustlines", () => {
  it("needs an asset trustline, authorized at least to maintain liabilities, for each pool asset", () => {
    const missing = setup({ lines: [LPA] });
    expect(() => missing.ledger.addPoolShareTrustline(missing.holder, [LPA, LPB])).toThrow(
      /CHANGE_TRUST_TRUST_LINE_MISSING/,
    );
    const frozen = setup({ authorized: false });
    expect(() => frozen.ledger.addPoolShareTrustline(frozen.holder, [LPA, LPB])).toThrow(
      /CHANGE_TRUST_NOT_AUTH_MAINTAIN_LIABILITIES/,
    );
    // XLM needs no trustline, nor does an asset the account issues itself.
    const own = setup({ lines: [] });
    expect(() =>
      own.ledger.addPoolShareTrustline(own.holder, ["native", `OWN:${own.holder}`]),
    ).not.toThrow();
  });

  it("counts two subentries and lists the pool with its assets in pool order", async () => {
    const { ledger, holder } = setup();
    const id = ledger.addPoolShareTrustline(holder, [LPB, LPA]);
    expect(id).toBe(FakeLedger.poolId(LPA, LPB));
    expect(ledger.accounts.get(holder)!.subentry_count).toBe(4);
    const line = ledger.accounts.get(holder)!.balances.at(-1)!;
    expect(line).toMatchObject({
      asset_type: "liquidity_pool_shares",
      liquidity_pool_id: id,
      balance: "0.0000000",
      is_authorized: false,
    });
    const pool = await get(ledger, `/liquidity_pools/${id}`);
    expect(pool.status).toBe(200);
    expect(pool.body).toMatchObject({
      id,
      fee_bp: 30,
      total_trustlines: "1",
      reserves: [
        { asset: LPA, amount: "0.0000000" },
        { asset: LPB, amount: "0.0000000" },
      ],
    });
    ledger.unlistedPools.add(id);
    expect((await get(ledger, `/liquidity_pools/${id}`)).status).toBe(404);
  });

  it("counts a sponsored pool-share trustline as two sponsored reserves on both sides", () => {
    const { ledger, holder } = setup();
    const before = ledger.accounts.get(messy.reserveSponsor)!.num_sponsoring;
    ledger.addPoolShareTrustline(holder, [LPA, LPB], { sponsor: messy.reserveSponsor });
    expect(ledger.accounts.get(holder)!.num_sponsored).toBe(2);
    expect(ledger.accounts.get(messy.reserveSponsor)!.num_sponsoring).toBe(before + 2);
  });
});

describe("fake ledger: removing pool-share trustlines", () => {
  it("removes an empty one with limit 0, releases its two reserves and erases the pool with its last", async () => {
    const { ledger, holder } = setup();
    const other = holderKey(1);
    ledger.accounts.set(other, FakeLedger.plainAccount(other, "5.0000000", ledger.ledgerSeq));
    ledger.addTrustline(other, LPA);
    ledger.addTrustline(other, LPB);
    const id = ledger.addPoolShareTrustline(holder, [LPA, LPB], {
      sponsor: messy.reserveSponsor,
    });
    ledger.addPoolShareTrustline(other, [LPA, LPB]);
    const sponsoring = ledger.accounts.get(messy.reserveSponsor)!.num_sponsoring;

    const first = await submitToFakeLedger(ledger, {
      source: holder,
      sponsor: messy.sponsor,
      operations: [removePool(id, [LPA, LPB])],
    });
    expect(first.kind).toBe("applied");
    const account = ledger.accounts.get(holder)!;
    expect(account.balances.some((b) => b.asset_type === "liquidity_pool_shares")).toBe(false);
    expect(account.subentry_count).toBe(2);
    expect(account.num_sponsored).toBe(0);
    expect(ledger.accounts.get(messy.reserveSponsor)!.num_sponsoring).toBe(sponsoring - 2);
    expect(ledger.liquidityPools.get(id)!.total_trustlines).toBe("1");

    const last = await submitToFakeLedger(ledger, {
      source: other,
      sponsor: messy.sponsor,
      operations: [removePool(id, [LPA, LPB])],
    });
    expect(last.kind).toBe("applied");
    expect(ledger.liquidityPools.has(id)).toBe(false);
    expect((await get(ledger, `/liquidity_pools/${id}`)).status).toBe(404);
  });

  it("refuses one that still holds shares (op_invalid_limit) and changes nothing but the sequence and the fee", async () => {
    const { ledger, holder } = setup();
    const id = ledger.addPoolShareTrustline(holder, [LPA, LPB], { balance: "1.0000000" });
    const before = structuredClone(ledger.accounts.get(holder)!);
    const sponsorBefore = ledger.native(messy.sponsor);
    const outcome = await submitToFakeLedger(ledger, {
      source: holder,
      sponsor: messy.sponsor,
      operations: [removePool(id, [LPA, LPB])],
    });
    expect(outcome).toMatchObject({
      kind: "failed",
      codes: { innerTransaction: "tx_failed", operations: ["op_invalid_limit"] },
    });
    const after = ledger.accounts.get(holder)!;
    expect(after.balances).toEqual(before.balances);
    expect(after.subentry_count).toBe(before.subentry_count);
    expect(BigInt(after.sequence)).toBe(BigInt(before.sequence) + 1n);
    expect(ledger.native(messy.sponsor)).toBe(sponsorBefore - 200n);
    expect(ledger.liquidityPools.get(id)!.total_trustlines).toBe("1");
  });

  it("refuses to remove a pool's asset trustline while the share trustline exists (op_cannot_delete)", async () => {
    const { ledger, holder } = setup();
    const id = ledger.addPoolShareTrustline(holder, [LPA, LPB]);
    const refused = await submitToFakeLedger(ledger, {
      source: holder,
      sponsor: messy.sponsor,
      operations: [removeLine(LPA)],
    });
    expect(refused).toMatchObject({ kind: "failed", codes: { operations: ["op_cannot_delete"] } });
    expect(ledger.accounts.get(holder)!.subentry_count).toBe(4);

    // Share trustline first, then the asset trustlines: one atomic transaction that applies.
    const ordered = await submitToFakeLedger(ledger, {
      source: holder,
      sponsor: messy.sponsor,
      operations: [removePool(id, [LPA, LPB]), removeLine(LPA), removeLine(LPB)],
    });
    expect(ordered.kind).toBe("applied");
    expect(ledger.accounts.get(holder)!.subentry_count).toBe(0);
    expect(ledger.accounts.get(holder)!.balances).toHaveLength(1);
  });

  it("checks the limit before the pool, as stellar-core does: a used trustline with a balance fails op_invalid_limit", async () => {
    const { ledger, holder } = setup();
    ledger.addPoolShareTrustline(holder, [LPA, LPB]);
    ledger.accounts.get(holder)!.balances.find((b) => b.asset_code === "LPA")!.balance =
      "0.0000001";
    const outcome = await submitToFakeLedger(ledger, {
      source: holder,
      sponsor: messy.sponsor,
      operations: [removeLine(LPA)],
    });
    expect(outcome).toMatchObject({ kind: "failed", codes: { operations: ["op_invalid_limit"] } });
  });

  it("removes a credit trustline exactly as before when no pool uses it", async () => {
    const { ledger, holder } = setup();
    const outcome = await submitToFakeLedger(ledger, {
      source: holder,
      sponsor: messy.sponsor,
      operations: [removeLine(LPA)],
    });
    expect(outcome.kind).toBe("applied");
    expect(ledger.accounts.get(holder)!.subentry_count).toBe(1);
    expect(ledger.accounts.get(holder)!.balances.map((b) => b.asset_code ?? b.asset_type)).toEqual([
      "native",
      "LPB",
    ]);
  });
});
