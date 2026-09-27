import {
  Keypair,
  Operation,
  TransactionBuilder,
  Account,
  type Transaction,
} from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";
import { FeeSponsor } from "../../../src/sponsor/sponsor.js";
import { keypairSigner, type Signer } from "../../../src/sponsor/signer.js";
import { buildInnerTransaction } from "../../../src/tx/build-inner.js";

const TESTNET = "Test SDF Network ; September 2015";
const sponsorKp = Keypair.random();
const accountKp = Keypair.random();

/** An inner transaction; `sequence` is the account sequence it builds on (the next one is used). */
function inner(ops = 2, source = accountKp.publicKey(), sequence = "100"): Transaction {
  const tx = buildInnerTransaction({
    account: source,
    sequence,
    operations: Array.from({ length: ops }, (_, i) => ({
      type: "manageData" as const,
      name: `k${i}`,
      value: null,
    })),
    networkPassphrase: TESTNET,
    maxTime: 1_800_000_000,
  });
  tx.sign(accountKp);
  return tx;
}

const sponsor = (options: Partial<ConstructorParameters<typeof FeeSponsor>[1]> = {}) =>
  new FeeSponsor(keypairSigner(sponsorKp), { networkPassphrase: TESTNET, ...options });

describe("FeeSponsor.wrap", () => {
  it("wraps with bid x (ops + 1), signs only the outer envelope and records the bid", async () => {
    const s = sponsor();
    const tx = inner(2);
    const bump = await s.wrap(tx, 1000);
    expect(bump.feeSource).toBe(sponsorKp.publicKey());
    expect(bump.fee).toBe("3000");
    expect(bump.signatures).toHaveLength(1);
    expect(bump.innerTransaction.signatures).toHaveLength(1);
    expect(bump.innerTransaction.fee).toBe("0");
    expect(s.spentBidStroops).toBe(3000);
  });

  it("caps the bid and refuses a cap below the network minimum", async () => {
    const bump = await sponsor({ maxBaseFeeStroops: 500 }).wrap(inner(1), 10_000);
    expect(bump.fee).toBe("1000");
    expect(() => sponsor({ maxBaseFeeStroops: 50 })).toThrow(
      expect.objectContaining({ code: "CONFIG_INVALID" }),
    );
  });

  it("stops at the per-close budget", async () => {
    const s = sponsor({ budgetStroops: 5000 });
    await s.wrap(inner(1, accountKp.publicKey(), "100"), 2000); // 4000
    await expect(s.wrap(inner(1, accountKp.publicKey(), "101"), 2000)).rejects.toMatchObject({
      code: "SPONSOR_BUDGET_EXCEEDED",
    });
  });

  it("counts only the largest bid signed for one sequence number, since only one can be charged", async () => {
    const s = sponsor({ budgetStroops: 10_000 });
    const account = accountKp.publicKey();
    await s.wrap(inner(1, account, "100"), 1000); // 2000 for sequence 101
    expect(s.spentBidStroops).toBe(2000);
    // A rebuild of the same sequence with a doubled bid needs only the difference.
    await s.wrap(inner(1, account, "100"), 2000);
    expect(s.spentBidStroops).toBe(4000);
    // A lower bid for the same sequence adds nothing.
    await s.wrap(inner(1, account, "100"), 500);
    expect(s.spentBidStroops).toBe(4000);
    expect(s.headroomStroops(account, "101")).toBe(10_000);
    expect(s.headroomStroops(account, "102")).toBe(6000);
    expect(s.remainingStroops).toBe(6000);
    await s.wrap(inner(1, account, "101"), 3000); // 6000 for sequence 102
    expect(s.spentBidStroops).toBe(10_000);
    await expect(s.wrap(inner(1, account, "101"), 3001)).rejects.toMatchObject({
      code: "SPONSOR_BUDGET_EXCEEDED",
    });
  });

  it("refuses an inner transaction sourced by the sponsor or with a foreign operation source", async () => {
    await expect(sponsor().wrap(inner(1, sponsorKp.publicKey()), 100)).rejects.toMatchObject({
      code: "SPONSOR_REFUSED",
    });
    const foreign = new TransactionBuilder(new Account(accountKp.publicKey(), "5"), {
      fee: "0",
      networkPassphrase: TESTNET,
    })
      .addOperation(Operation.manageData({ name: "k", value: null, source: sponsorKp.publicKey() }))
      .setTimeout(60)
      .build();
    await expect(sponsor().wrap(foreign, 100)).rejects.toMatchObject({ code: "SPONSOR_REFUSED" });
  });

  it("refuses any network but testnet before signing", () => {
    expect(() => new FeeSponsor(keypairSigner(sponsorKp), { networkPassphrase: "other" })).toThrow(
      expect.objectContaining({ code: "MAINNET_REFUSED" }),
    );
  });
});

describe("signers", () => {
  it("lets the account sign through a callback, with no secret handed to the engine", async () => {
    let calls = 0;
    const walletSigner: Signer = {
      publicKey: () => accountKp.publicKey(),
      sign: (tx) => {
        calls++;
        // SDK 17.1.0: Keypair.sign() returns a Uint8Array, so encode it explicitly.
        const signature = Buffer.from(accountKp.sign(Buffer.from(tx.hash()))).toString("base64");
        tx.addSignature(accountKp.publicKey(), signature);
      },
    };
    const tx = buildInnerTransaction({
      account: accountKp.publicKey(),
      sequence: "7",
      operations: [{ type: "manageData", name: "k", value: null }],
      networkPassphrase: TESTNET,
      maxTime: 1_800_000_000,
    });
    await walletSigner.sign(tx);
    const bump = await sponsor().wrap(tx, 100);
    expect(calls).toBe(1);
    expect(bump.innerTransaction.signatures).toHaveLength(1);
    expect(JSON.stringify(walletSigner)).not.toContain(accountKp.secret());
  });

  it("keypairSigner does not expose the secret when serialised", () => {
    expect(JSON.stringify(keypairSigner(sponsorKp))).not.toContain(sponsorKp.secret());
  });
});

describe("FeeSponsor.release (edge case E7)", () => {
  it("drops the bids of a sequence number that no envelope can use any more", async () => {
    const s = new FeeSponsor(keypairSigner(sponsorKp), {
      networkPassphrase: TESTNET,
      budgetStroops: 3000,
    });
    const account = accountKp.publicKey();
    await s.wrap(inner(1, account, "100"), 1000); // 2000 for sequence 101
    await expect(s.wrap(inner(1, account, "101"), 1000)).rejects.toMatchObject({
      code: "SPONSOR_BUDGET_EXCEEDED",
    });
    s.release(account, "101");
    expect(s.spentBidStroops).toBe(0);
    await s.wrap(inner(1, account, "101"), 1000); // sequence 102 now fits
    expect(s.spentBidStroops).toBe(2000);
    s.release(account, "999"); // nothing signed for it: no change
    expect(s.spentBidStroops).toBe(2000);
  });
});
