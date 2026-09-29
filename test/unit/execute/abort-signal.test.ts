import { describe, expect, it } from "vitest";
import { executeClose, type CloseEvent } from "../../../src/execute/executor.js";
import type { CloseReport } from "../../../src/execute/report.js";
import { validateExecuteOptions } from "../../../src/execute/options.js";
import type { FakeLedger } from "../../helpers/fake-ledger.js";
import { messy } from "../../helpers/snapshots.js";
import { harness, signers, type TestClock } from "./harness.js";

// Review finding CL-1 (story E4-S2): `ExecuteOptions.signal`, a standard AbortSignal. The executor
// stops at the next safe point: it never posts a new envelope after the abort, settles or records
// as unknown an envelope already posted, finishes the report with the stop INTERRUPTED, publishes
// it and returns it, as it does for every other stop (ADR-0006).

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

/**
 * Runs the recorded fixture's close, aborting the signal when `when` first says so, or with
 * `atPost` as the POST of that number (1-based) reaches Horizon: the envelope is then in flight.
 * An abort on the `tx:submitted` event comes before the POST, so that envelope is never posted
 * (Epic 4 review EX-1).
 */
async function closeAborting(
  when: (event: CloseEvent) => boolean,
  setup: (h: ReturnType<typeof harness>) => void = () => undefined,
  atPost?: number,
) {
  const controller = new AbortController();
  let posts = 0;
  const h = harness((_ledger, fetch) => (url, init) => {
    if ((init?.method ?? "GET") === "POST" && ++posts === atPost) controller.abort("SIGINT");
    return fetch(url, init);
  });
  setup(h);
  const approved = await h.plan();
  const events: CloseEvent[] = [];
  const copies: CloseReport[] = [];
  const report = await executeClose(approved, signers(), {
    confirm: true,
    ...h.deps,
    signal: controller.signal,
    onEvent: (e) => {
      events.push(e);
      if (!controller.signal.aborted && when(e)) controller.abort("SIGINT");
    },
    onReport: (copy) => void copies.push(copy),
  });
  return { ...h, approved, report, events, copies };
}

describe("ExecuteOptions.signal (CL-1)", () => {
  it("stops before the first envelope when aborted before anything was signed: aborted, nothing posted", async () => {
    const { ledger, report, copies } = await closeAborting((e) => e.type === "plan");
    expect(ledger.submissions).toHaveLength(0);
    expect(report.status).toBe("aborted");
    expect(report.transactions).toEqual([]);
    expect(report.stop).toMatchObject({ code: "INTERRUPTED", verdict: "replan", txIndex: 0 });
    expect(report.stop!.detail).toMatch(/interrupted \(SIGINT\) before transaction 1 \(cleanup\)/);
    expect(report.message).toBe(report.stop!.detail);
    // The last copy published is the returned report.
    expect(copies.at(-1)).toEqual(report);
  });

  it("finishes the transaction in flight and posts nothing after it: failed, with the stop", async () => {
    // The signal comes as the first POST reaches Horizon.
    const { ledger, report, events } = await closeAborting(
      () => false,
      () => undefined,
      1,
    );
    // The first envelope was posted when the signal came; it was settled, and nothing followed.
    expect(ledger.submissions).toHaveLength(1);
    expect(report.transactions).toHaveLength(1);
    expect(report.transactions[0]!.result).toBe("applied");
    expect(events.filter((e) => e.type === "tx:building")).toHaveLength(1);
    expect(report.status).toBe("failed");
    expect(report.stop).toMatchObject({ code: "INTERRUPTED", txIndex: 1, round: 0 });
    expect(report.stop!.detail).toMatch(/before transaction 2 \(convert\)/);
    expect(report.stop!.detail).toMatch(/Run the close again to continue from the ledger/);
    // The final check still ran: the account exists, as a run stopped part-way leaves it.
    expect(report.verification).toMatchObject({ accountExists: true });
  });

  it("changes nothing once the merge applied: the close is verified and has no stop", async () => {
    const { report } = await closeAborting((e) => e.type === "tx:confirmed" && e.index === 2);
    expect(report.status).toBe("closed");
    expect(report.stop).toBeNull();
    expect(report.verification).toMatchObject({ accountExists: false });
  });

  it("ends the wait for the sequence guard at once, before the merge is submitted", async () => {
    const h = harness();
    h.ledger.accounts.get(messy.fixture)!.sequence = (
      BigInt(h.ledger.ledgerSeq + 30) << 32n
    ).toString();
    const approved = await h.plan();
    const controller = new AbortController();
    const report = await executeClose(approved, signers(), {
      confirm: true,
      ...h.deps,
      sleep: tickingSleep(h.ledger, h.clock),
      signal: controller.signal,
      onEvent: (e) => {
        if (e.type === "wait" && e.state === "start") controller.abort("SIGTERM");
      },
    });
    const merges = report.transactions.filter((t) => t.phase === "merge");
    expect(merges).toEqual([]);
    expect(report.status).toBe("failed");
    expect(report.stop).toMatchObject({ code: "INTERRUPTED", stage: "merge" });
    expect(report.stop!.detail).toMatch(/interrupted \(SIGTERM\) while the merge waited/);
    // The wait ended with the signal, long before the 31 ledgers it needed.
    expect(h.clock.sleeps.length).toBeLessThan(5);
  });

  it("records an envelope whose outcome is not known yet as unknown, with its time bound in the stop", async () => {
    const { ledger, report, clock } = await closeAborting(
      () => false,
      // The first envelope is lost behind a 504: Horizon never finds it by hash.
      (h) => void h.ledger.faults.push("504-not-applied"),
      // The signal comes as its POST reaches Horizon.
      1,
    );
    expect(ledger.submissions).toHaveLength(1);
    const [tx] = report.transactions;
    expect(tx).toMatchObject({ result: "unknown", mayStillApply: true });
    expect(tx!.explanation).toMatch(/interrupted/);
    expect(report.stop).toMatchObject({
      code: "INTERRUPTED",
      hash: tx!.hash,
      maxTime: tx!.maxTime,
      txIndex: 0,
    });
    expect(report.stop!.detail).toMatch(/only after a ledger has closed after/);
    expect(report.status).toBe("failed");
    // The run did not wait out the envelope's two-minute time bound.
    expect(clock.sleeps.length).toBeLessThan(5);
  });

  it("refuses a signal that is not an AbortSignal before anything is read", () => {
    expect(() => validateExecuteOptions({ signal: { aborted: false } })).toThrow(
      /signal must be an AbortSignal/,
    );
  });
});
