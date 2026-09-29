import { EventEmitter } from "node:events";
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { channel, wrapped } from "../../../src/cli/channel.js";
import type { HandledSignal, SignalSource } from "../../../src/cli/commands/close.js";
import { closeCli, emptyDir, executeArgs, zeroSpendableWorld, type Fetch } from "./close-world.js";

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

describe("EX-8 / BH-21: wrapped notices keep paths and line breaks", () => {
  // A report directory with spaces, runs of spaces included, long enough to wrap.
  const spaced = (dir: string) =>
    join(dir, "Mobile Documents", "Dustin  reports", "2026 close runs", "close report.json");

  it("EX-8: the notice that keeps an earlier report prints both paths exactly", async () => {
    const world = zeroSpendableWorld();
    const path = spaced(emptyDir());
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, "{}\n");
    const r = await closeCli(world, executeArgs(world, "--yes", "--report", path));
    expect(r.code).toBe(0);
    const aside = readdirSync(dirname(path)).find((f) => f.startsWith("close report.json."))!;
    // Before the fix the double space was collapsed and a line broke inside a path; a line may
    // still break at the space before one.
    expect(r.err).toContain(path);
    expect(r.err).toContain(join(dirname(path), aside));
    expect(r.err.replace(/\n +/g, " ")).toContain(`the earlier report ${path} was kept as`);
  });

  it("EX-8: an error that names a report path prints it exactly", async () => {
    const world = zeroSpendableWorld();
    const path = spaced(emptyDir());
    mkdirSync(path, { recursive: true });
    const r = await closeCli(world, executeArgs(world, "--yes", "--report", path));
    expect(r.code).toBe(2);
    expect(r.err).toContain(`${path}:`);
    expect(r.err.replace(/\n +/g, " ")).toContain(`${path}: it is a directory.`);
  });

  it("EX-8: a message's own line breaks are kept, the lines after the first indented", () => {
    expect(wrapped("dustin: first line\nsecond line\n  indented", 2)).toBe(
      "dustin: first line\n  second line\n    indented\n",
    );
    const err: string[] = [];
    const out = channel(
      { stdout: () => undefined, stderr: (t) => void err.push(t) },
      { json: false, verbose: false },
    );
    out.notice("one\ntwo");
    expect(err.join("")).toBe("dustin: one\n  two\n");
  });

  it("EX-8: a kept string is never broken, even past the line width", () => {
    const path = `/tmp/${"a b ".repeat(40)}end.json`;
    const text = wrapped(`dustin: the file ${path} was kept.`, 2, [path]);
    // The path is a line of its own, whole, between the words before and after it.
    expect(text).toBe(`dustin: the file\n  ${path}\n  was kept.\n`);
  });
});
