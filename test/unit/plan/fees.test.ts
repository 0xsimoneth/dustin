import { Keypair } from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";
import { MIN_BASE_FEE } from "../../../src/config/fees.js";
import { feeSummary } from "../../../src/plan/fees.js";
import { keypairSigner } from "../../../src/sponsor/signer.js";
import { FeeSponsor } from "../../../src/sponsor/sponsor.js";
import { buildInnerTransaction } from "../../../src/tx/build-inner.js";

const TESTNET = "Test SDF Network ; September 2015";
const stats = { lastLedgerBaseFee: 100, feeChargedP80: 100 };
const opts = { destination: "G-destination-not-read-here" };

describe("feeSummary", () => {
  it("clamps a bid override to the cap exactly like the sponsor does (review finding R18)", async () => {
    const summary = feeSummary(
      [9, 2, 1],
      stats,
      { ...opts, baseFeeStroops: 5000, maxBaseFeeStroops: 1000 },
      "payer",
    );
    expect(summary).toMatchObject({
      baseFeeStroops: 1000,
      basis: "override",
      maxBaseFeeStroops: 1000,
      perTransactionStroops: [10_000, 3000, 2000],
      totalStroops: 15_000,
    });

    // The estimate and the bid the sponsor signs agree.
    const account = Keypair.random();
    const inner = buildInnerTransaction({
      account: account.publicKey(),
      sequence: "1",
      operations: Array.from({ length: 9 }, (_, i) => ({
        type: "manageData" as const,
        name: `k${i}`,
        value: null,
      })),
      networkPassphrase: TESTNET,
      maxTime: 1_800_000_000,
    });
    const sponsor = new FeeSponsor(keypairSigner(Keypair.random()), {
      networkPassphrase: TESTNET,
      maxBaseFeeStroops: 1000,
    });
    const bump = await sponsor.wrap(inner, 5000);
    expect(Number(bump.fee)).toBe(summary.perTransactionStroops[0]);
  });

  it("raises an override below the network minimum to the minimum", () => {
    const summary = feeSummary([1], stats, { ...opts, baseFeeStroops: 10 }, "payer");
    expect(summary.baseFeeStroops).toBe(MIN_BASE_FEE);
    expect(summary.totalStroops).toBe(2 * MIN_BASE_FEE);
  });

  it("keeps an override inside the cap unchanged and flags a plan over its budget", () => {
    const summary = feeSummary(
      [9, 2, 1],
      stats,
      { ...opts, baseFeeStroops: 700, budgetStroops: 10_000 },
      "payer",
    );
    expect(summary.baseFeeStroops).toBe(700);
    expect(summary.totalStroops).toBe(10_500);
    expect(summary.withinBudget).toBe(false);
  });
});
