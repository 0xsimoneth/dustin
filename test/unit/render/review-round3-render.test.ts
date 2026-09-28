import { describe, expect, it } from "vitest";
import { formatStroops } from "../../../src/amounts.js";
import { executeClose, type CloseEvent } from "../../../src/execute/executor.js";
import type { CloseReport } from "../../../src/execute/report.js";
import type { ClosePlan } from "../../../src/plan/model.js";
import { renderReport } from "../../../src/render/report-text.js";
import { harness, reply, signers } from "../execute/harness.js";

// Third review round of E2-S4 (2026-09-28): the receipt. Every test here failed on the code
// before its fix. Reports come from the real executor on the fake ledger, so the labels are
// checked against the executor's own explanations.

/** The receipt's head of the transaction with this hash, its wrapped lines joined into one. */
function txLine(text: string, hash: string): string {
  const lines = text.split("\n");
  const at = lines.findIndex((line) => line.endsWith(`outer hash  ${hash}`));
  expect(at, `no transaction ${hash} in the receipt`).toBeGreaterThan(0);
  let start = at - 1;
  while (start > 0 && !lines[start]!.startsWith("  tx ")) start -= 1;
  return lines
    .slice(start, at)
    .map((line) => line.trim())
    .join(" ");
}

/** The latest ledger's close time stays at its first reading: no ledger passes a time bound. */
function frozenLedger() {
  let frozen: string | null = null;
  return (fetch: (url: string, init?: RequestInit) => Promise<Response>) =>
    async (url: string, init?: RequestInit) => {
      const response = await fetch(url, init);
      if (!url.includes("/ledgers")) return response;
      const page = (await response.json()) as { _embedded: { records: { closed_at: string }[] } };
      frozen ??= page._embedded.records[0]!.closed_at;
      page._embedded.records[0]!.closed_at = frozen;
      return new Response(JSON.stringify(page));
    };
}

describe("R3-22: an unknown envelope is labelled from what is known", () => {
  it("does not call one whose lookups failed after its bound 'not found ... can never apply'", async () => {
    const { ledger, deps, plan } = harness(
      (_l, fetch) => (url, init) =>
        url.includes("/transactions/") ? reply(503) : fetch(url, init),
    );
    ledger.faults.push("504-applied");
    const plans: ClosePlan[] = [];
    const report = await executeClose(await plan(), signers(), {
      confirm: true,
      ...deps,
      onEvent: (e) => {
        if (e.type === "plan") plans.push(e.plan);
      },
    });
    const [tx] = report.transactions;
    expect(tx).toMatchObject({ result: "unknown", mayStillApply: false, lookupError: "HTTP 503" });
    const line = txLine(renderReport(report, { plans }), tx!.hash);
    expect(line).not.toMatch(/not found/);
    expect(line).not.toMatch(/can never apply/);
    expect(line).toMatch(/could not be looked up, so whether it applied is not known/);
  });

  it("does not call one that may still apply but could not be looked up 'not found yet'", async () => {
    // Blind review BH-13: lookups fail and no ledger passes the bound, so it may still apply.
    const frozen = frozenLedger();
    const { ledger, deps, plan } = harness((_l, fetch) =>
      frozen((url, init) => (url.includes("/transactions/") ? reply(503) : fetch(url, init))),
    );
    ledger.faults.push("504-not-applied");
    const report = await executeClose(await plan(), signers(), { confirm: true, ...deps });
    const [tx] = report.transactions;
    expect(tx).toMatchObject({ result: "unknown", mayStillApply: true, lookupError: "HTTP 503" });
    const line = txLine(renderReport(report), tx!.hash);
    expect(line).not.toMatch(/not found/);
    expect(line).toMatch(/could not be looked up, and it may still apply/);
  });

  it("says a merge whose number is used may have applied, on a receipt that says CLOSED", async () => {
    // The merge applies behind a 504; Horizon never returns its record; the account is gone.
    let merge: string | null = null;
    const { ledger, deps, plan } = harness(
      (_l, fetch) => (url, init) =>
        merge && url.endsWith(`/transactions/${merge}`) ? reply(404) : fetch(url, init),
    );
    const report = await executeClose(await plan(), signers(), {
      confirm: true,
      ...deps,
      onEvent: (e: CloseEvent) => {
        if (e.type === "tx:submitted" && e.index === 2 && e.attempt === 1) {
          merge = e.hash;
          ledger.faults.push("504-applied");
        }
      },
    });
    expect(report.status).toBe("closed");
    const tx = report.transactions.find((t) => t.hash === merge)!;
    expect(tx).toMatchObject({ result: "unknown", sequenceUsed: true });
    const text = renderReport(report);
    expect(text.split("\n")[0]).toContain("CLOSED");
    const line = txLine(text, tx.hash);
    expect(line).not.toMatch(/can never apply/);
    expect(line).toMatch(/sequence number is used, so it may have applied/);
  });
});

