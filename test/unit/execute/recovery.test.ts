import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { executeClose, type ExecuteOptions } from "../../../src/execute/executor.js";
import type { CloseReport } from "../../../src/execute/report.js";
import { horizonSubmitter } from "../../../src/execute/submit.js";
import type { DustinError } from "../../../src/errors/dustin-error.js";
import { planClose, type PlanCloseInput } from "../../../src/plan/plan-close.js";
import { horizonJson, type FetchLike } from "../../../src/reader/horizon-json.js";
import { horizonReader } from "../../../src/reader/ledger-reader.js";
import type { Signer } from "../../../src/sponsor/signer.js";
import { FakeLedger } from "../../helpers/fake-ledger.js";
import { TESTNET_HORIZON } from "../../helpers/recorded-horizon.js";
import { messy } from "../../helpers/snapshots.js";
import { recordIncludedFaults, staleAccountOnce } from "./harness.js";

// The fake ledger does not verify signatures, so signers only need the right public keys.
const signerFor = (publicKey: string): Signer => ({
  publicKey: () => publicKey,
  sign: () => undefined,
});
const signers = () => ({ account: signerFor(messy.fixture), feeSponsor: signerFor(messy.sponsor) });

// Horizon's answers for envelopes refused before inclusion, and for one that failed on the ledger.
type Codes = { transaction: string; inner_transaction?: string; operations?: string[] };
const answer = (codes: Codes, status = 400) => ({
  status,
  body: { status, extras: { result_codes: codes } },
});
const TOO_LATE = answer({
  transaction: "tx_fee_bump_inner_failed",
  inner_transaction: "tx_too_late",
});
const BAD_SEQ = answer({
  transaction: "tx_fee_bump_inner_failed",
  inner_transaction: "tx_bad_seq",
});
const LOW_FEE = answer({ transaction: "tx_insufficient_fee" });
const RATE_LIMITED = { status: 429, body: { status: 429, title: "Rate Limit Exceeded" } };
// An included failure: recorded on the fake ledger by recordIncludedFaults (edge case E6).
const failedOps = (...operations: string[]) => ({
  ...answer({
    transaction: "tx_fee_bump_inner_failed",
    inner_transaction: "tx_failed",
    operations,
  }),
  included: true,
});

/**
 * The fake ledger behind a Horizon client. `wrap` can intercept requests. Time is the fake Date:
 * `sleep` moves it forward instead of waiting, so polling to a time bound takes no real time.
 */
function setup(wrap?: (ledger: FakeLedger) => FetchLike) {
  const ledger = FakeLedger.messy();
  const fetch = recordIncludedFaults(ledger, wrap ? wrap(ledger) : ledger.fetch);
  const reader = horizonReader(horizonJson(TESTNET_HORIZON, { fetch, retries: 0 }));
  const submitter = horizonSubmitter(TESTNET_HORIZON, { fetch });
  const sleeps: number[] = [];
  const deps = {
    reader,
    submitter,
    pollIntervalMs: 5000,
    sleep: (ms: number) => {
      sleeps.push(ms);
      vi.setSystemTime(Date.now() + Math.max(ms, 1));
      return Promise.resolve();
    },
  } satisfies Partial<ExecuteOptions>;
  const plan = (extra: Partial<PlanCloseInput> = {}) =>
    planClose(
      {
        account: messy.fixture,
        destination: messy.destination,
        feeSponsor: messy.sponsor,
        ...extra,
      },
      { reader },
    );
  return { ledger, deps, plan, sleeps };
}

const tx0 = (report: CloseReport) =>
  report.transactions.filter((t) => t.round === 0 && t.index === 0);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-26T12:00:00Z"));
});
afterEach(() => {
  vi.useRealTimers();
});

