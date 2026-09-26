# Story 2.2: Execute a close

Status: review

## Story

As a user,
I want `executeClose()` to run the plan: cancel my offers, dispose of balances, remove my trustlines and data entries and merge my account into the destination,
so that a broke account is closed and its XLM reaches my destination.

## Acceptance Criteria

1. Given a zero-spendable account with offers, a data entry and zero-balance trustlines, when its plan is executed, then exactly the planned fee-bumped transactions are submitted with the planned operations in order, and the account no longer exists afterwards.
2. Then the destination's XLM balance increases by exactly the merged amount, which the report reads from the merge result.
3. Given `confirm` is not the literal `true`, then `executeClose` throws `CONFIRMATION_REQUIRED` and submits nothing.
4. Given a plan whose status is not `closable`, then nothing is submitted unless `allowPartial` is set; with it, every transaction except the merge runs and the report status is `partial`.
5. Before anything is signed, the account is re-inspected and re-planned: a different `planHash` aborts with status `aborted` and nothing submitted (`onDrift: "abort"`, the default), or continues with the fresh plan (`onDrift: "replan"`); the account signer must match the account, the sponsor must differ from the account, and the sponsor must hold spendable XLM of at least the close budget (canonical decision 7).
6. A merge that runs in its own transaction is preceded by a fresh preflight: no trustline, offer, data entry or pool share left, the account sponsors nothing, the destination exists and the sequence guard passes; otherwise the merge is not submitted.
7. Every submitted transaction is recorded in the report as it happens (outer and inner hash, ledger, fee charged, fee account, both envelopes, explorer URL, result), events are emitted for each stage, and a failed or unknown submission stops the run with the result codes in the report (retries and re-planning are E2-S3).

## Tasks / Subtasks

- [x] Task 1: report model and events (`src/execute/report.ts`) (AC: 7)
- [x] Task 2: merge amount from the result XDR (AC: 2)
- [x] Task 3: `executeClose()` (`src/execute/executor.ts`) with preflight, drift, sponsor check, transaction loop, merge preflight, verification (AC: 1-7)
- [x] Task 4: an in-memory ledger for offline executor tests (`test/helpers/fake-ledger.ts`) that applies operations with the protocol's result codes (AC: 1-7)

## Dev Notes

- docs/architecture.md section 4.7 (executor state machine), PRD FR-11, FR-16, FR-18, FR-20; canonical decisions 4, 6, 7.
- The destination may be the fee sponsor (a user closing into the same funded account that pays the fees); architecture section 11 allows it with a warning, which this story follows instead of PRD FR-16's "three different accounts". The account can never be its own sponsor or destination.
- SDK 17.1.0 decodes XDR unions as objects with a `type` field (`lib/esm/xdr/util.js` `isUnionVariant`); the merge amount is `result.innerResultPair.result.result.results[i].tr.accountMergeResult.sourceAccountBalance` (checked on a day-1 testnet merge).

### References

- docs/epics-and-stories.md, Story 2.2

## Dev Agent Record

### Agent Model Used

dev-story workflow (AI developer agent)

### Implementation Plan

- `executeClose()` checks `confirm`, the network and the signers, re-plans from fresh ledger state, compares the plan hash (drift), refuses a non-closable plan without `allowPartial`, checks that the sponsor can cover the budget, then submits each planned transaction: fresh sequence number, time bound from the latest ledger's close time, inner transaction signed by the account signer, fee bump signed by the sponsor, submit and confirm. A merge in its own transaction is preceded by a fresh preflight. After the run it looks the account up and records the verification.
- `CloseReport` is filled as the run progresses (every hash, both envelopes, fees charged, step outcomes); the merged amount comes from the merge result XDR; `CloseEvent`s are emitted for each stage.
- `test/helpers/fake-ledger.ts` is an in-memory testnet seeded from the recorded fixture. It decodes submitted fee bumps, applies the operations with the protocol's result codes (consuming the sequence number and the sponsor's fee on failure), and serves the Horizon reads.
- The submitter's classification was corrected: a fee bump reporting `tx_fee_bump_inner_failed` was included only if the inner code is `tx_failed`; otherwise (e.g. `tx_bad_auth_extra`, day-1 experiment 3) it was refused at validation.

### Debug Log References

- Red: the executor test file failed on the missing module; green after implementation.
- Self-review fixes before commit: the merge preflight looked up an M destination incorrectly, the partial-run reserve attribution used a hard-coded reserve, and the leftover count ignored that a pool-share trustline counts two subentries.

### Completion Notes List

- AC1-AC2, AC7: live on testnet, a freshly built messy fixture (zero spendable XLM, 4 trustlines with dust including a sponsored one, 2 offers, 1 data entry) was closed by `executeClose()` in three fee-bumped transactions; the account returns 404; every transaction's `fee_account` is the sponsor and `source_account` the fixture; the destination grew by exactly the merged amount read from the result XDR; the reserve sponsor's `num_sponsoring` returned to 0; the report contains no secret (63 s).
- AC3-AC6: covered offline on the fake ledger (confirmation, wrong signer, sponsor equal to the account, drift abort and replan, partial refusal and `allowPartial`, underfunded sponsor, a market that vanishes mid-run, a subentry that reappears before the merge).
- 164 unit tests pass; lint and typecheck pass.

### File List

- `src/execute/executor.ts`, `src/execute/report.ts` (new)
- `src/execute/submit.ts` (modified: included-failure classification)
- `src/errors/dustin-error.ts`, `src/cli/exit-codes.ts` (modified: codes)
- `test/helpers/fake-ledger.ts`, `test/unit/execute/executor.test.ts`, `test/unit/execute/report.test.ts`, `test/testnet/execute-close.test.ts` (new)
- `test/unit/execute/submit.test.ts` (modified)
- `docs/stories/2-2-simple-close-executor.md`, `docs/stories/sprint-status.yaml`

## Review findings closed

From docs/reviews/2026-09-26-e0-e2-review.md, closed in E2-S3 (docs/stories/2-3-retry-recovery-resume.md):

- R1: the report is built right after the fresh plan and the whole run is wrapped. Expected outcomes return a report with a machine-readable `stop`; any exception finishes the report (`closed` if the merge applied, `failed` once something was submitted, else `aborted`), publishes it through `onReport` and is thrown as a `DustinError` carrying it (`withReport`, or `EXECUTION_INTERRUPTED` with the cause).
- R2: a fresh plan whose bids exceed the close budget ends as an `aborted` report (stop `OVER_BUDGET`) before anything is signed, with the bid total, the budget and the remedy; the sponsor-spendable check stays.
- R6: with the default submitter the executor calls `verifyHorizonIsTestnet(config.horizonUrl)` before signing anything; an injected submitter is the caller's responsibility.
- R9, R10: the merge preflight (`src/execute/preflight.ts`) requires the base account of a muxed destination to exist and re-reads a G destination's SEP-29 `config.memo_required` marker, refusing a memo-less merge. Leftover subentries are checked only when the merge runs alone.
- R12: the plan records `options` (`slippageBps`, `maxOpsPerTransaction`, `maxWaitLedgers`) and the executor's re-plan forwards every planning option, execute-option cap and budget first. A non-default slippage bound is part of `planHash`, so a changed bound is drift.

## Change Log

- 2026-09-26: `executeClose()` with preflight, drift handling, sponsor check, merge preflight, verification and a progressive report; first live end-to-end close of a messy fixture. Status: review.
- 2026-09-26: Review findings R1, R2, R6, R9, R10 and R12 closed in E2-S3.
