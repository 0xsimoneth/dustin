# Changelog

All notable changes to `stellar-dustin` are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html); while the major version is 0, a minor release may change the API.

## [Unreleased]

Post-sprint changes, outside the Instaward scope (`docs/README.md`, canonical decision 1). Nothing here changes a deliverable or the evidence.

### Added

- `stepAction()` and `subjectLabel()`, the words of a plan step and of what it acts on as `renderPlan()` prints them, so a user interface that lays a plan out itself keeps the CLI's wording.
- A plan-only web demo under `web/`, not part of the package and not hosted: a static page, built with Vite, that runs `planClose()` in the browser against the testnet Horizon and renders the plan; it never asks for a secret, and closing stays in the CLI and the SDK ([docs/web-demo.md](docs/web-demo.md), ADR-0007). Reviewed on 2026-10-01 (`docs/reviews/2026-10-01-e5-web-demo-review.md`): a Content-Security-Policy, the plan marked stale when an input changes, explorer links only for addresses with a valid checksum, the notes under a blocked status aligned with the executor, a parity test against the CLI's `--json` plan, and the page's bundle scanned by the browser-safety guard in CI.

### Changed

- `validatePlanOptions()`, and so `planFromSnapshot()`, `planClose()` and the CLI, refuse a `memo` that is not a string with `CONFIG_INVALID` (`Invalid plan option: memo must be a string`); before, `Buffer.byteLength` threw a `TypeError` for it, and the `TextEncoder` that replaced `Buffer` would have coerced it to text (E5-S1 review, EC-2).
- The SEP-29 `config.memo_required` check decodes the data entry's base64 value exactly as `Buffer.from(value, "base64")` did, every character outside the alphabet skipped and decoding stopped at the first `=`; the first browser-safe version used `atob`, which throws on a stray character, so a malformed value would have read as "not required" (E5-S1 review, EC-1).
- The SDK entry (`stellar-dustin`) runs in a browser bundle: `sha256Hex` takes its digest from the Stellar SDK's `hash()` instead of `node:crypto`, and no module reachable from the entry uses `Buffer` or another Node-only API; `scripts/check-browser-safe.mjs` checks the built entry and its chunks in CI, parsing each file with the TypeScript compiler so that a string or a comment is never a finding and a bare `Buffer` or `process` value never escapes (E5-S1 review, S3). Every plan hash and snapshot hash is unchanged (`test/unit/canonical-json.test.ts`). The CLI and `stellar-dustin/testing` keep Node's APIs.

## [0.1.0] - unreleased

Prepared on 2026-09-29 for the first npm publish, which is the builder's action. Testnet only. Built during the Stellar Instaward sprint of 2026-09-22 to 2026-10-22 against the accepted SOW (`SUCCESSFUL_SOW.md`); the SOW's success metric was met on 2026-09-28 (`evidence/README.md`).

### Added

- `planClose()`, the read-only planner (SOW Deliverable 1): inspects an account across every subentry type, orders the teardown (offers, disposals, trustline and data removals, then the merge), groups it into the fewest fee-bumped transactions of at most 100 operations, and gives a reason and a fee estimate per step, the XLM that reaches the destination, the reserves that return to reserve sponsors, blockers and unclosable items with remedies, and a content hash. It only reads from Horizon and cannot sign. `inspectAccount()` and the pure `planFromSnapshot()` are exported too.
- `executeClose()`, the fee-sponsored executor (SOW Deliverable 2): every transaction is an inner transaction with fee 0, signed by the account and wrapped in a fee bump that only the sponsor signs, so an account with zero spendable XLM can be closed. A fresh plan is compared with the approved one before anything is signed; the executor retries and recovers (504s, 429s, `tx_too_late`, `tx_bad_seq`, fee surges within a per-close budget), re-plans after an operation failure, waits for the sequence guard within a bound, verifies the account is gone on Horizon, and returns a close report with every hash, both envelopes as XDR, explorer and Horizon links and an operation summary per transaction. `ExecuteOptions.signal` (an `AbortSignal`) stops a run at the next safe point with the stop code `INTERRUPTED`.
- The disposal ladder in the SOW order: sale by strict-send path payment, return to the issuer (a burn), transfer to the destination when it holds an authorized trustline with room, otherwise unclosable with a reason and a remedy; `preferDestination` (CLI `--prefer-destination`) tries the destination before the issuer. `slippageBps` bounds each sale (default 100, that is 1%).
- Sponsored reserves: a sponsored trustline is removed by the account alone and its reserve returns to the reserve sponsor; a sponsored signer is removed by the merge, which returns its reserve too. The report records each reserve sponsor's `num_sponsoring`, minimum balance and XLM balance before and after.
- Detection with remedies of what blocks a merge: liquidity pool shares, thresholds the master key cannot meet, `AUTH_IMMUTABLE`, an account that sponsors reserves or claimable balances, the sequence guard (`SEQNUM_TOO_FAR` with the unblocking ledger), frozen or maintain-liabilities trustlines, and destination problems (missing, self, SEP-29 memo). A warning names claimable balances that list the account as a claimant, which it can no longer claim after the merge.
- The `dustin` command: `plan`, `close` (a dry run without `--execute`; with it, one typed confirmation of the destination's last four characters or `--yes`, `--partial`, `--memo`, `--sponsor`, `--base-fee`, `--report`), `fixture create --profile messy|edge` and `fixture verify`; global `--network testnet` and `--verbose`. Exit codes 0 to 6 as in `docs/README.md` canonical decision 5. With `--json` the command is non-interactive: standard output carries one JSON document (the plan or the report) and standard error NDJSON events. SIGINT and SIGTERM during a run leave a receipt and the report. Secrets come only from `DUSTIN_ACCOUNT_SECRET` and `DUSTIN_SPONSOR_SECRET` (the environment, then `.env`) or a hidden prompt on a terminal, never from the command line.
- The `messy` fixture (the SOW's metric account) and the `edge` fixture with one account per edge case, both built on testnet from Friendbot and checked against SOW Appendix B; `fixture verify` detects a testnet reset (`RESET_SUSPECTED`).
- The D3 test matrix (`docs/test-matrix.md`): an offline tier on recorded Horizon JSON and a fake ledger with the network blocked, and a live testnet tier that funds its own throwaway accounts; `npm run evidence:check` checks every link and hash of the evidence package.
- JSON Schemas of the plan and the report (`schemas/plan-schema.json`, `schemas/receipt-schema.json`, shipped in the package and exported as `stellar-dustin/schemas/*`), every error and stop code with its remedy (`docs/errors.md`, `remedyOf()`), the README, the integration notes, the write-up on ordering rules and known limits, and the evidence package.
- `stellar-dustin/testing`, a second entry point for an integrator's own tests: the `messy` and `edge` fixture builders (every key new from `Keypair.random()`, every account funded by Friendbot, no secret read from anywhere), `checkMessyFixture()` and the other checks, the manifest readers, and `recordedReader()` for planning offline from a fixture's recorded Horizon responses.
- `examples/close-with-sponsor.ts` (the whole close with the typed confirmation, the events, `allowPartial`, `preferDestination` and the error codes) and `examples/plan-a-fixture.ts` (a fixture built, checked and planned offline), type-checked in CI against the package's published types.

### Security

- Testnet only: every entry point checks that Horizon serves the testnet passphrase, and `--network` accepts only `testnet`.
- A secret-shaped argument is refused before the command line is parsed; every error, report and output line is redacted.
- The sponsor signs only fee-bump envelopes, never an operation on the closed account's assets, and never beyond the per-close budget.

