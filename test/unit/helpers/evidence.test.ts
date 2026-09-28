import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Keypair } from "@stellar/stellar-sdk";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CloseReport, SubmittedTransaction } from "../../../src/execute/report.js";
import type { FixtureManifest } from "../../../src/fixture/manifest.js";
import type { VerifyResult } from "../../../src/fixture/verify.js";
import { hashHex } from "../../../src/sponsor/fee-bump.js";
import { keypairSigner } from "../../../src/sponsor/signer.js";
import { FeeSponsor } from "../../../src/sponsor/sponsor.js";
import { buildInnerTransaction } from "../../../src/tx/build-inner.js";
import { planFromSnapshot } from "../../../src/plan/plan.js";
import { renderPlan } from "../../../src/render/plan-text.js";
import { runStamp, writeCloseEvidence, type CloseEvidence } from "../../helpers/evidence.js";
import { messy, messySnapshot } from "../../helpers/snapshots.js";

// Review finding R16: the evidence of a live close, written offline from a synthetic run. Keys come
// from fixed raw seeds at runtime; no secret key is ever spelled out in this file.

const TESTNET = "Test SDF Network ; September 2015";
const HORIZON = "https://horizon-testnet.stellar.org";
const EXPLORER = "https://stellar.expert/explorer/testnet";
const key = (n: number) => Keypair.fromRawEd25519Seed(Buffer.alloc(32, 60 + n));
const fixture = key(1);
const sponsor = key(2);
const destination = key(3).publicKey();
const reserveSponsor = key(4).publicKey();
const NOW = new Date("2026-09-26T12:00:30.123Z");

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "dustin-evidence-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** A really signed fee bump, so the scan runs over genuine envelope XDR and signatures. */
async function submitted(
  index: number,
  phase: SubmittedTransaction["phase"],
  ledger: number,
): Promise<SubmittedTransaction> {
  const inner = buildInnerTransaction({
    account: fixture.publicKey(),
    sequence: String(1000 + index),
    operations: [{ type: "manageData", name: `k${index}`, value: null }],
    networkPassphrase: TESTNET,
    maxTime: 1_790_000_000,
  });
  inner.sign(fixture);
  const bump = await new FeeSponsor(keypairSigner(sponsor), { networkPassphrase: TESTNET }).wrap(
    inner,
    100,
  );
  const hash = hashHex(bump);
  return {
    index,
    phase,
    stepIds: [`S0${index + 1}`],
    attempts: 1,
    attempt: 1,
    round: 0,
    sequence: inner.sequence,
    baseFeeStroops: 100,
    maxTime: 1_790_000_000,
    hash,
    innerHash: hashHex(inner),
    result: "applied",
    ledger,
    feeChargedStroops: 200,
    feeAccount: sponsor.publicKey(),
    innerEnvelopeXdr: inner.toXDR(),
    feeBumpEnvelopeXdr: bump.toXDR(),
    explorerUrl: `${EXPLORER}/tx/${hash}`,
  };
}

