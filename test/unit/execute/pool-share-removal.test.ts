import {
  FeeBumpTransaction,
  Keypair,
  LiquidityPoolAsset,
  TransactionBuilder,
} from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";
import { formatStroops } from "../../../src/amounts.js";
import { executeClose } from "../../../src/execute/executor.js";
import { horizonSubmitter } from "../../../src/execute/submit.js";
import type { OperationDescriptor } from "../../../src/plan/model.js";
import { planClose } from "../../../src/plan/plan-close.js";
import { horizonJson } from "../../../src/reader/horizon-json.js";
import { horizonReader } from "../../../src/reader/ledger-reader.js";
import type { Signer } from "../../../src/sponsor/signer.js";
import { FakeLedger } from "../../helpers/fake-ledger.js";
import { TESTNET_HORIZON } from "../../helpers/recorded-horizon.js";
import { messy } from "../../helpers/snapshots.js";
import { submitToFakeLedger } from "../../helpers/submit-ops.js";
import { noSleep } from "../../helpers/no-sleep.js";

// Review finding R14: execution coverage for the removal of empty pool-share trustlines. The fake
// ledger applies the pool rules of CAP-38 and stellar-core ChangeTrustOpFrame
// (test/unit/helpers/fake-ledger-pools.test.ts): an asset trustline that a pool-share trustline
// uses cannot be deleted (op_cannot_delete), a pool-share trustline with shares cannot be deleted
// (op_invalid_limit), and a deleted pool-share trustline releases two reserves.

const TESTNET = "Test SDF Network ; September 2015";
const LPA = `LPA:${messy.issuer}`;
const LPB = `LPB:${messy.issuer}`;
const BASE_RESERVE = 5_000_000n;
const HOLDER = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 50)).publicKey();

// The fake ledger does not verify signatures, so signers only need the right public keys.
const signerFor = (publicKey: string): Signer => ({
  publicKey: () => publicKey,
  sign: () => undefined,
});

interface HolderOptions {
  assets?: [string, string];
  sponsored?: boolean;
  unlisted?: boolean;
  shares?: string;
}

/** A zero-spendable account holding a pool-share trustline and its pool's empty asset trustlines. */
function poolHolder(options: HolderOptions = {}) {
  const ledger = FakeLedger.messy();
  const assets = options.assets ?? [LPA, LPB];
  const credit = assets.filter((a) => a !== "native" && !a.endsWith(`:${HOLDER}`));
  // Two base reserves for the account, one per trustline, two for the share trustline.
  const reserves = BigInt(2 + credit.length + (options.sponsored ? 0 : 2));
  ledger.accounts.set(
    HOLDER,
    FakeLedger.plainAccount(HOLDER, formatStroops(reserves * BASE_RESERVE), ledger.ledgerSeq),
  );
  for (const asset of credit) ledger.addTrustline(HOLDER, asset);
  const poolId = ledger.addPoolShareTrustline(HOLDER, assets, {
    ...(options.sponsored ? { sponsor: messy.reserveSponsor } : {}),
    ...(options.shares ? { balance: options.shares } : {}),
  });
  if (options.unlisted) ledger.unlistedPools.add(poolId);
  const reader = horizonReader(horizonJson(TESTNET_HORIZON, { fetch: ledger.fetch, retries: 0 }));
  const deps = {
    reader,
    submitter: horizonSubmitter(TESTNET_HORIZON, { fetch: ledger.fetch }),
    sleep: noSleep,
  };
  const plan = () =>
    planClose(
      { account: HOLDER, destination: messy.destination, feeSponsor: messy.sponsor },
      { reader },
    );
  const signers = { account: signerFor(HOLDER), feeSponsor: signerFor(messy.sponsor) };
  return { ledger, poolId, assets, credit, reserves, deps, plan, signers };
}

/** The operations of a submitted fee bump, as the ledger decoded them. */
function submittedOperations(feeBumpXdr: string) {
  const bump = TransactionBuilder.fromXDR(feeBumpXdr, TESTNET);
  if (!(bump instanceof FeeBumpTransaction)) throw new Error("not a fee bump");
  return bump.innerTransaction.operations.map((op) => {
    if (op.type === "changeTrust") {
      return op.line instanceof LiquidityPoolAsset
        ? `remove pool share ${op.line.toString().slice("liquidity_pool:".length)}`
        : `remove ${op.line.getCode()}`;
    }
    return op.type;
  });
}

