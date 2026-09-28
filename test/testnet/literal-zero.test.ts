import {
  Account,
  Asset,
  Keypair,
  Operation,
  TransactionBuilder,
  type xdr,
} from "@stellar/stellar-sdk";
import { afterAll, beforeAll, expect, it } from "vitest";
import { toStroops } from "../../src/amounts.js";
import { baseFeeFromFeeStats, type FeeStatsLike } from "../../src/config/fees.js";
import {
  DEFAULT_HORIZON_URL,
  FRIENDBOT_URL,
  TESTNET_PASSPHRASE,
} from "../../src/config/network.js";
import { executeClose, type CloseReport } from "../../src/execute/executor.js";
import { horizonSubmitter, submitAndConfirm } from "../../src/execute/submit.js";
import { awaitFunded, friendbot, pollAccount } from "../../src/fixture/builder.js";
import type { HorizonAccount } from "../../src/inspect/horizon-types.js";
import type { ClosePlan } from "../../src/plan/model.js";
import { planClose } from "../../src/plan/plan-close.js";
import { horizonJson } from "../../src/reader/horizon-json.js";
import { hashHex, wrapInFeeBump } from "../../src/sponsor/fee-bump.js";
import { keypairSigner } from "../../src/sponsor/signer.js";
import { describeTestnet } from "./gate.js";

/**
 * Matrix row X-16 (bonus; canonical decision 3, the optional `literal-zero` reading): a fully
 * sponsored account that holds 0.0000000 XLM, closed with fee-bumped transactions. An account can
 * be created with a startingBalance of 0 when another account sponsors its reserves
 * (https://developers.stellar.org/docs/build/guides/transactions/create-account#create-an-account-1,
 * CAP-33): a reserve sponsor sandwiches CreateAccount between BeginSponsoringFutureReserves and the
 * new account's EndSponsoringFutureReserves, here with one sponsored trustline as the matrix row
 * asks. Every key is fresh; Friendbot funds only the fee sponsor, which creates the others.
 *
 *   DUSTIN_TESTNET=1 npx vitest run --project testnet --reporter=verbose test/testnet/literal-zero.test.ts
 */

const client = horizonJson(DEFAULT_HORIZON_URL);
const submitter = horizonSubmitter(DEFAULT_HORIZON_URL);
const feeSponsor = Keypair.random();
const reserveSponsor = Keypair.random();
const issuer = Keypair.random();
const destination = Keypair.random();
const zero = Keypair.random();
const ZTL = new Asset("ZTL", issuer.publicKey());
const hashes: Array<{ purpose: string; hash: string; ledger: number | null }> = [];
let baseFee = 100;

const account = (id: string) => client.get<HorizonAccount>(`/accounts/${id}`);
const native = (a: HorizonAccount | null) =>
  a!.balances.find((b) => b.asset_type === "native")!.balance;

/** One setup transaction, fee-bumped by the fee sponsor unless the fee sponsor is its source. */
async function setup(purpose: string, source: Keypair, ops: xdr.Operation[], signers: Keypair[]) {
  const loaded = (await account(source.publicKey()))!;
  const own = source.publicKey() === feeSponsor.publicKey();
  const builder = new TransactionBuilder(new Account(source.publicKey(), loaded.sequence), {
    fee: own ? String(baseFee) : "0",
    networkPassphrase: TESTNET_PASSPHRASE,
  }).setTimeout(120);
  for (const op of ops) builder.addOperation(op);
  const inner = builder.build();
  inner.sign(...signers);
  const envelope = own ? inner : wrapInFeeBump(inner, feeSponsor, baseFee, TESTNET_PASSPHRASE);
  const outcome = await submitAndConfirm(submitter, {
    xdr: envelope.toXDR(),
    hash: hashHex(envelope),
    maxTime: Number(inner.timeBounds!.maxTime),
  });
  hashes.push({
    purpose,
    hash: outcome.hash,
    ledger: "ledger" in outcome ? (outcome.ledger ?? null) : null,
  });
  expect(outcome.kind, purpose).toBe("applied");
}

let plan: ClosePlan;
let report: CloseReport;
let reserveBefore: HorizonAccount;
let feeSponsorBefore: HorizonAccount;

