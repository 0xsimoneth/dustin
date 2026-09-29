# Story 4.1: CLI output polish

Status: review

## Story

As a reviewer,
I want the plan and close output to be readable at a glance and stable for machines,
so that the demo and the committed evidence are clear.

## Acceptance Criteria

As written in `docs/epics-and-stories.md` (Story 4.1), with the two review findings the E2 integration review deferred to this story (`docs/reviews/2026-09-27-e2-integration-review.md`, "Deferred"): AA-9, the persisted report's operation summary and links, and AA-10, `--json` as machine mode.

1. AC-E4-S1-1: Then tables wrap at 80 columns, colours honour `--no-color` and `NO_COLOR`, amounts print with 7 decimals and assets as `CODE:G...xxxx`.
   - **Colours: met by having none.** Status is always a word and the output is plain ASCII (`docs/ux-design.md` principle P6, "words, not colors"; section 2.11 rule 8), so `NO_COLOR` and `--no-color` have nothing to switch off. No `--no-color` flag exists (PRD decision D-13: only what is built is listed); a test proves that no ANSI escape is ever printed, on standard output, standard error or a prompt, whether `NO_COLOR`, `FORCE_COLOR` or neither is set (commander's help styles are plain unless configured, `node_modules/commander/lib/help.js`).
   - **Amounts: met.** Every XLM amount the renderers format has 7 decimals; the account's zero fees now read `0.0000000 XLM` instead of `0 XLM`. The planner's own prose is not the renderers': its trustline removal reasons say "its 0.5 XLM reserve" (`src/plan/order.ts`, outside this story's files), reported to the planner's owner.
   - **80 columns: deviation, 120 kept.** Prose wraps at 120 columns, the width of the demo terminal ("Record the terminal with a fixed 120-column width so no line wraps", `docs/ux-design.md` section 4; "Line length stays at or under 120 characters", section 2.10). 80 columns is not reachable without hurting legibility: a full hash with its label is 84 columns, a transaction's explorer URL 115 and an account's 119, and hashes and URLs are printed whole on their own line so they can be copied and clicked (sections 2.5 and 2.11 rule 6). Wrapping the prose at 80 would make the plan about half as tall again in the demo while those lines still exceed 80. What is wrapped at 120 since this story: the plan, the receipt, the progress, and now the CLI's own error and notice lines on standard error; a test checks every line of text of every kind of output. At 80 columns the terminal wraps the long lines softly and nothing is lost.
   - **Assets: deviation.** Assets are named `CODE (issuer GABC...WXYZ)` where an item is described (the first four and the last four characters of the issuer) and by code in operation lines, as the mockups of `docs/ux-design.md` sections 2.4 and 2.6 show them ("returned to issuer GBIL...7LNE"); the JSON documents carry `CODE:ISSUER` in full (`OperationSummary.asset`, `assetKey`). Changing the text form would also change the receipt wording that the live tests and the evidence checks read (`test/testnet/ladder.test.ts`, `scripts/evidence-cli.mjs`), which are outside this story.
