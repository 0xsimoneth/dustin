import { describe, expect, it } from "vitest";
import { exitCodeForReport } from "../../../src/cli/exit-codes.js";
import { executeClose, type CloseEvent } from "../../../src/execute/executor.js";
import type { FakeLedger } from "../../helpers/fake-ledger.js";
import { messy } from "../../helpers/snapshots.js";
import { harness, reply, signers, type TestClock } from "./harness.js";

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
