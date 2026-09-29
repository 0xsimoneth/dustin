import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import type { HandledSignal, SignalSource } from "../../../src/cli/commands/close.js";
import { closeCli, executeArgs, zeroSpendableWorld } from "./close-world.js";

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
