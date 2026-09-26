import { notImplemented } from "./errors/dustin-error.js";

export { DustinError } from "./errors/dustin-error.js";

/** Read-only close planner (SOW Deliverable 1). Implemented in Epic 1. */
export function planClose(): Promise<never> {
  return Promise.reject(notImplemented("planClose"));
}

/** Fee-bumped close executor (SOW Deliverable 2). Implemented in Epic 2. */
export function executeClose(): Promise<never> {
  return Promise.reject(notImplemented("executeClose"));
}
