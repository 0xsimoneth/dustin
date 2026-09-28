import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Writable } from "node:stream";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { guardedWriter } from "../../../src/cli/output.js";
import {
  LEDGER,
  closeCli,
  emptyDir,
  executeArgs,
  zeroSpendableWorld,
  type Fetch,
} from "./close-world.js";

// Closing review of E3 (2026-09-28), CLI half: `dustin close --execute` offline on the fake
// ledger, and standard output after EPIPE. Every test here failed on the code before its fix.

describe("CX-2 through the CLI: a worse quote in a partial close is drift, in its own words", () => {
  it("exits 3 with nothing signed and says what the account would keep, not the destination", async () => {
    const world = zeroSpendableWorld({ market: true });
    // The guard is beyond the bound: the plan cannot merge, and --partial runs the rest.
    world.ledger.accounts.get(world.id)!.sequence = (BigInt(LEDGER + 720) << 32n).toString();
    const r = await closeCli(world, executeArgs(world, "--partial"), {
      answer: () => {
        // While the user types the answer, the market pays less for the dust.
        world.ledger.quotes.set(`DUST:${world.issuer}`, "0.0000002");
        return world.destination.slice(-4);
      },
    });
    expect(r.code).toBe(3);
    expect(world.ledger.submissions).toHaveLength(0);
    expect(r.out).toContain("XLM_TO_DESTINATION_FELL");
    expect(r.out).toContain(
      "The XLM the account would keep (its balance plus the quoted sales; the plan does not merge) fell from 2.5000004 XLM to 2.5000002 XLM since the plan was shown",
    );
    expect(r.out).not.toMatch(/destination receives fell/);
  });
});

