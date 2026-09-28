import { appendFileSync } from "node:fs";
import { Horizon, Keypair, Operation, TransactionBuilder, type xdr } from "@stellar/stellar-sdk";
import { beforeAll, expect, it } from "vitest";
import { toStroops } from "../../src/amounts.js";
import { baseFeeFromFeeStats } from "../../src/config/fees.js";
import { DEFAULT_HORIZON_URL, TESTNET_PASSPHRASE } from "../../src/config/network.js";
import { executeClose, type CloseEvent, type Signers } from "../../src/execute/executor.js";
import type { CloseReport } from "../../src/execute/report.js";
import {
  horizonSubmitter,
  submitAndConfirm,
  type SubmitOutcome,
} from "../../src/execute/submit.js";
import { buildMessyFixture, type BuildResult } from "../../src/fixture/builder.js";
import type { HorizonAccount } from "../../src/inspect/horizon-types.js";
import type { ClosePlan, PlanOptions } from "../../src/plan/model.js";
import { planClose } from "../../src/plan/plan-close.js";
import { horizonJson, latestLedger } from "../../src/reader/horizon-json.js";
import { renderReport } from "../../src/render/report-text.js";
import { hashHex, wrapInFeeBump } from "../../src/sponsor/fee-bump.js";
import { keypairSigner, type Signer } from "../../src/sponsor/signer.js";
import { describeTestnet } from "./gate.js";

/**
 * Story E3-S4 live on testnet, matrix row S-04 (docs/edge-cases-and-test-matrix.md section 4): the
 * ACCOUNT_MERGE_SEQNUM_TOO_FAR guard. Each case builds its own fresh messy fixture from Friendbot
 * (buildMessyFixture creates every key in memory); the builder's baseline fixture is never touched.
 * The fixture's sequence number is bumped with BumpSequence, fee-bumped by the fixture's sponsor
 * since the fixture holds zero spendable XLM (day-1 experiment 5 bumped to (latestLedger + 20) << 32).
 *
 *   DUSTIN_TESTNET=1 npx vitest run --project testnet --reporter=verbose test/testnet/sequence-guard.test.ts
 *
 * Every hash is printed with its purpose and ledger; with DUSTIN_GUARD_RECORD=<file> it is also
 * appended to that file as one JSON line (public data only), for the story record.
 *
 * The rule (stellar-core MergeOpFrame::isSeqnumTooFar,
 * https://github.com/stellar/stellar-core/blob/master/src/transactions/MergeOpFrame.cpp): a merge
 * applied in ledger L fails when the account's sequence number, its own transaction's included, is
 * at or above L << 32. So a merge whose sequence number is s can land from ledger (s >> 32) + 1.
 */

const HORIZON = DEFAULT_HORIZON_URL;
const client = horizonJson(HORIZON);
const server = new Horizon.Server(HORIZON);
const submitter = horizonSubmitter(HORIZON);

type Fixture = Pick<BuildResult, "manifest" | "keys">;

function record(entry: Record<string, unknown>): void {
  const line = JSON.stringify({ at: new Date().toISOString(), ...entry });
  console.log(line);
  const file = process.env.DUSTIN_GUARD_RECORD;
  if (file) appendFileSync(file, `${line}\n`);
}

async function freshFixture(name: string): Promise<Fixture> {
  const { manifest, keys } = await buildMessyFixture();
  record({ case: name, fixture: manifest.id, accounts: manifest.accounts });
  for (const t of manifest.transactions) {
    record({ case: name, purpose: `fixture: ${t.step}`, hash: t.hash, ledger: t.ledger });
  }
  return { manifest, keys };
}

const keyOf = (f: Fixture, role: keyof Fixture["keys"]["secrets"]) =>
  Keypair.fromSecret(f.keys.secrets[role]);

const signersOf = (f: Fixture): Signers => ({
  account: keypairSigner(keyOf(f, "fixture")),
  feeSponsor: keypairSigner(keyOf(f, "sponsor")),
});

const planFor = (f: Fixture, extra: Partial<PlanOptions> = {}) =>
  planClose({
    account: f.manifest.accounts.fixture,
    destination: f.manifest.accounts.destination,
    feeSponsor: f.manifest.accounts.sponsor,
    ...extra,
  });

