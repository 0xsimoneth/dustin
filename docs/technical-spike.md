# Dustin — Technical Spike

Status: research only, no code. Written 2026-09-25 against the accepted SOW (`SUCCESSFUL_SOW.md`).
Network facts were checked live on 2026-09-25 (Horizon testnet reports horizon 29.0.0 / stellar-core 29.0.0 /
protocol 28 [S43]). Every claim carries a source tag `[Sn]` resolved in "Sources". Anything not confirmed by
a primary source is tagged **unverified** and repeated in "Unverified items".

Legend: `core` = stellar-core source on `master`; `SDK` = `@stellar/stellar-sdk` 17.1.0 as installed from npm
(type definitions and emitted JavaScript were read directly) [S36]; `docs` = developers.stellar.org.

---

## 0. Executive summary

Five protocol facts the whole design rests on (all verified):

1. **A fee-bumped inner transaction pays nothing and is not checked for fee or balance.** core skips the
   minimum-fee and available-balance checks on the inner transaction (`chargeFee == false`), the fee source
   pays `baseFee × (innerOps + 1)`, and the inner sequence number is consumed [S4][S5][S2][S3]. So a
   zero-spendable account can source every close transaction. The inner fee may be anything non-negative,
   including 0 [S3].
2. **AccountMerge fails, in this order, on:** missing destination → `AUTH_IMMUTABLE` → any non-signer
   subentry → `seqNum >= (ledgerSeq << 32)` → `numSponsoring > 0` (or mid-sandwich sponsoring) → destination
   full. Signers never block a merge; they are removed automatically [S8][S1].
3. **`ACCOUNT_MERGE_SEQNUM_TOO_FAR` has no operation-level remedy.** BumpSequence can only raise a sequence
   number (a lower `bumpTo` is a silent no-op) [S11]; the only remedy is waiting until the ledger sequence
   exceeds `sequence >> 32` [S8][S10]. It is unreachable without a prior BumpSequence.
4. **A sponsored trustline is deleted by its owner alone** (`changeTrust` with `limit: "0"`, no sponsor
   signature); core releases the reserve via `removeEntryWithPossibleSponsorship`, decrementing the sponsor's
   `numSponsoring` and the owner's `numSponsored`, so the 0.5 XLM returns to the sponsor, not the account
   [S9][S7][S6]. Deleting needs `balance == 0` **and** `buying_liabilities == 0`
   (`limit >= balance + buyingLiabilities`), no authorization check, no issuer-existence check [S9][S10].
5. **The StellarExpert Demolisher is entirely self-funded by the account being closed** and never uses a
   fee bump; every transaction is built with `new TransactionBuilder(new Account(source, seq), {fee: baseFee})`,
   signed with pasted secret keys and sent with `server.submitTransaction` [S38]. For an account at its
   reserve floor the first transaction fails with `tx_insufficient_balance` and the tool gives up after
   5 retries (see §7).

SOW statements that are wrong, ambiguous, or riskier than they read (evidence in §7 and §8.4):

- **"the deliberately illiquid asset that exits through the unclosable path"** conflicts with the binary
  success metric ("fixture is fully closed and merged"). An asset that cannot be sold *and* cannot be returned
  to its issuer *and* is not held by the destination leaves a non-zero balance, which blocks `changeTrust 0`
  and therefore the merge [S9][S1]. The illiquid asset in the *main* fixture must exit via the issuer rung;
  the "unclosable" rung needs a **second** fixture account (dead issuer or de-authorized trustline).
- **"0 XLM"** is not literally achievable for a normally created account (minimum balance =
  `(2 + subentries + numSponsoring − numSponsored) × 0.5 XLM` [S10][S6]); the metric's "zero *spendable* XLM"
  is the achievable reading. A literal 0.0000000 balance is only possible if the *account entry itself* is
  sponsored (`createAccount` with `startingBalance: "0"` inside a sponsorship sandwich, allowed since
  protocol 14 [S12][S7]) — optional stretch variant, see §5.
- **"its server declines to co-sign a merge that pays out less than 1 XLM"** — the Demolisher's mediator
  server code is not in the public repo; only the client (`POST {api}/demolisher/{network}/merge`) is
  [S38]. **Unverified**; test empirically on day 1 (§8.4).
- **Testnet reset on 2026-12-16 (17:00 UTC)** [S28]: every explorer link and Horizon record in the evidence
  package disappears then. Evidence must be captured (JSON, screenshots, video) and the fixture must be
  rebuildable by script.
- **Rung 1 (path payment) will never fire on testnet unless the fixture seeds liquidity** for at least one
  dust asset (a market-maker buy offer or pool). Otherwise every asset falls to rung 2 and the evidence
  never shows a sale.
- **Competitive landscape moved**: LumenWipe (Apache-2.0, Next.js/NestJS, defaults to testnet) lists
  "sponsored fees for reserve-locked accounts" as a planned Tranche-2 item [S41]. Dustin's differentiator is
  still real today (not shipped there), but the write-up should say so precisely.
- **SEP-29** applies to `accountMerge` as well as payments [S17]; the SDK refuses to submit a memo-less
  merge/payment to an account carrying `config.memo_required` unless `skipMemoRequiredCheck` is set [S36].
  The CLI needs a `--memo` option or the close to an exchange-style destination fails client-side.

---

## 1. Inspection — what to read and where it lives

### 1.1 Does the account exist?

- `GET /accounts/{account_id}` [S19]. Live testnet probe with a random valid key returns
  `404` with body `{"type":"https://stellar.org/horizon-errors/not_found","title":"Resource Missing","status":404,...}` [S43].
  A malformed id returns `400 bad_request` with `extras.invalid_field: "account_id"` [S43] — distinguish the two.
- SDK: `Horizon.Server.loadAccount(accountId: string): Promise<AccountResponse>` (implemented as
  `accounts().accountId(id).call()`); a missing account rejects with `NotFoundError extends NetworkError`
  (`error.response.status === 404`) [S36][S25].
- After a successful merge the same call must 404 — that is the machine-checkable "account no longer exists"
  evidence. Whether `GET /accounts/{id}/operations` still serves the history of a merged account is
  **unverified** (expected yes; check on day 1).

### 1.2 The account record (Horizon `AccountRecord` / SDK `AccountResponse`)

Fields verified in the Horizon account object docs [S18] and the SDK types (`horizon/account_response.d.ts`,
`horizon/horizon_api.d.ts`) [S36]:

| Field | Type / values | Use in Dustin |
|---|---|---|
| `id`, `account_id` | string | identity |
| `sequence` | string (int64) | `BigInt(sequence)`; next tx uses `+1`; SEQNUM guard (§2.9) |
| `sequence_ledger`, `sequence_time` | number / string, optional | age of the sequence number (protocol 19 preconditions) |
| `subentry_count` | number | trustlines (pool shares count too) + offers + signers + data |
| `num_sponsoring` | number | "reserves sponsored **by** this account" — **blocks merge if > 0** |
| `num_sponsored` | number | "reserves sponsored **for** this account" — reduces its own minimum balance |
| `sponsor` | string, optional | sponsor of the account entry itself |
| `thresholds` | `{low_threshold, med_threshold, high_threshold}` | merge needs HIGH, changeTrust/payment/offers/manageData MEDIUM, bumpSequence LOW [S1] |
| `flags` | `{auth_required, auth_revocable, auth_immutable, auth_clawback_enabled}` | `auth_immutable` on the **closing** account ⇒ unmergeable; on an **issuer** ⇒ only fixes that issuer's flags |
| `balances[]` | see 1.3 | trustlines, pool shares, native |
| `signers[]` | `{key, weight, type, sponsor?}` | multisig detection (report only) |
| `data` / SDK `data_attr` | `Record<string, string>` (values **base64**) | data entries to remove; `config.memo_required` = `"MQ=="` (base64 of `"1"`) [S17][S36] |
| `last_modified_ledger` | number | evidence |

Minimum balance (core `getMinBalance`, protocol ≥ 9):
`(2 + numSubEntries + numSponsoring − numSponsored) × baseReserve` [S10]; base reserve is 0.5 XLM [S33].
Spendable ("available") XLM (core `getAvailableBalance`): `balance − minBalance − sellingLiabilities` [S10].
`planClose()` should compute both from the record and print them; "zero spendable" means `available == 0`.