/** A closed run of the messy fixture, with the plans it executed. */
async function closedRun(onEvent?: (e: CloseEvent, h: ReturnType<typeof harness>) => void) {
  const h = harness();
  const plans: ClosePlan[] = [];
  const report = await executeClose(await h.plan(), signers(), {
    confirm: true,
    ...h.deps,
    onEvent: (e) => {
      if (e.type === "plan") plans.push(e.plan);
      onEvent?.(e, h);
    },
  });
  return { report, plans };
}

describe("R3-24: the receipt gives each transaction's ledger and the fee charged to the sponsor", () => {
  it("prints them on the line of every transaction that was included", async () => {
    // The sale fails on the ledger (charged) after the market vanishes; the rest applies.
    const { report, plans } = await closedRun((e, h) => {
      if (e.type === "tx:confirmed" && e.index === 0) h.ledger.quotes.clear();
    });
    expect(report.status).toBe("closed");
    const text = renderReport(report, { plans });
    const included = report.transactions.filter((t) => t.ledger !== null);
    expect(included.map((t) => t.result)).toEqual(["applied", "failed", "applied"]);
    for (const t of included) {
      const line = txLine(text, t.hash);
      const fee = t.feeChargedStroops!;
      expect(line).toContain(`ledger ${t.ledger!.toLocaleString("en-US")}`);
      expect(line).toContain(
        `fee ${formatStroops(BigInt(fee))} XLM (${fee.toLocaleString("en-US")} stroops) charged to the sponsor`,
      );
    }
    // The fees on the lines add up to what the result says the sponsor paid.
    const paid = report.recovery.feesPaidBySponsorStroops;
    expect(included.reduce((sum, t) => sum + t.feeChargedStroops!, 0)).toBe(paid);
    expect(text).toContain(
      `${formatStroops(BigInt(paid))} XLM (${paid.toLocaleString("en-US")} stroops) in fees paid by the sponsor`,
    );
  });
});

describe("R3-23: a copy saved while the run was going reads as a run in progress", () => {
  it("never tells the reader to start the same close again while it may still run", async () => {
    // The copy a --report file holds while the second transaction's POST is in flight.
    let inFlight: CloseReport | null = null;
    const { plans } = await closedRun();
    const h = harness();
    await executeClose(await h.plan(), signers(), {
      confirm: true,
      ...h.deps,
      onReport: (copy) => {
        const last = copy.transactions.at(-1);
        if (copy.transactions.length === 2 && last?.result === "pending" && last.attempts === 1) {
          inFlight = copy;
        }
      },
    });
    const copy = inFlight!;
    expect(copy.status).toBe("running");
    const text = renderReport(copy, { plans });
    expect(text.split("\n")[0]).toContain("RUNNING");
    // The envelope in flight is not a stopped run's leftover.
    const line = txLine(text, copy.transactions[1]!.hash);
    expect(line).not.toMatch(/when the run stopped/);
    expect(line).toMatch(/not known yet when this copy was saved/);
    expect(text).not.toMatch(/the run stopped before the final Horizon check/);
    expect(text).toMatch(/not checked yet: the run was still in progress/);
    // The next step: do not start a second close of the same account while this one may run.
    const next = text.slice(text.indexOf("Next"));
    expect(next).not.toMatch(/^Next {9}Run the same command again/);
    expect(next.replace(/\s+/g, " ")).toMatch(/Do not start the same close again/);
  });
});

describe("R3-36: the failed headline knows an applied merge without its merged amount", () => {
  it("says the merge applied when its result gave no amount (with and without the plans)", async () => {
    const { report, plans } = await closedRun();
    // The fake ledger writes no result XDR, so the merged amount is not known.
    expect(report.recovery.mergedXlm).toBeNull();
    // A copy taken after the merge applied, marked failed when the run then stopped (the CLI
    // does this with the last copy of a run interrupted without a report).
    const stopped = structuredClone(report);
    stopped.status = "failed";
    stopped.verification = null;
    for (const text of [renderReport(stopped, { plans }), renderReport(stopped)]) {
      expect(text.split("\n")[0]).toContain(
        "FAILED: the merge applied, but the account was not verified gone",
      );
      expect(text).not.toContain("stopped before the account was closed");
    }
  });
});
