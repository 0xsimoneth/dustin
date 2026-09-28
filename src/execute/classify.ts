import type { ResultCodes } from "./result-codes.js";

export type OperationVerdict = "replan" | "stop";

interface OperationRule {
  verdict: OperationVerdict;
  /** A strict-send sale that failed on the market: rung 1 is dropped for the asset. */
  demoteRung1?: true;
  explanation: string;
}

/**
 * The operation result code mapping of docs/adr/ADR-0006-error-taxonomy.md, keyed by the strings
 * Horizon returns (stellar-horizon `internal/codes/main.go`,
 * https://github.com/stellar/stellar-horizon/blob/main/internal/codes/main.go). The ADR writes
 * `op_not_found` and `op_not_auth_maintain_liabilities`; Horizon spells them `op_offer_not_found`
 * and `op_not_aut_maintain_liabilities`, which is what is matched here. A re-plan code means the
 * ledger differs from the snapshot, so the account is inspected again and the rest is planned from
 * what is there; a stop code needs a person (architecture section 7.1). Any other code stops.
 */
const OPERATION_RULES: Readonly<Record<string, OperationRule>> = {
  op_offer_not_found: {
    verdict: "replan",
    explanation: "The offer no longer exists: it was filled or cancelled after the plan was made.",
  },
  op_underfunded: {
    verdict: "replan",
    explanation:
      "The balance is lower than planned (a clawback, a fill or another payment), so the account is read again.",
  },
  op_src_not_authorized: {
    verdict: "replan",
    explanation: "The issuer no longer authorizes this trustline to send the asset.",
  },
  op_src_no_trust: {
    verdict: "replan",
    explanation: "The account no longer holds the trustline for the asset it was sending.",
  },
  op_no_destination: {
    verdict: "replan",
    explanation: "The payment's destination account does not exist.",
  },
  op_no_trust: {
    verdict: "replan",
    explanation: "The destination holds no trustline for the asset.",
  },
  op_not_authorized: {
    verdict: "replan",
    explanation: "The destination is not authorized to hold the asset.",
  },
  op_line_full: {
    verdict: "replan",
    explanation: "The destination's trustline has no room for the amount.",
  },
  op_too_few_offers: {
    verdict: "replan",
    demoteRung1: true,
    explanation:
      "No path of offers converts the asset to XLM any more, so the sale falls to the next rung of the ladder.",
  },
  op_under_dest_min: {
    verdict: "replan",
    demoteRung1: true,
    explanation:
      "The market moved: the sale would pay less XLM than the slippage bound allows, so it falls to the next rung of the ladder.",
  },
  op_cross_self: {
    verdict: "replan",
    demoteRung1: true,
    explanation:
      "The path would cross one of the account's own offers, so the sale falls to the next rung of the ladder.",
  },
  op_invalid_limit: {
    verdict: "replan",
    explanation:
      "The trustline still holds a balance or buying liabilities, so it cannot be removed yet.",
  },
  op_not_aut_maintain_liabilities: {
    verdict: "replan",
    explanation: "The issuer limited the trustline to maintaining liabilities.",
  },
  op_has_sub_entries: {
    verdict: "replan",
    explanation: "The account still has subentries, so it cannot be merged yet.",
  },
  op_data_name_not_found: {
    verdict: "replan",
    explanation: "The data entry was already removed.",
  },
  op_cannot_delete: {
    verdict: "stop",
    explanation:
      "The trustline is still used by a liquidity pool share trustline (CHANGE_TRUST_CANNOT_DELETE).",
  },
  op_seq_num_too_far: {
    verdict: "stop",
    explanation:
      "The account's sequence number is ahead of the ledger, so the merge is refused until the ledger catches up.",
  },
  op_is_sponsor: {
    verdict: "stop",
    explanation: "The account sponsors reserves of other entries, so it cannot be merged.",
  },
  op_immutable_set: {
    verdict: "stop",
    explanation: "The account has AUTH_IMMUTABLE set and can never be merged.",
  },
  op_no_account: {
    verdict: "stop",
    explanation: "The merge destination does not exist.",
  },
  op_dest_full: {
    verdict: "stop",
    explanation: "The destination cannot receive the merged XLM.",
  },
  op_malformed: {
    verdict: "stop",
    explanation: "An operation is malformed.",
  },
  op_low_reserve: {
    verdict: "stop",
    explanation:
      "An operation needed more reserve; closing only removes entries, so this points to a bug.",
  },
  op_bad_auth: {
    verdict: "stop",
    explanation: "An operation lacks the signatures its threshold needs.",
  },
};

export interface OperationFailure {
  /** Index of the first operation that did not succeed; later ones may only echo it. */
  index: number;
  code: string;
  verdict: OperationVerdict;
  /** Rung 1 is marked non-viable for the asset, so the re-plan falls down the ladder. */
  demoteRung1: boolean;
  explanation: string;
}

