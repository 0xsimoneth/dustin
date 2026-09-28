import { describe, expect, it } from "vitest";
import { executeClose, type CloseEvent } from "../../../src/execute/executor.js";
import { renderReport } from "../../../src/render/report-text.js";
import type { FakeLedger } from "../../helpers/fake-ledger.js";
import { noSleep } from "../../helpers/no-sleep.js";
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

// Findings of the independent review of the E2-S3 executor (2026-09-26). Every test here runs on
// an injected clock: no fake global Date, no real waiting.

describe("review finding 8: the fake ledger names a missing source as Horizon does", () => {
  it("answers tx_no_source_account, stellar-horizon's string for TxNoAccount", async () => {
    const { ledger, deps, plan } = harness();
    const report = await executeClose(await plan(), signers(), {
      confirm: true,
      ...deps,
      onEvent: (e) => {
        // The account is merged elsewhere while the first envelope is on its way.
        if (e.type === "tx:submitted" && e.index === 0) ledger.accounts.delete(messy.fixture);
      },
    });
    expect(report.transactions[0]!.resultCodes).toEqual({
      transaction: "tx_fee_bump_inner_failed",
      innerTransaction: "tx_no_source_account",
    });
  });
});

describe("review finding 1: a failed lookup by hash proves nothing", () => {
  it("never sends a 504'd envelope that applied twice while lookups answer 503", async () => {
    const { ledger, deps, plan } = harness(
      (_l, fetch) => (url, init) =>
        url.includes("/transactions/") ? reply(503) : fetch(url, init),
    );
    ledger.faults.push("504-applied");
    const report = await executeClose(await plan(), signers(), { confirm: true, ...deps });
    expect(ledger.submissions).toHaveLength(1);
    expect(report.status).toBe("failed");
    expect(report.transactions).toEqual([expect.objectContaining({ result: "unknown" })]);
    expect(report.stop).toMatchObject({ code: "OUTCOME_UNKNOWN", verdict: "replan" });
    expect(report.message).toMatch(/could not be looked up/);
  });

  it("re-plans instead of sending the same operations at a new sequence after tx_bad_seq", async () => {
    let lost: string | null = null;
    // The account read that checks the 404 lags too, so the 404 is trusted (edge case E5).
    const stale = staleAccountOnce(messy.fixture);
    const { ledger, deps, plan } = harness((_l, fetch) =>
      stale.wrap((url, init) =>
        // Horizon loses the first envelope's record: its lookups keep answering 404.
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
    const round0tx0 = report.transactions.filter((t) => t.round === 0 && t.index === 0);
    expect(round0tx0.map((t) => [t.attempt, t.result])).toEqual([
      [1, "unknown"],
      [2, "rejected"],
    ]);
    // The cleanup's operations were never sent at another sequence number.
    expect(new Set(round0tx0.map((t) => t.sequence)).size).toBe(1);
    expect(report.replans[0]!.trigger.resultCodes).toMatchObject({
      innerTransaction: "tx_bad_seq",
    });
    expect(report.status).toBe("closed");
    expect(ledger.submissions).toHaveLength(4);
  });
});

describe("review finding 6: waits follow the injected clock and the ledger's clock", () => {
  it("rebuilds an envelope that expired unconfirmed once the ledger's clock passed its bound", async () => {
    const { ledger, clock, deps, plan } = harness();
    ledger.faults.push("504-not-applied");
    const report = await executeClose(await plan(), signers(), { confirm: true, ...deps });
    expect(report.status).toBe("closed");
    const [first, second] = report.transactions.filter((t) => t.round === 0 && t.index === 0);
    expect(first).toMatchObject({ attempt: 1, result: "unknown" });
    expect(second).toMatchObject({ attempt: 2, result: "applied", sequence: first!.sequence });
    // Horizon's ledgers (on the test clock here) had passed the old envelope's bound.
    expect(clock.now() / 1000).toBeGreaterThan(first!.maxTime);
    expect(Date.parse(report.finishedAt!)).toBe(clock.now());
  });

  it("gives up after ledgerWaitSeconds when no ledger closes past the bound", async () => {
    let frozen: string | null = null;
    const { ledger, clock, deps, plan } = harness((_l, fetch) => async (url, init) => {
      const response = await fetch(url, init);
      if (!url.includes("/ledgers")) return response;
      const page = (await response.json()) as {
        _embedded: { records: { closed_at: string }[] };
      };
      frozen ??= page._embedded.records[0]!.closed_at;
      page._embedded.records[0]!.closed_at = frozen;
      return new Response(JSON.stringify(page));
    });
    ledger.faults.push("504-not-applied");
    const started = clock.now();
    const report = await executeClose(await plan(), signers(), {
      confirm: true,
      ...deps,
      ledgerWaitSeconds: 30,
    });
    expect(report.stop).toMatchObject({ code: "OUTCOME_UNKNOWN" });
    expect(ledger.submissions).toHaveLength(1);
    // About the 120 s time bound (floored to whole seconds), the 10 s grace and the 30 s wait,
    // measured on the test clock.
    const waited = (clock.now() - started) / 1000;
    expect(waited).toBeGreaterThanOrEqual(155);
    expect(waited).toBeLessThan(200);
  });

  it("waits for the final 404 on the injected clock", async () => {
    let stale = false;
    const { clock, deps, plan } = harness(
      (_l, fetch) => (url, init) =>
        stale && url.endsWith(`/accounts/${messy.fixture}`)
          ? reply(200, { status: "cached" })
          : fetch(url, init),
    );
    const report = await executeClose(await plan(), signers(), {
      confirm: true,
      ...deps,
      verifyTimeoutMs: 10_000,
      onEvent: (e) => {
        if (e.type === "tx:building" && e.index === 2) stale = true;
      },
    });
    expect(report.stop).toMatchObject({ code: "ACCOUNT_STILL_EXISTS" });
    expect(clock.sleeps.filter((ms) => ms === 5000).length).toBeGreaterThanOrEqual(2);
  });
});

describe("review finding 7: an unknown outcome tells a re-run how long to wait", () => {
  it("puts the pending envelope's hash and time bound in the stop reason", async () => {
    let frozen: string | null = null;
    const { ledger, deps, plan } = harness((_l, fetch) => async (url, init) => {
      const response = await fetch(url, init);
      if (!url.includes("/ledgers")) return response;
      const page = (await response.json()) as {
        _embedded: { records: { closed_at: string }[] };
      };
      frozen ??= page._embedded.records[0]!.closed_at;
      page._embedded.records[0]!.closed_at = frozen;
      return new Response(JSON.stringify(page));
    });
    ledger.faults.push("504-not-applied");
    const report = await executeClose(await plan(), signers(), { confirm: true, ...deps });
    const pending = report.transactions[0]!;
    expect(report.stop).toMatchObject({
      code: "OUTCOME_UNKNOWN",
      hash: pending.hash,
      maxTime: pending.maxTime,
    });
    const bound = new Date(pending.maxTime * 1000).toISOString();
    expect(report.message).toContain(`after ${bound}`);
    expect(report.message).toMatch(/replace/);
  });
});

/**
 * The merge's first envelope applies but Horizon answers 504 and then 404 for its hash (it lost
 * the record); `reveal` decides when the record shows up again.
 */
function lostMerge(reveal: (ledger: FakeLedger) => boolean, lagging = false) {
  let merge: string | null = null;
  // With `lagging`, the account read that checks the 404 still shows the account, so the 404
  // is trusted and the merge rebuilt (edge case E5); otherwise the missing account says the
  // merge's sequence number was used, and the run re-plans.
  const stale = staleAccountOnce(messy.fixture);
  const h = harness((l, fetch) =>
    stale.wrap((url, init) =>
      merge && url.endsWith(`/transactions/${merge}`) && !reveal(l) ? reply(404) : fetch(url, init),
    ),
  );
  const onEvent = (e: CloseEvent) => {
    if (e.type === "tx:submitted" && e.index === 2 && e.attempt === 1) {
      merge = e.hash;
      h.ledger.faults.push("504-applied");
      if (lagging) stale.arm(h.ledger);
    }
  };
  return { ...h, onEvent };
}

describe("review finding 2: a merge that applied unseen is still a close", () => {
  it("looks the earlier envelope up when the rebuilt merge finds the account gone", async () => {
    // Horizon finds the first envelope again once the rebuild's preflight has found the account
    // gone (edge case E2 runs the preflight before any rebuild of the merge).
    let blocked = false;
    const { ledger, deps, plan, onEvent } = lostMerge(() => blocked, true);
    const report = await executeClose(await plan(), signers(), {
      confirm: true,
      ...deps,
      onEvent: (e) => {
        onEvent(e);
        if (e.type === "preflight" && !e.ok) blocked = true;
      },
    });
    expect(report.status).toBe("closed");
    expect(report.stop).toBeNull();
    const merges = report.transactions.filter((t) => t.phase === "merge");
    // Never rebuilt: the first envelope is found instead.
    expect(merges.map((t) => [t.attempt, t.result])).toEqual([[1, "applied"]]);
    expect(report.steps.find((s) => s.stepId === "S12")).toMatchObject({
      status: "applied",
      txHash: merges[0]!.hash,
    });
    expect(ledger.accounts.has(messy.fixture)).toBe(false);
  });

  it("looks for an earlier envelope when a rebuilt transaction meets tx_no_source_account", async () => {
    let lost: string | null = null;
    const { ledger, deps, plan } = harness(
      (_l, fetch) => (url, init) =>
        lost && url.endsWith(`/transactions/${lost}`) ? reply(404) : fetch(url, init),
    );
    ledger.faults.push("504-not-applied");
    const report = await executeClose(await plan(), signers(), {
      confirm: true,
      ...deps,
      onEvent: (e) => {
        if (e.type === "tx:submitted" && e.index === 0 && e.attempt === 1) lost = e.hash;
        // Another party merges the account away just before the rebuilt envelope is posted.
        if (e.type === "tx:submitted" && e.index === 0 && e.attempt === 2) {
          ledger.accounts.delete(messy.fixture);
        }
      },
    });
    const tx0 = report.transactions.filter((t) => t.round === 0 && t.index === 0);
    expect(tx0.map((t) => t.result)).toEqual(["unknown", "rejected"]);
    expect(tx0[1]!.resultCodes).toMatchObject({ innerTransaction: "tx_no_source_account" });
    // Nothing of this run removed the account, so the stop stands.
    expect(report.status).toBe("failed");
    expect(report.stop).toMatchObject({ code: "ACCOUNT_MISSING", verdict: "stop" });
  });

  it("looks the merge envelopes up once more when the final check finds the account gone", async () => {
    // Horizon finds the first envelope again only after the account check.
    let checked = false;
    const { deps, plan, onEvent } = lostMerge(() => checked);
    const report = await executeClose(await plan(), signers(), {
      confirm: true,
      ...deps,
      onEvent: (e) => {
        onEvent(e);
        if (e.type === "verified") checked = true;
      },
    });
    expect(report.status).toBe("closed");
    expect(report.stop).toBeNull();
    expect(report.verification).toMatchObject({ accountExists: false, horizonStatus: 404 });
    expect(report.transactions.find((t) => t.phase === "merge" && t.attempt === 1)).toMatchObject({
      result: "applied",
    });
  });

  it("does not report failed when the account is gone but no merge envelope was confirmed", async () => {
    const { deps, plan, onEvent } = lostMerge(() => false);
    const report = await executeClose(await plan(), signers(), { confirm: true, ...deps, onEvent });
    expect(report.status).toBe("closed");
    expect(report.verification).toMatchObject({ accountExists: false, horizonStatus: 404 });
    expect(report.message).toMatch(/not confirmed/);
    expect(report.recovery.mergedXlm).toBeNull();
  });
});

describe("review finding 3: a throwing observer cannot lose the merge", () => {
  it("keeps the close when onReport throws once the merge's outcome is published", async () => {
    const { deps, plan } = harness();
    let thrown = 0;
    const report = await executeClose(await plan(), signers(), {
      confirm: true,
      ...deps,
      onReport: (r) => {
        const merged = r.transactions.some((t) => t.phase === "merge" && t.result === "applied");
        if (merged && thrown++ === 0) throw new Error("disk full");
      },
    });
    expect(report.status).toBe("closed");
    expect(report.steps.find((s) => s.stepId === "S12")).toMatchObject({ status: "applied" });
    expect(report.warnings.join(" ")).toMatch(/onReport callback threw \(disk full\)/);
  });

  it("keeps the close when onEvent throws on the merge's confirmation", async () => {
    const { deps, plan } = harness();
    const report = await executeClose(await plan(), signers(), {
      confirm: true,
      ...deps,
      onEvent: (e) => {
        if (e.type === "tx:confirmed" && e.index === 2) throw new Error("terminal gone");
      },
    });
    expect(report.status).toBe("closed");
    expect(report.steps.find((s) => s.stepId === "S12")).toMatchObject({ status: "applied" });
    expect(report.warnings.join(" ")).toMatch(/onEvent callback threw \(terminal gone\)/);
  });

  it("does not count an envelope that was never posted as submitted", async () => {
    const { ledger, deps, plan } = harness();
    const pending: number[] = [];
    let thrown = false;
    const report = await executeClose(await plan(), signers(), {
      confirm: true,
      ...deps,
      onReport: (r) => {
        const last = r.transactions.at(-1);
        if (last?.result !== "pending") return;
        pending.push(last.attempts);
        if (!thrown) {
          thrown = true;
          throw new Error("disk full");
        }
      },
    });
    expect(report.status).toBe("closed");
    // Published before its POST, an envelope has been posted 0 times.
    expect(pending.every((n) => n === 0)).toBe(true);
    expect(report.transactions.every((t) => t.attempts === 1)).toBe(true);
    expect(ledger.submissions).toHaveLength(3);
  });
});

describe("review finding 4: a failed final check keeps the real outcome", () => {
  /** Horizon answers 503 for the account once `down` is set. */
  function flakyAccount() {
    const state = { down: false };
    const h = harness(
      (_l, fetch) => (url, init) =>
        state.down && url.endsWith(`/accounts/${messy.fixture}`) ? reply(503) : fetch(url, init),
    );
    return { ...h, state };
  }

  it("keeps STEP_FAILED_TWICE when the account check after the stop fails", async () => {
    const { ledger, deps, plan, state } = flakyAccount();
    const underfunded = failedOps(
      "op_success",
      "op_success",
      "op_underfunded",
      ...Array.from({ length: 6 }, () => "op_success"),
    );
    ledger.faults.push(underfunded, underfunded);
    let failures = 0;
    const report = await executeClose(await plan(), signers(), {
      confirm: true,
      ...deps,
      onEvent: (e) => {
        if (e.type === "tx:failed" && ++failures === 2) state.down = true;
      },
    });
    expect(report.status).toBe("failed");
    expect(report.stop).toMatchObject({ code: "STEP_FAILED_TWICE", stepId: "S03" });
    expect(report.verification).toBeNull();
    expect(report.warnings.join(" ")).toMatch(/final check of the account failed/);
  });

  it("keeps a partial run partial when its final check fails", async () => {
    const { ledger, deps, plan, state } = flakyAccount();
    const report = await executeClose(await plan(), signers(), {
      confirm: true,
      ...deps,
      allowPartial: true,
      onEvent: (e) => {
        if (e.type === "tx:confirmed" && e.index === 0 && !state.down) {
          const dusta = ledger.accounts
            .get(messy.fixture)!
            .balances.find((b) => b.asset_code === "DUSTA")!;
          Object.assign(dusta, {
            is_authorized: false,
            is_authorized_to_maintain_liabilities: false,
          });
        }
        if (e.type === "plan" && e.round === 1) state.down = true;
      },
    });
    expect(report.status).toBe("partial");
    expect(report.stop).toBeNull();
    expect(report.verification).toBeNull();
    expect(report.warnings.join(" ")).toMatch(/final check of the account failed/);
  });
});

describe("review finding 5: a re-plan must fit what is left of the budget", () => {
  it("stops before signing a re-plan whose bids exceed the remaining budget", async () => {
    const { ledger, deps, plan } = harness();
    // Two operations per transaction: five cleanup transactions, the sale, then the merge alone,
    // 1900 stroops of bids at 100 per operation, within the 2000-stroop budget.
    const p = await plan({ maxOpsPerTransaction: 2, budgetStroops: 2000 });
    expect(p.fees).toMatchObject({ totalStroops: 1900, withinBudget: true });
    const report = await executeClose(p, signers(), {
      confirm: true,
      ...deps,
      onEvent: (e) => {
        // The market vanishes after the cleanup, so the sale fails and the rest is re-planned:
        // return DUSTA (300) and the merge (200), with only 300 stroops of the budget left.
        if (e.type === "tx:confirmed" && e.index === 4) ledger.quotes.clear();
      },
    });
    expect(report.replans).toHaveLength(1);
    expect(report.transactions.filter((t) => t.round === 1)).toEqual([]);
    expect(report.status).toBe("failed");
    expect(report.stop).toMatchObject({ code: "OVER_BUDGET", stage: "sponsor", verdict: "stop" });
    expect(report.message).toMatch(/500 stroops/);
    expect(report.message).toMatch(/300 stroops left/);
  });
});

describe("branches the review found untested", () => {
  it("after tx_bad_seq, takes an earlier envelope found failed on the ledger as the outcome", async () => {
    let hidden: string | null = null;
    const stale = staleAccountOnce(messy.fixture);
    const { ledger, deps, plan } = harness((l, fetch) =>
      stale.wrap((url, init) => {
        if (hidden && url.endsWith(`/transactions/${hidden}`) && l.submissions.length < 2) {
          return reply(404);
        }
        return fetch(url, init);
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
          // The offers are gone, so the first envelope fails on the ledger (and uses the sequence).
          ledger.offers.set(messy.fixture, []);
        }
      },
    });
    const [first, second] = report.transactions;
    expect(first).toMatchObject({ attempt: 1, result: "failed" });
    expect(second).toMatchObject({
      attempt: 2,
      result: "rejected",
      resultCodes: { innerTransaction: "tx_bad_seq" },
    });
    // The fake ledger's records carry no result XDR, so there is no operation code to classify.
    expect(report.stop).toMatchObject({ code: "OPERATION_FAILED", hash: first!.hash });
  });

  it("stops with ACCOUNT_MISSING when the account is gone as the sequence is re-read", async () => {
    const { ledger, deps, plan } = harness();
    ledger.faults.push(
      answer({ transaction: "tx_fee_bump_inner_failed", inner_transaction: "tx_bad_seq" }),
    );
    const report = await executeClose(await plan(), signers(), {
      confirm: true,
      ...deps,
      onEvent: (e) => {
        if (e.type === "tx:failed" && e.index === 0) ledger.accounts.delete(messy.fixture);
      },
    });
    expect(report.status).toBe("failed");
    expect(report.stop).toMatchObject({ code: "ACCOUNT_MISSING", verdict: "stop" });
    expect(report.verification).toMatchObject({ accountExists: false });
    expect(ledger.submissions).toHaveLength(1);
  });
});

describe("AC-E2-S3-4: a step that fails twice is reported as a blocker", () => {
  it("lists the step in the report's blockers, with its reason, codes and remedy", async () => {
    const { ledger, deps, plan } = harness();
    const underfunded = failedOps(
      "op_success",
      "op_success",
      "op_underfunded",
      ...Array.from({ length: 6 }, () => "op_success"),
    );
    ledger.faults.push(underfunded, underfunded);
    const report = await executeClose(await plan(), signers(), { confirm: true, ...deps });
    expect(report.stop).toMatchObject({ code: "STEP_FAILED_TWICE", stepId: "S03" });
    const blocker = report.blockers.find((b) => b.code === "STEP_FAILED_TWICE");
    expect(blocker).toMatchObject({
      permanent: false,
      stepId: "S03",
      resultCodes: { innerTransaction: "tx_failed" },
    });
    expect(blocker!.reason).toMatch(/S03 .*DUSTB.*failed twice.*op_underfunded/);
    expect(blocker!.remedy).toMatch(/--partial/);
    // The receipt's "Not closed" section shows it.
    const text = renderReport(report);
    expect(text).toMatch(/Not closed[\s\S]*STEP_FAILED_TWICE/);
  });
});

// Edge-case review of the executor (E1-E11), reproduced from its probes on the injected clock.
const BAD_SEQ = answer({
  transaction: "tx_fee_bump_inner_failed",
  inner_transaction: "tx_bad_seq",
});

describe("edge case E1: a second tx_bad_seq looks the envelopes up before stopping", () => {
  it("finds the envelope that applied at the re-read sequence instead of reporting a conflict", async () => {
    let hidden: string | null = null;
    const { ledger, deps, plan } = harness(
      (l, fetch) => (url, init) =>
        // The lookup source lags: attempt 2's record is invisible until attempt 3 has been posted.
        hidden && l.submissions.length < 3 && url.endsWith(`/transactions/${hidden}`)
          ? reply(404)
          : fetch(url, init),
    );
    ledger.faults.push(BAD_SEQ, "504-applied");
    const report = await executeClose(await plan(), signers(), {
      confirm: true,
      ...deps,
      onEvent: (e) => {
        if (e.type === "tx:submitted" && e.index === 0 && e.attempt === 2) hidden = e.hash;
      },
    });
    const attempt2 = report.transactions.find(
      (t) => t.round === 0 && t.index === 0 && t.attempt === 2,
    )!;
    expect(attempt2.result).toBe("applied");
    expect(report.steps.find((s) => s.stepId === "S01")).toMatchObject({
      status: "applied",
      txHash: attempt2.hash,
    });
    expect(report.stop).toBeNull();
    expect(report.status).toBe("closed");
  });
});

describe("edge case E7: a refused envelope's bid does not stay counted after a resequence", () => {
  it("closes within a budget that the old sequence's bid would otherwise exhaust", async () => {
    const { ledger, deps, plan } = harness();
    const p = await plan({ budgetStroops: 2000 });
    expect(p.fees.totalStroops).toBe(1500);
    const report = await executeClose(p, signers(), {
      confirm: true,
      ...deps,
      onEvent: (e) => {
        // Another client uses the account's next sequence number while the envelope is in flight.
        if (e.type === "tx:submitted" && e.round === 0 && e.index === 0 && e.attempt === 1) {
          const account = ledger.accounts.get(messy.fixture)!;
          account.sequence = (BigInt(account.sequence) + 1n).toString();
        }
      },
    });
    expect(report.stop).toBeNull();
    expect(report.status).toBe("closed");
    const tx0 = report.transactions.filter((t) => t.round === 0 && t.index === 0);
    expect(tx0.map((t) => t.result)).toEqual(["rejected", "applied"]);
  });
});

describe("edge case E2: a rebuilt merge follows a fresh preflight", () => {
  it("stops at the sequence guard instead of rebuilding the merge after tx_bad_seq", async () => {
    const { ledger, deps, plan } = harness();
    let bumped = false;
    const report = await executeClose(await plan(), signers(), {
      confirm: true,
      ...deps,
      onEvent: (e) => {
        if (e.type === "tx:submitted" && e.index === 2 && e.attempt === 1 && !bumped) {
          bumped = true;
          // Another client bumps the sequence far ahead (BumpSequence) while the merge is in flight:
          // 500 ledgers, beyond the plan's bound of 120, so the rebuild is not waited for (E3-S4;
          // a bump within the bound is waited for, test/unit/execute/sequence-guard.test.ts).
          const account = ledger.accounts.get(messy.fixture)!;
          account.sequence = (BigInt(ledger.ledgerSeq + 500) << 32n).toString();
        }
      },
    });
    const merges = report.transactions.filter((t) => t.phase === "merge");
    expect(merges.map((t) => t.result)).toEqual(["rejected"]);
    expect(report.stop).toMatchObject({
      code: "SEQNUM_TOO_FAR",
      unblocksAtLedger: ledger.ledgerSeq + 501,
    });
    expect(ledger.accounts.has(messy.fixture)).toBe(true);
  });
});

describe("edge case E6: included or refused is decided by the ledger, not by the codes", () => {
  it("treats a tx_failed refused at validation (op_bad_auth) as a refusal", async () => {
    const { ledger, deps, plan } = harness();
    const before = ledger.accounts.get(messy.fixture)!.sequence;
    // stellar-core answers txFAILED for an operation that fails its checks at validation; the
    // envelope is never included, so Horizon has no record of it.
    ledger.faults.push(
      answer({
        transaction: "tx_fee_bump_inner_failed",
        inner_transaction: "tx_failed",
        operations: ["op_bad_auth"],
      }),
    );
    const report = await executeClose(await plan(), signers(), { confirm: true, ...deps });
    const t = report.transactions[0]!;
    expect(t.result).toBe("rejected");
    expect(t.feeChargedStroops).toBeNull();
    expect(report.steps.some((s) => s.status === "failed")).toBe(false);
    expect(report.stop).toMatchObject({ code: "TRANSACTION_REJECTED", verdict: "stop" });
    expect(ledger.accounts.get(messy.fixture)!.sequence).toBe(before);
  });

  it("treats an included fee bump whose inner code is not tx_failed as included", async () => {
    const { ledger, deps, plan } = harness();
    // Included in a ledger that closed after the inner time bound: the inner transaction failed
    // with tx_too_late at apply time, its sequence number used and the fee charged.
    ledger.faults.push(
      included({ transaction: "tx_fee_bump_inner_failed", inner_transaction: "tx_too_late" }),
    );
    const report = await executeClose(await plan(), signers(), { confirm: true, ...deps });
    const tx0 = report.transactions.filter((t) => t.round === 0 && t.index === 0);
    expect(tx0).toHaveLength(1);
    expect(tx0[0]).toMatchObject({ result: "failed", feeChargedStroops: 1000 });
    expect(ledger.submissions).toHaveLength(1);
  });
});

describe("edge case E5: a 404 contradicted by the account's sequence number is not trusted", () => {
  it("re-plans instead of rebuilding, and records the envelope once Horizon finds it", async () => {
    let hidden: string | null = null;
    const { ledger, deps, plan } = harness(
      (l, fetch) => (url, init) =>
        // Lookups by hash lag behind the ledger and account reads until the third POST.
        hidden && l.submissions.length < 3 && url.endsWith(`/transactions/${hidden}`)
          ? reply(404)
          : fetch(url, init),
    );
    ledger.faults.push("504-applied");
    const report = await executeClose(await plan(), signers(), {
      confirm: true,
      ...deps,
      onEvent: (e) => {
        if (e.type === "tx:submitted" && e.index === 0 && e.attempt === 1) hidden = e.hash;
      },
    });
    const tx0 = report.transactions.filter((t) => t.round === 0 && t.index === 0);
    // Never rebuilt: the account showed the sequence number used, so the rest was re-planned.
    expect(tx0).toHaveLength(1);
    expect(report.replans).toHaveLength(1);
    // Looked up again at the end, the envelope is found applied and its steps recorded.
    expect(tx0[0]).toMatchObject({ result: "applied" });
    expect(report.steps.find((s) => s.stepId === "S01")).toMatchObject({
      status: "applied",
      txHash: tx0[0]!.hash,
    });
    expect(report.status).toBe("closed");
    expect(ledger.submissions).toHaveLength(3);
  });
});

describe("edge case E8: a re-plan that finds the account gone stops with ACCOUNT_MISSING", () => {
  it("lets the final check decide instead of reporting a partial run on a missing account", async () => {
    const { ledger, deps, plan } = harness();
    const dusta = [...ledger.quotes.keys()][0]!;
    const report = await executeClose(await plan(), signers(), {
      confirm: true,
      ...deps,
      allowPartial: true,
      onEvent: (e) => {
        if (e.type === "tx:confirmed" && e.index === 0) ledger.quotes.set(dusta, "0.0000001");
        // Merged away by another party between the failed sale and the re-plan.
        if (e.type === "tx:failed" && e.index === 1) ledger.accounts.delete(messy.fixture);
      },
    });
    expect(report.stop).toMatchObject({ code: "ACCOUNT_MISSING", verdict: "stop" });
    // No merge of this run removed it, so the stop stands.
    expect(report.status).toBe("failed");
    expect(report.verification).toMatchObject({ accountExists: false });
    expect(report.message).not.toMatch(/still exists/);
  });
});

describe("edge case E11: numeric execute options are checked before anything is read or signed", () => {
  const invalid: Array<[string, number]> = [
    ["maxAttemptsPerTransaction", Number.NaN],
    ["maxAttemptsPerTransaction", 0],
    ["maxAttemptsPerTransaction", 1.5],
    ["maxReplans", -1],
    ["maxReplans", Number.NaN],
    ["maxRateLimitRetries", -1],
    ["pollIntervalMs", Number.NaN],
    ["pollIntervalMs", -5],
    // Pauses are at least 200 ms and never 0 (builder decision of 2026-09-28).
    ["pollIntervalMs", 0],
    ["pollIntervalMs", 199],
    ["backoffMs", 0],
    ["backoffMs", Number.POSITIVE_INFINITY],
    ["verifyTimeoutMs", -1],
    ["graceSeconds", Number.NaN],
    ["ledgerWaitSeconds", -1],
    ["timeoutSeconds", 0],
    ["budgetStroops", 0],
    ["maxBaseFeeStroops", 50],
  ];

  it.each(invalid)("refuses %s = %s with CONFIG_INVALID", async (name, value) => {
    let requests = 0;
    const { ledger, deps, plan } = harness((_l, fetch) => (url, init) => {
      requests += 1;
      return fetch(url, init);
    });
    const p = await plan();
    const before = requests;
    let signed = 0;
    const counting = {
      account: { publicKey: () => messy.fixture, sign: () => void signed++ },
      feeSponsor: { publicKey: () => messy.sponsor, sign: () => void signed++ },
    };
    await expect(
      executeClose(p, counting, { confirm: true, ...deps, [name]: value }),
    ).rejects.toMatchObject({ code: "CONFIG_INVALID", stage: "config" });
    expect(requests).toBe(before);
    expect(signed).toBe(0);
    expect(ledger.submissions).toHaveLength(0);
  });

  it("accepts the 200 ms floor and zero bounds; tests skip waiting with an injected sleep", async () => {
    const { deps, plan } = harness();
    const report = await executeClose(await plan(), signers(), {
      confirm: true,
      ...deps,
      sleep: noSleep,
      pollIntervalMs: 200,
      backoffMs: 200,
      graceSeconds: 0,
      verifyTimeoutMs: 0,
      maxReplans: 0,
      maxRateLimitRetries: 0,
    });
    expect(report.status).toBe("closed");
  });
});

describe("edge cases E3, E4: an account read behind the run's own transactions is read again", () => {
  /** A Horizon behind the one that took transaction `index` serves the account as it was before it. */
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
      if (e.type === "tx:confirmed" && e.index === index) left = reads;
    };
    return { ...h, onEvent };
  }

  it("E3: does not build the next transaction at a sequence number the run already used", async () => {
    const { ledger, deps, plan, onEvent } = lagAfter(0, 2);
    const report = await executeClose(await plan(), signers(), { confirm: true, ...deps, onEvent });
    expect(report.status).toBe("closed");
    // Transaction 2 was built once, at the right sequence number.
    expect(report.transactions.filter((t) => t.index === 1)).toHaveLength(1);
    expect(ledger.submissions).toHaveLength(3);
  });

  it("E4: does not refuse the merge for leftovers a lagging read still shows", async () => {
    const { deps, plan, onEvent } = lagAfter(1, 1);
    const report = await executeClose(await plan(), signers(), { confirm: true, ...deps, onEvent });
    expect(report.stop).toBeNull();
    expect(report.status).toBe("closed");
  });
});

