# ADR-0005: Testing strategy

- Status: Accepted
- Date: 2026-09-25
- Deciders: the builder (system architect role)
- Related: `docs/architecture.md` sections 4.10, 4.11, 6.3, 8, 13; ADR-0006

## Context

The SOW requires a test matrix that "another team can pick up": illiquid leftover balance, sponsored trustlines where the reserve returns to the sponsor, `ACCOUNT_MERGE_SEQNUM_TOO_FAR`, authorization-required and clawback-enabled trustlines, liquidity pool shares (detected and reported), raised multisig thresholds (detected and reported), plus construction of the messy fixture and a recorded baseline of the existing tool. Evidence is a passing-test screenshot, the public repo, and the baseline recording.

Constraints: testnet is best-effort and resets 2 to 4 times a year (next 2026-12-16), wiping every account (https://developers.stellar.org/docs/networks); the public Horizon has a per-IP rate limit (default 3600/hour); ledgers close about every 5 seconds; market liquidity on testnet is whatever someone left in the order book, so nothing about "illiquid" can be assumed from the environment.

## Decision

### Layer 1: offline unit tests (default `vitest` project, no network)

- **Recorded Horizon responses** in `test/fixtures/horizon/*.json`: account, offers, destination, issuer accounts, path quotes, fee stats, ledgers, for each matrix scenario. Recorded once from testnet with the fixture builder and committed; secrets are never in them (they contain public keys only).
- **`RecordingReader`** implements `LedgerReader` from those files, records every call, and throws on any method outside the read set. Planner tests assert both the plan and the exact request list; this is the executable form of "dry-run can never mutate".
- **Planner rule tests** (one per rule R1 to R9 in the architecture): offers precede disposals and removals; disposal precedes removal; sponsored trustlines are removed without `revokeSponsorship`; data anywhere; signers untouched; pool-share balance is a blocker that also blocks the constituent trustlines; merge last with the preflight facts; sequence guard formula; market steps isolated.
- **Property tests** (fast-check style generators over random account snapshots): no transaction exceeds 100 operations; the merge is the last operation of the last transaction; every `dependsOn` edge points to an earlier position; every non-native balance ends in exactly one rung; the plan is stable under `JSON.parse(JSON.stringify())`; `planHash` is deterministic.
- **Ladder tests**: rung selection for authorized, unauthorized, maintain-liabilities-only, clawback-enabled, missing issuer, memo-required issuer, destination with and without trustline and capacity, quote below one stroop.
- **Builder mapping tests**: each step kind maps to the expected operation XDR (including cancel of a `manageBuyOffer`-created offer via `manageSellOffer` amount 0 with the offer's own assets), inner fee and time bounds, memo propagation.
- **Classifier tests**: every Horizon result code in the ADR-0006 mapping table yields the intended verdict (`retry-same`, `rebuild-same-sequence`, `replan`, `stop`).
- **Redaction tests**: a secret seed in scope never appears in serialised plan, report, journal or error messages.
- **Sequence guard tests** with synthetic sequences: `(L + 720) << 32` reports an ETA of about an hour; `(L - 1) << 32 + k` passes.

### Layer 2: testnet integration tests (`vitest` project `testnet`, `DUSTIN_TESTNET=1`)

- **Fresh fixture per run.** `dustin fixture build --profile messy` creates a new sponsor (Friendbot), three throwaway issuers and a new fixture account for every run, so test runs never share state and a testnet reset only costs a rebuild. Fixture transactions are themselves fee-bumped by the sponsor.
- **End to end**: plan the fixture, assert the plan matches the committed expectation modulo keys and fees, execute, assert `GET /accounts/{fixture}` returns 404, assert every transaction in the report is a fee bump whose fee account is the sponsor and whose inner source is the fixture, assert the sponsor's `num_sponsoring` decreased by the sponsored-trustline reserve, and assert the destination's balance grew by the reported merge amount.
- **Edge profile**, one test per matrix row:
  - *Illiquid leftover balance*: asset `ILLQ` from a throwaway issuer with `AUTH_REQUIRED | AUTH_REVOCABLE`, no offers ever posted, trustline funded then deauthorised; destination holds no trustline. Deterministic because nothing on testnet can create a market for an asset whose issuer never existed before the run and whose holders cannot trade it. Expected: rung 4 with the three rung reasons, `outcome = partial`, safe steps executed, merge not attempted, account still exists with exactly one trustline.
  - *Illiquid but returnable*: asset `RET` (no market, issuer accepts returns) exits through rung 2; this is the variant that lives on the `messy` fixture so the binary success metric still holds.
  - *Sponsored trustline*: `SPN` created under `beginSponsoringFutureReserves`; expected: removal without `revokeSponsorship`, sponsor `num_sponsoring` decrement, report line "reserve unlocked on sponsor".
  - *`ACCOUNT_MERGE_SEQNUM_TOO_FAR`*: `bumpSequence` to `(L + 3) << 32` then close; expected: pre-merge wait of a few ledgers, then success; a second case bumps to `(L + 720) << 32` and asserts the executor stops with the ETA.
  - *Authorization-required*: authorized trustline returns to issuer; unauthorized trustline with balance is unclosable; `maintain-liabilities` state is unclosable with that specific reason.
  - *Clawback-enabled*: issuer claws back between plan and execute (test helper) so the disposal fails with `op_underfunded`; expected: one re-plan, trustline removed, close completes.
  - *Liquidity pool shares*: pool-share trustline with a non-zero balance; expected: `LP_SHARES_HELD` blocker plus the two constituent trustlines reported as blocked (`CHANGE_TRUST_CANNOT_DELETE` reasoning), safe steps still executed.
  - *Raised multisig thresholds*: `setOptions` high threshold above master weight; expected: `RAISED_THRESHOLDS` blocker, no transaction submitted.
- **Retry paths** are exercised with a fault-injecting `Horizon.Server` wrapper (returns a 504 once, then the real response) rather than by waiting for real timeouts.
- Budget: a full edge run makes roughly 150 Horizon requests, under the default hourly limit; CI runs the testnet project on demand, not on every push.

### Layer 3: baseline recording (manual, scripted around)

- Two identical `messy` fixtures are built; one is offered to the existing tool, the other to Dustin. `dustin baseline record --fixture` stores the before state, prints the expected stopping point, waits, stores the after state and writes `evidence/baseline/*.json`. The screen recording is produced by the builder. Expected observation, derived from the public client code (every transaction sourced from and paid by the closed account, no fee bump): the first submission fails for lack of a spendable fee. The server-side co-signing rule mentioned in the SOW is not in the public code and is recorded only if observed.

### Evidence package

Because the next testnet reset erases the ledger, `evidence/` stores for every transaction the outer and inner hashes, the explorer links, the Horizon transaction JSON, the envelope and result XDR, plus the `GET /accounts/{fixture}` 404 body and screenshots. The test-results screenshot required by the SOW is produced from `vitest --reporter=verbose` of both projects.

## Consequences

- The planner, the most valuable and most subtle part, is fully testable without network, keys or waiting.
- Integration tests cost a Friendbot funding per run and a few minutes of ledger time.
- Matrix rows map one-to-one to fixture variants, so a reviewer can rebuild any case with one command.

## Alternatives considered

- **Local network (quickstart container)** for integration tests. Considered and kept as an option; rejected as the default because the SOW evidence must be on the public testnet where the explorer links live, and the deterministic-asset construction works on either.
- **Mocking `@stellar/stellar-sdk`** instead of recording responses. Rejected: recorded JSON documents the real Horizon shapes and doubles as integration notes.

## Sources

- SOW: `SUCCESSFUL_SOW.md` (Deliverable 3, Evidence)
- Networks (reset schedule, Friendbot): https://developers.stellar.org/docs/networks
- Horizon rate limiting: https://developers.stellar.org/docs/data/apis/horizon/api-reference/structure/rate-limiting
- List of operations (result codes used in expectations): https://developers.stellar.org/docs/learn/fundamentals/transactions/list-of-operations
- CAP-0018 (maintain-liabilities semantics): https://github.com/stellar/stellar-protocol/blob/master/core/cap-0018.md
- CAP-0035 (clawback): https://github.com/stellar/stellar-protocol/blob/master/core/cap-0035.md
- CAP-0033 (sponsored reserves): https://github.com/stellar/stellar-protocol/blob/master/core/cap-0033.md
- Demolisher client code (baseline expectation): https://github.com/stellar-expert/stellar-expert-explorer/blob/master/business-logic/demolisher/demolisher-tx-builder.js
