# Story 2.3: Retry, failure recovery and resumable execution

Status: review

## Story

As a sponsor operator,
I want failed or timed-out submissions handled safely,
so that a close never double-submits, never leaves me guessing what happened, and can be resumed after a crash.

## Acceptance Criteria

1. AC-E2-S3-1: Given Horizon returns a 504 for a transaction that was actually included, when recovery runs, then the executor finds the transaction by hash, marks it confirmed and does not resubmit it.
2. AC-E2-S3-2: Given `tx_bad_seq`, then the transaction is rebuilt with a fresh sequence number and resubmitted once; a second `tx_bad_seq` stops the run (stop code `SEQUENCE_CONFLICT`).
3. AC-E2-S3-3: Given `tx_insufficient_fee`, then the bid is raised stepwise up to the cap, and the run stops with a clear reason when the cap or the budget allows no more (stop code `FEE_LIMIT`).
4. AC-E2-S3-4: Given an operation failure code, then the report records the step, the code and a human explanation, execution re-plans from live state, and a step that fails twice stops the run before the merge.
5. AC-E2-S3-5: Given a close stopped after transaction 1 of 3, when it is run again for the same account, then the executor re-plans, skips the work already done and completes.
6. AC-E2-S3-6: Every submission attempt is published as it happens, not only at the end.

How each is met, and the test that proves it (all offline, on the fake ledger with scripted faults; no test waits real time):

| AC | Behaviour | Test (`test/unit/execute/`) |
|---|---|---|
| 1 | A 504, 5xx or lost connection is looked up by the outer hash until the inner `maxTime` plus a grace and until a ledger closed after `maxTime`; found means confirmed, with one POST. | `recovery.test.ts` "AC-E2-S3-1: finds a 504'd transaction by hash and never posts it twice"; `submit.test.ts` "treats a 504 as pending ..." |
| 2 | `tx_bad_seq` first looks the earlier envelopes of the transaction up by hash (one may have applied after all), then re-reads the account's sequence number and rebuilds once; a second `tx_bad_seq` stops with `SEQUENCE_CONFLICT`. | `recovery.test.ts` "AC-E2-S3-2: re-reads the sequence ...", "AC-E2-S3-2: stops on a second tx_bad_seq ...", "after tx_bad_seq, finds an earlier envelope that applied after all ..." |
| 3 | `tx_insufficient_fee` rebuilds with the same sequence number and the bid doubled, capped by `maxBaseFeeStroops` and by the budget headroom of that sequence number; when neither allows more the run stops with `FEE_LIMIT` and says which limit. | `recovery.test.ts` "raises the bid stepwise", "stops at the fee cap", "stops at the close budget" |
| 4 | An included failure is classified with ADR-0006's table (`src/execute/classify.ts`). Stop codes stop (`OPERATION_FAILED`, `SEQNUM_TOO_FAR` with the unblocking ledger); re-plan codes re-inspect and re-plan with the same options, at most `maxReplans` (default 3) times. A failed market sale (`op_too_few_offers`, `op_under_dest_min`, `op_cross_self`) drops rung 1 for that asset, so the re-plan falls down the ladder. The step's outcome records `failures`, `resultCodes` and `explanation`; a step that fails twice stops with `STEP_FAILED_TWICE`. | `recovery.test.ts` "a market that moved drops rung 1 ...", "a step that fails twice ...", "stops when the re-plan limit is reached", "keeps op_seq_num_too_far a stop ..."; `executor.test.ts` "falls down the ladder when the market vanishes ...", "stops with the result codes and an explanation ..."; `classify.test.ts` (every row of the table) |
| 5 | Resuming is re-planning: the ledger is the source of truth, so a new run plans only what is left. A re-run after a completed close submits nothing and records the 404. | `recovery.test.ts` "AC-E2-S3-5: a close stopped after transaction 1 of 3 completes with exactly the rest", "re-running a completed close submits nothing ..." |
| 6 | `onReport` receives a copy of the report at creation, for every new envelope (before its POST), every re-post after a 429, every outcome, every re-plan, at the finish and right before an error is thrown; the CLI writes it to disk. | `recovery.test.ts` "AC-E2-S3-6: publishes every attempt as it happens"; `executor.test.ts` "publishes a copy of the report after every change ..." |

## Tasks / Subtasks

