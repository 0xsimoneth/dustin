# ADR-0003: Fee-bump every transaction (sponsor as fee source), not sponsor as transaction source

- Status: Accepted
- Date: 2026-09-25
- Deciders: the builder (system architect role)
- Related: `docs/architecture.md` sections 4.5, 4.6, 4.7, 11; ADR-0002

## Context

The account being closed has zero spendable XLM. Something else must pay the fee of every transaction that touches it. Stellar offers two ways:

**Option A, fee-bump envelopes (CAP-0015).** The closing account builds and signs an ordinary inner transaction (it is the source, it consumes its own sequence number). The sponsor wraps it in a `FeeBumpTransaction`, becomes the `feeSource`, pays the whole fee and signs only the outer envelope. Rules verified:

- Fee must be at least the network minimum for (inner operations + 1) and at least the inner transaction's fee; the fee account must exist, hold the XLM and sign the outer envelope; results are `txFEE_BUMP_INNER_SUCCESS` / `txFEE_BUMP_INNER_FAILED` (https://developers.stellar.org/docs/build/guides/transactions/fee-bump-transactions).
- The inner fee may be below the minimum; the fee bump carries no sequence number of its own and relies on the inner one for replay prevention (https://github.com/stellar/stellar-protocol/blob/master/core/cap-0015.md).
- JS SDK: `TransactionBuilder.buildFeeBumpTransaction(feeSource, baseFee, innerTx, networkPassphrase)`, `baseFee` per operation, total `baseFee * (innerOps + 1)`; the SDK requires `baseFee >= BASE_FEE` and `baseFee >=` the inner inclusion fee, and time bounds are required on the inner transaction when the SDK converts a v0 envelope (https://github.com/stellar/js-stellar-sdk/blob/main/src/base/transaction_builder.ts).
- Horizon reports inner failures under `extras.result_codes.inner_transaction` and `.operations` (https://github.com/stellar/go/blob/master/protocols/horizon/main.go).

**Option B, sponsor as transaction source.** The sponsor is the transaction source (pays the fee, consumes its own sequence number) and every operation sets `source = closing account`. Both keys sign the same transaction. This is legal: "operations are executed for the source account of the transaction unless an operation override is defined" (https://developers.stellar.org/docs/learn/fundamentals/transactions/operations-and-transactions).

Comparison:

| Aspect | A: fee bump | B: sponsor as source |
|---|---|---|
| SOW compliance | Required: "every transaction in the close is fee-bumped by the sponsor" (Appendix B) | Not compliant |
| What the sponsor signs | Only the fee envelope; it never authorises operations | A transaction containing the user's operations; a malicious or buggy plan could add operations sourced by the sponsor (a payment from the sponsor) and the sponsor's signature would authorise them |
| Blast radius of a sponsor bug | The fee budget | The sponsor's whole balance unless the sponsor validates every operation |
| Portability to wallets | The wallet signs a complete, self-contained inner transaction; any relay can wrap it later | The wallet must sign a transaction whose source is a third party, awkward in wallet UIs |
| Sequence numbers | Closing account's sequence advances per transaction (needed anyway for the merge guard bookkeeping) | Sponsor's sequence advances; serialises the sponsor's traffic |
| Cost | One extra base fee per transaction (the "+1") | None |
| Merge semantics | Merge op inside an inner transaction sourced by the merged account, last op | Merge op with op-source = closing account; same protocol checks |
| Retry semantics | Same inner envelope resubmittable; rebuild after time bound expiry | Same |

## Decision

Every transaction Dustin submits is a fee-bump envelope signed by the sponsor, wrapping an inner transaction sourced and signed by the closing account. Concretely:

1. Inner: source = closing account, `fee = baseFee` per operation, `maxTime = now + 120 s`, optional memo.
2. Outer: `buildFeeBumpTransaction(sponsor.publicKey(), baseFee, inner, passphrase)`, signed by the sponsor; total `baseFee * (ops + 1)`.
3. `baseFee` policy: `clamp(max(fee_stats.last_ledger_base_fee, fee_stats.fee_charged.p80), 100, maxBaseFeeStroops)`, escalated `x2` on expiry, never replacing a queued transaction (10x rule).
4. The sponsor refuses to sign unless the inner hash was produced by the executor in this run and the cumulative fee stays within `sponsorBudgetStroops`.

The inner fee is set equal to `baseFee` rather than the minimum because the SDK enforces `outer baseFee >= inner inclusion fee`; setting both to the same value keeps the arithmetic obvious. The closing account still pays nothing: the fee account is the fee bump's source (CAP-0015).

## Consequences

- One extra base fee per transaction; at 100 stroops that is 0.00001 XLM, negligible even under surge.
- Inner transactions always carry time bounds; Dustin relies on them for safe rebuilds (architecture section 7.3) and the SDK needs them when converting v0 envelopes.
- Explorer links use the outer hash; the report records both hashes.
- The `FeeBumpSigner` interface makes a hosted relay (ADR-0002, stretch) a drop-in.

## Alternatives considered

- **Option B** as above: rejected for SOW non-compliance and the larger blast radius.
- **Hybrid: sponsor as source only for the fixture builder.** Rejected to keep one code path; fixture transactions are fee-bumped too, which exercises the layer before the first close.
- **Pre-funding the closing account with XLM for fees.** Rejected: it changes the account's balance and the success metric ("zero spendable XLM"), and a top-up to an account with raised thresholds or a far-future sequence number could be lost.

## Sources

- SOW: `SUCCESSFUL_SOW.md` (Deliverable 2, Appendix B)
- Fee-bump transactions guide: https://developers.stellar.org/docs/build/guides/transactions/fee-bump-transactions
- CAP-0015: https://github.com/stellar/stellar-protocol/blob/master/core/cap-0015.md
- JS SDK `TransactionBuilder`: https://github.com/stellar/js-stellar-sdk/blob/main/src/base/transaction_builder.ts
- Operations and transactions (operation-level source): https://developers.stellar.org/docs/learn/fundamentals/transactions/operations-and-transactions
- Horizon result-code struct: https://github.com/stellar/go/blob/master/protocols/horizon/main.go
- Horizon fee stats (surge observed 2026-09-25): https://horizon-testnet.stellar.org/fee_stats
