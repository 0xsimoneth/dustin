import { readFileSync } from "node:fs";
import { xdr } from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";
import {
  feeChargedFromResultXdr,
  HORIZON_OPERATION_CODES,
  HORIZON_TRANSACTION_CODES,
  resultCodesFromXdr,
} from "../../../src/execute/result-codes.js";

/**
 * `result_xdr` of four fee bumps that failed on testnet during the day-1 experiments, read with
 * `GET https://horizon-testnet.stellar.org/transactions/{hash}` on 2026-09-26. When they were
 * submitted, Horizon answered with `extras.result_codes`, recorded in
 * docs/research/day1-experiments-2026-09-26.json; the decoder must reproduce those strings.
 */
const FAILED = {
  // Experiment 5: merge while the sequence number is ahead of the ledger (ledger 4874035).
  "1d13837c133ce2fa2518a876c19cd6ae5b79fc54d26c9e453dfa155fbf5f8ebb":
    "AAAAAAAAAMj////zfU2t/R/yDpMCqbrww6W6leQYvC+W4hfExzqE/XEpyJUAAAAAAAAAAP////8AAAABAAAAAAAAAAj////7AAAAAAAAAAA=",
  // Experiment 4: a new trustline to a merged issuer (ledger 4874052).
  "571db84a8c10b79628224c72999f56f730593e85c6f39e095da33a3e41ee0f91":
    "AAAAAAAAAMj////zkDLXJyCUj+O6SiFZhpNRavalE+MDFOFinjmWQdJraaMAAAAAAAAAAP////8AAAABAAAAAAAAAAb////+AAAAAAAAAAA=",
  // Experiment 13: a payment from a deauthorized trustline (ledger 4874054).
  a50947b27138d1cc9f0885b5ce5699d75c58f05386b30206c600b0099d26c6da:
    "AAAAAAAAAMj////zBe9z+nMBsi+QW/p0aAg2qI+sDW6DxTmBsLGsDhdsLhgAAAAAAAAAAP////8AAAABAAAAAAAAAAH////8AAAAAAAAAAA=",
  // Experiment 13: removing a trustline that still holds a balance (ledger 4874055).
  "6439bd9d2d7f107769b4ff1733062f83e7d12e468a0829c35c2e983e81baec73":
    "AAAAAAAAAMj////zhfbLV2B8mAlqHfycU/Ovo4XZS7qgiTRnSRSJF/JjAcQAAAAAAAAAAP////8AAAABAAAAAAAAAAb////9AAAAAAAAAAA=",
} as const;

// The day-1 fee-bumped changeTrust + accountMerge that succeeded (d095ceb9..., ledger 4874044).
const MERGE_SUCCESS =
  "AAAAAAAAASwAAAABcvugOt2ri2+SadyJqn10hq1DifXsFY37khyOXuW1HZQAAAAAAAAAAAAAAAAAAAACAAAAAAAAAAYAAAAAAAAAAAAAAAgAAAAAAAAAAAHJw4cAAAAAAAAAAA==";

interface Recorded {
  hash?: string;
  result_codes?: { transaction?: string; inner_transaction?: string; operations?: string[] };
}

/** Every object in the day-1 record that carries a hash and the codes Horizon returned for it. */
function recordedCodes(): Map<string, Recorded["result_codes"]> {
  const json: unknown = JSON.parse(
    readFileSync("docs/research/day1-experiments-2026-09-26.json", "utf8"),
  );
  const found = new Map<string, Recorded["result_codes"]>();
  const walk = (value: unknown) => {
    if (value === null || typeof value !== "object") return;
    const r = value as Recorded;
    if (typeof r.hash === "string" && r.result_codes) found.set(r.hash, r.result_codes);
    for (const child of Object.values(value)) walk(child);
  };
  walk(json);
  return found;
}

