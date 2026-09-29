# Dustin errors and stop codes

What can go wrong, how Dustin says so, and what to do about it (story E4-S2, AC-E4-S2-3). Two kinds of codes exist, following ADR-0006 (`docs/adr/ADR-0006-error-taxonomy.md`):

- **Errors** (`DustinError.code`) are thrown: by the SDK for configuration errors before anything is read or signed and for the unexpected, and by the CLI for usage errors and refusals. Every error has a `code`, a `message`, a `stage`, a `verdict` (what may be done next), a `remedy` where the raising code knows a specific one, and the underlying error as `cause`. `remedyOf(error)` (exported) gives the error's own remedy or, when it has none, the remedy of its code in the table below; the CLI prints it under every error. An error thrown by `executeClose()` after its report exists carries the report in `error.report`, so no submitted hash is lost.
- **Stop codes** (`CloseReport.stop.code`) are returned: `executeClose()` reports an expected outcome (a drift, a failed operation, a wait that ran out, an interruption) as a report whose `status` and `stop` say what happened, and does not throw.

Horizon's result codes travel with both: on each envelope (`transactions[].resultCodes`), on the step that failed (`steps[].resultCodes`), on the stop (`stop.resultCodes`), on a re-plan's trigger (`replans[].trigger.resultCodes`), and on a thrown error as `DustinError.horizon` (`status`, `transaction`, `innerTransaction`, `operations`, `hash`). How each operation code is read (re-plan, fall down the ladder, or stop) is the mapping of ADR-0006, implemented in `src/execute/classify.ts`.

## How the CLI shows them

| Mode | Standard error |
|---|---|
| default | one line, `dustin: CODE: message`, then the remedy indented; lines wrap at 120 columns |
| `--verbose` | the same, then the stage, the verdict and whether it may be retried, Horizon's result codes, the details and the cause chain, each cause with its code when it has one; for an unexpected error, its stack. Secrets are redacted |
| `--json` | one NDJSON line `{"type":"error","code":...,"message":...,"remedy":...,"exitCode":...}`; with `--verbose` it also carries `stage`, `verdict`, `retryable`, `details`, `horizon` and `causes` |

With `--json`, a run that ends with a stop also ends with an `error` line whose `code` is the stop code, `message` the stop's detail and `remedy` the receipt's "Next" line; a refusal before anything is signed (`PLAN_NOT_CLOSABLE`, `NOTHING_TO_EXECUTE`) is one `error` line too. Standard output then carries the refused plan or the report.

With `--json`, standard error carries NDJSON only, whatever happens to standard output. If standard output is closed early (`| head`, EPIPE), a `notice` line says so, `{"type":"notice","message":"standard output was closed; the rest of the output goes to standard error."}`, and the one JSON document follows on standard error as a `document` line, the document on one line: `{"type":"document","document":{"kind":"dustin-close-report",...}}`. Without `--json` the notice is `dustin: standard output was closed; ...` and the rest of the output follows as it would have been printed.

Exit codes (`docs/README.md` canonical decision 5):

| Exit | Meaning |
|---|---|
| 0 | plan printed, or account closed and verified gone |
| 1 | unexpected error |
| 2 | usage or validation error: bad address, secret on argv, wrong key, mainnet requested, missing secrets |
| 3 | nothing executed: no confirmation (missing or declined), blockers without `--partial`, a sponsor or budget precondition failed, or any other refusal before anything is signed (nothing to execute, a changed plan, less XLM for the destination, an interruption before the first submission) |
| 4 | partial: everything else ran, the account still exists |
| 5 | stopped or failed during execution; run the same command again to continue |
| 6 | Horizon unreachable before any submission |

An error or a stop after something was submitted is always 5, whatever its code.

## Error codes (`DustinErrorCode`)

