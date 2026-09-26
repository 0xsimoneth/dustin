import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  Account,
  Asset,
  Keypair,
  LiquidityPoolAsset,
  LiquidityPoolFeeV18,
  Operation,
  TransactionBuilder,
  getLiquidityPoolId,
} from "@stellar/stellar-sdk";
import { expect, it } from "vitest";
import { toStroops } from "../../src/amounts.js";
import { baseFeeFromFeeStats, type FeeStatsLike } from "../../src/config/fees.js";
import {
  DEFAULT_HORIZON_URL,
  FRIENDBOT_URL,
  TESTNET_PASSPHRASE,
} from "../../src/config/network.js";
import { containsSecretSeed } from "../../src/errors/redact.js";
import { executeClose } from "../../src/execute/executor.js";
import { horizonSubmitter, submitAndConfirm } from "../../src/execute/submit.js";
import type { HorizonAccount } from "../../src/inspect/horizon-types.js";
import { planClose } from "../../src/plan/plan-close.js";
import { horizonJson, latestLedger } from "../../src/reader/horizon-json.js";
import { hashHex } from "../../src/sponsor/fee-bump.js";
import { keypairSigner } from "../../src/sponsor/signer.js";
import { FeeSponsor } from "../../src/sponsor/sponsor.js";
import { buildInnerTransaction } from "../../src/tx/build-inner.js";
import { describeTestnet } from "./gate.js";

/**
 * Review finding R14, live: an empty pool-share trustline is removed with ChangeTrust limit "0"
 * before its pool's asset trustlines, inside Dustin's fee-bumped close. Protocol rules (CAP-38,
 * https://github.com/stellar/stellar-protocol/blob/master/core/cap-0038.md; stellar-core
 * ChangeTrustOpFrame): a pool-share trustline needs trustlines for the pool's assets, counts two
 * subentries, and while it exists those asset trustlines cannot be deleted
 * (CHANGE_TRUST_CANNOT_DELETE); the pool is erased with its last share trustline.
 *
 * Fresh throwaway accounts only: Friendbot funds the fee sponsor, which creates the rest. With
 * DUSTIN_RECORD=1 the Horizon responses the plan was made from are saved as offline vectors in
 * test/fixtures/horizon/pool-share/.
 */
const RECORD_DIR = "test/fixtures/horizon/pool-share";

