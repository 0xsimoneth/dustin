import { describe, expect, it } from "vitest";
import { executeClose, type CloseEvent } from "../../../src/execute/executor.js";
import type { CloseReport } from "../../../src/execute/report.js";
import { messy } from "../../helpers/snapshots.js";
import { answer, failedOps, harness, signers } from "./harness.js";

/**
 * The harness, plus what the latest published copy of the report said about the envelope in
 * flight at the moment each POST reached Horizon: its `attempts`.
 */
function copiesAtEachPost() {
  let latest: CloseReport | null = null;
  const inFlight: number[] = [];
  const h = harness((_l, fetch) => (url, init) => {
    if ((init?.method ?? "GET") === "POST")
      inFlight.push(latest?.transactions.at(-1)?.attempts ?? -1);
    return fetch(url, init);
  });
  const onReport = (copy: CloseReport) => {
    latest = copy;
  };
  return { ...h, inFlight, onReport };
}

// Third review round of E2-S3 (2026-09-28): the acceptance audit, the edge-case review of the
// executor and the blind review. Every test here failed on the code before its fix, and runs on
// the injected clock of the harness: no real waiting, no network.

describe("R3-1: only a merge that could have applied proves a close", () => {
  it("keeps the stop when this run's merge was refused and someone else removed the account", async () => {
    const { ledger, deps, plan } = harness();
    const report = await executeClose(await plan(), signers(), {
      confirm: true,
      ...deps,
      onEvent: (e) => {
        // Another client merges the account away while this run's merge envelope is in flight.
        if (e.type === "tx:submitted" && e.index === 2 && e.attempt === 1) {
          ledger.accounts.delete(messy.fixture);
        }
      },
    });
    const merges = report.transactions.filter((t) => t.phase === "merge");
    expect(merges.map((t) => [t.result, t.resultCodes?.innerTransaction])).toEqual([
      ["rejected", "tx_no_source_account"],
    ]);
    expect(report.verification).toMatchObject({ accountExists: false });
    expect(report.status).toBe("failed");
    expect(report.stop).toMatchObject({ code: "ACCOUNT_MISSING", verdict: "stop" });
    expect(report.message).not.toMatch(/after this run posted its merge/);
    // No reserve of the merge (signers, account entry) is credited for a merge that never applied.
    expect(report.steps.find((s) => s.stepId === "S12")).toMatchObject({ status: "not_run" });
  });

  it("keeps the stop when this run's merge failed on the ledger and the account is gone later", async () => {
    const { ledger, deps, plan } = harness();
    let armed = false;
    const report = await executeClose(await plan(), signers(), {
      confirm: true,
      ...deps,
      onEvent: (e) => {
        // The merge fails on the ledger with a re-plan code ...
        if (e.type === "tx:building" && e.index === 2 && e.attempt === 1 && !armed) {
          armed = true;
          ledger.faults.push(failedOps("op_has_sub_entries"));
        }
        // ... and another party merges the account before the re-plan reads it.
        if (e.type === "tx:failed" && e.index === 2) ledger.accounts.delete(messy.fixture);
      },
    });
    const merges = report.transactions.filter((t) => t.phase === "merge");
    expect(merges.map((t) => t.result)).toEqual(["failed"]);
    expect(report.verification).toMatchObject({ accountExists: false });
    expect(report.status).toBe("failed");
    expect(report.stop).toMatchObject({ code: "ACCOUNT_MISSING" });
  });
});

describe("R3-3: a copy saved while a POST is in flight counts that POST", () => {
  it("publishes the envelope as posted once before each POST goes out", async () => {
    const { ledger, deps, plan, inFlight, onReport } = copiesAtEachPost();
    const report = await executeClose(await plan(), signers(), {
      confirm: true,
      ...deps,
      onReport,
    });
    expect(report.status).toBe("closed");
    expect(ledger.submissions).toHaveLength(3);
    // Before the fix the saved copy said 0 while each POST was in flight.
    expect(inFlight).toEqual([1, 1, 1]);
  });
});

describe("R3-4: a re-post after HTTP 429 is published as it happens", () => {
  it("publishes the second post of the same envelope before it goes out", async () => {
    const { ledger, deps, plan, inFlight, onReport } = copiesAtEachPost();
    ledger.faults.push({ status: 429, body: { status: 429 } });
    const report = await executeClose(await plan(), signers(), {
      confirm: true,
      ...deps,
      backoffMs: 1000,
      onReport,
    });
    expect(report.status).toBe("closed");
    const tx0 = report.transactions.filter((t) => t.round === 0 && t.index === 0);
    // The same envelope, posted twice: refused by the rate limiter, then applied.
    expect(tx0.map((t) => [t.attempt, t.attempts, t.result])).toEqual([[1, 2, "applied"]]);
    expect(inFlight).toEqual([1, 2, 1, 1]);
  });
});

/** Step S03 (the DUSTB balance) fails on the ledger with op_underfunded in the first transaction. */
const UNDERFUNDED = failedOps(
  "op_success",
  "op_success",
  "op_underfunded",
  ...Array.from({ length: 6 }, () => "op_success"),
);

describe("R3-5: the remedy of a step that fails twice says what the user can do", () => {
  it("does not offer --partial as a way to leave the step in place", async () => {
    const { ledger, deps, plan } = harness();
    ledger.faults.push(UNDERFUNDED, UNDERFUNDED);
    const report = await executeClose(await plan(), signers(), { confirm: true, ...deps });
    expect(report.stop).toMatchObject({ code: "STEP_FAILED_TWICE", stepId: "S03" });
    const blocker = report.blockers.find((b) => b.code === "STEP_FAILED_TWICE")!;
    // --partial only lets an unclosable plan run; the next plan includes the same step again.
    expect(blocker.remedy).not.toMatch(/--partial to leave it in place/);
    expect(blocker.remedy).toMatch(/--partial does not skip it/);
    expect(blocker.remedy).toMatch(/DUSTB trustline/);
    expect(blocker.remedy).toMatch(/run the close again/);
  });
});

