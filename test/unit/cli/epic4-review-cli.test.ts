import { EventEmitter } from "node:events";
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { channel, failureOf, jsonText, plainJson, wrapped } from "../../../src/cli/channel.js";
import type { HandledSignal, SignalSource } from "../../../src/cli/commands/close.js";
import { DustinError } from "../../../src/errors/dustin-error.js";
import type { executeClose } from "../../../src/execute/executor.js";
import type { CloseReport, SubmittedTransaction } from "../../../src/execute/report.js";
import type { ClosePlan } from "../../../src/plan/model.js";
import type { Command } from "commander";
import { buildProgram } from "../../../src/cli/program.js";
import { VALUE_OPTIONS, run, scanMode } from "../../../src/cli/run.js";
import {
  closeCli,
  emptyDir,
  executeArgs,
  zeroSpendableWorld,
  type Fetch,
  type World,
} from "./close-world.js";

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

/** A report as a stub executor returns it; `patch` sets what the test needs. */
function stubReport(plan: ClosePlan, patch: Partial<CloseReport>): CloseReport {
  return {
    schemaVersion: 1,
    kind: "dustin-close-report",
    network: plan.network,
    account: plan.account,
    destination: plan.destination,
    feeSponsor: plan.feeSponsor ?? "",
    planHash: plan.planHash,
    status: "running",
    message: null,
    stop: null,
    startedAt: "2026-09-29T00:00:00.000Z",
    finishedAt: null,
    transactions: [],
    steps: [],
    replans: [],
    unclosable: [],
    blockers: [],
    warnings: [],
    recovery: {
      mergedXlm: null,
      reservesReturnedToSponsors: [],
      feesPaidByAccount: "0",
      feesPaidBySponsorStroops: 0,
    },
    verification: null,
    ...patch,
  };
}

/** An envelope of the plan's first transaction, posted and not settled. */
const postedEnvelope = (plan: ClosePlan): SubmittedTransaction => ({
  index: 0,
  phase: "cleanup",
  stepIds: plan.transactions[0]!.stepIds,
  attempts: 1,
  attempt: 1,
  round: 0,
  sequence: "1",
  baseFeeStroops: 100,
  maxTime: 0,
  hash: "a".repeat(64),
  innerHash: "b".repeat(64),
  result: "pending",
  ledger: null,
  feeChargedStroops: null,
  feeAccount: plan.feeSponsor ?? "",
  innerEnvelopeXdr: "AAAA",
  feeBumpEnvelopeXdr: "AAAA",
  explorerUrl: `https://stellar.expert/explorer/testnet/tx/${"a".repeat(64)}`,
});

/**
 * An executor that submits one envelope, emits an event with a BigInt, then throws an error whose
 * details hold a BigInt, a cycle and a getter that throws.
 */
const unserialisableStop: typeof executeClose = (plan, _signers, options) => {
  const report = stubReport(plan, { transactions: [postedEnvelope(plan)] });
  options.onReport?.(report);
  options.onEvent?.({ type: "tx:submitted", index: 0, hash: "a".repeat(64), big: 5n } as never);
  const error = new DustinError("HORIZON_UNAVAILABLE", "Horizon went away.", {
    stage: "submit",
    report,
  });
  const cycle: Record<string, unknown> = { amount: 7n };
  cycle.self = cycle;
  Object.defineProperty(cycle, "broken", {
    enumerable: true,
    get() {
      throw new Error("unreadable");
    },
  });
  Object.assign(error, { details: cycle, horizon: { status: 504, loop: cycle } });
  return Promise.reject(error);
};

describe("BH-6: machine output survives values JSON.stringify cannot write", () => {
  it("BH-6: --json --verbose keeps the stopped path's report document and exits 5", async () => {
    const world = zeroSpendableWorld();
    const r = await closeCli(world, executeArgs(world, "--yes", "--json", "--verbose"), {
      executeClose: unserialisableStop,
    });
    // Before the fix: the error line threw, the plan was printed instead of the report, exit 1.
    expect(r.code).toBe(5);
    const doc = JSON.parse(r.out) as CloseReport;
    expect(doc.kind).toBe("dustin-close-report");
    expect(doc.transactions).toHaveLength(1);
    const lines = ndjson(r.err);
    const error = lines.find((l) => l.type === "error")!;
    expect(error).toMatchObject({ code: "HORIZON_UNAVAILABLE", exitCode: 5 });
    expect(error.details).toMatchObject({
      amount: "7",
      self: "[Circular]",
      broken: "[unreadable]",
    });
    expect(lines.find((l) => l.type === "tx:submitted")).toMatchObject({ big: "5" });
  });

  it("BH-6: --verbose for people prints the same stop with its detail and exits 5", async () => {
    const world = zeroSpendableWorld();
    const r = await closeCli(world, executeArgs(world, "--yes", "--verbose"), {
      executeClose: unserialisableStop,
    });
    expect(r.code).toBe(5);
    expect(r.err).toContain("dustin: HORIZON_UNAVAILABLE: Horizon went away.");
    expect(r.err).toContain("amount: 7");
    expect(r.out).toContain("Dustin close receipt");
  });

  it("BH-6: jsonText and plainJson never throw", () => {
    const cycle: Record<string, unknown> = { n: 1n };
    cycle.again = [cycle];
    expect(JSON.parse(jsonText(cycle))).toEqual({ n: "1", again: ["[Circular]"] });
    expect(plainJson(new Date(0))).toBe("1970-01-01T00:00:00.000Z");
    let deep: unknown = "end";
    for (let i = 0; i < 100; i++) deep = { deep };
    expect(jsonText(deep)).toContain('"[too deep]"');
  });
});

