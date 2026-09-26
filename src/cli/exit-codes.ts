import type { DustinError } from "../errors/dustin-error.js";
import type { CloseReport } from "../execute/report.js";

/** CLI exit codes, docs/README.md canonical decision 5. */
export const ExitCode = {
  /** Plan printed, or account closed and verified gone. */
  OK: 0,
  /** Unexpected error. */
  UNEXPECTED: 1,
  /** Usage or validation error: bad address, secret on argv, wrong key, mainnet, missing secrets. */
  USAGE: 2,
  /** Nothing executed: confirmation missing or declined, or blockers without --partial. */
  NOTHING_EXECUTED: 3,
  /** Partial: the run completed what it could and the account still exists. */
  PARTIAL: 4,
  /** Stopped or failed during execution; re-run to continue. */
  STOPPED: 5,
  /** Horizon unreachable before any submission. */
  HORIZON_UNREACHABLE: 6,
} as const;

export type ExitCode = (typeof ExitCode)[keyof typeof ExitCode];

export function exitCodeFor(error: DustinError): ExitCode {
  // An error that carries a report with a submitted transaction stopped a run midway: whatever its
  // code or stage, something reached the network, so it is never "nothing was submitted".
  if (error.report && error.report.transactions.length > 0) return ExitCode.STOPPED;
  switch (error.code) {
    case "CONFIG_INVALID":
    case "MAINNET_REFUSED":
    case "SECRET_IN_ARGV":
    case "MISSING_ACCOUNT_SECRET":
    case "MISSING_SPONSOR_SECRET":
    case "INVALID_ADDRESS":
    case "CONTRACT_ACCOUNT":
    case "WRONG_SIGNER":
    case "SPONSOR_UNDERFUNDED":
    case "SPONSOR_BUDGET_EXCEEDED":
      return ExitCode.USAGE;
    case "CONFIRMATION_REQUIRED":
    case "CONFIRMATION_DECLINED":
      return ExitCode.NOTHING_EXECUTED;
    case "EXECUTION_INTERRUPTED":
      return ExitCode.STOPPED;
    case "HORIZON_UNAVAILABLE":
      // Exit code 6 means "nothing was submitted"; once submission has started it is 5.
      return error.stage === "submit" || error.stage === "confirm" || error.stage === "merge"
        ? ExitCode.STOPPED
        : ExitCode.HORIZON_UNREACHABLE;
    default:
      return ExitCode.UNEXPECTED;
  }
}

/**
 * The exit code of a finished `close --execute` (docs/README.md canonical decision 5): 0 only when
 * the account was closed and Horizon no longer has it; 3 when nothing was submitted; 4 for a
 * partial close; 5 when the run stopped or failed after something was submitted, or when a merge
 * was reported applied but the account was not verified gone.
 */
export function exitCodeForReport(
  report: Pick<CloseReport, "status" | "verification" | "transactions">,
): ExitCode {
  switch (report.status) {
    case "closed":
      return report.verification?.accountExists === false ? ExitCode.OK : ExitCode.STOPPED;
    case "partial":
      return ExitCode.PARTIAL;
    case "aborted":
      return report.transactions.length === 0 ? ExitCode.NOTHING_EXECUTED : ExitCode.STOPPED;
    default:
      return ExitCode.STOPPED;
  }
}
