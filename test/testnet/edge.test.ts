import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Account, Keypair, Operation, TransactionBuilder, type xdr } from "@stellar/stellar-sdk";
import { afterAll, beforeAll, expect, it } from "vitest";
import { toStroops } from "../../src/amounts.js";
import { baseFeeFromFeeStats, type FeeStatsLike } from "../../src/config/fees.js";
import { DEFAULT_HORIZON_URL, TESTNET_PASSPHRASE } from "../../src/config/network.js";
import { containsSecretSeed } from "../../src/errors/redact.js";
import { executeClose, type CloseReport } from "../../src/execute/executor.js";
import {
  horizonSubmitter,
  submitAndConfirm,
  type SubmitOutcome,
  type Submitter,
} from "../../src/execute/submit.js";
import { buildEdgeFixture, type EdgeBuildResult } from "../../src/fixture/edge-builder.js";
import { edgeAsset, type EdgeKeyRole, type EdgeVariantRole } from "../../src/fixture/edge.js";
import type { HorizonAccount } from "../../src/inspect/horizon-types.js";
import { inspectAccount } from "../../src/inspect/inspect.js";
import type { ClosePlan, OperationDescriptor } from "../../src/plan/model.js";
import { planClose } from "../../src/plan/plan-close.js";
import { horizonJson, latestLedger } from "../../src/reader/horizon-json.js";
import { hashHex, wrapInFeeBump } from "../../src/sponsor/fee-bump.js";
import { keypairSigner } from "../../src/sponsor/signer.js";
import { FeeSponsor } from "../../src/sponsor/sponsor.js";
import { buildInnerTransaction } from "../../src/tx/build-inner.js";
import { describeTestnet } from "./gate.js";

/**
 * The D3 edge rows live (docs/edge-cases-and-test-matrix.md section 4): one fresh `edge` fixture
 * per run (`buildEdgeFixture`, every account a Friendbot-funded throwaway), then one test per row
 * on the variant built for it. Every transaction, the probes included, is fee-bumped by the
 * fixture's sponsor, and every hash is printed at the end with its purpose.
 *
 * DUSTIN_TESTNET=1 npx vitest run --project testnet test/testnet/edge.test.ts
 * With DUSTIN_RECORD=1 the Horizon JSON the planner read right after the build (before any test
 * touched an account) is saved as the offline vectors in test/fixtures/horizon/edge/.
 */
const RECORD_DIR = "test/fixtures/horizon/edge";

let built: EdgeBuildResult;
const client = horizonJson(DEFAULT_HORIZON_URL);
const hashes: Array<{ row: string; purpose: string; hash: string; ledger?: number | null }> = [];
let baseFee = 100;

const key = (role: EdgeKeyRole) => Keypair.fromSecret(built.keys.secrets[role]);
const pub = (role: EdgeKeyRole) => key(role).publicKey();
const destination = () => built.manifest.accounts.destination;
const signersFor = (role: EdgeVariantRole) => ({
  account: keypairSigner(key(role)),
  feeSponsor: keypairSigner(key("sponsor")),
});
const account = (role: EdgeKeyRole) => client.get<HorizonAccount>(`/accounts/${pub(role)}`);
const plan = (role: EdgeVariantRole) =>
  planClose({ account: pub(role), destination: destination(), feeSponsor: pub("sponsor") });

function recordReport(row: string, purpose: string, report: CloseReport): void {
  for (const t of report.transactions) {
    hashes.push({
      row,
      purpose: `${purpose} (${t.phase}, ${t.result})`,
      hash: t.hash,
      ledger: t.ledger,
    });
  }
}

/**
 * Operations from a variant account outside any plan, fee-bumped by the sponsor, for the negative
 * probes: what Dustin never submits, applied with the ledger's rules.
 */