describe("edge case E9: reserves returned to sponsors come from the removals that applied", () => {
  it("credits a sponsored trustline that only a later round removed", async () => {
    const { ledger, deps, plan } = harness();
    const late = `LATE:${messy.issuer}`;
    let changed = false;
    const report = await executeClose(await plan(), signers(), {
      confirm: true,
      ...deps,
      onDrift: "replan",
      onEvent: (e) => {
        if (e.type === "tx:confirmed" && e.index === 0 && !changed) {
          changed = true;
          // A trustline sponsored by another account appears and the market vanishes, so the sale
          // fails and the run re-plans; the accepted re-plan removes the new trustline too.
          ledger.addTrustline(messy.fixture, late, { sponsor: messy.marketMaker });
          ledger.quotes.clear();
        }
      },
    });
    expect(report.status).toBe("closed");
    expect(report.replans).toHaveLength(1);
    expect(report.replans[0]!.drift.join(" ")).toMatch(/LATE/);
    expect(ledger.accounts.get(messy.marketMaker)!.num_sponsoring).toBe(0);
    expect(report.recovery.reservesReturnedToSponsors).toEqual(
      [
        {
          sponsor: messy.reserveSponsor,
          xlm: "0.5000000",
          entries: [`trustline SPTA:${messy.issuer}`],
        },
        { sponsor: messy.marketMaker, xlm: "0.5000000", entries: [`trustline ${late}`] },
      ].sort((a, b) => (a.sponsor < b.sponsor ? -1 : 1)),
    );
  });

  /** Another account sponsors the closing account's own entry: two base reserves (CAP-33). */
  function sponsorAccountEntry(ledger: FakeLedger) {
    ledger.accounts.get(messy.fixture)!.sponsor = messy.marketMaker;
    ledger.accounts.get(messy.fixture)!.num_sponsored += 2;
    ledger.accounts.get(messy.marketMaker)!.num_sponsoring += 2;
  }
  const accountEntry = { sponsor: messy.marketMaker, xlm: "1.0000000", entries: ["account entry"] };

  it("credits the sponsored account entry that the merge removed", async () => {
    const { ledger, deps, plan } = harness();
    sponsorAccountEntry(ledger);
    const report = await executeClose(await plan(), signers(), { confirm: true, ...deps });
    expect(report.status).toBe("closed");
    expect(report.recovery.reservesReturnedToSponsors).toContainEqual(accountEntry);
  });

  it("credits it too when the account is gone but the merge was not confirmed", async () => {
    const { ledger, deps, plan, onEvent } = lostMerge(() => false);
    sponsorAccountEntry(ledger);
    const report = await executeClose(await plan(), signers(), { confirm: true, ...deps, onEvent });
    expect(report.status).toBe("closed");
    expect(report.message).toMatch(/not confirmed/);
    expect(report.recovery.reservesReturnedToSponsors).toContainEqual(accountEntry);
  });
});

