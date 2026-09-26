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
export { renderPlan } from "./render/plan-text.js";
export type { RenderPlanOptions } from "./render/plan-text.js";
export { renderReport } from "./render/report-text.js";
export type { RenderReportOptions } from "./render/report-text.js";
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

// Fee-bumped close executor (SOW Deliverable 2, review R3).
export { executeClose } from "./execute/executor.js";
export type { CloseEvent, ExecuteOptions, Signers } from "./execute/executor.js";
export type {
  CloseReport,
  CloseStatus,
  ReplanRecord,
  StepOutcome,
  StopCode,
  StopReason,
  SubmittedTransaction,
} from "./execute/report.js";
export type { ResultCodes } from "./execute/result-codes.js";
// Read-only proof that a closed account is gone (AC-E2-S4-1).
export { verifyClosed } from "./execute/verify.js";
export type { ClosedVerification, VerifyClosedOptions } from "./execute/verify.js";
export { keypairSigner } from "./sponsor/signer.js";
export type { Signer } from "./sponsor/signer.js";
