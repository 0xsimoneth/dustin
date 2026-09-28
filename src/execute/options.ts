import { MIN_BASE_FEE } from "../config/fees.js";
import { MIN_PAUSE_MS, isPause } from "../config/pauses.js";
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
// A bound (how long to keep trying) may be 0, meaning "look once".
const duration: Rule = {
  test: (n) => Number.isFinite(n) && n >= 0,
  expected: "a finite number of at least 0",
};
// A pause (the time slept between two requests to Horizon) is at least 200 ms and never 0, so no
// caller can make the executor poll Horizon in a tight loop (src/config/pauses.ts). Tests skip real
// waiting by injecting `sleep`, never by passing 0.
const pause: Rule = {
  test: isPause,
  expected: `a pause of at least ${MIN_PAUSE_MS} ms (inject \`sleep\` to skip waiting)`,
};

const RULES: Record<keyof NumericExecuteOptions, Rule> = {
  maxAttemptsPerTransaction: count(1),
  maxReplans: count(0),
  maxRateLimitRetries: count(0),
  pollIntervalMs: pause,
  backoffMs: pause,
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
