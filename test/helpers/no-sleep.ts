import type { Sleep } from "../../src/config/pauses.js";

/**
 * A pause that returns at once. Pauses are at least 200 ms and never 0 (src/config/pauses.ts), so a
 * test that must not wait injects this instead of passing a zero pause.
 */
export const noSleep: Sleep = () => Promise.resolve();