| Code | Meaning | Stage | Exit | Remedy |
|---|---|---|---|---|
| `MISSING_ACCOUNT_SECRET` | `close --execute` found no secret for the account to close: not in the environment, not in `.env`, and not typed at the hidden prompt (no terminal, `--json`, Ctrl-C or the end of input) | config | 2 | Set `DUSTIN_ACCOUNT_SECRET` in the environment or in `.env`, or run `close --execute` in a terminal without `--json` to type it at a hidden prompt; never pass a secret on the command line. |
| `MISSING_SPONSOR_SECRET` | The same for the fee sponsor's secret | config | 2 | Set `DUSTIN_SPONSOR_SECRET` in the environment or in `.env`, or type it at the hidden prompt in a terminal. |
| `CONFIRMATION_DECLINED` | The typed confirmation was not given: a wrong answer, the end of input, Ctrl-C at the question, or no terminal to ask on | config | 3 | Run the command in a terminal and type the last 4 characters of the destination, or add `--yes` (it works only with `--execute`). |
| `CONFIRMATION_REQUIRED` | SDK: `executeClose()` without `confirm: true`. CLI: `close --execute --json` without `--yes`, since machine mode never asks | config | 3 | Show the plan to the account holder first; then add `--yes` (CLI) or pass `confirm: true` (SDK). |
| `EXECUTION_INTERRUPTED` | The executor stopped on something unexpected (a signer or observer that threw, a bug); the report is attached | where the run was | 1 when nothing was submitted, 5 otherwise | Look up the hashes in the report, then run the close again: it reads the account again and plans only what is left. |
| `NOT_IMPLEMENTED` | A feature that is not built; not raised in this release | any | 1 | `docs/prd.md` section 6 lists what is built. |
| `CONFIG_INVALID` | An option, setting or file is invalid: a numeric execute option out of range, a signal that is not an AbortSignal, `--base-fee`, `--report`, `.env`, a secret that is not a secret key, a Horizon URL that is not a Horizon server | config (plan options: plan) | 2 | Fix the option, setting or file the message names, then run again. |
| `MAINNET_REFUSED` | A network other than the testnet was asked for, or the Horizon does not serve the testnet | config | 2 | Use the Stellar testnet: leave `--network` out (or pass `--network testnet`) and point `DUSTIN_HORIZON_URL` at a testnet Horizon. |
| `SECRET_IN_ARGV` | An argument looks like a secret key (CLI only); it was not used and is not shown | config | 2 | Put secrets in `DUSTIN_ACCOUNT_SECRET` and `DUSTIN_SPONSOR_SECRET` instead, never on the command line. |
| `HORIZON_UNAVAILABLE` | Horizon could not be reached or answered 5xx or 429 after the read client's retries | inspect, config | 6 before any submission, 5 after | Check the network connection or the Horizon URL, then try again. |
| `FRIENDBOT_FAILED` | Friendbot could not fund a fixture account, or Horizon did not show it funded (fixture commands) | build | 1, or 5 after a build submission | Friendbot may be rate-limited or down: wait a minute, then run the fixture command again. |
| `FIXTURE_STEP_FAILED` | A fixture build transaction failed on the ledger | submit | 1, or 5 after a build submission | Look the step's transaction up on the explorer, then build a fresh fixture with `dustin fixture create`. |
| `FIXTURE_INVALID` | A built fixture does not pass its own verification | build | 1, or 5 after a build submission | Build a fresh fixture with `dustin fixture create`. |
| `MANIFEST_INVALID` | `fixture verify` got a file that is not a Dustin fixture manifest | config | 1 | Pass the `manifest.json` that `dustin fixture create` wrote, unchanged. |
| `INVALID_ADDRESS` | An address is not a valid G (or, for the destination, M) address, a destination is missing, or the account, destination and fee sponsor are not distinct where they must be | inspect, plan, config | 2 | Check the address: a classic account is 56 characters starting with G; a destination may also be a muxed M... address. |
| `CONTRACT_ACCOUNT` | A contract (C...) address was given; out of scope | inspect | 2 | Pass a classic G... account. |
| `TOO_MANY_OPERATIONS` | A transaction would hold more than 100 operations (defence in depth; the planner never does it) | build | 1 | This is a bug; report it with the plan. |
| `SPONSOR_REFUSED` | The fee sponsor refused to sign a fee bump it did not build for the closing account's own transaction | sponsor | 1 | Through `executeClose()` this is a bug; report it with the report. |
| `SPONSOR_BUDGET_EXCEEDED` | The fee bids exceed the close budget (CLI check before the confirmation, or the sponsor's own check before it signs) | sponsor | 3 | Raise the close budget or wait for network fees to fall (with the CLI, lower the bid with `--base-fee`), then run the close again. |
| `SPONSOR_UNDERFUNDED` | The fee sponsor does not exist, or cannot spend the close budget | sponsor | 3 | Fund the fee sponsor (on testnet, from Friendbot) and run the close again. |
| `WRONG_SIGNER` | A secret or a signer belongs to another account than the one it signs for, or `--sponsor` names another account. The CLI names where the secret came from (the environment, `.env` or the hidden prompt); the SDK names the signer argument | config | 2 | SDK: pass a signer of the account being closed as `signers.account` and one of the plan's fee sponsor as `signers.feeSponsor`. CLI: set `DUSTIN_ACCOUNT_SECRET` and `DUSTIN_SPONSOR_SECRET` where the message says the wrong one came from, or type the right one at the hidden prompt. |
| `ACCOUNT_NOT_FOUND` | Declared for an account Horizon does not have; not raised in this release, where a missing account is the plan's `ACCOUNT_MISSING` blocker and the stop of the same name | inspect | 1 | Check the address; if an earlier close merged the account, there is nothing left to close. |
| `RESET_SUSPECTED` | `dustin fixture verify` finds that the testnet was reset since the fixture was built: the manifest records a ledger beyond Horizon's latest ledger, or an account of the fixture answers 404 with no history on Horizon (a fixture account that was merged keeps its history and is reported as closed instead; matrix row X-15) | inspect | 3 | A testnet reset deletes every account a fixture had: build a new fixture with `dustin fixture create` (new keys, new manifest). |

## Stop codes (`StopCode`)

A stop's exit code follows the report's status (`exitCodeForReport`): 3 when nothing was submitted (`aborted`), 5 otherwise (`failed`, or `closed` without a verified 404). `verdict: "replan"` means running the close again is the remedy; `"stop"` means something must change first. `detail` says what happened in one or two sentences, and `hash`, `txIndex`, `round`, `stepId`, `resultCodes`, `unblocksAtLedger`, `xlmToDestination` and `maxTime` name what it concerns.

| Code | Meaning | Stage | Verdict | Exit | Remedy |
|---|---|---|---|---|---|
| `PLAN_CHANGED` | The account's ledger state changed since the plan was approved (the plan hash differs), or a mid-run re-plan found what the approved plan did not have. The sequence guard's timing and its regrouping of the merge are not a change (PRD decision D-10), a plan that gains or loses its merge is | plan, submit | replan | 3 before a submission, 5 after | Review the new plan and run the command again. |
| `XLM_TO_DESTINATION_FELL` | The fresh plan made before signing recovers less XLM than the approved plan (a worse quote, a lower balance); `xlmToDestination` has both amounts | plan | replan | 3 | Review the new plan and run the command again. |
| `PLAN_NOT_CLOSABLE` | The plan cannot end in a merge and `allowPartial` (`--partial`) was not given | plan, submit | stop | 3 before a submission, 5 after | Resolve the unclosable items and blockers, or allow a partial close to run everything else. |
| `NOTHING_TO_EXECUTE` | The plan has no transaction | plan | stop | 3 | Resolve the plan's blockers. |
| `ACCOUNT_MISSING` | Horizon answers 404 for the account: before anything was signed (a run after a completed close; `verification` records the 404, review AA-13), or when a transaction was about to be built | inspect, submit | stop | 3 before a submission, 5 after | If an earlier run merged the account, the close is complete; otherwise check the address. |
| `OVER_BUDGET` | The fee bids of the plan, or of a re-plan, exceed what is left of the close budget | sponsor | stop | 3 before a submission, 5 after | Raise the close budget or wait for network fees to fall, then run the close again. |
| `OPERATION_FAILED` | An operation failed on the ledger with a code that no re-plan can fix, or without an operation result | submit | stop or replan | 5 | Read the result codes in the report; resolve what they name, then run the close again. |
| `STEP_FAILED_TWICE` | The same step failed on the ledger twice; also a `RunBlocker` in `blockers` | submit | stop | 5 | Find out on the explorer why the step keeps failing, resolve it, then run the close again. |
| `REPLAN_LIMIT` | The run re-planned `maxReplans` times already | submit | stop | 5 | Run the close again; it plans from the ledger. |
| `TRANSACTION_REJECTED` | Horizon refused an envelope with a code that needs a change first (for example `tx_bad_auth`); the envelope was posted, so the run counts as stopped | submit | stop | 5 | Read the result codes; fix the signer set or the cause they name. |
| `SEQUENCE_CONFLICT` | Envelopes were refused with `tx_bad_seq` twice: another client uses the account's sequence numbers | submit | replan | 5 | Stop the other client, then run the close again. |
| `FEE_LIMIT` | The network wants a higher bid than the cap per operation or the close budget allows | submit | replan | 5 | Raise the cap or the budget, or wait for network fees to fall, then run the close again. |
| `RETRY_LIMIT` | A planned transaction was built `maxAttemptsPerTransaction` times without landing, or Horizon kept answering 429 | submit | replan | 5 | Run the close again later. |
| `OUTCOME_UNKNOWN` | An envelope's outcome could not be learned; it may still apply until its time bound (`maxTime`) | submit | replan | 5 | Run the close again only after a ledger has closed past `maxTime`. |
| `MERGE_PREFLIGHT_FAILED` | The fresh facts before a merge say it would fail (subentries left, a sponsorship, a missing or memo-required destination) | merge | replan | 5 | Resolve what the detail names, then run the close again. |
| `SEQNUM_TOO_FAR` | The sequence guard holds the merge back beyond `maxWaitLedgers`, or the wait for it ran out; `unblocksAtLedger` is the first ledger the merge can land in. A plan blocked by it when planned has the blocker of the same name, is refused without `--partial` (3) and runs as a partial close with it (4) | plan, merge, submit | replan | 3 before a submission, 5 after | Run the same command again at or after `unblocksAtLedger`. |
| `ACCOUNT_STILL_EXISTS` | The merge applied, but Horizon still returned the account at the final check | confirm | stop | 5 | Check the account on the explorer; if it still exists, run the same command again. |
| `INTERRUPTED` | `ExecuteOptions.signal` was aborted (the CLI does on SIGINT or SIGTERM; review CL-1): the run stopped at the next safe point and posted nothing after it; an envelope whose outcome was open is named with its `maxTime` | where the run was | replan | 3 when nothing was submitted, 5 otherwise | Run the close again; if the stop names `maxTime`, only after a ledger has closed past it. |

The report's `stop.code` can also be a `DustinErrorCode`: the code of the error that interrupted a run which then threw (review finding R1).

## CLI-only codes

These appear only in the CLI's output (the `code` of an `error` line with `--json`, or the first line of the message); the SDK never throws them.

| Code | Meaning | Exit | Remedy |
|---|---|---|---|
| `USAGE_ERROR` | The command line could not be parsed: an unknown option, a missing argument, conflicting options | 2 | Run `dustin --help`, or `dustin <command> --help`, for the usage. |
| `UNEXPECTED_ERROR` | Something that is not a `DustinError` was thrown: a bug. People see `dustin: unexpected error: ...` | 1, or 5 after a submission | Run the same command with `--verbose` and report the output. The remedy says where the hashes of what was submitted are: printed above it; in the receipt printed below it, when a run that submitted something stops on it; with `--json`, in the `tx:submitted` lines on standard error and in the close report on standard output. |
| `PLAN_NOT_CLOSABLE`, `NOTHING_TO_EXECUTE` | The stop codes of the same name, used for the CLI's own refusal before anything is signed | 3 | As above. |