async function evidence(): Promise<CloseEvidence> {
  const transactions = [
    await submitted(0, "cleanup", 4_900_100),
    await submitted(1, "merge", 4_900_102),
  ];
  const report: CloseReport = {
    schemaVersion: 1,
    kind: "dustin-close-report",
    network: { passphrase: TESTNET, horizon: HORIZON },
    account: fixture.publicKey(),
    destination,
    feeSponsor: sponsor.publicKey(),
    planHash: "c".repeat(64),
    status: "closed",
    message: null,
    stop: null,
    startedAt: "2026-09-26T12:00:00.000Z",
    finishedAt: "2026-09-26T12:00:20.000Z",
    transactions,
    steps: [],
    replans: [],
    unclosable: [],
    blockers: [],
    warnings: [],
    recovery: {
      mergedXlm: "4.0000007",
      reservesReturnedToSponsors: [],
      feesPaidByAccount: "0",
      feesPaidBySponsorStroops: 400,
    },
    verification: {
      accountExists: false,
      horizonStatus: 404,
      checkedAt: "2026-09-26T12:00:21.000Z",
      accountUrl: `${EXPLORER}/account/${fixture.publicKey()}`,
    },
  };
  const manifest = {
    schemaVersion: 1,
    kind: "dustin-fixture",
    profile: "messy",
    id: "messy-20260926T115500Z-abc123",
    createdAt: "2026-09-26T11:55:00.000Z",
    network: { passphrase: TESTNET, horizonUrl: HORIZON, explorerBaseUrl: EXPLORER },
    createdAtLedger: 4_900_000,
    recipeHash: "d".repeat(64),
    accounts: {
      sponsor: sponsor.publicKey(),
      reserveSponsor,
      issuer: key(5).publicKey(),
      marketMaker: key(6).publicKey(),
      destination,
      fixture: fixture.publicKey(),
    },
    assets: [],
    offers: [],
    dataEntries: ["dustin.fixture"],
    expected: {
      subentryCount: 7,
      numSponsored: 1,
      baseReserve: "0.5000000",
      balance: "4.0000000",
      minimumBalance: "4.0000000",
      spendable: "0.0000000",
    },
    transactions: [],
    zeroSpendableProof: { resultCode: "tx_insufficient_balance", sequenceUnchanged: true },
    liquidPath: {
      asset: "DUSTA",
      sourceAmount: "0.0000007",
      destinationAmount: "0.0000007",
      path: [],
    },
    verification: { pass: true, checks: [] },
  } satisfies FixtureManifest;
  const verification: VerifyResult = {
    pass: true,
    checks: [
      {
        id: "zero-spendable-xlm",
        label: "holds zero spendable XLM",
        appendixB: true,
        pass: true,
        observed: "balance 4.0000000, minimum 4.0000000, spendable 0.0000000",
        expected: "spendable 0.0000000",
      },
    ],
  };
  return {
    report,
    manifest,
    verification,
    accountBefore: { id: fixture.publicKey(), subentry_count: 7 },
    transactions: transactions.map((t) => ({
      hash: t.hash,
      record: {
        hash: t.hash,
        successful: true,
        ledger: t.ledger,
        fee_account: sponsor.publicKey(),
        source_account: fixture.publicKey(),
        envelope_xdr: t.feeBumpEnvelopeXdr,
      },
    })),
    accountAfter: { status: 404, body: { status: 404, title: "Resource Missing" } },
    balances: [
      {
        role: "Destination",
        account: destination,
        before: { balance: "10.0000000", numSponsoring: 0 },
        after: { balance: "14.0000007", numSponsoring: 0 },
      },
      {
        role: "Reserve sponsor",
        account: reserveSponsor,
        before: { balance: "9.9999900", numSponsoring: 1 },
        after: { balance: "9.9999900", numSponsoring: 0 },
      },
    ],
    ledgers: { before: 4_900_099, after: 4_900_104 },
  };
}