describe("review finding R1: the report survives a thrown error", () => {
  it("keeps the applied hash when Horizon answers 5xx on the next read", async () => {
    let down = false;
    const { ledger, deps, plan } = setup((l) => (url, init) => {
      const read = (init?.method ?? "GET") === "GET";
      if (down && read && url.endsWith(`/accounts/${messy.fixture}`)) {
        return Promise.resolve(new Response(JSON.stringify({ status: 503 }), { status: 503 }));
      }
      return l.fetch(url, init);
    });
    const copies: CloseReport[] = [];
    const error = (await executeClose(await plan(), signers(), {
      confirm: true,
      ...deps,
      onReport: (r) => copies.push(r),
      onEvent: (e) => {
        if (e.type === "tx:confirmed" && e.index === 0) down = true;
      },
    }).catch((e: unknown) => e)) as DustinError;
    expect(error).toMatchObject({ name: "DustinError", code: "HORIZON_UNAVAILABLE" });
    const report = error.report!;
    expect(report.status).toBe("failed");
    expect(report.transactions).toHaveLength(1);
    expect(report.transactions[0]).toMatchObject({ result: "applied", phase: "cleanup" });
    expect(report.transactions[0]!.hash).toBe([...ledger.transactions.keys()][0]);
    expect(report.stop).toMatchObject({ code: "HORIZON_UNAVAILABLE", stage: "build" });
    expect(report.message).toMatch(/every hash is in this report/);
    // Published right before the throw.
    expect(copies.at(-1)).toMatchObject({ status: "failed", finishedAt: report.finishedAt });
  });

  it("attaches the report when a signer throws, as EXECUTION_INTERRUPTED with the cause", async () => {
    const { deps, plan } = setup();
    let calls = 0;
    const flaky: Signer = {
      publicKey: () => messy.fixture,
      sign: () => {
        calls += 1;
        if (calls === 2) throw new Error("wallet closed");
      },
    };
    const error = (await executeClose(
      await plan(),
      { account: flaky, feeSponsor: signerFor(messy.sponsor) },
      { confirm: true, ...deps },
    ).catch((e: unknown) => e)) as DustinError;
    expect(error).toMatchObject({ code: "EXECUTION_INTERRUPTED", stage: "build" });
    expect((error.cause as Error).message).toBe("wallet closed");
    expect(error.report).toMatchObject({
      status: "failed",
      stop: { code: "EXECUTION_INTERRUPTED" },
    });
    expect(error.report!.transactions.map((t) => t.result)).toEqual(["applied"]);
  });

  it("keeps a merge that applied as closed but unverified when the final check fails", async () => {
    let merged = false;
    const { ledger, deps, plan } = setup((l) => (url, init) => {
      if (merged && url.endsWith(`/accounts/${messy.fixture}`)) {
        return Promise.resolve(new Response(JSON.stringify({ status: 502 }), { status: 502 }));
      }
      return l.fetch(url, init);
    });
    const error = (await executeClose(await plan(), signers(), {
      confirm: true,
      ...deps,
      onEvent: (e) => {
        if (e.type === "tx:confirmed" && e.index === 2) merged = true;
      },
    }).catch((e: unknown) => e)) as DustinError;
    expect(error.code).toBe("HORIZON_UNAVAILABLE");
    expect(error.report).toMatchObject({
      status: "closed",
      verification: null,
      stop: { code: "HORIZON_UNAVAILABLE", stage: "confirm" },
    });
    expect(error.report!.message).toMatch(/interrupted before the account was verified gone/);
    // The merge hash is named; the fake ledger has no result XDR, so no merged amount here.
    expect(error.report!.message).toContain(error.report!.transactions.at(-1)!.hash);
    expect(ledger.accounts.has(messy.fixture)).toBe(false);
  });

  it("aborts with the report when the sponsor cannot cover the budget", async () => {
    const { ledger, deps, plan } = setup();
    ledger.accounts.get(messy.sponsor)!.balances[0]!.balance = "3.0000000";
    const error = (await executeClose(await plan(), signers(), { confirm: true, ...deps }).catch(
      (e: unknown) => e,
    )) as DustinError;
    expect(error.code).toBe("SPONSOR_UNDERFUNDED");
    expect(error.report).toMatchObject({
      status: "aborted",
      transactions: [],
      stop: { code: "SPONSOR_UNDERFUNDED", stage: "sponsor" },
    });
    expect(ledger.submissions).toHaveLength(0);
  });
});