### 1.3 Balance lines

Verified SDK types `BalanceLineNative`, `BalanceLineAsset`, `BalanceLineLiquidityPool` [S36] and docs [S18]:

| `asset_type` | Fields |
|---|---|
| `native` | `balance`, `buying_liabilities`, `selling_liabilities` |
| `credit_alphanum4` / `credit_alphanum12` | `balance`, `limit`, `asset_code`, `asset_issuer`, `buying_liabilities`, `selling_liabilities`, `last_modified_ledger`, `is_authorized`, `is_authorized_to_maintain_liabilities`, `is_clawback_enabled`, `sponsor?` |
| `liquidity_pool_shares` | `liquidity_pool_id`, `balance`, `limit`, `last_modified_ledger`, `is_authorized`, `is_authorized_to_maintain_liabilities`, `is_clawback_enabled`, `sponsor?` |

Rules that follow:

- Pool-share lines are **detect-and-report** (SOW). They are subentries (2 base reserves each [S34]), so an
  account holding one **cannot be closed** by Dustin; additionally the underlying asset trustlines cannot be
  deleted while the pool share exists (`liquidityPoolUseCount != 0` ⇒ `CHANGE_TRUST_CANNOT_DELETE`) [S9][S1].
  Keep pool shares out of the main fixture.
- `sponsor` present on a line ⇒ that reserve returns to the sponsor on deletion (§5).
- `is_authorized == false` ⇒ the holder cannot send the balance anywhere (payment / path payment source
  check `!sourceLine.isAuthorized()` ⇒ `SRC_NOT_AUTHORIZED`) [S13]; only the issuer can fix it
  (re-authorize or clawback). Deletion at zero balance still works (no auth check in delete path) [S9].
- `is_clawback_enabled == true` does **not** restrict the holder; it only lets the issuer burn the balance
  (`Operation.clawback`) [S15][S16].

### 1.4 Offers

- `GET /accounts/{account_id}/offers` [S20]; SDK `server.offers().forAccount(id).limit(200).call()`
  (`OfferCallBuilder.forAccount`, `CallBuilder.limit/cursor/order`) [S36]. Horizon's page cap is **200**
  (live: `limit=201` ⇒ `400 "invalid limit: value provided that is over limit max of 200"`) [S43]; paginate
  with `cursor` when `records.length === 200`.
- `OfferRecord` fields: `id` (number | string), `seller`, `selling` / `buying` (`{asset_type, asset_code?, asset_issuer?}`),
  `amount`, `price`, `price_r {n, d}`, `last_modified_ledger`, `sponsor?` [S36].
- Each offer is a subentry (0.5 XLM) and creates `selling_liabilities` on the sold asset / `buying_liabilities`
  on the bought asset [S33]. Buying liabilities on a trustline block its deletion (§2.5).

### 1.5 Issuer inspection (for the disposal ladder)

`loadAccount(asset_issuer)`: 404 ⇒ issuer merged/gone (issuer rung impossible: `PAYMENT_NO_DESTINATION`
[S1][S50]); otherwise read `flags.auth_required / auth_revocable / auth_clawback_enabled / auth_immutable` and
`data_attr["config.memo_required"]`. Note core no longer checks issuer existence for payments since
protocol 13 (`checkIssuer` is gated on `protocolVersionIsBefore(V_13)`) [S13] — the failure for a dead issuer
comes from the destination-account check, not from `NO_ISSUER`.

### 1.6 Fee-bump evidence on transaction records

Horizon `TransactionResponse` carries `fee_account`, `fee_charged`, `max_fee`, `fee_bump_transaction {hash, signatures}`,
`inner_transaction {hash, signatures, max_fee}` [S36][S23]. Live example (testnet, 2026-09-25): a fee-bump record
with `source_account ≠ fee_account`, `fee_charged: "77152"`, and `GET /transactions/{inner_hash}` also resolving
(returning the record keyed by the inner hash, same `fee_account`) [S43]. The "closed account paid no fee" claim
is therefore provable per transaction: `fee_account == sponsor` and the inner result fee is 0 [S2].

---

## 2. Operations and exact SDK constructors per close step

All option interfaces below are copied from `base/operations/types.d.ts` of SDK 17.1.0 [S36]; every op accepts
an optional `source?: string` (operation source override). Result codes are from the operations reference [S1]
and the Horizon string forms from Horizon's `internal/codes/main.go` [S27].

### 2.1 Cancel an offer

```ts
Operation.manageSellOffer({ selling: Asset, buying: Asset, amount: "0", price, offerId })
// ManageSellOfferOpts extends CreatePassiveSellOfferOpts { offerId?: number | string }
// price: BigNumber | number | string | { n: number; d: number }
Operation.manageBuyOffer({ selling, buying, buyAmount: "0", price, offerId })
```

- `amount: "0"` is accepted (`isValidAmount(opts.amount, /*allowZero*/ true)`), `offerId` is stringified and
  parsed as Int64 [S36]. Docs: "Amount of selling being sold. Set to 0 if you want to delete an existing offer" [S1].
- `price` must still be a valid positive price; pass the record's `price` string (the Demolisher does exactly
  this for every offer regardless of how it was created) [S38]. That ManageSellOffer(amount 0) deletes offers
  originally placed with ManageBuyOffer is **verified by production usage, not by a doc sentence** — day-1 check.
- Threshold MEDIUM. Codes: `MANAGE_SELL_OFFER_MALFORMED/SELL_NO_TRUST/BUY_NO_TRUST/SELL_NOT_AUTHORIZED/BUY_NOT_AUTHORIZED/LINE_FULL/UNDERFUNDED/CROSS_SELF/NOT_FOUND(-11)/LOW_RESERVE(-12)` [S1].
  Horizon strings: `op_malformed, op_sell_no_trust, op_buy_no_trust, sell_not_authorized, buy_not_authorized, op_line_full, op_underfunded, op_cross_self, op_sell_no_issuer, buy_no_issuer, op_offer_not_found, op_low_reserve`
  — note the three **without** the `op_` prefix [S27].

### 2.2 Path payment strict send (rung 1)

```ts
Operation.pathPaymentStrictSend({
  sendAsset: Asset, sendAmount: string, destination: string,
  destAsset: Asset, destMin: string, path?: Asset[], source?: string })
```

- `sendAmount` and `destMin` must be **> 0**, ≤ 7 decimals (`isValidAmount` without `allowZero`) — so the
  smallest `destMin` is `"0.0000001"` [S36].
- Quote: `server.strictSendPaths(sourceAsset: Asset, sourceAmount: string, destination: string | Asset[])`
  → `GET /paths/strict-send?source_asset_type&source_asset_code&source_asset_issuer&source_amount&destination_assets=native`
  (`destination_account` and `destination_assets` are mutually exclusive; `destination_assets` is a
  comma-separated list of `CODE:ISSUER` or `native`) [S21][S36]. Records (`PaymentPathRecord`):
  `source_amount`, `destination_amount`, `destination_asset_type/code/issuer`, `path[] {asset_type, asset_code, asset_issuer}` [S36].
- Compute: pick the record with the largest `destination_amount`; `destMin = floor7(destination_amount × (1 − slippage))`,
  clamped to ≥ `0.0000001`; `path = record.path.map(toAsset)`. If `destination_amount` is `"0.0000000"` or no
  record exists ⇒ treat as illiquid and fall to rung 2.
- `destination` may be the closing account itself (receiving XLM needs no trustline) or the merge destination.
  Path payment to self is allowed and avoids `PATH_PAYMENT_STRICT_SEND_NO_TRUST` on the receiver.
- Codes: `MALFORMED, UNDERFUNDED, SRC_NO_TRUST, SRC_NOT_AUTHORIZED, NO_DESTINATION, NO_TRUST, NOT_AUTHORIZED, LINE_FULL, NO_ISSUER(-9), TOO_FEW_OFFERS(-10), OFFER_CROSS_SELF(-11), UNDER_DESTMIN(-12)` [S1][S50];
  Horizon: `op_malformed, op_underfunded, op_src_no_trust, op_src_not_authorized, op_no_destination, op_no_trust, op_not_authorized, op_line_full, op_no_issuer, op_too_few_offers, op_cross_self, op_under_dest_min` [S27].
  `op_cross_self` cannot happen after the offer-cancel phase.