describe("CC-1: stdout's EPIPE fallback keeps the chunk that hit the broken pipe", () => {
  it("re-routes every chunk whose write callback reports an error, in order, notice first", async () => {
    // A stream whose reader went away: every write fails, as Node reports EPIPE, through the
    // write's callback and then an "error" event; write() itself does not throw.
    const stream = new Writable({
      write(_chunk, _encoding, callback) {
        callback(Object.assign(new Error("write EPIPE"), { code: "EPIPE" }));
      },
    });
    const elsewhere: string[] = [];
    const write = guardedWriter(stream, {
      fallback: (text) => elsewhere.push(text),
      notice: "stdout closed\n",
    });
    // The receipt and the report line, back to back in the same tick.
    write("receipt\n");
    write("Report written to close.json\n");
    await new Promise((resolve) => setImmediate(resolve));
    write("later\n");
    // Before the fix: ["stdout closed\n", "later\n"]; the first two chunks were lost.
    expect(elsewhere).toEqual([
      "stdout closed\n",
      "receipt\n",
      "Report written to close.json\n",
      "later\n",
    ]);
  });

  it("keeps them in a real process whose stdout reader went away (main.ts wiring)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dustin-epipe-"));
    try {
      // src/cli/output.ts as plain JavaScript, so any supported Node runs it.
      const source = readFileSync(new URL("../../../src/cli/output.ts", import.meta.url), "utf8");
      const { outputText } = ts.transpileModule(source, {
        compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
      });
      writeFileSync(join(dir, "output.mjs"), outputText);
      writeFileSync(
        join(dir, "child.mjs"),
        [
          'import { guardedWriter } from "./output.mjs";',
          "// The wiring of src/cli/main.ts.",
          "const stderr = guardedWriter(process.stderr);",
          'const stdout = guardedWriter(process.stdout, { fallback: stderr, notice: "NOTICE\\n" });',
          'process.stdin.once("data", () => {',
          '  stdout("receipt\\n");',
          '  stdout("report line\\n");',
          '  setImmediate(() => stdout("later\\n"));',
          "});",
          "",
        ].join("\n"),
      );
      const child = spawn(process.execPath, [join(dir, "child.mjs")], {
        stdio: ["pipe", "pipe", "pipe"],
      });
      let stderr = "";
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk: string) => {
        stderr += chunk;
      });
      const exited = new Promise<number | null>((resolve) => child.once("close", resolve));
      // The reader of standard output goes away (`| head`) before the child writes to it.
      await new Promise<void>((resolve) => {
        child.stdout.once("close", () => resolve());
        child.stdout.destroy();
      });
      child.stdin.end("go\n");
      expect(await exited).toBe(0);
      // Before the fix: "NOTICE\nlater\n".
      expect(stderr).toBe("NOTICE\nreceipt\nreport line\nlater\n");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("CC-2: with --json, stdout carries exactly one JSON document once the plan was shown", () => {
  /** The one JSON document on standard output; JSON.parse fails on none or on several. */
  const onlyDocument = (out: string) => JSON.parse(out) as { kind: string; account: string };

  it("control: the refusal of a plan that cannot merge prints the plan (exit 3)", async () => {
    const world = zeroSpendableWorld({ unauthorized: true });
    const r = await closeCli(world, executeArgs(world, "--json", "--yes"));
    expect(r.code).toBe(3);
    expect(onlyDocument(r.out)).toMatchObject({ kind: "dustin-close-plan", account: world.id });
  });

  it.each([
    ["a wrong answer", "nope"],
    ["the end of input or Ctrl-C", null],
    ["no prompt at all", undefined],
  ] as const)(
    "prints the plan when the confirmation, with a prompt that would get %s, is refused (exit 3)",
    async (_case, answer) => {
      const world = zeroSpendableWorld();
      const r = await closeCli(world, executeArgs(world, "--json"), { answer });
      expect(r.code).toBe(3);
      // Since E4-S1 (review AA-10) --json never asks: without --yes the run is refused.
      expect(r.prompts).toEqual([]);
      expect(r.err).toContain("CONFIRMATION_REQUIRED");
      // Before the fix: nothing on standard output.
      expect(onlyDocument(r.out)).toMatchObject({ kind: "dustin-close-plan", account: world.id });
      expect(world.ledger.submissions).toHaveLength(0);
    },
  );

  it("prints the plan when --report names a directory (exit 2)", async () => {
    const world = zeroSpendableWorld();
    const r = await closeCli(world, executeArgs(world, "--json", "--yes", "--report", emptyDir()));
    expect(r.code).toBe(2);
    expect(r.err).toMatch(/Cannot write the report file .*it is a directory/);
    expect(onlyDocument(r.out)).toMatchObject({ kind: "dustin-close-plan" });
    expect(world.ledger.submissions).toHaveLength(0);
  });

  it("prints the plan when the sponsor cannot be read (exit 6)", async () => {
    const world = zeroSpendableWorld();
    const sponsor = world.sponsor.publicKey();
    const fetch: Fetch = (url, init) =>
      url.endsWith(`/accounts/${sponsor}`)
        ? Promise.resolve(new Response(JSON.stringify({ status: 503 }), { status: 503 }))
        : world.ledger.fetch(url, init);
    const r = await closeCli(world, executeArgs(world, "--json", "--yes"), { fetch });
    expect(r.code).toBe(6);
    expect(r.err).toContain("HORIZON_UNAVAILABLE");
    expect(onlyDocument(r.out)).toMatchObject({ kind: "dustin-close-plan" });
  });

  it("prints the plan when Horizon fails after the confirmation, before any report (exit 6)", async () => {
    const world = zeroSpendableWorld();
    // Horizon goes down right after the CLI's last read (the sponsor), so the executor's first
    // read fails; with --json the confirmation is --yes (review AA-10).
    let down = false;
    const sponsor = world.sponsor.publicKey();
    const fetch: Fetch = (url, init) => {
      if (down) {
        return Promise.resolve(new Response(JSON.stringify({ status: 503 }), { status: 503 }));
      }
      if (url.endsWith(`/accounts/${sponsor}`)) down = true;
      return world.ledger.fetch(url, init);
    };
    const r = await closeCli(world, executeArgs(world, "--json", "--yes"), { fetch });
    expect(r.code).toBe(6);
    expect(onlyDocument(r.out)).toMatchObject({ kind: "dustin-close-plan" });
    expect(world.ledger.submissions).toHaveLength(0);
  });

  it("still prints the report, and only the report, once the executor has one", async () => {
    const world = zeroSpendableWorld();
    const r = await closeCli(world, executeArgs(world, "--json", "--yes"));
    expect(r.code).toBe(0);
    expect(onlyDocument(r.out)).toMatchObject({ kind: "dustin-close-report", status: "closed" });
  });
});
