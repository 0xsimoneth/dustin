import { EventEmitter } from "node:events";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import type { HandledSignal, SignalSource } from "../../../src/cli/commands/close.js";
import { exitAfterFlush } from "../../../src/cli/output.js";
import { executeClose } from "../../../src/execute/executor.js";
import type { CloseReport } from "../../../src/execute/report.js";
import {
  closeCli,
  emptyDir,
  executeArgs,
  zeroSpendableWorld,
  type Fetch,
  type World,
} from "./close-world.js";

// Epic 4 closing review, the signals of `close --execute`. Each test is named after its finding
// ID and fails on the code before the fix. Signals are sent through an injected source
// (CliDeps.signals) and the forced exit is a stub, so no real signal is sent and nothing exits.

/** A fake `process` for the two signals, which counts its listeners. */
class FakeSignals extends EventEmitter implements SignalSource {
  send(signal: HandledSignal): void {
    this.emit(signal);
  }
  handlerCount(): number {
    return this.listenerCount("SIGINT") + this.listenerCount("SIGTERM");
  }
}

/** Every line of standard error parsed as JSON; a line that is not JSON fails the test. */
const ndjson = (err: string) =>
  err
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Record<string, unknown>);

/** A fetch that runs `when(url, method)` before each request; the request then goes on. */
const watching =
  (world: World, when: (url: string, method: string) => void): Fetch =>
  (url, init) => {
    when(url, init?.method ?? "GET");
    return world.ledger.fetch(url, init);
  };

/** True for the request of verifyHorizonIsTestnet, the first read of close --execute. */
const horizonRoot = (url: string) => url.endsWith("/");

describe("EX-9: an interruption before the executor starts exits 3 with an error line", () => {
  it("EX-9: SIGINT during the Horizon check with --json: exit 3, one error line, nothing signed", async () => {
    const world = zeroSpendableWorld();
    const signals = new FakeSignals();
    let during = -1;
    let sent = false;
    const fetch = watching(world, (url) => {
      if (!sent && horizonRoot(url)) {
        sent = true;
        during = signals.handlerCount();
        signals.send("SIGINT");
      }
    });
    const r = await closeCli(world, executeArgs(world, "--yes", "--json"), { fetch, signals });
    // Before the fix no handler was installed yet: the signal would have killed the process.
    expect(during).toBe(2);
    expect(r.code).toBe(3);
    expect(world.ledger.submissions).toHaveLength(0);
    expect(world.ledger.accounts.has(world.id)).toBe(true);
    const lines = ndjson(r.err);
    expect(lines.filter((l) => l.type === "error")).toEqual([
      expect.objectContaining({ code: "INTERRUPTED", exitCode: 3 }),
    ]);
    expect(lines[0]).toMatchObject({ type: "notice" });
    // The plan was not shown yet, so there is no document.
    expect(r.out).toBe("");
    expect(signals.handlerCount()).toBe(0);
  });

  it("EX-9: SIGTERM while the plan is read with --json: exit 3, the plan is the document", async () => {
    const world = zeroSpendableWorld();
    const signals = new FakeSignals();
    let sent = false;
    const fetch = watching(world, (url) => {
      if (!sent && url.endsWith(`/accounts/${world.id}`)) {
        sent = true;
        signals.send("SIGTERM");
      }
    });
    const r = await closeCli(world, executeArgs(world, "--yes", "--json"), { fetch, signals });
    expect(r.code).toBe(3);
    expect(world.ledger.submissions).toHaveLength(0);
    expect(JSON.parse(r.out)).toMatchObject({ kind: "dustin-close-plan", account: world.id });
    expect(ndjson(r.err).filter((l) => l.type === "error")).toEqual([
      expect.objectContaining({ code: "INTERRUPTED", exitCode: 3 }),
    ]);
  });

  it("EX-9: SIGINT during the sponsor read, for people: exit 3 and the INTERRUPTED error", async () => {
    const world = zeroSpendableWorld();
    const signals = new FakeSignals();
    let planShown = false;
    let sent = false;
    const fetch = watching(world, (url) => {
      if (planShown && !sent && url.endsWith(`/accounts/${world.sponsor.publicKey()}`)) {
        sent = true;
        signals.send("SIGINT");
      }
    });
    const r = await closeCli(world, executeArgs(world, "--yes"), {
      fetch,
      signals,
      onStdout: (text) => {
        if (text.includes("Dustin plan")) planShown = true;
      },
    });
    expect(sent).toBe(true);
    expect(r.code).toBe(3);
    expect(world.ledger.submissions).toHaveLength(0);
    const err = r.err.replace(/\s+/g, " ");
    expect(err).toContain(
      "dustin: SIGINT received: the command stops before anything is signed or submitted.",
    );
    expect(err).toContain(
      "dustin: INTERRUPTED: The command was interrupted (SIGINT) before anything was signed; nothing was signed or submitted.",
    );
    expect(r.out).not.toContain("Closing ");
  });

  it("EX-9: a second signal before the executor exits 3 at once, with the plan document", async () => {
    const world = zeroSpendableWorld();
    const signals = new FakeSignals();
    const exits: Array<{ code: number; out: string }> = [];
    const outs: string[] = [];
    let sent = false;
    const fetch = watching(world, (url) => {
      if (!sent && url.endsWith(`/accounts/${world.sponsor.publicKey()}`)) {
        sent = true;
        signals.send("SIGINT");
        signals.send("SIGINT");
      }
    });
    const r = await closeCli(world, executeArgs(world, "--yes", "--json"), {
      fetch,
      signals,
      exit: (code) => exits.push({ code, out: outs.join("") }),
      onStdout: (t) => void outs.push(t),
    });
    expect(exits).toHaveLength(1);
    expect(exits[0]!.code).toBe(3);
    expect(world.ledger.submissions).toHaveLength(0);
    expect(r.code).toBe(3);
    // The one document was printed before the exit.
    expect(JSON.parse(exits[0]!.out)).toMatchObject({ kind: "dustin-close-plan" });
    // The stub exit returns, so the command goes on to its next step here; the binary has exited.
    const errors = ndjson(r.err).filter((l) => l.type === "error");
    expect(errors.length).toBeGreaterThan(0);
    for (const e of errors) expect(e).toMatchObject({ code: "INTERRUPTED", exitCode: 3 });
  });

  it("EX-9: the handlers stay off while the typed confirmation waits, and are back after it", async () => {
    const world = zeroSpendableWorld();
    const signals = new FakeSignals();
    let during = -1;
    let afterConfirmation = -1;
    const r = await closeCli(world, executeArgs(world), {
      signals,
      answer: () => {
        during = signals.handlerCount();
        return world.destination.slice(-4);
      },
      onStdout: (text) => {
        if (text.includes("Closing ")) afterConfirmation = signals.handlerCount();
      },
    });
    expect(r.code).toBe(0);
    expect(during).toBe(0);
    expect(afterConfirmation).toBe(2);
    expect(signals.handlerCount()).toBe(0);
  });
});