describe("resultCodesFromXdr", () => {
  it("reproduces the codes Horizon returned for real testnet failures", () => {
    const recorded = recordedCodes();
    for (const [hash, resultXdr] of Object.entries(FAILED)) {
      const horizon = recorded.get(hash);
      expect(horizon, hash).toBeDefined();
      expect(resultCodesFromXdr(resultXdr)).toEqual({
        transaction: horizon!.transaction,
        innerTransaction: horizon!.inner_transaction,
        operations: horizon!.operations,
      });
    }
    expect(
      resultCodesFromXdr(
        FAILED["1d13837c133ce2fa2518a876c19cd6ae5b79fc54d26c9e453dfa155fbf5f8ebb"],
      ),
    ).toEqual({
      transaction: "tx_fee_bump_inner_failed",
      innerTransaction: "tx_failed",
      operations: ["op_seq_num_too_far"],
    });
  });

  it("decodes a successful fee bump", () => {
    expect(resultCodesFromXdr(MERGE_SUCCESS)).toEqual({
      transaction: "tx_fee_bump_inner_success",
      innerTransaction: "tx_success",
      operations: ["op_success", "op_success"],
    });
  });

  it("returns null for anything that is not a transaction result", () => {
    expect(resultCodesFromXdr("")).toBeNull();
    expect(resultCodesFromXdr("not xdr")).toBeNull();
  });

  it("reads the fee charged to the fee account", () => {
    expect(
      feeChargedFromResultXdr(
        FAILED["a50947b27138d1cc9f0885b5ce5699d75c58f05386b30206c600b0099d26c6da"],
      ),
    ).toBe(200);
    expect(feeChargedFromResultXdr(MERGE_SUCCESS)).toBe(300);
    expect(feeChargedFromResultXdr("")).toBeNull();
  });
});

describe("Horizon code names", () => {
  // The strings stellar-horizon returns, copied from internal/codes/main.go
  // (https://github.com/stellar/stellar-horizon/blob/main/internal/codes/main.go, commit 51fd177 of
  // 2026-03-16). Note the Horizon spellings op_offer_not_found and op_not_aut_maintain_liabilities.
  const expected: Record<string, Record<string, string>> = {
    TransactionResultCode: {
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
    },
    OperationResultCode: {
      opBadAuth: "op_bad_auth",
      opNoAccount: "op_no_source_account",
      opNotSupported: "op_not_supported",
      opTooManySubentries: "op_too_many_subentries",
      opExceededWorkLimit: "op_exceeded_work_limit",
      opTooManySponsoring: "op_too_many_sponsoring",
    },
    ManageSellOfferResultCode: {
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
    },
    PathPaymentStrictSendResultCode: {
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
    },
    PaymentResultCode: {
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
    },
    ChangeTrustResultCode: {
      changeTrustSuccess: "op_success",
      changeTrustMalformed: "op_malformed",
      changeTrustNoIssuer: "op_no_issuer",
      changeTrustInvalidLimit: "op_invalid_limit",
      changeTrustLowReserve: "op_low_reserve",
      changeTrustSelfNotAllowed: "op_self_not_allowed",
      changeTrustTrustLineMissing: "op_trust_line_missing",
      changeTrustCannotDelete: "op_cannot_delete",
      changeTrustNotAuthMaintainLiabilities: "op_not_aut_maintain_liabilities",
    },
    ManageDataResultCode: {
      manageDataSuccess: "op_success",
      manageDataNotSupportedYet: "op_not_supported_yet",
      manageDataNameNotFound: "op_data_name_not_found",
      manageDataLowReserve: "op_low_reserve",
      manageDataInvalidName: "op_data_invalid_name",
    },
    AccountMergeResultCode: {
      accountMergeSuccess: "op_success",
      accountMergeMalformed: "op_malformed",
      accountMergeNoAccount: "op_no_account",
      accountMergeImmutableSet: "op_immutable_set",
      accountMergeHasSubEntries: "op_has_sub_entries",
      accountMergeSeqnumTooFar: "op_seq_num_too_far",
      accountMergeDestFull: "op_dest_full",
      accountMergeIsSponsor: "op_is_sponsor",
    },
  };

  it("maps every member of the SDK's result enums for the operations Dustin submits", () => {
    const mapped: Record<string, string> = {
      ...HORIZON_TRANSACTION_CODES,
      ...HORIZON_OPERATION_CODES,
    };
    for (const [enumName, names] of Object.entries(expected)) {
      const schema = (
        xdr as unknown as Record<string, { schema: { nameByValue: ReadonlyMap<number, string> } }>
      )[enumName]!.schema;
      const members = [...schema.nameByValue.values()].filter((n) => n !== "opInner");
      expect(members.sort(), enumName).toEqual(Object.keys(names).sort());
      for (const member of members) expect(mapped[member], member).toBe(names[member]);
    }
  });
});