describeTestnet("pool-share trustline removal (live testnet)", () => {
  it("removes an empty pool-share trustline before its asset trustlines and merges, every fee paid by the sponsor", async () => {
    const client = horizonJson(DEFAULT_HORIZON_URL);
    const submitter = horizonSubmitter(DEFAULT_HORIZON_URL);
    const [sponsor, issuer, holder, destination] = [0, 1, 2, 3].map(() => Keypair.random()) as [
      Keypair,
      Keypair,
      Keypair,
      Keypair,
    ];
    const funded = await fetch(`${FRIENDBOT_URL}/?addr=${encodeURIComponent(sponsor.publicKey())}`);
    expect(funded.ok, `Friendbot answered HTTP ${funded.status}`).toBe(true);
    const bid = baseFeeFromFeeStats((await client.get<FeeStatsLike>("/fee_stats"))!);

    // Two credit assets and their constant-product pool, assets in protocol order, fee 30 bps.
    const lpa = new Asset("LPA", issuer.publicKey());
    const lpb = new Asset("LPB", issuer.publicKey());
    const [assetA, assetB] = [lpa, lpb].sort((x, y) => Asset.compare(x, y)) as [Asset, Asset];
    const pool = new LiquidityPoolAsset(assetA, assetB, LiquidityPoolFeeV18);
    const poolId = Buffer.from(
      getLiquidityPoolId("constant_product", pool.getLiquidityPoolParameters()),
    ).toString("hex");

    // Setup, paid by the sponsor: three accounts, then the holder's two asset trustlines and the
    // pool-share trustline, without any deposit.
    const sponsorAccount = (await client.get<HorizonAccount>(`/accounts/${sponsor.publicKey()}`))!;
    const setup = new TransactionBuilder(
      new Account(sponsor.publicKey(), sponsorAccount.sequence),
      {
        fee: String(bid),
        networkPassphrase: TESTNET_PASSPHRASE,
      },
    )
      .addOperation(
        Operation.createAccount({ destination: issuer.publicKey(), startingBalance: "2" }),
      )
      .addOperation(
        Operation.createAccount({ destination: holder.publicKey(), startingBalance: "5" }),
      )
      .addOperation(
        Operation.createAccount({ destination: destination.publicKey(), startingBalance: "2" }),
      )
      .addOperation(Operation.changeTrust({ asset: lpa, source: holder.publicKey() }))
      .addOperation(Operation.changeTrust({ asset: lpb, source: holder.publicKey() }))
      .addOperation(Operation.changeTrust({ asset: pool, source: holder.publicKey() }))
      .setTimeout(120)
      .build();
    setup.sign(sponsor, holder);
    const created = await submitAndConfirm(submitter, {
      xdr: setup.toXDR(),
      hash: hashHex(setup),
      maxTime: Number(setup.timeBounds!.maxTime),
    });
    expect(created).toMatchObject({ kind: "applied" });

    // Horizon's view: an empty share trustline worth two subentries, and the pool it references.
    const loaded = (await client.get<HorizonAccount>(`/accounts/${holder.publicKey()}`))!;
    expect(loaded.subentry_count).toBe(4);
    expect(loaded.balances.find((b) => b.asset_type === "liquidity_pool_shares")).toMatchObject({
      liquidity_pool_id: poolId,
      balance: "0.0000000",
    });
    const poolRecord = await client.get<{ reserves: { asset: string }[] }>(
      `/liquidity_pools/${poolId}`,
    );
    expect(poolRecord?.reserves.map((r) => r.asset)).toEqual([
      `${assetA.getCode()}:${assetA.getIssuer()}`,
      `${assetB.getCode()}:${assetB.getIssuer()}`,
    ]);

    // Negative probe: deleting an asset trustline while the share trustline exists fails with
    // op_cannot_delete. Fee-bumped by the sponsor, so the holder's balance does not move.
    const feeSponsor = new FeeSponsor(keypairSigner(sponsor), {
      networkPassphrase: TESTNET_PASSPHRASE,
    });
    const ledger = await latestLedger(client);
    const maxTime = Math.floor(Date.parse(ledger.closed_at) / 1000) + 120;
    const probeInner = buildInnerTransaction({
      account: holder.publicKey(),
      sequence: loaded.sequence,
      operations: [
        {
          type: "changeTrust",
          asset: { type: "credit_alphanum4", code: "LPA", issuer: issuer.publicKey() },
          limit: "0",
        },
      ],
      networkPassphrase: TESTNET_PASSPHRASE,
      maxTime,
    });
    await keypairSigner(holder).sign(probeInner);
    const probeBump = await feeSponsor.wrap(probeInner, bid);
    const probe = await submitAndConfirm(submitter, {
      xdr: probeBump.toXDR(),
      hash: hashHex(probeBump),
      maxTime,
    });
    expect(probe).toMatchObject({
      kind: "failed",
      codes: {
        transaction: "tx_fee_bump_inner_failed",
        innerTransaction: "tx_failed",
        operations: ["op_cannot_delete"],
      },
    });

    // What Dustin plans from: saved as offline vectors when DUSTIN_RECORD=1.
    const vectors = {
      "account-holder": `/accounts/${holder.publicKey()}`,
      "offers-holder": `/accounts/${holder.publicKey()}/offers?limit=200&order=asc`,
      "account-destination": `/accounts/${destination.publicKey()}`,
      "liquidity-pool": `/liquidity_pools/${poolId}`,
      "fee-stats": "/fee_stats",
      "ledger-latest": "/ledgers?order=desc&limit=1",
    };
    const recorded = await Promise.all(
      Object.entries(vectors).map(async ([name, path]) => {
        const body = await client.get<unknown>(path);
        return { name, path, status: body === null ? 404 : 200, body };
      }),
    );

    // Dustin's plan: the share trustline first, then the asset trustlines, then the merge, in one
    // fee-bumped transaction (no market step).
    const destinationBefore = await nativeBalance(client, destination.publicKey());
    const plan = await planClose({
      account: holder.publicKey(),
      destination: destination.publicKey(),
      feeSponsor: sponsor.publicKey(),
    });
    expect(plan.status).toBe("closable");
    expect(
      plan.steps.map((s) => [
        s.kind,
        s.subject.type === "trustline" ? s.subject.asset.code : s.subject.type,
      ]),
    ).toEqual([
      ["remove_trustline", "pool_share"],
      ["remove_trustline", "LPA"],
      ["remove_trustline", "LPB"],
      ["merge", "account"],
    ]);
    expect(plan.transactions).toHaveLength(1);

    const report = await executeClose(
      plan,
      { account: keypairSigner(holder), feeSponsor: keypairSigner(sponsor) },
      { confirm: true },
    );
    expect(report.message).toBeNull();
    expect(report.status).toBe("closed");
    expect(report.verification).toMatchObject({ accountExists: false, horizonStatus: 404 });
    expect(await client.get(`/accounts/${holder.publicKey()}`)).toBeNull();
    for (const t of report.transactions) {
      expect(await client.get(`/transactions/${t.hash}`)).toMatchObject({
        fee_account: sponsor.publicKey(),
        source_account: holder.publicKey(),
        successful: true,
      });
    }
    // The failed probe was paid by the sponsor too, and consumed only a sequence number.
    expect(await client.get(`/transactions/${probe.hash}`)).toMatchObject({
      fee_account: sponsor.publicKey(),
      source_account: holder.publicKey(),
      successful: false,
    });
    // The holder never paid a fee: all 5 XLM it was created with reached the destination.
    expect(report.recovery.mergedXlm).toBe("5.0000000");
    expect((await nativeBalance(client, destination.publicKey())) - destinationBefore).toBe(
      toStroops("5.0000000"),
    );
    // The pool is erased with its last share trustline (CAP-38).
    expect(await client.get(`/liquidity_pools/${poolId}`)).toBeNull();

    const secrets = [sponsor, issuer, holder, destination].map((k) => k.secret());
    expect(secrets.some((s) => JSON.stringify(report).includes(s))).toBe(false);
    if (process.env.DUSTIN_RECORD === "1") {
      saveVectors(recorded, {
        note: "Recorded by test/testnet/pool-share-removal.test.ts before the close; public keys only.",
        recordedAt: new Date().toISOString(),
        accounts: {
          sponsor: sponsor.publicKey(),
          issuer: issuer.publicKey(),
          holder: holder.publicKey(),
          destination: destination.publicKey(),
        },
        poolId,
        poolAssets: [
          `${assetA.getCode()}:${assetA.getIssuer()}`,
          `${assetB.getCode()}:${assetB.getIssuer()}`,
        ],
        transactions: {
          setup: created.hash,
          cannotDeleteProbe: probe.hash,
          close: report.transactions.map((t) => t.hash),
        },
      });
    }
    console.log(
      JSON.stringify(
        {
          holder: holder.publicKey(),
          destination: destination.publicKey(),
          sponsor: sponsor.publicKey(),
          issuer: issuer.publicKey(),
          poolId,
          setup: created.hash,
          cannotDeleteProbe: probe.hash,
          close: report.transactions.map((t) => ({ hash: t.hash, ledger: t.ledger })),
        },
        null,
        2,
      ),
    );
  }, 300_000);
});

async function nativeBalance(
  client: ReturnType<typeof horizonJson>,
  account: string,
): Promise<bigint> {
  const record = await client.get<HorizonAccount>(`/accounts/${account}`);
  return toStroops(record!.balances.find((b) => b.asset_type === "native")!.balance);
}

/** Writes recorded responses in the format of test/fixtures/horizon/messy; refuses any seed. */
function saveVectors(
  recorded: Array<{ name: string; path: string; status: number; body: unknown }>,
  manifest: unknown,
): void {
  const files = new Map<string, string>([
    ...recorded.map(({ name, path, status, body }): [string, string] => [
      `${name}.json`,
      `${JSON.stringify({ path, status, body }, null, 2)}\n`,
    ]),
    ["manifest.json", `${JSON.stringify(manifest, null, 2)}\n`],
  ]);
  for (const [name, content] of files) {
    if (containsSecretSeed(content))
      throw new Error(`Refusing to record ${name}: it contains a secret seed.`);
  }
  mkdirSync(RECORD_DIR, { recursive: true });
  for (const [name, content] of files) writeFileSync(join(RECORD_DIR, name), content);
}
