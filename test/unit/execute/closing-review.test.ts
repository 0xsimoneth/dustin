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

describe("CX-2: a worse quote in a plan without a merge is drift too (BH-7)", () => {
  /** A plan that cannot merge (the guard is beyond the bound) and still sells DUSTA. */
  async function farGuardPlan() {
    const h = harness();
    bump(h.ledger, 720);
    const approved = await h.plan();
    expect(approved.status).toBe("blocked");
    expect(approved.steps.some((s) => s.kind === "merge")).toBe(false);
    expect(approved.recovery).toMatchObject({
      xlmToDestination: "0.0000000",
      nativeBalance: "4.0000000",
      quotedProceedsXlm: "0.0000007",
    });
    // The quote falls 7 times while the confirmation waits.
    h.ledger.quotes.set([...h.ledger.quotes.keys()][0]!, "0.0000001");
    return { ...h, approved };
  }

  it("aborts with nothing signed, comparing what the account would keep", async () => {
    const { ledger, clock, deps, approved } = await farGuardPlan();
    const events: CloseEvent[] = [];
    const report = await executeClose(approved, signers(), {
      confirm: true,
      ...deps,
      sleep: tickingSleep(ledger, clock),
      allowPartial: true,
      onEvent: (e) => events.push(e),
    });
    const amounts = { approved: "4.0000007", fresh: "4.0000001" };
    expect(events.find((e) => e.type === "drift")).toMatchObject({
      action: "abort",
      xlmToDestination: amounts,
    });
    expect(report.status).toBe("aborted");
    expect(report.stop).toMatchObject({
      code: "XLM_TO_DESTINATION_FELL",
      xlmToDestination: amounts,
    });
    expect(report.stop!.detail).toMatch(
      /the XLM the account would keep \(its balance plus the quoted sales; the plan does not merge\) fell from 4\.0000007 XLM to 4\.0000001 XLM/,
    );
    expect(report.stop!.detail).not.toMatch(/destination would receive/);
    expect(ledger.submissions).toHaveLength(0);
  });

  it("goes on under onDrift replan with a warning that names what the account keeps", async () => {
    const { ledger, clock, deps, approved } = await farGuardPlan();
    const report = await executeClose(approved, signers(), {
      confirm: true,
      ...deps,
      sleep: tickingSleep(ledger, clock),
      allowPartial: true,
      onDrift: "replan",
    });
    expect(report.status).toBe("partial");
    expect(report.transactions.map((t) => [t.phase, t.result])).toEqual([
      ["cleanup", "applied"],
      ["convert", "applied"],
    ]);
    const warning = report.warnings.find((w) => w.includes("fell from"));
    expect(warning).toMatch(
      /the XLM the account would keep .* fell from 4\.0000007 XLM to 4\.0000001 XLM/,
    );
    expect(warning).toMatch(/the run went on with the fresh plan/);
  });

  it("keeps the words of a plan that merges (control)", async () => {
    const { ledger, deps, plan } = harness();
    const approved = await plan();
    ledger.quotes.set([...ledger.quotes.keys()][0]!, "0.0000001");
    const report = await executeClose(approved, signers(), { confirm: true, ...deps });
    expect(report.stop).toMatchObject({
      code: "XLM_TO_DESTINATION_FELL",
      xlmToDestination: { approved: "4.0000007", fresh: "4.0000001" },
    });
    expect(report.stop!.detail).toMatch(
      /the XLM the destination would receive fell from 4\.0000007 XLM to 4\.0000001 XLM/,
    );
  });
});
