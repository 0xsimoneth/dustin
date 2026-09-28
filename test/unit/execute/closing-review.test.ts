import { describe, expect, it } from "vitest";
import { exitCodeForReport } from "../../../src/cli/exit-codes.js";
import { executeClose, type CloseEvent } from "../../../src/execute/executor.js";
import {
  MAX_TIMEOUT_SECONDS,
  MAX_VERIFY_TIMEOUT_MS,
  validateExecuteOptions,
} from "../../../src/execute/options.js";
import { ledgerWaitLimitMs, waitForLedger } from "../../../src/execute/preflight.js";
import type { CloseReport } from "../../../src/execute/report.js";
import { submitAndConfirm, type Submitter } from "../../../src/execute/submit.js";
import { verifyClosed } from "../../../src/execute/verify.js";
import type { HorizonAccount } from "../../../src/inspect/horizon-types.js";
import { horizonJson, type FetchLike } from "../../../src/reader/horizon-json.js";
import { horizonReader, type LedgerReader } from "../../../src/reader/ledger-reader.js";
import type { FakeLedger } from "../../helpers/fake-ledger.js";
import { noSleep } from "../../helpers/no-sleep.js";
import { TESTNET_HORIZON } from "../../helpers/recorded-horizon.js";
import { messy } from "../../helpers/snapshots.js";
import { failedOps, harness, reply, signers, testClock, type TestClock } from "./harness.js";

// Closing review of E3 (2026-09-28), executor half: the edge-case review's CX findings and the
// acceptance audit's CA-13. Every test here failed on the code before its fix, and runs on the
// injected clock of the harness: no real waiting, no network.

/** Ledgers close every 5 s of the test clock, so each pause the executor takes lets ledgers pass. */
export function tickingSleep(ledger: FakeLedger, clock: TestClock, msPerLedger = 5000) {
  let carry = 0;
  return (ms: number) => {
    carry += ms;
    while (carry >= msPerLedger) {
      ledger.ledgerSeq += 1;
      carry -= msPerLedger;
    }
    return clock.sleep(ms);
  };
}

/** Bumps the fixture's sequence number to (ledger + ahead) << 32, as BumpSequence would. */
export function bump(ledger: FakeLedger, ahead: number): bigint {
  const bumpTo = BigInt(ledger.ledgerSeq + ahead) << 32n;
  ledger.accounts.get(messy.fixture)!.sequence = bumpTo.toString();
  return bumpTo;
}

describe("CX-1: a merge envelope the run judged unable to apply proves no close", () => {
  it("keeps the real stop, and no exit 0, when another party removes the account", async () => {
    const { ledger, deps, plan } = harness();
    let armed = false;
    let removed = false;
    const events: CloseEvent[] = [];
    const report = await executeClose(await plan(), signers(), {
      confirm: true,
      ...deps,
      onEvent: (e) => {
        events.push(e);
        // The merge's first envelope is lost (504, never applied) ...
        if (e.type === "tx:building" && e.index === 2 && e.attempt === 1 && !armed) {
          armed = true;
          ledger.faults.push("504-not-applied");
        }
        // ... the run finds it can never apply (404 past its bound, sequence number unused), and
        // before its rebuild another client holding the key merges the account elsewhere.
        if (e.type === "tx:failed" && e.index === 2 && !removed) {
          removed = true;
          ledger.accounts.delete(messy.fixture);
        }
      },
    });
    const merges = report.transactions.filter((t) => t.phase === "merge");
    expect(merges.map((t) => [t.result, t.mayStillApply, t.sequenceUsed, t.lookupError])).toEqual([
      ["unknown", false, undefined, undefined],
    ]);
    expect(merges[0]!.explanation).toMatch(/can never apply/);
    expect(ledger.submissions).toHaveLength(3);
    expect(report.verification).toMatchObject({ accountExists: false });
    // Before the fix: closed, stop null, "after this run posted its merge", S12 applied, exit 0.
    expect(report.status).toBe("failed");
    expect(report.stop).toMatchObject({ code: "MERGE_PREFLIGHT_FAILED", verdict: "replan" });
    expect(report.message).not.toMatch(/after this run posted its merge/);
    expect(report.steps.find((s) => s.stepId === "S12")).toMatchObject({ status: "not_run" });
    // Only the sponsored trustline the cleanup removed returned a reserve; nothing of the merge.
    expect(report.recovery.reservesReturnedToSponsors.flatMap((x) => x.entries)).toEqual([
      expect.stringMatching(/^trustline SPTA:/),
    ]);
    expect(exitCodeForReport(report)).toBe(5);
  });

  it("still counts a merge envelope that could not be looked up (control, R3-1)", async () => {
    let merge: string | null = null;
    const { ledger, deps, plan } = harness(
      (_l, fetch) => (url, init) =>
        merge && url.endsWith(`/transactions/${merge}`) ? reply(503) : fetch(url, init),
    );
    const report = await executeClose(await plan(), signers(), {
      confirm: true,
      ...deps,
      onEvent: (e) => {
        // The merge applies behind a 504, and every lookup of its hash fails.
        if (e.type === "tx:submitted" && e.index === 2 && e.attempt === 1) {
          merge = e.hash;
          ledger.faults.push("504-applied");
        }
      },
    });
    const tx = report.transactions.find((t) => t.hash === merge)!;
    expect(tx).toMatchObject({ result: "unknown", mayStillApply: false, lookupError: "HTTP 503" });
    expect(report.status).toBe("closed");
    expect(report.stop).toBeNull();
    expect(report.message).toMatch(/after this run posted its merge .* not confirmed by hash/);
    expect(exitCodeForReport(report)).toBe(0);
  });
});