const account = (id: string) => client.get<HorizonAccount>(`/accounts/${id}`);
const latest = async () => (await latestLedger(client)).sequence;

async function nativeOf(id: string): Promise<bigint> {
  const a = await account(id);
  return toStroops(a?.balances.find((b) => b.asset_type === "native")?.balance ?? "0");
}

async function status(id: string): Promise<number> {
  const response = await fetch(`${HORIZON}/accounts/${id}`, {
    headers: { accept: "application/json" },
  });
  return response.status;
}

/**
 * A transaction from the fixture, signed by it, fee-bumped by the fixture's sponsor (inner fee 0,
 * CAP-15) and submitted until its fate is known.
 */
async function fromFixture(
  f: Fixture,
  name: string,
  purpose: string,
  operations: xdr.Operation[],
): Promise<SubmitOutcome> {
  const loaded = await server.loadAccount(f.manifest.accounts.fixture);
  const fee = baseFeeFromFeeStats(await server.feeStats());
  const builder = new TransactionBuilder(loaded, {
    fee: "0",
    networkPassphrase: TESTNET_PASSPHRASE,
  }).setTimeout(120);
  for (const op of operations) builder.addOperation(op);
  const inner = builder.build();
  inner.sign(keyOf(f, "fixture"));
  const bump = wrapInFeeBump(inner, keyOf(f, "sponsor"), fee, TESTNET_PASSPHRASE);
  const outcome = await submitAndConfirm(submitter, {
    xdr: bump.toXDR(),
    hash: hashHex(bump),
    maxTime: Number(inner.timeBounds?.maxTime ?? 0),
  });
  record({
    case: name,
    purpose,
    hash: hashHex(bump),
    innerHash: hashHex(inner),
    sequence: inner.sequence,
    result: outcome.kind,
    ...("ledger" in outcome && outcome.ledger !== undefined ? { ledger: outcome.ledger } : {}),
    ...("codes" in outcome ? { codes: outcome.codes } : {}),
  });
  return outcome;
}

/** BumpSequence to (latest ledger + ahead) << 32 (https://developers.stellar.org/docs/learn/fundamentals/transactions/list-of-operations#bump-sequence). */
async function bumpSequence(f: Fixture, name: string, ahead: number) {
  const observed = await latest();
  const bumpTo = BigInt(observed + ahead) << 32n;
  const outcome = await fromFixture(f, name, `BumpSequence to (${observed} + ${ahead}) << 32`, [
    Operation.bumpSequence({ bumpTo: bumpTo.toString() }),
  ]);
  if (outcome.kind !== "applied") throw new Error(`BumpSequence: ${JSON.stringify(outcome)}`);
  const after = await account(f.manifest.accounts.fixture);
  expect(after!.sequence).toBe(bumpTo.toString());
  return { observed, bumpTo, hash: outcome.hash, ledger: outcome.ledger };
}

/** Polls Horizon's latest ledger every 500 ms until it reaches `target`. */
async function waitForLedgerAtLeast(target: number, timeoutMs = 180_000): Promise<number> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const now = await latest();
    if (now >= target) return now;
    if (Date.now() > deadline) throw new Error(`ledger ${target} did not close in time`);
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

function recordRun(name: string, report: CloseReport): void {
  for (const t of report.transactions) {
    const codes = [
      t.resultCodes?.transaction,
      t.resultCodes?.innerTransaction,
      ...(t.resultCodes?.operations ?? []),
    ].filter(Boolean);
    record({
      case: name,
      purpose: `close tx ${t.index + 1} (${t.phase}), round ${t.round}, attempt ${t.attempt}: ${t.result}${codes.length ? ` (${codes.join(", ")})` : ""}`,
      hash: t.hash,
      innerHash: t.innerHash,
      sequence: t.sequence,
      ledger: t.ledger,
    });
  }
  record({ case: name, status: report.status, stop: report.stop, message: report.message });
}

