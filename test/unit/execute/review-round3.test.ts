import { describe, expect, it } from "vitest";
import { executeClose } from "../../../src/execute/executor.js";
import type { CloseReport } from "../../../src/execute/report.js";
import { messy } from "../../helpers/snapshots.js";
import { failedOps, harness, signers } from "./harness.js";

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
