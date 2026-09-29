import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Keypair } from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";
import { exitCodeFor } from "../../../src/cli/exit-codes.js";
import { run } from "../../../src/cli/run.js";
import { DustinError } from "../../../src/errors/dustin-error.js";
import { zeroSpendableWorld, type World } from "./close-world.js";

// Epic 4 closing review, run() and the command line. Each test is named after its finding ID and
// fails on the code before the fix.

const node = ["node", "dustin"];

/** run() with a standard error writer that always throws, and the last-resort writer collected. */
async function withBrokenStderr(args: string[], world?: World) {
  const lastResort: string[] = [];
  const out: string[] = [];
  const code = await run(
    [...node, ...args],
    {
      stdout: (t) => void out.push(t),
      stderr: () => {
        throw new Error("standard error is gone");
      },
    },
    "0.0.0",
    {
      env: {},
      ...(world ? { fetch: world.ledger.fetch } : {}),
      horizon: { retries: 0 },
      lastResort: (t) => void lastResort.push(t),
    },
  );
  return { code, lastResort, out: out.join("") };
}

describe("BH-19: run() returns the exit code even when the standard error writer throws", () => {
  it("BH-19: a validation error still exits 2, written once through the last resort", async () => {
    const r = await withBrokenStderr([
      "plan",
      "GNOTANADDRESS",
      "--to",
      Keypair.random().publicKey(),
    ]);
    // Before the fix: 1, and nothing written anywhere.
    expect(r.code).toBe(2);
    expect(r.lastResort).toHaveLength(1);
    expect(r.lastResort[0]).toMatch(/^dustin: INVALID_ADDRESS: /);
  });

  it("BH-19: with --json the last-resort line is NDJSON", async () => {
    const r = await withBrokenStderr([
      "plan",
      "GNOTANADDRESS",
      "--to",
      Keypair.random().publicKey(),
      "--json",
    ]);
    expect(r.code).toBe(2);
    expect(r.lastResort).toHaveLength(1);
    expect(JSON.parse(r.lastResort[0]!)).toMatchObject({
      type: "error",
      code: "INVALID_ADDRESS",
      exitCode: 2,
    });
  });

  it("BH-19: a usage error and a secret on argv keep exit 2", async () => {
    const usage = await withBrokenStderr(["plan", Keypair.random().publicKey(), "--bogus"]);
    expect(usage.code).toBe(2);
    const secret = await withBrokenStderr(["plan", Keypair.random().secret()]);
    expect(secret.code).toBe(2);
    expect(secret.lastResort.join("")).toContain("SECRET_IN_ARGV");
    expect(secret.lastResort.join("")).not.toMatch(/S[A-Z2-7]{55}/);
  });

  it("BH-19: a successful plan is unaffected and a Horizon error keeps its own code (6)", async () => {
    const world = zeroSpendableWorld();
    const ok = await withBrokenStderr(["plan", world.id, "--to", world.destination], world);
    expect(ok.code).toBe(0);
    expect(ok.out).toContain("Dustin plan");
    const down = await withBrokenStderr([
      "plan",
      Keypair.random().publicKey(),
      "--to",
      Keypair.random().publicKey(),
    ]);
    expect(down.code).toBe(6);
    expect(down.lastResort.join("")).toContain("HORIZON_UNAVAILABLE");
  });

  it("BH-19: a last-resort writer that throws too still leaves the exit code", async () => {
    const code = await run(
      [...node, "plan", "GNOTANADDRESS", "--to", Keypair.random().publicKey()],
      {
        stdout: () => undefined,
        stderr: () => {
          throw new Error("gone");
        },
      },
      "0.0.0",
      {
        env: {},
        lastResort: () => {
          throw new Error("gone too");
        },
      },
    );
    expect(code).toBe(2);
  });
});

/** run() with both streams collected. */
async function runCli(args: string[], world?: World, env: Record<string, string> = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const code = await run(
    [...node, ...args],
    { stdout: (t) => void out.push(t), stderr: (t) => void err.push(t) },
    "0.0.0",
    { env, ...(world ? { fetch: world.ledger.fetch } : {}), horizon: { retries: 0 } },
  );
  return { code, out: out.join(""), err: err.join("") };
}