/** The first failed operation of an included transaction and what to do about it. */
export function operationFailure(codes: ResultCodes): OperationFailure | null {
  const index = (codes.operations ?? []).findIndex((code) => code !== "op_success");
  if (index < 0) return null;
  const code = codes.operations![index]!;
  const rule = OPERATION_RULES[code];
  return {
    index,
    code,
    verdict: rule?.verdict ?? "stop",
    demoteRung1: rule?.demoteRung1 === true,
    explanation:
      rule?.explanation ??
      `The result code ${code} is not in Dustin's mapping (docs/adr/ADR-0006-error-taxonomy.md), so the run stops rather than guess.`,
  };
}

const TRANSACTION_EXPLANATIONS: Readonly<Record<string, string>> = {
  tx_failed:
    "An operation failed: nothing in the transaction applied, but its sequence number and fee were consumed.",
  tx_too_late: "The transaction's time bound passed before it was included.",
  tx_too_early: "The transaction's time bounds have not started yet.",
  tx_bad_seq:
    "The sequence number no longer matches the account: another transaction used it or it moved on.",
  tx_insufficient_fee:
    "The fee bid is below what the network charges right now (surge pricing), so it was not queued.",
  tx_bad_auth: "A required signature is missing or wrong.",
  tx_bad_auth_extra: "The transaction carries a signature it does not need.",
  tx_insufficient_balance: "The fee sponsor cannot pay the fee.",
  tx_no_source_account: "The source account does not exist.",
  tx_malformed: "The transaction is malformed.",
  tx_missing_operation: "The transaction has no operation.",
  tx_internal_error: "stellar-core reported an internal error.",
  tx_not_supported: "The network does not support this transaction type.",
  tx_bad_sponsorship: "A sponsorship in the transaction is not closed.",
};

export type Rejection =
  | { action: "rebuild"; reason: string }
  | { action: "raise-fee"; reason: string }
  | { action: "resequence"; reason: string }
  | { action: "source-missing"; reason: string }
  | { action: "backoff"; reason: string }
  | { action: "stop"; reason: string };

/**
 * What to do with an envelope that was refused before inclusion (nothing consumed), following
 * architecture section 7.1 and ADR-0006: a 429 is retried as is after a pause; `tx_too_late` is
 * rebuilt for the same sequence number with fresh time bounds; `tx_insufficient_fee` is rebuilt
 * with a higher bid; `tx_bad_seq` re-reads the account's sequence number; an inner
 * `tx_no_source_account` (the closing account is gone, perhaps merged by an earlier envelope of the
 * same transaction) looks for that envelope; anything else stops. A fee bump reports the inner
 * transaction's refusal as `tx_fee_bump_inner_failed` plus the inner code; at the outer level
 * `tx_no_source_account` names the fee sponsor, which stops.
 */
export function rejectionAction(outcome: { status: number; codes: ResultCodes }): Rejection {
  const { codes } = outcome;
  const has = (code: string) => codes.transaction === code || codes.innerTransaction === code;
  const reason = explainCodes(codes, outcome.status);
  if (outcome.status === 429) return { action: "backoff", reason };
  if (has("tx_too_late")) return { action: "rebuild", reason };
  if (has("tx_insufficient_fee")) return { action: "raise-fee", reason };
  if (has("tx_bad_seq")) return { action: "resequence", reason };
  if (codes.innerTransaction === "tx_no_source_account")
    return { action: "source-missing", reason };
  return { action: "stop", reason };
}

/**
 * Transaction-level codes of a fee bump that was included in a ledger (fee charged) while its
 * inner transaction failed before any operation ran (review round 3, R3-9): the refusal wording
 * above ("before it was included") would be wrong for them.
 */
const INCLUDED_EXPLANATIONS: Readonly<Record<string, string>> = {
  tx_too_late:
    "Included in a ledger that closed after the inner transaction's time bound, so it failed before any operation ran; nothing of it applied, its sequence number and fee were spent.",
  tx_bad_seq:
    "Included, but the inner sequence number no longer matched when the ledger applied it, so it failed before any operation ran; nothing of it applied, the fee was spent.",
};

/**
 * One human sentence for a set of result codes, led by the codes themselves. `included` says the
 * transaction was found in a ledger (it failed there), so the sentence never calls it refused.
 */
export function explainCodes(codes: ResultCodes, httpStatus?: number, included = false): string {
  const listed = [
    codes.transaction,
    codes.innerTransaction,
    codes.operations?.length ? codes.operations.join(", ") : undefined,
  ].filter((part): part is string => Boolean(part));
  if (listed.length === 0) {
    if (included) {
      return "Included in a ledger and failed, but its result could not be read, so which operation failed is not known; nothing of it applied, its sequence number and fee were spent.";
    }
    if (httpStatus === 429) {
      return "HTTP 429: Horizon's rate limit refused the request; nothing was submitted.";
    }
    return `HTTP ${httpStatus ?? "?"}: Horizon refused the envelope without result codes; nothing was submitted.`;
  }
  const failure = operationFailure(codes);
  const inner = codes.innerTransaction ?? codes.transaction ?? "";
  const meaning =
    failure?.explanation ??
    (included ? INCLUDED_EXPLANATIONS[inner] : undefined) ??
    TRANSACTION_EXPLANATIONS[inner] ??
    TRANSACTION_EXPLANATIONS[codes.transaction ?? ""] ??
    "See the result codes.";
  return `${listed.join(" / ")}: ${meaning}`;
}