/** An executor that submits one envelope, then throws something that is not a DustinError. */
const bugAfterSubmission: typeof executeClose = (plan, _signers, options) => {
  options.onReport?.(stubReport(plan, { transactions: [postedEnvelope(plan)] }));
  options.onEvent?.({
    type: "tx:submitted",
    index: 0,
    hash: "a".repeat(64),
    explorerUrl: "https://stellar.expert/explorer/testnet/tx/aaaa",
    attempt: 1,
    round: 0,
  });
  return Promise.reject(new TypeError("a bug"));
};

describe("BH-14: an unexpected error's remedy says where the hashes are", () => {
  it("BH-14: printed before the receipt, it points to the receipt below", async () => {
    const world = zeroSpendableWorld();
    const r = await closeCli(world, executeArgs(world, "--yes"), {
      executeClose: bugAfterSubmission,
    });
    expect(r.code).toBe(5);
    const err = r.err.replace(/\s+/g, " ");
    expect(err).toContain("dustin: unexpected error: a bug");
    // Before the fix: "if a transaction was submitted, its hash is above", with the receipt below.
    expect(err).not.toContain("its hash is above");
    expect(err).toContain("the receipt printed below lists every transaction that was submitted");
    expect(r.out).toContain("Dustin close receipt");
  });

  it("BH-14: with --json, it points to the tx:submitted lines and the report document", async () => {
    const world = zeroSpendableWorld();
    const r = await closeCli(world, executeArgs(world, "--yes", "--json"), {
      executeClose: bugAfterSubmission,
    });
    expect(r.code).toBe(5);
    const error = ndjson(r.err).find((l) => l.type === "error")!;
    expect(error).toMatchObject({ code: "UNEXPECTED_ERROR", exitCode: 5 });
    expect(String(error.remedy)).not.toContain("above");
    expect(String(error.remedy)).toContain(
      "in a tx:submitted line on standard error and in the close report on standard output",
    );
    expect(JSON.parse(r.out)).toMatchObject({ kind: "dustin-close-report" });
  });

  it("BH-14: elsewhere, for people, the hashes are above", () => {
    expect(failureOf(new Error("x"), 1).remedy).toContain(
      "if a transaction was submitted, its hash is printed above.",
    );
  });
});

/** `run()` with the world's fake Horizon, collecting both streams. */
async function runCli(world: World, args: string[]) {
  const out: string[] = [];
  const err: string[] = [];
  const code = await run(
    ["node", "dustin", ...args],
    { stdout: (t) => void out.push(t), stderr: (t) => void err.push(t) },
    "0.0.0",
    { env: {}, fetch: world.ledger.fetch, horizon: { retries: 0 } },
  );
  return { code, out: out.join(""), err: err.join("") };
}

describe("BH-20: only a real --json flag makes machine mode", () => {
  it("BH-20: --json as the value of --memo, or after --, is not machine mode", () => {
    const argv = (...words: string[]) => ["node", "dustin", ...words];
    expect(scanMode(argv("plan", "G", "--memo", "--json"))).toEqual({
      json: false,
      verbose: false,
    });
    expect(scanMode(argv("plan", "G", "--", "--json", "--verbose")).json).toBe(false);
    expect(scanMode(argv("close", "G", "--report", "--verbose")).verbose).toBe(false);
    expect(scanMode(argv("--network", "testnet", "plan", "G", "--json")).json).toBe(true);
    expect(scanMode(argv("plan", "G", "--memo=--json")).json).toBe(false);
    expect(scanMode(argv("fixture", "create", "--json")).json).toBe(false);
  });

  it("BH-20: a usage error after --memo --json is printed for people, as Commander parsed it", async () => {
    const world = zeroSpendableWorld();
    const r = await runCli(world, [
      "plan",
      world.id,
      "--to",
      world.destination,
      "--memo",
      "--json",
      "--bogus",
    ]);
    expect(r.code).toBe(2);
    // Before the fix the scan took --json for the flag: one NDJSON line and no usage text.
    expect(r.err).toContain("unknown option '--bogus'");
    expect(() => JSON.parse(r.err.split("\n")[0]!) as unknown).toThrow();
  });

  it("BH-20: every option that takes a value is in VALUE_OPTIONS, and nothing else", () => {
    const program = buildProgram("0.0.0", { stdout: () => undefined, stderr: () => undefined });
    const valued = new Set<string>();
    const walk = (command: Command) => {
      for (const option of command.options) {
        if ((option.required || option.optional) && option.long) valued.add(option.long);
      }
      command.commands.forEach(walk);
    };
    walk(program);
    expect([...valued].sort()).toEqual([...VALUE_OPTIONS].sort());
  });
});
