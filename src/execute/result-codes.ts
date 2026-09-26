import { xdr } from "@stellar/stellar-sdk";

/** Horizon's `extras.result_codes`, camel-cased: transaction, inner transaction, operations. */
export interface ResultCodes {
  transaction?: string;
  innerTransaction?: string;
  operations?: string[];
}

/*
 * The strings Horizon uses for result codes, keyed by the discriminant the SDK gives each XDR enum
 * member when it decodes a result (SDK 17.1.0 `lib/esm/xdr/generated/*-result-code.js`). Copied
 * from stellar-horizon `internal/codes/main.go`
 * (https://github.com/stellar/stellar-horizon/blob/main/internal/codes/main.go, commit 51fd177 of
 * 2026-03-16), which is what `POST /transactions` answers with. Mind Horizon's own spellings:
 * `op_offer_not_found`, `op_not_aut_maintain_liabilities`, `sell_not_authorized`.
 */

/** Transaction result codes. */
export const HORIZON_TRANSACTION_CODES: Readonly<Record<string, string>> = {
  txFeeBumpInnerSuccess: "tx_fee_bump_inner_success",
  txFeeBumpInnerFailed: "tx_fee_bump_inner_failed",
  txNotSupported: "tx_not_supported",
  txSuccess: "tx_success",
  txFailed: "tx_failed",
  txTooEarly: "tx_too_early",
  txTooLate: "tx_too_late",
  txMissingOperation: "tx_missing_operation",
  txBadSeq: "tx_bad_seq",
  txBadAuth: "tx_bad_auth",
  txInsufficientBalance: "tx_insufficient_balance",
  txNoAccount: "tx_no_source_account",
  txInsufficientFee: "tx_insufficient_fee",
  txBadAuthExtra: "tx_bad_auth_extra",
  txInternalError: "tx_internal_error",
  txBadSponsorship: "tx_bad_sponsorship",
  txBadMinSeqAgeOrGap: "tx_bad_minseq_age_or_gap",
  txMalformed: "tx_malformed",
  txSorobanInvalid: "tx_soroban_invalid",
  txFrozenKeyAccessed: "tx_frozen_key_accessed",
};

/**
 * Operation result codes: the generic ones (the operation did not run) and those of every
 * operation Dustin submits (manageSellOffer, pathPaymentStrictSend, payment, changeTrust,
 * manageData, accountMerge).
 */
export const HORIZON_OPERATION_CODES: Readonly<Record<string, string>> = {
  opBadAuth: "op_bad_auth",
  opNoAccount: "op_no_source_account",
  opNotSupported: "op_not_supported",
  opTooManySubentries: "op_too_many_subentries",
  opExceededWorkLimit: "op_exceeded_work_limit",
  opTooManySponsoring: "op_too_many_sponsoring",

  manageSellOfferSuccess: "op_success",
  manageSellOfferMalformed: "op_malformed",
  manageSellOfferSellNoTrust: "op_sell_no_trust",
  manageSellOfferBuyNoTrust: "op_buy_no_trust",
  manageSellOfferSellNotAuthorized: "sell_not_authorized",
  manageSellOfferBuyNotAuthorized: "buy_not_authorized",
  manageSellOfferLineFull: "op_line_full",
  manageSellOfferUnderfunded: "op_underfunded",
  manageSellOfferCrossSelf: "op_cross_self",
  manageSellOfferSellNoIssuer: "op_sell_no_issuer",
  manageSellOfferBuyNoIssuer: "buy_no_issuer",
  manageSellOfferNotFound: "op_offer_not_found",
  manageSellOfferLowReserve: "op_low_reserve",

  pathPaymentStrictSendSuccess: "op_success",
  pathPaymentStrictSendMalformed: "op_malformed",
  pathPaymentStrictSendUnderfunded: "op_underfunded",
  pathPaymentStrictSendSrcNoTrust: "op_src_no_trust",
  pathPaymentStrictSendSrcNotAuthorized: "op_src_not_authorized",
  pathPaymentStrictSendNoDestination: "op_no_destination",
  pathPaymentStrictSendNoTrust: "op_no_trust",
  pathPaymentStrictSendNotAuthorized: "op_not_authorized",
  pathPaymentStrictSendLineFull: "op_line_full",
  pathPaymentStrictSendNoIssuer: "op_no_issuer",
  pathPaymentStrictSendTooFewOffers: "op_too_few_offers",
  pathPaymentStrictSendOfferCrossSelf: "op_cross_self",
  pathPaymentStrictSendUnderDestmin: "op_under_dest_min",

  paymentSuccess: "op_success",
  paymentMalformed: "op_malformed",
  paymentUnderfunded: "op_underfunded",
  paymentSrcNoTrust: "op_src_no_trust",
  paymentSrcNotAuthorized: "op_src_not_authorized",
  paymentNoDestination: "op_no_destination",
  paymentNoTrust: "op_no_trust",
  paymentNotAuthorized: "op_not_authorized",
  paymentLineFull: "op_line_full",
  paymentNoIssuer: "op_no_issuer",

  changeTrustSuccess: "op_success",
  changeTrustMalformed: "op_malformed",
  changeTrustNoIssuer: "op_no_issuer",
  changeTrustInvalidLimit: "op_invalid_limit",
  changeTrustLowReserve: "op_low_reserve",
  changeTrustSelfNotAllowed: "op_self_not_allowed",
  changeTrustTrustLineMissing: "op_trust_line_missing",
  changeTrustCannotDelete: "op_cannot_delete",
  changeTrustNotAuthMaintainLiabilities: "op_not_aut_maintain_liabilities",

  manageDataSuccess: "op_success",
  manageDataNotSupportedYet: "op_not_supported_yet",
  manageDataNameNotFound: "op_data_name_not_found",
  manageDataLowReserve: "op_low_reserve",
  manageDataInvalidName: "op_data_invalid_name",

  accountMergeSuccess: "op_success",
  accountMergeMalformed: "op_malformed",
  accountMergeNoAccount: "op_no_account",
  accountMergeImmutableSet: "op_immutable_set",
  accountMergeHasSubEntries: "op_has_sub_entries",
  accountMergeSeqnumTooFar: "op_seq_num_too_far",
  accountMergeDestFull: "op_dest_full",
  accountMergeIsSponsor: "op_is_sponsor",
};