const countingSigners = (f: Fixture) => {
  const calls = { account: 0, sponsor: 0 };
  const counted = (signer: Signer, which: keyof typeof calls): Signer => ({
    publicKey: () => signer.publicKey(),
    sign: (tx) => {
      calls[which] += 1;
      return signer.sign(tx);
    },
  });
  const real = signersOf(f);
  return {
    calls,
    signers: {
      account: counted(real.account, "account"),
      feeSponsor: counted(real.feeSponsor, "sponsor"),
    },
  };
};

const flat = (text: string) => text.replace(/\s+/g, " ");

describeTestnet("S-04 live: a near bump, the executor waits and merges (AC-E3-S4-2)", () => {
  const name = "S-04 near";
  const AHEAD = 16;
  let f: Fixture;
  let bump: Awaited<ReturnType<typeof bumpSequence>>;
  let plan: ClosePlan;
  let report: CloseReport;
  const events: Array<{ at: number; event: CloseEvent }> = [];
  let destinationDelta: bigint;
  let accountStatus: number;
  let receipt: string;

  beforeAll(async () => {
    f = await freshFixture(name);
    bump = await bumpSequence(f, name, AHEAD);
    plan = await planFor(f);
    record({
      case: name,
      plan: plan.status,
      transactions: plan.transactions.map((t) => t.phase),
      sequenceGuard: plan.sequenceGuard,
    });
    const before = await nativeOf(f.manifest.accounts.destination);
    const plans: ClosePlan[] = [];
    report = await executeClose(plan, signersOf(f), {
      confirm: true,
      onEvent: (event) => {
        events.push({ at: Date.now(), event });
        if (event.type === "plan") plans.push(event.plan);
        if (event.type === "wait" || event.type === "preflight") record({ case: name, event });
      },
    });
    recordRun(name, report);
    destinationDelta = (await nativeOf(f.manifest.accounts.destination)) - before;
    accountStatus = await status(f.manifest.accounts.fixture);
    receipt = renderReport(report, { plans });
    console.log(receipt);
  }, 900_000);

  it("S-04, AC-E3-S4-2: the plan is closable and says the merge waits, with the unblocking ledger", () => {
    const mergeIndex = plan.transactions.findIndex((t) => t.phase === "merge");
    expect(plan.status).toBe("closable");
    expect(plan.transactions.at(-1)!.phase).toBe("merge");
    expect(plan.transactions.at(-1)!.opCount).toBe(1);
    // Each earlier transaction consumes one sequence number before the merge.
    const sequenceAtMerge = bump.bumpTo + BigInt(mergeIndex) + 1n;
    expect(plan.sequenceGuard).toMatchObject({
      ok: false,
      sequenceAtMerge: sequenceAtMerge.toString(),
      unblocksAtLedger: bump.observed + AHEAD + 1,
    });
    expect(plan.warnings.join(" ")).toMatch(/the executor waits before submitting the merge/);
  });

  it("S-04, AC-E3-S4-2: the cleanup runs, then the executor waits for the ledger before the unblocking one", () => {
    const until = plan.sequenceGuard!.unblocksAtLedger!;
    const waits = events.flatMap(({ event }) => (event.type === "wait" ? [event] : []));
    expect(waits.map((w) => w.state)).toEqual(["start", "end"]);
    const [start, end] = waits as [(typeof waits)[0], (typeof waits)[0]];
    expect(start.untilLedger).toBe(until);
    // A real wait: the ledger was still more than one short when the cleanup was done.
    expect(start.currentLedger).toBeLessThan(until - 1);
    expect(end.currentLedger).toBeGreaterThanOrEqual(until - 1);
    // Every transaction before the merge had applied by then.
    const cleanup = report.transactions.filter(
      (t) => t.phase !== "merge" && t.result === "applied",
    );
    expect(cleanup).toHaveLength(plan.transactions.length - 1);
    for (const t of cleanup) expect(t.ledger!).toBeLessThanOrEqual(start.currentLedger);
  });

  it("S-04, AC-E3-S4-2: the merge applies in or after the unblocking ledger, and the account is gone", () => {
    const until = plan.sequenceGuard!.unblocksAtLedger!;
    expect(report.status).toBe("closed");
    expect(report.stop).toBeNull();
    const merge = report.transactions.find((t) => t.phase === "merge" && t.result === "applied")!;
    expect(merge.ledger!).toBeGreaterThanOrEqual(until);
    // No merge was ever refused on the ledger: it was not submitted before it could land.
    expect(JSON.stringify(report.transactions)).not.toMatch(/op_seq_num_too_far/);
    expect(report.transactions.filter((t) => t.phase === "merge")).toHaveLength(1);
    record({
      case: name,
      unblocksAtLedger: until,
      mergeLedger: merge.ledger,
      firstValidLedgerIsolated: merge.ledger === until,
    });
    expect(report.verification).toMatchObject({ accountExists: false, horizonStatus: 404 });
    expect(accountStatus).toBe(404);
    expect(destinationDelta).toBe(toStroops(report.recovery.mergedXlm!));
  });

  it("S-04: every transaction is a fee bump paid by the sponsor, sourced by the closed account", async () => {
    for (const t of report.transactions.filter((x) => x.result === "applied")) {
      const onLedger = await client.get<{ fee_account: string; source_account: string }>(
        `/transactions/${t.hash}`,
      );
      expect(onLedger).toMatchObject({
        fee_account: f.manifest.accounts.sponsor,
        source_account: f.manifest.accounts.fixture,
      });
    }
    expect(flat(receipt)).toMatch(/the merge must wait until ledger/);
  });
});

