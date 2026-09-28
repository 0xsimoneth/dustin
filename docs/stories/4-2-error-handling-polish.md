# Story 4.2: Error handling and failure-mode polish

Status: review

## Story

As an integrator,
I want every failure surfaced as a typed error with a code, a message and a remediation,
so that my wallet can show users what to do instead of a stack trace.

## Acceptance Criteria

As written in `docs/epics-and-stories.md` (Story 4.2), with the review findings deferred to this story: CL-1 and AA-13 from the E2 integration review (`docs/reviews/2026-09-27-e2-integration-review.md`), and CA-11 and CA-18 from the E3 review (`docs/reviews/2026-09-28-e3-review.md`), which the builder decided on 2026-09-28 (PRD decisions D-10 and D-11).

1. AC-E4-S2-1: Then every error thrown by the SDK is a `DustinError` subclass with `code`, `message`, `remediation` and `cause`, and Horizon failures carry the transaction and operation result codes.
   - **Met, with the built names (PRD decision D-2): `remedy`, not `remediation`.** Every error the SDK raises is a `DustinError` with `code`, `message` (redacted), `stage`, `verdict`, `retryable`, `remedy` where the raising code knows a specific one, and the underlying error as the standard `cause`; `executeClose()` wraps anything else that stops it (a signer or an observer that throws, a bug) as `EXECUTION_INTERRUPTED` with the original as `cause` and the report attached (review finding R1). Since this story every code also has a default remedy (`DEFAULT_REMEDIES`, `remedyOf()`, exported; `docs/errors.md`), and the CLI prints one under every error. Horizon's result codes: a submission's failure is an expected outcome, so it is returned rather than thrown (ADR-0006), with the codes on the envelope, the failing step, the stop and the re-plan's trigger; a thrown error carries them in `DustinError.horizon`. An error thrown by the caller's own injected reader into `planClose()` passes through unchanged: it is the caller's error, not the SDK's.
2. AC-E4-S2-2: Then the CLI prints a one-line summary by default and full detail with `--verbose`, with secrets redacted (test).
   - **Met.** By default `dustin: CODE: message` and the remedy on the next line; `--verbose` (a global option, before or after the command) adds the stage, the verdict and whether it may be retried, Horizon's result codes, the details and the cause chain (each cause with its code when it has one) and, for an unexpected error, its stack; with `--json` the same detail rides on the `error` line. Everything is redacted.
3. AC-E4-S2-3: Then no unhandled promise rejection can escape the CLI (harness test), and `docs/errors.md` lists every code with its remediation.
   - **Met.** `run()` never rejects: whatever is thrown, even a value whose conversion to text throws (`Object.create(null)` made the old catch block throw, `String()` of it fails), ends as an exit code and one message, and a failure of the error reporting itself ends as exit 1. The harness listens for Node's `unhandledRejection` event (https://nodejs.org/api/process.html#event-unhandledrejection) through ten scenarios. `docs/errors.md` lists every `DustinErrorCode` and `StopCode` with its meaning, stage, exit code and remedy, and the CLI-only codes; a test reads the unions from the source, so a code added later without a row fails.
