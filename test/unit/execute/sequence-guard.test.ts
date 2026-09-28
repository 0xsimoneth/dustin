import { FeeBumpTransaction, Networks, TransactionBuilder } from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";
import { executeClose, type CloseEvent } from "../../../src/execute/executor.js";
import { ledgerWaitLimitMs } from "../../../src/execute/preflight.js";
import type { Signer } from "../../../src/sponsor/signer.js";
import { FakeLedger } from "../../helpers/fake-ledger.js";
import { messy } from "../../helpers/snapshots.js";
import { failedOps, harness, signers, type TestClock } from "./harness.js";

// Story E3-S4 (review finding R8): the executor keeps the plan's promise and waits for the sequence
// guard before a merge, within the plan's bound (plan.options.maxWaitLedgers, default 120 ledgers);
// beyond it, or when the bound runs out, it stops before the merge with SEQNUM_TOO_FAR and the
// ledger to come back at. All offline, on the fake ledger (test/helpers/fake-ledger.ts), whose merge
// follows stellar-core: ACCOUNT_MERGE_SEQNUM_TOO_FAR when the sequence number at apply time is at or
// above ledgerSeq << 32 (MergeOpFrame::isSeqnumTooFar,
// https://github.com/stellar/stellar-core/blob/master/src/transactions/MergeOpFrame.cpp).

