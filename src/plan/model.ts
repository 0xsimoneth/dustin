import type { AssetRef, CreditAssetRef } from "../inspect/snapshot.js";

/**
 * The close plan: plain JSON, descriptors only. It never holds a key, a signer or a signed
 * envelope, so nothing that consumes a plan can sign with it (docs/architecture.md section 6.3).
 */

export type PlanStatus = "closable" | "partial" | "blocked";

export type DisposalRung = "path_payment" | "return_to_issuer" | "send_to_destination";

export type LadderOrder = "sow" | "prefer-destination";

export type UnclosableCode =
  | "TRUSTLINE_NOT_AUTHORIZED"
  | "MAINTAIN_LIABILITIES_ONLY"
  | "NO_DISPOSAL_ROUTE"
  | "LIQUIDITY_POOL_SHARES"
  | "POOL_ASSET_TRUSTLINE";

export type BlockerCode =
  | "ACCOUNT_MISSING"
  | "AUTH_IMMUTABLE_SET"
  | "IS_SPONSOR"
  | "MASTER_KEY_DISABLED"
  | "THRESHOLD_UNMET"
  | "DESTINATION_MISSING"
  | "DESTINATION_IS_SELF"
  | "DESTINATION_REQUIRES_MEMO"
  | "SEQNUM_TOO_FAR"
  | "LIQUIDITY_POOL_SHARES";

/** Serialisable operation descriptors; the executor turns them into SDK operations. */
export type OperationDescriptor =
  | {
      type: "manageSellOffer";
      offerId: string;
      selling: AssetRef;
      buying: AssetRef;
      amount: "0";
      price: { n: number; d: number };
    }
  | {
      type: "pathPaymentStrictSend";
      sendAsset: CreditAssetRef;
      sendAmount: string;
      destination: string;
      destAsset: { type: "native" };
      destMin: string;
      path: AssetRef[];
    }
  | { type: "payment"; destination: string; asset: CreditAssetRef; amount: string }
  | { type: "changeTrust"; asset: CreditAssetRef; limit: "0" }
  | { type: "manageData"; name: string; value: null }
  | { type: "accountMerge"; destination: string };

export type CloseStepKind =
  "cancel_offer" | "dispose_balance" | "remove_trustline" | "remove_data" | "merge";

export type StepSubject =
  | { type: "offer"; offerId: string; selling: AssetRef; buying: AssetRef; amount: string }
  | { type: "trustline"; asset: CreditAssetRef; balance: string; sponsor: string | null }
  | { type: "data"; name: string }
  | { type: "pool_share"; poolId: string; balance: string }
  | { type: "account"; destination: string };

export interface DisposalDecision {
  rung: DisposalRung;
  amount: string;
  /** Where the balance goes: the account itself (rung 1), the issuer or the destination. */
  to: string;
  /** Path-payment quote (rung 1 only). */
  quotedXlm?: string;
  destMinXlm?: string;
  /** Rungs that were viable in the snapshot but come later in the order; the executor falls back to them. */
  fallbackRungs: DisposalRung[];
  /** Rungs that were not viable, with the reason. */
  ruledOut: Array<{ rung: DisposalRung; reason: string }>;
}

export interface CloseStep {
  id: string;
  kind: CloseStepKind;
  /** Index into `transactions`, assigned by grouping. */
  txIndex: number;
  subject: StepSubject;
  reason: string;
  dependsOn: string[];
  /** Threshold category the account's signers must meet for this operation. */
  threshold: "medium" | "high";
  operation: OperationDescriptor;
  disposal?: DisposalDecision;
  /** For removals: whose reserve the removal releases. */
  reserveReleasedTo?: { to: "account" } | { to: "sponsor"; sponsor: string };
  feeEstimateStroops: number;
}

export type TransactionPhase = "cleanup" | "convert" | "merge";

export interface PlannedTransaction {
  index: number;
  phase: TransactionPhase;
  stepIds: string[];
  opCount: number;
  /** Always 0: the closing account never pays a fee (CAP-15 fee bump). */
  innerFeeStroops: 0;
  /** The sponsor's bid: base fee x (operations + 1). The charged fee is usually lower. */
  feeBumpFeeStroops: number;
  reason: string;
}

export interface UnclosableItem {
  code: UnclosableCode;
  subject: StepSubject;
  reason: string;
  remedy: string;
  blocksMerge: true;
  rungsRuledOut?: Array<{ rung: DisposalRung; reason: string }>;
}

export interface Blocker {
  code: BlockerCode;
  reason: string;
  remedy: string;
  /** True when waiting or supplying something (a memo, a wait) can never fix it. */
  permanent: boolean;
}

export interface SequenceGuard {
  sequenceAtMerge: string;
  earliestLedger: number;
  ok: boolean;
  unblocksAtLedger: number | null;
  etaSeconds: number | null;
}

export interface RecoverySummary {
  /** Native balance now plus quoted path-payment proceeds; leaves through the merge. */
  xlmToDestination: string;
  nativeBalance: string;
  quotedProceedsXlm: string;
  reservesReturnedToSponsors: Array<{ sponsor: string; xlm: string; entries: string[] }>;
  feesPaidByAccount: "0";
}

export interface FeeSummary {
  baseFeeStroops: number;
  basis: "fee_stats" | "override";
  maxBaseFeeStroops: number;
  perTransactionStroops: number[];
  totalStroops: number;
  budgetStroops: number;
  withinBudget: boolean;
  /** The fee sponsor's public key when known, otherwise "fee_sponsor". */
  payer: string;
}

export interface ClosePlan {
  schemaVersion: 1;
  kind: "dustin-close-plan";
  network: { passphrase: string; horizon: string };
  account: string;
  destination: string;
  feeSponsor: string | null;
  memo: string | null;
  observed: { ledger: number; closedAt: string };
  /** The account's XLM position when observed; "0.0000000" everywhere for a missing account. */
  reserve: { balance: string; minimum: string; spendable: string; baseReserve: string };
  snapshotHash: string;
  planHash: string;
  status: PlanStatus;
  ladderOrder: LadderOrder;
  steps: CloseStep[];
  transactions: PlannedTransaction[];
  unclosable: UnclosableItem[];
  blockers: Blocker[];
  warnings: string[];
  recovery: RecoverySummary;
  fees: FeeSummary;
  sequenceGuard: SequenceGuard | null;
}

export interface PlanOptions {
  destination: string;
  feeSponsor?: string;
  memo?: string;
  /** Try the destination transfer before the return to issuer (canonical decision 8). */
  preferDestination?: boolean;
  /** Path-payment slippage in basis points; default 100 (1%). */
  slippageBps?: number;
  /** Fee bid override in stroops per operation. */
  baseFeeStroops?: number;
  /** Cap on the fee bid per operation; default 1,000,000 stroops. */
  maxBaseFeeStroops?: number;
  /** Per-close sponsor budget; default 50,000,000 stroops (5 XLM). */
  budgetStroops?: number;
  /** Longest sequence-guard wait the executor may absorb; default 120 ledgers. */
  maxWaitLedgers?: number;
  /** Protocol maximum is 100. */
  maxOpsPerTransaction?: number;
}