### 2.3 Payment back to the issuer (rung 2)

```ts
Operation.payment({ destination: issuer, asset, amount: balance })
```

- The issuer never needs a trustline to its own asset: core `shouldBypassIssuerCheck` when the destination
  is the issuer; the amount is burned [S13]. `changeTrust` for an issuer's own asset is `MALFORMED` (protocol ≥ 16) [S9].
- Fails when: issuer account gone ⇒ `PAYMENT_NO_DESTINATION` (`op_no_destination`) [S1][S27] (**expected**,
  derived from the destination-existence check; confirm on day 1); holder's trustline not authorized ⇒
  `PAYMENT_SRC_NOT_AUTHORIZED` (`op_src_not_authorized`) [S1][S13]. `auth_required` alone is harmless as long
  as this trustline is authorized; `auth_immutable` on the issuer is irrelevant; clawback flags are irrelevant
  to sending [S15][S16].
- Threshold MEDIUM. Full code list: `PAYMENT_MALFORMED/UNDERFUNDED/SRC_NO_TRUST/SRC_NOT_AUTHORIZED/NO_DESTINATION/NO_TRUST/NOT_AUTHORIZED/LINE_FULL` (+ `NO_ISSUER` in Horizon's table) [S1][S50].

### 2.4 Payment to the destination (rung 3)

Same constructor. Pre-checks on the destination record: a balance line for the exact `code:issuer`,
`is_authorized === true`, headroom `limit − balance − buying_liabilities ≥ amount` (core `getMaxAmountReceive`)
[S10], and SEP-29 memo requirement (§2.10). Failure codes: `PAYMENT_NO_TRUST` / `PAYMENT_NOT_AUTHORIZED` /
`PAYMENT_LINE_FULL` [S1].

### 2.5 Remove a trustline

```ts
Operation.changeTrust({ asset: Asset | LiquidityPoolAsset, limit: "0" })
// ChangeTrustOpts: { asset, limit?: string, source?: string }  (or `line` as alias)
```

- **`limit` must be the string `"0"`.** The SDK does `opts.limit ? toXdrAmount(opts.limit) : Int64.fromString(MAX_INT64)`,
  so a numeric `0` (falsy) silently becomes the maximum limit and re-opens the trustline [S36].
- core delete branch (`limit == 0`, existing trustline): `limit < getMinimumLimit` ⇒ `CHANGE_TRUST_INVALID_LIMIT`,
  where `getMinimumLimit = balance + buyingLiabilities` (protocol ≥ 10) [S9][S10]; then
  `liquidityPoolUseCount != 0` ⇒ `CHANGE_TRUST_CANNOT_DELETE`; otherwise reserves are released
  (`removeEntryWithPossibleSponsorship`) and the entry erased. **No authorization check and no issuer-existence
  check on deletion** (the `NO_ISSUER` checks sit only in the create/modify branches) [S9]. Selling liabilities
  are not consulted (they cannot exceed the balance, so they are 0 whenever the balance is 0).
- `limit == 0` on a trustline that does not exist ⇒ `CHANGE_TRUST_INVALID_LIMIT` [S9] — reload state before retrying.
- Threshold MEDIUM. Codes: `MALFORMED(-1), NO_ISSUER(-2), INVALID_LIMIT(-3), LOW_RESERVE(-4), SELF_NOT_ALLOWED(-5), TRUST_LINE_MISSING(-6), CANNOT_DELETE(-7), NOT_AUTH_MAINTAIN_LIABILITIES(-8)` [S1];
  Horizon: `op_malformed, op_no_issuer, op_invalid_limit, op_low_reserve, op_self_not_allowed, op_trust_line_missing, op_cannot_delete, op_not_aut_maintain_liabilities` (sic) [S27].

### 2.6 Remove a data entry

```ts
Operation.manageData({ name: string, value: null })   // ManageDataOpts.value: string | Uint8Array | null
```

`null` deletes (the SDK emits `dataValue: null`) [S36]. Threshold MEDIUM. Codes: `MANAGE_DATA_NOT_SUPPORTED_YET, NAME_NOT_FOUND, LOW_RESERVE, INVALID_NAME` [S1];
Horizon: `op_not_supported_yet, op_data_name_not_found, op_low_reserve, op_data_invalid_name` [S27].

### 2.7 Sponsorship operations

```ts
Operation.beginSponsoringFutureReserves({ sponsoredId: string, source: SPONSOR })
Operation.endSponsoringFutureReserves({ source: SPONSORED })
Operation.revokeTrustlineSponsorship({ account: string, asset: Asset | LiquidityPoolId, source: SPONSOR })
Operation.revokeAccountSponsorship({ account })  Operation.revokeDataSponsorship({ account, name })
Operation.revokeOfferSponsorship({ seller, offerId })  Operation.revokeSignerSponsorship({ account, signer })
```

Who signs: Begin is sourced by the sponsor, End by the sponsored account; both are MEDIUM threshold and must
sit in the same transaction, so **both accounts sign that transaction** [S6][S7][S1]. Revoke: the current
sponsor is the source (or the owner if unsponsored); fails `REVOKE_SPONSORSHIP_NOT_SPONSOR`,
`_LOW_RESERVE` ("the new reserve payor cannot afford this entry"), `_ONLY_TRANSFERABLE`, `_DOES_NOT_EXIST`,
`_MALFORMED` [S1][S7]. **Removing a sponsored trustline does not use Revoke at all** — the owner deletes it
(§2.5) and the sponsor is credited automatically [S9][S7]. Revoking sponsorship of a zero-XLM account's
trustline would fail with `_LOW_RESERVE`; do not plan it.

### 2.8 Account merge

```ts
Operation.accountMerge({ destination: string })   // AccountMergeOpts { destination; source? }
```

Threshold HIGH [S1]. core `doApplyFromV16` order and codes [S8][S1][S26][S27]:

| # | Condition | core code | Horizon string |
|---|---|---|---|
| 0 | destination == source (checkValid) | `ACCOUNT_MERGE_MALFORMED` (-1) | `op_malformed` |
| 1 | destination missing | `ACCOUNT_MERGE_NO_ACCOUNT` (-2) | `op_no_account` |
| 2 | source has `AUTH_IMMUTABLE` | `ACCOUNT_MERGE_IMMUTABLE_SET` (-3) | `op_immutable_set` |
| 3 | `numSubEntries != signers.size()` (any trustline/offer/data/pool share) | `ACCOUNT_MERGE_HAS_SUB_ENTRIES` (-4) | `op_has_sub_entries` |
| 4 | `seqNum >= getStartingSequenceNumber(header)` (or protocol-19 `maxSeqNumToApply` entry ≥ it) | `ACCOUNT_MERGE_SEQNUM_TOO_FAR` (-5) | `op_seq_num_too_far` |
| 5 | account is-sponsoring-future-reserves (mid-sandwich) or `numSponsoring > 0` | `ACCOUNT_MERGE_IS_SPONSOR` (-7) | `op_is_sponsor` |
| 6 | destination cannot receive balance + its XLM buying liabilities | `ACCOUNT_MERGE_DEST_FULL` (-6) | `op_dest_full` |

Signers (sponsored or not) are removed inside the merge; the account entry's own sponsorship is released
(`removeEntryWithPossibleSponsorship`) [S8]. The merge can be the last operation of a transaction whose
earlier operations removed the subentries (the Demolisher combines `accountMerge` with a following `payment`
in one transaction) [S38].

### 2.9 `ACCOUNT_MERGE_SEQNUM_TOO_FAR` — exact condition and remedy

- `getStartingSequenceNumber(ledgerSeq) = ledgerSeq << 32` [S10]; merge fails iff `sourceAccount.seqNum >= (ledgerSeq << 32)`
  for the ledger in which the merge is applied [S8]. New accounts start at `ledgerSeq << 32` [S12] and gain +1
  per transaction, so this needs > 2³² transactions per ledger of age — **only reachable through BumpSequence**.
- No remedy operation exists: `bumpTo <= current` is a silent no-op success, `bumpTo > current` raises;
  `BUMP_SEQUENCE_BAD_SEQ` only for negative `bumpTo`; threshold LOW [S11][S1].
- Guard for the planner: `tooFar = (BigInt(sequence) >> 32n) >= BigInt(latestLedger)`; if true,
  `ledgersToWait = (sequence >> 32) − latestLedger + 1`, ETA ≈ `ledgersToWait × ~5 s` (testnet closes ledgers
  roughly every 5 s — **unverified constant**, measure on day 1). If `sequence >> 32` is astronomically far
  (e.g. bumped to `INT64_MAX`), report **unclosable: sequence number too far, merge possible at ledger N**.
  `latestLedger` comes from `server.feeStats().last_ledger` or `server.ledgers().order("desc").limit(1)` [S36][S43].
- Fixture for the test matrix: `Operation.bumpSequence({ bumpTo: ((latestLedger + 20) << 32).toString() })`
  then attempt a merge ⇒ `op_seq_num_too_far`; wait ≈ 20 ledgers ⇒ merge succeeds. This exercises both the
  detection and the wait-then-retry path.

### 2.10 SEP-29 memo requirement

Data entry `config.memo_required` with value `"1"` (base64 `"MQ=="`); applies to `PAYMENT`,
`PATH_PAYMENT_STRICT_SEND`, `PATH_PAYMENT_STRICT_RECEIVE`, `MERGE_ACCOUNT` to non-muxed destinations [S17].
`Horizon.Server.submitTransaction(tx, { skipMemoRequiredCheck: false })` runs `checkMemoRequired`, which
unwraps a `FeeBumpTransaction` to its inner transaction, loads each destination and throws
`AccountRequiresMemoError(message, accountId, operationIndex)` [S36]. Plan: inspect destinations in
`planClose()`, require `--memo` when flagged, and pass `skipMemoRequiredCheck: true` at submit time (the
planner already did the check, and the submit-time check costs one Horizon call per destination).

---

## 3. Fee-bump mechanics

### 3.1 SDK surface (17.1.0, verified from `transaction_builder.d.ts` / `.js`) [S36]

```ts
static buildFeeBumpTransaction(
  feeSource: Keypair | string,   // only the public key is used; G... or M...
  baseFee: string,               // max fee per operation of the inner tx, in stroops
  innerTx: Transaction,
  networkPassphrase: string
): FeeBumpTransaction
```

Implementation facts: throws `Invalid baseFee, it should be at least <innerInclusionFeePerOp> stroops` if
`baseFee < innerTx.fee / innerOps`, and `... at least 100 stroops` if `baseFee < BASE_FEE`; a v0 inner
envelope is upgraded to v1 (requires time bounds); outer `fee = baseFee × (innerOps + 1)` (+ Soroban resource
fee, irrelevant here); returns `FeeBumpTransaction` with `innerTransaction`, `feeSource`, `sign(keypair)`,
`toEnvelope()`, `hash()` [S36]. `TransactionBuilder.fromXdr(envelope, passphrase)` returns either type
(`fromXDR` is deprecated in v17) [S36]. `BASE_FEE = "100"`; `TransactionBuilderOptions.fee` is the per-operation
fee in stroops and `build()` multiplies by `operations.length` [S36].

### 3.2 Who signs what

- Inner: the account's signers, meeting each operation's threshold (HIGH for the merge) [S1][S2].
- Outer: the fee source, meeting its **LOW** threshold; core checks `thresholds[THRESHOLD_LOW]` [S4][S2][S3].
- Do not add the sponsor's signature to the inner transaction (`tx_bad_auth_extra` for unused signatures) [S49].

### 3.3 Fee rules (CAP-0015, docs, core)

- Effective operation count of a fee bump = inner ops + 1; minimum outer fee = `100 × (n + 1)` stroops [S3][S2][S4].
- Outer fee rate ≥ inner fee rate: core cross-multiplies
  `outerInclusionFee × minInclusionFee(inner) >= innerInclusionFee × minInclusionFee(outer)` else
  `txINSUFFICIENT_FEE` [S4]; docs phrase it as "greater than or equal to the fee specified in the inner transaction" [S2].
- Replace-by-fee (only when a transaction with the same source and sequence is already queued): the new fee
  rate must be ≥ 10× [S3][S2]. The SDK doc comment's "should be >= 10x" is that case, not a general rule [S36].
- The inner transaction's own fee is **never charged**: "the inner fee will always be 0" in every fee-bump
  result [S2]; the fee source pays the whole outer fee [S4]; the inner fee "may be less than the minimum fee
  ... but must be non-negative" [S3]; core validates the inner with `chargeFee == false`, which skips
  `txINSUFFICIENT_FEE` and the `getAvailableBalance < feeToPay ⇒ txINSUFFICIENT_BALANCE` check [S5].
  ⇒ A zero-spendable inner source is valid. Inner fee `"0"` is protocol-legal; the SDK only requires that
  `fee` is defined. Recommended default: inner `fee: BASE_FEE` (conventional, cannot violate the rate rule);
  validate `"0"` on day 1 (§8.4).
- Sequence numbers: consumed from the inner source; the fee source's sequence is untouched
  (`getSeqNum()` delegates to the inner) [S4][S2]. "The sequence number of the inner transaction is always
  consumed at apply time" [S2] — a valid inner whose operation fails still burns the account's sequence and the
  sponsor's fee. Hence `planClose()` must pre-validate, and the executor reloads the account on `tx_bad_seq`.
- Transaction-level results: `txFEE_BUMP_INNER_SUCCESS (1)`, `txFEE_BUMP_INNER_FAILED (-13)`, `txNOT_SUPPORTED (-12)` [S3];
  Horizon strings `tx_fee_bump_inner_success`, `tx_fee_bump_inner_failed`, `tx_insufficient_fee`, `tx_bad_seq`,
  `tx_insufficient_balance`, `tx_bad_auth`, `tx_bad_auth_extra`, `tx_too_late`, `tx_bad_sponsorship` [S27][S36].
  SDK: `TransactionFailedError.getResultCodes()` → `{ transaction, operations: string[] }` (operations normalized
  to `[]` when Horizon omits them) [S36].

### 3.4 Limits

- Up to **100 operations** per classic transaction [S31][S32]; a fee bump wraps at most 100 inner ops.
- Ledger capacity: 1,000 classic operations per ledger (mainnet value quoted in docs) [S31].
- Per-transaction byte cap for classic transactions: **not found** in docs or in the network config
  (`stellar network settings` on testnet only exposes Soroban limits, e.g. `tx_max_size_bytes = 132096`) [S45]
  — **unverified**; the 100-op cap is the binding limit for Dustin.
- Horizon `submitTransaction` HTTP timeout in the SDK is 60 s (`SUBMIT_TRANSACTION_TIMEOUT`) [S36]; on a
  `504` poll `GET /transactions/{hash}` and only resubmit the identical envelope [S25].

### 3.5 Surge pricing on testnet

- Fee model: inclusion fee = ops × effective base fee; network minimum 100 stroops/op; you are charged only
  the lowest fee that gets the transaction in ("the user pays the minimum inclusion fee in their transaction
  set"); surge pricing starts when > 1,000 classic ops compete for a ledger, ordering by per-operation bid,
  ties random [S31].
- Live testnet `GET /fee_stats` on 2026-09-25: `last_ledger_base_fee: "100"`, `ledger_capacity_usage: "0.09"`,
  `fee_charged.p50: "8726"`, `max_fee.p50: "206126"` — the percentiles are dominated by Soroban transactions,
  not by classic congestion [S43]. `server.fetchBaseFee()` returns `last_ledger_base_fee` (falls back to 100) [S36].
- Strategy: start the outer `baseFee` at a configurable 1,000 stroops/op (0.0001 XLM), escalate ×10 on
  `tx_insufficient_fee` up to a cap (e.g. 100,000 stroops/op); the fee actually charged stays at the
  clearing price. Since a queued transaction can only be replaced at ≥ 10× [S3], a resubmission after
  `tx_insufficient_fee` (which is a rejection, not a queued transaction) can use any higher fee.

---

## 4. Disposal ladder details

Order per non-zero balance line: (1) path-payment sell → (2) return to issuer → (3) send to destination →
(4) unclosable with reason. Deterministic pre-checks (all read-only) and the failure mapping:

| Rung | Pre-check (Horizon) | Expected op failure ⇒ next rung | Terminal "unclosable" reasons |
|---|---|---|---|
| 1 sell | `strictSendPaths(asset, balance, [Asset.native()])` returns ≥ 1 record with `destination_amount ≥ 0.0000001` | `op_too_few_offers`, `op_under_dest_min` (quote moved) | — |
| 2 issuer | issuer account exists (`loadAccount` 200); line `is_authorized === true` | `op_no_destination` (issuer merged) | `op_src_not_authorized` ⇒ "trustline not authorized; issuer must re-authorize or claw back" |
| 3 destination | destination line exists, `is_authorized`, headroom ≥ amount, SEP-29 satisfied | `op_line_full`, `op_no_trust`, `op_not_authorized` | same codes when the pre-check already fails |
| 4 report | — | — | "no liquidity, issuer gone/de-authorized, destination lacks trustline" |

Notes:

- **Dust and rounding**: amounts have 7 decimals; a quote returning `"0.0000000"` cannot satisfy the minimum
  `destMin` and counts as illiquid [S36][S21]. Whether Horizon's strict-send pathfinding includes liquidity
  pools as well as the order book is **unverified** here (expected since pool support landed in Horizon;
  cover it by seeding a plain order-book offer for the fixture).
- **Why not "sell at market" like the Demolisher** (`manageSellOffer` at price `0.0000001`) [S38]: with no bids
  it leaves a resting offer (a new subentry, `op_low_reserve` on a floor-balance account) that must be
  cancelled on the next pass. A strict-send path payment is atomic and leaves nothing behind.
- **Return-to-issuer failure modes** verified: issuer merged ⇒ destination-missing failure [S1][S13];
  de-authorized or "maintain liabilities only" trustline ⇒ source not authorized [S13]; `auth_immutable` on
  the issuer does not affect payments [S15]; clawback-enabled lines can still be paid back [S16].
- **Destination-holds-trustline check**: `loadAccount(destination).balances.find(code && issuer)`, require
  `is_authorized`, and `limit − balance − buying_liabilities ≥ amount` (core `getMaxAmountReceive`) [S10].
- **Deterministic illiquid asset for the fixture**: issue e.g. `ILLIQ` from a throwaway issuer, never create an
  offer or pool for it, and assert (a) `strictSendPaths` returns 0 records, (b) `server.orderbook(ILLIQ, XLM).call()`
  has no bids, (c) `server.liquidityPools().forAssets(ILLIQ, Asset.native()).call()` is empty [S36]. In the
  **main** fixture its balance exits via rung 2 (issuer alive, authorized). For the **unclosable** test account
  make the issuer unusable deterministically: (i) issue with `AUTH_REQUIRED | AUTH_REVOCABLE`, authorize,
  pay dust, then `setTrustLineFlags({ trustor, asset, flags: { authorized: false } })` [S36][S1]; or (ii) merge
  the throwaway issuer away after distribution (`accountMerge` on the issuer; an issuer with no subentries can
  merge — **unverified** whether outstanding balances matter; core does not count them, so expected fine).
- **Seeding liquidity for rung 1 evidence**: a market-maker account with a trustline to one dust asset places
  `manageBuyOffer({ selling: XLM, buying: DUST1, buyAmount, price })` sized so that the dust sale yields
  ≥ 0.0000001 XLM. Keep the maker separate from the sponsor to avoid `op_cross_self` confusion.

Error-to-decision map for `executeClose()` (Horizon strings from [S27]): `op_too_few_offers | op_under_dest_min` → next rung;
`op_src_not_authorized` → unclosable; `op_no_destination` (issuer rung) → next rung; `op_no_trust | op_not_authorized | op_line_full` (destination rung) → unclosable;
`op_invalid_limit` → reload balances (residual balance or buying liabilities); `op_cannot_delete` → pool blocker;
`op_has_sub_entries` → re-inspect; `op_seq_num_too_far` → wait N ledgers; `op_is_sponsor` → unclosable (account sponsors others);
`op_immutable_set` → unclosable; `tx_bad_seq` → reload sequence and rebuild; `tx_insufficient_fee` → raise outer fee;
`tx_too_late` → rebuild with fresh time bounds; `504` → poll by hash, then resubmit unchanged [S25].

---

## 5. Sponsorship on the fixture

### 5.1 Creating the sponsored trustline (sandwich)

One transaction, three operations, signed by **both** the sponsor and the fixture keypair [S6][S7]:

```ts
Operation.beginSponsoringFutureReserves({ sponsoredId: FIXTURE, source: SPONSOR })
Operation.changeTrust({ asset: DUST3, source: FIXTURE })            // limit defaults to max int64
Operation.endSponsoringFutureReserves({ source: FIXTURE })
```

Effects: fixture `num_sponsored += 1`, sponsor `num_sponsoring += 1`, the fixture's balance line shows
`sponsor: SPONSOR`, and the fixture's minimum balance is unchanged by this trustline [S6][S7][S18]. Failure
codes: `BEGIN_SPONSORING_FUTURE_RESERVES_MALFORMED/ALREADY_SPONSORED/RECURSIVE`, `END_SPONSORING_FUTURE_RESERVES_NOT_SPONSORED`
[S1]; Horizon `op_already_sponsored`, `op_recursive`, `op_not_sponsored` [S27]. Build the trustline while the
fixture still has XLM to pay fees, or fee-bump the sandwich too.

### 5.2 Removing it returns the reserve to the sponsor

The fixture deletes it with `changeTrust({ asset: DUST3, limit: "0" })` alone (after the dust is disposed);
core releases the sponsored reserve, decrementing `numSponsoring` on the sponsor and `numSponsored` on the
fixture [S9][S7][S6]. Evidence: sponsor `num_sponsoring` before/after, fixture `num_sponsored` before/after,
and the fact that the XLM recovered at merge excludes that 0.5 XLM. (Horizon effect names for this are
**unverified**; use the account counters.)

### 5.3 Merge interplay

- Account **still sponsoring** something ⇒ `ACCOUNT_MERGE_IS_SPONSOR` [S8][S7]. `planClose()` flags
  `num_sponsoring > 0` as unclosable-by-Dustin (remediation needs the account to revoke/transfer each
  sponsorship, and the beneficiary must afford the reserve, `REVOKE_SPONSORSHIP_LOW_RESERVE`) [S1][S7].
- Account whose **own entry is sponsored** merges fine; the merge releases the sponsor's reserve [S8].
  Optional "literal 0 XLM" variant: `beginSponsoringFutureReserves` + `createAccount({ destination, startingBalance: "0" })`
  + `endSponsoringFutureReserves` (protocol ≥ 14 allows `startingBalance >= 0`) [S12][S7]. Then every
  subentry must also be sponsored or the account cannot add them (`op_low_reserve`).

### 5.4 Draining to exactly zero spendable

After the subentries exist: `minBalance = (2 + subentry_count + num_sponsoring − num_sponsored) × 0.5`
[S10][S6]; for the SOW fixture (3 + 1 trustlines, 2 offers, 1 data entry, 1 of the trustlines sponsored):
`subentry_count = 7`, `num_sponsored = 1` ⇒ `minBalance = 4.0 XLM`. Pay away `balance − minBalance − fee` in a
last self-funded transaction (or fee-bump it for exactness) so that `available == 0`. If any open offer
sells XLM its `selling_liabilities` are locked as well and must be included. Verify `base_reserve_in_stroops`
on the latest ledger record at build time instead of hard-coding 0.5 XLM (**assumption**: unchanged on testnet).
Expected recovery at merge: the full 4.0 XLM to the destination (fees are the sponsor's) plus 0.5 XLM freed on
the sponsor.

---

## 6. Testnet plumbing

| Item | Value | Source |
|---|---|---|
| Horizon | `https://horizon-testnet.stellar.org` (live: horizon 29.0.0, core 29.0.0, protocol 28) | [S28][S43] |
| RPC (not needed for classic ops) | `https://soroban-testnet.stellar.org` | [S28] |
| Passphrase | `Test SDF Network ; September 2015` = `Networks.TESTNET` | [S28][S36] |
| Friendbot | `https://friendbot.stellar.org?addr=G...` — 10,000 XLM, rate limited; SDK `server.friendbot(address).call()` | [S28][S36] |
| Horizon rate limit | default 3600 requests/hour per IP, `429 Too Many Requests` when exceeded; no `X-RateLimit-*` headers observed on the SDF testnet instance | [S24][S43] |
| Page size | max 200 records per page | [S43] |
| Reset cadence | "2–4 times per year at 17:00 UTC", announced ≥ 2 weeks ahead; next listed **2026-12-16**; SDF "does not guarantee Testnet availability" | [S28] |
| Reset cadence (older doc) | "reset quarterly", "always ... at 09:00 UTC" — conflicts with the above; treat [S28] as current | [S30] |
| Explorer (StellarExpert) | `https://stellar.expert/explorer/testnet/account/{G...}`, `/tx/{hash}`, `/ledger/{seq}`, `/offer/{id}`, `/op/{id}` (routes from the explorer source; API: `https://api.stellar.expert/explorer/testnet/...`) | [S38][S44] |
| Explorer (Stellarchain) | `https://testnet.stellarchain.io/` responds; URL patterns **unverified** | [S43] |
| Canonical machine evidence | Horizon JSON: `GET /transactions/{hash}` (outer and inner hashes both resolve), `GET /accounts/{id}` → 404 after close | [S43] |

Plan for resets: the fixture builder is a script (`fixture:build`) that recreates everything from friendbot;
evidence capture (`evidence:capture`) stores account/transaction JSON, and the write-up embeds hashes so the
reviewer can still match them against the recording after 2026-12-16.

---

## 7. StellarExpert Account Demolisher — baseline

### 7.1 Where the source is

Repository `stellar-expert/stellar-expert-explorer` (MIT, last push 2026-09-19) [S38]:

- `business-logic/demolisher/demolisher-tx-builder.js` — the whole algorithm (`DemolisherTxBuilder`, 344 lines)
- `views/demolisher/account-demolisher-view.js` — the form at `/demolisher/:network`
- `business-logic/demolisher/test-accounts-builder.js` — their own testnet fixture generator
- `app-settings.js` — networks `public` and `testnet`, both with `demolisher: GA4C3WUE7TL7GNXHF27B6Z54VMRCPTW2JH2OQRHH4U2EHPI6CCLMERGE`
  (the mediator; it exists on testnet with 10,000 XLM [S43]) and `apiEndpoint: https://api.stellar.expert`.

Live UI: `https://stellar.expert/demolisher/public/` and `https://stellar.expert/demolisher/testnet/` [S39].
The mediator co-signing endpoint is `POST https://api.stellar.expert/demolisher/{network}/merge` with
`{transaction: <base64 XDR>}`; its server code is **not** in the public repository (a probe with an invalid
body returned `500 {"error":"Internal server error"}`, proving the route exists) [S38][S43].

### 7.2 What it does, step by step (from the source) [S38]

Loop until merged or 5 failures (5 s pause between attempts):

1. `fetchSourceAccount()` — `server.accounts().accountId(source).call()`.
2. `dropDataEntries()` — `Operation.manageData({name, value: null})` for every `data_attr` key.
3. `dropOffers()` — `server.offers().forAccount(source).limit(100)`; for each record
   `Operation.manageSellOffer({price, buying, selling, amount: '0', offerId: id})`.
4. `sellAssets()` (once) — for every non-native balance > 0: `manageSellOffer({selling: asset, buying: XLM, price: 0.0000001, amount: balance})`
   ("sell at market price"; creates a resting offer when there are no bids).
5. `dropTrustlines()` — for every non-native line: if balance > 0 `payment({destination: issuer, asset, amount: balance})`,
   then `changeTrust({asset, limit: '0'})`.
6. `mergeAccount(destination, memo)` — `accountMerge({destination: mediator})` + `payment({source: mediator, destination, asset: XLM, amount: balance − 2×baseFee/1e7})`,
   built with `requiresApproval: true` ⇒ the envelope is POSTed to `/merge` and the co-signed envelope returned
   by the server is submitted. Default memo `'StellarExpert merge tool'`.

Every batch: `new TransactionBuilder(new Account(source, sequence), {fee: baseFee, memo, networkPassphrase}).setTimeout(300)`,
≤ 100 ops, signed by every pasted secret (`Keypair.fromSecret`), `server.submitTransaction(tx)`; `baseFee` is
200 stroops per op from the view (`baseFee: 200`), comment says "0.001 XLM to ensure merge even in case of
surge pricing". The view checks `high` threshold feasibility with `@stellar-expert/tx-signers-inspector`
before starting, and its copy says "Absolutely free, you pay only for transaction fees."

### 7.3 Where it stops

- **Zero-spendable account**: the first batch (data entries, or offers) is sourced and fee-paid by the account;
  core rejects it with `txINSUFFICIENT_BALANCE` ("fee would bring account below reserve") because
  `getAvailableBalance < feeToPay` [S5][S49]. The loop repeats the same failure 5× and ends with
  "Failed to merge the account". Even with fee money, `sellAssets` on a floor-balance account needs a new
  offer subentry ⇒ `op_low_reserve`.
- **Sponsored reserves**: no field of `sponsor`, `num_sponsoring`, `num_sponsored` is read. Deleting a
  sponsored trustline still succeeds (owner may delete), but the freed reserve goes to the sponsor without
  any accounting; if the account itself sponsors anything, the merge fails `op_is_sponsor` 5× [S8].
- **Liquidity pool shares**: filtered out (`asset_issuer` missing) ⇒ merge fails `op_has_sub_entries`.
- **Unauthorized trustlines**: `sellAssets` fails the whole batch with `sell_not_authorized` on every retry.
- **Illiquid assets**: the 0.0000001 sell offer rests on the book, then gets cancelled and the balance is
  paid to the issuer — works only while the issuer exists and the line is authorized.
- Source quirks worth citing: `trackDeletedIssuers` pushes the operation object instead of the issuer id, so
  `ignoredIssuers.includes(asset_issuer)` never matches; amounts are computed with floating point
  (`this.balance - 2 * this.baseFee / 10000000`).
- The SOW's "< 1 XLM co-sign refusal" cannot be confirmed from public code, but it was confirmed behaviourally on 2026-09-25 by a black-box probe of the testnet co-sign endpoint (payouts of 0.5 and 0.9999999 XLM were rejected with HTTP 400 "Transaction is invalid", payouts of 1 and 5 XLM were signed), see docs/analysis/competitive-landscape.md; the server code stays private, so the rule is inferred from behaviour.

### 7.4 Recording the baseline reproducibly

1. `fixture:build` creates the messy account (§5.4) and writes `fixtures/<date>.json` (public keys, asset codes,
   offer ids, transaction hashes).
2. Headless run: vendor `demolisher-tx-builder.js` (MIT, keep the license header) under `baseline/vendor/`,
   replace its two imports (`adjustPrecision` from `@stellar-expert/formatter`, `appSettings`) with local shims,
   instantiate `new DemolisherTxBuilder({ source, signers: [secret], horizon: 'https://horizon-testnet.stellar.org', networkPassphrase: Networks.TESTNET, mediator: 'GA4C3WUE7TL7GNXHF27B6Z54VMRCPTW2JH2OQRHH4U2EHPI6CCLMERGE', endpoint: 'https://api.stellar.expert/demolisher/testnet', baseFee: 200, onStatusChange })`,
   and record every status callback plus each `TransactionFailedError.getResultCodes()` into
   `baseline/run-<date>.json`. Expected first failure: `tx_insufficient_balance`.
3. Human-readable run: screen-record the same fixture in `https://stellar.expert/demolisher/testnet/` (paste the
   fixture secret — testnet only) up to the error message.
4. Keep the fixture keypair; rebuild and re-record after any testnet reset.

Landscape: LumenWipe (Apache-2.0; "builds upon the open-source work of stellar.expert/demolisher/public";
`@lumenwipe/sdk` is "a thin API fetch client"; roadmap Tranche 2 "sponsored fees for reserve-locked accounts")
[S41]. `https://demolisher.app/` refused connections during this spike (**unverified** what it is) [S42].
`stellar/js-stellar-wallets#98` ("Add helper that closes a user's account"): opened 2019-08-12, still open,
no comments, repository archived 2024-02-08 [S40] — the SOW statement is accurate.

---

## 8. Recommended repo skeleton, dependencies, day-1 experiments

### 8.1 Verified versions (npm registry and GitHub, 2026-09-25) [S47][S48]

| Package | Version | Note |
|---|---|---|
| `@stellar/stellar-sdk` | **17.1.0** (`latest`; `lts-16` = 16.3.0) | `engines.node >= 22.12.0`; ESM-first with CJS build; fetch-based HTTP; depends on `commander ^14.0.3`, `bignumber.js ^11.1.4` [S36][S37] |
| Node.js | 24 LTS (local: v24.15.0, npm 11.12.1) | `process.loadEnvFile()` available ⇒ no `dotenv` |
| `typescript` | **5.9.3** (pin) | `latest` is 7.0.2 (native compiler); `typescript-eslint` 8.70.1 peer range is `>=4.8.4 <6.1.0`, so stay on 5.9.x |
| `vitest` / `@vitest/coverage-v8` | 5.0.2 / 5.0.2 | engines `^22.12.0 || ^24.0.0` |
| `tsx` | 4.23.15 | run scripts/CLI in dev |
| `commander` | ^14.0.3 (dedupes with the SDK) — latest is 15.0.0 | CLI |
| `bignumber.js` | 11.1.5 | all amount arithmetic (never floats) |
| `@types/node` | 24.13.6 (match Node 24) | latest major is 26.x |
| `eslint` / `typescript-eslint` / `prettier` | 10.11.0 / 8.70.1 / 3.9.9 | |
| `zod` (optional) | 4.6.5 | config/plan schema |
| `tsup` / `tsdown` (optional) | 8.5.1 / 0.23.0 | prefer plain `tsc` emit (ESM only; Node ≥ 22.12 supports `require(esm)`) |
| GitHub Actions | `actions/checkout@v7` (v7.0.1), `actions/setup-node@v7` (v7.0.0) | |
| Stellar CLI (local) | 27.1.0 — warns that testnet is on protocol 28 | only for ad-hoc inspection |

### 8.2 Layout

```
dustin/
  package.json            "type": "module", "exports": {".": "./dist/index.js"}, "bin": {"dustin": "./dist/cli.js"}
  tsconfig.json           module/moduleResolution NodeNext, target ES2022, strict, declaration, outDir dist
  src/
    index.ts              public API: planClose(), executeClose(), types
    inspect/              account.ts (record → Inventory), issuer.ts, destination.ts, paths.ts (strictSendPaths)
    plan/                 ladder.ts (rung selection, reasons), order.ts (phases, 100-op chunking), fees.ts, sequence.ts (SEQNUM guard)
    execute/              build.ts (inner tx), feebump.ts (buildFeeBumpTransaction + sign), submit.ts (retry, 504 poll, error map), state.ts (resume)
    cli.ts                `dustin plan <G...>`, `dustin close <G...> --destination --memo --yes`
    fixture/              build.ts (messy account + unclosable account + market maker), drain.ts
    baseline/             run.ts (headless Demolisher), vendor/demolisher-tx-builder.js (MIT)
    evidence/             capture.ts (JSON dumps + explorer links)
  test/
    unit/                 pure planner tests on recorded Horizon JSON (no network)
    fixtures/horizon/     recorded account/offers/paths responses
    testnet/              integration (gated by DUSTIN_TESTNET=1): fee-bump on zero-spendable, ladder rungs, SEQNUM, sponsored trustline, LP-share report, auth/clawback
  docs/                   technical-spike.md (this), write-up, evidence package
  .github/workflows/ci.yml  lint + typecheck + unit on PR; testnet job manual/nightly, keys generated per run via friendbot (no secrets)
```

`package.json` scripts: `build` (`tsc -p tsconfig.build.json`), `test` (`vitest run`), `test:testnet`
(`DUSTIN_TESTNET=1 vitest run test/testnet`), `lint`, `typecheck` (`tsc --noEmit`), `fixture:build`,
`baseline:run`, `evidence:capture`, `cli` (`tsx src/cli.ts`). Config via env: `DUSTIN_SPONSOR_SECRET`
(optional; generated + friendbot-funded when absent), `DUSTIN_HORIZON_URL`, `DUSTIN_NETWORK_PASSPHRASE`.

### 8.3 Transaction grouping recommendation

Phase A (one fee-bumped tx): cancel offers + delete data entries (deterministic).
Phase B (one fee-bumped tx **per asset**): the chosen rung's operation, so a failing rung on one asset does
not roll back the others (all-or-nothing per transaction).
Phase C (one fee-bumped tx): all `changeTrust "0"` + `accountMerge` last. Chunk at 100 ops. Each phase re-reads
the account first (fresh `sequence`, liabilities). Typical fixture: 3 transactions.

### 8.4 Risky assumptions to validate on day 1

| # | Assumption | Tiny experiment (testnet, throwaway keys) | Expected |
|---|---|---|---|
| 1 | Zero-spendable inner source + fee bump works with inner `fee: "0"` and with `fee: BASE_FEE` | friendbot A; drain A to exactly minBalance; build `manageData` add/remove inner (fee "0"), fee-bump by B, submit | `tx_fee_bump_inner_success`, A's balance unchanged, B paid `200` stroops (1 op + 1) |
| 2 | `manageSellOffer(amount "0")` deletes an offer created by `manageBuyOffer` | create buy offer, cancel via manageSellOffer with its `id` and `price` | `op_success`, offer gone from `/offers` |
| 3 | Owner deletes a **sponsored** trustline alone; reserve returns to sponsor | sandwich-create, then fixture-only `changeTrust "0"` | success; sponsor `num_sponsoring` −1, fixture `num_sponsored` −1 |
| 4 | Payment to a **merged** issuer fails as `op_no_destination`; `changeTrust "0"` to it still works | merge throwaway issuer away, then pay / delete | `op_no_destination`; delete `op_success` |
| 5 | SEQNUM guard math | `bumpSequence` to `(latest+20) << 32`, merge now, merge after 20 ledgers | `op_seq_num_too_far`, then success; measure ledger interval |
| 6 | Horizon strict-send returns a path for a dust amount against a seeded buy offer | seed maker offer, quote `0.0000005` DUST | 1 record, `destination_amount ≥ 0.0000001` |
| 7 | `accountMerge` in the same tx as the last `changeTrust "0"` ops | Phase C as one tx | `op_success` ×N, account 404 afterwards |
| 8 | Demolisher baseline fails on the floor-balance fixture | headless run (§7.4) | first batch `tx_insufficient_balance`; 5 retries then failure |
| 9 | Demolisher mediator refuses small merges (SOW claim) | give the fixture 0.9 XLM spendable and run the merge step only | record the `/merge` HTTP status/body |
| 10 | `submitTransaction` refuses memo-less merge to a `config.memo_required` destination | set `config.memo_required=1` on D, merge without memo | `AccountRequiresMemoError` client-side |
| 11 | Horizon serves history of a merged account | after close: `GET /accounts/{id}/operations` | 200 with the close chain (else rely on tx hashes) |
| 12 | Base reserve 0.5 XLM and ~5 s ledgers on testnet | read latest ledger record; time 20 ledgers | `base_reserve_in_stroops = 5000000`; ~100 s |
| 13 | `setTrustLineFlags({authorized:false})` produces the `op_src_not_authorized` rung-2 failure | AUTH_REQUIRED|REVOCABLE issuer, authorize, pay dust, deauthorize, pay back | `op_src_not_authorized`; delete after issuer clawback `op_success` |

---

## Assumptions

- Testnet base reserve is 0.5 XLM and the ledger interval is ~5 s (both read at runtime rather than hard-coded).
- The SOW fixture composition (3 dust trustlines, 2 offers, 1 data entry, 1 sponsored trustline) contains
  **no** liquidity-pool share and no `AUTH_IMMUTABLE` flag on the fixture; the "unclosable" scenario lives in
  a second account.
- "0 XLM" in the SOW means zero spendable (balance == minimum reserve + XLM selling liabilities); the literal
  0-balance sponsored-account variant is a stretch goal.
- The sponsor is a single-signature account whose LOW threshold is met by its master key, funded by friendbot.
- Dustin is ESM-only (Node ≥ 22.12) and ships no CJS build; TypeScript stays on 5.9.x.
- Horizon (not RPC) is the only network dependency; RPC is unnecessary for classic operations.
- Fee-bump outer fee starts at 1,000 stroops/op and escalates ×10 on `tx_insufficient_fee` up to a cap.
- Evidence links are perishable (reset 2026-12-16); the evidence package stores JSON copies and the video.
- The Demolisher's testnet mode uses the same mediator account as public and the `/merge` endpoint accepts
  testnet envelopes (route exists; behaviour with a valid envelope untested here).

## Unverified items

1. The Demolisher mediator server's "< 1 XLM" refusal policy (server code not public) — experiment #9.
2. `ManageSellOffer(amount 0)` deleting offers created by `ManageBuyOffer` — verified only by production usage — #2.
3. Payment to a merged issuer failing specifically as `PAYMENT_NO_DESTINATION` (derived from core's
   destination check, not from a doc sentence) — #4.
4. Whether Horizon's `/paths/strict-send` includes liquidity pools on testnet — covered by seeding an order-book offer, #6.
5. Horizon serving `/accounts/{id}/operations` after the account is merged — #11.
6. Ledger close interval on testnet (~5 s) and base reserve value — #12.
7. A classic per-transaction byte limit (none found in docs; network settings only expose Soroban limits).
8. `X-RateLimit-*` headers and the effective rate limit on the SDF testnet Horizon (none observed).
9. Stellarchain testnet URL patterns; Horizon effect names emitted when a sponsored trustline is removed.
10. What `https://demolisher.app/` is (connection refused during the spike); LumenWipe's actual fee-sponsoring
    status beyond its README roadmap.
11. Inner transaction with `fee: "0"` end-to-end through Horizon (protocol-legal per CAP-0015/core; SDK accepts) — #1.
12. Whether an issuer with outstanding balances can be merged (used only for the optional dead-issuer fixture) — #4.
13. The docs' two testnet-reset statements conflict (2–4×/year at 17:00 UTC vs quarterly at 09:00 UTC); the
    dated schedule (2026-12-16) is taken from the current networks page.

## Sources

- [S1] https://developers.stellar.org/docs/learn/fundamentals/transactions/list-of-operations
- [S2] https://developers.stellar.org/docs/build/guides/transactions/fee-bump-transactions
- [S3] https://github.com/stellar/stellar-protocol/blob/master/core/cap-0015.md
- [S4] https://github.com/stellar/stellar-core/blob/master/src/transactions/FeeBumpTransactionFrame.cpp
- [S5] https://github.com/stellar/stellar-core/blob/master/src/transactions/TransactionFrame.cpp
- [S6] https://developers.stellar.org/docs/build/guides/transactions/sponsored-reserves
- [S7] https://github.com/stellar/stellar-protocol/blob/master/core/cap-0033.md
- [S8] https://github.com/stellar/stellar-core/blob/master/src/transactions/MergeOpFrame.cpp
- [S9] https://github.com/stellar/stellar-core/blob/master/src/transactions/ChangeTrustOpFrame.cpp
- [S10] https://github.com/stellar/stellar-core/blob/master/src/transactions/TransactionUtils.cpp
- [S11] https://github.com/stellar/stellar-core/blob/master/src/transactions/BumpSequenceOpFrame.cpp
- [S12] https://github.com/stellar/stellar-core/blob/master/src/transactions/CreateAccountOpFrame.cpp
- [S13] https://github.com/stellar/stellar-core/blob/master/src/transactions/PathPaymentOpFrameBase.cpp
- [S14] https://github.com/stellar/stellar-core/blob/master/src/transactions/PaymentOpFrame.cpp
- [S15] https://github.com/stellar/stellar-protocol/blob/master/core/cap-0035.md
- [S16] https://developers.stellar.org/docs/build/guides/transactions/clawbacks
- [S17] https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0029.md
- [S18] https://developers.stellar.org/docs/data/apis/horizon/api-reference/resources/accounts/object
- [S19] https://developers.stellar.org/docs/data/apis/horizon/api-reference/retrieve-an-account
- [S20] https://developers.stellar.org/docs/data/apis/horizon/api-reference/get-offers-by-account-id
- [S21] https://developers.stellar.org/docs/data/apis/horizon/api-reference/list-strict-send-payment-paths
- [S22] https://developers.stellar.org/docs/data/apis/horizon/api-reference/retrieve-fee-stats
- [S23] https://developers.stellar.org/docs/data/apis/horizon/api-reference/retrieve-a-transaction
- [S24] https://developers.stellar.org/docs/data/apis/horizon/api-reference/structure/rate-limiting
- [S25] https://developers.stellar.org/docs/data/apis/horizon/api-reference/errors/error-handling
- [S26] https://developers.stellar.org/docs/data/apis/horizon/api-reference/errors/result-codes/operation-specific/account-merge
- [S27] https://github.com/stellar/stellar-horizon/blob/main/internal/codes/main.go
- [S28] https://developers.stellar.org/docs/networks
- [S29] https://developers.stellar.org/docs/networks/software-versions
- [S30] https://github.com/stellar/packages/blob/master/docs/testnet-reset.md
- [S31] https://developers.stellar.org/docs/learn/fundamentals/fees-resource-limits-metering
- [S32] https://developers.stellar.org/docs/learn/fundamentals/transactions/operations-and-transactions
- [S33] https://developers.stellar.org/docs/learn/fundamentals/stellar-data-structures/accounts
- [S34] https://developers.stellar.org/docs/learn/fundamentals/liquidity-on-stellar-sdex-liquidity-pools
- [S35] https://stellar.github.io/js-stellar-sdk/ (reference: `/reference/core-transactions/`, `/reference/network-horizon/`; migration: `/migration/00-migration/`)
- [S36] `@stellar/stellar-sdk` 17.1.0 package contents read from npm (`lib/esm/base/transaction_builder.{d.ts,js}`, `lib/esm/base/operations/*.{d.ts,js}`, `lib/esm/base/operations/types.d.ts`, `lib/esm/base/network.d.ts`, `lib/esm/horizon/server.{d.ts,js}`, `lib/esm/horizon/account_response.d.ts`, `lib/esm/horizon/horizon_api.d.ts`, `lib/esm/horizon/types/offer.d.ts`, `lib/esm/horizon/server_api.d.ts`, `lib/esm/errors/*.d.ts`) — https://www.npmjs.com/package/@stellar/stellar-sdk/v/17.1.0 and https://github.com/stellar/js-stellar-sdk
- [S37] https://github.com/stellar/js-stellar-sdk/blob/master/CHANGELOG.md (v16.0.0 breaking changes: Node 22, stellar-base merged, fetch instead of axios)
- [S38] https://github.com/stellar-expert/stellar-expert-explorer — `business-logic/demolisher/demolisher-tx-builder.js`, `views/demolisher/account-demolisher-view.js`, `business-logic/demolisher/test-accounts-builder.js`, `app-settings.js`, `views/router.js`, `views/explorer/explorer-router.js`
- [S39] https://stellar.expert/demolisher/public/ and https://stellar.expert/demolisher/testnet/
- [S40] https://github.com/stellar/js-stellar-wallets/issues/98
- [S41] https://github.com/LumenWipe/lumenwipe (README)
- [S42] https://demolisher.app/ (connection refused on 2026-09-25)
- [S43] Live Horizon testnet probes, 2026-09-25: `https://horizon-testnet.stellar.org/` (root), `/fee_stats`, `/accounts/{random-valid-key}`, `/accounts/{malformed}`, `/ledgers?limit=201`, `/transactions?order=desc&limit=200`, `/transactions/{inner-hash}`, `/accounts/GA4C3WUE7TL7GNXHF27B6Z54VMRCPTW2JH2OQRHH4U2EHPI6CCLMERGE`; `POST https://api.stellar.expert/demolisher/testnet/merge` with an invalid body
- [S44] https://api.stellar.expert/explorer/testnet/ledger/last (live)
- [S45] Stellar CLI 27.1.0, `stellar network settings --network testnet --output json-formatted` (live)
- [S46] https://github.com/stellar/stellar-horizon (current Horizon repository; `stellar/horizon` redirects to a deprecated archive)
- [S47] npm registry lookups (`npm view <pkg> version|dist-tags|engines|peerDependencies`) on 2026-09-25
- [S48] https://github.com/actions/checkout/releases/latest and https://github.com/actions/setup-node/releases/latest
- [S49] https://developers.stellar.org/docs/data/apis/horizon/api-reference/errors/result-codes/transactions
- [S50] https://developers.stellar.org/docs/data/apis/horizon/api-reference/errors/result-codes/operation-specific/{path-payment-strict-send,payment,change-trust,manage-sell-offer}