describeTestnet("X-16: a fully sponsored account with 0.0000000 XLM (live testnet)", () => {
  beforeAll(async () => {
    await friendbot(FRIENDBOT_URL, feeSponsor.publicKey(), (url, init) => fetch(url, init), {
      horizonUrl: DEFAULT_HORIZON_URL,
    });
    await awaitFunded(
      client,
      feeSponsor.publicKey(),
      30_000,
      (ms) => new Promise((r) => setTimeout(r, ms)),
    );
    baseFee = baseFeeFromFeeStats((await client.get<FeeStatsLike>("/fee_stats"))!);
    await setup(
      "create the reserve sponsor, the issuer and the destination",
      feeSponsor,
      [
        Operation.createAccount({ destination: reserveSponsor.publicKey(), startingBalance: "5" }),
        Operation.createAccount({ destination: issuer.publicKey(), startingBalance: "2" }),
        Operation.createAccount({ destination: destination.publicKey(), startingBalance: "2" }),
      ],
      [feeSponsor],
    );
    await setup(
      "sponsorship sandwich: create the account with startingBalance 0 and a sponsored ZTL trustline",
      reserveSponsor,
      [
        Operation.beginSponsoringFutureReserves({ sponsoredId: zero.publicKey() }),
        Operation.createAccount({ destination: zero.publicKey(), startingBalance: "0" }),
        Operation.changeTrust({ asset: ZTL, source: zero.publicKey() }),
        Operation.endSponsoringFutureReserves({ source: zero.publicKey() }),
      ],
      [reserveSponsor, zero],
    );
    await pollAccount(
      client,
      zero.publicKey(),
      (a) => a !== null,
      30_000,
      (ms) => new Promise((r) => setTimeout(r, ms)),
    );
    reserveBefore = (await account(reserveSponsor.publicKey()))!;
    feeSponsorBefore = (await account(feeSponsor.publicKey()))!;
  }, 300_000);

  afterAll(() => {
    console.log(
      JSON.stringify(
        {
          accounts: {
            zero: zero.publicKey(),
            feeSponsor: feeSponsor.publicKey(),
            reserveSponsor: reserveSponsor.publicKey(),
            issuer: issuer.publicKey(),
            destination: destination.publicKey(),
          },
          hashes,
        },
        null,
        2,
      ),
    );
  });

  it("X-16: the account holds 0.0000000 XLM, its entry and its trustline sponsored by the reserve sponsor (num_sponsoring 3)", async () => {
    const z = (await account(zero.publicKey()))!;
    expect(native(z)).toBe("0.0000000");
    expect(z).toMatchObject({
      sponsor: reserveSponsor.publicKey(),
      num_sponsored: 3,
      subentry_count: 1,
    });
    expect(z.balances.find((b) => b.asset_code === "ZTL")?.sponsor).toBe(
      reserveSponsor.publicKey(),
    );
    expect(reserveBefore.num_sponsoring).toBe(3);
  });

  it("X-16: the plan is closable: it removes the trustline and merges 0 XLM, and returns 1.5 XLM of reserves to the reserve sponsor", async () => {
    plan = await planClose({
      account: zero.publicKey(),
      destination: destination.publicKey(),
      feeSponsor: feeSponsor.publicKey(),
    });
    expect(plan.status).toBe("closable");
    expect(plan.steps.map((s) => s.kind)).toEqual(["remove_trustline", "merge"]);
    expect(plan.reserve).toMatchObject({
      balance: "0.0000000",
      minimum: "0.0000000",
      spendable: "0.0000000",
    });
    expect(plan.recovery.xlmToDestination).toBe("0.0000000");
    expect(plan.recovery.reservesReturnedToSponsors).toEqual([
      {
        sponsor: reserveSponsor.publicKey(),
        xlm: "1.5000000",
        entries: [`trustline ZTL:${issuer.publicKey()}`, "account entry"],
      },
    ]);
  }, 120_000);

  it("X-16: the close merges 0 XLM in one fee bump paid by the fee sponsor; the reserve sponsor's num_sponsoring falls by 3 (the account entry's 2 and the trustline's 1), its XLM unchanged", async () => {
    const destinationBefore = (await account(destination.publicKey()))!;
    report = await executeClose(
      plan,
      { account: keypairSigner(zero), feeSponsor: keypairSigner(feeSponsor) },
      { confirm: true },
    );
    for (const t of report.transactions) {
      hashes.push({ purpose: `close (${t.phase}, ${t.result})`, hash: t.hash, ledger: t.ledger });
    }
    expect(report.status).toBe("closed");
    expect(report.verification).toMatchObject({ accountExists: false, horizonStatus: 404 });
    expect(report.transactions.map((t) => t.result)).toEqual(["applied"]);
    expect(report.recovery.mergedXlm).toBe("0.0000000");
    const tx = await client.get<{
      fee_account: string;
      source_account: string;
      fee_charged: string;
      inner_transaction?: { max_fee: string };
    }>(`/transactions/${report.transactions[0]!.hash}`);
    expect(tx).toMatchObject({
      fee_account: feeSponsor.publicKey(),
      source_account: zero.publicKey(),
      inner_transaction: { max_fee: "0" },
    });
    expect(await account(zero.publicKey())).toBeNull();
    const reserveAfter = (await account(reserveSponsor.publicKey()))!;
    expect(reserveBefore.num_sponsoring - reserveAfter.num_sponsoring).toBe(3);
    expect(native(reserveAfter)).toBe(native(reserveBefore));
    // Only the fee sponsor paid a fee; the destination received exactly the 0 XLM merged.
    const feeSponsorAfter = (await account(feeSponsor.publicKey()))!;
    expect(toStroops(native(feeSponsorBefore)) - toStroops(native(feeSponsorAfter))).toBe(
      BigInt(tx!.fee_charged),
    );
    expect(native(await account(destination.publicKey()))).toBe(native(destinationBefore));
    const effects = await client.get<{ _embedded: { records: Array<{ type: string }> } }>(
      `/transactions/${report.transactions[0]!.hash}/effects?limit=200`,
    );
    const types = effects!._embedded.records.map((e) => e.type);
    expect(types).toEqual(
      expect.arrayContaining([
        "trustline_sponsorship_removed",
        "account_sponsorship_removed",
        "account_removed",
      ]),
    );
  }, 300_000);
});
