import { Keypair } from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";
import { DustinError } from "../../../src/errors/dustin-error.js";
import { REDACTED_SEED } from "../../../src/errors/redact.js";

describe("DustinError", () => {
  it("defaults to a non-retryable stop", () => {
    const e = new DustinError("MAINNET_REFUSED", "refused", { stage: "config" });
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe("DustinError");
    expect(e.code).toBe("MAINNET_REFUSED");
    expect(e.stage).toBe("config");
    expect(e.retryable).toBe(false);
    expect(e.verdict).toBe("stop");
  });

  it("redacts secrets from the message, details, remedy and cause", () => {
    const seed = Keypair.random().secret();
    const e = new DustinError("SECRET_IN_ARGV", `bad ${seed}`, {
      stage: "config",
      remedy: `unset ${seed}`,
      details: { value: seed },
      cause: new Error(`inner ${seed}`),
    });
    const everything =
      JSON.stringify(e) + e.message + String(e.remedy) + String((e.cause as Error).message);
    expect(everything).not.toContain(seed);
    expect(e.message).toBe(`bad ${REDACTED_SEED}`);
  });

  it("serialises to JSON with its public fields", () => {
    const e = new DustinError("HORIZON_UNAVAILABLE", "down", {
      stage: "inspect",
      retryable: true,
      verdict: "retry-same",
      remedy: "try again",
    });
    expect(JSON.parse(JSON.stringify(e))).toEqual({
      name: "DustinError",
      code: "HORIZON_UNAVAILABLE",
      message: "down",
      stage: "inspect",
      retryable: true,
      verdict: "retry-same",
      remedy: "try again",
    });
  });
});

describe("DustinError causes (review findings)", () => {
  it("redacts object and array causes and survives cyclic details", async () => {
    const { inspect } = await import("node:util");
    const seed = Keypair.random().secret();
    const cyclic: Record<string, unknown> = { v: seed };
    cyclic.self = cyclic;
    for (const cause of [{ secret: seed }, [seed], seed]) {
      const e = new DustinError("CONFIG_INVALID", "x", { stage: "config", cause });
      expect(inspect(e, { depth: 5 })).not.toContain(seed);
    }
    expect(
      () => new DustinError("CONFIG_INVALID", "x", { stage: "config", details: cyclic as never }),
    ).not.toThrow();
  });

  it("keeps a DustinError cause with its code", () => {
    const inner = new DustinError("HORIZON_UNAVAILABLE", "down", { stage: "inspect" });
    const outer = new DustinError("CONFIG_INVALID", "wrapped", { stage: "config", cause: inner });
    expect((outer.cause as DustinError).code).toBe("HORIZON_UNAVAILABLE");
  });
});

describe("DustinError with a close report (review finding R1)", () => {
  const report = (text: string) =>
    ({ kind: "dustin-close-report", status: "failed", message: text }) as never;

  it("carries the report, redacted, and serialises it", () => {
    const seed = Keypair.random().secret();
    const e = new DustinError("EXECUTION_INTERRUPTED", "stopped", {
      stage: "submit",
      report: report(`leaked ${seed}`),
    });
    expect(e.report).toMatchObject({ status: "failed", message: `leaked ${REDACTED_SEED}` });
    expect(JSON.stringify(e)).toContain('"report"');
    expect(JSON.stringify(e)).not.toContain(seed);
  });

  it("withReport keeps the code, stage and verdict and chains the original as the cause", () => {
    const original = new DustinError("HORIZON_UNAVAILABLE", "down", {
      stage: "submit",
      retryable: true,
      verdict: "retry-same",
      remedy: "try again",
    });
    const attached = original.withReport(report("partial"));
    expect(attached).toMatchObject({
      code: "HORIZON_UNAVAILABLE",
      stage: "submit",
      retryable: true,
      verdict: "retry-same",
      remedy: "try again",
      message: "down",
    });
    expect(attached.cause).toBe(original);
    expect(attached.report).toMatchObject({ message: "partial" });
    expect(original.report).toBeUndefined();
  });
});
