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

/** Waits for the given number of milliseconds. Injected by tests, which pass one that returns at once. */
export type Sleep = (ms: number) => Promise<void>;

/** The production pause: a timer. */
export const timerSleep: Sleep = (ms) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** True for a pause Dustin accepts: a finite number of milliseconds, at least `MIN_PAUSE_MS`. */
export function isPause(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= MIN_PAUSE_MS;
}

/**
 * Refuses a pause below the floor, before anything is read, signed or submitted. Tests that must
 * not wait inject a `sleep` that returns at once instead of passing 0.
 */
export function assertPause(name: string, value: number | undefined, stage: ErrorStage): void {
  if (value === undefined || isPause(value)) return;
  throw new DustinError(
    "CONFIG_INVALID",
    `Invalid option: ${name} must be a pause of at least ${MIN_PAUSE_MS} ms; got ${String(value)}.`,
    {
      stage,
      remedy: `Leave ${name} out to use the default, or give at least ${MIN_PAUSE_MS} ms. To skip waiting (tests), inject a sleep function that returns at once.`,
    },
  );
}