4. CL-1: a SIGINT or SIGTERM during execution exits 130 without a receipt.
   - **Met.** `ExecuteOptions.signal` (a standard AbortSignal, https://nodejs.org/api/globals.html#class-abortsignal) stops the executor at its next safe point: before each planned transaction, before an envelope is rebuilt, after an envelope is refused or its outcome could not be settled, and during the waits for an envelope's outcome and for the sequence guard, which end at once. No envelope is posted after the abort, not even the same one again after a 429; an envelope already posted is looked up once more and settled, or recorded as `unknown` with `mayStillApply` and named in the stop with its time bound. The report ends with the stop `INTERRUPTED` (verdict `replan`), is published and returned, as for every other stop: `aborted` when nothing was posted, `failed` otherwise, `closed` when a merge of the run applied. The CLI turns SIGINT and SIGTERM into that abort while the executor runs (https://nodejs.org/api/process.html#signal-events: with a listener installed they no longer end the process), prints a notice, the receipt, writes `--report`, and exits by the report: 3 when nothing was submitted, 5 when something was or may have been. A second signal writes the latest copy of the report synchronously and exits 5 at once. The handlers are added after the typed confirmation, so Ctrl-C there stays "not confirmed" (exit 3), and removed when the executor ends, even when it throws. The signal source and the exit are injected (`CliDeps.signals`, `CliDeps.exit`), so no test sends a real signal.
5. AA-13: a CLI re-run after a completed close exits 3 and records no 404.
   - **Met.** On an account Horizon answers 404 for, `close --execute` asks nothing and signs nothing: the executor records the 404 as it does for an SDK caller (`verification.accountExists` false, `horizonStatus` 404, the ledger, the account link; stop `ACCOUNT_MISSING`), the receipt says the account does not exist and that, if an earlier run merged it, the close is complete, `--report` and `--json` carry the report, and the exit code stays 3 (PRD FR-17; canonical decision 5).
6. CA-11 (PRD decision D-10): a near sequence guard that clears while the typed confirmation waits stopped the run with `PLAN_CHANGED`.
   - **Met.** The plan hash sees the grouping the plan would have without the wait for a near guard, so the regrouping of the merge (`separateMerge` in `src/plan/plan.ts`), `unblocksAtLedger` and the wait estimate leave it; a plan without a near guard hashes exactly as before (the committed dry-run snapshot's hash is unchanged). A plan that gains or loses its merge (a far guard coming within `maxWaitLedgers`, or a near one going beyond it) still changes the hash, on purpose. The executor runs the fresh plan's grouping and adds a warning that names both groupings, and the receipt describes the plans the executor ran. The reverse case follows the same rule: a sequence number bumped a few ledgers ahead while the confirmation waits leaves the steps as approved, and the executor waits for the merge (FR-14) instead of stopping, as it does after a mid-run bump; the sequence number was never part of the plan hash.
7. CA-18 (PRD decision D-11): only the environment and `.env` supplied the secrets.
   - **Met.** A secret in neither is asked for with a hidden prompt when standard input and standard error are both terminals and `--json` is not given; otherwise the run is refused as before with `MISSING_ACCOUNT_SECRET` or `MISSING_SPONSOR_SECRET` (exit 2), naming why the prompt was not asked. The readline interface writes to a stream that drops everything, so nothing typed is echoed, and `historySize: 0` keeps no history (https://nodejs.org/api/readline.html#readlinecreateinterfaceoptions); Ctrl-C or the end of input count as missing. The account's secret is asked and checked first. The help of `close` names the three sources.

How each is met, and the test that proves it:

| AC | Behaviour | Tests |
|---|---|---|
| 1 | Default remedies for every code; the CLI prints one under an error that names none; the report and the stop of a failed envelope carry the result codes; a signer that throws gives `EXECUTION_INTERRUPTED` with the cause and the report | `test/unit/errors/remedies.test.ts`; `test/unit/cli/verbose-errors.test.ts` "prints the remedy of the error's code when the error names none"; `test/unit/cli/schemas.test.ts` "validates a run that failed, re-planned and stopped"; `test/unit/execute/recovery.test.ts` "attaches the report when a signer throws, as EXECUTION_INTERRUPTED with the cause" |
| 2 | One line and the remedy by default; stage, Horizon codes, details and causes with `--verbose` (before or after the command), redacted; the same on the `error` line with `--json`; the stack of an unexpected error only with `--verbose` | `test/unit/cli/verbose-errors.test.ts` |
| 3 | No rejection escapes and `run()` returns an exit code in ten scenarios; `docs/errors.md` lists every code with its exit code checked against `exitCodeFor` | `test/unit/cli/no-unhandled-rejection.test.ts`; `test/unit/errors/remedies.test.ts` |
| CL-1 | The executor: aborted before anything is signed, after the first envelope, after the merge (nothing changes), during the sequence-guard wait, while an envelope's outcome is open; a signal that is not an AbortSignal. The CLI: exit 5 after a submission and 3 before, the receipt and `--report`, a second signal exits 5 after writing the latest copy, no handler during the confirmation, handlers removed when the executor throws | `test/unit/execute/abort-signal.test.ts`; `test/unit/cli/signals.test.ts`; `test/unit/cli/exit-code-table.test.ts` (the signal rows) |
| AA-13 | The 404 in the receipt and in `--report`, the report as the `--json` document, no confirmation asked, exit 3 | `test/unit/cli/rerun-closed.test.ts`; `test/unit/cli/close-execute.test.ts` "has nothing to execute for an account that no longer exists, and records the 404 (exit 3)" |
| CA-11 | The hash kept when a near guard clears or only gets shorter, and for a plan whose merge runs alone anyway; changed when the plan gains or loses its merge or the account changes; the CLI's confirmation-wait scenario of story 3-4 closes in one transaction; the executor runs the fresh grouping in both directions and still stops for a lost merge | `test/unit/plan/plan-hash-guard.test.ts`; `test/unit/cli/guard-regroup.test.ts`; `test/unit/execute/guard-regroup.test.ts` |
| CA-18 | The hidden prompt on fake terminal streams (no echo, Ctrl-C, Ctrl-D and the end of input, a stream that is not a terminal); through the CLI both secrets, only the missing one, a wrong account secret checked first, a value that is not a secret, Ctrl-C, a prompt that cannot be asked, never with `--json`; the help | `test/unit/cli/secret-prompt.test.ts` |

## Tasks / Subtasks

- [x] Task 1: the plan hash without the guard's regrouping (`src/plan/plan.ts`), the executor's warning, the receipt's plans (CA-11)
- [x] Task 2: the 404 path of `close --execute` (AA-13)
- [x] Task 3: `ExecuteOptions.signal` and `INTERRUPTED` in the executor (`src/execute/abort.ts`, `attempt.ts`, `submit.ts`, `preflight.ts`, `executor.ts`, `options.ts`, `report.ts`), the CLI's signal handlers (CL-1)
- [x] Task 4: the hidden prompt and the asking path of the secrets (`src/cli/prompt.ts`, `src/cli/secrets.ts`) (CA-18)
- [x] Task 5: `--verbose`, the one-line default, a `run()` that never rejects
- [x] Task 6: default remedies (`src/errors/remedies.ts`) and `docs/errors.md`
- [x] Task 7: the exit-code table test (shared with E4-S1); PRD sections 6 and 7, architecture section 4.9; the "Fixed in E4-S2" line of story 3-4

## Dev Notes

- Safe points (CL-1). Every loop that sleeps through the interruptible pause checks the signal after it, so an aborted signal never turns a wait into a tight loop against Horizon; the final check after a merge keeps the pause as given (its loop does not watch the signal, and it waits only once the run is complete). The POST of an envelope is never aborted: an envelope handed to Horizon may apply, so its answer is awaited.
- Exit code of the second signal: always 5, as the integrator's brief asks. When it comes before any envelope was recorded, nothing was submitted and 3 would also be true; the forced exit cannot settle anything, and the copy it leaves is `running`, so 5 ("stopped during execution; the report is not final") is the safer word for a script.
- Why the regrouping may leave the hash (CA-11). The approved plan and the fresh one hold the same steps with the same ids, subjects, rungs and operations; only the transaction the merge travels in differs, and that follows from the ledger number alone (stellar-core `MergeOpFrame::isSeqnumTooFar`; architecture section 8). "What is executed is what is on screen" (`docs/ux-design.md` section 2.2) is kept by what D-10 keeps as drift: gaining or losing the merge.
- The hidden prompt is asked before anything is read from the network, like the secrets from the environment. It is asked only on the `close --execute` path, never with `--json` (machine mode never asks, review AA-10).
- Out of this story's files, found while working: the planner writes the reserve of a trustline as "0.5 XLM" in its removal reasons (`src/plan/order.ts`), not with 7 decimals and not from the ledger's base reserve; `src/tx/operations.ts` throws a plain `Error` for a pool id that does not match its assets (inside `executeClose()` it becomes `EXECUTION_INTERRUPTED`); PRD FR-17 and FR-19 still call AA-13 and AA-10 deferred.

### References

- `docs/epics-and-stories.md`, Story 4.2; PRD FR-14 to FR-19, sections 6 and 7, decisions D-2, D-10, D-11; `docs/adr/ADR-0006-error-taxonomy.md`
- `docs/reviews/2026-09-27-e2-integration-review.md` (CL-1, AA-13); `docs/reviews/2026-09-28-e3-review.md` (CA-11, CA-18); `docs/stories/3-4-seqnum-too-far-guard.md` (the known limitation)
- Node: https://nodejs.org/api/process.html#signal-events, https://nodejs.org/api/process.html#event-unhandledrejection, https://nodejs.org/api/globals.html#class-abortsignal, https://nodejs.org/api/readline.html#readlinecreateinterfaceoptions, https://nodejs.org/api/readline.html#event-line, https://nodejs.org/api/readline.html#event-sigint

## Dev Agent Record

### Completion Notes List

- Offline tier on the final code of this story: 106 files, 993 tests, about 7 s; lint, format, typecheck, build and `check:package` pass.
- Nothing was run on the testnet for this story; the signal, prompt and 404 paths are offline, with injected signal sources, fake terminal streams and the fake ledger.

### File List

- `src/execute/abort.ts`, `src/errors/remedies.ts`, `docs/errors.md` (new)
- `src/plan/plan.ts`, `src/execute/executor.ts`, `src/execute/attempt.ts`, `src/execute/submit.ts`, `src/execute/preflight.ts`, `src/execute/options.ts`, `src/execute/report.ts`, `src/cli/commands/close.ts`, `src/cli/secrets.ts`, `src/cli/prompt.ts`, `src/cli/program.ts`, `src/cli/run.ts`, `src/cli/main.ts`, `src/cli/channel.ts`, `src/render/report-text.ts`, `src/index.ts` (modified)
- `test/unit/plan/plan-hash-guard.test.ts`, `test/unit/execute/guard-regroup.test.ts`, `test/unit/execute/abort-signal.test.ts`, `test/unit/cli/guard-regroup.test.ts`, `test/unit/cli/rerun-closed.test.ts`, `test/unit/cli/signals.test.ts`, `test/unit/cli/secret-prompt.test.ts`, `test/unit/cli/verbose-errors.test.ts`, `test/unit/cli/no-unhandled-rejection.test.ts`, `test/unit/errors/remedies.test.ts` (new)
- `docs/stories/3-4-seqnum-too-far-guard.md` (the "Fixed in E4-S2" line)

## Change Log

- 2026-09-29: CL-1, AA-13, CA-11 (D-10), CA-18 (D-11), `--verbose`, default remedies, `docs/errors.md`, the unhandled-rejection harness. Status: review. Deviation: `remedy` keeps its built name (PRD decision D-2).