describe("E2-S3: outcomes that are not known at once", () => {
  it("AC-E2-S3-1: finds a 504'd transaction by hash and never posts it twice", async () => {
    const { ledger, deps, plan } = setup();
    ledger.faults.push("504-applied");
    const report = await executeClose(await plan(), signers(), { confirm: true, ...deps });
    expect(report.status).toBe("closed");
    expect(ledger.submissions).toHaveLength(3);
    expect(tx0(report)).toEqual([
      expect.objectContaining({ attempt: 1, attempts: 1, result: "applied" }),
    ]);
  });

  it("rebuilds an envelope that expired unconfirmed for the same sequence, fresh bounds, a higher bid", async () => {
    const { ledger, deps, plan } = setup();
    ledger.faults.push("504-not-applied");
    const report = await executeClose(await plan(), signers(), { confirm: true, ...deps });
    expect(report.status).toBe("closed");
    const [first, second] = tx0(report);
    expect(first).toMatchObject({ attempt: 1, result: "unknown", baseFeeStroops: 100 });
    expect(second).toMatchObject({ attempt: 2, result: "applied", baseFeeStroops: 200 });
    expect(second!.sequence).toBe(first!.sequence);
    expect(second!.hash).not.toBe(first!.hash);
    expect(second!.maxTime).toBeGreaterThan(first!.maxTime);
    expect(second!.rebuiltBecause).toMatch(/can never apply/);
    // Only after its time bound had passed on the ledger's clock.
    expect(Date.parse(report.finishedAt!) / 1000).toBeGreaterThan(first!.maxTime);
    expect(ledger.submissions).toHaveLength(4);
  });

  it("does not rebuild while no ledger has closed past the old envelope's time bound", async () => {
    let frozen: string | null = null;
    const { ledger, deps, plan } = setup((l) => async (url, init) => {
      const response = await l.fetch(url, init);
      if (!url.includes("/ledgers")) return response;
      const page = (await response.json()) as { _embedded: { records: { closed_at: string }[] } };
      frozen ??= page._embedded.records[0]!.closed_at;
      page._embedded.records[0]!.closed_at = frozen;
      return new Response(JSON.stringify(page));
    });
    ledger.faults.push("504-not-applied");
    const report = await executeClose(await plan(), signers(), { confirm: true, ...deps });
    expect(report.status).toBe("failed");
    expect(report.stop).toMatchObject({ code: "OUTCOME_UNKNOWN", verdict: "replan" });
    expect(ledger.submissions).toHaveLength(1);
    expect(report.transactions).toHaveLength(1);
  });
});

