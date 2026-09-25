# ADR-0006: Error taxonomy and unclosable reasons

- Status: Accepted
- Date: 2026-09-25
- Deciders: the builder (system architect role)
- Related: `docs/architecture.md` sections 4.4, 4.7, 5.3, 7; ADR-0005

## Context

Integrators branch on errors; reviewers read them. The SOW wants "unclosable with a stated reason" per balance and "retry and failure recovery" in the executor. Horizon exposes failures as `extras.result_codes.transaction`, `.inner_transaction` and `.operations` (https://github.com/stellar/go/blob/master/protocols/horizon/main.go) plus HTTP statuses (429, 504). Those strings are the ground truth but are the wrong API for an integrator: they mix transport, transaction and operation levels and say nothing about what to do next.

## Decision

### One base class

```ts
class DustinError extends Error {
  code: DustinErrorCode;          // stable string, see tables
  stage: "config" | "inspect" | "plan" | "build" | "sponsor" | "submit" | "confirm" | "merge";
  retryable: boolean;             // safe to retry the same action without changes
  verdict: "retry-same" | "rebuild-same-sequence" | "replan" | "stop";
  horizon?: { status?: number; transaction?: string; innerTransaction?: string; operations?: string[]; hash?: string };
  details?: Record<string, string | number | boolean | null>;   // JSON-safe, secrets redacted
  remedy?: string;                // one sentence a human can act on
}
```

Plans and reports never throw for expected conditions; they carry `blockers[]` and `unclosable[]` entries using the same codes, so the CLI, the SDK and the tests speak one vocabulary.

### Codes by stage

| Stage | Code | Meaning | Verdict |
|---|---|---|---|
| config | `MAINNET_REFUSED` | passphrase or Horizon URL is not testnet | stop |
| config | `MISSING_SPONSOR_SECRET`, `MISSING_ACCOUNT_SECRET`, `SECRET_IN_ARGV` | secrets absent or passed unsafely | stop |
| config | `UNSUPPORTED_NODE` | Node below 22.12 | stop |
| inspect | `ACCOUNT_NOT_FOUND` | `GET /accounts/{id}` 404 (already merged, or never funded) | stop |
| inspect | `HORIZON_UNAVAILABLE` | 5xx or network error on reads | retry-same (backoff), then stop |
| inspect | `RATE_LIMITED` | 429 | retry-same (backoff) |
| plan (blockers) | `AUTH_IMMUTABLE_SET` | account flag prevents merge (`ACCOUNT_MERGE_IMMUTABLE_SET`) | stop (permanent) |
| plan (blockers) | `IS_SPONSOR` | `num_sponsoring > 0`, incl. sponsored claimable balances (`ACCOUNT_MERGE_IS_SPONSOR`) | stop (out of scope) |
| plan (blockers) | `LP_SHARES_HELD` | pool-share balance > 0; constituent trustlines blocked (`CHANGE_TRUST_CANNOT_DELETE`) | stop (out of scope) |
| plan (blockers) | `RAISED_THRESHOLDS`, `MASTER_KEY_DISABLED` | supplied signers cannot reach medium or high threshold | stop (out of scope) |
| plan (blockers) | `DESTINATION_MISSING`, `DESTINATION_IS_SELF`, `DESTINATION_INVALID` | merge target problems (`ACCOUNT_MERGE_NO_ACCOUNT`, `ACCOUNT_MERGE_MALFORMED`, `C...` or malformed address) | stop |
| plan (blockers) | `DESTINATION_REQUIRES_MEMO` | SEP-29 marker present, no memo supplied | stop until memo supplied |
| plan (blockers) | `SEQNUM_TOO_FAR` | guard fails; carries `unblocksAtLedger`, `etaSeconds` | wait or stop |
| plan (blockers) | `UNCLOSABLE_BALANCE` | at least one balance exits at rung 4 | partial run allowed, merge not attempted |
| build | `TOO_MANY_OPERATIONS` | planner handed more than 100 operations (defence in depth) | stop |
| sponsor | `SPONSOR_BUDGET_EXCEEDED`, `SPONSOR_UNDERFUNDED`, `SPONSOR_REFUSED_FOREIGN_TX` | budget cap, sponsor balance below fee plus its minimum balance, inner hash not built in this run | stop |
| submit | `SUBMIT_TIMEOUT` | Horizon 504 | retry-same by polling hash until time bound expiry, then rebuild-same-sequence |
| submit | `TX_EXPIRED` | `tx_too_late` | rebuild-same-sequence |
| submit | `TX_INSUFFICIENT_FEE` | `tx_insufficient_fee` (surge) | rebuild-same-sequence with escalated fee, within caps |
| submit | `TX_BAD_SEQ` | `tx_bad_seq` | poll by hash; if applied, continue; else replan |
| submit | `TX_BAD_AUTH` | `tx_bad_auth`, `tx_bad_auth_extra` | stop (signer set wrong) |
| submit | `TX_MEMO_REQUIRED` | SDK `AccountRequiresMemoError` | stop until memo supplied |
| submit | `INNER_OP_FAILED` | `tx_fee_bump_inner_failed` with operation codes; sub-classified by the mapping below | replan or stop per mapping |
| confirm | `CONFIRM_LOST` | transaction neither found nor failed after time bound expiry plus one ledger | rebuild-same-sequence |
| merge | `MERGE_PREFLIGHT_FAILED` | subentries, sponsorship, immutability, destination or guard changed since the plan | replan |

### Operation result code mapping (Horizon `operations[]` strings)

| Horizon code(s) | Stellar result | Sub-code | Verdict |
|---|---|---|---|
| `op_not_found` (manage offer) | `MANAGE_SELL_OFFER_NOT_FOUND` | `OFFER_GONE` (filled or cancelled meanwhile) | replan |
| `op_underfunded` | `PAYMENT_UNDERFUNDED`, `PATH_PAYMENT_STRICT_SEND_UNDERFUNDED` | `BALANCE_CHANGED` (clawback, fill) | replan |
| `op_src_not_authorized` | `*_SRC_NOT_AUTHORIZED` | `ISSUER_DEAUTHORIZED` | replan (asset moves to a later rung or rung 4) |
| `op_no_destination` | `PAYMENT_NO_DESTINATION` | `ISSUER_MISSING` / `DEST_MISSING` | replan |
| `op_no_trust`, `op_not_authorized`, `op_line_full` | destination-side payment failures | `DEST_NO_TRUSTLINE`, `DEST_NOT_AUTHORIZED`, `DEST_LINE_FULL` | replan |
| `op_too_few_offers`, `op_under_dest_min` | `PATH_PAYMENT_STRICT_SEND_TOO_FEW_OFFERS`, `_UNDER_DESTMIN` | `NO_PATH`, `SLIPPAGE_EXCEEDED` | replan (rung 1 marked non-viable) |
| `op_cross_self` | `PATH_PAYMENT_STRICT_SEND_OFFER_CROSS_SELF` | `OWN_OFFER_PRESENT` (ordering violated by external change) | replan |
| `op_invalid_limit` | `CHANGE_TRUST_INVALID_LIMIT` | `BALANCE_OR_LIABILITIES_REMAIN` | replan |
| `op_cannot_delete` | `CHANGE_TRUST_CANNOT_DELETE` | `LP_REFERENCE` | stop (blocker) |
| `op_not_auth_maintain_liabilities` | `CHANGE_TRUST_NOT_AUTH_MAINTAIN_LIABILITIES` | `TRUSTLINE_DEAUTHORIZED` | replan |
| `op_has_sub_entries` | `ACCOUNT_MERGE_HAS_SUB_ENTRIES` | `SUBENTRIES_REMAIN` | replan |
| `op_seq_num_too_far` | `ACCOUNT_MERGE_SEQNUM_TOO_FAR` | `SEQNUM_TOO_FAR` | wait then retry merge, or stop with ETA |
| `op_is_sponsor` | `ACCOUNT_MERGE_IS_SPONSOR` | `IS_SPONSOR` | stop |
| `op_immutable_set` | `ACCOUNT_MERGE_IMMUTABLE_SET` | `AUTH_IMMUTABLE_SET` | stop |
| `op_no_account`, `op_dest_full`, `op_malformed` | merge destination failures | `DEST_MISSING`, `DEST_FULL`, `DEST_INVALID` | stop |
| `op_low_reserve` | any `*_LOW_RESERVE` | `LOW_RESERVE` (should not occur: closing only removes entries) | stop, report as bug |
| `op_bad_auth` | operation-level signature problem | `OP_BAD_AUTH` | stop |

Codes are copied from the Horizon result-code pages and the list of operations (https://developers.stellar.org/docs/data/apis/horizon/api-reference/errors/result-codes/operation-specific/account-merge, https://developers.stellar.org/docs/data/apis/horizon/api-reference/errors/result-codes/operation-specific/change-trust, https://developers.stellar.org/docs/learn/fundamentals/transactions/list-of-operations). Any unmapped code becomes `INNER_OP_FAILED` with verdict `stop` and the raw strings attached; the test suite fails if a code appears in a recorded fixture without a mapping.

### Unclosable reasons (per balance, rung 4)

An `unclosable[]` entry lists the reason from every rung it tried, so the user sees why nothing worked:

| Reason code | Rung | Condition |
|---|---|---|
| `NO_PATH` | 1 | Horizon returned no strict-send path to XLM, or the quote is below one stroop |
| `SLIPPAGE_EXCEEDED` | 1 | execution failed `UNDER_DESTMIN` after a re-plan |
| `NOT_AUTHORIZED` | 1, 2, 3 | trustline is not authorized; the holder cannot send at all |
| `MAINTAIN_LIABILITIES_ONLY` | 1, 2, 3 | trustline may keep offers but cannot send (CAP-0018) |
| `ISSUER_MISSING` | 2 | issuer account does not exist |
| `ISSUER_REQUIRES_MEMO` | 2 | SEP-29 marker on the issuer and no memo supplied |
| `DEST_NO_TRUSTLINE`, `DEST_NOT_AUTHORIZED`, `DEST_LINE_FULL` | 3 | destination cannot receive the asset |
| `LP_SHARE_BALANCE` | n/a | pool shares are never disposed (out of scope) |

Every entry carries `remedy`, for example: "Ask the issuer G... to authorize the trustline (setTrustLineFlags) or to claw the balance back; then rerun."

### Logging and redaction

Every error path passes through `redact()`; `details` never contain XDR of signed envelopes with secrets (envelopes contain only signatures, which are safe), and never contain seeds. `--json` output includes `code`, `stage`, `verdict`, `horizon` and `remedy`.

## Consequences

- Integrators can implement "retry, wait, ask the user, give up" with a `switch` on `verdict` and show `remedy` verbatim.
- The mapping table is data, tested row by row, and extended when a new code is observed.
- The taxonomy is the contract between the executor's state machine and the rest of the system; the state machine never inspects raw Horizon strings.

## Alternatives considered

- **Surface raw Horizon errors.** Rejected: three levels of codes, no verdict, unusable from a wallet.
- **Boolean `retryable` only.** Rejected: "rebuild with the same sequence" and "re-plan" are different actions with different safety arguments.

## Sources

- Horizon result-code struct: https://github.com/stellar/go/blob/master/protocols/horizon/main.go
- Horizon result codes (account merge, change trust): https://developers.stellar.org/docs/data/apis/horizon/api-reference/errors/result-codes/operation-specific/account-merge and https://developers.stellar.org/docs/data/apis/horizon/api-reference/errors/result-codes/operation-specific/change-trust
- List of operations (result codes and meanings): https://developers.stellar.org/docs/learn/fundamentals/transactions/list-of-operations
- Horizon timeout (504): https://developers.stellar.org/docs/data/apis/horizon/api-reference/errors/http-status-codes/horizon-specific/timeout
- Horizon rate limiting (429): https://developers.stellar.org/docs/data/apis/horizon/api-reference/structure/rate-limiting
- JS SDK `AccountRequiresMemoError` and `submitTransaction`: https://github.com/stellar/js-stellar-sdk/blob/main/src/horizon/server.ts
- CAP-0018 (maintain liabilities): https://github.com/stellar/stellar-protocol/blob/master/core/cap-0018.md
- SEP-0029: https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0029.md
