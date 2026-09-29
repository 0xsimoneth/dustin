# Dustin — Edge-case catalogue and D3 test matrix

Status: design-stage review (no code exists yet). Produced non-interactively on 2026-09-25 by walking the
protocol flow described in the accepted SOW (`SUCCESSFUL_SOW.md`) branch by branch, then verifying every
protocol rule the flow depends on against primary sources (Stellar developer docs, CAPs, SEP-29,
stellar-core and js-stellar-sdk source, and live read-only queries against testnet Horizon and RPC).

How to read this document:

- Every claim carries an evidence grade: **[C] Confirmed** (quoted from a primary source or observed
  live), **[D] Deduced** (follows from Confirmed facts; the chain is stated), **[H] Hypothesized**
  (plausible, not confirmed; what would confirm it is stated). Items marked **unverified** could not be
  confirmed and must not be relied on until tested.
- `[S<n>]` keys point at the Sources section at the end. Result-code names are written exactly as the
  protocol defines them (`ACCOUNT_MERGE_IS_SPONSOR`); Horizon renders the same codes in snake case inside
  `extras.result_codes` (`op_has_sub_entries`, `tx_fee_bump_inner_failed`, `op_no_trust`) [S2][S49].
- Severity: **Critical** = breaks the SOW's binary success metric or causes irreversible loss; **High** =
  blocks the close or makes the plan lie to the user; **Medium** = recoverable with a retry or a re-plan;
  **Low** = cosmetic, rare, or informational.

## Hand-off brief

1. **What is at stake.** The SOW's binary metric is "one messy testnet account with zero spendable XLM,
   at least 3 non-zero trustlines, at least 1 offer and 1 data entry is fully closed and merged, every
   transaction fee-bumped by a sponsor" [S47]. Anything that leaves one subentry behind fails the metric.
