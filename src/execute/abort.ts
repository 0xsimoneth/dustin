import { timerSleep, timerSleepUntil, type Sleep } from "../config/pauses.js";

/**
 * A pause that ends early when `signal` is aborted (review finding CL-1, story E4-S2), so a run
 * interrupted during a wait (for an envelope's outcome, for the sequence guard, for a lagging
 * account read) stops at once instead of at the end of the pause. Every loop that sleeps through it
 * checks the signal after the pause, so an aborted signal never turns it into a tight loop against
 * Horizon. A rejection of the injected pause is passed on. Without a signal it is `sleep` itself.
 * The default timer is cancelled with the signal, so no armed timer outlives the run (Epic 4 review
 * EX-6, BH-9); an injected pause is left to run out, its promise no longer waited for.
 * AbortSignal: https://nodejs.org/api/globals.html#class-abortsignal
 */
export function interruptibleSleep(sleep: Sleep, signal: AbortSignal | undefined): Sleep {
  if (!signal) return sleep;
  if (sleep === timerSleep) return timerSleepUntil(signal);
  return (ms) => {
    if (signal.aborted) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      const done = () => {
        signal.removeEventListener("abort", done);
        resolve();
      };
      signal.addEventListener("abort", done, { once: true });
      sleep(ms).then(done, (error: unknown) => {
        signal.removeEventListener("abort", done);
        reject(error instanceof Error ? error : new Error(String(error)));
      });
    });
  };
}

/**
 * The abort reason in a few words for a stop's detail: a short string as the CLI gives it ("SIGINT",
 * "SIGTERM"), otherwise "AbortSignal". The reason is the caller's; it is never quoted at length.
 */
export function abortReason(signal: AbortSignal): string {
  const reason: unknown = signal.reason;
  return typeof reason === "string" && /^[A-Za-z0-9 _.:-]{1,40}$/.test(reason)
    ? reason
    : "AbortSignal";
}

/** True for an AbortSignal, or anything that behaves as one for the executor. */
export function isAbortSignal(value: unknown): value is AbortSignal {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as AbortSignal).aborted === "boolean" &&
    typeof (value as AbortSignal).addEventListener === "function" &&
    typeof (value as AbortSignal).removeEventListener === "function"
  );
}