2. AC-E4-S1-2: Then `--json` output validates against `docs/plan-schema.json` and `docs/receipt-schema.json`.
   - **Met.** Both schemas are JSON Schema draft 2020-12 (https://json-schema.org/draft/2020-12/json-schema-core). The published schemas allow unknown properties so that a later minor version may add fields; the test validates in a strict mode that refuses a property the schema does not list, so the schemas list every field the code writes. The validator is hand-written (`test/unit/cli/json-schema.ts`, about 200 lines) rather than a pinned devDependency: the part of draft 2020-12 the schemas use is small, and the validator refuses a schema that uses any keyword it does not implement, so nothing goes unchecked. `package.json` is unchanged.
3. AC-E4-S1-3: Then exit codes follow UX-DR4 and `dustin --version` prints the package version.
   - **Met, with canonical decision 5 in place of UX-DR4**, which it supersedes (`docs/README.md`: "This supersedes the PRD table and UX-DR4 in the epics"). One test walks the whole table through `run()`. `--version` prints the version of `package.json` (`src/cli/version.ts`; checked on the built binary by `npm run check:package` too).
4. AC-E4-S1-4: Then CLI output is snapshot-tested for the fixture plan and a receipt.
   - **Met.** Snapshots of the recorded messy fixture's plan (fully deterministic), of the receipt of its close on the fake ledger, and of two CLI transcripts (a close with plan, summary, progress and receipt; a refusal), with the run-specific hashes, addresses and timestamps replaced by numbered placeholders.
5. AA-9 (deferred from E2): the persisted report says what each transaction did and where to look.
   - **Met.** Per envelope `operations` (`OperationSummary`: step, kind, the Stellar operation, the subject, and the rung, amount and recipient of a disposal, plus the receipt's words) and `horizonUrl`; per report `links` (the account and the destination on the explorer and on Horizon; a muxed destination through its G account). Old fields are kept; the new ones are optional in the types, since reports written before this story lack them. The receipt's "Verify it yourself" block names the Horizon resources too.
6. AA-10 (deferred from E2): `--json` is machine mode.
   - **Met.** Standard output carries exactly one JSON document, as before; standard error carries NDJSON only (the executor's events, `plan` in a compact form, and the CLI's `notice` and `error` lines); nothing is ever asked, so `close --execute --json` without `--yes` is refused with `CONFIRMATION_REQUIRED` (exit 3) and a missing secret is not prompted for. The contract is in PRD section 6.

How each is met, and the test that proves it:

| AC | Behaviour | Tests |
|---|---|---|
| 1 | No ANSI escape in any output, with `NO_COLOR`, `FORCE_COLOR` or neither; every line of text within 120 columns; every XLM amount of the plan and the receipt with 7 decimals | `test/unit/cli/plain-output.test.ts` (all four tests) |
| 2 | Every plan of the offline fixtures (the recorded messy fixture and its variants, a missing account, every edge variant, the pool-share recording, `plan --json` and refused `close --execute --json` output) and every report (a close and each of its running copies, a failed and re-planned run, an aborted one, a missing account, an interruption, a partial close, `--json` and `--report` output) validates in strict mode | `test/unit/cli/schemas.test.ts` |
| 3 | Every exit code from 0 to 6 and every cause of 3 through `run()`; `--version` | `test/unit/cli/exit-code-table.test.ts` |
| 4 | The fixture plan, a receipt, and two transcripts | `test/unit/render/output-snapshots.test.ts`, `test/unit/render/__snapshots__/output-snapshots.test.ts.snap` |
| AA-9 | Operation summaries, Horizon links, report links, a muxed destination, a report that submitted nothing; through the CLI's `--json` and `--report`; the receipt's Horizon lines | `test/unit/execute/report-links.test.ts`, `test/unit/cli/report-links-cli.test.ts` |
| AA-10 | NDJSON only on standard error, the compact plan line, full hashes, `notice` and `error` lines, `plan --json` silent on standard error, usage errors and refusals as `error` lines, no question with `--json` | `test/unit/cli/json-mode.test.ts`; `test/unit/cli/close-execute.test.ts` "with --json never asks: ...", "prints only the final CloseReport JSON on standard output with --json" |

## Tasks / Subtasks

- [x] Task 1: the report's operation summaries and links (`src/execute/report.ts`, `src/execute/summary.ts`, `src/execute/attempt.ts`, `src/execute/executor.ts`) and the receipt's Horizon lines (`src/render/report-text.ts`)
- [x] Task 2: one writer for everything the `plan` and `close` commands print, for people or as NDJSON (`src/cli/channel.ts`), used by `run()`, the program and `close --execute`
- [x] Task 3: `docs/plan-schema.json`, `docs/receipt-schema.json` and the strict validation of every offline fixture's plan and report
- [x] Task 4: the exit-code table test and `src/cli/version.ts`
- [x] Task 5: plain output: no colour, 7 decimals, 120 columns for error and notice lines too
- [x] Task 6: snapshot tests of the plan, a receipt and two transcripts
- [x] Task 7: PRD sections 6 and 7, architecture section 4.9

## Dev Notes

- Machine mode is decided twice: from argv before parsing, for what is printed before a command runs (a secret on argv, a usage error, a refused network), and from the parsed options in commander's `preAction` hook. `--json` counts for `plan` and `close` only; the fixture commands keep their own output (they are outside this story's files).
- In machine mode commander's own text (a usage error and the help printed after it) is held back and the error becomes one `error` line with the CLI-only code `USAGE_ERROR`.
- The `plan` event line is compact (`round`, `planHash`, `status`, `counts`), as the integrator asked: the whole plan is the standard output document when a run is refused, and the report names every round's hash.
- The receipt describes each transaction with the plan of its round. The executor's fresh plan can share the hash of the plan shown and still differ from it (a better quote, the sequence guard's regrouping), so the CLI hands the executor's plans to the renderer first and the plan shown last; before, the receipt of a run whose quote rose while the confirmation waited named the old quote (`test/unit/cli/guard-regroup.test.ts` "describes the operations of the plan the executor signed, not the plan shown").
- Existing CLI tests that read human text from standard error with `--json`, or expected the typed confirmation with `--json`, were changed to the machine-mode contract (`test/unit/cli/close-execute.test.ts`, `closing-review-cli.test.ts`, `review-round3-cli.test.ts`); three stderr assertions read their phrase with the whitespace flattened, since error lines now wrap.