/**
 * A Horizon behind the one that took transaction `index` of round 0: the next `reads` account
 * reads after its confirmation see the account as it was before it.
 */
function lagAfter(index: number, reads: number) {
  let copy: unknown = null;
  let left = 0;
  const h = harness((_l, fetch) => (url, init) => {
    const reading = (init?.method ?? "GET") === "GET";
    if (reading && left > 0 && url.endsWith(`/accounts/${messy.fixture}`)) {
      left -= 1;
      return Promise.resolve(new Response(JSON.stringify(copy)));
    }
    return fetch(url, init);
  });
  const onEvent = (e: CloseEvent) => {
    if (e.type === "tx:building" && e.index === index && copy === null) {
      copy = structuredClone(h.ledger.accounts.get(messy.fixture));
    }
    if (e.type === "tx:confirmed" && e.index === index && e.hash) left = reads;
  };
  return { ...h, onEvent };
}

/** The most the sponsor can be charged for what it signed: the largest bid per sequence number. */
function worstCase(report: CloseReport): number {
  const bySequence = new Map<string, number>();
  for (const t of report.transactions) {
    const total = t.baseFeeStroops * (t.stepIds.length + 1);
    bySequence.set(t.sequence, Math.max(bySequence.get(t.sequence) ?? 0, total));
  }
  return [...bySequence.values()].reduce((a, b) => a + b, 0);
}

describe("R3-6: after tx_bad_seq only this transaction's own refused bids leave the budget", () => {
  it("keeps the close within its budget when a stale read made it reuse a charged number", async () => {
    // Five stale reads after transaction 1: transaction 2 is built at the number it used.
    const { ledger, deps, plan, onEvent } = lagAfter(0, 5);
    const p = await plan({ budgetStroops: 1500 });
    expect(p.fees.totalStroops).toBe(1500);
    let pushed = false;
    const report = await executeClose(p, signers(), {
      confirm: true,
      ...deps,
      onEvent: (e) => {
        onEvent(e);
        // The merge's first bid is refused for its fee, so the run would have to raise it.
        if (e.type === "tx:building" && e.index === 2 && e.attempt === 1 && !pushed) {
          pushed = true;
          ledger.faults.push(answer({ transaction: "tx_insufficient_fee" }));
        }
      },
    });
    const tx1 = report.transactions.filter((t) => t.index === 1);
    expect(tx1.map((t) => [t.result, t.resultCodes?.innerTransaction])).toEqual([
      ["rejected", "tx_bad_seq"],
      ["applied", undefined],
    ]);
    // Transaction 1's charged bid stayed counted, so the merge's raise does not fit the budget.
    expect(worstCase(report)).toBeLessThanOrEqual(1500);
    expect(report.stop).toMatchObject({ code: "FEE_LIMIT" });
    expect(report.message).toMatch(/close budget/);
  });
});

/** The stop's round, and the round of the envelope it names by hash. */
function stopRounds(report: CloseReport) {
  const named = report.transactions.find((t) => t.hash === report.stop?.hash);
  return {
    code: report.stop?.code,
    stopRound: report.stop?.round,
    envelopeRound: named?.round,
    triggerRound: report.replans[0]?.trigger.round,
  };
}

describe("R3-7: a stop raised by a re-plan names the round of the transaction that forced it", () => {
  it("ACCOUNT_MISSING (edge case E8)", async () => {
    const { ledger, deps, plan } = harness();
    const dusta = [...ledger.quotes.keys()][0]!;
    const report = await executeClose(await plan(), signers(), {
      confirm: true,
      ...deps,
      allowPartial: true,
      onEvent: (e) => {
        if (e.type === "tx:confirmed" && e.index === 0) ledger.quotes.set(dusta, "0.0000001");
        if (e.type === "tx:failed" && e.index === 1) ledger.accounts.delete(messy.fixture);
      },
    });
    expect(stopRounds(report)).toEqual({
      code: "ACCOUNT_MISSING",
      stopRound: 0,
      envelopeRound: 0,
      triggerRound: 0,
    });
  });

  it("PLAN_CHANGED", async () => {
    const { ledger, deps, plan } = harness();
    let changed = false;
    const report = await executeClose(await plan(), signers(), {
      confirm: true,
      ...deps,
      onEvent: (e) => {
        if (e.type === "tx:confirmed" && e.index === 0 && !changed) {
          changed = true;
          // A new data entry appears and the market vanishes, so the sale fails and the re-plan
          // finds what the approved plan did not have.
          const account = ledger.accounts.get(messy.fixture)!;
          account.data = { late: "MQ==" };
          account.subentry_count += 1;
          ledger.quotes.clear();
        }
      },
    });
    expect(stopRounds(report)).toEqual({
      code: "PLAN_CHANGED",
      stopRound: 0,
      envelopeRound: 0,
      triggerRound: 0,
    });
  });

  it("OVER_BUDGET", async () => {
    const { ledger, deps, plan } = harness();
    const p = await plan({ maxOpsPerTransaction: 2, budgetStroops: 2000 });
    const report = await executeClose(p, signers(), {
      confirm: true,
      ...deps,
      onEvent: (e) => {
        if (e.type === "tx:confirmed" && e.index === 4) ledger.quotes.clear();
      },
    });
    expect(stopRounds(report)).toEqual({
      code: "OVER_BUDGET",
      stopRound: 0,
      envelopeRound: 0,
      triggerRound: 0,
    });
  });
});
