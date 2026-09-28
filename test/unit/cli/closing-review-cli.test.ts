import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Writable } from "node:stream";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { guardedWriter } from "../../../src/cli/output.js";
import { LEDGER, closeCli, executeArgs, zeroSpendableWorld } from "./close-world.js";

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
