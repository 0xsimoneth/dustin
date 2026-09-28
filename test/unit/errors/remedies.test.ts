import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { exitCodeFor } from "../../../src/cli/exit-codes.js";
import { DustinError, type DustinErrorCode } from "../../../src/errors/dustin-error.js";
import { DEFAULT_REMEDIES, REMEDY_POINTER, remedyOf } from "../../../src/errors/remedies.js";
import type { CloseReport } from "../../../src/execute/report.js";

// AC-E4-S2-1 and AC-E4-S2-3 (story E4-S2): every error comes with a remedy, and docs/errors.md
// lists every DustinErrorCode and every StopCode with its meaning, stage, exit code and remedy.
// The codes are read from the unions in the source, so a code added later without a row in
// docs/errors.md or a default remedy fails here.

/** The members of an exported string-literal union type, read from its source file. */
function unionMembers(file: string, type: string): string[] {
  const source = readFileSync(file, "utf8");
  const start = source.indexOf(`export type ${type} =`);
  expect(start, `${type} in ${file}`).toBeGreaterThanOrEqual(0);
  // Comments may quote other codes and hold semicolons; only the members count.
  const rest = source
    .slice(start)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
  const body = rest.slice(0, rest.indexOf(";"));
  return [...body.matchAll(/"([A-Z][A-Z0-9_]*)"/g)].map((m) => m[1]!);
}

const errorCodes = unionMembers(
  "src/errors/dustin-error.ts",
  "DustinErrorCode",
) as DustinErrorCode[];
const stopCodes = unionMembers("src/execute/report.ts", "StopCode");
const doc = readFileSync("docs/errors.md", "utf8");

/** The cells of the table row of `code` in docs/errors.md. */
function row(code: string): string[] {
  const line = doc.split("\n").find((l) => l.startsWith(`| \`${code}\` |`));
  expect(line, `docs/errors.md has a row for ${code}`).toBeDefined();
  return line!
    .split("|")
    .slice(2, -1)
    .map((c) => c.trim());
}

describe("error codes and their remedies (AC-E4-S2-1)", () => {
  it("reads the unions from the source", () => {
    expect(errorCodes).toContain("CONFIRMATION_REQUIRED");
    expect(errorCodes.length).toBeGreaterThanOrEqual(22);
    expect(stopCodes).toContain("INTERRUPTED");
    expect(stopCodes.length).toBeGreaterThanOrEqual(18);
  });

  it("has a default remedy for every DustinErrorCode", () => {
    for (const code of errorCodes) expect(DEFAULT_REMEDIES[code], code).toBeTypeOf("string");
  });

  it("gives an error its own remedy first, else its code's, never none", () => {
    const own = new DustinError("CONFIG_INVALID", "x", { stage: "config", remedy: "Fix x." });
    expect(remedyOf(own)).toBe("Fix x.");
    const bare = new DustinError("CONFIG_INVALID", "x", { stage: "config" });
    expect(remedyOf(bare)).toBe(DEFAULT_REMEDIES.CONFIG_INVALID);
    expect(remedyOf({ code: "SOMETHING_NEW" as DustinErrorCode })).toBe(REMEDY_POINTER);
  });
});

describe("docs/errors.md (AC-E4-S2-3)", () => {
  it("lists every DustinErrorCode with its meaning, stage, exit code and remedy", () => {
    for (const code of errorCodes) {
      const [meaning, stage, exit, remedy] = row(code);
      expect(meaning, code).not.toBe("");
      expect(stage, code).not.toBe("");
      expect(remedy, code).not.toBe("");
      // The first exit code named is the one before anything was submitted.
      const error = new DustinError(code, "x", { stage: "inspect" }).withReport({
        transactions: [],
      } as unknown as CloseReport);
      expect(Number(/\d/.exec(exit!)?.[0]), `${code}: ${exit}`).toBe(exitCodeFor(error));
    }
  });

  it("lists every StopCode with its meaning, stage, verdict, exit code and remedy", () => {
    for (const code of stopCodes) {
      const [meaning, stage, verdict, exit, remedy] = row(code);
      for (const cell of [meaning, stage, exit, remedy]) expect(cell, code).not.toBe("");
      expect(verdict, code).toMatch(/replan|stop/);
      expect(exit, code).toMatch(/[35]/);
    }
  });

  it("lists every exit code of canonical decision 5", () => {
    for (let exit = 0; exit <= 6; exit++) expect(doc).toContain(`| ${exit} |`);
  });
});
