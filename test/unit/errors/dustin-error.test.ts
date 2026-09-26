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
