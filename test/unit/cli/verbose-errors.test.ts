import { Keypair } from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";
import { DustinError } from "../../../src/errors/dustin-error.js";
import type { executeClose } from "../../../src/execute/executor.js";
import { closeCli, executeArgs, zeroSpendableWorld } from "./close-world.js";

// AC-E4-S2-2 (story E4-S2): an error is printed as one line plus its remedy by default, and in
// full with --verbose: its stage and verdict, Horizon's result codes, its details and its cause
// chain, every secret redacted. With --json the same detail rides on the `error` line.

/** An executor that fails before anything is submitted, with every field of a DustinError set. */
function failing(seed: string): typeof executeClose {
  return () =>
    Promise.reject(
      new DustinError("SPONSOR_REFUSED", `The sponsor refused to wrap the envelope (${seed}).`, {
        stage: "sponsor",
        verdict: "stop",
        remedy: "Check the sponsor's budget.",
        details: { budgetStroops: 50_000_000, leaked: seed },
        horizon: {
          status: 400,
          transaction: "tx_fee_bump_inner_failed",
          innerTransaction: "tx_failed",
          operations: ["op_success", "op_underfunded"],
        },
        cause: new DustinError("HORIZON_UNAVAILABLE", "Horizon answered HTTP 503.", {
          stage: "inspect",
          cause: new Error(`socket closed near ${seed}`),
        }),
      }),
    );
}

describe("error output with and without --verbose (AC-E4-S2-2)", () => {
  it("prints one line and the remedy by default", async () => {
    const world = zeroSpendableWorld();
    const seed = Keypair.random().secret();
    const r = await closeCli(world, executeArgs(world, "--yes"), { executeClose: failing(seed) });
    expect(r.code).toBe(1);
    const lines = r.err.trimEnd().split("\n");
    expect(lines).toEqual([
      "dustin: SPONSOR_REFUSED: The sponsor refused to wrap the envelope (S...REDACTED).",
      "  Check the sponsor's budget.",
    ]);
  });

  it("prints the stage, Horizon's result codes, the details and the cause chain with --verbose", async () => {
    const world = zeroSpendableWorld();
    const seed = Keypair.random().secret();
    for (const args of [
      executeArgs(world, "--yes", "--verbose"),
      ["--verbose", ...executeArgs(world, "--yes")],
    ]) {
      const r = await closeCli(world, args, { executeClose: failing(seed) });
      expect(r.code).toBe(1);
      const text = r.err;
      expect(text).toContain("dustin: SPONSOR_REFUSED: The sponsor refused to wrap the envelope");
      expect(text).toContain("  Check the sponsor's budget.");
      expect(text).toContain("  stage sponsor, next: stop, retryable false");
      expect(text).toContain(
        "  horizon: status 400; transaction tx_fee_bump_inner_failed; innerTransaction tx_failed; operations op_success, op_underfunded",
      );
      expect(text).toContain("  budgetStroops: 50000000");
      expect(text).toContain(
        "  caused by DustinError: HORIZON_UNAVAILABLE: Horizon answered HTTP 503.",
      );
      expect(text).toContain("  caused by Error: socket closed near S...REDACTED");
      expect(text).not.toContain(seed);
    }
  });

  it("puts the same detail on the error line with --json --verbose", async () => {
    const world = zeroSpendableWorld();
    const seed = Keypair.random().secret();
    const r = await closeCli(world, executeArgs(world, "--yes", "--json", "--verbose"), {
      executeClose: failing(seed),
    });
    expect(r.code).toBe(1);
    const error = r.err
      .trimEnd()
      .split("\n")
      .map((l) => JSON.parse(l) as Record<string, unknown>)
      .find((l) => l.type === "error")!;
    expect(error).toMatchObject({
      code: "SPONSOR_REFUSED",
      exitCode: 1,
      stage: "sponsor",
      verdict: "stop",
      retryable: false,
      horizon: { status: 400, operations: ["op_success", "op_underfunded"] },
      details: { budgetStroops: 50_000_000, leaked: "S...REDACTED" },
      causes: [
        { name: "DustinError", code: "HORIZON_UNAVAILABLE", stage: "inspect" },
        { name: "Error", message: "socket closed near S...REDACTED" },
      ],
    });
    expect(r.err).not.toContain(seed);
  });

  it("keeps --json without --verbose to code, message, remedy and exit code", async () => {
    const world = zeroSpendableWorld();
    const r = await closeCli(world, executeArgs(world, "--yes", "--json"), {
      executeClose: failing(Keypair.random().secret()),
    });
    const error = r.err
      .trimEnd()
      .split("\n")
      .map((l) => JSON.parse(l) as Record<string, unknown>)
      .find((l) => l.type === "error")!;
    expect(Object.keys(error).sort()).toEqual(["code", "exitCode", "message", "remedy", "type"]);
  });

  it("prints the remedy of the error's code when the error names none (AC-E4-S2-1)", async () => {
    const world = zeroSpendableWorld();
    const stub: typeof executeClose = () =>
      Promise.reject(
        new DustinError("TOO_MANY_OPERATIONS", "A transaction needs 1 to 100.", { stage: "build" }),
      );
    const r = await closeCli(world, executeArgs(world, "--yes"), { executeClose: stub });
    expect(r.code).toBe(1);
    expect(r.err).toBe(
      "dustin: TOO_MANY_OPERATIONS: A transaction needs 1 to 100.\n" +
        "  The planner never groups more than 100 operations, so this is a bug; report it with the plan.\n",
    );
  });

  it("prints the stack of an unexpected error only with --verbose, redacted", async () => {
    const world = zeroSpendableWorld();
    const seed = Keypair.random().secret();
    const stub: typeof executeClose = () => Promise.reject(new TypeError(`boom ${seed}`));
    const plain = await closeCli(world, executeArgs(world, "--yes"), { executeClose: stub });
    expect(plain.code).toBe(1);
    expect(plain.err).toContain("dustin: unexpected error: boom S...REDACTED");
    expect(plain.err).not.toMatch(/\n\s+at /);
    const verbose = await closeCli(world, executeArgs(world, "--yes", "--verbose"), {
      executeClose: stub,
    });
    expect(verbose.err).toMatch(/\n\s+at /);
    expect(verbose.err + plain.err).not.toContain(seed);
  });
});
