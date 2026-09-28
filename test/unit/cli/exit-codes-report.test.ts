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
    expect(code("SPONSOR_BUDGET_EXCEEDED")).toBe(3);
    expect(code("SPONSOR_UNDERFUNDED")).toBe(3);
    expect(code("CONFIRMATION_DECLINED")).toBe(3);
    expect(code("EXECUTION_INTERRUPTED")).toBe(5);
  });

  it("maps an interruption before any submission to 1, and an over-budget refusal to 3", () => {
    const interrupted = new DustinError("EXECUTION_INTERRUPTED", "signer threw", {
      stage: "build",
    }).withReport({ transactions: [] } as unknown as CloseReport);
    expect(exitCodeFor(interrupted)).toBe(ExitCode.UNEXPECTED);
    const overBudget: Parameters<typeof exitCodeForReport>[0] = {
      status: "aborted",
      verification: null,
      transactions: [],
      stop: { code: "OVER_BUDGET", stage: "sponsor", verdict: "stop", detail: "fees rose" },
    };
    // Canonical decision 5 as widened on 2026-09-28: a failed sponsor or budget precondition is
    // "nothing executed", like the CLI's own budget check before the question.
    expect(exitCodeForReport(overBudget)).toBe(ExitCode.NOTHING_EXECUTED);
    expect(exitCodeForReport({ ...overBudget, stop: null })).toBe(ExitCode.NOTHING_EXECUTED);
  });

  it("maps any error whose report holds a submitted transaction to 5, whatever its stage", () => {
    // A reader failing mid-run keeps stage "inspect"; without the report it would read as 6.
    const bare = new DustinError("HORIZON_UNAVAILABLE", "down", { stage: "inspect" });
    expect(exitCodeFor(bare)).toBe(ExitCode.HORIZON_UNREACHABLE);
    const withReport = bare.withReport({ transactions: tx } as unknown as CloseReport);
    expect(exitCodeFor(withReport)).toBe(ExitCode.STOPPED);
    const nothingSent = bare.withReport({ transactions: [] } as unknown as CloseReport);
    expect(exitCodeFor(nothingSent)).toBe(ExitCode.HORIZON_UNREACHABLE);
  });
});
