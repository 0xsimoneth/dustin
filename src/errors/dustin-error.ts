import type { CloseReport } from "../execute/report.js";
import { redact, redactValue } from "./redact.js";

/**
 * Stable error codes. Integrators branch on these, never on messages
 * (docs/adr/ADR-0006-error-taxonomy.md). Codes are added as the stories that raise them land.
 */
export type DustinErrorCode =
  | "MISSING_ACCOUNT_SECRET"
  | "MISSING_SPONSOR_SECRET"
  | "CONFIRMATION_DECLINED"
  | "EXECUTION_INTERRUPTED"
  | "NOT_IMPLEMENTED"
  | "CONFIG_INVALID"
  | "MAINNET_REFUSED"
  | "SECRET_IN_ARGV"
  | "HORIZON_UNAVAILABLE"
  | "FRIENDBOT_FAILED"
  | "FIXTURE_STEP_FAILED"
  | "FIXTURE_INVALID"
  | "MANIFEST_INVALID"
  | "INVALID_ADDRESS"
  | "CONTRACT_ACCOUNT"
  | "TOO_MANY_OPERATIONS"
  | "SPONSOR_REFUSED"
  | "SPONSOR_BUDGET_EXCEEDED"
  | "SPONSOR_UNDERFUNDED"
  | "CONFIRMATION_REQUIRED"
  | "WRONG_SIGNER"
  | "ACCOUNT_NOT_FOUND"
  | "RESET_SUSPECTED"
  | "LEDGER_DATA_INVALID";

export type ErrorStage =
  "config" | "inspect" | "plan" | "build" | "sponsor" | "submit" | "confirm" | "merge";

/** What the caller may do next: retry as is, rebuild with the same sequence, re-plan, or stop. */
export type ErrorVerdict = "retry-same" | "rebuild-same-sequence" | "replan" | "stop";

export type JsonScalar = string | number | boolean | null;

export interface HorizonFailure {
  status?: number;
  transaction?: string;
  innerTransaction?: string;
  operations?: string[];
  hash?: string;
}

export interface DustinErrorOptions {
  stage: ErrorStage;
  retryable?: boolean;
  verdict?: ErrorVerdict;
  remedy?: string;
  details?: Record<string, JsonScalar>;
  horizon?: HorizonFailure;
  cause?: unknown;
  /**
   * The close report as it stood when an execution stopped on this error, so no hash of an
   * already submitted transaction is lost (PRD NFR-03, review finding R1).
   */
  report?: CloseReport;
}

/** The single error type of the SDK and CLI. Every text field is redacted on construction. */
export class DustinError extends Error {
  override readonly name = "DustinError";
  readonly code: DustinErrorCode;
  readonly stage: ErrorStage;
  readonly retryable: boolean;
  readonly verdict: ErrorVerdict;
  readonly remedy?: string;
  readonly details?: Record<string, JsonScalar>;
  readonly horizon?: HorizonFailure;
  readonly report?: CloseReport;

  constructor(code: DustinErrorCode, message: string, options: DustinErrorOptions) {
    super(
      redact(message),
      options.cause === undefined ? undefined : { cause: redactCause(options.cause) },
    );
    this.code = code;
    this.stage = options.stage;
    this.retryable = options.retryable ?? false;
    this.verdict = options.verdict ?? "stop";
    if (options.remedy !== undefined) this.remedy = redact(options.remedy);
    if (options.details !== undefined) this.details = redactValue(options.details);
    if (options.horizon !== undefined) this.horizon = redactValue(options.horizon);
    if (options.report !== undefined) this.report = redactValue(options.report);
  }

  /** The same error with the close report attached; the original becomes the cause. */
  withReport(report: CloseReport): DustinError {
    return new DustinError(this.code, this.message, {
      stage: this.stage,
      retryable: this.retryable,
      verdict: this.verdict,
      ...(this.remedy !== undefined ? { remedy: this.remedy } : {}),
      ...(this.details !== undefined ? { details: this.details } : {}),
      ...(this.horizon !== undefined ? { horizon: this.horizon } : {}),
      cause: this,
      report,
    });
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      stage: this.stage,
      retryable: this.retryable,
      verdict: this.verdict,
      remedy: this.remedy,
      details: this.details,
      horizon: this.horizon,
      report: this.report,
    };
  }
}

function redactCause(cause: unknown): unknown {
  // A DustinError redacted itself on construction; keep it so its code survives.
  if (cause instanceof DustinError) return cause;
  if (cause instanceof Error) {
    const copy = new Error(redact(cause.message));
    copy.name = cause.name;
    return copy;
  }
  return redactValue(cause);
}

export function notImplemented(what: string, stage: ErrorStage): DustinError {
  return new DustinError("NOT_IMPLEMENTED", `${what} is not implemented yet`, { stage });
}
