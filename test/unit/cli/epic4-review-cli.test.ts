import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import type { HandledSignal, SignalSource } from "../../../src/cli/commands/close.js";
import { closeCli, executeArgs, zeroSpendableWorld, type Fetch } from "./close-world.js";

// Epic 4 closing review, CLI findings. Each test is named after its finding ID and fails on the
// code before the fix. Signals are sent through an injected source (CliDeps.signals).

/** A fake `process` for the two signals, which counts its listeners. */
class FakeSignals extends EventEmitter implements SignalSource {
  send(signal: HandledSignal): void {
    this.emit(signal);
  }
  handlerCount(): number {
    return this.listenerCount("SIGINT") + this.listenerCount("SIGTERM");
  }
}

describe("EX-1 / BH-1: Ctrl-C while the only transaction is built posts nothing", () => {
  it("EX-1: Ctrl-C right after 'tx 1/1 cleanup' exits 3 and the account is not closed", async () => {
    // A simple account: cleanup and merge in one fee-bumped transaction.
    const world = zeroSpendableWorld();
    const signals = new FakeSignals();
    let sent = false;
    const r = await closeCli(world, executeArgs(world, "--yes"), {
      signals,
      onStdout: (text) => {
        if (!sent && /tx 1\/1\s+cleanup/.test(text)) {
          sent = true;
          signals.send("SIGINT");
        }
      },
    });
    expect(sent).toBe(true);
    expect(world.ledger.submissions).toHaveLength(0);
    expect(world.ledger.accounts.has(world.id)).toBe(true);
    expect(r.code).toBe(3);
    expect(r.out).toContain("Dustin close receipt   ABORTED: nothing was submitted");
    expect(r.out.replace(/\s+/g, " ")).toContain("nothing was posted after the interruption");
  });
});

/** Every line of standard error parsed as JSON; a line that is not JSON fails the test. */
const ndjson = (err: string) =>
  err
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Record<string, unknown>);

describe("EX-5: the --json error remedy of a stop with an open envelope", () => {
  it("EX-5: the remedy of an INTERRUPTED stop with an open envelope waits for its time bound", async () => {
    const world = zeroSpendableWorld({ market: true });
    world.ledger.faults.push("504-not-applied");
    const signals = new FakeSignals();
    let posts = 0;
    const fetch: Fetch = (url, init) => {
      if ((init?.method ?? "GET") === "POST" && ++posts === 1) signals.send("SIGINT");
      return world.ledger.fetch(url, init);
    };
    const r = await closeCli(world, executeArgs(world, "--yes", "--json"), { fetch, signals });
    const doc = JSON.parse(r.out) as { stop: { code: string; maxTime?: number } };
    expect(doc.stop.code).toBe("INTERRUPTED");
    const maxTime = doc.stop.maxTime!;
    expect(maxTime).toBeTypeOf("number");
    const error = ndjson(r.err)
      .filter((l) => l.type === "error")
      .at(-1)!;
    // Before the fix: "Run the same command again to continue", with no wait.
    expect(String(error.remedy)).toContain(
      `only after a ledger has closed after ${new Date(maxTime * 1000).toISOString()}`,
    );
  });
});