describe("EX-2 / BH-11, EX-3 / BH-3, BH-13: the forced exit on a second signal says what is true", () => {
  it("EX-2: before the executor's first copy, the notice says nothing of this run was written", async () => {
    const world = zeroSpendableWorld({ market: true });
    const signals = new FakeSignals();
    const path = join(emptyDir(), "close.json");
    // An earlier run's final report at the same --report path.
    writeFileSync(path, JSON.stringify({ kind: "dustin-close-report", marker: "EARLIER RUN" }));
    let started = false;
    let sent = false;
    const fetch = watching(world, () => {
      // The executor's own re-plan reads, before its first report copy: two Ctrl-C.
      if (started && !sent) {
        sent = true;
        signals.send("SIGINT");
        signals.send("SIGINT");
      }
    });
    const exits: Array<{ code: number; file: string }> = [];
    const r = await closeCli(world, executeArgs(world, "--yes", "--report", path), {
      fetch,
      signals,
      exit: (code) => exits.push({ code, file: readFileSync(path, "utf8") }),
      onStdout: (text) => {
        if (text.includes("Closing ")) started = true;
      },
    });
    expect(sent).toBe(true);
    expect(exits.map((e) => e.code)).toEqual([5]);
    expect(exits[0]!.file).toContain("EARLIER RUN");
    const err = r.err.replace(/\s+/g, " ");
    // Before the fix: "The latest copy of the report is in <path>; its status "running" ...".
    expect(err).not.toContain("The latest copy of this run's report is in");
    expect(err).toContain(
      `before the executor had published a report: nothing was signed or submitted. Nothing of this run was written to ${path}: there was no copy of its report yet.`,
    );
  });

  it("EX-2: after a copy was written, the notice names the file that holds it", async () => {
    const world = zeroSpendableWorld({ market: true });
    const signals = new FakeSignals();
    const path = join(emptyDir(), "close.json");
    let posts = 0;
    const fetch = watching(world, (_url, method) => {
      if (method === "POST" && ++posts === 1) {
        signals.send("SIGINT");
        signals.send("SIGINT");
      }
    });
    const exits: number[] = [];
    const r = await closeCli(world, executeArgs(world, "--yes", "--report", path), {
      fetch,
      signals,
      exit: (code) => void exits.push(code),
    });
    expect(exits).toEqual([5]);
    expect(r.err.replace(/\s+/g, " ")).toContain(
      `The latest copy of this run's report is in ${path}; its status "running" says it is not final.`,
    );
  });

  it("EX-3: with --json, the forced exit prints the latest report copy as the one document first", async () => {
    const world = zeroSpendableWorld({ market: true });
    const signals = new FakeSignals();
    let posts = 0;
    const fetch = watching(world, (_url, method) => {
      if (method === "POST" && ++posts === 1) {
        signals.send("SIGINT");
        signals.send("SIGINT");
      }
    });
    const outs: string[] = [];
    let atExit = "<not exited>";
    const r = await closeCli(world, executeArgs(world, "--yes", "--json"), {
      fetch,
      signals,
      exit: () => {
        atExit = outs.join("");
      },
      onStdout: (t) => void outs.push(t),
    });
    // Before the fix standard output was empty when the process exited.
    const doc = JSON.parse(atExit) as CloseReport;
    expect(doc).toMatchObject({ kind: "dustin-close-report", status: "running" });
    expect(doc.transactions).toHaveLength(1);
    expect(doc.warnings.join(" ")).toContain("A second SIGINT made the CLI exit");
    expect(ndjson(r.err).filter((l) => l.type === "error")[0]).toMatchObject({
      code: "INTERRUPTED",
      exitCode: 5,
    });
  });

  it("EX-3: with --json and no report copy yet, the plan is the document", async () => {
    const world = zeroSpendableWorld({ market: true });
    const signals = new FakeSignals();
    let started = false;
    let sent = false;
    const outs: string[] = [];
    let atExit = "<not exited>";
    const fetch = watching(world, () => {
      if (started && !sent) {
        sent = true;
        signals.send("SIGINT");
        signals.send("SIGINT");
      }
    });
    await closeCli(world, executeArgs(world, "--yes", "--json"), {
      fetch,
      signals,
      exit: () => {
        atExit = outs.join("");
      },
      onStdout: (t) => void outs.push(t),
      // The signals come with the executor's first read, before its first report copy.
      executeClose: (plan, signers, options) => {
        started = true;
        return executeClose(plan, signers, options);
      },
    });
    expect(sent).toBe(true);
    expect(JSON.parse(atExit)).toMatchObject({ kind: "dustin-close-plan" });
  });

  it("BH-13: during the final check after the merge applied, the notice says the merge applied", async () => {
    const world = zeroSpendableWorld();
    const signals = new FakeSignals();
    const path = join(emptyDir(), "close.json");
    let posted = false;
    let sent = false;
    const fetch: Fetch = async (url, init) => {
      const method = init?.method ?? "GET";
      if (posted && !sent && method === "GET" && url.endsWith(`/accounts/${world.id}`)) {
        // The final check reads the account: two Ctrl-C.
        sent = true;
        signals.send("SIGINT");
        signals.send("SIGINT");
      }
      const response = await world.ledger.fetch(url, init);
      if (method === "POST") posted = true;
      return response;
    };
    const exits: Array<{ code: number; saved: CloseReport }> = [];
    const r = await closeCli(world, executeArgs(world, "--yes", "--report", path), {
      fetch,
      signals,
      exit: (code) =>
        exits.push({ code, saved: JSON.parse(readFileSync(path, "utf8")) as CloseReport }),
    });
    expect(sent).toBe(true);
    // Canonical decision 5: a merge reported applied but not verified gone exits 5.
    expect(exits.map((e) => e.code)).toEqual([5]);
    const merge = exits[0]!.saved.transactions.find((t) => t.result === "applied")!;
    const err = r.err.replace(/\s+/g, " ");
    // Before the fix: "exiting now with code 5, before the run finished", "not final".
    expect(err).toContain(
      `The merge (${merge.hash}) applied in ledger ${merge.ledger}, so the account is closed on the ledger; only the final check that Horizon no longer has it was cut short.`,
    );
    expect(exits[0]!.saved.warnings.join(" ")).toContain(
      `the merge (${merge.hash}) applied in ledger ${merge.ledger}, so the account is closed on the ledger, but the check that Horizon no longer has it was cut short`,
    );
  });
});

