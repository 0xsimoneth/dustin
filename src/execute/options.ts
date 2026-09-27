import { MIN_BASE_FEE } from "../config/fees.js";
import { DustinError } from "../errors/dustin-error.js";

/** The numeric execute options, as `validateExecuteOptions` reads them. */
export interface NumericExecuteOptions {
  maxAttemptsPerTransaction?: number;
  maxReplans?: number;
  maxRateLimitRetries?: number;
  pollIntervalMs?: number;
  backoffMs?: number;
  verifyTimeoutMs?: number;
  graceSeconds?: number;
  ledgerWaitSeconds?: number;
  timeoutSeconds?: number;
  budgetStroops?: number;
  maxBaseFeeStroops?: number;
}

type Rule = { test: (n: number) => boolean; expected: string };

const count = (least: number): Rule => ({
  test: (n) => Number.isSafeInteger(n) && n >= least,
  expected: `a whole number of at least ${least}`,
});
// Zero is a pause like any other: every wait stays bounded by ledger close times and by limits
// measured on the local clock, and tests and callers pass 0 to wait for nothing.
const duration: Rule = {
  test: (n) => Number.isFinite(n) && n >= 0,
  expected: "a finite number of at least 0",
};

const RULES: Record<keyof NumericExecuteOptions, Rule> = {
  maxAttemptsPerTransaction: count(1),
  maxReplans: count(0),
  maxRateLimitRetries: count(0),
  pollIntervalMs: duration,
  backoffMs: duration,
  verifyTimeoutMs: duration,
  graceSeconds: duration,
  ledgerWaitSeconds: duration,
  timeoutSeconds: count(1),
  budgetStroops: count(1),
  maxBaseFeeStroops: count(MIN_BASE_FEE),
};

/**
 * Refuses a numeric execute option that would unbind a limit or a wait, before anything is read or
 * signed (edge case E11): `attempt > NaN` never holds, so a NaN limit would rebuild without end.
 */
export function validateExecuteOptions(options: NumericExecuteOptions): void {
  for (const [name, rule] of Object.entries(RULES) as Array<[keyof NumericExecuteOptions, Rule]>) {
    const value = options[name];
    if (value === undefined) continue;
    if (typeof value !== "number" || !rule.test(value)) {
      throw new DustinError(
        "CONFIG_INVALID",
        `Invalid execute option: ${name} must be ${rule.expected}; got ${String(value)}.`,
        { stage: "config" },
      );
    }
  }
}