describeTestnet(
  "S-04 live: a far bump, refused, partial, and a forced merge (AC-E3-S4-1, AC-E3-S4-3)",
  () => {
    const name = "S-04 far";
    const AHEAD = 720;
    let f: Fixture;
    let bump: Awaited<ReturnType<typeof bumpSequence>>;
    let plan: ClosePlan;
    let refused: CloseReport;
    let refusedCalls: { account: number; sponsor: number };
    let partial: CloseReport;
    let probe: SubmitOutcome;
    let sequenceBeforeProbe: bigint;
    let sequenceAfterProbe: bigint;
    let receipt: string;

    beforeAll(async () => {
      f = await freshFixture(name);
      bump = await bumpSequence(f, name, AHEAD);
      plan = await planFor(f);
      record({ case: name, plan: plan.status, blockers: plan.blockers });
      const counting = countingSigners(f);
      refused = await executeClose(plan, counting.signers, { confirm: true });
      refusedCalls = counting.calls;
      record({ case: name, refused: refused.status, stop: refused.stop });
      partial = await executeClose(plan, signersOf(f), { confirm: true, allowPartial: true });
      recordRun(name, partial);
      receipt = renderReport(partial, { plans: [plan] });
      console.log(receipt);
      // Matrix S-04, negative probe: a merge submitted anyway fails with op_seq_num_too_far and
      // consumes its sequence number (the account has no subentry left, so the guard is what fails).
      sequenceBeforeProbe = BigInt((await account(f.manifest.accounts.fixture))!.sequence);
      probe = await fromFixture(f, name, "probe: a merge submitted anyway", [
        Operation.accountMerge({ destination: f.manifest.accounts.destination }),
      ]);
      sequenceAfterProbe = BigInt((await account(f.manifest.accounts.fixture))!.sequence);
    }, 900_000);

    it("S-04, AC-E3-S4-1: the plan is blocked with SEQNUM_TOO_FAR, the ledger and the ETA, and has no merge", () => {
      // The merge would have been the third transaction: sequence at merge bumpTo + 3.
      const until = bump.observed + AHEAD + 1;
      expect(plan.status).toBe("blocked");
      expect(plan.blockers.map((b) => b.code)).toEqual(["SEQNUM_TOO_FAR"]);
      expect(plan.blockers[0]!.reason).toContain(`until ledger ${until}`);
      expect(plan.blockers[0]!.reason).toMatch(/about (5[5-9]|6[0-5]) minutes from now/);
      expect(plan.steps.some((s) => s.kind === "merge")).toBe(false);
    });

    it("S-04, AC-E3-S4-1: executeClose refuses without allowPartial and signs nothing", () => {
      expect(refused.status).toBe("aborted");
      expect(refused.stop).toMatchObject({ code: "PLAN_NOT_CLOSABLE" });
      expect(refused.transactions).toEqual([]);
      expect(refusedCalls).toEqual({ account: 0, sponsor: 0 });
    });

    it("S-04, AC-E3-S4-3: with allowPartial the cleanup runs, no merge is submitted, the receipt names the ledger", async () => {
      const until = bump.observed + AHEAD + 1;
      expect(partial.status).toBe("partial");
      expect(partial.transactions.some((t) => t.result === "applied")).toBe(true);
      expect(partial.transactions.every((t) => t.phase !== "merge")).toBe(true);
      expect(partial.blockers.map((b) => b.code)).toEqual(["SEQNUM_TOO_FAR"]);
      expect(flat(receipt)).toContain(`until ledger ${until}`);
      expect(flat(receipt)).toContain("the sequence guard holds the merge");
      const left = await account(f.manifest.accounts.fixture);
      expect(left!.subentry_count).toBe(0);
    });

    it("S-04 negative probe: a merge submitted anyway fails with op_seq_num_too_far and consumes its sequence number", () => {
      expect(probe.kind).toBe("failed");
      expect(probe.kind === "failed" && probe.codes.operations).toEqual(["op_seq_num_too_far"]);
      expect(sequenceAfterProbe).toBe(sequenceBeforeProbe + 1n);
    });
  },
);