- [x] Task 1: decode `result_xdr` into Horizon's result code strings (`src/execute/result-codes.ts`) (AC: 1, 4)
- [x] Task 2: classify submit answers: refused 4xx and 429 are not polled, a polled failure carries its codes, expiry needs a ledger past `maxTime` (`src/execute/submit.ts`) (AC: 1)
- [x] Task 3: ADR-0006's verdict table and the actions for refused envelopes (`src/execute/classify.ts`) (AC: 2, 3, 4)
- [x] Task 4: sponsor budget per sequence number, with headroom for escalation (`src/sponsor/sponsor.ts`) (AC: 3)
- [x] Task 5: per-transaction attempt loop: rebuild after expiry or `tx_too_late`, raise the bid, resequence once, back off after 429 (`src/execute/attempt.ts`) (AC: 1, 2, 3)
- [x] Task 6: re-plan after an operation failure with rung-1 demotion and the drift check (`src/execute/replan.ts`, `src/execute/executor.ts`) (AC: 4)
- [x] Task 7: report model: one entry per envelope, stop reason, re-plans, step outcomes across re-plans (`src/execute/report.ts`) (AC: 4, 6)
- [x] Task 8: `verifyClosed()`, a bounded poll for the 404 (`src/execute/verify.ts`)
- [x] Task 9: offline tests for every branch, resume included (AC: 1-6)

## Dev Notes

