import { Keypair } from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";
import { run } from "../../../src/cli/run.js";
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
