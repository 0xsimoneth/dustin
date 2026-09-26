import { redact, redactValue } from "./redact.js";

/**
 * Stable error codes. Integrators branch on these, never on messages
 * (docs/adr/ADR-0006-error-taxonomy.md). Codes are added as the stories that raise them land.
 */
export type DustinErrorCode =
  | "NOT_IMPLEMENTED"
  | "CONFIG_INVALID"
  | "MAINNET_REFUSED"
  | "SECRET_IN_ARGV"
  | "HORIZON_UNAVAILABLE"
  | "FRIENDBOT_FAILED"
  | "FIXTURE_STEP_FAILED"
  | "FIXTURE_INVALID"
  | "MANIFEST_INVALID";

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
