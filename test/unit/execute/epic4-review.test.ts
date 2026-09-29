import { describe, expect, it } from "vitest";
import { timerSleep } from "../../../src/config/pauses.js";
import { interruptibleSleep } from "../../../src/execute/abort.js";
import { executeClose, type CloseEvent } from "../../../src/execute/executor.js";
import { waitForLedger } from "../../../src/execute/preflight.js";
import type { CloseReport } from "../../../src/execute/report.js";
import { operationSummary } from "../../../src/execute/summary.js";
import type { CloseStep } from "../../../src/plan/model.js";
import { stepAction } from "../../../src/render/plan-text.js";
import { messy } from "../../helpers/snapshots.js";
import { harness, signers } from "./harness.js";

// Epic 4 closing review, executor findings. Each test is named after its finding ID and fails on
// the code before the fix.

/** The recorded fixture's close with a signal the test aborts; `abort` is handed to the hooks. */
async function closeWith(
  hooks: (
    abort: () => void,
    h: ReturnType<typeof harness>,
  ) => {
    onEvent?: (e: CloseEvent) => void;
    onReport?: (copy: CloseReport) => void;
  },
) {
  const h = harness();
  const approved = await h.plan();
  const controller = new AbortController();
  let postsAtAbort = -1;
  const abort = () => {
    if (controller.signal.aborted) return;
    postsAtAbort = h.ledger.submissions.length;
    controller.abort("SIGINT");
  };
  const { onEvent, onReport } = hooks(abort, h);
  const report = await executeClose(approved, signers(), {
    confirm: true,
    ...h.deps,
    signal: controller.signal,
    ...(onEvent ? { onEvent } : {}),
    ...(onReport ? { onReport } : {}),
  });
  return { ...h, report, postsAtAbort: () => postsAtAbort };
}

describe("EX-1 / BH-1: no envelope is posted after the abort, the first one included", () => {
  it("EX-1: aborted while the first envelope is built (tx:building), nothing is posted", async () => {
    const run = await closeWith((abort) => ({
      onEvent: (e) => {
        if (e.type === "tx:building" && e.index === 0) abort();
      },
    }));
    expect(run.postsAtAbort()).toBe(0);
    expect(run.ledger.submissions).toHaveLength(0);
    expect(run.report.status).toBe("aborted");
    // Signed but never posted: not recorded as submitted.
    expect(run.report.transactions).toEqual([]);
    expect(run.report.stop).toMatchObject({ code: "INTERRUPTED", txIndex: 0 });
    expect(run.report.stop!.detail).toContain(
      "interrupted (SIGINT) before transaction 1 (cleanup) was posted; nothing was posted after the interruption.",
    );
  });

  it("EX-1: aborted while an async signer signs the first envelope, nothing is posted", async () => {
    const h = harness();
    const approved = await h.plan();
    const controller = new AbortController();
    const s = signers();
    const account = {
      publicKey: () => s.account.publicKey(),
      // A slow signer (a wallet, a device): the signal arrives while it is awaited.
      sign: async () => {
        await Promise.resolve();
        controller.abort("SIGTERM");
      },
    };
    const report = await executeClose(
      approved,
      { account, feeSponsor: s.feeSponsor },
      { confirm: true, ...h.deps, signal: controller.signal },
    );
    expect(h.ledger.submissions).toHaveLength(0);
    expect(report.status).toBe("aborted");
    expect(report.transactions).toEqual([]);
    expect(report.stop!.detail).toMatch(/interrupted \(SIGTERM\) before transaction 1 .* posted/);
  });

  it("EX-1: aborted during the merge preflight, the merge is not posted and the run is not closed", async () => {
    const run = await closeWith((abort) => ({
      onEvent: (e) => {
        // Emitted at the end of the preflight reads, before the merge is built and posted.
        if (e.type === "preflight" && e.ok) abort();
      },
    }));
    expect(run.postsAtAbort()).toBeGreaterThan(0);
    expect(run.ledger.submissions).toHaveLength(run.postsAtAbort());
    expect(run.report.transactions.some((t) => t.phase === "merge")).toBe(false);
    expect(run.report.status).toBe("failed");
    expect(run.ledger.accounts.has(messy.fixture)).toBe(true);
    expect(run.report.stop).toMatchObject({ code: "INTERRUPTED" });
    expect(run.report.stop!.detail).toMatch(/\(merge\) was posted; nothing was posted after/);
  });

  it("EX-1: aborted by an observer of the copy that records the envelope, it is withdrawn and not posted", async () => {
    const run = await closeWith((abort) => ({
      // The copy that lists the first envelope, published before its POST.
      onReport: (copy) => {
        if (copy.transactions.length > 0) abort();
      },
    }));
    expect(run.ledger.submissions).toHaveLength(0);
    expect(run.report.status).toBe("aborted");
    expect(run.report.transactions).toEqual([]);
    expect(run.report.stop!.detail).toMatch(/before envelope [0-9a-f]{8}\.\.\. of transaction 1/);
    expect(run.report.stop!.detail).toContain("nothing was posted after the interruption");
  });

  it("EX-1: aborted by an observer of tx:submitted, emitted before the POST, it is withdrawn and not posted", async () => {
    const run = await closeWith((abort) => ({
      onEvent: (e) => {
        if (e.type === "tx:submitted" && e.index === 0) abort();
      },
    }));
    expect(run.ledger.submissions).toHaveLength(0);
    expect(run.report.status).toBe("aborted");
    expect(run.report.transactions).toEqual([]);
  });

  it("EX-1: aborted by an observer of the copy that counts the POST, it is withdrawn and not posted", async () => {
    const run = await closeWith((abort) => ({
      onReport: (copy) => {
        if (copy.transactions.some((t) => t.attempts > 0)) abort();
      },
    }));
    expect(run.ledger.submissions).toHaveLength(0);
    expect(run.report.status).toBe("aborted");
    expect(run.report.transactions).toEqual([]);
  });
});