- Policy: canonical decision 7 (fees, rebuild after `tx_too_late`, never 10x replace-by-fee), architecture sections 4.6, 4.7 and 7, ADR-0006 (verdicts), PRD FR-12, FR-15, FR-17, NFR-02, NFR-03, NFR-11.
- Safety of rebuilds. An envelope is replaced only when it can never apply: refused with `tx_too_late`, or not found by hash after its time bound passed. Time bounds are judged by ledger close time (https://developers.stellar.org/docs/learn/fundamentals/transactions/operations-and-transactions#time-bounds), so after the local deadline the executor also waits for a ledger that closed after `maxTime` and looks once more; close times only grow and earlier ledgers are already ingested, so that lookup is conclusive. If no such ledger appears within `ledgerWaitSeconds`, the run stops with `OUTCOME_UNKNOWN` instead of rebuilding. A replacement for a still-queued envelope would need a 10x bid (https://developers.stellar.org/docs/build/guides/transactions/fee-bump-transactions#replace-by-fee), which Dustin never relies on. An envelope refused for its fee was never queued; envelopes for one sequence number can apply at most once between them.
- Budget. An inner sequence number is consumed once at apply time (https://developers.stellar.org/docs/build/guides/transactions/fee-bump-transactions#application), so at most one of the envelopes signed for it is charged. `FeeSponsor` therefore counts the largest bid per sequence number, not the sum of every signature, and a rebuild with a doubled bid costs only the difference; `headroomStroops()` lets the executor stop before signing when neither the cap nor the budget allows the next bid.
- `tx_bad_seq`: the instruction for this story (look the previous envelopes up by hash, then re-read the sequence and rebuild once) is followed; ADR-0006's row says "else replan". A rebuilt transaction that meets a changed state fails on the ledger and re-plans through the operation path anyway.
- 429 is Horizon's per-IP rate limit (https://developers.stellar.org/docs/data/apis/horizon/api-reference/structure/rate-limiting): nothing was accepted, so the same envelope is posted again after `backoffMs`, doubled each time, at most `maxRateLimitRetries` (5) more times. A 400 without result codes or any other 4xx is refused at once and not polled (review finding R11).
- Result codes. `GET /transactions/{hash}` carries only `result_xdr`, so a transaction found failed after a 504 gets its codes rebuilt with the strings of stellar-horizon `internal/codes/main.go` (https://github.com/stellar/stellar-horizon/blob/main/internal/codes/main.go, commit 51fd177 of 2026-03-16). The decoder reproduces, from their `result_xdr` read on testnet Horizon, the codes Horizon returned at submission for four day-1 failures (`op_seq_num_too_far`, `op_no_issuer`, `op_src_not_authorized`, `op_invalid_limit`; hashes in `docs/progress-log.md` and `docs/research/day1-experiments-2026-09-26.json`), and a test checks that every member of the SDK's result enums for the operations Dustin submits is mapped. Horizon spells two codes differently from ADR-0006: `op_offer_not_found` (ADR: `op_not_found`) and `op_not_aut_maintain_liabilities` (ADR: `op_not_auth_maintain_liabilities`); the code matches Horizon.
- Ladder fallback without touching the planner. A mid-run re-plan reads through `withPathsOnlyFor()`, which offers strict-send paths only to the assets the approved plan sold on rung 1 and whose sale has not failed. A failed sale therefore falls down the ladder (canonical decision 8), and no asset moves up to rung 1 because a market appeared mid-run. The re-planned step's reason then says Horizon found no path; the report's `replans[].demoted` and the step outcome's `explanation` give the real reason.
- Drift during the run. `replanDrift()` compares the re-plan with the approved plan (round 0) by step identity (kind plus offer id, asset, data name or pool): a re-plan may drop steps that applied and move an asset down the ladder or off it; a step the approved plan did not have, a larger balance or a move up the ladder is drift and follows `onDrift` (default abort). A re-plan that can no longer merge stops with `PLAN_NOT_CLOSABLE` unless `allowPartial` is set.
- A failed merge preflight stops with verdict `replan` (run again) rather than re-planning inside the run: every preflight failure (a subentry, sponsorship, a missing or memo-required destination, the guard) ends in a blocker or in drift on the next plan anyway, and the run again shows it.
- `op_seq_num_too_far` stays a stop with the unblocking ledger (`(seq + 1 >> 32) + 1`, canonical decision 10); waiting is E3-S4.
- Status semantics (canonical decision 5). `closed`: the merge applied and `verifyClosed` saw the 404. `partial`: an `allowPartial` run did everything else. `aborted`: nothing was submitted. `failed`: stopped part-way; running again continues from the ledger. A merge that applied but could not be verified because the final check threw keeps `closed` with `verification: null`, a message saying it is unverified and `stop` holding the error, and the error is thrown carrying that report, so the CLI can tell it from a verified close (exit 0) and from a run that never submitted anything.

### References

- docs/epics-and-stories.md, Story 2.3
- docs/architecture.md sections 4.6, 4.7, 7
- docs/adr/ADR-0003, ADR-0006
- docs/reviews/2026-09-26-e0-e2-review.md (R1, R2, R6, R9-R12, R18)

## Dev Agent Record

### Agent Model Used

dev-story workflow (AI developer agent)

### Implementation Plan

- `executeClose()` validates, checks the submit endpoint (R6), re-plans (R12) and hands over to a `CloseRun`, which owns the report from then on. Expected outcomes return the report with `stop` set; exceptions finish it and are thrown carrying it (R1).
- `submitPlannedTransaction()` runs one planned transaction: read the sequence, check the bid against the cap and the budget headroom, build with Horizon-clock time bounds, sign, wrap, record the envelope, post (with 429 back-off), then apply the outcome rules above.
- On an included failure the orchestrator classifies the first failed operation, updates the step outcome, and either stops or re-plans through the path-limited reader, checks drift and closability, records the re-plan and runs the new plan's transactions.
- The final check is `verifyClosed()`: it polls for the 404 only when a merge applied.

### Debug Log References

- Red before green for every task; the first run of the recovery suite had five failures: two expectations wrong for the fake ledger (it reports codes only up to the failing operation and has no result XDR), one test handler firing again in the re-planned round, one revocation that left "maintain liabilities" set, and one real design point: `report.stop.stage` now records where the run was, while the thrown error keeps the stage it was raised with.
- A required `expired` flag on `unknown` outcomes broke the fixture builder's test (not this story's file); it became the optional `mayStillApply`, which keeps the old meaning of a bare `unknown`.

### Completion Notes List

- All six ACs covered offline; 303 unit tests in 42 files pass; lint, format, typecheck and build pass.
- New `ExecuteOptions`: `graceSeconds`, `maxReplans`, `maxAttemptsPerTransaction`, `maxRateLimitRetries`, `backoffMs`, `verifyTimeoutMs`, `sleep`.
- New report fields: `stop`, `replans`, `verification.ledger`; per envelope `attempt`, `round`, `sequence`, `baseFeeStroops`, `maxTime`, `rebuiltBecause`, `explanation`; per step `rung`, `round`, `failures`, `resultCodes`, `explanation`.
- Not run: the testnet tier (live evidence closes wait for the integration of R1 to R3).

### File List

- `src/execute/attempt.ts`, `src/execute/classify.ts`, `src/execute/events.ts`, `src/execute/preflight.ts`, `src/execute/replan.ts`, `src/execute/result-codes.ts`, `src/execute/verify.ts` (new)
- `src/execute/executor.ts`, `src/execute/report.ts`, `src/execute/submit.ts`, `src/sponsor/sponsor.ts`, `src/plan/fees.ts`, `src/plan/model.ts`, `src/plan/plan.ts` (modified)
- `test/unit/execute/classify.test.ts`, `test/unit/execute/preflight.test.ts`, `test/unit/execute/recovery.test.ts`, `test/unit/execute/replan.test.ts`, `test/unit/execute/result-codes.test.ts`, `test/unit/execute/verify.test.ts`, `test/unit/plan/fees.test.ts`, `test/unit/plan/plan-options.test.ts` (new)
- `test/unit/execute/executor.test.ts`, `test/unit/execute/submit.test.ts`, `test/unit/sponsor/sponsor.test.ts`, `test/unit/plan/__snapshots__/dry-run.test.ts.snap` (modified; the snapshot only gains the plan's `options` block)
- `docs/stories/2-3-retry-recovery-resume.md` (new), `docs/stories/2-1-fee-bump-submission-engine.md`, `docs/stories/2-2-simple-close-executor.md` (modified)

## Change Log

- 2026-09-26: Retry, rebuild and re-plan rules, result-code decoding, per-sequence budget, verification helper, report survives errors (R1), and the review findings R2, R6, R9-R12 and R18 of E2-S1/E2-S2. Status: review.