describe("E2-S3: envelopes refused before inclusion", () => {
  it("rebuilds after tx_too_late with the same sequence and fresh time bounds", async () => {
    const { ledger, deps, plan } = setup();
    ledger.faults.push(TOO_LATE);
    const report = await executeClose(await plan(), signers(), {
      confirm: true,
      ...deps,
      onEvent: (e) => {
        if (e.type === "tx:failed") vi.setSystemTime(Date.now() + 30_000);
      },
    });
    expect(report.status).toBe("closed");
    const [first, second] = tx0(report);
    expect(first).toMatchObject({
      result: "rejected",
      resultCodes: { innerTransaction: "tx_too_late" },
    });
    expect(second).toMatchObject({
      result: "applied",
      sequence: first!.sequence,
      baseFeeStroops: 100,
    });
    expect(second!.maxTime).toBe(first!.maxTime + 30);
    expect(second!.rebuiltBecause).toMatch(/tx_too_late/);
  });

  it("AC-E2-S3-3: raises the bid stepwise after tx_insufficient_fee", async () => {
    const { ledger, deps, plan } = setup();
    ledger.faults.push(LOW_FEE, LOW_FEE);
    const report = await executeClose(await plan(), signers(), { confirm: true, ...deps });
    expect(report.status).toBe("closed");
    expect(tx0(report).map((t) => [t.baseFeeStroops, t.result])).toEqual([
      [100, "rejected"],
      [200, "rejected"],
      [400, "applied"],
    ]);
    expect(new Set(tx0(report).map((t) => t.sequence)).size).toBe(1);
  });

  it("AC-E2-S3-3: stops at the fee cap with a clear reason", async () => {
    const { ledger, deps, plan } = setup();
    ledger.faults.push(LOW_FEE, LOW_FEE, LOW_FEE);
    const report = await executeClose(await plan({ maxBaseFeeStroops: 300 }), signers(), {
      confirm: true,
      ...deps,
    });
    expect(report.status).toBe("failed");
    expect(tx0(report).map((t) => t.baseFeeStroops)).toEqual([100, 200, 300]);
    expect(report.stop).toMatchObject({ code: "FEE_LIMIT", verdict: "replan" });
    expect(report.message).toMatch(/cap of 300 stroops per operation/);
  });

  it("AC-E2-S3-3: stops at the close budget, counting one bid per sequence number", async () => {
    const { ledger, deps, plan } = setup();
    ledger.faults.push(LOW_FEE, LOW_FEE, LOW_FEE);
    const report = await executeClose(await plan({ budgetStroops: 3000 }), signers(), {
      confirm: true,
      ...deps,
    });
    expect(report.status).toBe("failed");
    // 10 operations with the fee bump: 100, 200, then 300 is all 3000 stroops allow.
    expect(tx0(report).map((t) => t.baseFeeStroops)).toEqual([100, 200, 300]);
    expect(report.stop).toMatchObject({ code: "FEE_LIMIT" });
    expect(report.message).toMatch(/close budget/);
  });

  it("AC-E2-S3-2: re-reads the sequence after tx_bad_seq and rebuilds once", async () => {
    const { ledger, deps, plan } = setup();
    const report = await executeClose(await plan(), signers(), {
      confirm: true,
      ...deps,
      onEvent: (e) => {
        // Another client uses the account's next sequence number while this envelope is in flight.
        if (e.type === "tx:submitted" && e.index === 0 && e.attempt === 1) {
          const account = ledger.accounts.get(messy.fixture)!;
          account.sequence = (BigInt(account.sequence) + 1n).toString();
        }
      },
    });
    expect(report.status).toBe("closed");
    const [first, second] = tx0(report);
    expect(first).toMatchObject({
      result: "rejected",
      resultCodes: { innerTransaction: "tx_bad_seq" },
    });
    expect(BigInt(second!.sequence)).toBe(BigInt(first!.sequence) + 1n);
    expect(second!.rebuiltBecause).toMatch(/tx_bad_seq/);
  });

  it("AC-E2-S3-2: stops on a second tx_bad_seq for the same transaction", async () => {
    const { ledger, deps, plan } = setup();
    ledger.faults.push(BAD_SEQ, BAD_SEQ);
    const report = await executeClose(await plan(), signers(), { confirm: true, ...deps });
    expect(report.status).toBe("failed");
    expect(report.stop).toMatchObject({ code: "SEQUENCE_CONFLICT", verdict: "replan", txIndex: 0 });
    expect(ledger.submissions).toHaveLength(2);
  });

  it("after tx_bad_seq, finds an earlier envelope that applied after all instead of rebuilding", async () => {
    let hidden: string | null = null;
    // The account read that checks the 404 lags too, so the 404 is trusted (edge case E5).
    const stale = staleAccountOnce(messy.fixture);
    const { ledger, deps, plan } = setup((l) =>
      stale.wrap((url, init) => {
        // Horizon lags: the first envelope's record shows up only after the second was posted.
        if (hidden && url.endsWith(`/transactions/${hidden}`)) {
          return Promise.resolve(new Response(JSON.stringify({ status: 404 }), { status: 404 }));
        }
        if ((init?.method ?? "GET") === "POST" && l.submissions.length === 1) {
          const settle = l.fetch(url, init);
          hidden = null;
          return settle;
        }
        return l.fetch(url, init);
      }),
    );
    ledger.faults.push("504-applied");
    const report = await executeClose(await plan(), signers(), {
      confirm: true,
      ...deps,
      onEvent: (e) => {
        if (e.type === "tx:submitted" && e.round === 0 && e.index === 0 && e.attempt === 1) {
          hidden = e.hash;
          stale.arm(ledger);
        }
      },
    });
    expect(report.status).toBe("closed");
    const [first, second] = tx0(report);
    expect(first).toMatchObject({ attempt: 1, result: "applied" });
    expect(second).toMatchObject({
      attempt: 2,
      result: "rejected",
      resultCodes: { innerTransaction: "tx_bad_seq" },
    });
    expect(report.steps.find((s) => s.stepId === "S01")).toMatchObject({
      status: "applied",
      txHash: first!.hash,
    });
  });

  it("posts the same envelope again after a 429, with exponential pauses", async () => {
    const { ledger, deps, plan, sleeps } = setup();
    ledger.faults.push(RATE_LIMITED, RATE_LIMITED);
    const report = await executeClose(await plan(), signers(), {
      confirm: true,
      ...deps,
      backoffMs: 1000,
    });
    expect(report.status).toBe("closed");
    expect(tx0(report)).toEqual([
      expect.objectContaining({ attempt: 1, attempts: 3, result: "applied" }),
    ]);
    expect(sleeps.slice(0, 2)).toEqual([1000, 2000]);
    expect(new Set(ledger.submissions.slice(0, 3)).size).toBe(1);
  });

  it("stops when Horizon keeps answering 429", async () => {
    const { ledger, deps, plan } = setup();
    ledger.faults.push(...Array.from({ length: 6 }, () => RATE_LIMITED));
    const report = await executeClose(await plan(), signers(), { confirm: true, ...deps });
    expect(report.status).toBe("failed");
    expect(report.stop).toMatchObject({ code: "RETRY_LIMIT" });
    expect(tx0(report)).toEqual([expect.objectContaining({ attempts: 6, result: "rejected" })]);
  });

  it("stops after the rebuild limit", async () => {
    const { ledger, deps, plan } = setup();
    ledger.faults.push(TOO_LATE, TOO_LATE, TOO_LATE);
    const report = await executeClose(await plan(), signers(), {
      confirm: true,
      ...deps,
      maxAttemptsPerTransaction: 3,
    });
    expect(report.stop).toMatchObject({ code: "RETRY_LIMIT" });
    expect(tx0(report)).toHaveLength(3);
  });

  it("stops at once on a refusal that no rebuild can fix", async () => {
    const { ledger, deps, plan } = setup();
    ledger.faults.push(answer({ transaction: "tx_insufficient_balance" }));
    const report = await executeClose(await plan(), signers(), { confirm: true, ...deps });
    expect(report.status).toBe("failed");
    expect(report.stop).toMatchObject({ code: "TRANSACTION_REJECTED", verdict: "stop" });
    expect(report.message).toMatch(/fee sponsor cannot pay the fee/);
    expect(ledger.submissions).toHaveLength(1);
  });
});