/** SDK 17.1.0 decodes an XDR union as an object with a `type` discriminant and its arm. */
interface Union {
  type: string;
  [key: string]: unknown;
}

function decode(resultXdr: string): { feeCharged: bigint; result: Union } | null {
  if (!resultXdr) return null;
  try {
    return xdr.TransactionResult.fromXDR(resultXdr, "base64") as unknown as {
      feeCharged: bigint;
      result: Union;
    };
  } catch {
    return null;
  }
}

const transactionCode = (type: string) => HORIZON_TRANSACTION_CODES[type] ?? type;

/** An operation's code: the generic one, or the operation-specific one inside `opInner`. */
function operationCode(op: Union): string {
  if (op.type !== "opInner") return HORIZON_OPERATION_CODES[op.type] ?? op.type;
  const tr = op.tr as Union;
  // The arm next to the operation type holds the operation's own result union.
  const arm = Object.entries(tr).find(([key]) => key !== "type")?.[1] as Union | undefined;
  const name = arm?.type ?? tr.type;
  // Operations Dustin never submits keep the SDK's discriminant, so nothing is lost.
  return HORIZON_OPERATION_CODES[name] ?? name;
}

function operations(result: Union): Pick<ResultCodes, "operations"> {
  return Array.isArray(result.results)
    ? { operations: (result.results as Union[]).map(operationCode) }
    : {};
}

/**
 * The Horizon result codes of a transaction result. `POST /transactions` returns them as
 * `extras.result_codes`, but a transaction found later with `GET /transactions/{hash}` (after a 504)
 * carries only `result_xdr`, so they are rebuilt from it (review finding R11). For a fee bump the
 * inner transaction's code decides what happened: `tx_failed` means it was included and failed.
 */
export function resultCodesFromXdr(resultXdr: string): ResultCodes | null {
  const decoded = decode(resultXdr);
  if (!decoded) return null;
  const outer = decoded.result;
  if (outer.type === "txFeeBumpInnerSuccess" || outer.type === "txFeeBumpInnerFailed") {
    const inner = (outer.innerResultPair as { result: { result: Union } }).result.result;
    return {
      transaction: transactionCode(outer.type),
      innerTransaction: transactionCode(inner.type),
      ...operations(inner),
    };
  }
  return { transaction: transactionCode(outer.type), ...operations(outer) };
}

/** The fee charged to the fee account, in stroops, from a transaction result. */
export function feeChargedFromResultXdr(resultXdr: string): number | null {
  const decoded = decode(resultXdr);
  return decoded ? Number(decoded.feeCharged) : null;
}
