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
export { inspectAccount } from "./inspect/inspect.js";
export { planClose } from "./plan/plan-close.js";
export type { PlanCloseInput, PlanCloseOptions } from "./plan/plan-close.js";
export { planFromSnapshot } from "./plan/plan.js";
export type * from "./plan/model.js";
export type { InspectOptions } from "./inspect/inspect.js";
export type * from "./inspect/snapshot.js";
export type { LedgerReader } from "./reader/ledger-reader.js";
export {
  DEFAULT_EXPLORER_BASE,
  DEFAULT_HORIZON_URL,
  TESTNET_PASSPHRASE,
  resolveConfig,
  verifyHorizonIsTestnet,
} from "./config/network.js";
export type { DustinConfig, ResolvedConfig } from "./config/network.js";

/** Fee-bumped close executor (SOW Deliverable 2). Implemented in Epic 2. */
export function executeClose(): Promise<never> {
  return Promise.reject(notImplemented("executeClose", "submit"));
}
