import { DustinError, type ErrorStage } from "../errors/dustin-error.js";

/**
 * The shortest pause between two requests to Horizon, in milliseconds. It applies to every pause
 * Dustin takes on its own schedule: the executor's lookups by hash and account re-reads
 * (`pollIntervalMs`), its backoff after HTTP 429 (`backoffMs`), `verifyClosed`'s looks
 * (`intervalMs`) and the read client's retries (`backoffMs`). A pause of 0 is refused, so no
 * caller can make Dustin poll Horizon in a tight loop (builder decision of 2026-09-28 on review
 * decision 5 of 2026-09-27). Bounds such as a grace period or a verification timeout are not
 * pauses and may be 0.
 */
export const MIN_PAUSE_MS = 200;

/**
 * The longest pause: Node's timer limit, 2^31 - 1 ms (about 24.8 days). A longer `setTimeout`
 * fires after 1 ms instead (https://nodejs.org/api/timers.html#settimeoutcallback-delay-args), which
 * would turn a long pause into a tight loop against Horizon. A pause option above it is refused,
 * and a computed pause (the doubled backoff after HTTP 429) is capped at it (review round 3, R3-18).
 */
export const MAX_PAUSE_MS = 2 ** 31 - 1;

/** Waits for the given number of milliseconds. Injected by tests, which pass one that returns at once. */
export type Sleep = (ms: number) => Promise<void>;

/** The production pause: a timer, never set beyond Node's limit. */
export const timerSleep: Sleep = (ms) =>
  new Promise<void>((resolve) => setTimeout(resolve, Math.min(ms, MAX_PAUSE_MS)));

/**
 * The production pause of a run that can be interrupted: the same timer, cleared when `signal` is
 * aborted, so the pause ends at once and no timer is left armed to keep the process alive after
 * the run returned (Epic 4 review EX-6, BH-9: the CLI lingered up to a whole pause after the
 * receipt, with its signal handlers already removed). An injected `sleep` keeps its contract, a
 * function of the milliseconds only; the executor ends its promise early instead
 * (src/execute/abort.ts). clearTimeout: https://nodejs.org/api/timers.html#cleartimeouttimeout
 */
export function timerSleepUntil(signal: AbortSignal): Sleep {
  return (ms) =>
    new Promise<void>((resolve) => {
      if (signal.aborted) {
        resolve();
        return;
      }
      const done = () => {
        clearTimeout(timer);
        signal.removeEventListener("abort", done);
        resolve();
      };
      const timer = setTimeout(done, Math.min(ms, MAX_PAUSE_MS));
      signal.addEventListener("abort", done, { once: true });
    });
}

/**
 * A pause of a bounded wait: `pauseMs`, but never longer than the time left in the wait
 * (`leftMs`), so one long pause cannot outlast the wait's bound, and never below `MIN_PAUSE_MS`,
 * so the clip can never make a tight loop. A time left that is not a finite number leaves the
 * pause as it is (closing review CX-8).
 */
export function clipPause(pauseMs: number, leftMs: number): number {
  if (!Number.isFinite(leftMs)) return pauseMs;
  return Math.max(MIN_PAUSE_MS, Math.min(pauseMs, leftMs));
}

/**
 * True for a pause Dustin accepts: a finite number of milliseconds from `MIN_PAUSE_MS` to
 * `MAX_PAUSE_MS`.
 */
export function isPause(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= MIN_PAUSE_MS &&
    value <= MAX_PAUSE_MS
  );
}

/**
 * Refuses a pause outside the bounds, before anything is read, signed or submitted. Tests that
 * must not wait inject a `sleep` that returns at once instead of passing 0.
 */
export function assertPause(name: string, value: number | undefined, stage: ErrorStage): void {
  if (value === undefined || isPause(value)) return;
  throw new DustinError(
    "CONFIG_INVALID",
    `Invalid option: ${name} must be a pause of ${MIN_PAUSE_MS} to ${MAX_PAUSE_MS} ms; got ${String(value)}.`,
    {
      stage,
      remedy: `Leave ${name} out to use the default, or give ${MIN_PAUSE_MS} to ${MAX_PAUSE_MS} ms. To skip waiting (tests), inject a sleep function that returns at once.`,
    },
  );
}