describe("writeCloseEvidence", () => {
  it("writes every file of a run under evidence/runs/<UTC stamp>", async () => {
    const e = await evidence();
    const dir = writeCloseEvidence(e, { root, now: NOW });
    expect(dir).toBe(join(root, "20260926T120030Z"));
    expect(readdirSync(dir).sort()).toEqual([
      "account-after.json",
      "account-before.json",
      "balances.json",
      "fixture-manifest.json",
      "fixture-verification.json",
      "report.json",
      "summary.md",
      "tx-1.json",
      "tx-2.json",
    ]);
    const read = (name: string) => JSON.parse(readFileSync(join(dir, name), "utf8")) as unknown;
    expect(read("report.json")).toEqual(e.report);
    expect(read("fixture-manifest.json")).toEqual(e.manifest);
    expect(read("fixture-verification.json")).toEqual(e.verification);
    expect(read("tx-2.json")).toEqual({
      hash: e.report.transactions[1]!.hash,
      horizon: e.transactions[1]!.record,
    });
    expect(read("account-after.json")).toEqual({ status: 404, body: e.accountAfter.body });
    expect(read("balances.json")).toEqual({ ledgers: e.ledgers, accounts: e.balances });
  });

  it("summarises the run with explorer links, the date, the ledgers and the network passphrase", async () => {
    const e = await evidence();
    const text = readFileSync(
      join(writeCloseEvidence(e, { root, now: NOW }), "summary.md"),
      "utf8",
    );
    for (const t of e.report.transactions) {
      expect(text).toContain(`${EXPLORER}/tx/${t.hash}`);
      expect(text).toContain(`${HORIZON}/transactions/${t.hash}`);
    }
    expect(text).toContain(`${EXPLORER}/account/${fixture.publicKey()}`);
    expect(text).toContain(`${EXPLORER}/account/${destination}`);
    expect(text).toContain(`${EXPLORER}/account/${sponsor.publicKey()}`);
    expect(text).toContain("2026-09-26T12:00:30.123Z");
    expect(text).toContain(`\`${TESTNET}\``);
    expect(text).toContain("transactions 4900100, 4900102");
    expect(text).toMatch(/\| yes \| yes \(sponsor\) \| yes \|/);
    expect(text).toContain("answered HTTP 404: the account no longer exists");
    expect(text).toContain("10.0000000 -> 14.0000007 XLM (+4.0000007), sponsoring 0 -> 0");
    expect(text).toContain("sponsoring 1 -> 0");
    expect(text).toContain("2026-12-16");
  });

  it("marks an envelope that never reached the ledger instead of treating it as a failure", async () => {
    const e = await evidence();
    // A retry (E2-S3): the first envelope of tx 1 was refused, the second one applied.
    const refused = {
      ...e.report.transactions[0]!,
      hash: "e".repeat(64),
      result: "rejected" as const,
    };
    e.report.transactions.unshift(refused);
    e.transactions.unshift({ hash: refused.hash, record: null });
    const text = readFileSync(
      join(writeCloseEvidence(e, { root, now: NOW }), "summary.md"),
      "utf8",
    );
    expect(text).toContain(`\`${refused.hash}\` | - | - | not on the ledger (rejected)`);
    expect(text).toMatch(/\| yes \| yes \(sponsor\) \| yes \|/);
  });

  it("refuses a seed-shaped string in any file and writes nothing", async () => {
    const secret = Keypair.random().secret();
    const inReport = await evidence();
    inReport.report.message = `stopped; key ${secret}`;
    const inRecord = await evidence();
    inRecord.transactions[0]!.record = { memo: `%3D${secret}` };
    for (const e of [inReport, inRecord]) {
      let error: unknown;
      try {
        writeCloseEvidence(e, { root, now: NOW });
      } catch (caught) {
        error = caught;
      }
      expect(String(error)).toMatch(/Refusing to write evidence: .* contains a secret seed/);
      // The refusal names the file, never the secret.
      expect(String(error)).not.toContain(secret);
      expect(existsSync(join(root, runStamp(NOW)))).toBe(false);
    }
  });

  it("refuses the fixture's secrets even when they are not seed-shaped", async () => {
    const e = await evidence();
    e.accountBefore = { note: "marker-0123" };
    expect(() =>
      writeCloseEvidence(e, { root, now: NOW, forbidden: ["unused", "marker-0123"] }),
    ).toThrow(/account-before.json contains a forbidden secret/);
    expect(readdirSync(root)).toEqual([]);
  });

  it("never overwrites an earlier run", async () => {
    const e = await evidence();
    const dir = writeCloseEvidence(e, { root, now: NOW });
    const later = await evidence();
    later.report.status = "failed";
    expect(() => writeCloseEvidence(later, { root, now: NOW })).toThrow(/EEXIST/);
    expect(JSON.parse(readFileSync(join(dir, "report.json"), "utf8"))).toMatchObject({
      status: "closed",
    });
  });

  it("adds the approved plan and the ladder as planned and as run, under <stamp>-<label>", async () => {
    const e = await evidence();
    const plan = planFromSnapshot(await messySnapshot(), {
      destination: messy.destination,
      feeSponsor: messy.sponsor,
      baseFeeStroops: 100,
    });
    const sale = plan.steps.find((st) => st.disposal?.rung === "path_payment")!;
    const burn = plan.steps.find((st) => st.disposal?.rung === "return_to_issuer")!;
    // The sale failed on the market and fell down the ladder (E2-S3); the burn applied as planned.
    e.report.steps = [
      {
        stepId: sale.id,
        status: "applied",
        txIndex: 1,
        txHash: "e".repeat(64),
        rung: "return_to_issuer",
        round: 1,
      },
      {
        stepId: burn.id,
        status: "applied",
        txIndex: 0,
        txHash: "f".repeat(64),
        rung: "return_to_issuer",
      },
    ];
    e.plan = plan;
    e.planText = renderPlan(plan);
    const dir = writeCloseEvidence(e, { root, now: NOW, label: "e3" });
    expect(dir).toBe(join(root, "20260926T120030Z-e3"));
    expect(JSON.parse(readFileSync(join(dir, "plan.json"), "utf8"))).toMatchObject({
      planHash: plan.planHash,
      ladderOrder: "sow",
    });
    expect(readFileSync(join(dir, "plan.txt"), "utf8")).toContain("Dustin plan");
    const text = readFileSync(join(dir, "summary.md"), "utf8");
    expect(text).toContain("# Live close 20260926T120030Z-e3");
    expect(text).toContain("## Disposal ladder");
    expect(text).toContain(
      `| ${sale.id} | DUSTA:${messy.issuer} | 0.0000007 | path_payment | return_to_issuer | applied | \`${"e".repeat(64)}\` |`,
    );
    expect(text).toContain("`plan.json`");
  });

  it("refuses a label that is not lower-case letters, digits and hyphens, writing nothing", async () => {
    const e = await evidence();
    for (const label of ["E3", "e3/../x", "", "-e3"]) {
      expect(() => writeCloseEvidence(e, { root, now: NOW, label })).toThrow(/label/);
    }
    expect(readdirSync(root)).toEqual([]);
  });

  it("names runs by UTC second", () => {
    expect(runStamp(new Date("2026-12-16T17:00:00.999Z"))).toBe("20261216T170000Z");
  });
});