const removeLine = (key: string): OperationDescriptor => {
  const [code, issuer] = key.split(":") as [string, string];
  return { type: "changeTrust", asset: { type: "credit_alphanum4", code, issuer }, limit: "0" };
};

describe("closing an account that holds an empty pool-share trustline", () => {
  it.each([
    { pool: "LPA / LPB", assets: [LPA, LPB] as [string, string], unlisted: false },
    { pool: "LPA / LPB", assets: [LPA, LPB] as [string, string], unlisted: true },
    { pool: "XLM / LPA", assets: ["native", LPA] as [string, string], unlisted: false },
    { pool: "XLM / LPA", assets: ["native", LPA] as [string, string], unlisted: true },
  ])(
    "$pool pool, unlisted on Horizon: $unlisted: removes the share trustline first and merges",
    async ({ assets, unlisted }) => {
      const h = poolHolder({ assets, unlisted });
      const destinationBefore = h.ledger.native(messy.destination);
      const plan = await h.plan();
      expect(plan.status).toBe("closable");
      if (unlisted) {
        // Review finding R13: the pool's assets come from its id, not from Horizon.
        expect(plan.warnings.join(" ")).toMatch(/was not found on Horizon; its assets .* derived/);
      }
      const pool = plan.steps[0]!;
      expect(pool).toMatchObject({ kind: "remove_trustline", subject: { type: "pool_share" } });
      const lines = plan.steps.filter((s) => s.subject.type === "trustline");
      expect(lines).toHaveLength(h.credit.length);
      for (const line of lines) expect(line.dependsOn).toContain(pool.id);
      // No market step, so cleanup and merge share one fee-bumped transaction.
      expect(plan.transactions).toHaveLength(1);

      const report = await executeClose(plan, h.signers, { confirm: true, ...h.deps });
      expect(report.status).toBe("closed");
      expect(report.verification).toMatchObject({ accountExists: false, horizonStatus: 404 });
      expect(report.transactions).toHaveLength(1);
      const [tx] = report.transactions;
      expect(tx).toMatchObject({ result: "applied", feeAccount: messy.sponsor });
      expect(h.ledger.transactions.get(tx!.hash)).toMatchObject({
        successful: true,
        fee_account: messy.sponsor,
        source_account: HOLDER,
      });
      expect(submittedOperations(tx!.feeBumpEnvelopeXdr)).toEqual([
        `remove pool share ${h.poolId}`,
        ...h.credit.map((a) => `remove ${a.split(":")[0]}`),
        "accountMerge",
      ]);
      expect(h.ledger.accounts.has(HOLDER)).toBe(false);
      // The pool is erased with its last share trustline (CAP-38).
      expect(h.ledger.liquidityPools.has(h.poolId)).toBe(false);
      // Every reserve the account held reaches the destination; the account paid no fee.
      expect(h.ledger.native(messy.destination) - destinationBefore).toBe(
        h.reserves * BASE_RESERVE,
      );
      expect(report.recovery.feesPaidByAccount).toBe("0");
    },
  );

  it("returns a sponsored share trustline's two reserves to its sponsor", async () => {
    const h = poolHolder({ sponsored: true });
    const sponsoring = h.ledger.accounts.get(messy.reserveSponsor)!.num_sponsoring;
    const plan = await h.plan();
    expect(plan.steps[0]!.reserveReleasedTo).toEqual({
      to: "sponsor",
      sponsor: messy.reserveSponsor,
    });
    const report = await executeClose(plan, h.signers, { confirm: true, ...h.deps });
    expect(report.status).toBe("closed");
    expect(h.ledger.accounts.get(messy.reserveSponsor)!.num_sponsoring).toBe(sponsoring - 2);
    expect(report.recovery.reservesReturnedToSponsors).toEqual([
      { sponsor: messy.reserveSponsor, xlm: "1.0000000", entries: [`pool share ${h.poolId}`] },
    ]);
  });
});

