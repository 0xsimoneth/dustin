import { describe, expect, it } from "vitest";
import { executeClose, type CloseEvent } from "../../../src/execute/executor.js";
import type { FakeLedger } from "../../helpers/fake-ledger.js";
import { messy } from "../../helpers/snapshots.js";
import { harness, signers, type TestClock } from "./harness.js";

// Review finding CA-11, PRD decision D-10 (story E4-S2): the executor and a fresh plan whose hash
// is the approved one but whose grouping differs by the sequence guard's regrouping of the merge.
// The run follows the fresh plan's grouping and the report says so; before the fix the regrouping
// changed the hash and the run stopped with PLAN_CHANGED before signing anything.

/** Ledgers close every 5 s of the test clock, so each pause the executor takes lets ledgers pass. */
function tickingSleep(ledger: FakeLedger, clock: TestClock, msPerLedger = 5000) {
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

/** The recorded fixture on the fake ledger without a market: DUSTA returns to its issuer. */
function withoutMarket() {
  const h = harness();
  h.ledger.quotes.clear();
  return h;
}

describe("the executor and the sequence guard's regrouping (CA-11, D-10)", () => {
  it("runs the fresh plan's grouping when a near guard cleared: one transaction, closed", async () => {
    const { ledger, deps, plan } = withoutMarket();
    ledger.accounts.get(messy.fixture)!.sequence = (BigInt(ledger.ledgerSeq + 3) << 32n).toString();
    const approved = await plan();
    expect(approved.transactions.map((t) => t.phase)).toEqual(["cleanup", "merge"]);
    // The confirmation takes a minute: twelve ledgers close before the executor plans again.
    ledger.ledgerSeq += 12;
    const events: CloseEvent[] = [];
    const report = await executeClose(approved, signers(), {
      confirm: true,
      ...deps,
      onEvent: (e) => void events.push(e),
    });
    expect(events.some((e) => e.type === "drift")).toBe(false);
    expect(report.stop).toBeNull();
    expect(report.status).toBe("closed");
    expect(report.planHash).toBe(approved.planHash);
    expect(report.transactions.map((t) => t.phase)).toEqual(["cleanup"]);
    expect(ledger.submissions).toHaveLength(1);
    expect(report.warnings.join(" ")).toMatch(
      /the sequence guard cleared after the plan was approved, so the merge runs in transaction 1 of 1 with the cleanup instead of in transaction 2 of 2, alone/,
    );
  });

  it("waits for the merge in a transaction of its own when the guard holds only in the fresh plan", async () => {
    const { ledger, clock, deps, plan } = withoutMarket();
    const approved = await plan();
    expect(approved.transactions.map((t) => t.phase)).toEqual(["cleanup"]);
    // While the confirmation waits, another client bumps the sequence number a few ledgers ahead:
    // the steps are the same, the merge now has to wait (FR-14), as it does after a mid-run bump.
    ledger.accounts.get(messy.fixture)!.sequence = (BigInt(ledger.ledgerSeq + 5) << 32n).toString();
    const events: CloseEvent[] = [];
    const report = await executeClose(approved, signers(), {
      confirm: true,
      ...deps,
      sleep: tickingSleep(ledger, clock),
      onEvent: (e) => void events.push(e),
    });
    expect(events.some((e) => e.type === "drift")).toBe(false);
    expect(events.filter((e) => e.type === "wait").map((e) => e.state)).toEqual(["start", "end"]);
    expect(report.status).toBe("closed");
    expect(report.transactions.map((t) => t.phase)).toEqual(["cleanup", "merge"]);
    expect(report.warnings.join(" ")).toMatch(
      /the sequence guard holds the merge until ledger \d+ now, so the merge waits alone in transaction 2 of 2 instead of in transaction 1 of 1/,
    );
  });

  it("still stops with PLAN_CHANGED when the fresh plan loses its merge to a far guard (D-10)", async () => {
    const { ledger, deps, plan } = withoutMarket();
    const approved = await plan();
    ledger.accounts.get(messy.fixture)!.sequence = (
      BigInt(ledger.ledgerSeq + 500) << 32n
    ).toString();
    const report = await executeClose(approved, signers(), { confirm: true, ...deps });
    expect(report.status).toBe("aborted");
    expect(report.stop).toMatchObject({ code: "PLAN_CHANGED" });
    expect(report.stop!.detail).toMatch(/the fresh plan no longer merges/);
    expect(ledger.submissions).toHaveLength(0);
  });
});
