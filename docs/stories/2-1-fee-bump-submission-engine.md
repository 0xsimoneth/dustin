# Story 2.1: Sponsor-paid fee-bump submission engine

Status: done

## Story

As a sponsor operator,
I want every transaction Dustin submits to be an inner transaction from the closing account wrapped in a fee bump that I pay,
so that a zero-XLM account can be closed without ever paying a fee.

## Acceptance Criteria

1. Given a planned transaction, when it is built and submitted, then Horizon reports a fee-bump envelope whose `fee_account` is the sponsor and whose inner `source_account` is the closing account, with inner fee 0; the result records the outer hash, the inner hash, the ledger and `fee_charged`.
2. Given the closing account holds exactly its minimum balance, then submission still succeeds and its XLM balance changes only through the operations, never by a fee.
3. Given `maxBaseFeeStroops`, then the bid per operation never exceeds it, and a cap below the 100-stroop network minimum is refused.
4. Given the account's signature comes from a signer callback instead of a secret, then the engine works with no account secret in memory (unit test with a signer object).
5. Given a network passphrase other than testnet, then nothing is signed.
6. The sponsor signs only fee-bump envelopes: it refuses an inner transaction sourced by the sponsor, containing an operation with another source, or pushing the cumulative bids of the close past its budget (default 5 XLM).
7. A Horizon 504 is resolved by polling the outer hash; the same envelope is never rebuilt while it may still land (edge case T-06).
8. Operation descriptors map one to one onto SDK operations (offer cancellation with the offer's own assets and price, strict-send path payment, payment, `changeTrust` with limit `"0"`, `manageData` with a null value, `accountMerge` to a G or M address).

## Tasks / Subtasks

- [x] Task 1: descriptor to SDK operation mapping (`src/tx/operations.ts`) (AC: 8)
- [x] Task 2: inner transaction builder with server-time bounds and inner fee 0 (`src/tx/build-inner.ts`) (AC: 1, 2)
- [x] Task 3: signer interface and keypair signer (`src/sponsor/signer.ts`) (AC: 4)
- [x] Task 4: fee sponsor with content checks, cap and budget (`src/sponsor/sponsor.ts`) (AC: 3, 5, 6)
- [x] Task 5: Horizon submitter with 504 polling (`src/execute/submit.ts`) (AC: 1, 7)
- [x] Task 6: unit tests and a testnet test on a zero-spendable account (AC: 1-8)

## Dev Notes

- ADR-0003 and canonical decision 7: every transaction is fee-bumped, the sponsor signs only the outer envelope, the inner fee is 0 (day-1 experiment 1 verified it on testnet), the bid is capped and the close has a budget.
- ADR-0002 relay controls adopted here as defence in depth: every operation source equals the inner source and the sponsor is never the inner source.
- Time bounds come from Horizon's clock (`Date` header) through the SDK's server-time map, not the local clock (edge case T-07); 120 s by default.
- Horizon 504 "is not an error": poll `GET /transactions/{hash}` (the outer hash; day-1 experiment 15 showed the inner hash resolves too) until the time bound has passed (docs/architecture.md section 7.3).
- `Transaction.hash()` returns a `Uint8Array` in SDK 17.1.0; hex-encode with `hashHex()`.

### References

- docs/epics-and-stories.md, Story 2.1
- docs/architecture.md sections 4.5-4.7, 7.3
- docs/adr/ADR-0002, ADR-0003, ADR-0006

## Dev Agent Record

### Agent Model Used

dev-story workflow (AI developer agent)

### Implementation Plan

- `toOperation()` maps each descriptor onto the SDK operation; `buildInnerTransaction()` uses the next sequence number, inner fee `"0"`, an explicit upper time bound and an optional text memo, and refuses more than 100 operations and any network but testnet.
- `Signer` is the only way the engine signs; `keypairSigner()` keeps the keypair in a closure. `FeeSponsor.wrap()` checks the inner transaction's content, caps the bid, charges the bid `x (ops + 1)` against the close budget and signs only the outer envelope.
- `horizonSubmitter()` posts to `/transactions` and reads `/transactions/{hash}`; `submitAndConfirm()` returns `applied`, `failed` (included, sequence and fee consumed: `tx_failed`, `tx_fee_bump_inner_failed`), `rejected` (not included) or `unknown` (not found after the time bound plus two ledgers). A 504, a 5xx or a lost connection leads to polling by hash, never to a new envelope.
- The executor takes the time bound from the latest ledger's close time (Horizon's clock), not the local clock.

### Debug Log References

- Red: four test files failed on missing modules.
- Two test mistakes, not code faults: `Keypair.sign()` returns a `Uint8Array` in SDK 17.1.0 (a second instance of the `hash()` trap), and a built text memo stores its value as bytes.

### Completion Notes List

- AC1-AC2: live test on testnet: a fresh account drained to exactly its minimum balance (spendable 0) submitted a plan descriptor through the engine; Horizon shows `fee_account` = sponsor, `source_account` = account, inner `max_fee` "0"; the account's balance did not move by a stroop.
- AC3: the bid is capped; a cap below 100 stroops is refused.
- AC4: a wallet-style signer object signs the inner transaction; no secret is handed to the engine.
- AC5: `FeeSponsor` and `buildInnerTransaction` refuse any passphrase but testnet before signing.
- AC6: sponsor-sourced inner transactions and foreign operation sources are refused; the budget stops a further signature.
- AC7: a 504 is resolved by polling the hash with a single POST; a lost connection past the time bound ends `unknown`.
- AC8: every descriptor maps onto the expected SDK operation, including a muxed merge destination.
- 155 unit tests pass; lint and typecheck pass.

### File List

- `src/tx/operations.ts`, `src/tx/build-inner.ts`, `src/sponsor/signer.ts`, `src/sponsor/sponsor.ts`, `src/execute/submit.ts` (new)
- `src/errors/dustin-error.ts` (modified: codes)
- `test/unit/tx/operations.test.ts`, `test/unit/tx/build-inner.test.ts`, `test/unit/sponsor/sponsor.test.ts`, `test/unit/execute/submit.test.ts`, `test/testnet/fee-bump-engine.test.ts` (new)
- `docs/stories/2-1-fee-bump-submission-engine.md`, `docs/stories/sprint-status.yaml`

## Review findings closed

From docs/reviews/2026-09-26-e0-e2-review.md, closed in E2-S3 (docs/stories/2-3-retry-recovery-resume.md):

- R11: `submitAndConfirm()` reports a POST answered 400 without result codes, 429 or any other 4xx as `rejected` at once instead of polling by hash until the time bound; a transaction found failed after a 504 carries Horizon-style result codes and the fee charged, rebuilt from its `result_xdr` (`src/execute/result-codes.ts`, checked on four real testnet failures). An unconfirmed envelope is reported gone only after a ledger closed past its `maxTime`; otherwise it is flagged `mayStillApply`.
- R18: the plan's fee estimate clamps a base fee override to the cap exactly like `FeeSponsor.wrap()`, so estimate and bid agree.
- Budget accounting (E2-S3, not a finding): `FeeSponsor` counts the largest bid per sequence number, since only one envelope per sequence number can ever be charged, and exposes `headroomStroops()` for bid escalation.

## Change Log

- 2026-09-26: Operation mapping, inner builder, signer interface, fee sponsor with content checks and budget, Horizon submitter with 504 polling. Status: review.
- 2026-09-26: Review findings R11 and R18 closed in E2-S3; per-sequence budget accounting.
- 2026-09-27: reviewed in docs/reviews/2026-09-27-e2-integration-review.md; no open finding. Status: done.