/** Ledgers close every 5 s of the test clock, so each pause the executor takes lets ledgers pass. */
function tickingSleep(ledger: FakeLedger, clock: TestClock, msPerLedger = 5000) {
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
function bump(ledger: FakeLedger, ahead: number): bigint {
  const bumpTo = BigInt(ledger.ledgerSeq + ahead) << 32n;
  ledger.accounts.get(messy.fixture)!.sequence = bumpTo.toString();
  return bumpTo;
}

/** The fixture with nothing left to clean up: native XLM only, so its plan is the merge alone. */
function bare(ledger: FakeLedger): void {
  const account = ledger.accounts.get(messy.fixture)!;
  account.balances = account.balances.filter((b) => b.asset_type === "native");
  account.data = {};
  account.subentry_count = 0;
  account.num_sponsored = 0;
  ledger.accounts.get(messy.reserveSponsor)!.num_sponsoring = 0;
  ledger.offers.set(messy.fixture, []);
}

/** The operation types of every envelope posted to the fake ledger, in order. */
function postedOperations(ledger: FakeLedger): string[][] {
  return ledger.submissions.map((xdr) => {
    const bumped = TransactionBuilder.fromXDR(xdr, Networks.TESTNET) as FeeBumpTransaction;
    return bumped.innerTransaction.operations.map((op) => op.type);
  });
}

const waits = (events: CloseEvent[]) => events.filter((e) => e.type === "wait");

const countingSigners = () => {
  const calls = { account: 0, sponsor: 0 };
  const counted = (key: string, which: keyof typeof calls): Signer => ({
    publicKey: () => key,
    sign: () => void calls[which]++,
  });
  return {
    calls,
    signers: {
      account: counted(messy.fixture, "account"),
      feeSponsor: counted(messy.sponsor, "sponsor"),
    },
  };
};

describe("E3-S4: the executor waits for the sequence guard before the merge", () => {
  it("waits before the first submission of a merge that is the plan's only transaction (the known gap)", async () => {
    const { ledger, clock, deps, plan } = harness();
    bare(ledger);
    const L = ledger.ledgerSeq;
    bump(ledger, 5);
    const p = await plan();
    // Nothing to clean up: the merge is the only transaction, and it has to wait.
    expect(p.transactions.map((t) => t.phase)).toEqual(["merge"]);
    expect(p.sequenceGuard).toMatchObject({ ok: false, unblocksAtLedger: L + 6 });
    expect(p.warnings.join(" ")).toMatch(/waits before submitting the merge/);

    const events: CloseEvent[] = [];
    const report = await executeClose(p, signers(), {
      confirm: true,
      ...deps,
      sleep: tickingSleep(ledger, clock),
      onEvent: (e) => events.push(e),
    });
    // Before the fix the merge went out at once and failed on the ledger with op_seq_num_too_far,
    // spending a fee and a sequence number.
    expect(report.transactions.map((t) => [t.phase, t.result])).toEqual([["merge", "applied"]]);
    expect(ledger.submissions).toHaveLength(1);
    expect(report.status).toBe("closed");
    expect(report.verification).toMatchObject({ accountExists: false });
    // It went out as soon as ledger L + 5 had closed, so it landed in the first ledger it could.
    expect(report.transactions[0]!.ledger).toBe(L + 6);
    expect(waits(events)).toEqual([
      {
        type: "wait",
        reason: "sequence",
        state: "start",
        index: 0,
        untilLedger: L + 6,
        currentLedger: L,
      },
      {
        type: "wait",
        reason: "sequence",
        state: "end",
        index: 0,
        untilLedger: L + 6,
        currentLedger: L + 5,
      },
    ]);
    // It polled the ledger once per pause, never in a tight loop: five pauses of pollIntervalMs.
    expect(clock.sleeps).toEqual([5000, 5000, 5000, 5000, 5000]);
  });

  it("AC-E3-S4-2 (offline): runs the cleanup, waits for the unblocking ledger, then merges", async () => {
    const { ledger, clock, deps, plan } = harness();
    const L = ledger.ledgerSeq;
    bump(ledger, 10);
    const p = await plan();
    // The merge is the third transaction: its sequence number is the bump plus 3.
    expect(p.status).toBe("closable");
    expect(p.transactions.map((t) => t.phase)).toEqual(["cleanup", "convert", "merge"]);
    expect(p.sequenceGuard).toMatchObject({ ok: false, unblocksAtLedger: L + 11 });

    const events: CloseEvent[] = [];
    const report = await executeClose(p, signers(), {
      confirm: true,
      ...deps,
      sleep: tickingSleep(ledger, clock),
      onEvent: (e) => events.push(e),
    });
    expect(report.status).toBe("closed");
    expect(report.stop).toBeNull();
    expect(report.transactions.map((t) => [t.phase, t.result, t.ledger])).toEqual([
      ["cleanup", "applied", L + 1],
      ["convert", "applied", L + 2],
      ["merge", "applied", L + 11],
    ]);
    // No merge was ever refused on the ledger.
    expect(JSON.stringify(report)).not.toMatch(/op_seq_num_too_far/);
    expect(waits(events)).toEqual([
      {
        type: "wait",
        reason: "sequence",
        state: "start",
        index: 2,
        untilLedger: L + 11,
        currentLedger: L + 2,
      },
      {
        type: "wait",
        reason: "sequence",
        state: "end",
        index: 2,
        untilLedger: L + 11,
        currentLedger: L + 10,
      },
    ]);
    // The preflight after the wait passed, and nothing else was posted meanwhile.
    const after = events.slice(events.findIndex((e) => e.type === "wait" && e.state === "end"));
    expect(after[1]).toMatchObject({ type: "preflight", index: 2, ok: true });
    expect(postedOperations(ledger).at(-1)).toEqual(["accountMerge"]);
    expect(clock.sleeps).toHaveLength(8);
  });

  it("merges without waiting when the ledger has passed the guard by the time the merge is due", async () => {
    const { ledger, clock, deps, plan } = harness();
    const L = ledger.ledgerSeq;
    bump(ledger, 2);
    const p = await plan();
    // Due at L + 3; the cleanup and the sale land in L + 1 and L + 2, so no wait is left.
    expect(p.sequenceGuard).toMatchObject({ ok: false, unblocksAtLedger: L + 3 });
    const events: CloseEvent[] = [];
    const report = await executeClose(p, signers(), {
      confirm: true,
      ...deps,
      sleep: tickingSleep(ledger, clock),
      onEvent: (e) => events.push(e),
    });
    expect(report.status).toBe("closed");
    expect(report.transactions.at(-1)).toMatchObject({ phase: "merge", ledger: L + 3 });
    expect(waits(events)).toEqual([]);
    expect(clock.sleeps).toEqual([]);
  });

  it("uses the plan's bound: a wait longer than maxWaitLedgers stops before the merge with SEQNUM_TOO_FAR", async () => {
    const { ledger, clock, deps, plan } = harness();
    const L = ledger.ledgerSeq;
    // Someone bumps the sequence number far ahead after the sale: the merge would have to wait
    // 501 ledgers (about 42 minutes), more than the default bound of 120.
    let bumped = false;
    const events: CloseEvent[] = [];
    const report = await executeClose(await plan(), signers(), {
      confirm: true,
      ...deps,
      sleep: tickingSleep(ledger, clock),
      onEvent: (e) => {
        events.push(e);
        if (e.type === "tx:confirmed" && e.index === 1 && !bumped) {
          bumped = true;
          bump(ledger, 500);
        }
      },
    });
    expect(report.status).toBe("failed");
    expect(report.stop).toMatchObject({
      code: "SEQNUM_TOO_FAR",
      stage: "merge",
      verdict: "replan",
      txIndex: 2,
      unblocksAtLedger: L + 2 + 501,
    });
    expect(report.message).toMatch(new RegExp(`at or after ledger ${L + 2 + 501}`));
    expect(report.message).toMatch(/120/);
    // No merge was posted, and nothing waited.
    expect(postedOperations(ledger).flat()).not.toContain("accountMerge");
    expect(report.transactions.map((t) => t.phase)).toEqual(["cleanup", "convert"]);
    expect(waits(events)).toEqual([]);
    expect(clock.sleeps).toEqual([]);
    expect(events.filter((e) => e.type === "preflight")).toEqual([
      expect.objectContaining({ index: 2, ok: false }),
    ]);
    expect(ledger.accounts.has(messy.fixture)).toBe(true);
  });

  it("respects a smaller bound recorded in the plan (maxWaitLedgers)", async () => {
    const { ledger, clock, deps, plan } = harness();
    const L = ledger.ledgerSeq;
    bump(ledger, 3);
    const p = await plan({ maxWaitLedgers: 5 });
    expect(p.status).toBe("closable");
    // A later bump of 30 ledgers fits the default bound but not this plan's 5.
    let bumped = false;
    const report = await executeClose(p, signers(), {
      confirm: true,
      ...deps,
      sleep: tickingSleep(ledger, clock),
      onEvent: (e) => {
        if (e.type === "tx:confirmed" && e.index === 1 && !bumped) {
          bumped = true;
          bump(ledger, 30);
        }
      },
    });
    expect(report.stop).toMatchObject({ code: "SEQNUM_TOO_FAR", unblocksAtLedger: L + 2 + 31 });
    expect(report.message).toMatch(/maxWaitLedgers 5/);
    expect(clock.sleeps).toEqual([]);
  });

  it("stops with SEQNUM_TOO_FAR when the bound runs out: ledgers close slower than the wait allows", async () => {
    const { ledger, clock, deps, plan } = harness();
    const L = ledger.ledgerSeq;
    bump(ledger, 10);
    const events: CloseEvent[] = [];
    // No ledger closes while the executor waits (the test clock moves, the ledger does not).
    const report = await executeClose(await plan(), signers(), {
      confirm: true,
      ...deps,
      onEvent: (e) => events.push(e),
    });
    expect(report.status).toBe("failed");
    expect(report.stop).toMatchObject({
      code: "SEQNUM_TOO_FAR",
      verdict: "replan",
      unblocksAtLedger: L + 11,
    });
    expect(report.message).toMatch(new RegExp(`still reported ledger ${L + 2}`));
    expect(report.message).toMatch(new RegExp(`at or after ledger ${L + 11}`));
    expect(postedOperations(ledger).flat()).not.toContain("accountMerge");
    // Bounded by the local clock: twice the time of the ledgers to wait for, plus two ledgers.
    const limit = ledgerWaitLimitMs(L + 10 - (L + 2));
    expect(limit).toBe(2 * (8 + 2) * 5000);
    expect(clock.sleeps).toEqual(Array.from({ length: limit / 5000 }, () => 5000));
    expect(waits(events)).toEqual([
      expect.objectContaining({ state: "start", untilLedger: L + 11, currentLedger: L + 2 }),
    ]);
  });

  it("aborts with nothing submitted when the only transaction is a merge whose wait runs out", async () => {
    const { ledger, deps, plan } = harness();
    bare(ledger);
    const L = ledger.ledgerSeq;
    bump(ledger, 5);
    const { calls, signers: counting } = countingSigners();
    const report = await executeClose(await plan(), counting, { confirm: true, ...deps });
    expect(report.status).toBe("aborted");
    expect(report.stop).toMatchObject({ code: "SEQNUM_TOO_FAR", unblocksAtLedger: L + 6 });
    expect(ledger.submissions).toHaveLength(0);
    expect(calls).toEqual({ account: 0, sponsor: 0 });
  });

  it("waits again before rebuilding a merge envelope (edge case E2)", async () => {
    const { ledger, clock, deps, plan } = harness();
    const L = ledger.ledgerSeq;
    let bumped = false;
    const events: CloseEvent[] = [];
    const report = await executeClose(await plan(), signers(), {
      confirm: true,
      ...deps,
      sleep: tickingSleep(ledger, clock),
      onEvent: (e) => {
        events.push(e);
        // Another client bumps the sequence number a few ledgers ahead while the merge is in
        // flight: the envelope is refused with tx_bad_seq, and its rebuild must wait.
        if (e.type === "tx:submitted" && e.index === 2 && e.attempt === 1 && !bumped) {
          bumped = true;
          bump(ledger, 4);
        }
      },
    });
    expect(report.status).toBe("closed");
    const merges = report.transactions.filter((t) => t.phase === "merge");
    expect(merges.map((t) => t.result)).toEqual(["rejected", "applied"]);
    expect(merges[1]!.ledger).toBe(L + 2 + 5);
    expect(waits(events)).toHaveLength(2);
  });
});

describe("E3-S4: op_seq_num_too_far on the ledger", () => {
  it("re-reads the account, recomputes the guard, waits within the bound and rebuilds the merge", async () => {
    const { ledger, clock, deps, plan } = harness();
    const L = ledger.ledgerSeq;
    let bumped = false;
    const events: CloseEvent[] = [];
    const report = await executeClose(await plan(), signers(), {
      confirm: true,
      ...deps,
      sleep: tickingSleep(ledger, clock),
      onEvent: (e) => {
        events.push(e);
        // After the merge's preflight passed, another client bumps the sequence number: the merge
        // envelope, built at the new number, fails on the ledger with op_seq_num_too_far.
        if (e.type === "preflight" && e.index === 2 && e.ok && !bumped) {
          bumped = true;
          bump(ledger, 4);
        }
      },
    });
    // The failed merge consumed a sequence number; the rebuilt one waited for ledger L + 7:
    // sequence at merge = ((L + 6) << 32) + 2, so it can land from ledger L + 7.
    expect(report.status).toBe("closed");
    expect(report.transactions.map((t) => [t.round, t.phase, t.result, t.ledger])).toEqual([
      [0, "cleanup", "applied", L + 1],
      [0, "convert", "applied", L + 2],
      [0, "merge", "failed", L + 3],
      [1, "merge", "applied", L + 7],
    ]);
    expect(report.transactions[2]!.resultCodes).toMatchObject({
      operations: ["op_seq_num_too_far"],
    });
    expect(report.replans).toHaveLength(1);
    expect(report.replans[0]!.trigger).toMatchObject({
      txIndex: 2,
      resultCodes: { operations: ["op_seq_num_too_far"] },
    });
    expect(report.steps.find((s) => s.stepId === "S12")).toMatchObject({
      status: "applied",
      failures: 1,
      round: 1,
    });
    expect(waits(events).map((e) => e.type === "wait" && [e.state, e.untilLedger])).toEqual([
      ["start", L + 7],
      ["end", L + 7],
    ]);
  });

  it("stops with SEQNUM_TOO_FAR and the ledger when the recomputed wait is beyond the bound", async () => {
    const { ledger, clock, deps, plan } = harness();
    const L = ledger.ledgerSeq;
    let bumped = false;
    const report = await executeClose(await plan(), signers(), {
      confirm: true,
      ...deps,
      sleep: tickingSleep(ledger, clock),
      onEvent: (e) => {
        if (e.type === "preflight" && e.index === 2 && e.ok && !bumped) {
          bumped = true;
          bump(ledger, 500);
        }
      },
    });
    // Sequence at the next merge: ((L + 502) << 32) + 2, so the merge can land from L + 503.
    expect(report.status).toBe("failed");
    expect(report.transactions.map((t) => [t.phase, t.result])).toEqual([
      ["cleanup", "applied"],
      ["convert", "applied"],
      ["merge", "failed"],
    ]);
    expect(report.stop).toMatchObject({
      code: "SEQNUM_TOO_FAR",
      verdict: "replan",
      stepId: "S12",
      unblocksAtLedger: L + 503,
    });
    expect(report.message).toMatch(new RegExp(`at or after ledger ${L + 503}`));
    expect(report.replans).toHaveLength(0);
    expect(clock.sleeps).toEqual([]);
  });

  it("re-plans and closes when the guard already holds again (the ledger moved on)", async () => {
    const { ledger, deps, plan } = harness();
    let scripted = false;
    const report = await executeClose(await plan(), signers(), {
      confirm: true,
      ...deps,
      onEvent: (e) => {
        // The ledger answers op_seq_num_too_far for the merge, but by the time the account is
        // read again the guard holds: the merge is rebuilt at once, without a wait.
        if (e.type === "tx:confirmed" && e.index === 1 && !scripted) {
          scripted = true;
          ledger.faults.push(failedOps("op_seq_num_too_far"));
        }
      },
    });
    expect(report.status).toBe("closed");
    expect(report.transactions.map((t) => [t.round, t.phase, t.result])).toEqual([
      [0, "cleanup", "applied"],
      [0, "convert", "applied"],
      [0, "merge", "failed"],
      [1, "merge", "applied"],
    ]);
  });

  it("stops when the merge fails with op_seq_num_too_far a second time", async () => {
    const { ledger, clock, deps, plan } = harness();
    let bumps = 0;
    const report = await executeClose(await plan(), signers(), {
      confirm: true,
      ...deps,
      sleep: tickingSleep(ledger, clock),
      onEvent: (e) => {
        if (e.type === "preflight" && e.ok && bumps < 2) {
          bumps += 1;
          bump(ledger, 3);
        }
      },
    });
    expect(report.status).toBe("failed");
    expect(report.transactions.filter((t) => t.phase === "merge").map((t) => t.result)).toEqual([
      "failed",
      "failed",
    ]);
    expect(report.stop).toMatchObject({ code: "SEQNUM_TOO_FAR", stepId: "S12" });
    expect(report.message).toMatch(/twice/);
    expect(report.replans).toHaveLength(1);
  });
});

describe("AC-E3-S4-1, AC-E3-S4-3: a guard beyond the bound blocks the plan", () => {
  it("AC-E3-S4-1: a far bump makes the plan blocked with SEQNUM_TOO_FAR, the ledger and the ETA, and no merge", async () => {
    const { ledger, plan } = harness();
    const L = ledger.ledgerSeq;
    // About an hour at 5 s per ledger: far beyond the default bound of 120 ledgers.
    bump(ledger, 720);
    const p = await plan();
    expect(p.status).toBe("blocked");
    expect(p.blockers.map((b) => b.code)).toEqual(["SEQNUM_TOO_FAR"]);
    // The merge would have been the third transaction: ((L + 720) << 32) + 3.
    const blocker = p.blockers[0]!;
    expect(blocker.reason).toMatch(new RegExp(`until ledger ${L + 721}`));
    expect(blocker.reason).toMatch(/about 61 minutes/);
    expect(blocker.permanent).toBe(false);
    expect(p.steps.some((s) => s.kind === "merge")).toBe(false);
    expect(p.sequenceGuard).toBeNull();
  });

  it("AC-E3-S4-1, AC-E3-S4-3: executeClose refuses without allowPartial, nothing signed", async () => {
    const { ledger, deps, plan } = harness();
    bump(ledger, 720);
    const { calls, signers: counting } = countingSigners();
    const report = await executeClose(await plan(), counting, { confirm: true, ...deps });
    expect(report.status).toBe("aborted");
    expect(report.stop).toMatchObject({ code: "PLAN_NOT_CLOSABLE" });
    expect(report.blockers.map((b) => b.code)).toEqual(["SEQNUM_TOO_FAR"]);
    expect(calls).toEqual({ account: 0, sponsor: 0 });
    expect(ledger.submissions).toHaveLength(0);
  });

  it("AC-E3-S4-3: with allowPartial it runs the cleanup, never submits a merge and ends partial", async () => {
    const { ledger, deps, plan } = harness();
    const L = ledger.ledgerSeq;
    bump(ledger, 720);
    const report = await executeClose(await plan(), signers(), {
      confirm: true,
      ...deps,
      allowPartial: true,
    });
    expect(report.status).toBe("partial");
    expect(report.stop).toBeNull();
    expect(report.transactions.map((t) => [t.phase, t.result])).toEqual([
      ["cleanup", "applied"],
      ["convert", "applied"],
    ]);
    expect(postedOperations(ledger).flat()).not.toContain("accountMerge");
    // The report says when to run again: the blocker names the ledger.
    expect(report.blockers).toEqual([
      expect.objectContaining({
        code: "SEQNUM_TOO_FAR",
        reason: expect.stringMatching(new RegExp(`until ledger ${L + 721}`)) as unknown,
      }),
    ]);
    expect(report.verification).toMatchObject({ accountExists: true });
    const left = ledger.accounts.get(messy.fixture)!;
    expect(left.subentry_count).toBe(0);
  });
});
