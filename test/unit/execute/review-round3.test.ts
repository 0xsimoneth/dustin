import { describe, expect, it } from "vitest";
import type { DustinError } from "../../../src/errors/dustin-error.js";
import { executeClose, type CloseEvent } from "../../../src/execute/executor.js";
import type { CloseReport } from "../../../src/execute/report.js";
import type { ClosePlan } from "../../../src/plan/model.js";
import {
  lookupTransaction,
  submitAndConfirm,
  type ConfirmOptions,
  type Submitter,
} from "../../../src/execute/submit.js";
import { verifyClosed } from "../../../src/execute/verify.js";
import { messy } from "../../helpers/snapshots.js";
import {
  answer,
  failedOps,
  harness,
  included,
  reply,
  signers,
  staleAccountOnce,
} from "./harness.js";

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

  it("OVER_BUDGET (the other stops of a re-plan share the same helper)", async () => {
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

/** The harness; `lagOnce()` makes the next lookup by hash answer 404, as a Horizon behind would. */
function lookupLagsOnce() {
  let armed = false;
  const h = harness((_l, fetch) => (url, init) => {
    if (armed && (init?.method ?? "GET") === "GET" && url.includes("/transactions/")) {
      armed = false;
      return reply(404);
    }
    return fetch(url, init);
  });
  return {
    ...h,
    lagOnce: () => {
      armed = true;
    },
  };
}

describe("R3-8: an included failure is not taken for a refusal on one lagging 404", () => {
  it("keeps a failed operation included while the account shows its sequence number used", async () => {
    const { ledger, deps, plan, lagOnce } = lookupLagsOnce();
    ledger.faults.push(UNDERFUNDED);
    const report = await executeClose(await plan(), signers(), {
      confirm: true,
      ...deps,
      onEvent: (e) => {
        if (e.type === "tx:submitted" && e.round === 0 && e.index === 0) lagOnce();
      },
    });
    const [first] = report.transactions;
    // Included: the step failure is recorded and the run re-plans, as for any op_underfunded.
    expect(first).toMatchObject({ result: "failed", round: 0 });
    expect(report.steps.find((s) => s.stepId === "S03")).toMatchObject({ failures: 1 });
    expect(report.replans).toHaveLength(1);
    expect(report.status).toBe("closed");
  });

  it("keeps an inner tx_too_late at apply time included, never rebuilt at the used number", async () => {
    const { ledger, deps, plan, lagOnce } = lookupLagsOnce();
    ledger.faults.push(
      included({ transaction: "tx_fee_bump_inner_failed", inner_transaction: "tx_too_late" }),
    );
    const report = await executeClose(await plan(), signers(), {
      confirm: true,
      ...deps,
      onEvent: (e) => {
        if (e.type === "tx:submitted" && e.round === 0 && e.index === 0) lagOnce();
      },
    });
    const tx0 = report.transactions.filter((t) => t.round === 0 && t.index === 0);
    expect(tx0.map((t) => t.result)).toEqual(["failed"]);
    // No second envelope was sent at the number the first one used.
    expect(tx0.some((t) => t.resultCodes?.innerTransaction === "tx_bad_seq")).toBe(false);
  });

  it("still takes a tx_failed refused at validation for a refusal (the number is unused)", async () => {
    const { ledger, deps, plan } = harness();
    ledger.faults.push(
      answer({
        transaction: "tx_fee_bump_inner_failed",
        inner_transaction: "tx_failed",
        operations: ["op_bad_auth"],
      }),
    );
    const report = await executeClose(await plan(), signers(), { confirm: true, ...deps });
    expect(report.transactions[0]).toMatchObject({ result: "rejected", feeChargedStroops: null });
    expect(report.stop).toMatchObject({ code: "TRANSACTION_REJECTED" });
  });
});

describe("R3-9: an included failure with no operation code spent only a number and a fee", () => {
  it("re-plans after an inner tx_too_late at apply time, and closes", async () => {
    const { ledger, deps, plan } = harness();
    ledger.faults.push(
      included({ transaction: "tx_fee_bump_inner_failed", inner_transaction: "tx_too_late" }),
    );
    const report = await executeClose(await plan(), signers(), { confirm: true, ...deps });
    const [first] = report.transactions;
    expect(first).toMatchObject({ result: "failed", feeChargedStroops: 1000 });
    // Its meaning says what happened: included, failed before any operation ran.
    expect(first!.explanation).toMatch(/^tx_fee_bump_inner_failed \/ tx_too_late: Included/);
    expect(first!.explanation).not.toMatch(/before it was included/);
    expect(report.replans).toHaveLength(1);
    expect(report.replans[0]!.trigger).toMatchObject({
      hash: first!.hash,
      resultCodes: { innerTransaction: "tx_too_late" },
    });
    expect(report.stop).toBeNull();
    expect(report.status).toBe("closed");
  });

  it("stops with verdict replan when the failure names no code at all", async () => {
    const { ledger, deps, plan } = harness();
    // The fake ledger's records carry no result XDR, like a Horizon without it: the transaction
    // found failed after a 504 has no code to classify.
    ledger.faults.push("504-applied");
    const report = await executeClose(await plan(), signers(), {
      confirm: true,
      ...deps,
      onEvent: (e) => {
        if (e.type === "tx:building" && e.index === 0) ledger.offers.set(messy.fixture, []);
      },
    });
    expect(report.transactions[0]).toMatchObject({ result: "failed", resultCodes: {} });
    expect(report.transactions[0]!.explanation).not.toMatch(/nothing was submitted/);
    // Its detail says to run the close again, and so does its verdict now.
    expect(report.stop).toMatchObject({ code: "OPERATION_FAILED", verdict: "replan" });
    expect(report.message).toMatch(/Run the close again/);
  });
});

/**
 * The merge applies behind a 504 while its lookups answer 503, so the run stops with
 * OUTCOME_UNKNOWN; after the stop the lookups work, but the account reads come from a Horizon that
 * still has the account as it was before the merge.
 */
function mergeSettledLate() {
  let merge: string | null = null;
  let settled = false;
  let copy: unknown = null;
  const h = harness((_l, fetch) => (url, init) => {
    if (merge && !settled && url.endsWith(`/transactions/${merge}`)) return reply(503);
    if (settled && copy && url.endsWith(`/accounts/${messy.fixture}`)) {
      return Promise.resolve(new Response(JSON.stringify(copy)));
    }
    return fetch(url, init);
  });
  const onEvent = (e: CloseEvent) => {
    if (e.type === "tx:building" && e.index === 2 && e.attempt === 1) {
      copy = structuredClone(h.ledger.accounts.get(messy.fixture));
      h.ledger.faults.push("504-applied");
    }
    if (e.type === "tx:submitted" && e.index === 2 && e.attempt === 1) merge = e.hash;
    if (e.type === "tx:failed" && e.index === 2) settled = true;
  };
  return { ...h, onEvent, mergeHash: () => merge };
}

describe("R3-10: a merge of this run that applied makes the run closed, verified or not", () => {
  it("ends closed, not failed with the stale stop, when a settled merge still shows on Horizon", async () => {
    const { deps, plan, onEvent, mergeHash } = mergeSettledLate();
    const report = await executeClose(await plan(), signers(), {
      confirm: true,
      ...deps,
      verifyTimeoutMs: 10_000,
      onEvent,
    });
    const merges = report.transactions.filter((t) => t.phase === "merge");
    expect(merges.map((t) => t.result)).toEqual(["applied"]);
    expect(report.steps.find((s) => s.stepId === "S12")).toMatchObject({ status: "applied" });
    expect(report.status).toBe("closed");
    expect(report.verification).toMatchObject({ accountExists: true });
    expect(report.stop).toMatchObject({ code: "ACCOUNT_STILL_EXISTS", hash: mergeHash() });
    expect(report.message).toMatch(/Horizon still returned the account at the final check/);
  });
});

/**
 * The first transaction's envelope gets a 504 while its lookups answer 503, so the run stops with
 * OUTCOME_UNKNOWN; after the stop its lookups work. With `fail`, the envelope failed on the ledger.
 */
function unknownSettledLate(fail = false) {
  let hash: string | null = null;
  let settled = false;
  const h = harness(
    (_l, fetch) => (url, init) =>
      hash && !settled && url.endsWith(`/transactions/${hash}`) ? reply(503) : fetch(url, init),
  );
  h.ledger.faults.push("504-applied");
  const onEvent = (e: CloseEvent) => {
    if (e.type === "tx:building" && e.index === 0 && fail) h.ledger.offers.set(messy.fixture, []);
    if (e.type === "tx:submitted" && e.index === 0) hash = e.hash;
    if (e.type === "tx:failed" && e.index === 0) settled = true;
  };
  return { ...h, onEvent, hash: () => hash };
}

describe("R3-35: a stop whose envelope settled later says what is known now", () => {
  it("drops the time bound to wait for once the envelope is found applied", async () => {
    const { deps, plan, onEvent, hash } = unknownSettledLate();
    const report = await executeClose(await plan(), signers(), { confirm: true, ...deps, onEvent });
    expect(report.transactions[0]).toMatchObject({ result: "applied" });
    expect(report.status).toBe("failed");
    // The trigger stays: the code and the envelope that stopped the run.
    expect(report.stop).toMatchObject({ code: "OUTCOME_UNKNOWN", hash: hash(), verdict: "replan" });
    expect(report.stop).not.toHaveProperty("maxTime");
    expect(report.message).toMatch(/found applied in ledger/);
    expect(report.message).not.toMatch(/only after a ledger has closed/);
    expect(report.message).toMatch(/run the close again/i);
  });

  it("says so when the envelope is found failed on the ledger", async () => {
    const { deps, plan, onEvent } = unknownSettledLate(true);
    const report = await executeClose(await plan(), signers(), { confirm: true, ...deps, onEvent });
    expect(report.transactions[0]).toMatchObject({ result: "failed" });
    expect(report.stop).toMatchObject({ code: "OUTCOME_UNKNOWN" });
    expect(report.stop).not.toHaveProperty("maxTime");
    expect(report.message).toMatch(/found failed on the ledger/);
  });
});

describe("R3-11: a re-plan waits for an account read that shows the run's own transactions", () => {
  it("does not send steps that applied again when the re-plan's first read is stale", async () => {
    let copy: unknown = null;
    let offersCopy: unknown = null;
    let stale = 0;
    const h = harness((_l, fetch) => (url, init) => {
      const reading = (init?.method ?? "GET") === "GET";
      if (reading && stale > 0 && url.endsWith(`/accounts/${messy.fixture}`)) {
        stale -= 1;
        return Promise.resolve(new Response(JSON.stringify(copy)));
      }
      if (reading && stale > 0 && url.includes(`/accounts/${messy.fixture}/offers`)) {
        return Promise.resolve(
          new Response(JSON.stringify({ _embedded: { records: offersCopy } })),
        );
      }
      return fetch(url, init);
    });
    const report = await executeClose(await h.plan(), signers(), {
      confirm: true,
      ...h.deps,
      onEvent: (e) => {
        if (e.type === "tx:building" && e.index === 0 && copy === null) {
          copy = structuredClone(h.ledger.accounts.get(messy.fixture));
          offersCopy = (h.ledger.offers.get(messy.fixture) ?? []).map((o) => ({
            ...o,
            paging_token: o.id,
          }));
        }
        // The sale fails on the market, so the run re-plans ...
        if (e.type === "tx:confirmed" && e.index === 0) h.ledger.quotes.clear();
        // ... and the re-plan's first account read comes from a Horizon behind transaction 1.
        if (e.type === "tx:failed" && e.index === 1 && stale === 0) stale = 1;
      },
    });
    expect(report.status).toBe("closed");
    // One re-plan, from the ledger as it is: nothing of the cleanup was sent again.
    expect(report.replans).toHaveLength(1);
    expect(report.transactions.filter((t) => t.round === 1).map((t) => t.result)).toEqual([
      "applied",
    ]);
    expect(report.steps.find((s) => s.stepId === "S03")).toMatchObject({ status: "applied" });
    expect(report.steps.find((s) => s.stepId === "S03")).not.toHaveProperty("failures");
  });

  it("records that an unseen envelope's number is used once its rebuild meets tx_bad_seq", async () => {
    let lost: string | null = null;
    // The account read that checks the 404 lags too, so the first envelope is rebuilt.
    const stale = staleAccountOnce(messy.fixture);
    const { ledger, deps, plan } = harness((_l, fetch) =>
      stale.wrap((url, init) =>
        lost && url.endsWith(`/transactions/${lost}`) ? reply(404) : fetch(url, init),
      ),
    );
    ledger.faults.push("504-applied");
    const report = await executeClose(await plan(), signers(), {
      confirm: true,
      ...deps,
      onEvent: (e) => {
        if (e.type === "tx:submitted" && e.round === 0 && e.index === 0 && e.attempt === 1) {
          lost = e.hash;
          stale.arm(ledger);
        }
      },
    });
    const [first] = report.transactions;
    // It applied where Horizon never showed it; the report no longer says it can never apply.
    expect(first).toMatchObject({ result: "unknown", sequenceUsed: true, mayStillApply: false });
    expect(first!.explanation).toMatch(/sequence number used/);
    expect(first!.explanation).not.toMatch(/can never apply/);
    expect(report.status).toBe("closed");
  });
});

describe("R3-12: a verified close credits and marks what an unseen envelope removed", () => {
  it("credits the sponsored trustline and marks the cleanup steps of the unseen envelope", async () => {
    let lost: string | null = null;
    const stale = staleAccountOnce(messy.fixture);
    const { ledger, deps, plan } = harness((_l, fetch) =>
      stale.wrap((url, init) =>
        lost && url.endsWith(`/transactions/${lost}`) ? reply(404) : fetch(url, init),
      ),
    );
    ledger.faults.push("504-applied");
    const report = await executeClose(await plan(), signers(), {
      confirm: true,
      ...deps,
      onEvent: (e) => {
        if (e.type === "tx:submitted" && e.round === 0 && e.index === 0 && e.attempt === 1) {
          lost = e.hash;
          stale.arm(ledger);
        }
      },
    });
    expect(report.status).toBe("closed");
    expect(report.verification).toMatchObject({ accountExists: false });
    // The reserve sponsor got the SPTA trustline's reserve back when the cleanup applied unseen.
    expect(report.recovery.reservesReturnedToSponsors).toEqual([
      {
        sponsor: messy.reserveSponsor,
        xlm: "0.5000000",
        entries: [`trustline SPTA:${messy.issuer}`],
      },
    ]);
    // The cleanup's steps count as applied by the unseen envelope, not confirmed by hash.
    const cleanup = report.steps.filter((s) => s.txIndex === 0);
    expect(cleanup.length).toBeGreaterThan(0);
    for (const step of cleanup) {
      expect(step).toMatchObject({ status: "applied", txHash: lost });
      expect(step.explanation).toMatch(/not confirmed by hash/i);
    }
  });
});

describe("R3-13: an interrupted run still attributes the reserves its removals returned", () => {
  it("credits the sponsored trustline when the final check throws after the merge", async () => {
    let merged = false;
    const { deps, plan } = harness(
      (_l, fetch) => (url, init) =>
        merged && url.endsWith(`/accounts/${messy.fixture}`) ? reply(502) : fetch(url, init),
    );
    const error = (await executeClose(await plan(), signers(), {
      confirm: true,
      ...deps,
      onEvent: (e) => {
        if (e.type === "tx:confirmed" && e.index === 2) merged = true;
      },
    }).catch((e: unknown) => e)) as DustinError;
    expect(error.code).toBe("HORIZON_UNAVAILABLE");
    const report = error.report!;
    // The merge applied (edge case E10: closed, not verified); the removals were confirmed by hash.
    expect(report.status).toBe("closed");
    expect(report.verification).toBeNull();
    expect(report.recovery.reservesReturnedToSponsors).toEqual([
      {
        sponsor: messy.reserveSponsor,
        xlm: "0.5000000",
        entries: [`trustline SPTA:${messy.issuer}`],
      },
    ]);
  });
});

const HASH = "ab".repeat(32);

/**
 * A POST that always answers 504, confirmed on a clock that moves only when the loop sleeps: `t`
 * is the local clock in Unix seconds, and the ledger's close time is `closeTime()`.
 */
function confirmLoop(
  submitter: Partial<Submitter>,
  closeTime: (t: number) => Promise<number> = () => Promise.resolve(1_000_000),
  extra: Partial<ConfirmOptions> = {},
) {
  let t = 1_000_000;
  let sleeps = 0;
  const run = submitAndConfirm(
    {
      submit: () => Promise.resolve({ status: 504, body: null }),
      transaction: () => Promise.resolve(null),
      ...submitter,
    },
    { xdr: "ENV", hash: HASH, maxTime: 1_000_120 },
    {
      pollIntervalMs: 5000,
      now: () => t,
      sleep: (ms) => {
        sleeps += 1;
        t += ms / 1000;
        return sleeps > 5000
          ? Promise.reject(new Error("the wait never ended"))
          : Promise.resolve();
      },
      ledgerCloseTime: () => closeTime(t),
      ...extra,
    },
  );
  return { run, sleeps: () => sleeps, waited: () => t - 1_000_000 };
}

describe("R3-16: a submitter whose lookup throws is a failed lookup, not an exception", () => {
  it("reads a thrown or rejected lookup as an error", async () => {
    const rejects: Submitter = {
      submit: () => Promise.resolve({ status: 504, body: null }),
      transaction: () => Promise.resolve(null),
      lookup: () => Promise.reject(new Error("socket hang up")),
    };
    await expect(lookupTransaction(rejects, HASH)).resolves.toEqual({
      kind: "error",
      detail: "socket hang up",
    });
    const throws: Submitter = {
      ...rejects,
      lookup: () => {
        throw new Error("not connected");
      },
    };
    await expect(lookupTransaction(throws, HASH)).resolves.toEqual({
      kind: "error",
      detail: "not connected",
    });
  });

  it("ends the wait as unknown with the error, so the run can stop with OUTCOME_UNKNOWN", async () => {
    const { run } = confirmLoop({ lookup: () => Promise.reject(new Error("socket hang up")) });
    await expect(run).resolves.toMatchObject({
      kind: "unknown",
      mayStillApply: true,
      lookupError: "socket hang up",
    });
  });
});

const missing = () => Promise.resolve({ kind: "missing" as const });

describe("R3-14: a failed ledger or account read inside the wait proves nothing", () => {
  it("retries a ledger read that throws, then ends unknown with the error; it may still apply", async () => {
    const { run, sleeps } = confirmLoop({ lookup: missing }, () =>
      Promise.reject(new Error("HTTP 503")),
    );
    const outcome = await run;
    expect(outcome).toMatchObject({ kind: "unknown", mayStillApply: true });
    expect(outcome).toHaveProperty("readError", expect.stringMatching(/latest ledger.*HTTP 503/));
    expect(sleeps()).toBeGreaterThan(1);
  });

  it("ends unknown with the error when the account read that checks the 404 throws", async () => {
    // Past the bound (the ledger closed after it), a 404, and the account cannot be read.
    const { run } = confirmLoop({ lookup: missing }, () => Promise.resolve(1_000_200), {
      sequenceUsed: () => Promise.reject(new Error("HTTP 502")),
    });
    const outcome = await run;
    expect(outcome).toMatchObject({ kind: "unknown" });
    expect(outcome).not.toHaveProperty("mayStillApply");
    expect(outcome).toHaveProperty("readError", expect.stringMatching(/account.*HTTP 502/));
  });

  it("stops the run with OUTCOME_UNKNOWN and the time bound when /ledgers fails after a 504", async () => {
    let down = false;
    const h = harness(
      (_l, fetch) => (url, init) =>
        down && url.includes("/ledgers") ? reply(503) : fetch(url, init),
    );
    h.ledger.faults.push("504-not-applied");
    const report = await executeClose(await h.plan(), signers(), {
      confirm: true,
      ...h.deps,
      onEvent: (e) => {
        if (e.type === "tx:submitted" && e.index === 0) down = true;
      },
    });
    const [first] = report.transactions;
    expect(first).toMatchObject({ result: "unknown", mayStillApply: true });
    expect(first!.explanation).toMatch(/may still apply/);
    expect(report.status).toBe("failed");
    expect(report.stop).toMatchObject({
      code: "OUTCOME_UNKNOWN",
      hash: first!.hash,
      maxTime: first!.maxTime,
    });
    expect(h.ledger.submissions).toHaveLength(1);
  });

  it("never rebuilds when the account read that would trust the 404 fails", async () => {
    let failAccount = false;
    const h = harness(
      (_l, fetch) => (url, init) =>
        failAccount && url.endsWith(`/accounts/${messy.fixture}`) ? reply(503) : fetch(url, init),
    );
    h.ledger.faults.push("504-not-applied");
    const report = await executeClose(await h.plan(), signers(), {
      confirm: true,
      ...h.deps,
      onEvent: (e) => {
        if (e.type === "tx:submitted" && e.index === 0) failAccount = true;
      },
    });
    expect(h.ledger.submissions).toHaveLength(1);
    expect(report.transactions[0]).toMatchObject({ result: "unknown", mayStillApply: false });
    expect(report.transactions[0]!.explanation).toMatch(/could not be settled/);
    expect(report.stop).toMatchObject({ code: "OUTCOME_UNKNOWN", verdict: "replan" });
  });
});

describe("R3-17: no answer of Horizon makes the wait endless", () => {
  it("takes a close time that is not a number for a failed read", async () => {
    const { run, waited } = confirmLoop({ lookup: missing }, () => Promise.resolve(Number.NaN));
    const outcome = await run;
    expect(outcome).toMatchObject({ kind: "unknown", mayStillApply: true });
    expect(outcome).toHaveProperty("readError", expect.stringMatching(/close time/));
    expect(waited()).toBeLessThan(300);
  });

  it("bounds the whole wait on the local clock when the close time is far in the past", async () => {
    // A ledger that closed at the epoch: judged by it, the bound would pass in about 1.7e9 s.
    const { run, waited } = confirmLoop({ lookup: missing }, () => Promise.resolve(0));
    await expect(run).resolves.toMatchObject({ kind: "unknown", mayStillApply: true });
    // The default bound: the time left to maxTime (120 s), plus twice the grace and ledger wait.
    expect(waited()).toBeLessThanOrEqual(260 + 5);
  });

  it("gives up at once when the local clock gives no time", async () => {
    const { run, sleeps } = confirmLoop({ lookup: missing }, undefined, {
      now: () => Number.NaN,
    });
    const outcome = await run;
    expect(outcome).toMatchObject({ kind: "unknown", mayStillApply: true });
    expect(outcome).toHaveProperty("readError", expect.stringMatching(/clock/));
    expect(sleeps()).toBe(0);
  });

  it("stops the run within its own bound when Horizon reports an epoch-old close time", async () => {
    let ancient = false;
    const h = harness((_l, fetch) => async (url, init) => {
      const response = await fetch(url, init);
      if (!ancient || !url.includes("/ledgers")) return response;
      const page = (await response.json()) as { _embedded: { records: { closed_at: string }[] } };
      page._embedded.records[0]!.closed_at = "1970-01-01T00:00:00Z";
      return new Response(JSON.stringify(page));
    });
    h.ledger.faults.push("504-not-applied");
    const started = h.clock.now();
    const report = await executeClose(await h.plan(), signers(), {
      confirm: true,
      ...h.deps,
      onEvent: (e) => {
        if (e.type === "tx:submitted" && e.index === 0) ancient = true;
      },
    });
    expect(report.stop).toMatchObject({ code: "OUTCOME_UNKNOWN" });
    expect(report.transactions[0]).toMatchObject({ result: "unknown", mayStillApply: true });
    // timeoutSeconds (120) plus twice the grace (10) and the ledger wait (60), on the test clock.
    expect((h.clock.now() - started) / 1000).toBeLessThanOrEqual(260 + 10);
  });
});

describe("R3-21: failed lookups are retried even when the bound passed long before", () => {
  it("measures the retry window from the first failed lookup", async () => {
    let t = 1_000_000;
    let lookups = 0;
    let sleeps = 0;
    const record = {
      hash: HASH,
      ledger: 7,
      successful: true,
      fee_charged: "200",
      result_xdr: "AAAA",
    };
    const submitter: Submitter = {
      submit: () => Promise.resolve({ status: 504, body: null }),
      transaction: () => Promise.resolve(null),
      // Two lookups fail; the third finds the transaction applied.
      lookup: () => {
        lookups += 1;
        return Promise.resolve(
          lookups <= 2 ? { kind: "error", detail: "HTTP 503" } : { kind: "found", record },
        );
      },
    };
    const outcome = await submitAndConfirm(
      submitter,
      // The POST came back 100 s after the envelope's bound (slow 504s after 429 back-offs).
      { xdr: "ENV", hash: HASH, maxTime: t - 100 },
      {
        pollIntervalMs: 5000,
        now: () => t,
        sleep: (ms) => {
          sleeps += 1;
          t += ms / 1000;
          return Promise.resolve();
        },
        ledgerCloseTime: () => Promise.resolve(t),
      },
    );
    // Before the fix: two lookups back to back, no pause, and unknown with the lookup error.
    expect(outcome).toMatchObject({ kind: "applied", ledger: 7 });
    expect(lookups).toBe(3);
    expect(sleeps).toBeGreaterThan(0);
  });
});

describe("R3-15: an async observer whose promise rejects is caught like one that throws", () => {
  it("records the warning for an async onEvent and leaves no rejection unhandled", async () => {
    const { deps, plan } = harness();
    // An async function is assignable to (event) => void, so TypeScript accepts it.
    const report = await executeClose(await plan(), signers(), {
      confirm: true,
      ...deps,
      // eslint-disable-next-line @typescript-eslint/no-misused-promises -- the case under test
      onEvent: async (e) => {
        await Promise.resolve();
        if (e.type === "tx:confirmed" && e.index === 2) throw new Error("disk full (async)");
      },
    });
    expect(report.status).toBe("closed");
    expect(report.warnings.join(" ")).toMatch(/onEvent callback threw \(disk full \(async\)\)/);
  });

  it("records the warning for an async onReport", async () => {
    const { deps, plan } = harness();
    const report = await executeClose(await plan(), signers(), {
      confirm: true,
      ...deps,
      // eslint-disable-next-line @typescript-eslint/no-misused-promises -- the case under test
      onReport: async (r) => {
        await Promise.resolve();
        if (r.transactions.length === 1) throw new Error("no space left (async)");
      },
    });
    expect(report.status).toBe("closed");
    expect(report.warnings.join(" ")).toMatch(
      /onReport callback threw \(no space left \(async\)\)/,
    );
  });
});

describe("R3-19: the report keeps its own blockers and unclosable items", () => {
  it("does not push the run's blocker into the plan it emitted", async () => {
    const plans: ClosePlan[] = [];
    const { ledger, deps, plan } = harness();
    ledger.faults.push(UNDERFUNDED, UNDERFUNDED);
    const report = await executeClose(await plan(), signers(), {
      confirm: true,
      ...deps,
      onEvent: (e) => {
        if (e.type === "plan") plans.push(e.plan);
      },
    });
    expect(report.stop).toMatchObject({ code: "STEP_FAILED_TWICE" });
    expect(report.blockers.map((b) => b.code)).toContain("STEP_FAILED_TWICE");
    expect(plans).toHaveLength(2);
    for (const p of plans) {
      expect(p.blockers.map((b) => b.code)).not.toContain("STEP_FAILED_TWICE");
      expect(p.blockers).not.toBe(report.blockers);
      expect(p.unclosable).not.toBe(report.unclosable);
    }
  });
});

describe("R3-20: the last published copy has every warning of the returned report", () => {
  it("publishes again when onEvent throws on the done event", async () => {
    const { deps, plan } = harness();
    const copies: CloseReport[] = [];
    const report = await executeClose(await plan(), signers(), {
      confirm: true,
      ...deps,
      onReport: (r) => copies.push(r),
      onEvent: (e) => {
        if (e.type === "done") throw new Error("terminal gone");
      },
    });
    expect(report.warnings.join(" ")).toMatch(/onEvent callback threw \(terminal gone\)/);
    // The --report file is the last copy: it must say what the returned report says.
    expect(copies.at(-1)!.warnings).toEqual(report.warnings);
    expect(copies.at(-1)!.status).toBe("closed");
  });
});

/** Node's timer limit: a longer setTimeout fires after 1 ms (with a TimeoutOverflowWarning). */
const TIMER_LIMIT_MS = 2 ** 31 - 1;

describe("R3-18: numeric options have upper bounds", () => {
  const invalid: Array<[string, number]> = [
    ["pollIntervalMs", TIMER_LIMIT_MS + 1],
    ["backoffMs", 1e12],
    ["timeoutSeconds", 3601],
  ];

  it.each(invalid)("refuses %s = %s before anything is read or signed", async (name, value) => {
    let requests = 0;
    const { ledger, deps, plan } = harness((_l, fetch) => (url, init) => {
      requests += 1;
      return fetch(url, init);
    });
    const p = await plan();
    const before = requests;
    await expect(
      executeClose(p, signers(), { confirm: true, ...deps, [name]: value }),
    ).rejects.toMatchObject({ code: "CONFIG_INVALID", stage: "config" });
    expect(requests).toBe(before);
    expect(ledger.submissions).toHaveLength(0);
  });

  it("accepts the largest pause and the longest validity window", async () => {
    const { deps, plan } = harness();
    const report = await executeClose(await plan(), signers(), {
      confirm: true,
      ...deps,
      pollIntervalMs: TIMER_LIMIT_MS,
      backoffMs: TIMER_LIMIT_MS,
      timeoutSeconds: 3600,
    });
    expect(report.status).toBe("closed");
  });

  it("never sleeps longer than the timer limit, however many 429s double the backoff", async () => {
    const { ledger, deps, plan, clock } = harness();
    // 1,000 ms doubled 23 times is about 8.4e9 ms, far past the limit.
    for (let i = 0; i < 24; i++) ledger.faults.push({ status: 429, body: { status: 429 } });
    const report = await executeClose(await plan(), signers(), {
      confirm: true,
      ...deps,
      backoffMs: 1000,
      maxRateLimitRetries: 30,
    });
    expect(report.status).toBe("closed");
    expect(Math.max(...clock.sleeps)).toBe(TIMER_LIMIT_MS);
  });

  it("refuses a pause beyond the limit wherever a pause is an option (verifyClosed)", async () => {
    const { deps } = harness();
    await expect(
      verifyClosed(messy.fixture, { reader: deps.reader, intervalMs: TIMER_LIMIT_MS + 1 }),
    ).rejects.toMatchObject({ code: "CONFIG_INVALID" });
  });
});
