import { EventEmitter } from "node:events";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { HandledSignal, SignalSource } from "../../../src/cli/commands/close.js";
import type { executeClose } from "../../../src/execute/executor.js";
import type { CloseReport } from "../../../src/execute/report.js";
import {
  closeCli,
  emptyDir,
  executeArgs,
  zeroSpendableWorld,
  type Fetch,
  type World,
} from "./close-world.js";

// Review finding CL-1 (story E4-S2): SIGINT or SIGTERM while `dustin close --execute` runs. The
// signal source is injected (CliDeps.signals), so no real process signal is sent: the first stops
// the executor at the next safe point, the receipt is printed and --report written; the exit code
// is 5 when anything was or may have been submitted and 3 when provably nothing was (canonical
// decision 5). A second signal writes the latest copy of the report and exits 5 at once.

/** A fake `process` for the two signals, which counts its listeners. */
class FakeSignals extends EventEmitter implements SignalSource {
  send(signal: HandledSignal): void {
    this.emit(signal);
  }
  handlerCount(): number {
    return this.listenerCount("SIGINT") + this.listenerCount("SIGTERM");
  }
}

/** A fetch that runs `before` ahead of the POST numbered `post` (1-based), then forwards it. */
function beforePost(world: World, post: number, before: () => void): Fetch {
  let posts = 0;
  return (url, init) => {
    if ((init?.method ?? "GET") === "POST" && ++posts === post) before();
    return world.ledger.fetch(url, init);
  };
}

describe("dustin close --execute and SIGINT or SIGTERM (CL-1)", () => {
  it("stops at the next safe point after a submission, prints the receipt and keeps the report (exit 5)", async () => {
    const world = zeroSpendableWorld({ market: true });
    const signals = new FakeSignals();
    const path = join(emptyDir(), "close.json");
    // Ctrl-C while the first transaction is on its way.
    const fetch = beforePost(world, 1, () => signals.send("SIGINT"));
    const r = await closeCli(world, executeArgs(world, "--yes", "--report", path), {
      fetch,
      signals,
    });
    expect(r.code).toBe(5);
    // The transaction in flight was settled; nothing was posted after the signal.
    expect(world.ledger.submissions).toHaveLength(1);
    expect(r.err).toContain("dustin: SIGINT received: the run stops at the next safe point.");
    expect(r.out).toContain("Dustin close receipt   FAILED");
    expect(r.out).toContain("Stop code    INTERRUPTED (stage");
    expect(r.out.replace(/\s+/g, " ")).toContain(
      "The run was interrupted (SIGINT) before transaction 2 (convert) was built",
    );
    const saved = JSON.parse(readFileSync(path, "utf8")) as CloseReport;
    expect(saved.status).toBe("failed");
    expect(saved.stop?.code).toBe("INTERRUPTED");
    expect(saved.transactions).toHaveLength(1);
    // The handlers are gone once the run is over.
    expect(signals.handlerCount()).toBe(0);
  });

  it("exits 3 when the signal comes before anything was submitted", async () => {
    const world = zeroSpendableWorld();
    const signals = new FakeSignals();
    // SIGTERM right when the executor starts: the CLI prints "Closing ..." just before it.
    const r = await closeCli(world, executeArgs(world, "--yes"), {
      signals,
      onStdout: (text) => {
        if (text.includes("Closing ")) signals.send("SIGTERM");
      },
    });
    expect(r.code).toBe(3);
    expect(world.ledger.submissions).toHaveLength(0);
    expect(r.out).toContain("Dustin close receipt   ABORTED: nothing was submitted");
    expect(r.out.replace(/\s+/g, " ")).toContain("The run was interrupted (SIGTERM) before");
    expect(signals.handlerCount()).toBe(0);
  });

  it("exits 5 at once on a second signal, after writing the latest report copy", async () => {
    const world = zeroSpendableWorld({ market: true });
    const signals = new FakeSignals();
    const path = join(emptyDir(), "close.json");
    const exits: Array<{ code: number; saved: CloseReport | null }> = [];
    const exit = (code: number) => {
      // What the file holds at the moment the process would end.
      const saved = existsSync(path)
        ? (JSON.parse(readFileSync(path, "utf8")) as CloseReport)
        : null;
      exits.push({ code, saved });
    };
    const fetch = beforePost(world, 1, () => {
      signals.send("SIGINT");
      signals.send("SIGINT");
    });
    const r = await closeCli(world, executeArgs(world, "--yes", "--report", path), {
      fetch,
      signals,
      exit,
    });
    expect(exits).toHaveLength(1);
    expect(exits[0]!.code).toBe(5);
    const saved = exits[0]!.saved!;
    // The latest copy: the envelope in flight is in it, the run is not finished.
    expect(saved.status).toBe("running");
    expect(saved.transactions).toHaveLength(1);
    expect(saved.warnings.join(" ")).toMatch(
      /A second SIGINT made the CLI exit before the run finished/,
    );
    expect(r.err).toContain("SIGINT received again: exiting now with code 5");
  });

  it("adds no handler during the typed confirmation: Ctrl-C there stays a declined confirmation (exit 3)", async () => {
    const world = zeroSpendableWorld();
    const signals = new FakeSignals();
    let during = -1;
    const r = await closeCli(world, executeArgs(world), {
      signals,
      answer: () => {
        during = signals.handlerCount();
        return null; // Ctrl-C at the prompt
      },
    });
    expect(during).toBe(0);
    expect(r.code).toBe(3);
    expect(r.err).toContain("CONFIRMATION_DECLINED");
    expect(signals.handlerCount()).toBe(0);
  });

  it("removes the handlers when the executor throws, and hands it a standard AbortSignal", async () => {
    const world = zeroSpendableWorld();
    const signals = new FakeSignals();
    let seen: unknown;
    let during = -1;
    const stub: typeof executeClose = (_plan, _signers, options) => {
      seen = options.signal;
      during = signals.handlerCount();
      return Promise.reject(new Error("boom"));
    };
    const r = await closeCli(world, executeArgs(world, "--yes"), {
      signals,
      executeClose: stub,
    });
    expect(r.code).toBe(1);
    expect(seen).toBeInstanceOf(AbortSignal);
    expect(during).toBe(2);
    expect(signals.handlerCount()).toBe(0);
  });
});
