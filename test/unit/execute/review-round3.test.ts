import { describe, expect, it } from "vitest";
import { executeClose } from "../../../src/execute/executor.js";
import { messy } from "../../helpers/snapshots.js";
import { failedOps, harness, signers } from "./harness.js";

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