describe("D-6: a usage error prints its code for people too", () => {
  it("D-6: dustin: USAGE_ERROR: ..., after Commander's help text, exit 2", async () => {
    const r = await runCli(["plan", Keypair.random().publicKey(), "--frobnicate"]);
    expect(r.code).toBe(2);
    // Before the fix: only Commander's "error: unknown option '--frobnicate'" and the help.
    expect(r.err).toContain("dustin: USAGE_ERROR: unknown option '--frobnicate'");
    expect(r.err).toContain("Run dustin --help, or dustin <command> --help, for the usage.");
    expect(r.err).toContain("Usage: dustin plan");
    expect(r.err).not.toMatch(/^error: /m);
    // The error comes last, after the help.
    expect(r.err.indexOf("Usage: dustin plan")).toBeLessThan(r.err.indexOf("USAGE_ERROR"));
  });

  it("D-6: a missing argument and conflicting options say so the same way", async () => {
    const missing = await runCli(["plan"]);
    expect(missing.code).toBe(2);
    expect(missing.err).toContain("dustin: USAGE_ERROR: missing required argument 'account'");
    const g = Keypair.random().publicKey();
    const both = await runCli(["plan", g, "--to", g, "--destination", g]);
    expect(both.code).toBe(2);
    expect(both.err).toContain("dustin: USAGE_ERROR: option '--destination <destination>'");
  });

  it("D-6: with --json it stays one error line, the message without Commander's prefix", async () => {
    const r = await runCli(["plan", Keypair.random().publicKey(), "--frobnicate", "--json"]);
    expect(r.code).toBe(2);
    const lines = r.err
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(lines).toEqual([
      expect.objectContaining({
        type: "error",
        code: "USAGE_ERROR",
        message: "unknown option '--frobnicate'",
        exitCode: 2,
      }),
    ]);
  });

  it("D-6: --help and --version stay as they were, exit 0", async () => {
    const help = await runCli(["plan", "--help"]);
    expect(help.code).toBe(0);
    expect(help.err).toBe("");
    const version = await runCli(["--version"]);
    expect(version.code).toBe(0);
    expect(version.out).toBe("0.0.0\n");
  });
});

describe("AC-2: --no-color and NO_COLOR are accepted and change nothing", () => {
  // An ANSI escape sequence starts with ESC and "[".
  const ansi = new RegExp(`${String.fromCharCode(27)}\\[`);

  it("AC-2: plan with --no-color, NO_COLOR, both or neither prints the same, without colour", async () => {
    const world = zeroSpendableWorld();
    const args = ["plan", world.id, "--to", world.destination];
    const plain = await runCli(args, world);
    // Before the fix --no-color was refused as an unknown option (exit 2).
    const flag = await runCli([...args, "--no-color"], world);
    const env = await runCli(args, world, { NO_COLOR: "1" });
    const both = await runCli(["--no-color", ...args], world, { NO_COLOR: "1" });
    for (const r of [plain, flag, env, both]) {
      expect(r.code).toBe(0);
      // The same text, but for the moment each plan was observed.
      const untimed = (text: string) => text.replace(/observed \S+/g, "observed <time>");
      expect(untimed(r.out)).toBe(untimed(plain.out));
      expect(r.out + r.err).not.toMatch(ansi);
    }
  });

  it("AC-2: close accepts it too, and --json stays machine mode", async () => {
    const world = zeroSpendableWorld();
    const r = await runCli(
      ["close", world.id, "--to", world.destination, "--json", "--no-color"],
      world,
    );
    expect(r.code).toBe(0);
    expect(JSON.parse(r.out)).toMatchObject({ kind: "dustin-close-plan" });
  });

  it("AC-2: the help text documents it", async () => {
    const help = await runCli(["--help"]);
    expect(help.out).toContain("--no-color");
    expect(help.out.replace(/\s+/g, " ")).toContain("Dustin never prints colour");
  });
});

describe("D-4: a file that is not a fixture manifest is a validation error", () => {
  it("D-4: fixture verify on such a file exits 2, with MANIFEST_INVALID and no request", async () => {
    const bad = join(mkdtempSync(join(tmpdir(), "dustin-")), "manifest.json");
    writeFileSync(bad, JSON.stringify({ kind: "not a manifest" }));
    const requests: string[] = [];
    const out: string[] = [];
    const code = await run(
      [...node, "fixture", "verify", bad],
      { stdout: (t) => void out.push(t), stderr: (t) => void out.push(t) },
      "0.0.0",
      {
        env: {},
        fetch: (url) => {
          requests.push(url);
          return Promise.reject(new Error("no request expected"));
        },
      },
    );
    // Before the fix: 1, the exit code of an unexpected error.
    expect(code).toBe(2);
    expect(out.join("")).toContain("MANIFEST_INVALID");
    expect(requests).toEqual([]);
  });

  it("D-4: exitCodeFor maps MANIFEST_INVALID to 2, and FRIENDBOT_FAILED stays 1", () => {
    const error = (code: "MANIFEST_INVALID" | "FRIENDBOT_FAILED") =>
      new DustinError(code, "x", { stage: "config" });
    expect(exitCodeFor(error("MANIFEST_INVALID"))).toBe(2);
    expect(exitCodeFor(error("FRIENDBOT_FAILED"))).toBe(1);
  });
});
