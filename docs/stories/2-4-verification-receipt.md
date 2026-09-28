# Story 2.4: Post-close verification and receipt with explorer links

Status: review

## Story

As a reviewer,
I want a receipt listing every transaction hash with an explorer link and a final proof that the account no longer exists,
so that I can verify a close without technical help.

This story also carries the CLI half of Deliverable 2, `dustin close --execute` (docs/README.md canonical decisions 4 and 5), and the review findings assigned to it by the parallel-work plan of 2026-09-26: R3, R6 (CLI part), R7, R17, and the plan-output part of R2 (docs/reviews/2026-09-26-e0-e2-review.md).

## Acceptance Criteria

1. AC-E2-S4-1: Given a completed close, then `verifyClosed(accountId)` polls Horizon until `GET /accounts/{id}` returns 404 (30 s maximum), and the receipt gets `closed: true` and `verifiedAtLedger`.
2. AC-E2-S4-2: Then the receipt contains, per transaction: outer hash, inner hash, explorer URL, ledger, fee charged to the sponsor and an operations summary, plus explorer URLs for the account and the destination.
3. AC-E2-S4-3: Then `dustin close` prints the summary per UX-DR3 and writes `receipt-<account>-<date>.json` to `--out` (default `./evidence/receipts/`).
4. AC-E2-S4-4: Given a partial close, then `closed` is false and the blockers section lists reasons and remediations.

How each is met:

