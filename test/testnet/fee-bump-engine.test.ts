import {
  Account,
  Asset,
  Keypair,
  Operation,
  TransactionBuilder,
  type Transaction,
} from "@stellar/stellar-sdk";
import { expect, it } from "vitest";
import { formatStroops } from "../../src/amounts.js";
import {
  DEFAULT_HORIZON_URL,
  FRIENDBOT_URL,
  TESTNET_PASSPHRASE,
} from "../../src/config/network.js";
import { horizonSubmitter, submitAndConfirm } from "../../src/execute/submit.js";
import type { HorizonAccount } from "../../src/inspect/horizon-types.js";
import { reserveFromHorizon } from "../../src/inspect/reserve.js";
import { horizonJson, latestLedger } from "../../src/reader/horizon-json.js";
import { hashHex } from "../../src/sponsor/fee-bump.js";
import { keypairSigner } from "../../src/sponsor/signer.js";
import { FeeSponsor } from "../../src/sponsor/sponsor.js";
import { buildInnerTransaction } from "../../src/tx/build-inner.js";
import { describeTestnet } from "./gate.js";

describeTestnet("fee-bump engine (live testnet)", () => {
  it("submits sponsor-paid transactions from a zero-spendable account without charging it", async () => {
    const client = horizonJson(DEFAULT_HORIZON_URL);
    const submitter = horizonSubmitter(DEFAULT_HORIZON_URL);
    const sponsorKp = Keypair.random();
    const accountKp = Keypair.random();
    const account = accountKp.publicKey();
    const load = async (id: string) => (await client.get<HorizonAccount>(`/accounts/${id}`))!;
    expect((await fetch(`${FRIENDBOT_URL}/?addr=${sponsorKp.publicKey()}`)).ok).toBe(true);

    // Setup, sponsor-sourced: create the account with one data entry.
    const setup = new TransactionBuilder(
      new Account(sponsorKp.publicKey(), (await load(sponsorKp.publicKey())).sequence),
      {
        fee: "10000",
        networkPassphrase: TESTNET_PASSPHRASE,
      },
    )
      .addOperation(Operation.createAccount({ destination: account, startingBalance: "3" }))
      .addOperation(Operation.manageData({ name: "k", value: "v", source: account }))
      .setTimeout(120)
      .build();
    setup.sign(sponsorKp, accountKp);
    const setupOutcome = await submitAndConfirm(submitter, {
      xdr: setup.toXDR(),
      hash: hashHex(setup),
      maxTime: Number(setup.timeBounds!.maxTime),
    });
    expect(setupOutcome.kind).toBe("applied");

    const sponsor = new FeeSponsor(keypairSigner(sponsorKp), {
      networkPassphrase: TESTNET_PASSPHRASE,
    });
    const signer = keypairSigner(accountKp);
    const bumpAndSubmit = async (inner: Transaction) => {
      await signer.sign(inner);
      const bump = await sponsor.wrap(inner, 1000);
      return submitAndConfirm(submitter, {
        xdr: bump.toXDR(),
        hash: hashHex(bump),
        maxTime: Number(inner.timeBounds!.maxTime),
      });
    };

    // Drain to exactly the minimum balance with a fee-bumped native payment (inner fee 0).
    const baseReserve = BigInt((await latestLedger(client)).base_reserve_in_stroops);
    const before = reserveFromHorizon(await load(account), baseReserve);
    const pay = new TransactionBuilder(new Account(account, (await load(account)).sequence), {
      fee: "0",
      networkPassphrase: TESTNET_PASSPHRASE,
    })
      .addOperation(
        Operation.payment({
          destination: sponsorKp.publicKey(),
          asset: Asset.native(),
          amount: formatStroops(before.spendable),
        }),
      )
      .setTimeout(120)
      .build();
    expect((await bumpAndSubmit(pay)).kind).toBe("applied");
    const drained = reserveFromHorizon(await load(account), baseReserve);
    expect(formatStroops(drained.spendable)).toBe("0.0000000");

    // The engine proper: a plan descriptor built into an inner transaction, from a zero-spendable account.
    const ledger = await latestLedger(client);
    const inner = buildInnerTransaction({
      account,
      sequence: (await load(account)).sequence,
      operations: [{ type: "manageData", name: "k", value: null }],
      networkPassphrase: TESTNET_PASSPHRASE,
      maxTime: Math.floor(Date.parse(ledger.closed_at) / 1000) + 120,
    });
    const outcome = await bumpAndSubmit(inner);
    expect(outcome.kind).toBe("applied");
    if (outcome.kind !== "applied") return;
    const record = await client.get<{
      fee_account: string;
      source_account: string;
      inner_transaction: { hash: string; max_fee: string };
    }>(`/transactions/${outcome.hash}`);
    expect(record).toMatchObject({
      fee_account: sponsorKp.publicKey(),
      source_account: account,
      inner_transaction: { hash: hashHex(inner), max_fee: "0" },
    });
    // Removing the data entry released its reserve; not one stroop left as a fee.
    const after = reserveFromHorizon(await load(account), baseReserve);
    expect(after.balance).toBe(drained.balance);
    expect(outcome.feeChargedStroops).toBeGreaterThan(0);
  }, 300_000);
});