### References

- `docs/epics-and-stories.md`, Story 4.1; PRD FR-18, FR-19, sections 6 and 7; `docs/ux-design.md` sections 2.5, 2.6, 2.8, 2.10, 2.11 and 4
- `docs/reviews/2026-09-27-e2-integration-review.md` (AA-9, AA-10); `docs/README.md` canonical decisions 4 and 5
- JSON Schema draft 2020-12: https://json-schema.org/draft/2020-12/json-schema-core, https://json-schema.org/draft/2020-12/json-schema-validation

## Dev Agent Record

### Completion Notes List

- Offline tier on the final code of this story: 106 files, 993 tests, about 7 s; lint, format, typecheck, build and `check:package` pass.
- Nothing was run on the testnet for this story; every behaviour is offline on the fake ledger and the recorded fixtures.

### File List

- `src/cli/channel.ts`, `src/cli/version.ts`, `src/execute/summary.ts` (new)
- `src/cli/run.ts`, `src/cli/program.ts`, `src/cli/main.ts`, `src/cli/commands/close.ts`, `src/execute/report.ts`, `src/execute/attempt.ts`, `src/execute/executor.ts`, `src/render/plan-text.ts`, `src/render/report-text.ts`, `src/index.ts` (modified)
- `docs/plan-schema.json`, `docs/receipt-schema.json` (new); `docs/prd.md` sections 6 and 7, `docs/architecture.md` section 4.9 (modified)
- `test/unit/cli/json-mode.test.ts`, `test/unit/cli/json-schema.ts`, `test/unit/cli/schemas.test.ts`, `test/unit/cli/exit-code-table.test.ts`, `test/unit/cli/plain-output.test.ts`, `test/unit/cli/report-links-cli.test.ts`, `test/unit/execute/report-links.test.ts`, `test/unit/render/output-snapshots.test.ts` and its snapshot (new)
- `test/unit/cli/close-world.ts`, `test/unit/cli/close-execute.test.ts`, `test/unit/cli/closing-review-cli.test.ts`, `test/unit/cli/review-round3-cli.test.ts`, `test/unit/render/report-text.test.ts`, `test/unit/render/report-sponsors.test.ts` (modified)

## Change Log

- 2026-09-29: AA-9, AA-10, the schemas, the exit-code table, plain output and the snapshots. Status: review. Deviations: no colour at all (P6), 120 columns kept (ux-design section 4), assets in the mockups' form (ux-design sections 2.4 and 2.6).
- 2026-09-29: the findings of the Epic 4 closing review and of the pre-release review (D-n) that concern the output, below. Status: review.

## Review of 2026-09-29

The output findings of the Epic 4 closing review (EX, BH, AC) and of the independent pre-release review (D). Each fix has a test that fails on the code before it, named after the finding; the error-handling findings are in `docs/stories/4-2-error-handling-polish.md`.