2. **Where the design stands.** The ordered teardown in the SOW is protocol-sound, but four of its own
   assumptions are wrong or incomplete: (a) an asset whose issuer is gone is *not* stuck (burn-to-issuer
   bypasses the destination-existence check [S38][S43]); (b) therefore the only truly unclosable balance is
   an *unauthorized* trustline, and such a balance cannot sit inside the master fixture that must merge;
   (c) ladder step 3 ("send to destination") is unreachable as ordered because step 2 ("return to
   issuer") cannot fail for an authorized trustline; (d) claimable balances created by the account and
   pool shares silently block the merge via `ACCOUNT_MERGE_IS_SPONSOR` and `CHANGE_TRUST_CANNOT_DELETE`.
3. **What to do next.** Build two fixtures (master = fully closable; FIX-B = frozen asset for the
   unclosable path), reorder or gate ladder step 3, add the sponsorship and pool-share preflight, and adopt
   the submission/retry rules in section 3.5 before writing `executeClose()`.

## 1. Protocol facts the design relies on (verified stronghold)

| # | Fact | Grade | Source |
|---|------|-------|--------|
| F1 | `AccountMerge` fails with `ACCOUNT_MERGE_HAS_SUB_ENTRIES` while non-signer subentries (trustlines, offers, data) exist; signers do not block and are removed automatically. Core check is `numSubEntries != signers.size()`. | [C] | [S1][S2][S36] |
| F2 | `ACCOUNT_MERGE_SEQNUM_TOO_FAR`: the source sequence number must be less than `ledgerSeq << 32`; core compares `seqNum >= getStartingSequenceNumber(header)`. Sequence numbers can only go up (`BumpSequence`), so the only remedy is waiting for ledgers. | [C] | [S1][S36] |
| F3 | `ACCOUNT_MERGE_IS_SPONSOR` when `numSponsoring > 0` or an is-sponsoring-future-reserves relation is open in the same transaction. | [C] | [S1][S6][S36] |
| F4 | `ACCOUNT_MERGE_IMMUTABLE_SET` when `AUTH_IMMUTABLE` is set; the flag also makes the account unmergeable forever ("the issuing account can't be merged"). | [C] | [S1][S11] |
| F5 | `ACCOUNT_MERGE_NO_ACCOUNT` (destination missing), `ACCOUNT_MERGE_MALFORMED` (destination == source), `ACCOUNT_MERGE_DEST_FULL` (destination cannot hold the balance and its lumen buying liabilities). Destination may be a muxed (M) account. | [C] | [S1][S34] |
| F6 | `AccountMerge` is a **high**-threshold operation; `ChangeTrust`, `Payment`, `PathPaymentStrictSend`, `ManageSellOffer`, `ManageBuyOffer`, `ManageData`, `RevokeSponsorship`, `Begin/EndSponsoringFutureReserves` are **medium**; `BumpSequence`, `SetTrustLineFlags`, `AllowTrust` are **low**. | [C] | [S1] |
| F7 | `ChangeTrust` with `limit = 0` and a non-zero balance (or buying liabilities) fails `CHANGE_TRUST_INVALID_LIMIT`; `limit = 0` on a trustline that does not exist also returns `CHANGE_TRUST_INVALID_LIMIT`; deletion does **not** check issuer existence; `CHANGE_TRUST_CANNOT_DELETE` when a liquidity pool still references the trustline; `CHANGE_TRUST_NO_ISSUER` only on create/update. | [C] | [S1][S37][S13] |
| F8 | A plain `Payment` of an asset to its issuer bypasses the destination-existence check ("so that it's always possible to send credits back to its issuer"); the issuer needs no trustline and `IssuerImpl::addBalance` always succeeds and never loads the issuer account. The docs state `PAYMENT_NO_DESTINATION` is not returned when the receiver is the issuer (burn). | [C] | [S1][S38][S43] |
| F9 | Sending any credit asset requires the sender's trustline to be `AUTHORIZED` (`*_SRC_NOT_AUTHORIZED` otherwise); `AUTHORIZED_TO_MAINTAIN_LIABILITIES` only allows keeping/cancelling offers and withdrawing from pools. | [C] | [S1][S11][S38] |
| F10 | Revoking authorization cancels the account's open offers for that asset and redeems its pool shares into claimable balances whose sponsor is the sponsor of the deleted pool-share trustline. | [C] | [S11][S14] |
| F11 | Minimum balance = `(2 + numSubEntries + numSponsoring - numSponsored) * baseReserve`; available balance = balance − minimum − selling liabilities; base reserve is 0.5 XLM (testnet ledger reports `base_reserve_in_stroops = 5000000`, `base_fee_in_stroops = 100`, protocol 28 on 2026-09-25). | [C] | [S5][S6][S7][S46] |
| F12 | A pool-share trustline counts as **two** subentries (two base reserves); an account cannot exceed 1,000 subentries. Live check: an account with 1 asset trustline + 1 pool-share trustline shows `subentry_count = 3`. | [C] | [S13][S10][S46] |
| F13 | When a sponsored entry is removed, `numSponsoring` decreases on the sponsor and `numSponsored` on the owner; the owner removes the entry with an ordinary operation; only `RevokeSponsorship` needs the sponsor as source. Claimable balances are always sponsored (creator pays the reserve) and their sponsorship can only be transferred (`REVOKE_SPONSORSHIP_ONLY_TRANSFERABLE`). | [C] | [S5][S1][S6] |
| F14 | Sponsorship sandwich: `BeginSponsoringFutureReserves` (source = sponsor) … sponsored op(s) (source = sponsored) … `EndSponsoringFutureReserves` (source = sponsored), all in one transaction; unclosed relations fail the transaction (`txBAD_SPONSORSHIP`). | [C] | [S5][S6][S41] |
| F15 | Fee-bump validity: fee ≥ network minimum for (inner ops + 1); fee ≥ inner transaction fee; core compares fee *rates* per operation; the fee source signs with its **low** threshold and must hold the fee; the inner fee may be below the minimum and the inner source's balance is not checked for the fee; the inner sequence number is always consumed at apply time; replace-by-fee requires 10× the previous bid; fee bumps require protocol ≥ 13. | [C] | [S3][S4][S40] |
| F16 | js-stellar-sdk `buildFeeBumpTransaction(feeSource, baseFee, innerTx, passphrase)` sets the outer fee to `baseFee × (innerOps + 1)` and rejects `baseFee` below the inner per-op fee or the network minimum; `TransactionBuilder.build()` throws unless time bounds are set or `setTimeout(TimeoutInfinite)` was called. | [C] | [S44] |
| F17 | `txFAILED` consumes the sequence number and the fee (charged in the pre-apply phase); validation failures (`txBAD_SEQ`, `txINSUFFICIENT_FEE`, `txTOO_LATE`, `txBAD_AUTH`, `txBAD_AUTH_EXTRA`) do not. `txBAD_SEQ` is `seqNum + 1 != tx.seqNum` unless `minSeqNum` preconditions apply. Time bounds are evaluated against the ledger close time. | [C] | [S41][S22][S9] |
| F18 | Leftover (unused) valid signatures fail the transaction with `txBAD_AUTH_EXTRA`; master weight 0 cannot sign anything, even threshold-0 operations. | [C] | [S33] |
| F19 | Transactions are atomic and carry 1–100 operations; operations apply in order within the transaction (the sponsorship sandwich depends on it). | [C]/[D] | [S9][S5] |
| F20 | Horizon `/transactions`: same hash resubmitted → same response as the original; HTTP 504 "is not an error but a warning that your transaction hasn't been accepted by the network yet" — poll the hash or resubmit *exactly the same* transaction. Horizon waits for its own ingestion before answering 200, so reads after a 200 are consistent. `/transactions_async` returns `PENDING`, `DUPLICATE`, `TRY_AGAIN_LATER`, `ERROR`. | [C] | [S18][S19][S21][S23] |
| F21 | Horizon failure bodies: HTTP 400 `transaction_failed` with `extras.result_codes.transaction`, `extras.result_codes.inner_transaction` (fee bumps), `extras.result_codes.operations[]`, `envelope_xdr`, `result_xdr`. Example from the docs: `tx_fee_bump_inner_failed - inner transaction: tx_failed - operation codes: [ op_no_trust ]`. | [C] | [S20][S49] |
| F22 | Horizon collection pages: default 10, maximum 200 (live: `limit=201` → 400 "over limit max of 200"). `/accounts`, `/offers`, `/claimable_balances` accept `sponsor=`; `/accounts?sponsor=` returns accounts sponsored by, or having a trustline/offer/data entry sponsored by, the given account. `/claimable_balances?claimant=` lists balances claimable by an account. | [C] | [S29][S46] |
| F23 | Horizon account object: `sequence`, `sequence_ledger`, `subentry_count`, `num_sponsoring`, `num_sponsored`, `sponsor` (omitted when absent), `flags.{auth_required,auth_revocable,auth_immutable,auth_clawback_enabled}`, `thresholds`, `signers[].sponsor`, `data` (base64 values, **no per-entry sponsor**), `balances[]` with `asset_type` (`native`, `credit_alphanum4/12`, `liquidity_pool_shares`), `liquidity_pool_id`, `limit`, `buying_liabilities`, `selling_liabilities`, `sponsor`, `last_modified_ledger`, `is_authorized`, `is_authorized_to_maintain_liabilities`, `is_clawback_enabled` — the last three are `*bool` with `omitempty`. Pool-share balances report `is_authorized: false`. | [C] | [S27][S28][S46] |
| F24 | RPC `getLedgerEntries` returns raw `LedgerEntry` XDR (which carries `ext.v1().sponsoringID`) for accounts, trustlines, offers, data, claimable balances and pools; max 200 keys per call. RPC `sendTransaction` accepts all transaction types and `getTransaction` retains a bounded window (stock default 120,960 ledgers ≈ 7 days). | [C] | [S26][S24][S25] |
| F25 | SEP-29: destination data entry `config.memo_required` = `"1"` (Horizon shows base64 `MQ==`); applies to `PAYMENT`, `PATH_PAYMENT_STRICT_SEND`, `PATH_PAYMENT_STRICT_RECEIVE`, `MERGE_ACCOUNT`; enforced by senders (SDKs), not the protocol; not applied to M addresses. js-stellar-sdk `submitTransaction` runs `checkMemoRequired` by default (`skipMemoRequiredCheck: false`), unwraps fee bumps, skips M destinations, and throws `AccountRequiresMemoError`. | [C] | [S15][S45] |
| F26 | Testnet: resets "typically 2–4 times per year at 17:00 UTC", announced ≥ 2 weeks ahead; scheduled 2026 reset: **2026-12-16**; a reset clears all ledger entries, transactions and history from Core, Horizon and RPC. Friendbot funds 10,000 XLM and is rate limited. Passphrase `Test SDF Network ; September 2015`; Horizon `https://horizon-testnet.stellar.org`; RPC `https://soroban-testnet.stellar.org`. Horizon default rate limit 3,600 requests/hour/IP → 429. | [C] | [S16][S48][S17] |
| F27 | Live testnet on 2026-09-25 15:26 UTC: Horizon 29.0.0, core 29.0.0, protocol 28, ledger 4,865,279 (`4865279 << 32 = 20896214190915584`), `max_tx_set_size = 200`, `ledger_capacity_usage = 0.14`, `max_fee.p50 = 204000` stroops, `fee_charged.max = 2760764` stroops in the last 5 ledgers (fee bidding on testnet is far above the 100-stroop base). Two consecutive ledgers closed 10 s apart (≈ 5 s per ledger). | [C] | [S46] |
| F28 | Dust rounding on the DEX: if either side of an exchange rounds to zero the exchange is `REDUCED_TO_ZERO`, crossing stops (`eOfferCantConvert`) and the resting offer is left untouched; the SDK rejects amount strings that are not positive decimals with ≤ 7 fractional digits. | [C] | [S42][S44] |
| F29 | Offers are deleted with `ManageSellOffer`/`ManageBuyOffer` `amount = 0` and the `offerID`; core matches only `(sourceAccount, offerID)` — the selling/buying assets of the delete op need not match, and an offer created with `ManageBuyOffer` (or as a passive offer) can be deleted with `ManageSellOffer`; `amount = 0` with `offerID = 0` is `MALFORMED`. | [C] | [S1][S39] |
| F30 | Path payments: `*_TOO_FEW_OFFERS` when no path ≤ 5 hops exists, `*_OFFER_CROSS_SELF` when the payment would cross the sender's own offer, `*_UNDER_DESTMIN`; issuer existence is only checked before protocol 13. Horizon `/paths/strict-send` takes `source_asset_*`, `source_amount` and `destination_account` **or** `destination_assets` (live query returned a direct XLM→USDC path). | [C] | [S1][S38][S29][S46] |

## 2. Flow under review (branch points that were traced)

`planClose(account, destination, opts)` — read-only:

- P1 load account (missing / muxed input / C address / malformed key) → P2 flags (`auth_immutable`) → P3 sequence vs ledger → P4 thresholds and available signer weight (medium for teardown, high for merge) → P5 `num_sponsoring`, open claimable balances, entries sponsored for others → P6 offers (paginate ≤ 200/page) → P7 balances: native, credit (authorized? clawback? liabilities? issuer alive? path to XLM? destination trustline?), pool shares → P8 data entries (sponsor unknown from Horizon) → P9 destination facts (exists, == source, memo required, trustlines, limits, muxed) → P10 reserve and recovery accounting (own vs sponsored subentries, fee = 0) → P11 grouping into ≤ 100-op transactions with dependency order → P12 plan hash over the snapshot.

`executeClose(plan, signers, sponsor)`:

- E1 re-snapshot and compare the plan hash → E2 per transaction: reload sequence, build inner, sign inner (exactly the required weight), wrap in a fee bump, sign outer → E3 submit → E4 outcomes: 200; 400 with `tx_*`/`op_*` codes; 504; network error; 429 → E5 op-level failure in a disposal transaction → ladder fallback for that asset → E6 transaction-level failure → reconcile from chain state, re-plan (bounded) → E7 final verification: account 404 on Horizon, destination credited, sponsors' `num_sponsoring` decreased.

Every branch below that lacked an explicit guard in the SOW's description is listed as a finding.

## 3. Edge-case catalogue

### 3.1 Account state

| ID | Trigger | Planner behaviour | Executor behaviour | Result code(s) and source | Severity / grade |
|----|---------|-------------------|--------------------|---------------------------|------------------|
| A-01 | `num_sponsoring > 0` because the account sponsors other accounts' reserves (accounts, trustlines, offers, data, signers). | Enumerate via `/accounts?sponsor=`, `/offers?sponsor=` (F22) and report `Unclosable(merge): sponsoring N entries`. Hint: `RevokeSponsorship` by this account is possible only if each owner can afford the reserve (`REVOKE_SPONSORSHIP_LOW_RESERVE`), otherwise transfer the sponsorship (out of scope). | Refuse to start the teardown (end state unreachable) unless `--best-effort`. If a merge is attempted anyway it fails whole-transaction. | `ACCOUNT_MERGE_IS_SPONSOR`, `REVOKE_SPONSORSHIP_LOW_RESERVE`, `REVOKE_SPONSORSHIP_NOT_SPONSOR` [S1][S6] | High / [C] |
| A-02 | `num_sponsoring > 0` because the account **created claimable balances** (every claimable balance is sponsored by its creator, F13). The SOW lists "claimable balance cleanup" as out of scope, but detection is mandatory or the merge fails. | Enumerate `/claimable_balances?sponsor=`; report each id; hint: claim (if the account is a claimant), `ClawbackClaimableBalance` (needs clawback flag), or transfer sponsorship (`ONLY_TRANSFERABLE`). | As A-01. | `ACCOUNT_MERGE_IS_SPONSOR`, `REVOKE_SPONSORSHIP_ONLY_TRANSFERABLE` [S1][S5][S6] | High / [C]+[D] |
| A-03 | Claimable balances **claimable by** the account (created by others). They do not block the merge, but after the merge the claimant no longer exists and the value is lost. | List `/claimable_balances?claimant=`; emit a warning with amounts; offer `--claim-first` later (out of scope now). | Proceed; print the warning again before the merge. | none (informational) [S29] | Medium (irreversible loss) / [D] |
| A-04 | Sponsored signers, data or offers on the account (entries the account owns but a third party sponsors). | Signers: reported as "removed by the merge; reserve returns to sponsor X". Data/offers: removal ops as usual; recovered-XLM contribution 0. Data-entry sponsorship is not in the Horizon account object — read `ext.v1().sponsoringID` via RPC `getLedgerEntries` (F23, F24). | Ordinary `ManageData`/`ManageSellOffer` ops; no sponsor signature. | none; effects `data_sponsorship_removed`, `signer_sponsorship_removed`, `account_sponsorship_removed` [S32] | Low / [C]+[D] |
| A-05 | The account's **own** base reserves are sponsored (`sponsor` field set on the account, `num_sponsored ≥ 2`); balance can be exactly 0. | Minimum balance uses `- numSponsored`; recovered XLM = native balance (may be 0). State that the sponsor's `numSponsoring` drops by 2 at the merge. | Normal; the merge transfers whatever native balance exists. | none [S5][S6][S36] | Low / [C]+[D] |
| A-06 | `auth_immutable` set on the account (as an issuer). | First check, before anything else: `Unclosable(permanent): AUTH_IMMUTABLE`. Do not emit teardown steps (tearing down and then failing the merge would strand the user with nothing). | Refuse entirely. | `ACCOUNT_MERGE_IMMUTABLE_SET` [S1][S11] | Critical (irreversible) / [C] |
| A-07 | `auth_required` / `auth_revocable` / `auth_clawback_enabled` set on the account (it is an issuer). | Flags alone do not block the merge (F4 only names immutable). Report "account is an issuer" and see A-08. | Proceed. | none [S11] | Low / [C] |
| A-08 | The account is an asset **issuer with outstanding supply**. Merging strands holders: they can still burn to the dead address (F8) and trade, but nobody can open a new trustline (`CHANGE_TRUST_NO_ISSUER`). | Detect issued assets (Horizon `/assets?asset_issuer=` — parameter name unverified, U9) and require an explicit `--i-am-an-issuer` acknowledgement; list circulating amount and holder count. | Refuse without the flag. | `CHANGE_TRUST_NO_ISSUER` (for future holders) [S1][S37] | High (irreversible for third parties) / [C]+[H] |
| A-09 | Raised thresholds / multisig (e.g. `high_threshold = 2`, master weight 1). | Compute weight obtainable from the supplied signers per threshold class (F6): teardown needs medium, merge needs high. Report `Unclosable(merge): need weight 2, have 1` and name the missing signers. Never start a teardown whose merge is unreachable. Emit unsigned inner XDRs for external signing when `--export-xdr`. | Sign inner transactions with exactly the required weight; leftover signatures fail the transaction (F18). Fee-bump outer: sponsor signs to its own low threshold. | `txBAD_AUTH`, `txBAD_AUTH_EXTRA` [S22][S33] | High / [C] |
| A-10 | Master weight 0 (account controlled only by other signers). | As A-09; if no non-master signer key is supplied: `Unclosable: no usable signer`. | Refuse. | `txBAD_AUTH` [S33] | High / [C] |
| A-11 | Pre-authorized-transaction or hash(x) signers present. | Informational: removed by the merge; count toward subentries but do not block (F1). | Proceed. | none [S1][S33] | Low / [C] |
| A-12 | `home_domain` set. | Informational only (not a subentry). | Proceed. | none [S10] | Low / [C] |
| A-13 | Liquidity-pool share trustlines (`asset_type = liquidity_pool_shares`). | Report the pool id, share balance and that it counts 2 subentries (F12). Mark the pool-share trustline **and both constituent asset trustlines** as `Blocked: withdraw from pool first (out of scope)`; overall status `cannot merge`. Do not misread `is_authorized: false` on the pool-share balance as a frozen asset (F23). | Refuse to start unless `--best-effort`; if attempted, `ChangeTrust(0)` on a constituent fails. | `CHANGE_TRUST_CANNOT_DELETE`, `ACCOUNT_MERGE_HAS_SUB_ENTRIES` [S1][S13] | High / [C] |
| A-14 | Sequence number far ahead (`sequence + 1 >= ledger << 32`). | Compute `ledgersToWait = ceil((sequence + 1) / 2^32) - latestLedger`, ETA at ≈ 5 s/ledger (F27, observed cadence, not a constant). If ETA > `--max-wait` (default 2 min) report `Blocked(merge): SEQNUM_TOO_FAR, wait ≈ T`. Note the account can still run the teardown steps meanwhile — but do not, unless `--best-effort`, for the same reason as A-06. | If within the wait budget: run the teardown, then poll the ledger until the condition clears, then merge. Never `BumpSequence` (only makes it worse). | `ACCOUNT_MERGE_SEQNUM_TOO_FAR` [S1][S36] | High / [C]+[D] |
| A-15 | Boundary: a failed merge attempt itself consumes a sequence number (F17), moving the account one step closer to, or across, the `ledger << 32` boundary. | Include the +1 in the check (A-14). | After any `txFAILED` re-evaluate A-14 before retrying. | `ACCOUNT_MERGE_SEQNUM_TOO_FAR` [S36][S41] | Low / [D] |
| A-16 | Input account is an M address or a C address. | M: resolve to the underlying G (the plan is for the G account; the memo/ID is irrelevant). C: reject ("classic G accounts only", SOW out of scope). | n/a | none [S34] | Low / [C] |

### 3.2 Balances

| ID | Trigger | Planner behaviour | Executor behaviour | Result code(s) and source | Severity / grade |
|----|---------|-------------------|--------------------|---------------------------|------------------|
| B-01 | Dust below the resolution a DEX crossing can convert (e.g. `0.0000003` of an asset priced far below 1 XLM). | Ladder step 1 (path payment) is likely to yield 0 (F28). Plan the disposal as "path payment, expected to fall through to burn"; a Horizon `/paths/strict-send` answer with `destination_amount = 0.0000000` or no records means "no path". | On `TOO_FEW_OFFERS` / `UNDER_DESTMIN` for that op, downgrade that asset to step 2 (burn) and rebuild the transaction. | `PATH_PAYMENT_STRICT_SEND_TOO_FEW_OFFERS`, `PATH_PAYMENT_STRICT_SEND_UNDER_DESTMIN` [S1][S42] (exact code for the zero-rounding case: U4) | Medium / [C]+[D] |
| B-02 | Asset with no market at all (illiquid, live issuer). | `/paths/strict-send` empty and `/order_book` empty → plan step 2: `Payment(asset → issuer)` (burn). Recovered XLM contribution 0. | Burn succeeds for any authorized trustline (F8, F9). | `PAYMENT_SUCCESS` [S1][S38] | Low / [C] |
| B-03 | Issuer account was merged (asset "orphaned"). | **Not** a stuck case: a plain payment to the issuer address still burns (F8). Plan step 2 as B-02 with reason "issuer account no longer exists; burning". Never plan a path payment through the orphaned asset's own book unless offers exist. | Burn. | none on burn; `CHANGE_TRUST_NO_ISSUER` would only hit a *create* [S38][S43][S37] | Low / [C] |
| B-04 | Trustline **not authorized** (issuer has `AUTH_REQUIRED` and never authorized, or revoked with `AUTH_REVOCABLE`), balance > 0. | `Unclosable: trustline not authorized — balance cannot be sent, burned or traded; needs the issuer to authorize or claw back`. Plan status `cannot merge`. This is the *only* truly unclosable balance class (with B-05). | Do not start the teardown unless `--best-effort`. Offers on the asset can still be cancelled (F9). | `PAYMENT_SRC_NOT_AUTHORIZED`, `PATH_PAYMENT_STRICT_SEND_SRC_NOT_AUTHORIZED`, `MANAGE_SELL_OFFER_SELL_NOT_AUTHORIZED`, `CHANGE_TRUST_INVALID_LIMIT` [S1][S38] | High / [C] |
| B-05 | Trustline `AUTHORIZED_TO_MAINTAIN_LIABILITIES` only, balance > 0. | As B-04 (cannot send). Offers on it are still cancellable. | As B-04. | same as B-04 [S1][S11] | High / [C] |
| B-06 | Unauthorized trustline with balance **0**. | Deletable: `ChangeTrust(0)` needs no authorization. | Delete. | none [S37] | Low / [C] |
| B-07 | Clawback-enabled trustline (`is_clawback_enabled: true`). | Normal ladder; note the flag. Absence of the field means false (F23, U11). | Normal. If the issuer claws back mid-run the disposal op fails `UNDERFUNDED` → re-plan (balance now 0 → delete). | `PATH_PAYMENT_STRICT_SEND_UNDERFUNDED`, `PAYMENT_UNDERFUNDED`, `CLAWBACK_*` (issuer side) [S1][S12] | Medium / [C] |
| B-08 | Selling liabilities on a trustline (open offers selling that asset). | Disposal amount = balance − selling liabilities unless the cancel precedes the disposal in the same transaction (then full balance). Always order: cancel → dispose → delete. | Same transaction ordering; otherwise `UNDERFUNDED`. | `*_UNDERFUNDED` [S1] | Medium / [C] |
| B-09 | Buying liabilities on a trustline (open offers buying that asset), even with balance 0. | `ChangeTrust(0)` must come after the offer cancellation ("limit not sufficient to hold the current balance … and still satisfy its buying liabilities"). | Same. | `CHANGE_TRUST_INVALID_LIMIT` [S1] | Medium / [C] |
| B-10 | Native balance exactly at the minimum (spendable 0) or below (possible after a base-reserve change). | Fee = 0 for the account (all fees sponsored); XLM recovered = native balance + freed reserves are the same lumens (the merge moves the whole balance). Report spendable = balance − minimum − native selling liabilities (F11). | Nothing special; every transaction is fee-bumped. A non-bumped transaction from this account would be rejected `tx_insufficient_balance` — use that as the *proof* of zero spendable in the evidence package. | `txINSUFFICIENT_BALANCE` [S22] | Low / [C] |
| B-11 | Destination lacks a trustline for an asset (ladder step 3 input). | Step 3 applies only if the destination has an authorized trustline with `limit − balance − buying_liabilities ≥ amount`; else skip to step 2/4. See B-12 for the ordering problem. | `PAYMENT_NO_TRUST`, `PAYMENT_NOT_AUTHORIZED`, `PAYMENT_LINE_FULL` → fall through. | `PAYMENT_NO_TRUST`, `PAYMENT_NOT_AUTHORIZED`, `PAYMENT_LINE_FULL` [S1] | Medium / [C] |
| B-12 | **Ladder ordering defect.** As written in the SOW (path → issuer → destination → unclosable), step 3 is unreachable: step 2 (burn) cannot fail for an authorized trustline (F8), and if the trustline is unauthorized step 3 fails too (F9). Burning also destroys value the destination could have kept. | Reorder to path → destination (if it holds the trustline) → issuer (burn) → unclosable, or make the order a policy option (`preserveValue: true` default). Document it in the ordering-rules write-up. | Implement the ladder as a per-asset state machine so the order is data, not code. | none | High (design) / [D] |
| B-13 | Destination requires a memo (SEP-29 `config.memo_required`). | Detect (base64-decode the data value, F25); require `--memo`; put the memo on every inner transaction whose ops target the destination (step 3 payments and the merge). | SDK check runs on `submitTransaction` and unwraps fee bumps; without a memo it throws `AccountRequiresMemoError` before submission. | client-side only [S15][S45] | High / [C] |
| B-14 | Destination is the fee sponsor. | Allowed; note that the sponsor both pays fees and receives the balance. | Normal. | none | Low / [D] |
| B-15 | Destination is the **issuer** of a held asset. | Steps 2 and 3 coincide: `Payment(asset → issuer)`; label it "burn (destination is the issuer)". The issuer never shows a trustline for its own asset, so a naive "does the destination hold the trustline" check must special-case this. | Burn. | `CHANGE_TRUST_SELF_NOT_ALLOWED` explains why no trustline exists [S1] | Low / [C] |
| B-16 | Destination equals the closing account. | Reject at validation. | n/a | `ACCOUNT_MERGE_MALFORMED` [S1] | Low / [C] |
| B-17 | Destination does not exist. | `Unclosable(merge): destination missing`; optional hint that the sponsor could `CreateAccount` it (out of scope). Do not start the teardown. | Refuse. | `ACCOUNT_MERGE_NO_ACCOUNT`, `PAYMENT_NO_DESTINATION` [S1] | High / [C] |
| B-18 | Destination is an M address. | Allowed for the merge and payments (F5); SEP-29 check is skipped for M (F25); explain in the plan. | Normal. | none [S34][S15] | Low / [C] |
| B-19 | Destination cannot hold the merged lumens (`INT64` overflow with its buying liabilities). | Theoretical; report if `destination.balance + amount > 922337203685.4775807`. | `ACCOUNT_MERGE_DEST_FULL` → unrecoverable without another destination. | `ACCOUNT_MERGE_DEST_FULL` [S1] | Low / [C] |
| B-20 | Two trustlines with the same asset code and different issuers; 12-character codes; codes that differ only by case. | Key every asset by `(code, issuer)` and `asset_type`; never by code. | Same. | none | Medium / [D] |
| B-21 | Incoming payment adds to a trustline between plan and execute (or a griefer keeps topping it up). | Plan hash uses each balance's `last_modified_ledger` (F23). Dispose and delete in the **same** transaction so no external transaction can interleave between them. Document the residual window (plan read → apply) and the bounded re-plan loop. | On `CHANGE_TRUST_INVALID_LIMIT` in the delete op → re-plan with the fresh balance (max N attempts). | `CHANGE_TRUST_INVALID_LIMIT` [S1] | Medium / [C]+[D] |
| B-22 | Liquidity-pool shares (balance class). | See A-13. | See A-13. | `CHANGE_TRUST_CANNOT_DELETE` [S1][S13] | High / [C] |
| B-23 | Path payment proceeds sent to self vs. to the destination. | Prefer `PathPaymentStrictSend(destination = self, destAsset = XLM)` so the merge carries the proceeds and no memo is needed; core has no explicit self-destination rejection (U8). If the destination is used directly, apply B-13. | Same. | none [S38] | Low / [D] |
| B-24 | The account's own offers are the only liquidity on the asset's book (Horizon path finding does not know who is asking). | Exclude own offers when judging liquidity: either query `/paths` after simulating the cancellations, or compare the path's offers with `/offers?seller=`. Otherwise step 1 is planned, the cancellation removes the path and step 1 fails. | If not cancelled first: `OFFER_CROSS_SELF`; if cancelled: `TOO_FEW_OFFERS` → fall through to the next step. | `PATH_PAYMENT_STRICT_SEND_OFFER_CROSS_SELF`, `PATH_PAYMENT_STRICT_SEND_TOO_FEW_OFFERS` [S1] | Medium / [C]+[H] |

### 3.3 Offers

| ID | Trigger | Planner behaviour | Executor behaviour | Result code(s) and source | Severity / grade |
|----|---------|-------------------|--------------------|---------------------------|------------------|
| O-01 | Sell offers and buy offers (created with `ManageBuyOffer`); passive offers. | Enumerate `/offers?seller=` with pagination (default 10, max 200, F22). Cancel each with `ManageSellOffer(amount = 0, offerId)` using the recorded selling/buying pair and price (assets need not match, but reuse them, F29). | One op per offer; all cancellations in the first transaction(s). | `MANAGE_SELL_OFFER_NOT_FOUND` when already gone [S1][S39] | Medium / [C] |
| O-02 | Offer selling **native** XLM (selling liabilities on the native balance). | Spendable = balance − minimum − selling liabilities; cancellation frees the liability. No trustline involved. | Cancel first. | `MANAGE_SELL_OFFER_UNDERFUNDED` explains the reserve interaction [S1] | Low / [C] |
| O-03 | Offer whose selling or buying asset's trustline is scheduled for removal. | Dependency: cancel → dispose → delete trustline, all ordered within one transaction or across ordered transactions. | Same. | `CHANGE_TRUST_INVALID_LIMIT` if violated [S1] | Medium / [C] |
| O-04 | Offer filled or partially filled between plan and execute. | Plan hash includes offer ids and `last_modified_ledger`. | `MANAGE_SELL_OFFER_NOT_FOUND` fails the whole transaction (atomic) → re-plan; partial fills change balances → the delete op fails `INVALID_LIMIT` → re-plan. | `MANAGE_SELL_OFFER_NOT_FOUND` [S1] | Medium / [C] |
| O-05 | More offers than fit in one transaction (up to 1,000 subentries). | Chunk cancellations into 100-op transactions; ordering invariant: every cancel of an asset precedes that asset's disposal. | Sequential submission. | none [S9][S10] | Medium / [C] |
| O-06 | Cancelling with `offerID = 0` by mistake (offer id lost or parsed as a number beyond 2^53). | Offer ids are int64 strings; keep them as strings/BigInt. | `MALFORMED` if `amount = 0` with id 0. | `MANAGE_SELL_OFFER_MALFORMED` [S39] | Low / [C]+[D] |
| O-07 | Sponsored offers. | Cancellation returns the reserve to the sponsor; recovered-XLM contribution 0. | Same op. | effect `offer_sponsorship_removed` [S32] | Low / [C] |

### 3.4 Sponsorship

| ID | Trigger | Planner behaviour | Executor behaviour | Result code(s) and source | Severity / grade |
|----|---------|-------------------|--------------------|---------------------------|------------------|
| S-01 | Trustline sponsored by a third party (`balances[].sponsor`). | Step "ChangeTrust(0) — sponsor X not needed as signer; 0.5 XLM reserve returns to X; contributes 0 XLM to the user". | Ordinary `ChangeTrust(0)` signed by the account only; never add the sponsor's signature (F18). Verify `X.num_sponsoring` decreased by 1 after the transaction. | effects `trustline_sponsorship_removed`, `trustline_removed` [S32]; `txBAD_AUTH_EXTRA` if over-signed [S33] | High (SOW deliverable) / [C] |
| S-02 | Sponsored trustline that also holds a balance. | Disposal first (ladder), then delete; the sponsor is irrelevant to the disposal. | Same transaction ordering. | as above | Medium / [C] |
| S-03 | "Sponsor account gone". | Impossible on a live ledger: an account with `numSponsoring > 0` cannot merge (F3). It can only *transfer* the sponsorship, so the `sponsor` field may change between plan and execute (accounting note only). After a testnet reset every account is gone (see T-14). | No action; refresh the sponsor id in the final report. | `ACCOUNT_MERGE_IS_SPONSOR` (on the sponsor) [S1] | Low / [C]+[D] |
| S-04 | The closing account is itself a sponsor (accounts, entries, claimable balances). | See A-01 / A-02. | See A-01. | `ACCOUNT_MERGE_IS_SPONSOR` [S1] | High / [C] |
| S-05 | Fixture construction: sandwich built with wrong op sources or missing signatures. | Fixture script: `Begin` (source = sponsor), `ChangeTrust` (source = account), `End` (source = account); transaction source = sponsor (pays fee); signatures: sponsor + account. | n/a (fixture) | `txBAD_SPONSORSHIP`, `txBAD_AUTH`, `BEGIN_SPONSORING_FUTURE_RESERVES_*` [S5][S6][S41] | Medium (fixture) / [C] |
| S-06 | Recovered-XLM estimate counts sponsored reserves as recoverable. | Recovered = native balance now + expected disposal proceeds; freed reserves are already inside the balance; sponsored entries add 0; fee 0. Show "returns to sponsor" lines separately. | Compare the estimate with the destination's credited amount in the final report. | none [S5][S11] | High (plan lies) / [C]+[D] |
| S-07 | Fee sponsor and reserve sponsor are the same account. | Works; but keep them separate in the fixture to *prove* the reserve sponsor never signs. | n/a | none | Low / [D] |
| S-08 | Sponsor (fee source) balance too low, or many parallel closes share it. | Preflight: sponsor available balance ≥ Σ planned fees × safety factor (surge); fee bumps do not consume the sponsor's sequence number (only the inner sequence is used, F15), so parallel closes are possible. | On `tx_insufficient_balance` stop and report the sponsor balance. | `txINSUFFICIENT_BALANCE` [S22][S40] | Medium / [C]+[D] |

### 3.5 Transaction mechanics

| ID | Trigger | Planner behaviour | Executor behaviour | Result code(s) and source | Severity / grade |
|----|---------|-------------------|--------------------|---------------------------|------------------|
| T-01 | Operation limit (100 per transaction) and the "minimum number of transactions" goal. | Group by dependency: TX-A cancellations + data removals + zero-balance trustline deletions; TX-B(i) per-asset disposal (or several assets per transaction when confident); TX-C remaining deletions + merge last. Minimum count *subject to fault isolation* — say so in the README. | Sequential; stop on the first failure; re-plan. | none [S9] | Medium / [C]+[D] |
| T-02 | Fee-bump minimum fee: outer fee < (inner ops + 1) × base, or < inner fee, or lower per-op rate than the inner. | Fee estimate per step = `baseFee × (ops + 1)` on the sponsor; the closed account pays 0. | Build with `TransactionBuilder.buildFeeBumpTransaction` (F16); pick `baseFee` from `/fee_stats` (`max_fee.p50` was 204,000 stroops on testnet, F27) with a cap. | `txINSUFFICIENT_FEE` [S3][S4][S40] | High / [C] |
| T-03 | Inner transaction fee. | Set the inner fee to `100 × ops` (conventional) or 0 (allowed by CAP-15; makes the inner XDR unsubmittable on its own — U10 for the SDK). Either way the inner source is never charged (F15). | Same. | none [S4] | Low / [C]+[H] |
| T-04 | Surge pricing (`max_tx_set_size` is only 200 on testnet, F27). | Read `/fee_stats` before each submission. | On `txINSUFFICIENT_FEE` (not queued): resubmit with a higher fee. If the previous fee bump is still *queued*, the replacement needs ≥ 10× the previous fee rate (F15); otherwise wait for the time bound to expire and rebuild. | `txINSUFFICIENT_FEE` [S3][S8] | Medium / [C] |
| T-05 | `txBAD_SEQ` after a partial failure: TX-N failed with `txFAILED` (sequence consumed) vs rejected at validation (sequence not consumed). | Never pre-sign a chain with precomputed sequence numbers. | Reload the account sequence before building every transaction; after any failure re-plan from chain state. | `txBAD_SEQ`, `txFAILED` [S22][S41] | High / [C] |
| T-06 | Horizon 504 timeout. | n/a | Not a failure: poll `GET /transactions/{hash}` (outer hash; store the inner hash too, U2) until included or until the time bound has passed; resubmitting the identical envelope is safe (F20). Do not build a replacement with the same sequence while the first can still be included; two different valid transactions with one sequence number race and the loser fails `txBAD_SEQ` — reconcile from chain state, never from which one "should" have won. | `txBAD_SEQ`, `txTOO_LATE` [S19][S21][S22] | High / [C] |
| T-07 | Time bounds. | The SDK forces a choice (F16): use `setTimeout(300)`; derive "now" from Horizon's latest ledger `closed_at`, not the local clock (bounds are evaluated against ledger close time, F17). | After `maxTime` passes a pending transaction can never apply → safe to rebuild with the same sequence. Optional `ledgerBounds` precondition for a hard freshness limit. | `txTOO_EARLY`, `txTOO_LATE` [S9][S22] | Medium / [C] |
| T-08 | Idempotent resubmission. | n/a | Same hash → same original response (F20); `/transactions_async` returns `DUPLICATE` for an already-submitted hash; RPC `sendTransaction` returns `DUPLICATE` likewise (F24). | none [S18][S23][S24] | Low / [C] |
| T-09 | Extra or missing signatures. | Signature plan per transaction: inner = the account's signers up to the exact threshold; outer = sponsor only. | Never sign the inner with the sponsor key; never sign the outer with the account key. | `txBAD_AUTH_EXTRA`, `txBAD_AUTH` [S33][S22] | High / [C] |
| T-10 | Network passphrase mismatch (inner built for another network). | Single network configuration object. | `txBAD_AUTH` at submission. | `txBAD_AUTH` [S22] | Low / [C] |
| T-11 | Fee-bump inner failure reporting. | n/a | Parse `extras.result_codes.transaction = tx_fee_bump_inner_failed`, `inner_transaction`, and `operations[]` to find the failing op index (F21); map the index back to the ladder step. The SDK does not parse this for you (F25 source notes). | `txFEE_BUMP_INNER_FAILED` [S4][S49] | High / [C] |
| T-12 | Horizon 429 rate limit during long matrix runs (3,600/h/IP default, F26; SDF-hosted actual limit unverified, U6). | Cache Horizon reads per plan; batch RPC `getLedgerEntries` (≤ 200 keys). | Exponential backoff on 429. | HTTP 429 [S17] | Medium / [C] |
| T-13 | Horizon vs RPC lag or divergence. | Read the account, offers and paths from Horizon (RPC has no "offers by seller"); use RPC only for sponsorship of data entries. After a 200 from `/transactions` Horizon has ingested the transaction (F20). | Poll with a small delay after `/transactions_async` or RPC submission before re-snapshotting. | none [S21] | Low / [C]+[D] |
| T-14 | Testnet reset mid-run (2–4 per year, announced; next scheduled 2026-12-16, F26). | Record `history_latest_ledger` and the network passphrase in the plan. | If the account returns 404 **and** the sponsor/destination also 404 or `history_latest_ledger` < plan ledger → "testnet reset detected"; abort; do not report success. Rebuild fixtures from the recipe. | none [S16] | Critical (evidence loss) / [C]+[D] |
| T-15 | Op ordering inside one transaction (merge in the same transaction as the last `ChangeTrust(0)`). | Allowed: operations apply in order and the merge checks subentries at its own apply time (F1, F19). Keep the merge as the **last** op of the **last** transaction. | Same. | `ACCOUNT_MERGE_HAS_SUB_ENTRIES` if misordered [S1] | Medium / [C]+[D] |
| T-16 | Amount and number hygiene: Horizon returns strings (`"0.0000005"`); JavaScript `Number` renders values below 1e-6 as `5e-7` and float arithmetic yields 17-digit fractions; the SDK rejects both. | All amounts as BigInt stroops; format with exactly 7 decimals; never `parseFloat`. | Same; property tests. | SDK error "must … represent a positive number and have at most 7 digits after the decimal" [S44] | Critical / [C] |
| T-17 | Signature count and size limits (≤ 20 signatures per transaction). | Multisig accounts beyond 20 required signatures are out of scope; report. | n/a | `txBAD_AUTH` [S33] | Low / [C] |

### 3.6 Concurrency (state changes between plan and execute)

| ID | Trigger | Planner behaviour | Executor behaviour | Result code(s) and source | Severity / grade |
|----|---------|-------------------|--------------------|---------------------------|------------------|
| C-01 | Any change to the account between plan and execute. | Plan hash = SHA-256 over a canonical snapshot: `sequence`, `last_modified_ledger`, `subentry_count`, `num_sponsoring`, `num_sponsored`, flags, thresholds, signers, every balance `(asset, balance, liabilities, flags, sponsor, last_modified_ledger)`, every offer `(id, amount, price, pair, last_modified_ledger)`, data names, destination facts, base reserve, base fee. The account's own `last_modified_ledger` is **not** enough: an incoming payment changes a trustline entry, not the account entry. | Re-snapshot before each transaction; on mismatch re-plan (bounded, default 3) and show the diff. Sequence-number preconditions cannot express "state unchanged" — there is no state-hash precondition in classic Stellar. | none [S9][S23] | High / [C]+[D] |
| C-02 | Stale offers (filled/partially filled). | See O-04. | Re-plan. | `MANAGE_SELL_OFFER_NOT_FOUND` [S1] | Medium / [C] |
| C-03 | Incoming asset payment. | See B-21. | Re-plan. | `CHANGE_TRUST_INVALID_LIMIT` [S1] | Medium / [C] |
| C-04 | Issuer claws back, revokes or re-authorizes mid-run. | n/a | Clawback: `UNDERFUNDED` → re-plan (delete). Revoke: `SRC_NOT_AUTHORIZED` → the asset becomes B-04 → stop with reason. Note the revoke also deletes the account's offers on that asset (F10) → O-04. | `*_UNDERFUNDED`, `*_SRC_NOT_AUTHORIZED`, `MANAGE_SELL_OFFER_NOT_FOUND` [S1][S11] | Medium / [C] |
| C-05 | Liquidity disappears between the path check and the path payment. | Treat step 1 as opportunistic. | Ladder fallback within the same run (no full re-plan needed). | `PATH_PAYMENT_STRICT_SEND_TOO_FEW_OFFERS`, `UNDER_DESTMIN` [S1] | Low / [C] |
| C-06 | Incoming XLM payment. | Harmless: the merge carries it. Update the recovered estimate. | Proceed. | none | Low / [D] |
| C-07 | Someone creates a claimable balance *for* the account, or sponsors nothing new (sponsorship needs the account's signature). | No effect on the merge (A-03 warning only). | Proceed. | none [S5] | Low / [C]+[D] |
| C-08 | Sponsorship of an entry transferred to another sponsor mid-run. | Cosmetic (S-03). | Refresh the report. | none [S5] | Low / [D] |
| C-09 | Base reserve or base fee changed by a network upgrade mid-run. | Read `base_reserve_in_stroops`/`base_fee_in_stroops` from the latest ledger at plan and again at execute. | Recompute. | none [S30] | Low / [C] |

### 3.7 Data representation pitfalls (input hygiene)

| ID | Trigger | Planner behaviour | Executor behaviour | Result code(s) and source | Severity / grade |
|----|---------|-------------------|--------------------|---------------------------|------------------|
| R-01 | Horizon omits optional fields: `sponsor`, `is_clawback_enabled`, `limit`, liabilities on native (F23). | Treat absence as "not set"/false; never as an error. | Same. | none [S28] | Medium / [C] |
| R-02 | Data entry names that are not valid UTF-8 (possible from non-JS SDKs). | Horizon's JSON key may not round-trip; read raw names via RPC `getLedgerEntries` if a `ManageData` delete reports `NAME_NOT_FOUND`. `Operation.manageData` accepts only a string name ≤ 64 characters (U7). | Report the entry as unclosable with reason if it cannot be addressed. | `MANAGE_DATA_NAME_NOT_FOUND` [S1][S44] | Low / [H] |
| R-03 | Data values are base64 in Horizon (`MQ==` = `"1"`). | Decode before comparing (SEP-29 check). | n/a | none [S45] | Low / [C] |
| R-04 | Offer ids and sequence numbers exceed 2^53. | Keep as strings/BigInt end to end. | Same. | none | Medium / [D] |
| R-05 | Explorer links die at the testnet reset; RPC history is bounded (F24). | n/a | Evidence package must contain envelope XDR, result XDR, result meta XDR, Horizon JSON and screenshots for every transaction, plus the ledger sequence and date. | none [S16][S25] | High / [C] |

## 4. D3 test matrix

Levels: **U** = unit (offline, against recorded Horizon/RPC snapshots or mocked responses), **I** = testnet
integration (live). Every integration case uses its own freshly funded accounts; nothing is shared with the
master fixture except the helper issuers.

Evidence conventions: `hashes` = outer fee-bump hash and inner hash per transaction; `explorer` =
`https://stellar.expert/explorer/testnet/tx/<hash>` and `/account/<G>`; `effects` =
`GET /transactions/<hash>/effects`; `state` = Horizon account JSON before and after; `xdr` = envelope +
result + result meta XDR files.

| Case | Fixture setup (testnet) | Planner expectation | Executor expectation | Evidence to capture | Level |
|------|-------------------------|---------------------|----------------------|---------------------|-------|
| **M-01 Master: messy fixture full close (binary metric)** | Section 5 recipe: FIX with DUSTA (liquid, market maker MM quotes it), DUSTB (illiquid, live issuer), DUSTC (illiquid, DST holds an authorized trustline), SPT (trustline sponsored by RSV, dust balance), 2 offers (sell DUSTA→XLM; sell DUSTC→DUSTB), 1 data entry, native exactly at the 4.0 XLM minimum; DST exists, no memo requirement. | Status `closable`. Steps: TX-A cancel 2 offers + delete data; TX-B path-pay DUSTA→XLM (self), pay DUSTC→DST (or burn, per B-12 policy), burn DUSTB, burn SPT; TX-C 4 × `ChangeTrust(0)` + `AccountMerge(DST)`. Recovered ≈ 4.0 XLM + DUSTA proceeds; "0.5 XLM returns to RSV". Fee for FIX = 0. | 3 fee-bumped transactions succeed; FIX → 404; DST credited; `RSV.num_sponsoring` −1; ISS balances unaffected except burns. | Pre-close proof of zero spendable (a 1-op unbumped transaction from FIX rejected `tx_insufficient_balance`, saved as JSON); hashes, explorer, effects (`offer_removed`×2, `data_removed`, `trade`, `trustline_removed`×4, `trustline_sponsorship_removed`, `account_removed`, `account_credited`), state, xdr; `fee_account` = SPN on every transaction. | I (+ U on the recorded snapshot) |
| S-01 Illiquid leftover balance (SOW) | DUSTB on FIX: no offers on any book; issuer ISS alive and authorized. | Step 1 skipped ("no path: `/paths/strict-send` empty"); step 2 `Payment(DUSTB → ISS)` with reason "no market; returning to issuer". | Burn succeeds; trustline deleted. | hashes, effects (`account_debited`, `trustline_removed`), state. | U + I |
| S-02 Illiquid **and frozen** → unclosable path (SOW week-3 statement) | Separate fixture FIX-B: issuer ISS-R with `AUTH_REQUIRED + AUTH_REVOCABLE`; `SetTrustLineFlags` authorize; pay dust; `SetTrustLineFlags` clear `AUTHORIZED`. | `Unclosable: trustline not authorized (issuer action required)`; status `cannot merge`; no teardown steps emitted unless `--best-effort`. | Refuses to execute by default. With `--best-effort`: everything else removed, merge skipped, exit code non-zero with the reason. Negative probe (optional): a `Payment` attempt returns `op_src_not_authorized`. | plan JSON; probe transaction failure body; state. | U + I |
| S-03 Sponsored trustline unwinding (SOW) | SPT on FIX sponsored by RSV (separate from the fee sponsor SPN). | Step "ChangeTrust(0) — RSV signature not required; reserve returns to RSV; +0 XLM for user". | Transaction signed by FIX (inner) and SPN (outer) only; `RSV.num_sponsoring` decrements; `FIX.num_sponsored` decrements. Negative control: adding RSV's signature to the inner → `tx_bad_auth_extra`. | hashes, effects (`trustline_sponsorship_removed`), RSV state before/after, negative-control failure body. | I (+ U for the signature planner) |
| S-04 `ACCOUNT_MERGE_SEQNUM_TOO_FAR` (SOW) | FIX-C: `BumpSequence(bumpTo = (latestLedger + 240) << 32)` (~20 min at 5 s/ledger). | `Blocked(merge): SEQNUM_TOO_FAR; wait ≈ 240 ledgers (~20 min)`; ETA function unit-tested at the boundary (`seq + 1 == L << 32`). | Default: refuse (ETA > `--max-wait`). Negative probe: submit the merge anyway → `op_seq_num_too_far` (transaction fails, sequence consumed). Long variant: `--max-wait 30m` → waits, then merges. | plan JSON with ETA; probe failure body; long-variant hashes. | U + I (long variant tagged slow) |
| S-05 Authorization-required trustline, authorized (SOW) | ISS-R asset on FIX-D, authorized, dust balance. | Normal ladder (burn). | Success. | hashes, effects. | I |
| S-06 Authorized-to-maintain-liabilities only | ISS-R clears `AUTHORIZED`, sets `AUTHORIZED_TO_MAINTAIN_LIABILITIES`; FIX-D also has an open offer on the asset. | `Unclosable` for the balance; offers still cancellable and planned. | `--best-effort`: offers cancelled; balance remains; merge skipped. | plan JSON; hashes of the cancel transaction. | U + I |
| S-07 Clawback-enabled trustline (SOW) | ISS-C with `AUTH_REVOCABLE + AUTH_CLAWBACK_ENABLED` set **before** FIX-E trusts it; Horizon shows `is_clawback_enabled: true`. | Normal ladder; flag noted. | Success. Variant S-07b: ISS-C claws back between plan and execute → disposal op fails `op_underfunded` → automatic re-plan → delete → merge. | hashes; the failed transaction body (`tx_fee_bump_inner_failed`/`op_underfunded`); re-plan diff. | I |
| S-08 Liquidity pool shares (SOW: detect and report) | FIX-F: trustlines to LPA and LPB (helper issuer), `ChangeTrust` to the pool-share asset, `LiquidityPoolDeposit`. | Reports pool id, share balance, "counts 2 subentries", marks pool-share trustline and both constituent trustlines `Blocked: withdraw first (out of scope)`; status `cannot merge`; `is_authorized: false` on the pool-share balance is **not** reported as frozen. | Refuses by default. Negative probe: `ChangeTrust(0)` on LPA → `op_cannot_delete`. | plan JSON; probe failure body; state. | U + I |
| S-09 Raised multisig thresholds (SOW: detect and report) | FIX-G: `SetOptions(highThreshold = 2, signer K2 weight 1)`, master weight 1. | With master only: `Unclosable(merge): need weight 2, have 1 (missing K2)`; with master + K2: `closable`, signature plan lists both. | Master only: refuse. Both keys: success; the inner carries exactly two signatures. Variant: master weight 0, K2 weight 1, thresholds 1 → closable with K2 alone. | plan JSON (both variants); hashes; `signatures` array on the inner transaction. | U + I |
| X-01 Account sponsors a claimable balance | FIX-H creates a claimable balance for a helper claimant. | `Unclosable(merge): sponsoring 1 claimable balance <id>` with the three hints (A-02). | Refuse. Negative probe: merge → `op_is_sponsor`. | plan JSON; probe body; `/claimable_balances?sponsor=` JSON. | U + I |
| X-02 Account sponsors another account's entry | FIX-H sponsors a data entry on helper H2 via sandwich. | `Unclosable(merge): sponsoring 1 entry on H2; RevokeSponsorship possible if H2 holds the reserve`. | Refuse. | plan JSON; `/accounts?sponsor=` JSON. | U (+ optional I) |
| X-03 Claimable balances claimable by the account | Helper creates a claimable balance with FIX as claimant. (As built since E4-S3, 2026-09-28: the `edge` variant `claimant`, named in two claimable balances the plain issuer creates, 0.0000001 XLM for it alone and 0.0000002 CBA for it and the issuer.) | Warning listed with amount; still `closable`. (The inspector reads `/claimable_balances?claimant=`; the warning names how many balances, their assets with the amounts, their ids, that they stay on the ledger and that the merged account can no longer claim them.) | Proceeds; warning repeated before the merge. (The CLI prints the plan's warnings before the confirmation and the report repeats them; after the merge both balances still exist, and the issuer, the other claimant, can still claim one.) | plan JSON. | U + I |
| X-04 `AUTH_IMMUTABLE` on a throwaway account | FIX-I: `SetOptions(setFlags = AUTH_IMMUTABLE)` (never on the master). | `Unclosable(permanent)` before any other step; zero teardown steps. | Refuse. | plan JSON. | U + I |
| X-05 Destination validation | Unit vectors: missing account (404), destination == source, C address, M address, memo-required destination (`config.memo_required = 1`). Integration: DST-M with the data entry. | Missing → `Unclosable(merge)`; == source → validation error; C → rejected; M → allowed, memo check skipped; memo-required → `--memo` required. | Integration: without `--memo` the SDK throws `AccountRequiresMemoError` before submission; with `--memo` the merge transaction carries the memo. | plan JSON; transaction `memo`/`memo_type` in Horizon. | U + I |
| X-06 Destination trustline states | DST holds DUSTC authorized (limit ample); DST-L holds it with `limit = balance` (no room); DST-U holds it unauthorized. | Step 3 chosen only for the first; the others fall to burn with the stated reason (`LINE_FULL`, `NOT_AUTHORIZED`). | Matches the plan. | plan JSON; hashes. | U + I |
| X-07 Offer types | FIX-J: a sell offer, a `ManageBuyOffer` buy offer, a `CreatePassiveSellOffer` offer, and an offer **selling XLM**. (As built since E4-S3: the `edge` variant `offer-types`, with a buy offer, a passive sell offer and a sell offer that sells XLM, its balance its minimum plus its native selling liabilities, so spendable is 0; plain sell offers are the messy fixture's.) | All four cancelled with `ManageSellOffer(amount 0)`; spendable computed net of the XLM selling liability. | All cancellations in TX-A succeed. | hashes; effects (`offer_removed`×4); state (`selling_liabilities` gone). (Recorded: the transaction hash and Horizon's record of it, a fee bump paid by the sponsor, no `trade` effect, and `account_removed`: the account is merged, so its liabilities go with it.) | I |
| X-08 Stale offer | Plan on FIX-J, then MM fills one offer, then execute. (As built since E4-S3: the `edge` variant `offer-stale` offers its whole OFC balance for XLM; the plain issuer takes it with a strict-receive path payment right before the executor posts its first envelope.) | n/a | First attempt fails `op_not_found` (whole transaction); executor re-plans and succeeds. (Horizon's code is `op_offer_not_found`.) | both transaction bodies; re-plan diff. | I |
| X-09 Incoming payment after plan | Plan, then helper sends 1 stroop of DUSTB to FIX, then execute. | n/a | Plan-hash mismatch detected before submission (balance `last_modified_ledger` changed) → re-plan → success. Variant with the check disabled: `op_invalid_limit` on the delete. | diff output; failure body of the variant. | U + I |
| X-10 Dust below DEX resolution | DUSTA balance 0.0000003 with MM price 0.1 XLM per DUSTA. | Step 1 planned as "expected to round to zero". | Path payment fails (`op_too_few_offers` or `op_under_destmin`, record which — U4) → burn. | failure body; final hashes. | I |
| X-11 Own offers are the only liquidity | FIX-K holds its own offer that sells XLM for DUSTA, the only liquidity for a DUSTA → XLM sale; no MM. (Corrected 2026-09-28: this row first had FIX-K sell DUSTA, an offer on the other side of the book that is no liquidity for this sale. An account at exactly its minimum balance cannot back an offer that sells XLM, which needs XLM above the minimum for its reserve and its selling liabilities, so the live fixtures did not build this row at first. Since E4-S3 the `edge` variant `offer-types` builds it live: its offer sells XLM for OFA, its balance is its minimum plus that offer's selling liabilities, so spendable is still 0, and Horizon's only OFA to XLM quote runs through that offer; see `docs/test-matrix.md`.) | Own offers excluded → step 2 planned directly. Regression: a planner that consults `/paths` naively would plan step 1. | Success via burn; negative variant (no cancel first): `op_cross_self`. | plan JSON; negative-variant body. | U + I |
| X-12 Op-limit chunking and ordering invariants | Synthetic snapshot: 250 offers, 60 trustlines with balances, 5 data entries. | ≥ 4 transactions; invariants: cancels of an asset before its disposal; disposal before its delete; merge last and alone at the end; no transaction > 100 ops. Optional live: 120 offers (60 XLM reserve). | Sequential submission with per-transaction re-snapshot. | plan JSON; property-test log. | U (+ optional I) |
| X-13 Fee-bump fee math and surge | Unit: fee < (n+1)×base; fee < inner; per-op rate; RBF 10×. Mocked Horizon: `tx_insufficient_fee` then success. | Fee estimates per step match `baseFee × (ops + 1)`. | Retry policy: raise fee; respect 10× when a previous bump is queued. | unit log; mocked-run log. | U |
| X-14 504 timeout and `tx_bad_seq` reconciliation | Mocked Horizon: 504, then the transaction appears on `GET /transactions/{hash}`; second mock: 504 then `tx_bad_seq` on resubmission with the original included. | n/a | Polls by hash; never treats `tx_bad_seq` as failure without checking inclusion; never double-applies. | mocked-run log. | U |
| X-15 Testnet reset detection | Mocked root with `history_latest_ledger` below the plan's ledger and 404 for all accounts. (As built in E4-S3: `dustin fixture verify` compares the manifest's highest recorded ledger with Horizon's latest ledger, and for an account that answers 404 reads `/accounts/<id>/operations`: history ending in the account's own `account_merge` means closed, no history means reset.) | n/a | Aborts with "testnet reset detected"; exit code distinct from success. (Error `RESET_SUSPECTED`, exit 3; a merged account is reported as closed, with the merge, not as a reset.) | mocked-run log. | U |
| X-16 Fully sponsored account with 0.0000000 XLM (bonus) | RSV sponsors the account creation of FIX-L with starting balance 0 and one trustline. | `closable`; recovered 0 XLM; "2.5 base reserves return to RSV". (Corrected in E4-S3: 1.5 XLM, three base reserves, the account entry's two and the trustline's one, return to RSV.) | Merge transfers 0 XLM; `RSV.num_sponsoring` −3; FIX-L → 404. | hashes; effects (`account_sponsorship_removed`, `account_removed`); state. | I |
| X-17 Numeric hygiene | Property tests: balances `"0.0000001"`…`"922337203685.4775807"`, liabilities subtraction, 7-decimal formatting, ids > 2^53. | No `Number` in amount paths; SDK never throws on generated amounts. | n/a | test log. | U |
| X-18 Sponsored signer | FIX-M has signer K3 sponsored by RSV. | "Signer K3 removed by merge; reserve returns to RSV". | `RSV.num_sponsoring` −1 after the merge. | effects (`signer_sponsorship_removed`); RSV state. | I |
| X-19 Rate limiting | Mocked 429 with backoff. | n/a | Retries with backoff; total wall time bounded. | mocked-run log. | U |
| **B-01 Baseline: existing tool on the master fixture (0 spendable)** | Rebuild the master fixture from the same recipe (FIX-base-1) and open the StellarExpert Account Demolisher on it. | n/a | To be observed and recorded, not assumed: (a) does it build/submit a transaction at all; (b) if it submits, the exact Horizon failure (`tx_insufficient_balance` expected for an unbumped transaction from a zero-spendable account); (c) what "recoverable XLM" it displays vs the 4.0 XLM reserve of which 0.5 belongs to RSV; (d) whether a co-signing or minimum-payout rule stops it (SOW claims, unverified — U5). | screen recording; browser network log (request/response bodies); Horizon state before/after (must be unchanged). | I (recording) |
| B-02 Baseline: existing tool on the master fixture plus 1 XLM spendable | Same recipe (FIX-base-2), then add 1 XLM. | n/a | Observe how far it gets: offers, DUSTA sale, DUSTB/DUSTC handling, sponsored trustline (removal itself works protocol-wise — the difference is accounting), merge. Record every transaction hash it produces. | recording; hashes; state. | I (recording) |
| B-03 Dustin on the identical rebuilt fixtures | FIX-base-1 and FIX-base-2 rebuilt again from the recipe (same manifest hash). | `closable` on both. | Full close on both; side-by-side table: tool, transactions submitted, stop point, final account state, XLM delivered to DST. | hashes; explorer; comparison table in the evidence package. | I |

## 5. Fixture construction recipe

### 5.1 Accounts

| Alias | Role | Funding |
|-------|------|---------|
| SPN | Fee sponsor (fee source of every fee bump; env key) | friendbot (10,000 XLM) |
| RSV | Reserve sponsor of the sponsored trustline (kept separate from SPN on purpose, S-07) | friendbot |
| ISS | Helper issuer of DUSTA, DUSTB, DUSTC | friendbot |
| ILQ | Issuer of the deliberately illiquid asset (ILQX) | friendbot |
| ISS-R, ISS-C | Issuers for the auth-required and clawback cases (separate fixtures) | friendbot |
| MM | Market maker quoting DUSTA/XLM so that ladder step 1 has a path | friendbot |
| DST | Destination; holds an authorized DUSTC trustline | friendbot |
| SINK | Receives the drained XLM | friendbot |
| FIX | The account to close (master fixture) | friendbot, then drained |

All keys live in a manifest file (`fixtures/<name>.json`: public keys, secrets for testnet only, creation
ledger, transaction hashes, and the SHA-256 of the recipe parameters). The manifest is what B-03 uses to
prove "identical fixture".

### 5.2 Ordered steps for the master fixture (FIX)

Every step is one transaction; the expected Horizon state after the step is the assertion the fixture
script checks before continuing.

1. Fund SPN, RSV, ISS, ILQ, MM, DST, SINK, FIX via `https://friendbot.stellar.org/?addr=<G>` (10,000 XLM
   each; friendbot is rate limited — space the calls). Assert each account loads.
2. ISS: nothing to configure (no auth flags) — DUSTA/DUSTB/DUSTC are plain assets. ILQ: same.
3. FIX: `ChangeTrust(DUSTA)`, `ChangeTrust(DUSTB)`, `ChangeTrust(DUSTC)` in one transaction (3 ops).
   Assert `subentry_count = 3`.
4. ISS → FIX: `Payment(DUSTA 0.0000007)`, `Payment(DUSTB 0.0000003)`, `Payment(DUSTC 0.0000005)`
   (one transaction, 3 ops). Amounts are deliberately below 1e-6 to exercise T-16. Assert the three
   balances as strings.
5. MM: `ChangeTrust(DUSTA)`, then a resting offer buying DUSTA for XLM (e.g. `ManageBuyOffer` buy 10 DUSTA
   at 1 XLM each) so `/paths/strict-send?source_asset=DUSTA&source_amount=0.0000007&destination_assets=native`
   returns a path with a non-zero `destination_amount`. Assert the path.
6. DST: `ChangeTrust(DUSTC, limit 1000)`. Assert DST shows the trustline (authorized by default since ISS has
   no `AUTH_REQUIRED`).
7. FIX: two offers in one transaction: `ManageSellOffer(sell 0.0000002 DUSTA for XLM at price 1)` and
   `ManageSellOffer(sell 0.0000002 DUSTC for DUSTB at price 1)`. Neither offer sells XLM, so the native
   selling liability stays 0 and "spendable = 0" later is unambiguous (O-02). Assert `subentry_count = 5`,
   `selling_liabilities` on DUSTA and DUSTC.
8. FIX: `ManageData("dustin.fixture", "v1")`. Assert `subentry_count = 6`, `data` has one key.
9. Sponsored trustline (SPT = asset `SPTA` issued by ISS): one transaction with source RSV, ops
   `BeginSponsoringFutureReserves(sponsoredId = FIX)` (source RSV), `ChangeTrust(SPTA)` (source FIX),
   `EndSponsoringFutureReserves` (source FIX); signed by RSV and FIX (F14). Then ISS → FIX
   `Payment(SPTA 0.0000001)`. Assert `subentry_count = 7`, `num_sponsored = 1`, the SPTA balance shows
   `sponsor = RSV`, and `RSV.num_sponsoring = 1`.
10. Compute the minimum balance from live data (F11): read `base_reserve_in_stroops` from
    `GET /ledgers?order=desc&limit=1` (5,000,000 on 2026-09-25) and the account's `subentry_count`,
    `num_sponsoring`, `num_sponsored`:
    `min = (2 + 7 + 0 - 1) × 0.5 XLM = 4.0 XLM = 40,000,000 stroops`.
    Do the arithmetic in stroops (BigInt). Assert `min` equals the value the SDK-side reserve function
    returns (this is also the planner's reserve function, so the fixture doubles as its test).
11. Drain: `Payment(FIX → SINK, balance − min)` **fee-bumped by SPN** so no fee leaves FIX and the amount is
    exactly `balance − min`. (If the drain is not fee-bumped, subtract the drain transaction's own fee:
    `amount = balance − min − 100 stroops`; the result must still be exactly `min`.) Assert
    `balance == "4.0000000"` and `selling_liabilities` on native is `0`.
12. Proof of zero spendable (evidence for M-01): build a 1-op transaction from FIX with fee 100 and **no**
    fee bump (e.g. `ManageData` no-op) and submit it; expect HTTP 400 `tx_insufficient_balance` ("fee would
    bring account below reserve", F17). Save the response body. The sequence number is not consumed by a
    validation failure.
13. Snapshot FIX, RSV, DST, ISS, MM (Horizon JSON) into `fixtures/snapshots/` — these are the offline test
    vectors for the planner (SOW: "testable offline against a fixture account").

Resulting fixture: 4 trustlines with non-zero balances (3 required + the sponsored one), 2 open offers,
1 data entry, 0 spendable XLM, 1 sponsored subentry — satisfying every line of the SOW's Appendix B.

### 5.3 The deliberately illiquid throwaway asset

- ILQX issued by ILQ to a throwaway holder account FIX-B (or added to FIX only in the *non-master* runs).
  No offers on any ILQX book, no pool. Verify: `/order_book?selling_asset=ILQX…&buying_asset_type=native`
  has empty bids/asks and `/paths/strict-send` returns no records.
- Expected outcome with a live issuer: ladder falls to **burn** and the account still closes (B-02). This
  is the "illiquid leftover balance" case of D3.
- For the "exits through the unclosable path with a stated reason" statement in the SOW, ILQX alone is not
  enough (F8). Use ISS-R with `AUTH_REQUIRED + AUTH_REVOCABLE`, authorize FIX-B, pay dust, then clear
  `AUTHORIZED` (`SetTrustLineFlags`). Keep this on a separate account: a frozen balance would make the
  master fixture unmergeable and fail the binary metric.

### 5.4 Testnet reset cadence and rebuild strategy

- Resets happen 2–4 times per year at 17:00 UTC, announced at least two weeks in advance; the scheduled
  2026 date is 2026-12-16 (F26). Nothing built now is expected to survive past that date.
- `dustin fixtures build --name master` must be idempotent and fast (≈ 12 transactions), write the manifest,
  and refuse to run if the manifest's `network_passphrase` differs or if `history_latest_ledger` is lower
  than the manifest's creation ledger (reset detected → rebuild from scratch, new keys).
- The evidence package must not depend on the explorer staying up: store XDRs, Horizon JSON and screenshots
  alongside the links, and record the ledger sequence and date of every transaction. Run the final evidence
  run at least a week before any announced reset; subscribe to the status page for announcements.

## 6. Top 10 threats to the binary success metric, with mitigations

1. **An unclosable balance inside the master fixture.** The SOW's own wording puts the "illiquid asset that
   exits through the unclosable path" in the account that must merge. Any unauthorized trustline blocks
   the merge forever (F7, F9). Mitigation: master fixture holds only disposable balances; the unclosable
   path is tested on FIX-B (S-02).
2. **Dust amounts through JavaScript numbers** (`5e-7`, 17-digit fractions) — the SDK throws or the wrong
   amount is sent; every fixture balance is below 1e-6 by design (F28, T-16). Mitigation: BigInt stroops,
   7-decimal formatting, property tests (X-17).
3. **Fee-bump fee rules** (fee < (n+1)×base, fee < inner fee, rate rule, 10× replace-by-fee) → repeated
   `tx_insufficient_fee` on a testnet where `max_fee.p50` was 204,000 stroops (F15, F27). Mitigation: SDK
   builder plus `/fee_stats`, unit tests (X-13).
4. **504 / duplicate submission mishandled as failure** → executor rebuilds with a new sequence, the original
   lands, everything after fails `tx_bad_seq` and the account state no longer matches the plan (F20).
   Mitigation: poll by hash, never pre-sign chains, reconcile from chain state (T-05, T-06, X-14).
5. **Own offers counted as liquidity** → step 1 fails after the cancellation, or `OFFER_CROSS_SELF` if the
   cancellation is missing (B-24). Mitigation: exclude own offers; ladder fallback in the executor.
6. **Stale plan** (offer filled, incoming payment, clawback) → `op_not_found` / `op_invalid_limit` /
   `op_underfunded` fail the whole transaction (C-01..C-04). Mitigation: per-entry `last_modified_ledger`
   in the plan hash, dispose + delete in one transaction, bounded re-plan loop (X-08, X-09).
7. **Reserve math wrong when draining** (forgetting `num_sponsored`, the drain's fee, or an XLM-selling
   offer) → the fixture keeps spendable XLM (metric line "zero spendable" fails) or the drain is rejected.
   Mitigation: compute from live ledger fields in stroops and prove it with the rejected unbumped
   transaction (5.2 steps 10–12).
8. **Signature mistakes** — sponsor signing the inner (`tx_bad_auth_extra`), missing weight for the
   high-threshold merge, wrong passphrase (F18, T-09). Mitigation: signature plan per transaction; negative
   control in S-03 and S-09.
9. **Evidence loss** — testnet reset (scheduled 2026-12-16), Horizon/RPC retention, dead explorer links
   (F26, R-05). Mitigation: archive XDR + JSON + screenshots, dates and ledger numbers; finish the evidence
   run early; rebuildable fixtures.
10. **Hidden merge blockers on the fixture** — a claimable balance created while experimenting
    (`num_sponsoring > 0` → `op_is_sponsor`), a pool deposit on the wrong account (`op_cannot_delete`), or
    `AUTH_IMMUTABLE` set by accident (permanent) (A-02, A-06, A-13). Mitigation: one account per test case,
    the planner's first three checks (immutable, sequence, sponsorship) run before any teardown, and the
    fixture builder never issues `SetOptions` flags or claimable balances on FIX.

## Assumptions

- A1. Testnet only, protocol 28, Horizon 29.0.0 as observed on 2026-09-25; the analysis is protocol-level
  and should hold on later versions unless a CAP changes the cited rules.
- A2. Reads come from Horizon (offers by seller, paths, order books, accounts) with RPC `getLedgerEntries`
  only for data-entry sponsorship; submissions may go through Horizon `/transactions`.
- A3. Destination is a G or M address that already exists; Dustin never creates it.
- A4. The fee sponsor holds enough XLM and is configured through an environment key (SOW); the reserve
  sponsor of the fixture's sponsored trustline is a separate account.
- A5. The disposal ladder order is treated as the SOW writes it, with B-12 recorded as a recommended change
  rather than applied silently.
- A6. "Illiquid" means no offer path on the DEX; "unclosable" means the balance cannot move by any
  operation available to the account.
- A7. The closing account's master key is available except in the multisig cases, where the extra keys are
  supplied explicitly; no hardware or remote signers.
- A8. The investigate skill's case file was folded into this document (hand-off brief, stronghold facts,
  graded findings, missing evidence) because the task allowed writing exactly one file.
- A9. One fresh account per integration case; helper issuers may be shared.
- A10. Ledger cadence ≈ 5 s is an observation used only for ETA text, not a protocol constant.
- A11. The SOW's description of the existing tool's behaviour is treated as a hypothesis to be recorded in
  B-01/B-02, not as a fact.
- A12. Severity ratings weigh the binary metric first, irreversibility second, developer time third.

## Unverified items

- U1. Whether Horizon `/paths` considers liquidity pools as well as order books (the path-payment guide says
  the *operation* uses "order books and/or liquidity pools"; Horizon's changelog could not be fetched).
  Impact: step 1 may find pool liquidity the planner cannot see, or vice versa.
- U2. Whether Horizon `GET /transactions/{hash}` accepts the inner hash of a fee bump; store both hashes and
  poll the outer one.
- U3. Friendbot behaviour on an already-funded account (the Lab page suggests accounts "with balance under
  10,000 XLM" can be funded again); the recipe only funds fresh accounts.
- U4. The exact result code when a strict-send path payment's conversion rounds to zero (`TOO_FEW_OFFERS`
  vs `UNDER_DESTMIN`); observe in X-10. Answered 2026-09-28 (story E3-S1, matrix row X-10, two live runs):
  with the only bid re-priced so that the dust would buy 0.7 stroop of XLM, Horizon's strict-send path finder
  returned no record at all (not a record of 0.0000000), and a strict send forced by hand with `destMin` 1
  stroop was included and failed with `op_under_dest_min` (`PATH_PAYMENT_STRICT_SEND_UNDER_DESTMIN`), not
  `op_too_few_offers`. The planner reads the missing record as "no path" and returns the dust to its issuer.
- U5. The StellarExpert Account Demolisher's source location and its "server co-signs merges above 1 XLM"
  and fee behaviour: no repository named demolisher exists under the stellar-expert organisation as of
  2026-09-25 and `stellar.expert/demolisher` renders only an app shell. Update 2026-09-25: the competitive landscape document located the client source inside the explorer monorepo (the stellar-expert-explorer repository, https://github.com/stellar-expert/stellar-expert-explorer, MIT, `business-logic/demolisher/demolisher-tx-builder.js`), found the route present in current source, observed the testnet co-sign endpoint responding, and confirmed the below-1-XLM refusal by a black-box probe (0.5 and 0.9999999 XLM payouts rejected with HTTP 400, 1 and 5 XLM signed); U5 is therefore observed behaviour, still to be shown in the B-01 recording. The GitHub search instead surfaced
  three unrelated repositories: scf-account-demolisher ("SCF RFP MVP: TS SDK to safely drain
  subentries and ACCOUNT_MERGE a Stellar account with mandatory dry-run preview", pushed 2026-09-10;
  https://github.com/bleu/scf-account-demolisher), account-demolisher
  (https://github.com/bytemaster333/account-demolisher) and Stellar-Account-Demolisher
  (https://github.com/AlphaTechini/Stellar-Account-Demolisher) — prior art the write-up should
  acknowledge; the last two were not reviewed. Cited by project name and URL (canonical decision 15).
- U6. The SDF-hosted testnet Horizon's actual rate limit and RPC retention window (defaults are documented;
  deployments may differ).
- U7. Whether `Operation.manageData` can address a data entry whose name is not valid UTF-8 (js-xdr may
  accept a `Buffer`; not checked).
- U8. Self-destination path payments (`destination = source`, different assets): no rejecting check was
  found in core; confirm in M-01 before relying on it, otherwise pay proceeds to DST directly. Answered: they
  work. Day-1 experiment 14 (2026-09-26, `docs/progress-log.md`) applied a `pathPaymentStrictSend` DUST → XLM
  to the sending account itself, with the `changeTrust "0"` in the same transaction, and 7 stroops of proceeds
  landed in the account. On 2026-09-28 both metric closes of M-01 (story E3-S7,
  `evidence/runs/20260928T112239Z-e3/` and `evidence/runs/20260928T112252Z-e3-cli/`) sold DUSTA the same way,
  to the closing account itself, and the merge carried the proceeds to the destination.
- U9. Horizon `/assets?asset_issuer=` as the way to detect that the closing account is an issuer with
  outstanding supply.
- U10. Whether `TransactionBuilder` accepts an inner fee of `"0"`; CAP-15 allows it at the protocol level.
- U11. Horizon omits `is_clawback_enabled` when false (Go struct is `*bool omitempty`; observed absent on a
  non-clawback trustline); treat absence as false, confirm on the S-07 fixture. Answered: confirmed on
  2026-09-26 (day-1 notes in `docs/progress-log.md`) and on 2026-09-28 on the `edge` fixture (story E3-S6,
  matrix row S-07): Horizon showed `is_clawback_enabled: true` on both CLAW trustlines, and in the Horizon
  JSON recorded from an `edge` build that day (`test/fixtures/horizon/edge/`) the field appears on those two
  trustlines only.
- U12. `ACCOUNT_MERGE_SEQNUM_TOO_FAR` uses the ledger in which the merge *applies*; the planner's ETA uses
  the latest known ledger + 1, which is conservative.

## Sources

- [S1] List of operations (parameters, thresholds, result codes) — https://developers.stellar.org/docs/learn/fundamentals/transactions/list-of-operations
- [S2] Horizon operation result codes, account merge — https://developers.stellar.org/docs/data/apis/horizon/api-reference/errors/result-codes/operation-specific/account-merge
- [S3] Fee-bump transactions guide — https://developers.stellar.org/docs/build/guides/transactions/fee-bump-transactions
- [S4] CAP-0015 Fee-bump transactions — https://github.com/stellar/stellar-protocol/blob/master/core/cap-0015.md
- [S5] Sponsored reserves guide — https://developers.stellar.org/docs/build/guides/transactions/sponsored-reserves
- [S6] CAP-0033 Sponsored reserves — https://github.com/stellar/stellar-protocol/blob/master/core/cap-0033.md
- [S7] Lumens: base reserve and minimum balance — https://developers.stellar.org/docs/learn/fundamentals/lumens
- [S8] Fees, resource limits and metering — https://developers.stellar.org/docs/learn/fundamentals/fees-resource-limits-metering
- [S9] Operations and transactions (limits, preconditions, atomicity) — https://developers.stellar.org/docs/learn/fundamentals/transactions/operations-and-transactions
- [S10] Accounts (subentries, 1,000 limit) — https://developers.stellar.org/docs/learn/fundamentals/stellar-data-structures/accounts
- [S11] Controlling access to an asset with flags — https://developers.stellar.org/docs/tokens/control-asset-access
- [S12] Clawbacks guide — https://developers.stellar.org/docs/build/guides/transactions/clawbacks
- [S13] CAP-0038 Automated market makers (pool-share reserves, `CHANGE_TRUST_CANNOT_DELETE`) — https://github.com/stellar/stellar-protocol/blob/master/core/cap-0038.md
- [S14] Liquidity on Stellar: SDEX and liquidity pools (authorization section) — https://developers.stellar.org/docs/learn/fundamentals/liquidity-on-stellar-sdex-liquidity-pools
- [S15] SEP-0029 Account memo requirements — https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0029.md
- [S16] Networks (testnet reset, friendbot, endpoints) — https://developers.stellar.org/docs/networks
- [S17] Horizon rate limiting — https://developers.stellar.org/docs/data/apis/horizon/api-reference/structure/rate-limiting
- [S18] Horizon: submit a transaction — https://developers.stellar.org/docs/data/apis/horizon/api-reference/submit-a-transaction
- [S19] Horizon error: timeout — https://developers.stellar.org/docs/data/apis/horizon/api-reference/errors/http-status-codes/horizon-specific/timeout
- [S20] Horizon error: transaction failed — https://developers.stellar.org/docs/data/apis/horizon/api-reference/errors/http-status-codes/horizon-specific/transaction-failed
- [S21] Horizon error handling for transaction submissions — https://developers.stellar.org/docs/data/apis/horizon/api-reference/errors/error-handling
- [S22] Horizon transaction result codes — https://developers.stellar.org/docs/data/apis/horizon/api-reference/errors/result-codes/transactions
- [S23] Horizon: submit a transaction asynchronously — https://developers.stellar.org/docs/data/apis/horizon/api-reference/submit-async-transaction
- [S24] RPC sendTransaction — https://developers.stellar.org/docs/data/apis/rpc/api-reference/methods/sendTransaction
- [S25] RPC getTransaction — https://developers.stellar.org/docs/data/apis/rpc/api-reference/methods/getTransaction
- [S26] RPC getLedgerEntries — https://developers.stellar.org/docs/data/apis/rpc/api-reference/methods/getLedgerEntries
- [S27] Horizon account object — https://developers.stellar.org/docs/data/apis/horizon/api-reference/resources/accounts/object
- [S28] Horizon protocol Go structs (`omitempty` fields, fee-bump fields) — https://github.com/stellar/go/blob/master/protocols/horizon/main.go
- [S29] Horizon endpoint parameter definitions (OpenAPI `ParamsDetails.json` for list-all-accounts, list-all-claimable-balances, get-all-offers, list-strict-send-payment-paths) — https://github.com/stellar/stellar-docs/tree/main/docs/data/apis/horizon/api-reference
- [S30] Horizon ledger object (`base_fee_in_stroops`, `base_reserve_in_stroops`) — https://developers.stellar.org/docs/data/apis/horizon/api-reference/resources/ledgers/object
- [S31] Horizon fee stats object — https://developers.stellar.org/docs/data/apis/horizon/api-reference/aggregations/fee-stats/object
- [S32] Horizon effect types — https://developers.stellar.org/docs/data/apis/horizon/api-reference/resources/effects/types
- [S33] Signatures and multisig (thresholds, master weight 0, `TX_BAD_AUTH_EXTRA`, 20 signatures) — https://developers.stellar.org/docs/learn/fundamentals/transactions/signatures-multisig
- [S34] Pooled accounts, muxed accounts and memos (supported operations) — https://developers.stellar.org/docs/build/guides/transactions/pooled-accounts-muxed-accounts-memos
- [S35] Path payments guide — https://developers.stellar.org/docs/build/guides/transactions/path-payments
- [S36] stellar-core `MergeOpFrame.cpp` — https://github.com/stellar/stellar-core/blob/master/src/transactions/MergeOpFrame.cpp
- [S37] stellar-core `ChangeTrustOpFrame.cpp` — https://github.com/stellar/stellar-core/blob/master/src/transactions/ChangeTrustOpFrame.cpp
- [S38] stellar-core `PathPaymentOpFrameBase.cpp` and `PathPaymentStrictReceiveOpFrame.cpp` (`shouldBypassIssuerCheck`, `checkIssuer`, authorization checks) — https://github.com/stellar/stellar-core/blob/master/src/transactions/PathPaymentOpFrameBase.cpp
- [S39] stellar-core `ManageOfferOpFrameBase.cpp` — https://github.com/stellar/stellar-core/blob/master/src/transactions/ManageOfferOpFrameBase.cpp
- [S40] stellar-core `FeeBumpTransactionFrame.cpp` — https://github.com/stellar/stellar-core/blob/master/src/transactions/FeeBumpTransactionFrame.cpp
- [S41] stellar-core `TransactionFrame.cpp` (sequence and fee processing, `txBAD_SEQ`, `txBAD_SPONSORSHIP`) — https://github.com/stellar/stellar-core/blob/master/src/transactions/TransactionFrame.cpp
- [S42] stellar-core `OfferExchange.cpp` (rounding, `REDUCED_TO_ZERO`) — https://github.com/stellar/stellar-core/blob/master/src/transactions/OfferExchange.cpp
- [S43] stellar-core `TrustLineWrapper.cpp` (`IssuerImpl`) — https://github.com/stellar/stellar-core/blob/master/src/ledger/TrustLineWrapper.cpp
- [S44] js-stellar-base `operation.js` (amount validation), `operations/manage_data.js`, `transaction_builder.js` (`buildFeeBumpTransaction`, time bounds) — https://github.com/stellar/js-stellar-base/tree/master/src
- [S45] js-stellar-sdk `horizon/server.ts` (`checkMemoRequired`, `submitTransaction`) — https://github.com/stellar/js-stellar-sdk/blob/master/src/horizon/server.ts
- [S46] Live read-only observations on 2026-09-25: `https://horizon-testnet.stellar.org/` (root), `/ledgers?order=desc&limit=1`, `/fee_stats`, `/accounts/<USDC issuer>`, `/accounts?liquidity_pool=…`, `/offers?…&limit=201`, `/paths/strict-send?…`, and `https://soroban-testnet.stellar.org` `getNetwork` / `getLatestLedger`
- [S47] Accepted Statement of Work — `SUCCESSFUL_SOW.md` in this repository
- [S48] Stellar Lab, account page (friendbot amount) — https://developers.stellar.org/docs/tools/lab/account
- [S49] Stellar Disbursement Platform troubleshooting (Horizon `extras` format for fee-bump failures) — https://developers.stellar.org/docs/platforms/stellar-disbursement-platform/admin-guide/troubleshooting
- [S50] GitHub REST search for "demolisher stellar" and the stellar-expert organisation repository list, queried 2026-09-25