describe("EX-3: the binary's forced exit waits for both streams to flush", () => {
  /** A stream whose writes are handed over only when `drain()` is called. */
  function slowStream() {
    const pending: Array<() => void> = [];
    const stream = new Writable({
      write(_chunk, _encoding, callback) {
        pending.push(() => callback());
      },
    });
    return { stream, drain: () => pending.splice(0).forEach((f) => f()) };
  }

  it("EX-3: exits only once everything written was handed over", async () => {
    const out = slowStream();
    const err = slowStream();
    const codes: number[] = [];
    const exit = exitAfterFlush([out.stream, err.stream], (code) => void codes.push(code), 60_000);
    out.stream.write("the document\n");
    exit(5);
    await new Promise((resolve) => setImmediate(resolve));
    expect(codes).toEqual([]);
    for (let i = 0; i < 5 && codes.length === 0; i++) {
      out.drain();
      err.drain();
      await new Promise((resolve) => setImmediate(resolve));
    }
    expect(codes).toEqual([5]);
  });

  it("EX-3: a further signal exits at once, and a stream that never drains is waited for a bounded time", async () => {
    const codes: number[] = [];
    const exit = exitAfterFlush([slowStream().stream], (code) => void codes.push(code), 60_000);
    exit(5);
    exit(5);
    expect(codes).toEqual([5]);
    const bounded: number[] = [];
    exitAfterFlush([slowStream().stream], (code) => void bounded.push(code), 20)(3);
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(bounded).toEqual([3]);
  });
});