// Items of the blind adversarial review of the executor (2026-09-27).

describe("blind review BH1: a copy of a run in progress says it is running", () => {
  it("publishes status running until the run finishes; the returned report never has it", async () => {
    const { deps, plan } = harness();
    const copies: Array<{ status: string; finished: boolean; merged: boolean }> = [];
    const report = await executeClose(await plan(), signers(), {
      confirm: true,
      ...deps,
      onReport: (r) =>
        copies.push({
          status: r.status,
          finished: r.finishedAt !== null,
          merged: r.steps.some((s) => s.stepId === "S12" && s.status === "applied"),
        }),
    });
    const inProgress = copies.filter((c) => !c.finished);
    expect(inProgress.length).toBeGreaterThan(3);
    expect(new Set(inProgress.map((c) => c.status))).toEqual(new Set(["running"]));
    // A copy saved after the merge applied and before the final check does not say "aborted".
    expect(inProgress.some((c) => c.merged)).toBe(true);
    expect(copies.at(-1)).toEqual({ status: "closed", finished: true, merged: true });
    expect(report.status).toBe("closed");
  });
});

describe("blind review BH3: an unknown envelope says whether it may still apply", () => {
  it("marks one that may still apply: no ledger closed past its bound", async () => {
    let frozen: string | null = null;
    const { ledger, deps, plan } = harness((_l, fetch) => async (url, init) => {
      const response = await fetch(url, init);
      if (!url.includes("/ledgers")) return response;
      const page = (await response.json()) as {
        _embedded: { records: { closed_at: string }[] };
      };
      frozen ??= page._embedded.records[0]!.closed_at;
      page._embedded.records[0]!.closed_at = frozen;
      return new Response(JSON.stringify(page));
    });
    ledger.faults.push("504-not-applied");
    const report = await executeClose(await plan(), signers(), { confirm: true, ...deps });
    expect(report.stop).toMatchObject({ code: "OUTCOME_UNKNOWN" });
    expect(report.transactions[0]).toMatchObject({ result: "unknown", mayStillApply: true });
    expect(report.transactions[0]!.explanation).toMatch(/may still apply/);
  });

  it("marks one not found after its bound as one that can never apply", async () => {
    const { ledger, deps, plan } = harness();
    ledger.faults.push("504-not-applied");
    const report = await executeClose(await plan(), signers(), { confirm: true, ...deps });
    expect(report.status).toBe("closed");
    const [first, second] = report.transactions.filter((t) => t.round === 0 && t.index === 0);
    expect(first).toMatchObject({ result: "unknown", mayStillApply: false });
    expect(first!.explanation).toMatch(/can never apply/);
    expect(second).toMatchObject({ result: "applied" });
    expect(second).not.toHaveProperty("mayStillApply");
  });

  it("does not call one that could not be looked up not found", async () => {
    const { ledger, deps, plan } = harness(
      (_l, fetch) => (url, init) =>
        url.includes("/transactions/") ? reply(503) : fetch(url, init),
    );
    ledger.faults.push("504-applied");
    const report = await executeClose(await plan(), signers(), { confirm: true, ...deps });
    expect(report.stop).toMatchObject({ code: "OUTCOME_UNKNOWN" });
    const [tx] = report.transactions;
    // Its bound passed on the ledger, so it cannot apply any more; it may have applied already.
    expect(tx).toMatchObject({ result: "unknown", mayStillApply: false });
    expect(tx!.explanation).toMatch(/could not be looked up/);
    expect(tx!.explanation).not.toMatch(/not found/i);
  });

  it("drops the mark once the envelope is found applied after all", async () => {
    let checked = false;
    const { deps, plan, onEvent } = lostMerge(() => checked);
    const report = await executeClose(await plan(), signers(), {
      confirm: true,
      ...deps,
      onEvent: (e) => {
        onEvent(e);
        if (e.type === "verified") checked = true;
      },
    });
    expect(report.status).toBe("closed");
    const merge = report.transactions.find((t) => t.phase === "merge" && t.attempt === 1)!;
    expect(merge).toMatchObject({ result: "applied" });
    expect(merge).not.toHaveProperty("mayStillApply");
    expect(merge).not.toHaveProperty("explanation");
  });
});
