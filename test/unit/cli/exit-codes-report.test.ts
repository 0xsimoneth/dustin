import { describe, expect, it } from "vitest";
import { ExitCode, exitCodeFor, exitCodeForReport } from "../../../src/cli/exit-codes.js";
import { DustinError } from "../../../src/errors/dustin-error.js";
import type { CloseReport } from "../../../src/execute/report.js";

const verification = (accountExists: boolean): CloseReport["verification"] => ({
  accountExists,
  horizonStatus: accountExists ? 200 : 404,
  checkedAt: "2026-09-26T00:00:00Z",
  accountUrl: "https://stellar.expert/explorer/testnet/account/G",
});
const tx = [{}] as CloseReport["transactions"];

describe("exitCodeForReport (canonical decision 5)", () => {
  it("is 0 only for a close verified gone on Horizon", () => {
    expect(
      exitCodeForReport({ status: "closed", verification: verification(false), transactions: tx }),
    ).toBe(ExitCode.OK);
    expect(
      exitCodeForReport({ status: "closed", verification: verification(true), transactions: tx }),
    ).toBe(ExitCode.STOPPED);
    expect(exitCodeForReport({ status: "closed", verification: null, transactions: tx })).toBe(
      ExitCode.STOPPED,
    );
  });

  it("maps partial to 4, failed to 5, and aborted to 3 only when nothing was submitted", () => {
    expect(
      exitCodeForReport({ status: "partial", verification: verification(true), transactions: tx }),
    ).toBe(4);
    expect(
      exitCodeForReport({ status: "failed", verification: verification(true), transactions: tx }),
    ).toBe(5);
    expect(exitCodeForReport({ status: "aborted", verification: null, transactions: [] })).toBe(3);
    expect(exitCodeForReport({ status: "aborted", verification: null, transactions: tx })).toBe(5);
  });

  it("maps the codes of the close command", () => {
    const code = (c: ConstructorParameters<typeof DustinError>[0]) =>
      exitCodeFor(new DustinError(c, "x", { stage: "config" }));
    expect(code("MISSING_ACCOUNT_SECRET")).toBe(2);
    expect(code("MISSING_SPONSOR_SECRET")).toBe(2);
    expect(code("SPONSOR_BUDGET_EXCEEDED")).toBe(2);
    expect(code("CONFIRMATION_DECLINED")).toBe(3);
    expect(code("EXECUTION_INTERRUPTED")).toBe(5);
  });
});
