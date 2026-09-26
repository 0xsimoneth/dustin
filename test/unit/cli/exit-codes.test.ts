import { describe, expect, it } from "vitest";
import { ExitCode, exitCodeFor } from "../../../src/cli/exit-codes.js";
import { DustinError, type ErrorStage } from "../../../src/errors/dustin-error.js";

describe("exitCodeFor", () => {
  it("maps usage and validation errors to 2", () => {
    for (const code of ["CONFIG_INVALID", "MAINNET_REFUSED", "SECRET_IN_ARGV"] as const) {
      expect(exitCodeFor(new DustinError(code, "x", { stage: "config" }))).toBe(ExitCode.USAGE);
    }
  });

  it("uses 6 for an unreachable Horizon only before anything was submitted", () => {
    const at = (stage: ErrorStage) =>
      exitCodeFor(new DustinError("HORIZON_UNAVAILABLE", "x", { stage }));
    for (const stage of ["config", "inspect", "plan", "build"] as const) expect(at(stage)).toBe(6);
    for (const stage of ["submit", "confirm", "merge"] as const) expect(at(stage)).toBe(5);
  });

  it("treats anything else as unexpected", () => {
    expect(exitCodeFor(new DustinError("NOT_IMPLEMENTED", "x", { stage: "plan" }))).toBe(1);
  });
});