describe("E2-S3: operations that fail on the ledger", () => {
  it("AC-E2-S3-4: a market that moved drops rung 1 for the asset even though a quote exists", async () => {
    const { ledger, deps, plan } = setup();
    const dusta = [...ledger.quotes.keys()][0]!;
    const report = await executeClose(await plan(), signers(), {
      confirm: true,
      ...deps,
      onEvent: (e) => {
        // The market still buys DUSTA, but for less than the slippage bound allows.
        if (e.type === "tx:confirmed" && e.index === 0) ledger.quotes.set(dusta, "0.0000001");
      },
    });
    expect(report.status).toBe("closed");
    expect(report.transactions[1]).toMatchObject({
      result: "failed",
      // The fake ledger reports codes up to the failing operation.
      resultCodes: { operations: ["op_under_dest_min"] },
    });
    expect(report.replans[0]).toMatchObject({ demoted: [dusta], drift: [] });
    expect(report.steps.find((s) => s.stepId === "S10")).toMatchObject({
      status: "applied",
      rung: "return_to_issuer",
      failures: 1,
    });
    expect(report.steps.find((s) => s.stepId === "S10")!.explanation).toMatch(/market moved/);
  });

  it("AC-E2-S3-4: a step that fails twice stops the run before the merge", async () => {
    const { ledger, deps, plan } = setup();
    const underfunded = failedOps(
      "op_success",
      "op_success",
      "op_underfunded",
      ...Array.from({ length: 6 }, () => "op_success"),
    );
    ledger.faults.push(underfunded, underfunded);
    const report = await executeClose(await plan(), signers(), { confirm: true, ...deps });
    expect(report.status).toBe("failed");
    expect(report.replans).toHaveLength(1);
    expect(report.stop).toMatchObject({
      code: "STEP_FAILED_TWICE",
      stepId: "S03",
      verdict: "stop",
    });
    const s03 = report.steps.find((s) => s.stepId === "S03")!;
    expect(s03).toMatchObject({ status: "failed", failures: 2 });
    expect(s03.resultCodes?.operations?.[2]).toBe("op_underfunded");
    expect(ledger.accounts.has(messy.fixture)).toBe(true);
  });

  it("stops when the re-plan limit is reached", async () => {
    const { ledger, deps, plan } = setup();
    ledger.faults.push(failedOps("op_offer_not_found"));
    const report = await executeClose(await plan(), signers(), {
      confirm: true,
      ...deps,
      maxReplans: 0,
    });
    expect(report.stop).toMatchObject({ code: "REPLAN_LIMIT", stepId: "S01" });
    expect(report.replans).toHaveLength(0);
  });

  it("treats anything new found by a re-plan as drift: abort by default, continue with onDrift replan", async () => {
    const run = async (onDrift?: "abort" | "replan") => {
      const { ledger, deps, plan } = setup();
      let changed = false;
      const report = await executeClose(await plan(), signers(), {
        confirm: true,
        ...deps,
        ...(onDrift ? { onDrift } : {}),
        onEvent: (e) => {
          if (e.type === "tx:confirmed" && e.index === 0 && !changed) {
            changed = true;
            // A new data entry appears and the market vanishes, so the sale fails and re-plans.
            const account = ledger.accounts.get(messy.fixture)!;
            account.data = { late: "MQ==" };
            account.subentry_count += 1;
            ledger.quotes.clear();
          }
        },
      });
      return { report, ledger };
    };
    const aborted = await run();
    expect(aborted.report.status).toBe("failed");
    expect(aborted.report.stop).toMatchObject({ code: "PLAN_CHANGED" });
    expect(aborted.report.replans[0]!.drift).toEqual(["a new data entry late"]);
    expect(aborted.ledger.accounts.has(messy.fixture)).toBe(true);

    const continued = await run("replan");
    expect(continued.report.status).toBe("closed");
    expect(
      continued.report.steps.some((s) => s.stepId.startsWith("R1.") && s.status === "applied"),
    ).toBe(true);
  });

  it("stops before a partial run the caller did not allow, and runs it when allowed", async () => {
    const run = async (allowPartial: boolean) => {
      const { ledger, deps, plan } = setup();
      const report = await executeClose(await plan(), signers(), {
        confirm: true,
        ...deps,
        allowPartial,
        onEvent: (e) => {
          if (e.type === "tx:confirmed" && e.index === 0) {
            const dusta = ledger.accounts
              .get(messy.fixture)!
              .balances.find((b) => b.asset_code === "DUSTA")!;
            // The issuer revokes DUSTA: it can no longer be sold or returned.
            Object.assign(dusta, {
              is_authorized: false,
              is_authorized_to_maintain_liabilities: false,
            });
          }
        },
      });
      return report;
    };
    const stopped = await run(false);
    expect(stopped.status).toBe("failed");
    expect(stopped.stop).toMatchObject({ code: "PLAN_NOT_CLOSABLE" });
    expect(stopped.unclosable.map((u) => u.code)).toEqual(["TRUSTLINE_NOT_AUTHORIZED"]);
    const partial = await run(true);
    expect(partial.status).toBe("partial");
    expect(partial.stop).toBeNull();
    expect(partial.verification).toMatchObject({ accountExists: true });
  });

  it("keeps op_seq_num_too_far a stop that names the ledger the merge can land in", async () => {
    const { ledger, deps, plan } = setup();
    let bumped = false;
    const report = await executeClose(await plan(), signers(), {
      confirm: true,
      ...deps,
      onEvent: (e) => {
        // After the merge's preflight passed, another client bumps the sequence number 500
        // ledgers ahead: the merge fails on the ledger, and the wait it would now need is beyond
        // the plan's bound of 120 ledgers, so the run stops (story E3-S4 waits within the bound).
        if (e.type === "preflight" && e.ok && !bumped) {
          bumped = true;
          ledger.accounts.get(messy.fixture)!.sequence = (
            BigInt(ledger.ledgerSeq + 500) << 32n
          ).toString();
        }
      },
    });
    const sequence = BigInt(ledger.accounts.get(messy.fixture)!.sequence);
    const unblocks = Number((sequence + 1n) >> 32n) + 1;
    expect(report.status).toBe("failed");
    expect(report.stop).toMatchObject({
      code: "SEQNUM_TOO_FAR",
      unblocksAtLedger: unblocks,
      stepId: "S12",
    });
    expect(report.message).toMatch(new RegExp(`ledger ${unblocks}`));
  });
});

