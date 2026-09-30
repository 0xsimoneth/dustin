# Changelog

All notable changes to `stellar-dustin` are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html); while the major version is 0, a minor release may change the API.

## [Unreleased]

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