- AC-E2-S4-1: met after the merge with the executor work (E2-S3): `verifyClosed()` (`src/execute/verify.ts`) polls `GET /accounts/{id}` until 404 for at most 30 s by default, is exported from the package (`src/index.ts`), and the executor uses it for its final check, recording `verification.ledger`, which the receipt prints ("checked ... at ledger N"). Deviation in naming: "closed: true" is `status === "closed"` with `verification.accountExists === false` (the only case that exits 0), and `verifiedAtLedger` is `verification.ledger`. Tests: `test/unit/execute/verify.test.ts`, `test/unit/smoke.test.ts` ("verifyClosed is exported").
- AC-E2-S4-2: met by the receipt renderer `renderReport()` (`src/render/report-text.ts`), printed at the end of every `close --execute`: per submitted transaction the phase, the attempt when the executor records one, the outcome, the ledger, the fee charged to the sponsor, the outer and inner hash, the explorer link and the operations it carried (from the plan's steps); then the XLM merged into the destination, reserves returned to reserve sponsors, fees paid by the account (0) and by the sponsor, explorer links for the account and the destination, and the Horizon 404 line. The JSON report (`--json`, `--report`) carries the same hashes, ledgers, fees and transaction URLs; the operations are referenced there by step id and the account and destination URLs are not in it (known gap, recorded in `docs/reviews/2026-09-27-e2-integration-review.md` for E4-S1). Tests: `test/unit/render/report-text.test.ts` (closed, failed, partial and aborted runs of the real executor on the fake ledger, extra fields, no plan); the per-transaction ledger and fee: `test/unit/render/review-round3-render.test.ts` (review round 3, R3-24).
- AC-E2-S4-3: the UX-DR3 progress is met: one block per transaction, "submitted" with the hash and the explorer link, "confirmed" with the ledger and the sponsor fee, "failed" with the result codes, then the verification line and the receipt (`test/unit/cli/close-execute.test.ts`). **Deviation:** the receipt file is opt-in, `--report <file>`, instead of a default `./evidence/receipts/receipt-<account>-<date>.json`. Reasons: PRD FR-17 and FR-19 specify `--report <path>`; an installed CLI does not know where a project's evidence folder is, and writing into `./evidence/receipts/` of whatever directory it runs in would drop files into a user's repository or fail in a read-only directory; the full receipt is printed on every run and `--json` puts the same report on standard output, so nothing is lost without the file; the evidence runs (E2-S6) pass `--report evidence/...` explicitly. The file is written after every change of the report (temporary file and rename) and at the end, so a stopped run keeps every hash (AC-E2-S3-6, PRD NFR-03); the writes during the run are tested by reading the file while each POST is in flight (`test/unit/cli/review-round3-cli.test.ts`, review round 3).
- AC-E2-S4-4: met: a partial close ends with status `partial` (exit 4); the report has no `closed` field, `status !== "closed"` plays that role, and the receipt's "Not closed" section lists every unclosable item and blocker with its reason and remedy, followed by the next step. Tests: `report-text.test.ts` (partial run) and `close-execute.test.ts` ("runs everything else with --partial and exits 4").

Findings closed here:

- R3 (Major): `src/index.ts` exports `executeClose`, `keypairSigner` and the types `Signers`, `ExecuteOptions`, `CloseEvent`, `CloseReport`, `CloseStatus`, `SubmittedTransaction`, `StepOutcome`, `Signer`; also `renderReport`. The `NOT_IMPLEMENTED` stub is gone. `test/unit/smoke.test.ts` checks that `executeClose` refuses without `confirm: true` before any read, signature or submission, and that the types compile. `npm run build` and `npm run check:package` pass; the dry-run tests stay green.
- R6 (Low, CLI part): `plan`, the dry-run `close` and `close --execute` call `verifyHorizonIsTestnet()` before their first read; addresses are checked before any request. The `resolveConfig()` comment now lists the real guard layers. Tests: `test/unit/cli/network-guard.test.ts` (exit 2 for another network's Horizon and for a URL that is not a Horizon server, exit 6 when unreachable, one request only; address typos exit 2 offline) and `close-execute.test.ts`.
- R7 (Low): `main.ts` no longer loads `.env`. Only `close --execute` reads `.env` in the working directory, with `util.parseEnv`, and takes only `DUSTIN_ACCOUNT_SECRET` and `DUSTIN_SPONSOR_SECRET`; a non-empty environment value takes precedence; `process.env` never changes. The working directory reaches the CLI through `CliDeps.cwd`. Tests: `test/unit/cli/dotenv-secrets.test.ts` and `close-execute.test.ts` (a `.env` with secrets and a bogus Horizon URL has no effect on `plan`; `close --execute` takes the two secrets from it; `process.env` unchanged; no output contains a secret).
- R17 (Low): `.github/workflows/ci.yml` fails the job when `git grep -l -E 'S[A-Z2-7]{55}'` matches, printing file names only; a `git grep` error also fails it. The tree has no match today.
- R2 (plan output part): `renderPlan()` prints the sponsor's per-close budget and whether the plan's bid is within it; `close --execute` refuses an over-budget plan before asking (exit 2 at the time; exit 3 since builder decision D-6 of 2026-09-28). The executor-side refusal of R2 belongs to the executor work.

## Tasks / Subtasks

- [x] Task 1: R6, the network check before the first read in `plan` and `close`, addresses first, the `resolveConfig()` comment
- [x] Task 2: R17, the CI seed scan
- [x] Task 3: R3, the public API and the smoke test
- [x] Task 4: R7, `.env` for `close --execute` only (`src/cli/env.ts`, `src/cli/secrets.ts`), exit codes for the new error codes
- [x] Task 5: R2 plan output, the budget line and an execution heading in `renderPlan()`
- [x] Task 6: the receipt renderer `renderReport()` (AC-E2-S4-2, AC-E2-S4-4)
- [x] Task 7: `dustin close --execute` (`src/cli/commands/close.ts`): secrets, network, fresh plan, refusals, typed confirmation, executor, progress, receipt, `--json`, `--report`, exit codes (AC-E2-S4-3)
- [x] Task 8: the terminal prompt (`src/cli/prompt.ts`)
- [x] Task 9: README and `.env.example`
- [x] Task 10: `verifyClosed()` (AC-E2-S4-1), done in the executor work and exported by the integrator

### Review Findings (round 3, 2026-09-28)

The third review round (acceptance audit, edge-case review of the CLI, blind review), triaged by the integrator into patches. Every code fix has a test that failed on the code before it, in `test/unit/cli/review-round3-cli.test.ts` or `test/unit/render/review-round3-render.test.ts` unless the line names another file. The executor findings of the same round are in story 2-3.

- [x] [Review][Patch] R3-1 (the executor fix, seen from the CLI) A merge of this run refused or failed on the ledger no longer gives a CLOSED receipt and exit 0 when someone else removed the account [src/execute/executor.ts]
- [x] [Review][Patch] R3-22 An unknown envelope is labelled from what is known: failed lookups, a used sequence number, may still apply (blind review BH-13 included) [src/render/report-text.ts]
- [x] [Review][Patch] R3-23 A copy saved while the run was going reads as a run in progress that must not be started twice [src/render/report-text.ts]
- [x] [Review][Patch] R3-24 The receipt's per-transaction ledger and fee charged to the sponsor are tested [test/unit/render/review-round3-render.test.ts]
- [x] [Review][Patch] R3-25 The confirmation shows the plan's bid and the close budget as the most the sponsor can pay [src/cli/commands/close.ts]
- [x] [Review][Patch] R3-26 --report refuses a .env name in any case and any link to the working directory's .env [src/cli/commands/close.ts]
- [x] [Review][Patch] R3-27 With --json, the budget and sponsor refusals print the refused plan [src/cli/commands/close.ts]
- [x] [Review][Patch] R3-28 The typed confirmation is asked only when the stream that carried the plan and the summary is a terminal [src/cli/prompt.ts]
- [x] [Review][Patch] R3-29 The comments on standard output after EPIPE and on the --report file say what holds [src/cli/output.ts]
- [x] [Review][Patch] R3-30 A report file that holds an earlier copy is not called missing [src/cli/commands/close.ts]
- [x] [Review][Patch] R3-31 A confirmation that could not be asked names the stream that is not a terminal [src/cli/prompt.ts]
- [x] [Review][Patch] R3-32 The memo line of a partial close does not name a merge [src/cli/commands/close.ts]
- [x] [Review][Patch] R3-34 The exit-code note maps an interruption before any submission to 1 and the sponsor refusals to 3 [docs/stories/2-4-verification-receipt.md]
- [x] [Review][Patch] R3-36 The failed headline knows an applied merge by its step or envelope, not only by its merged amount (blind review BH-12) [src/render/report-text.ts]

### Closing review (2026-09-28)

The closing review of Epic 3 (edge-case review of the CLI CC, blind review CB, edge-case review of the executor CX), fixed by agent F1 and merged in `d0d711c`. Each fix has a test that failed before it, in `test/unit/cli/closing-review-cli.test.ts` or `test/unit/render/closing-review-render.test.ts` under the finding's id. The findings that concern this story:

- [x] [Review][Patch] CC-1 = CB-1 Standard output's EPIPE fallback keeps the chunk that hit the broken pipe and those written in the same tick: each goes to standard error, in order, after the one-time notice [src/cli/output.ts] (`ca42b62`)
- [x] [Review][Patch] CC-2 With `--json`, standard output carries exactly one JSON document once the plan was shown: the report once the executor has one, otherwise the plan, also after a refused confirmation [src/cli/commands/close.ts] (`85ff90b`)
- [x] [Review][Patch] CC-9 A copy saved while the run is going reads as a run in progress in the Disposals and sponsor sections too [src/render/report-text.ts] (`052aea9`)
- [x] [Review][Patch] CC-10 While a merge envelope may still apply or may have applied, a sale's XLM leaves with that merge if it applies, and the result says the merge has no known outcome; `mayHaveApplied()` is the same rule the executor uses (CX-1) [src/render/report-text.ts, src/execute/report.ts] (`15250ab`, `77742bf`)
- [x] [Review][Patch] CX-1 (the executor fix, seen from the CLI) A merge envelope the run found unable to apply no longer gives a CLOSED receipt and exit 0 when someone else removed the account; the run keeps its stop and exits 5 [src/execute/executor.ts] (`466d2e3`)

## Dev Notes

- Specification: docs/README.md canonical decisions 4 (CLI contract), 5 (exit codes) and 7 (budget); docs/ux-design.md sections 2.2 (confirmation gates), 2.3 (secrets), 2.5 (progress), 2.6 (report), 2.8 (JSON), 2.10 (layout); docs/epics-and-stories.md E2-S4 and UX-DR1 to UX-DR5; docs/prd.md FR-18, FR-19, NFR-04 (test T-20).
- Order in `close --execute`: local checks (addresses, `--base-fee`), the two secrets, the network check, a fresh plan with the sponsor as fee payer, refusals (nothing to execute, not closable without `--partial`, bid over budget, sponsor below the budget), the confirmation summary, the typed confirmation or `--yes`, the executor.
- Exit codes: `closed` and verified gone 0; `aborted` with nothing submitted 3; `partial` 4; `failed`, `closed` without the 404, or `aborted` after a submission 5. An error after the first submission prints the report the error carries, or the last copy published through `onReport` (marked `failed` with the error's message when it was taken mid-run), and exits 5, whatever the error code. An error before any submission maps by code: `HORIZON_UNAVAILABLE` 6; `MISSING_*_SECRET` and `WRONG_SIGNER` 2; `SPONSOR_UNDERFUNDED`, `SPONSOR_BUDGET_EXCEEDED` and `CONFIRMATION_DECLINED` 3, nothing executed (builder decision D-6 for the two sponsor refusals); `EXECUTION_INTERRUPTED` 1, since nothing reached the network (CL-3); unknown codes 1 (corrected in review round 3, R3-34).
- `--base-fee` with `--execute`: the plan records the value as an override, which every re-plan keeps (review R12), and the CLI also passes it as `maxBaseFeeStroops`, so it is both the bid and the ceiling per operation: a retry after `tx_insufficient_fee` cannot raise it and the run stops with `FEE_LIMIT` instead. The confirmation summary shows the plan's bid (with `--base-fee`, per operation and never raised) and, on its own line, the close budget as the most the sponsor can pay: a retry after a fee surge and a re-plan after a failure on the ledger (charged, and adding transactions the plan did not have) can bid more than the plan, and only the budget, which `FeeSponsor` enforces, bounds them. Before review round 3 (R3-25) the summary named min(budget, cap x (operations + fee bumps)), or with `--base-fee` the plan's bid, which a re-plan could exceed.
- `--json` does not make the command non-interactive (docs/ux-design.md 2.8 said it would): the parallel-work contract puts the question on standard error, so `--json` with a terminal can still confirm; without a terminal the run is declined unless `--yes` is given.
- `--json` prints exactly one JSON document on standard output once the plan was shown (closing review CC-2): the close report once the executor has one, and otherwise the plan (`kind: "dustin-close-plan"`) that was refused or could not run. That covers a refused or unaskable confirmation (wrong answer, end of input, no prompt, a stream that is not a terminal), a `--report` refusal, a failed sponsor read, Horizon failing before the executor's first copy, and the budget and sponsor refusals of R3-27, which now take the same path (`executeShownPlan`). Exit codes are unchanged. The test that pinned an empty standard output after a declined confirmation now expects the refused plan there.
- Standard output closed early (`dustin close ... | head`). On a pipe `write()` does not throw on EPIPE: the chunk is discarded and the failure arrives later, through the write's callback and then the error event. `guardedWriter` (`src/cli/output.ts`) passes a callback to every write and sends each chunk whose write failed to standard error, in order, after the one-time notice "dustin: standard output was closed; the rest of the output goes to standard error.", so the chunk that hit the broken pipe and those written in the same tick (the receipt and the report line, or the whole `--json` report) reach standard error even when no later write comes (closing review CC-1 = CB-1). Proved with a stream whose write callback errors and with a real child process wired like `main.ts` whose standard output reader went away.
- The receipt of a run in progress and of an open merge. `renderReport` on a copy saved while the run is going (status `running`) says "not run yet" for a step that has not run, "attributed when the run ends" in the sponsor section (the executor attributes the reserves at the end, so the list is empty in every running copy) and "not read yet" for the sponsor reading after the run; a sale that applied says its XLM is on the account while the run goes on (closing review CC-9, after R3-23). When no merge applied but a merge envelope may still apply or may have applied (`mayHaveApplied()`, the rule of CX-1), a sale's Disposals line says the XLM leaves with the merge if that envelope applies, naming it, and the result says the merge has no known outcome instead of "No merge: the account was not merged" (CC-10); a merge envelope the run found unable to apply keeps the old words.
- The typed confirmation is asked only where the user saw what it confirms (review round 3, R3-28): standard input, standard error (the question) and the stream that carried the plan and the summary must be terminals, that is standard output without `--json` and standard error with it. With `> run.txt` or `| head` (standard output redirected or piped, no `--json`) the question is not asked and the run ends unconfirmed (exit 3); with `--json`, standard output may be piped. The message names the stream that is not a terminal, where it said "the input is not interactive" also for a redirected standard error (R3-31).
- The executor is injectable through `CliDeps.execute.executeClose`, so the exit-code contract is tested with a stub whatever the executor does inside (`test/unit/cli/close-execute-stub.test.ts`).
- Not in this story: a hidden prompt and `--*-secret-file` for the secrets (canonical decision 4 lists them as options; `.env` is the file), a graceful stop on Ctrl-C between transactions (it needs an abort signal in the executor), and `dustin report --from`.
- Sources:
  - Node.js `util.parseEnv`: https://nodejs.org/api/util.html#utilparseenvcontent (added in v20.12.0 and v21.7.0; checked in the v22.12.0 docs and with Node 24.15.0).
  - Node.js readline "close" (end of input, Ctrl-D) and "SIGINT" (without a listener Ctrl-C only pauses the input): https://nodejs.org/api/readline.html#event-close, https://nodejs.org/api/readline.html#event-sigint (v22.12.0 docs, and an experiment with the local Node).
  - Fee account of a fee bump pays instead of the inner source: https://developers.stellar.org/docs/build/guides/transactions/fee-bump-transactions#fee-account (Raven MCP, 2026-09-26).
  - An account merge removes the source account from the ledger: https://developers.stellar.org/docs/learn/fundamentals/transactions/list-of-operations#account-merge (Raven MCP, 2026-09-26).
  - Horizon answers 404 Not Found for a missing resource: https://developers.stellar.org/docs/data/apis/horizon/api-reference/errors/error-handling#error-handling-for-queries (Raven MCP, 2026-09-26).
  - Testnet explorer transaction links (`stellar.expert/explorer/testnet/tx/<hash>`): https://developers.stellar.org/docs/build/guides/transactions/upload-wasm-bytecode#running-the-install-script (Raven MCP, 2026-09-26).
  - `StrKey.isValidEd25519SecretSeed` and `Keypair.fromSecret`: `node_modules/@stellar/stellar-sdk/lib/esm/base/strkey.js` and `keypair.js` (SDK 17.1.0); the decoder's errors report the length, never the value, and secrets are validated before `fromSecret` anyway.
  - `git grep` exits 0 on a match and 1 on none: verified locally (git 2.55.0) on the clean tree and on a throwaway repository with a generated seed.

### References

- docs/epics-and-stories.md, Story 2.4
- docs/prd.md FR-18, FR-19, NFR-04
- docs/reviews/2026-09-26-e0-e2-review.md, findings R2, R3, R6, R7, R17

## Dev Agent Record

### Agent Model Used

dev-story workflow (AI developer agent)

### Implementation Plan

- `plan.ts`: `checkAddresses()` before any request, then `verifyHorizonIsTestnet()` before the first read; shared by `plan`, the dry-run `close` and `close --execute`.
- `env.ts` and `secrets.ts`: `readDotEnvSecrets()` (two keys, `util.parseEnv`, no `process.env` change) and `loadCloseSigners()` (environment first, then `.env`; validation without echo; keypairs only inside `keypairSigner` closures).
- `report-text.ts`: the receipt; `plan-text.ts`: the budget line and a heading option.
- `close.ts`: the execution flow; progress printer for the executor's events (unknown event types print their text fields); the report file writer; exit codes through `exitCodeForReport()`.
- `prompt.ts` and `main.ts`: the typed confirmation on a terminal, written to standard error; the end of input, Ctrl-D and Ctrl-C answer "no".

### Debug Log References

- Red first: the network-guard tests passed before the change for another network's passphrase (the inspector already checks it), so the red case became a URL that is not a Horizon server (exit 6 instead of 2); the smoke test failed on the stub; the renderer and `close --execute` tests failed on the missing modules and the old `NOT_IMPLEMENTED` path.
- The receipt's explorer lines exceeded 120 columns with a label; the URL now has its own line (ux-design 2.5). The per-transaction progress header and the confirmation question were also shortened to 120 columns.
- A malformed-secret test changed the last character of a random secret to "A", which left it valid one run in 32; fixed in 3d43b02. A wrong-answer test had a one-in-a-million equivalent; fixed in the same commit.
- A fake-ledger test of "merge applied but the account still exists" was replaced by a stub-executor test: a verification that polls for up to 30 s (AC-E2-S4-1) would make it slow.

### Completion Notes List

- `dustin close --execute` closes a zero-spendable account on the fake ledger with `--yes` or with the typed confirmation (exit 0, the hash lines and the 404 line printed), refuses a wrong, empty or missing answer (exit 3, nothing submitted), refuses an unclosable plan without `--partial` (exit 3) and runs it with `--partial` (exit 4), refuses missing, malformed and wrong secrets and a secret on argv (exit 2), refuses a non-testnet Horizon (exit 2) and reports an unreachable one (exit 6), exits 5 with every submitted hash when a later transaction fails or Horizon disappears after the first submission, prints only the report on standard output with `--json`, and writes the report file. No secret, in StrKey, hex or base64 form, appears in standard output, standard error, the prompts, the report file or any error (T-20).
- Offline only: no testnet tier and no live close were run for this story.
- 42 test files, 273 tests pass; lint, format check, typecheck, build and the package check pass.

### File List

- `src/cli/commands/close.ts`, `src/cli/secrets.ts`, `src/cli/prompt.ts`, `src/render/report-text.ts` (new)
- `src/cli/env.ts`, `src/cli/main.ts`, `src/cli/program.ts`, `src/cli/exit-codes.ts`, `src/cli/commands/plan.ts`, `src/config/network.ts` (comment only), `src/render/plan-text.ts`, `src/index.ts` (modified)
- `test/unit/cli/close-world.ts`, `test/unit/cli/close-execute.test.ts`, `test/unit/cli/close-execute-stub.test.ts`, `test/unit/cli/dotenv-secrets.test.ts`, `test/unit/cli/exit-codes-report.test.ts`, `test/unit/cli/network-guard.test.ts`, `test/unit/cli/prompt.test.ts`, `test/unit/render/plan-text.test.ts`, `test/unit/render/report-text.test.ts` (new)
- `test/unit/cli/run.test.ts`, `test/unit/smoke.test.ts` (modified)
- `.github/workflows/ci.yml`, `README.md`, `.env.example` (modified)
- `docs/stories/2-4-verification-receipt.md` (new)
- Review round 3: `test/unit/cli/review-round3-cli.test.ts`, `test/unit/render/review-round3-render.test.ts` (new); `src/cli/commands/close.ts`, `src/cli/prompt.ts`, `src/cli/main.ts`, `src/cli/output.ts` (comment), `src/cli/program.ts` (the `prompt` comment), `src/render/report-text.ts`, `test/unit/cli/prompt.test.ts` (a prompt that cannot ask names the cause), `test/unit/cli/close-execute.test.ts` (the two summary tests follow R3-25) (modified)

## Change Log

- 2026-09-26: R6, R17, R3, R7 and the plan-output part of R2; the receipt renderer; `dustin close --execute` with the typed confirmation, progress, receipt, `--json` and `--report`; README and `.env.example`. AC-E2-S4-1 (`verifyClosed`) left to the executor work. Status: review.
- 2026-09-27 (integration): the receipt renders the executor's stop reason, plan rounds, attempts, rebuild reasons and re-plans, and describes each transaction with the plan of its own round; `verifyClosed` is exported; a re-run with the same `--report` path keeps the earlier file under a new name instead of overwriting it (PRD NFR-03); the confirmation summary names the most the sponsor may pay. Documented deviations: `--json` prints human-readable progress on stderr, not NDJSON events (PRD FR-19, ux-design 2.8), and `--json` does not make the run non-interactive; both are left to E4-S1.
- 2026-09-28: builder decision D-6 (PRD): an over-budget refusal and `SPONSOR_UNDERFUNDED` exit 3, "nothing executed" (canonical decision 5 widened); this replaces the exit code 2 chosen for CL-4.
- 2026-09-28: review round 3 (acceptance audit, edge-case review of the CLI, blind review): R3-22 to R3-32, R3-34 and R3-36, and the CLI side of the executor's R3-1, each code fix with a test that failed first. Behaviour changes: the confirmation names the close budget as the ceiling; it is asked only when the stream that carried the plan is a terminal, otherwise the run is unconfirmed (exit 3) with the cause named; `--report` refuses any case of `.env` and links to the working directory's `.env`; with `--json` the budget and sponsor refusals print the refused plan; the receipt labels unknown envelopes from what is known and renders a running copy as a run in progress.
- 2026-09-28: closing review of Epic 3, merged in `d0d711c` (record updated by the documentation pass): CC-1 (the stdout fallback keeps the chunk that hit the broken pipe), CC-2 (`--json` prints exactly one document in every case once the plan was shown), CC-9 (running copies in Disposals and sponsors), CC-10 (an open merge in Disposals and the result) and the CLI side of CX-1 (exit 5, not a CLOSED receipt, when only a merge that can never apply was posted), with their commits in the section "Closing review (2026-09-28)".