describe("E2-S3: resuming and progress", () => {
  it("AC-E2-S3-5: a close stopped after transaction 1 of 3 completes with exactly the rest", async () => {
    const { ledger, deps, plan } = setup();
    let signatures = 0;
    const once: Signer = {
      publicKey: () => messy.fixture,
      sign: () => {
        signatures += 1;
        if (signatures === 2) throw new Error("process killed");
      },
    };
    const first = (await executeClose(
      await plan(),
      { account: once, feeSponsor: signerFor(messy.sponsor) },
      { confirm: true, ...deps },
    ).catch((e: unknown) => e)) as DustinError;
    expect(first.report!.transactions.map((t) => [t.phase, t.result])).toEqual([
      ["cleanup", "applied"],
    ]);

    const second = await executeClose(await plan(), signers(), { confirm: true, ...deps });
    expect(second.status).toBe("closed");
    expect(second.transactions.map((t) => [t.phase, t.result])).toEqual([
      ["convert", "applied"],
      ["merge", "applied"],
    ]);
    expect(ledger.submissions).toHaveLength(3);
    expect(ledger.accounts.has(messy.fixture)).toBe(false);
  });

  it("re-running a completed close submits nothing and shows the account is gone (PRD FR-17)", async () => {
    const { ledger, deps, plan } = setup();
    await executeClose(await plan(), signers(), { confirm: true, ...deps });
    const again = await executeClose(await plan(), signers(), { confirm: true, ...deps });
    expect(again.status).toBe("aborted");
    expect(again.stop).toMatchObject({ code: "ACCOUNT_MISSING" });
    expect(again.verification).toMatchObject({ accountExists: false, horizonStatus: 404 });
    expect(ledger.submissions).toHaveLength(3);
  });

  it("AC-E2-S3-6: publishes every attempt as it happens", async () => {
    const { ledger, deps, plan } = setup();
    ledger.faults.push(TOO_LATE);
    const copies: CloseReport[] = [];
    await executeClose(await plan(), signers(), {
      confirm: true,
      ...deps,
      onReport: (r) => copies.push(r),
    });
    const shapes = copies.map((c) => c.transactions.map((t) => t.result).join(","));
    expect(shapes).toContain("pending");
    expect(shapes).toContain("rejected");
    expect(shapes).toContain("rejected,pending");
    expect(shapes).toContain("rejected,applied");
    expect(copies.at(-1)!.status).toBe("closed");
  });
});