describeTestnet("S-04 live: the boundary on the ledger (AC-E3-S4-4)", () => {
  const name = "S-04 boundary";
  const AHEAD = 10;
  let f: Fixture;
  let until: number;
  let probe: SubmitOutcome;
  let close: CloseReport | null = null;

  beforeAll(async () => {
    f = await freshFixture(name);
    await bumpSequence(f, name, AHEAD);
    // The cleanup alone: with maxWaitLedgers 0 the plan blocks the merge, and allowPartial runs the
    // rest, so the account holds no subentry and only the guard can refuse a merge.
    const cleanupPlan = await planFor(f, { maxWaitLedgers: 0 });
    const cleanup = await executeClose(cleanupPlan, signersOf(f), {
      confirm: true,
      allowPartial: true,
    });
    recordRun(`${name} cleanup`, cleanup);
    if (cleanup.status !== "partial") throw new Error(`cleanup: ${cleanup.status}`);
    const next = BigInt((await account(f.manifest.accounts.fixture))!.sequence) + 1n;
    until = Number(next >> 32n) + 1;
    record({ case: name, nextSequence: next.toString(), unblocksAtLedger: until });
    // Aim a merge at ledger until - 1: submit it as soon as ledger until - 2 has closed.
    await waitForLedgerAtLeast(until - 2);
    probe = await fromFixture(f, name, `probe: a merge aimed at ledger ${until - 1}`, [
      Operation.accountMerge({ destination: f.manifest.accounts.destination }),
    ]);
    if (probe.kind === "failed") {
      // The executor then merges; its sequence number is one higher, the same unblocking ledger.
      const plan = await planFor(f);
      close = await executeClose(plan, signersOf(f), { confirm: true });
      recordRun(`${name} close`, close);
    }
  }, 900_000);

  it("S-04, AC-E3-S4-4 live: a merge applies only from the ledger (s >> 32) + 1, where s is its sequence number", () => {
    // Whatever ledger the probe landed in, the rule decides its fate.
    if (probe.kind === "failed") {
      expect(probe.ledger!).toBeLessThan(until);
      expect(probe.codes.operations).toEqual(["op_seq_num_too_far"]);
    } else {
      expect(probe.kind).toBe("applied");
      expect(probe.kind === "applied" && probe.ledger).toBeGreaterThanOrEqual(until);
    }
    if (close) {
      expect(close.status).toBe("closed");
      const merge = close.transactions.find((t) => t.phase === "merge" && t.result === "applied")!;
      expect(merge.ledger!).toBeGreaterThanOrEqual(until);
      record({
        case: name,
        probeLedger: probe.kind === "failed" ? probe.ledger : null,
        mergeLedger: merge.ledger,
        unblocksAtLedger: until,
        firstValidLedgerIsolated:
          probe.kind === "failed" && probe.ledger === until - 1 && merge.ledger === until,
      });
    }
  });
});