describe("CX-2: a worse quote in a plan without a merge is drift too (BH-7)", () => {
  /** A plan that cannot merge (the guard is beyond the bound) and still sells DUSTA. */
  async function farGuardPlan() {
    const h = harness();
    bump(h.ledger, 720);
    const approved = await h.plan();
    expect(approved.status).toBe("blocked");
    expect(approved.steps.some((s) => s.kind === "merge")).toBe(false);
    expect(approved.recovery).toMatchObject({
      xlmToDestination: "0.0000000",
      nativeBalance: "4.0000000",
      quotedProceedsXlm: "0.0000007",
    });
    // The quote falls 7 times while the confirmation waits.
    h.ledger.quotes.set([...h.ledger.quotes.keys()][0]!, "0.0000001");
    return { ...h, approved };
  }

  it("aborts with nothing signed, comparing what the account would keep", async () => {
    const { ledger, clock, deps, approved } = await farGuardPlan();
    const events: CloseEvent[] = [];
    const report = await executeClose(approved, signers(), {
      confirm: true,
      ...deps,
      sleep: tickingSleep(ledger, clock),
      allowPartial: true,
      onEvent: (e) => events.push(e),
    });
    const amounts = { approved: "4.0000007", fresh: "4.0000001" };
    expect(events.find((e) => e.type === "drift")).toMatchObject({
      action: "abort",
      xlmToDestination: amounts,
    });
    expect(report.status).toBe("aborted");
    expect(report.stop).toMatchObject({
      code: "XLM_TO_DESTINATION_FELL",
      xlmToDestination: amounts,
    });
    expect(report.stop!.detail).toMatch(
      /the XLM the account would keep \(its balance plus the quoted sales; the plan does not merge\) fell from 4\.0000007 XLM to 4\.0000001 XLM/,
    );
    expect(report.stop!.detail).not.toMatch(/destination would receive/);
    expect(ledger.submissions).toHaveLength(0);
  });

  it("goes on under onDrift replan with a warning that names what the account keeps", async () => {
    const { ledger, clock, deps, approved } = await farGuardPlan();
    const report = await executeClose(approved, signers(), {
      confirm: true,
      ...deps,
      sleep: tickingSleep(ledger, clock),
      allowPartial: true,
      onDrift: "replan",
    });
    expect(report.status).toBe("partial");
    expect(report.transactions.map((t) => [t.phase, t.result])).toEqual([
      ["cleanup", "applied"],
      ["convert", "applied"],
    ]);
    const warning = report.warnings.find((w) => w.includes("fell from"));
    expect(warning).toMatch(
      /the XLM the account would keep .* fell from 4\.0000007 XLM to 4\.0000001 XLM/,
    );
    expect(warning).toMatch(/the run went on with the fresh plan/);
  });

  it("keeps the words of a plan that merges (control)", async () => {
    const { ledger, deps, plan } = harness();
    const approved = await plan();
    ledger.quotes.set([...ledger.quotes.keys()][0]!, "0.0000001");
    const report = await executeClose(approved, signers(), { confirm: true, ...deps });
    expect(report.stop).toMatchObject({
      code: "XLM_TO_DESTINATION_FELL",
      xlmToDestination: { approved: "4.0000007", fresh: "4.0000001" },
    });
    expect(report.stop!.detail).toMatch(
      /the XLM the destination would receive fell from 4\.0000007 XLM to 4\.0000001 XLM/,
    );
  });
});