| Finding | What was wrong, what changed | Fix commit | Test |
|---|---|---|---|
| EX-4 / AC-13 | With `--json` and standard output closed early (EPIPE, `\| head`), its fallback wrote a human notice and a pretty-printed JSON document to standard error. In machine mode the notice is now a `notice` line and the document one line of the new type `document`, `{"type":"document","document":{...}}` (`stdoutFallback`, `src/cli/output.ts`; `docs/errors.md`) | `4a49b31` | `test/unit/cli/epic4-review-cli.test.ts`: "EX-4: the notice is a notice line and the document one document line" |
| EX-5 | `nextStep` had no branch for a stop that carries `maxTime` (INTERRUPTED with an open envelope, OUTCOME_UNKNOWN), so the receipt's Next line and the `--json` remedy said to run again at once; they now say to wait until a ledger has closed after the time bound | `86f0389` | `test/unit/render/epic4-review-render.test.ts`: "EX-5: OUTCOME_UNKNOWN says to wait until a ledger has closed past maxTime", "EX-5: INTERRUPTED with an open envelope says the same"; `test/unit/cli/epic4-review-cli.test.ts`: "EX-5: the remedy of an INTERRUPTED stop with an open envelope waits for its time bound" |
| EX-8 / BH-21 | `wrapped()` collapsed every whitespace run and broke at any space, altering paths with spaces and flattening multi-line messages. It keeps the message's own line breaks and never breaks or collapses a kept string: the `--report` paths of the notices and the text values of a DustinError's `details` (the report file's `path`) | `4d3f530` | `test/unit/cli/epic4-review-cli.test.ts`: "EX-8: the notice that keeps an earlier report prints both paths exactly", "EX-8: an error that names a report path prints it exactly", "EX-8: a message's own line breaks are kept, the lines after the first indented", "EX-8: a kept string is never broken, even past the line width" |
| BH-6 | A BigInt, a cycle or a throwing getter in an error's details, Horizon's codes or an event made `JSON.stringify` throw inside the error path: the stopped run lost its report document and exited 1 instead of 5. NDJSON lines, the document and the `--report` copies go through `plainJson`/`jsonText` (`src/cli/channel.ts`), which never throw | `19f7767` | `test/unit/cli/epic4-review-cli.test.ts`: "BH-6: --json --verbose keeps the stopped path's report document and exits 5", "BH-6: --verbose for people prints the same stop with its detail and exits 5", "BH-6: jsonText and plainJson never throw" |
| BH-20 | `scanMode` took `--json` for the flag as the value of another option (`--memo --json`) or after `--`; it now skips option values as Commander does and stops at `--` (`VALUE_OPTIONS`, checked against the program's options) | `e3872f4` | `test/unit/cli/epic4-review-cli.test.ts`: "BH-20: --json as the value of --memo, or after --, is not machine mode", "BH-20: a usage error after --memo --json is printed for people, as Commander parsed it", "BH-20: every option that takes a value is in VALUE_OPTIONS, and nothing else" |
| AC-2 | `--no-color` was refused as an unknown option (exit 2) though AC-E4-S1-1 asks that colours honour it and `NO_COLOR`. It is a global flag that changes nothing (Dustin never prints colour, P6), documented in the help | `309d9e3` | `test/unit/cli/epic4-review-run.test.ts`: "AC-2: plan with --no-color, NO_COLOR, both or neither prints the same, without colour", "AC-2: close accepts it too, and --json stays machine mode", "AC-2: the help text documents it" |
| D-6 | Commander's usage errors printed no code for people. They now end with `dustin: USAGE_ERROR: <message>` and the remedy after Commander's help text, whose own `error:` line is left out; the `--json` message loses the `error: ` prefix | `fed57bf` | `test/unit/cli/epic4-review-run.test.ts`: "D-6: dustin: USAGE_ERROR: ..., after Commander's help text, exit 2", "D-6: a missing argument and conflicting options say so the same way", "D-6: with --json it stays one error line, the message without Commander's prefix" |
| D-8 | A missing account's plan printed a zero balance, reserve, bid and amounts, and its receipt "Sponsor ... paid every fee" and fees of 0 with no transaction. The plan says the balance is not known and there is nothing to bid or account for; a receipt with nothing submitted has no fee sentence | `c612476` | `test/unit/render/epic4-review-render.test.ts`: "D-8: the plan has no invented balance, reserve, bid or amounts", "D-8: the receipt has no fee sentence when nothing was submitted" |