/** Timers that keep the event loop alive (https://nodejs.org/api/process.html#processgetactiveresourcesinfo). */
const armedTimers = () => process.getActiveResourcesInfo().filter((r) => r === "Timeout").length;

describe("EX-6 / BH-9: the default pause is cancelled with the signal", () => {
  it("EX-6: an aborted pause of the default timer leaves no timer armed", async () => {
    const before = armedTimers();
    const controller = new AbortController();
    const pause = interruptibleSleep(timerSleep, controller.signal)(16_000);
    setTimeout(() => controller.abort("SIGINT"), 5);
    const started = Date.now();
    await pause;
    expect(Date.now() - started).toBeLessThan(1000);
    // Before the fix the 16 s timer stayed armed and kept the process alive after the run.
    expect(armedTimers()).toBeLessThanOrEqual(before);
  });

  it("EX-6: a pause of the default timer on an aborted signal arms no timer at all", async () => {
    const before = armedTimers();
    const controller = new AbortController();
    controller.abort("SIGTERM");
    await interruptibleSleep(timerSleep, controller.signal)(60_000);
    expect(armedTimers()).toBeLessThanOrEqual(before);
  });

  it("EX-6: the executor's own pauses, without an injected sleep, end with the signal and leave no timer", async () => {
    const controller = new AbortController();
    let posts = 0;
    // The first envelope is lost behind a 504, so the run waits for it with real pauses of 5 s.
    const h = harness((_ledger, fetch) => (url, init) => {
      if ((init?.method ?? "GET") === "POST" && ++posts === 1) {
        setTimeout(() => controller.abort("SIGINT"), 20);
      }
      return fetch(url, init);
    });
    h.ledger.faults.push("504-not-applied");
    const approved = await h.plan();
    const { sleep: _injected, ...deps } = h.deps;
    const before = armedTimers();
    const started = Date.now();
    const report = await executeClose(approved, signers(), {
      confirm: true,
      ...deps,
      signal: controller.signal,
    });
    expect(Date.now() - started).toBeLessThan(2000);
    expect(report.stop).toMatchObject({ code: "INTERRUPTED" });
    expect(armedTimers()).toBeLessThanOrEqual(before);
  });

  it("EX-6: an injected pause keeps its contract: it is called with the milliseconds only", async () => {
    const calls: unknown[][] = [];
    const injected = (...args: unknown[]) => {
      calls.push(args);
      return Promise.resolve();
    };
    const controller = new AbortController();
    await interruptibleSleep(injected, controller.signal)(1234);
    expect(calls).toEqual([[1234]]);
  });
});