describe("CX-3: a fresh plan that lost its merge is worded from the cause, and 'went on' only when it did", () => {
  /** Approved with a merge; then another client bumps the sequence number beyond the bound. */
  async function lostMerge(worseQuote: boolean) {
    const h = harness();
    const approved = await h.plan();
    expect(approved.steps.some((s) => s.kind === "merge")).toBe(true);
    bump(h.ledger, 720);
    if (worseQuote) h.ledger.quotes.set([...h.ledger.quotes.keys()][0]!, "0.0000001");
    return { ...h, approved };
  }

  it("adds no warning that the run went on when it then stops with PLAN_NOT_CLOSABLE", async () => {
    const { ledger, deps, approved } = await lostMerge(true);
    const report = await executeClose(approved, signers(), {
      confirm: true,
      ...deps,
      onDrift: "replan",
    });
    expect(report.status).toBe("aborted");
    expect(report.stop).toMatchObject({ code: "PLAN_NOT_CLOSABLE" });
    expect(ledger.submissions).toHaveLength(0);
    // Before the fix: "...fell from 4.0000007 XLM to 4.0000001 XLM ...; the run went on with the
    // fresh plan (onDrift "replan")", next to a stop showing it did not.
    expect(report.warnings.filter((w) => /the run went on/.test(w))).toEqual([]);
  });

  it("names the lost merge, not a worse quote, when only the merge was lost (the review's probe)", async () => {
    const { deps, approved } = await lostMerge(false);
    const report = await executeClose(approved, signers(), {
      confirm: true,
      ...deps,
      onDrift: "replan",
    });
    expect(report.stop).toMatchObject({ code: "PLAN_NOT_CLOSABLE" });
    expect(report.warnings.filter((w) => /worse quote|the run went on/.test(w))).toEqual([]);
  });

  it("says the fresh plan no longer merges when the run goes on as a partial close", async () => {
    const { ledger, clock, deps, approved } = await lostMerge(true);
    const report = await executeClose(approved, signers(), {
      confirm: true,
      ...deps,
      sleep: tickingSleep(ledger, clock),
      onDrift: "replan",
      allowPartial: true,
    });
    expect(report.status).toBe("partial");
    const warning = report.warnings.find((w) => /the run went on/.test(w));
    expect(warning).toMatch(/the fresh plan no longer merges \(status blocked\)/);
    expect(warning).toMatch(
      /the XLM the close would recover \(the account's balance plus the quoted sales\) fell from 4\.0000007 XLM to 4\.0000001 XLM/,
    );
    expect(warning).not.toMatch(/destination would receive/);
    expect(warning).toMatch(/as a partial close/);
  });

  it("names the lost merge in a PLAN_CHANGED stop too", async () => {
    const { deps, approved } = await lostMerge(false);
    const report = await executeClose(approved, signers(), { confirm: true, ...deps });
    expect(report.stop).toMatchObject({ code: "PLAN_CHANGED" });
    expect(report.stop!.detail).toMatch(/the fresh plan no longer merges \(status blocked\)/);
  });
});

describe("CX-4: op_seq_num_too_far failures of the merge are counted on their own", () => {
  it("re-plans and waits after op_has_sub_entries then op_seq_num_too_far within the bound", async () => {
    const { ledger, clock, deps, plan } = harness();
    let scripted = false;
    let bumped = false;
    const report = await executeClose(await plan(), signers(), {
      confirm: true,
      ...deps,
      sleep: tickingSleep(ledger, clock),
      onEvent: (e) => {
        // Round 0: the merge fails on the ledger with a re-plan code.
        if (e.type === "tx:building" && e.index === 2 && e.round === 0 && !scripted) {
          scripted = true;
          ledger.faults.push(failedOps("op_has_sub_entries"));
        }
        // Round 1: after the merge's preflight, another client bumps the sequence number a few
        // ledgers ahead, well within the bound of 120.
        if (
          e.type === "preflight" &&
          e.ok &&
          scripted &&
          !bumped &&
          ledger.submissions.length >= 3
        ) {
          bumped = true;
          bump(ledger, 3);
        }
      },
    });
    const merges = report.transactions.filter((t) => t.phase === "merge");
    expect(merges.map((t) => [t.round, t.result, t.resultCodes?.operations])).toEqual([
      [0, "failed", ["op_has_sub_entries"]],
      [1, "failed", ["op_seq_num_too_far"]],
      [2, "applied", undefined],
    ]);
    // Before the fix: SEQNUM_TOO_FAR "The merge failed this way twice" after one re-plan of three.
    expect(report.replans).toHaveLength(2);
    expect(report.status).toBe("closed");
    expect(report.stop).toBeNull();
  });

  it("names both codes in STEP_FAILED_TWICE after op_seq_num_too_far then op_has_sub_entries", async () => {
    const { ledger, clock, deps, plan } = harness();
    let bumped = false;
    let scripted = false;
    const report = await executeClose(await plan(), signers(), {
      confirm: true,
      ...deps,
      sleep: tickingSleep(ledger, clock),
      onEvent: (e) => {
        if (e.type === "preflight" && e.index === 2 && e.ok && !bumped) {
          bumped = true;
          bump(ledger, 4);
        }
        if (e.type === "tx:building" && e.round === 1 && !scripted) {
          scripted = true;
          ledger.faults.push(failedOps("op_has_sub_entries"));
        }
      },
    });
    const merges = report.transactions.filter((t) => t.phase === "merge");
    expect(merges.map((t) => t.resultCodes?.operations)).toEqual([
      ["op_seq_num_too_far"],
      ["op_has_sub_entries"],
    ]);
    expect(report.stop).toMatchObject({ code: "STEP_FAILED_TWICE", stepId: "S12" });
    const blocker = report.blockers.find((b) => b.code === "STEP_FAILED_TWICE")!;
    // Before the fix: "failed twice on the ledger with op_has_sub_entries".
    expect(blocker.reason).toMatch(
      /failed twice on the ledger, first with op_seq_num_too_far, then with op_has_sub_entries:/,
    );
    expect(report.stop!.detail).toMatch(/It failed twice \(first with op_seq_num_too_far\)/);
  });
});

describe("CX-5: op_seq_num_too_far with no re-plan or budget left says when to run again", () => {
  /**
   * After the merge's preflight another client bumps the sequence number 4 ledgers ahead: the
   * merge fails with op_seq_num_too_far in ledger L + 3 and the next one can land from L + 7,
   * well within the bound.
   */
  function bumpAfterPreflight(ledger: FakeLedger) {
    let bumped = false;
    return (e: CloseEvent) => {
      if (e.type === "preflight" && e.index === 2 && e.ok && !bumped) {
        bumped = true;
        bump(ledger, 4);
      }
    };
  }

  it("stops with SEQNUM_TOO_FAR and the ledger when no re-plan is left (maxReplans 0)", async () => {
    const { ledger, clock, deps, plan } = harness();
    const L = ledger.ledgerSeq;
    const report = await executeClose(await plan(), signers(), {
      confirm: true,
      ...deps,
      maxReplans: 0,
      sleep: tickingSleep(ledger, clock),
      onEvent: bumpAfterPreflight(ledger),
    });
    expect(report.transactions.at(-1)).toMatchObject({ phase: "merge", result: "failed" });
    // Before the fix: REPLAN_LIMIT, verdict stop, no ledger, "re-planned 0 times".
    expect(report.status).toBe("failed");
    expect(report.stop).toMatchObject({
      code: "SEQNUM_TOO_FAR",
      verdict: "replan",
      unblocksAtLedger: L + 7,
      stepId: "S12",
    });
    expect(report.message).toMatch(/maxReplans 0/);
    expect(report.message).toContain(`Run the close again at or after ledger ${L + 7}`);
  });

  it("stops with SEQNUM_TOO_FAR and the ledger when the budget has no room for another merge", async () => {
    const { ledger, clock, deps, plan } = harness();
    const L = ledger.ledgerSeq;
    const approved = await plan();
    const report = await executeClose(approved, signers(), {
      confirm: true,
      ...deps,
      // Exactly the plan's bids: nothing is left for a merge at a new sequence number.
      budgetStroops: approved.fees.totalStroops,
      sleep: tickingSleep(ledger, clock),
      onEvent: bumpAfterPreflight(ledger),
    });
    expect(report.transactions.at(-1)).toMatchObject({ phase: "merge", result: "failed" });
    // Before the fix: OVER_BUDGET, verdict stop, no ledger.
    expect(report.stop).toMatchObject({
      code: "SEQNUM_TOO_FAR",
      verdict: "replan",
      unblocksAtLedger: L + 7,
    });
    expect(report.message).toMatch(/left of the close budget/);
    expect(report.message).toContain(`Run the close again at or after ledger ${L + 7}`);
  });
});

describe("CX-6: a rejection of an async observer after the finish reaches a published copy", () => {
  it("publishes again when an async onEvent rejects on 'done' (the review's probe)", async () => {
    const { deps, plan } = harness();
    const copies: CloseReport[] = [];
    const report = await executeClose(await plan(), signers(), {
      confirm: true,
      ...deps,
      onReport: (copy) => copies.push(copy),
      // TypeScript accepts an async function for a void callback.
      // eslint-disable-next-line @typescript-eslint/no-misused-promises, @typescript-eslint/require-await -- the case under test
      onEvent: async (e) => {
        if (e.type === "done") throw new Error("disk full (async)");
      },
    });
    expect(report.status).toBe("closed");
    const warned = (r: CloseReport) => r.warnings.some((w) => w.includes("disk full (async)"));
    expect(warned(report)).toBe(true);
    // Before the fix the last copy (the --report file) lacked the warning.
    expect(copies.at(-1)!.status).toBe("closed");
    expect(warned(copies.at(-1)!)).toBe(true);
  });

  it("publishes again when the rejection lands after executeClose resolved", async () => {
    const { deps, plan } = harness();
    const copies: CloseReport[] = [];
    let rejectLater: (error: Error) => void = () => undefined;
    const report = await executeClose(await plan(), signers(), {
      confirm: true,
      ...deps,
      onReport: (copy) => copies.push(copy),
      // An observer whose promise settles only after the run: the case under test.
      // eslint-disable-next-line @typescript-eslint/no-misused-promises -- the case under test
      onEvent: (e) =>
        e.type === "done"
          ? new Promise<void>((_resolve, reject) => {
              rejectLater = reject;
            })
          : undefined,
    });
    const published = copies.length;
    rejectLater(new Error("slow observer failed"));
    // Let the rejection handler run.
    await new Promise((resolve) => setImmediate(resolve));
    expect(report.warnings.some((w) => w.includes("slow observer failed"))).toBe(true);
    expect(copies.length).toBe(published + 1);
    expect(copies.at(-1)!.warnings.some((w) => w.includes("slow observer failed"))).toBe(true);
  });
});

describe("CX-7: a failed ledger read during the sequence-guard wait is a poll that did not reach", () => {
  /**
   * The harness with the production read client (three retries, their pauses skipped) and a
   * switch: while `failing` is above 0, every read of /ledgers answers 503 and counts it down.
   */
  function flakyLedgers() {
    const state = { failing: 0 };
    let wrapped: FetchLike | null = null;
    const h = harness((_l, fetch) => {
      wrapped = (url, init) => {
        if (state.failing > 0 && url.includes("/ledgers")) {
          state.failing -= 1;
          return reply(503);
        }
        return fetch(url, init);
      };
      return wrapped;
    });
    const reader = horizonReader(
      horizonJson(TESTNET_HORIZON, { fetch: wrapped!, retries: 3, sleep: noSleep }),
    );
    return { ...h, state, reader };
  }

  it("keeps waiting after one read failed past the client's retries, and merges (the review's probe)", async () => {
    const { ledger, clock, deps, plan, state, reader } = flakyLedgers();
    bump(ledger, 10);
    const report = await executeClose(await plan(), signers(), {
      confirm: true,
      ...deps,
      reader,
      sleep: tickingSleep(ledger, clock),
      onEvent: (e) => {
        // /ledgers answers 503 four times in a row once the wait has begun: one read fails.
        if (e.type === "wait" && e.state === "start") state.failing = 4;
      },
    });
    // Before the fix: HORIZON_UNAVAILABLE thrown out of the wait, the report failed, no merge.
    expect(state.failing).toBe(0);
    expect(report.status).toBe("closed");
    expect(report.transactions.map((t) => [t.phase, t.result])).toEqual([
      ["cleanup", "applied"],
      ["convert", "applied"],
      ["merge", "applied"],
    ]);
  });

  it("stops with SEQNUM_TOO_FAR and the ledger when the reads fail until the wait's limit", async () => {
    const { ledger, clock, deps, plan, state, reader } = flakyLedgers();
    bump(ledger, 10);
    const approved = await plan();
    const until = approved.sequenceGuard!.unblocksAtLedger!;
    const report = await executeClose(approved, signers(), {
      confirm: true,
      ...deps,
      reader,
      sleep: tickingSleep(ledger, clock),
      onEvent: (e) => {
        if (e.type === "wait" && e.state === "start") state.failing = Number.MAX_SAFE_INTEGER;
        // Horizon answers again once the wait gave up, for the final check.
        if (e.type === "preflight" && !e.ok) state.failing = 0;
      },
    });
    expect(report.status).toBe("failed");
    expect(report.stop).toMatchObject({
      code: "SEQNUM_TOO_FAR",
      verdict: "replan",
      unblocksAtLedger: until,
    });
    expect(report.stop!.detail).toMatch(
      /the last read of the latest ledger failed \(HORIZON_UNAVAILABLE: Horizon at .* answered HTTP 503/,
    );
    expect(report.transactions.map((t) => t.phase)).toEqual(["cleanup", "convert"]);
  });

  it("waitForLedger counts a failed read as a poll that did not reach the target", async () => {
    const clock = testClock(0);
    const answers: Array<number | Error> = [10, new Error("HTTP 503"), 12, 13];
    let i = 0;
    const reader = {
      latestLedger: () => {
        const next = answers[Math.min(i++, answers.length - 1)]!;
        return next instanceof Error
          ? Promise.reject(next)
          : Promise.resolve({
              sequence: next,
              closed_at: "2026-09-28T12:00:00Z",
              base_fee_in_stroops: 100,
              base_reserve_in_stroops: 5_000_000,
              protocol_version: 28,
            });
      },
    };
    const waited = await waitForLedger(reader, 13, {
      pollIntervalMs: 2000,
      limitMs: 60_000,
      sleep: clock.sleep,
      now: clock.now,
    });
    expect(waited).toEqual({ reached: true, ledger: 13, waitedMs: 6000, polls: 4 });
  });

  it("waitForLedger gives up at the limit with the read error and the ledger known before", async () => {
    const clock = testClock(0);
    const reader = { latestLedger: () => Promise.reject(new Error("socket hang up")) };
    const waited = await waitForLedger(reader, 13, {
      pollIntervalMs: 5000,
      limitMs: 20_000,
      sleep: clock.sleep,
      now: clock.now,
      knownLedger: 10,
    });
    expect(waited).toEqual({
      reached: false,
      ledger: 10,
      waitedMs: 20_000,
      polls: 5,
      readError: "socket hang up",
    });
  });
});

describe("CX-8: every pause is clipped to the time left in its wait, never below 200 ms", () => {
  const LEDGER = {
    sequence: 100,
    closed_at: "2026-09-28T12:00:00Z",
    base_fee_in_stroops: 100,
    base_reserve_in_stroops: 5_000_000,
    protocol_version: 28,
  };
  const HOUR = 60 * 60 * 1000;

  it("the sequence-guard wait lasts its limit, not a whole long pause (the review's probe)", async () => {
    const clock = testClock(0);
    const limitMs = ledgerWaitLimitMs(1); // 30 s
    const waited = await waitForLedger({ latestLedger: () => Promise.resolve(LEDGER) }, 101, {
      pollIntervalMs: HOUR,
      limitMs,
      sleep: clock.sleep,
      now: clock.now,
    });
    // Before the fix: one pause of an hour, 120 times the limit.
    expect(waited).toMatchObject({ reached: false, waitedMs: limitMs });
    expect(clock.sleeps).toEqual([limitMs]);
  });

  it("the sequence-guard wait's last pause is at least 200 ms", async () => {
    const clock = testClock(0);
    const waited = await waitForLedger({ latestLedger: () => Promise.resolve(LEDGER) }, 101, {
      pollIntervalMs: 5000,
      limitMs: 20_100,
      sleep: clock.sleep,
      now: clock.now,
    });
    expect(clock.sleeps).toEqual([5000, 5000, 5000, 5000, 200]);
    expect(waited.waitedMs).toBe(20_200);
  });

  /** An envelope Horizon answered 504 for and never finds. */
  const lost: Submitter = {
    submit: () => Promise.resolve({ status: 504, body: null }),
    transaction: () => Promise.resolve(null),
    lookup: () => Promise.resolve({ kind: "missing" }),
  };

  it("the confirm loop with the ledger's clock ends at maxWaitSeconds", async () => {
    const clock = testClock(0);
    const outcome = await submitAndConfirm(
      lost,
      { xdr: "ENV", hash: "ab".repeat(32), maxTime: 1000 },
      {
        pollIntervalMs: HOUR,
        maxWaitSeconds: 30,
        // No ledger ever closes past the time bound.
        ledgerCloseTime: () => Promise.resolve(0),
        now: () => clock.now() / 1000,
        sleep: clock.sleep,
      },
    );
    expect(outcome).toMatchObject({ kind: "unknown", mayStillApply: true });
    // Before the fix: [3_600_000].
    expect(clock.sleeps).toEqual([30_000, 200]);
  });

  it("the confirm loop with the local clock ends at the time bound plus the grace", async () => {
    const clock = testClock(0);
    const outcome = await submitAndConfirm(
      lost,
      { xdr: "ENV", hash: "ab".repeat(32), maxTime: 20 },
      { pollIntervalMs: HOUR, graceSeconds: 10, now: () => clock.now() / 1000, sleep: clock.sleep },
    );
    expect(outcome).toMatchObject({ kind: "unknown" });
    expect(clock.sleeps).toEqual([30_000, 200]);
  });

  it("verifyClosed looks for the 404 for its timeout, not a whole long pause", async () => {
    const clock = testClock(0);
    const reader = {
      latestLedger: () => Promise.resolve(LEDGER),
      account: () => Promise.resolve({} as HorizonAccount),
    } as unknown as LedgerReader;
    const v = await verifyClosed(messy.fixture, {
      reader,
      timeoutMs: 30_000,
      intervalMs: HOUR,
      now: clock.now,
      sleep: clock.sleep,
    });
    expect(v.accountExists).toBe(true);
    expect(clock.sleeps).toEqual([30_000]);
  });
});

describe("CX-9: the grace, the ledger wait and verifyTimeoutMs are bounded like the time window", () => {
  const refused: Array<[string, number]> = [
    // The review's probe: about 31,700 years each.
    ["graceSeconds", 1e12],
    ["ledgerWaitSeconds", 1e12],
    ["verifyTimeoutMs", 1e15],
    // One above the bound, and a value that made maxWaitSeconds overflow to Infinity (CB-5).
    ["graceSeconds", MAX_TIMEOUT_SECONDS + 1],
    ["ledgerWaitSeconds", MAX_TIMEOUT_SECONDS + 1],
    ["verifyTimeoutMs", MAX_VERIFY_TIMEOUT_MS + 1],
    ["graceSeconds", Number.MAX_VALUE],
  ];

  it.each(refused)("refuses %s = %s up front with CONFIG_INVALID", (name, value) => {
    expect(() => validateExecuteOptions({ [name]: value })).toThrow(
      expect.objectContaining({ code: "CONFIG_INVALID", stage: "config" }) as Error,
    );
  });

  it("accepts each bound itself: an hour of grace, of ledger wait and of verification", () => {
    expect(MAX_TIMEOUT_SECONDS).toBe(3600);
    expect(MAX_VERIFY_TIMEOUT_MS).toBe(3_600_000);
    expect(() =>
      validateExecuteOptions({
        graceSeconds: MAX_TIMEOUT_SECONDS,
        ledgerWaitSeconds: MAX_TIMEOUT_SECONDS,
        verifyTimeoutMs: MAX_VERIFY_TIMEOUT_MS,
      }),
    ).not.toThrow();
  });

  it("refuses them in executeClose before anything is read or signed", async () => {
    let requests = 0;
    const { ledger, deps, plan } = harness((_l, fetch) => (url, init) => {
      requests += 1;
      return fetch(url, init);
    });
    const approved = await plan();
    const before = requests;
    await expect(
      executeClose(approved, signers(), { confirm: true, ...deps, ledgerWaitSeconds: 1e12 }),
    ).rejects.toMatchObject({ code: "CONFIG_INVALID", stage: "config" });
    expect(requests).toBe(before);
    expect(ledger.submissions).toHaveLength(0);
  });
});