describe("negative controls on the fake ledger", () => {
  it("refuses the other order: an asset trustline before the share trustline fails op_cannot_delete", async () => {
    const h = poolHolder();
    const plan = await h.plan();
    const outcome = await submitToFakeLedger(h.ledger, {
      source: HOLDER,
      sponsor: messy.sponsor,
      operations: [removeLine(LPA)],
    });
    expect(outcome).toMatchObject({
      kind: "failed",
      codes: {
        transaction: "tx_fee_bump_inner_failed",
        innerTransaction: "tx_failed",
        operations: ["op_cannot_delete"],
      },
    });
    const account = h.ledger.accounts.get(HOLDER)!;
    expect(account.subentry_count).toBe(4);
    expect(account.balances.map((b) => b.asset_code ?? b.asset_type)).toEqual([
      "native",
      "LPA",
      "LPB",
      "liquidity_pool_shares",
    ]);
    // Dustin's order still closes the account afterwards: the failed attempt changed only the
    // sequence number, which the plan does not depend on.
    const report = await executeClose(plan, h.signers, { confirm: true, ...h.deps });
    expect(report.status).toBe("closed");
  });

  it("refuses a share trustline that holds shares: blocked plan, nothing submitted, op_invalid_limit if forced", async () => {
    const h = poolHolder({ shares: "1.0000000" });
    const plan = await h.plan();
    expect(plan.status).toBe("blocked");
    expect(plan.blockers.map((b) => b.code)).toEqual(["LIQUIDITY_POOL_SHARES"]);
    expect(plan.unclosable.map((u) => u.code)).toEqual([
      "POOL_ASSET_TRUSTLINE",
      "POOL_ASSET_TRUSTLINE",
    ]);
    const refused = await executeClose(plan, h.signers, { confirm: true, ...h.deps });
    expect(refused.status).toBe("aborted");
    const partial = await executeClose(plan, h.signers, {
      confirm: true,
      allowPartial: true,
      ...h.deps,
    });
    expect(partial).toMatchObject({
      status: "aborted",
      message: "The plan has nothing to execute.",
    });
    expect(h.ledger.submissions).toHaveLength(0);

    const forced = await submitToFakeLedger(h.ledger, {
      source: HOLDER,
      sponsor: messy.sponsor,
      operations: [
        {
          type: "changeTrust",
          asset: { type: "liquidity_pool_shares", poolId: h.poolId, assets: [LPA, LPB] },
          limit: "0",
        },
      ],
    });
    expect(forced).toMatchObject({ kind: "failed", codes: { operations: ["op_invalid_limit"] } });
  });

  it("with --partial, a pool that cannot be resolved never makes the cleanup fail on op_cannot_delete (R13)", async () => {
    // The holder issues OWN itself, so it needs no OWN trustline and the pool's id matches no pair
    // of its trustline assets (stellar-core ChangeTrustOpFrame::tryIncrementPoolUseCount).
    const h = poolHolder({ assets: [`OWN:${HOLDER}`, LPA], unlisted: true });
    h.ledger.addTrustline(HOLDER, LPB);
    const account = h.ledger.accounts.get(HOLDER)!;
    account.data = { note: "MQ==" };
    account.subentry_count += 1;
    // Two more reserves for LPB and the data entry, so the account stays at its minimum balance.
    account.balances[0]!.balance = formatStroops((h.reserves + 2n) * BASE_RESERVE);

    const plan = await h.plan();
    expect(plan.status).toBe("partial");
    expect(plan.unclosable.map((u) => u.code)).toEqual([
      "LIQUIDITY_POOL_SHARES",
      "POOL_ASSET_TRUSTLINE",
      "POOL_ASSET_TRUSTLINE",
    ]);
    expect(plan.steps.map((s) => s.kind)).toEqual(["remove_data"]);
    const report = await executeClose(plan, h.signers, {
      confirm: true,
      allowPartial: true,
      ...h.deps,
    });
    expect(report.status).toBe("partial");
    expect(report.transactions.map((t) => t.result)).toEqual(["applied"]);
    expect([...h.ledger.transactions.values()].every((t) => t.successful)).toBe(true);
    expect(
      h.ledger.accounts.get(HOLDER)!.balances.map((b) => b.asset_code ?? b.asset_type),
    ).toEqual(["native", "LPA", "liquidity_pool_shares", "LPB"]);

    // Control: removing LPA, which the planner used to plan here, fails on this ledger.
    const control = await submitToFakeLedger(h.ledger, {
      source: HOLDER,
      sponsor: messy.sponsor,
      operations: [removeLine(LPA)],
    });
    expect(control).toMatchObject({ kind: "failed", codes: { operations: ["op_cannot_delete"] } });
  });
});