describe("E2-S3: final states that need care", () => {
  it("does not call a merge that applied a close while Horizon still returns the account", async () => {
    let stale: unknown = null;
    const { deps, plan } = setup((l) => async (url, init) => {
      if (stale && url.endsWith(`/accounts/${messy.fixture}`)) {
        return new Response(JSON.stringify(stale));
      }
      return l.fetch(url, init);
    });
    const report = await executeClose(await plan(), signers(), {
      confirm: true,
      ...deps,
      verifyTimeoutMs: 10_000,
      onEvent: (e) => {
        // Horizon keeps serving the account as it was before the merge.
        if (e.type === "tx:building" && e.index === 2) stale = { status: "cached" };
      },
    });
    expect(report.status).toBe("failed");
    expect(report.stop).toMatchObject({ code: "ACCOUNT_STILL_EXISTS", verdict: "stop" });
    expect(report.verification).toMatchObject({ accountExists: true });
  });

  it("stops when a transaction found failed after a 504 has no result codes to classify", async () => {
    const { ledger, deps, plan } = setup();
    // The fake ledger's records carry no result XDR, like a Horizon without it.
    ledger.faults.push("504-applied");
    const report = await executeClose(await plan(), signers(), {
      confirm: true,
      ...deps,
      onEvent: (e) => {
        if (e.type === "tx:building" && e.index === 0) {
          ledger.offers.set(messy.fixture, []);
        }
      },
    });
    expect(report.status).toBe("failed");
    expect(report.transactions[0]).toMatchObject({ result: "failed", resultCodes: {} });
    expect(report.stop).toMatchObject({ code: "OPERATION_FAILED" });
    expect(report.message).toMatch(/without an operation result/);
  });

  it("ends aborted, not failed, when the account vanishes before anything was submitted", async () => {
    const { ledger, deps, plan } = setup();
    const report = await executeClose(await plan(), signers(), {
      confirm: true,
      ...deps,
      onEvent: (e) => {
        if (e.type === "plan") ledger.accounts.delete(messy.fixture);
      },
    });
    expect(report.status).toBe("aborted");
    expect(report.stop).toMatchObject({ code: "ACCOUNT_MISSING" });
    expect(ledger.submissions).toHaveLength(0);
  });
});