describe("BH-2 / EX-7: loops that pause check the signal after the pause", () => {
  it("BH-2: freshAccount does not read the lagging account again once the run is interrupted", async () => {
    let stale: unknown = null;
    let serveStale = false;
    const reads: number[] = [];
    const h = harness((ledger, fetch) => (url, init) => {
      const get = (init?.method ?? "GET") === "GET";
      if (get && url.endsWith(`/accounts/${messy.fixture}`)) {
        reads.push(h.clock.sleeps.length);
        if (serveStale && stale) return Promise.resolve(new Response(JSON.stringify(stale)));
      }
      void ledger;
      return fetch(url, init);
    });
    const approved = await h.plan();
    const controller = new AbortController();
    let readsAtAbort = -1;
    let sleepsAtAbort = -1;
    const deps = { ...h.deps };
    const raw = deps.sleep;
    deps.sleep = (ms: number) => {
      // The first pause of freshAccount, which saw a read behind the run's own transaction.
      if (serveStale && !controller.signal.aborted) {
        controller.abort("SIGINT");
        readsAtAbort = reads.length;
        sleepsAtAbort = h.clock.sleeps.length;
      }
      return raw(ms);
    };
    const report = await executeClose(approved, signers(), {
      confirm: true,
      ...deps,
      signal: controller.signal,
      onEvent: (e) => {
        if (e.type === "tx:submitted" && e.index === 0) {
          stale = structuredClone(h.ledger.accounts.get(messy.fixture));
        }
        if (e.type === "tx:confirmed" && e.index === 0) serveStale = true;
      },
    });
    expect(readsAtAbort).toBeGreaterThan(0);
    // Before the fix the four remaining reads of the loop followed the abort back to back.
    const after = reads.slice(readsAtAbort);
    // Every account read after the abort is separated from the next by a pause the run took.
    const backToBack = after.filter((sleeps, i) => i > 0 && sleeps === after[i - 1]).length;
    expect(backToBack).toBe(0);
    expect(after.length).toBeLessThanOrEqual(2);
    expect(h.clock.sleeps.length - sleepsAtAbort).toBeLessThanOrEqual(3);
    expect(report.stop).toMatchObject({ code: "INTERRUPTED" });
    // Nothing after the first transaction was posted.
    expect(h.ledger.submissions).toHaveLength(1);
  });

  it("BH-2: the wait for the sequence guard reads no ledger after a pause the abort ended", async () => {
    const controller = new AbortController();
    let reads = 0;
    const reader = {
      latestLedger: () => {
        reads += 1;
        return Promise.resolve({ sequence: 100 } as never);
      },
    };
    const waited = await waitForLedger(reader, 200, {
      pollIntervalMs: 5000,
      limitMs: 60_000,
      now: () => 0,
      // The abort arrives during the first pause, which then ends at once.
      sleep: () => {
        controller.abort("SIGINT");
        return Promise.resolve();
      },
      aborted: () => controller.signal.aborted,
    });
    expect(waited).toMatchObject({ reached: false, interrupted: true, ledger: 100 });
    expect(reads).toBe(1);
  });
});

describe("BH-15: the report's operation summary never aborts an attempt", () => {
  const step = (subject: unknown, kind = "remove_data") =>
    ({
      id: "S9",
      kind,
      txIndex: 0,
      subject,
      reason: "",
      dependsOn: [],
      threshold: "medium",
      operation: { type: "manageData", name: "x" },
    }) as unknown as CloseStep;

  it("BH-15: a subject this version does not know gets a fallback summary", () => {
    // Before the fix the switch had no default and returned undefined.
    expect(operationSummary(step({ type: "mystery" }))).toEqual({
      stepId: "S9",
      kind: "remove_data",
      type: "manageData",
      subject: "mystery",
      summary: "remove data (mystery)",
    });
  });

  it("BH-15: a step whose fields cannot be read gets the fallback, never an exception", () => {
    const unreadable = {
      type: "offer",
      offerId: "1",
      amount: "1",
      get selling(): never {
        throw new Error("unreadable");
      },
      buying: { type: "native" },
    };
    expect(operationSummary(step(unreadable, "cancel_offer"))).toMatchObject({
      stepId: "S9",
      kind: "cancel_offer",
      subject: "offer",
    });
  });

  it("BH-15: stepAction names a kind it does not know as it is", () => {
    expect(stepAction(step({ type: "data", name: "x" }, "sweep_dust"))).toBe("sweep dust");
  });
});
