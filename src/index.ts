import { notImplemented } from "./errors/dustin-error.js";

export { DustinError } from "./errors/dustin-error.js";
export type {
  DustinErrorCode,
  DustinErrorOptions,
  ErrorStage,
  ErrorVerdict,
  HorizonFailure,
} from "./errors/dustin-error.js";
export { redact } from "./errors/redact.js";
export {
  DEFAULT_EXPLORER_BASE,
  DEFAULT_HORIZON_URL,
  TESTNET_PASSPHRASE,
  resolveConfig,
  verifyHorizonIsTestnet,
} from "./config/network.js";
export type { DustinConfig, ResolvedConfig } from "./config/network.js";

/** Read-only close planner (SOW Deliverable 1). Implemented in Epic 1. */
export function planClose(): Promise<never> {
  return Promise.reject(notImplemented("planClose", "plan"));
}

/** Fee-bumped close executor (SOW Deliverable 2). Implemented in Epic 2. */
export function executeClose(): Promise<never> {
  return Promise.reject(notImplemented("executeClose", "submit"));
}
