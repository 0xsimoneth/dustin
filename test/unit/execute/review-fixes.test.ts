import { describe, expect, it } from "vitest";
import { executeClose, type CloseEvent } from "../../../src/execute/executor.js";
import { renderReport } from "../../../src/render/report-text.js";
import type { FakeLedger } from "../../helpers/fake-ledger.js";
import { messy } from "../../helpers/snapshots.js";
import { answer, failedOps, harness, reply, signers } from "./harness.js";

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
    const { ledger, deps, plan } = harness(
      (_l, fetch) => (url, init) =>
        // Horizon loses the first envelope's record: its lookups keep answering 404.
        lost && url.endsWith(`/transactions/${lost}`) ? reply(404) : fetch(url, init),
    );
    ledger.faults.push("504-applied");
    const report = await executeClose(await plan(), signers(), {
      confirm: true,
      ...deps,
      onEvent: (e) => {
        if (e.type === "tx:submitted" && e.index === 0 && e.attempt === 1) lost = e.hash;
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

describe("review finding 2: a merge that applied unseen is still a close", () => {
  /**
   * The merge's first envelope applies but Horizon answers 504 and then 404 for its hash (it lost
   * the record); `reveal` decides when the record shows up again.
   */
  function lostMerge(reveal: (ledger: FakeLedger) => boolean) {
    let merge: string | null = null;
    const h = harness(
      (l, fetch) => (url, init) =>
        merge && url.endsWith(`/transactions/${merge}`) && !reveal(l)
          ? reply(404)
          : fetch(url, init),
    );
    const onEvent = (e: CloseEvent) => {
      if (e.type === "tx:submitted" && e.index === 2 && e.attempt === 1) {
        merge = e.hash;
        h.ledger.faults.push("504-applied");
      }
    };
    return { ...h, onEvent };
  }

  it("looks the earlier envelope up when the rebuilt merge finds the account gone", async () => {
    // Horizon finds the first envelope again once the rebuild's preflight has found the account
    // gone (edge case E2 runs the preflight before any rebuild of the merge).
    let blocked = false;
    const { ledger, deps, plan, onEvent } = lostMerge(() => blocked);
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
    const { ledger, deps, plan } = harness((l, fetch) => (url, init) => {
      if (hidden && url.endsWith(`/transactions/${hidden}`) && l.submissions.length < 2) {
        return reply(404);
      }
      return fetch(url, init);
    });
    ledger.faults.push("504-applied");
    const report = await executeClose(await plan(), signers(), {
      confirm: true,
      ...deps,
      onEvent: (e) => {
        if (e.type === "tx:submitted" && e.index === 0 && e.attempt === 1) {
          hidden = e.hash;
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
        if (e.type === "tx:submitted" && e.index === 0 && e.attempt === 1) {
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
          // Another client bumps the sequence far ahead (BumpSequence) while the merge is in flight.
          const account = ledger.accounts.get(messy.fixture)!;
          account.sequence = (BigInt(ledger.ledgerSeq + 50) << 32n).toString();
        }
      },
    });
    const merges = report.transactions.filter((t) => t.phase === "merge");
    expect(merges.map((t) => t.result)).toEqual(["rejected"]);
    expect(report.stop).toMatchObject({
      code: "MERGE_PREFLIGHT_FAILED",
      unblocksAtLedger: ledger.ledgerSeq + 51,
    });
    expect(ledger.accounts.has(messy.fixture)).toBe(true);
  });
});
