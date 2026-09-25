# Raven ground truth for Dustin

Protocol facts verified through the Raven MCP (stellar-raven) against developers.stellar.org and the stellar-protocol CAP repository. Every item carries its source URL. Volatile values are dated as of 2026-09-25. Items marked "unverified" still need a primary-source check before they are relied on in code.

## 1. Account merge preconditions

Source: https://developers.stellar.org/docs/learn/fundamentals/transactions/list-of-operations#account-merge

- A source account can only be merged once it holds **no non-signer subentries**: trustlines, offers and data entries must be removed first.
- **Signers are not a blocker.** Signers, including sponsored signers, are removed automatically during the merge.
- **Sponsorship blocks a merge** (`ACCOUNT_MERGE_IS_SPONSOR`) in two distinct cases: (1) the account is sponsoring reserves for other accounts (`numSponsoring > 0`), remedy: revoke those sponsorships first; (2) the account has an open is-sponsoring-future-reserves relationship earlier in the same transaction, remedy: end it with `EndSponsoringFutureReserves` before the merge.
- **Merely being sponsored by another account does not block a merge.**
- Threshold: **High**.

Result codes (https://developers.stellar.org/docs/data/apis/horizon/api-reference/errors/result-codes/operation-specific/account-merge):

| Code | Meaning |
|---|---|
| `ACCOUNT_MERGE_MALFORMED` | Source cannot merge with itself; destination must differ. |
| `ACCOUNT_MERGE_NO_ACCOUNT` | Destination account does not exist. |
| `ACCOUNT_MERGE_IMMUTABLE_SET` | Source has `AUTH_IMMUTABLE` flag set. |
| `ACCOUNT_MERGE_HAS_SUB_ENTRIES` | Source still has subentries. |
| `ACCOUNT_MERGE_SEQNUM_TOO_FAR` | Source sequence number is >= currentLedgerSeq << 32 (verified in section 6). |
| `ACCOUNT_MERGE_DEST_FULL` | Destination cannot receive the balance. |
| `ACCOUNT_MERGE_IS_SPONSOR` | Source is sponsoring reserves. |

## 2. Fee-bump transactions (CAP-15)

Sources: https://developers.stellar.org/docs/build/guides/transactions/fee-bump-transactions and https://github.com/stellar/stellar-protocol/blob/master/core/cap-0015.md

- A fee-bump transaction wraps an already-signed inner transaction envelope in an outer envelope signed by the **fee account**. The inner transaction is not re-signed and its sequence numbers are untouched.
- The fee account pays the fee **instead of** the inner source account. **The sequence number is still taken from the inner source account.** This is exactly what lets a zero-XLM account submit work: it supplies the sequence number and signature, the sponsor supplies the fee.
- Fee attribute: the maximum per-operation fee. The fee-bump itself counts as one operation, so total operations = inner operations + 1.
- Validity: the fee account must exist; the fee must be at least the network minimum fee for (inner ops + 1) operations; the fee must be at least the fee specified in the inner transaction (CAP-15: the fee **rate** of the outer transaction must be at least the fee rate of the inner one, otherwise `txINSUFFICIENT_FEE`).
- Replace-by-fee: a second transaction with the same source and sequence number replaces the first in the queue only if its fee bid is **10x** the first.
- The inner transaction's sequence number is **always consumed at apply time**, even if the inner transaction fails. Every fee-bump result contains the complete inner transaction result. Consequence for Dustin: a failed inner transaction still burns the sequence number, so the executor must re-read the account sequence before every retry.

## 3. Sponsored reserves (CAP-33)

Sources: https://developers.stellar.org/docs/build/guides/transactions/sponsored-reserves and https://github.com/stellar/stellar-protocol/blob/master/core/cap-0033.md

- The sponsoring account pays the base reserves for the sponsored account. Anything that increases the minimum balance can be sponsored: account creation, offers, trustlines, data entries, signers, claimable balances.
- Creating a sponsored entry needs a **sandwich transaction**: `BeginSponsoringFutureReserves` (sponsor signs) → the sponsored operation → `EndSponsoringFutureReserves` (sponsored account signs). All relevant accounts sign.
- `RevokeSponsorship` lets the sponsoring account remove or transfer sponsorship of existing entries and signers.
- **Minimum balance with sponsorship:** `(2 + numSubEntries + numSponsoring - numSponsored) * baseReserve`. Selling liabilities are not part of the minimum balance but reduce the available balance: `available = balance - minimum - liabilities.selling`.
- When account A sponsors future reserves for B, reserves accumulate on A (`numSponsoring`) and B's `numSponsored` cancels the increase in its `numSubEntries`.
- Claimable balances are always sponsored by their creator, who gets the reserve back when the balance is claimed.
- Fixture implication: the "1 sponsored trustline" in the SOW fixture is built with the sandwich above using a separate sponsor account, and when Dustin removes that trustline the freed reserve returns to that sponsor, not to the closing account. Dustin must report this in the recovered-XLM accounting.

## 4. Reserves and minimum balance

Sources: https://developers.stellar.org/docs/learn/fundamentals/lumens#base-reserves and https://developers.stellar.org/docs/learn/fundamentals/lumens#minimum-balance

- One base reserve is **0.5 XLM** (as of 2026-09-25; validators can vote to change it).
- Minimum balance: **2 base reserves (1 XLM)** plus one base reserve per subentry.
- Subentries: trustlines (traditional assets and pool shares), offers, signers, data entries. Maximum **1,000** subentries per account.
- The SOW's zero-spendable fixture (1 XLM base + 0.5 XLM per trustline, holding exactly the minimum) matches these numbers.

## 5. Trustline removal, offers, data

Sources: https://developers.stellar.org/docs/learn/fundamentals/transactions/list-of-operations#change-trust and https://developers.stellar.org/docs/data/apis/horizon/api-reference/errors/result-codes/operation-specific/change-trust

- `ChangeTrust` with limit 0 deletes a trustline. `CHANGE_TRUST_INVALID_LIMIT`: the limit is not sufficient to hold the current balance **and still satisfy its buying liabilities**. So a trustline with a non-zero balance, or with open offers buying that asset, cannot be removed. Ordering rule: cancel offers first, dispose of the balance second, remove the trustline third.
- `CHANGE_TRUST_NO_ISSUER`: the issuer cannot be found (issuer account merged). Edge case for the disposal ladder: "return to issuer" is impossible when the issuer no longer exists.
- `ManageSellOffer` / `ManageBuyOffer` with amount 0 and the offer id deletes the offer. `ManageData` with a null value deletes a data entry. Path payment strict send takes a `destMin` (minimum amount of destination asset to receive).
- `BumpSequence` bumps the source account sequence number forward (threshold Low). Note it can only move the sequence number **up**, so it is not a remedy for `SEQNUM_TOO_FAR`.

## 6. Sequence number guard (verified against stellar-core)

Sources: https://github.com/stellar/stellar-core/blob/master/src/transactions/MergeOpFrame.cpp and https://github.com/stellar/stellar-core/blob/master/src/transactions/TransactionUtils.cpp (fetched 2026-09-25)

- `MergeOpFrame::doApply` returns `ACCOUNT_MERGE_SEQNUM_TOO_FAR` when `sourceAccount.seqNum >= getStartingSequenceNumber(header)`.
- `getStartingSequenceNumber(ledgerSeq)` is `static_cast<SequenceNumber>(ledgerSeq) << 32`, i.e. the sequence number a brand-new account would receive if created in the current ledger.
- **Guard formula for the planner:** the merge is possible only while `accountSeq < currentLedgerSeq * 2^32`. Since `BumpSequence` can only move a sequence number up (CAP-1), the only remedy is to wait until the ledger sequence grows past `floor(accountSeq / 2^32)`. The planner reports the earliest ledger at which the merge becomes valid; on testnet (about 5-second ledgers) this is normally seconds to minutes unless a sequence number was bumped far ahead deliberately. The D3 test case builds exactly that: bump the fixture's sequence to a value above `currentLedger << 32`, expect the planner to flag it, then wait or use a fresh fixture.
- Other checks in the same function, for completeness: `ACCOUNT_MERGE_HAS_SUB_ENTRIES` fires when `numSubEntries != signers.size()` (every subentry that is not a signer blocks the merge, which confirms that signers alone never block); `ACCOUNT_MERGE_IS_SPONSOR` fires when the account has an open sponsoring-future-reserves relationship in the transaction or `numSponsoring > 0`; `ACCOUNT_MERGE_IMMUTABLE_SET` fires when the account has `AUTH_IMMUTABLE_FLAG`; `ACCOUNT_MERGE_DEST_FULL` fires when the destination cannot absorb the balance; `ACCOUNT_MERGE_MALFORMED` fires in `doCheckValid` when destination equals source.

## 7. Testnet operations

Source: https://developers.stellar.org/docs/build/guides/basics/automate-reset-data

- Testnet and Futurenet are reset to genesis **approximately quarterly**. Resets clear all ledger entries, transactions and history from Core, Horizon and RPC.
- Implication: the fixture account, the sponsor account and all evidence transaction hashes disappear at the next reset. The evidence package must include screenshots and exported transaction XDR/result JSON in the repo, not only explorer links, and the fixture builder must be re-runnable in one command.

## 8. Ecosystem facts (Scout / LumenLoop, as of 2026-09-25)

- Stellar Expert is listed as a Live Analytics project (https://stellarlight.xyz/project/stellar-expert). The Account Demolisher source was **not found in these sources**; it must be located directly on GitHub (see the competitive landscape document).
- No fee-sponsorship service (e.g. a hosted fee-bump relay for classic transactions) surfaced in the Scout project directory for the queries tried. Treat "no hosted sponsor exists" as unverified rather than established.
- CAP-13 (2018, "Change Trustlines to Balances") proposed letting any account remove its own balances, a historical signal that the trustline-removal pain point is old and recognized.

## Sources

- https://developers.stellar.org/docs/learn/fundamentals/transactions/list-of-operations
- https://developers.stellar.org/docs/build/guides/transactions/fee-bump-transactions
- https://developers.stellar.org/docs/build/guides/transactions/sponsored-reserves
- https://developers.stellar.org/docs/learn/fundamentals/lumens
- https://developers.stellar.org/docs/build/guides/basics/automate-reset-data
- https://developers.stellar.org/docs/data/apis/horizon/api-reference/errors/result-codes/operation-specific/account-merge
- https://developers.stellar.org/docs/data/apis/horizon/api-reference/errors/result-codes/operation-specific/change-trust
- https://github.com/stellar/stellar-protocol/blob/master/core/cap-0015.md
- https://github.com/stellar/stellar-protocol/blob/master/core/cap-0033.md
- https://github.com/stellar/stellar-protocol/blob/master/core/cap-0013.md
- https://github.com/stellar/stellar-protocol/blob/master/core/cap-0001.md
- https://github.com/stellar/stellar-core/blob/master/src/transactions/MergeOpFrame.cpp
- https://github.com/stellar/stellar-core/blob/master/src/transactions/TransactionUtils.cpp
- Raven MCP calls: stellarDocs.search_doc_titles, stellarDocs.search_protocol_concepts_docs, stellarDocs.get_doc_page_sections, stellarDocs.search_docs, scout.searchProjects, scout.searchResearch, lumenloop.search_content_semantic