async function probe(
  row: string,
  purpose: string,
  role: EdgeVariantRole,
  operations: OperationDescriptor[],
): Promise<SubmitOutcome> {
  const source = (await account(role))!;
  const ledger = await latestLedger(client);
  const maxTime = Math.floor(Date.parse(ledger.closed_at) / 1000) + 120;
  const inner = buildInnerTransaction({
    account: pub(role),
    sequence: source.sequence,
    operations,
    networkPassphrase: TESTNET_PASSPHRASE,
    maxTime,
  });
  await keypairSigner(key(role)).sign(inner);
  const sponsor = new FeeSponsor(keypairSigner(key("sponsor")), {
    networkPassphrase: TESTNET_PASSPHRASE,
  });
  const bump = await sponsor.wrap(inner, baseFee);
  const outcome = await submitAndConfirm(horizonSubmitter(DEFAULT_HORIZON_URL), {
    xdr: bump.toXDR(),
    hash: hashHex(bump),
    maxTime,
  });
  hashes.push({
    row,
    purpose,
    hash: outcome.hash,
    ledger: "ledger" in outcome ? outcome.ledger : null,
  });
  return outcome;
}

/** An issuer's own operations (a revocation, a clawback), fee-bumped by the sponsor. */
async function asIssuer(
  row: string,
  purpose: string,
  role: "authIssuer" | "clawbackIssuer",
  operations: xdr.Operation[],
): Promise<void> {
  const source = (await account(role))!;
  const builder = new TransactionBuilder(new Account(pub(role), source.sequence), {
    fee: "0",
    networkPassphrase: TESTNET_PASSPHRASE,
  }).setTimeout(120);
  for (const op of operations) builder.addOperation(op);
  const inner = builder.build();
  inner.sign(key(role));
  const bump = wrapInFeeBump(inner, key("sponsor"), baseFee, TESTNET_PASSPHRASE);
  const outcome = await submitAndConfirm(horizonSubmitter(DEFAULT_HORIZON_URL), {
    xdr: bump.toXDR(),
    hash: hashHex(bump),
    maxTime: Number(inner.timeBounds!.maxTime),
  });
  hashes.push({
    row,
    purpose,
    hash: outcome.hash,
    ledger: "ledger" in outcome ? outcome.ledger : null,
  });
  expect(outcome.kind, purpose).toBe("applied");
}

/**
 * Horizon's submitter, except that `before` runs once, right before the first envelope is posted:
 * after the executor re-planned from the ledger and signed, so the ledger changes under a plan it
 * already approved (edge case C-04).
 */
function actingBeforeFirstPost(before: () => Promise<void>): Submitter {
  const base = horizonSubmitter(DEFAULT_HORIZON_URL);
  let acted = false;
  return {
    transaction: (hash) => base.transaction(hash),
    lookup: (hash) => base.lookup!(hash),
    async submit(envelopeXdr) {
      if (!acted) {
        acted = true;
        await before();
      }
      return base.submit(envelopeXdr);
    },
  };
}

const credit = (code: "FRZ" | "LPA", role: "authIssuer" | "plainIssuer") => ({
  type: "credit_alphanum4" as const,
  code,
  issuer: pub(role),
});
const kinds = (p: ClosePlan) => p.steps.map((s) => s.kind);
/** The account's non-native balances, sorted (Horizon lists a pool share before the others). */
const lines = (a: HorizonAccount | null) =>
  (a?.balances ?? [])
    .filter((b) => b.asset_type !== "native")
    .map((b) => b.asset_code ?? b.asset_type)
    .sort();

