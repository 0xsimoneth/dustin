import { describe, expect, it } from "vitest";
import { executeClose, type CloseEvent } from "../../../src/execute/executor.js";
import type { ClosePlan } from "../../../src/plan/model.js";
import { renderReport } from "../../../src/render/report-text.js";
import { harness, reply, signers } from "../execute/harness.js";

// Third review round of E2-S4 (2026-09-28): the receipt. Every test here failed on the code
// before its fix. Reports come from the real executor on the fake ledger, so the labels are
// checked against the executor's own explanations.

/** The receipt's head line of the transaction with this hash. */
function txLine(text: string, hash: string): string {
  const lines = text.split("\n");
  const at = lines.findIndex((line) => line.endsWith(`outer hash  ${hash}`));
  expect(at, `no transaction ${hash} in the receipt`).toBeGreaterThan(0);
  return lines[at - 1]!;
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