describeTestnet("edge fixture and the D3 edge rows (live testnet)", () => {
  beforeAll(async () => {
    built = await buildEdgeFixture({ log: (line) => console.log(line) });
    baseFee = baseFeeFromFeeStats((await client.get<FeeStatsLike>("/fee_stats"))!);
    for (const t of built.manifest.transactions) {
      hashes.push({
        row: "build",
        purpose: `edge build: ${t.step}`,
        hash: t.hash,
        ledger: t.ledger,
      });
    }
    if (process.env.DUSTIN_RECORD === "1") saveVectors(built);
  }, 600_000);

  afterAll(() => {
    if (!built) return;
    console.log(
      JSON.stringify(
        {
          fixture: built.manifest.id,
          variants: Object.fromEntries(built.manifest.variants.map((v) => [v.name, v.account])),
          helpers: {
            sponsor: built.manifest.accounts.sponsor,
            destination: built.manifest.accounts.destination,
            authIssuer: built.manifest.accounts.authIssuer,
            clawbackIssuer: built.manifest.accounts.clawbackIssuer,
            plainIssuer: built.manifest.accounts.plainIssuer,
            multisigSigner: built.manifest.multisigSigner,
          },
          pool: built.manifest.pool.id,
          hashes,
        },
        null,
        2,
      ),
    );
  });

  it("builds every variant as its recipe says, and the planner makes of each what the manifest expects", async () => {
    expect(built.manifest.verification.checks.filter((c) => !c.pass)).toEqual([]);
    expect(built.manifest.variants.every((v) => v.spendable === "0.0000000")).toBe(true);
    for (const t of built.manifest.transactions.filter((x) => x.step !== "create-accounts")) {
      expect(t.feeBumped).toBe(true);
    }
    for (const v of built.manifest.variants) {
      const p = await plan(v.role);
      expect(
        {
          status: p.status,
          blockers: p.blockers.map((b) => b.code),
          unclosable: p.unclosable.map((u) => u.code),
          steps: kinds(p),
        },
        v.name,
      ).toEqual(v.expected);
      for (const x of [...p.blockers, ...p.unclosable]) {
        expect(x.reason.trim(), v.name).not.toBe("");
        expect(x.remedy.trim(), v.name).not.toBe("");
      }
    }
    const everySecret = Object.values(built.keys.secrets);
    const manifestText = JSON.stringify(built.manifest);
    expect(everySecret.some((s) => manifestText.includes(s))).toBe(false);
  }, 300_000);

  it("S-01: the illiquid ILQX (no market, live issuer) has no strict-send path, so the plan returns it to its issuer", async () => {
    const ilqxPaths = await client.get<{ _embedded: { records: unknown[] } }>(
      `/paths/strict-send?source_asset_type=credit_alphanum4&source_asset_code=ILQX&source_asset_issuer=${pub("plainIssuer")}&source_amount=0.0000003&destination_assets=native`,
    );
    expect(ilqxPaths?._embedded.records).toEqual([]);
    const p = await plan("authFrozen");
    const ilqx = p.steps.find(
      (s) =>
        s.kind === "dispose_balance" &&
        s.subject.type === "trustline" &&
        s.subject.asset.code === "ILQX",
    )!;
    expect(ilqx.disposal).toMatchObject({ rung: "return_to_issuer", to: pub("plainIssuer") });
    expect(ilqx.disposal!.ruledOut).toEqual([
      {
        rung: "path_payment",
        reason: "Horizon found no strict-send path to XLM for the full balance",
      },
      expect.objectContaining({ rung: "send_to_destination" }),
    ]);
    expect(ilqx.operation).toMatchObject({ type: "payment", destination: pub("plainIssuer") });
  }, 120_000);

  it("S-02 (with S-01 applied): the frozen FRZ is unclosable before any submission; the partial close burns ILQX, removes it and the data entry, and stops before the merge", async () => {
    const before = await account("authFrozen");
    const p = await plan("authFrozen");
    expect(p.status).toBe("partial");
    expect(p.unclosable).toHaveLength(1);
    expect(p.unclosable[0]).toMatchObject({ code: "TRUSTLINE_NOT_AUTHORIZED", blocksMerge: true });
    expect(p.unclosable[0]!.reason).toContain(pub("authIssuer"));
    expect(kinds(p)).not.toContain("merge");
    const refused = await executeClose(p, signersFor("authFrozen"), { confirm: true });
    expect(refused).toMatchObject({ status: "aborted", transactions: [] });
    expect(refused.stop?.code).toBe("PLAN_NOT_CLOSABLE");
    expect((await account("authFrozen"))!.sequence).toBe(before!.sequence);

    const report = await executeClose(p, signersFor("authFrozen"), {
      confirm: true,
      allowPartial: true,
    });
    recordReport("S-02", "auth-frozen partial close", report);
    expect(report.status).toBe("partial");
    expect(report.transactions.map((t) => t.result)).toEqual(["applied"]);
    expect(report.unclosable.map((u) => u.code)).toEqual(["TRUSTLINE_NOT_AUTHORIZED"]);
    expect(report.steps.find((s) => s.rung)).toMatchObject({
      rung: "return_to_issuer",
      status: "applied",
    });
    const after = await account("authFrozen");
    // The account remains, with exactly one trustline: the frozen FRZ (PRD section 9.2).
    expect(lines(after)).toEqual(["FRZ"]);
    expect(after!.data).toEqual({});
    const tx = await client.get<{ fee_account: string; source_account: string }>(
      `/transactions/${report.transactions[0]!.hash}`,
    );
    expect(tx).toMatchObject({ fee_account: pub("sponsor"), source_account: pub("authFrozen") });
  }, 300_000);

  it("S-02 negative probe (AC-E3-S6-3): a payment of the frozen FRZ to its issuer fails with op_src_not_authorized", async () => {
    const outcome = await probe(
      "S-02",
      "negative probe: pay frozen FRZ to its issuer",
      "authFrozen",
      [
        {
          type: "payment",
          destination: pub("authIssuer"),
          asset: credit("FRZ", "authIssuer"),
          amount: "0.0000005",
        },
      ],
    );
    expect(outcome).toMatchObject({
      kind: "failed",
      codes: {
        transaction: "tx_fee_bump_inner_failed",
        innerTransaction: "tx_failed",
        operations: ["op_src_not_authorized"],
      },
    });
    const removal = await probe(
      "S-02",
      "negative probe: remove FRZ with its balance",
      "authFrozen",
      [{ type: "changeTrust", asset: credit("FRZ", "authIssuer"), limit: "0" }],
    );
    expect(removal).toMatchObject({ kind: "failed", codes: { operations: ["op_invalid_limit"] } });
    expect(lines(await account("authFrozen"))).toEqual(["FRZ"]);
  }, 180_000);

  it("S-02 forced with allowPartial (AC-E3-S6-3): the trustline is revoked after planning, the planned return fails with op_src_not_authorized and is reported, and the rest runs", async () => {
    const p = await plan("authRevoke");
    expect(p.status).toBe("closable");
    const revoke = () =>
      asIssuer("S-02", "issuer revokes RVK after the plan (C-04)", "authIssuer", [
        Operation.setTrustLineFlags({
          trustor: pub("authRevoke"),
          asset: edgeAsset("RVK", {
            ...built.manifest.accounts,
            multisigSigner: built.manifest.multisigSigner,
          }),
          flags: { authorized: false },
        }),
      ]);
    const report = await executeClose(p, signersFor("authRevoke"), {
      confirm: true,
      allowPartial: true,
      submitter: actingBeforeFirstPost(revoke),
    });
    recordReport("S-02", "auth-revoke close forced with allowPartial", report);
    expect(report.status).toBe("partial");
    const [first, ...rest] = report.transactions;
    expect(first).toMatchObject({ result: "failed" });
    expect(first!.resultCodes?.operations).toContain("op_src_not_authorized");
    expect(first!.explanation).toMatch(/no longer authorizes/);
    const payment = report.steps.find((s) => s.status === "failed");
    expect(payment?.explanation).toMatch(/no longer authorizes/);
    expect(payment?.resultCodes?.operations).toContain("op_src_not_authorized");
    expect(report.replans).toHaveLength(1);
    expect(report.replans[0]!.trigger.resultCodes.operations).toContain("op_src_not_authorized");
    expect(report.unclosable.map((u) => u.code)).toEqual(["TRUSTLINE_NOT_AUTHORIZED"]);
    expect(rest.map((t) => t.result)).toEqual(["applied"]);
    const after = await account("authRevoke");
    expect(lines(after)).toEqual(["RVK"]);
    expect(after!.data).toEqual({});
  }, 300_000);

  it("S-05: an authorized trustline of an AUTH_REQUIRED issuer is returned to the issuer and the account closes", async () => {
    const p = await plan("authAuthorized");
    expect(p.status).toBe("closable");
    expect(p.transactions).toHaveLength(1);
    const destinationBefore = await account("destination");
    const report = await executeClose(p, signersFor("authAuthorized"), { confirm: true });
    recordReport("S-05", "auth-authorized full close", report);
    expect(report.status).toBe("closed");
    expect(report.verification).toMatchObject({ accountExists: false, horizonStatus: 404 });
    expect(report.steps.find((s) => s.rung)).toMatchObject({
      rung: "return_to_issuer",
      status: "applied",
    });
    expect(await account("authAuthorized")).toBeNull();
    const destinationAfter = await account("destination");
    const native = (a: HorizonAccount | null) =>
      toStroops(a!.balances.find((b) => b.asset_type === "native")!.balance);
    expect(native(destinationAfter) - native(destinationBefore)).toBe(
      toStroops(report.recovery.mergedXlm!),
    );
    expect(report.recovery.mergedXlm).toBe("1.5000000");
  }, 300_000);

  it("S-06: the maintain-liabilities MNT stays unclosable while its open offer is cancelled; the account keeps only the MNT trustline", async () => {
    const p = await plan("authMaintain");
    expect(p.status).toBe("partial");
    expect(p.unclosable.map((u) => u.code)).toEqual(["MAINTAIN_LIABILITIES_ONLY"]);
    expect(kinds(p)).toEqual(["cancel_offer"]);
    const report = await executeClose(p, signersFor("authMaintain"), {
      confirm: true,
      allowPartial: true,
    });
    recordReport("S-06", "auth-maintain partial close (cancel the offer)", report);
    expect(report.status).toBe("partial");
    expect(report.transactions.map((t) => t.result)).toEqual(["applied"]);
    const offers = await client.get<{ _embedded: { records: unknown[] } }>(
      `/accounts/${pub("authMaintain")}/offers`,
    );
    expect(offers?._embedded.records).toEqual([]);
    const mnt = (await account("authMaintain"))!.balances.find((b) => b.asset_code === "MNT");
    expect(mnt).toMatchObject({
      balance: "0.0000005",
      is_authorized: false,
      is_authorized_to_maintain_liabilities: true,
      selling_liabilities: "0.0000000",
    });
  }, 300_000);

  it("S-07 (AC-E3-S6-4): the inspector surfaces is_clawback_enabled, the planner warns, and the return to the issuer closes the account", async () => {
    const snapshot = await inspectAccount(pub("clawback"), { destination: destination() });
    if (!snapshot.exists) throw new Error("clawback account missing");
    expect(snapshot.trustlines.map((t) => [t.asset.code, t.clawbackEnabled])).toEqual([
      ["CLAW", true],
    ]);
    const p = await plan("clawback");
    expect(p.status).toBe("closable");
    expect(p.warnings.join(" ")).toMatch(/CLAW.*clawback-enabled/);
    const report = await executeClose(p, signersFor("clawback"), { confirm: true });
    recordReport("S-07", "clawback full close", report);
    expect(report.status).toBe("closed");
    expect(report.verification).toMatchObject({ accountExists: false, horizonStatus: 404 });
    expect(report.steps.find((s) => s.rung)).toMatchObject({
      rung: "return_to_issuer",
      status: "applied",
    });
  }, 300_000);

  it("S-07b: the issuer claws the dust back after planning; the return fails with op_underfunded, the executor re-plans and closes", async () => {
    const p = await plan("clawbackDrift");
    expect(p.status).toBe("closable");
    const clawBack = () =>
      asIssuer("S-07", "issuer claws back CLAW after the plan (S-07b)", "clawbackIssuer", [
        Operation.clawback({
          asset: edgeAsset("CLAW", {
            ...built.manifest.accounts,
            multisigSigner: built.manifest.multisigSigner,
          }),
          from: pub("clawbackDrift"),
          amount: "0.0000004",
        }),
      ]);
    const report = await executeClose(p, signersFor("clawbackDrift"), {
      confirm: true,
      submitter: actingBeforeFirstPost(clawBack),
    });
    recordReport("S-07", "clawback-drift close (S-07b)", report);
    expect(report.status).toBe("closed");
    expect(report.transactions[0]).toMatchObject({ result: "failed" });
    expect(report.transactions[0]!.resultCodes?.operations).toContain("op_underfunded");
    expect(report.replans).toHaveLength(1);
    expect(report.transactions.at(-1)).toMatchObject({ result: "applied" });
    expect(report.verification).toMatchObject({ accountExists: false, horizonStatus: 404 });
  }, 300_000);

  it("S-08: pool shares block the merge with the pool id in the remedy; ChangeTrust(0) on LPA fails with op_cannot_delete; the partial close removes only the data entry", async () => {
    const poolId = built.manifest.pool.id;
    const p = await plan("poolShare");
    expect(p.status).toBe("blocked");
    const blocker = p.blockers.find((b) => b.code === "LIQUIDITY_POOL_SHARES")!;
    expect(blocker.remedy).toContain(
      `Withdraw from pool ${poolId} first (LiquidityPoolWithdraw); Dustin does not withdraw.`,
    );
    expect(blocker.reason).toContain(`${built.manifest.pool.shares} shares of pool ${poolId}`);
    expect(p.unclosable.map((u) => u.code)).toEqual([
      "POOL_ASSET_TRUSTLINE",
      "POOL_ASSET_TRUSTLINE",
    ]);
    expect(p.steps.filter((s) => s.operation.type === "changeTrust")).toEqual([]);
    const outcome = await probe(
      "S-08",
      "negative probe: remove LPA while the pool share exists",
      "poolShare",
      [{ type: "changeTrust", asset: credit("LPA", "plainIssuer"), limit: "0" }],
    );
    expect(outcome).toMatchObject({
      kind: "failed",
      codes: { innerTransaction: "tx_failed", operations: ["op_cannot_delete"] },
    });
    const report = await executeClose(p, signersFor("poolShare"), {
      confirm: true,
      allowPartial: true,
    });
    recordReport("S-08", "pool-share partial close (data entry only)", report);
    expect(report.status).toBe("partial");
    expect(report.blockers.map((b) => b.code)).toContain("LIQUIDITY_POOL_SHARES");
    const after = await account("poolShare");
    expect(lines(after)).toEqual(["LPA", "LPB", "liquidity_pool_shares"]);
    expect(after!.data).toEqual({});
  }, 300_000);

  it("S-09 (AC-E3-S5-5): THRESHOLD_UNMET names both weights; without allowPartial nothing is signed; with it the data entry goes and the merge is left out", async () => {
    const before = await account("multisig");
    const p = await plan("multisig");
    expect(p.status).toBe("blocked");
    const blocker = p.blockers.find((b) => b.code === "THRESHOLD_UNMET")!;
    expect(blocker.reason).toContain("The master key has weight 1");
    expect(blocker.reason).toContain("Blocked: the merge needs weight 2");
    expect(blocker.reason).toContain(`${built.manifest.multisigSigner} (weight 1)`);
    const refused = await executeClose(p, signersFor("multisig"), { confirm: true });
    expect(refused).toMatchObject({ status: "aborted", transactions: [] });
    expect(refused.stop?.code).toBe("PLAN_NOT_CLOSABLE");
    expect((await account("multisig"))!.sequence).toBe(before!.sequence);
    const report = await executeClose(p, signersFor("multisig"), {
      confirm: true,
      allowPartial: true,
    });
    recordReport("S-09", "multisig partial close (data entry only)", report);
    expect(report.status).toBe("partial");
    expect(report.transactions.map((t) => t.result)).toEqual(["applied"]);
    const after = await account("multisig");
    expect(after!.data).toEqual({});
    expect(after!.thresholds.high_threshold).toBe(2);
    expect(after!.signers.map((s) => s.weight).sort()).toEqual([1, 1]);
  }, 300_000);

  it("X-01: a claimable balance the account created blocks the merge (IS_SPONSOR); a merge attempt fails with op_is_sponsor", async () => {
    const p = await plan("claimable");
    expect(p.blockers.map((b) => b.code)).toEqual(["IS_SPONSOR"]);
    expect(p.blockers[0]!.reason).toContain("including 1 claimable balance(s) it created");
    expect(p.blockers[0]!.remedy).toContain("Revoke or transfer your sponsorships first");
    const refused = await executeClose(p, signersFor("claimable"), {
      confirm: true,
      allowPartial: true,
    });
    expect(refused).toMatchObject({ status: "aborted", transactions: [] });
    const outcome = await probe(
      "X-01",
      "negative probe: merge while sponsoring a claimable balance",
      "claimable",
      [{ type: "accountMerge", destination: destination() }],
    );
    expect(outcome).toMatchObject({ kind: "failed", codes: { operations: ["op_is_sponsor"] } });
    expect(await account("claimable")).not.toBeNull();
  }, 180_000);

  it("X-04: AUTH_IMMUTABLE_SET is reported first and nothing is submitted; a merge attempt fails with op_immutable_set", async () => {
    const p = await plan("immutable");
    expect(p.blockers[0]!.code).toBe("AUTH_IMMUTABLE_SET");
    expect(p.blockers[0]!.reason).toContain("ACCOUNT_MERGE_IMMUTABLE_SET");
    expect(p.steps).toEqual([]);
    const refused = await executeClose(p, signersFor("immutable"), { confirm: true });
    expect(refused).toMatchObject({ status: "aborted", transactions: [] });
    const outcome = await probe(
      "X-04",
      "negative probe: merge an AUTH_IMMUTABLE account",
      "immutable",
      [{ type: "accountMerge", destination: destination() }],
    );
    expect(outcome).toMatchObject({ kind: "failed", codes: { operations: ["op_immutable_set"] } });
    expect(await account("immutable")).not.toBeNull();
  }, 180_000);
});

/** Writes the recorded responses and the public manifest, in the format of test/fixtures/horizon/messy. */
function saveVectors(result: EdgeBuildResult): void {
  const files = new Map<string, string>([
    ...Object.entries(result.recorded).map(([name, response]): [string, string] => [
      `${name}.json`,
      `${JSON.stringify(response, null, 2)}\n`,
    ]),
    ["manifest.json", `${JSON.stringify(result.manifest, null, 2)}\n`],
  ]);
  const secrets = Object.values(result.keys.secrets);
  for (const [name, content] of files) {
    if (containsSecretSeed(content) || secrets.some((s) => content.includes(s))) {
      throw new Error(`Refusing to record ${name}: it contains a secret seed.`);
    }
  }
  mkdirSync(RECORD_DIR, { recursive: true });
  for (const [name, content] of files) writeFileSync(join(RECORD_DIR, name), content);
}
