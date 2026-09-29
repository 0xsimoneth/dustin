# Story 1.6: Dry-run guarantee and planner test suite

Status: done

## Story

As a wallet developer,
I want proof that `planClose()` can never mutate ledger state,
so that I can expose it in my UI before any confirmation.

## Acceptance Criteria

1. Given the read-only modules (`src/plan/**`, `src/inspect/**`, `src/reader/**`), then an ESLint rule forbids them to import signing or submission code (`Keypair`, `TransactionBuilder`, `Horizon.Server`, `Operation` from the SDK, and the `sponsor`, `fixture`, `tx` and `execute` modules), and a probe import fails the lint.
2. Given recorded Horizon responses, when `planClose()` runs, then every request is a GET and none goes to a submission endpoint.
3. Given the types, then `planClose()` accepts no secret or signer (a type test with `@ts-expect-error`), and the plan holds no key.
4. Given the recorded fixture, then a snapshot test asserts the complete plan (steps, grouping, recovery, fees at a fixed base fee of 100 stroops) and the snapshot is committed.
5. Given the live fixture, when it is planned, then its sequence number and subentry count are identical before and after (testnet tier).
6. Synthetic cases cover an account with nothing to clean (merge only, one transaction), a data entry only, one offer plus one trustline, a sponsored trustline, pool shares and raised thresholds.

## Tasks / Subtasks

- [x] Task 1: ESLint boundary rule and probe (AC: 1)
- [x] Task 2: GET-only and type tests (AC: 2, 3)
- [x] Task 3: full plan snapshot and synthetic cases (AC: 4, 6)
- [x] Task 4: live read-only test (AC: 5)

## Dev Notes

- docs/architecture.md section 6.3 (how "dry run can never mutate" is enforced), PRD FR-07.
- The build bundles the SDK entry into one file, so the architecture's "grep the built plan chunk" check does not apply; the import boundary plus the request-level test cover the same risk.

### References

- docs/epics-and-stories.md, Story 1.6

## Dev Agent Record

### Agent Model Used

dev-story workflow (AI developer agent)

### Implementation Plan

- ESLint `no-restricted-imports` on `src/plan/**`, `src/inspect/**` and `src/reader/**`: the SDK's `Keypair`, `TransactionBuilder`, `Horizon`, `Operation`, `Transaction` and `FeeBumpTransaction` are forbidden, and so are imports from `sponsor`, `fixture`, `tx`, `execute` and `cli`.
- Request-level test on recorded Horizon: every `planClose()` request is a GET and none targets `/transactions`.
- Type test: an object literal with a `signer` is a compile error for `planClose()` (the `@ts-expect-error` would itself fail the typecheck if the field were accepted).

### Debug Log References

- Red: a probe file in `src/plan/` importing `Keypair` and the fee-bump helper passed lint before the rule; after the rule it failed with two `no-restricted-imports` errors (probe deleted).

### Completion Notes List

- AC1-AC3: as above; `npm run lint` passes on the real code.
- AC4: full plan snapshot of the recorded fixture at a 100-stroop base fee (fees 1000, 300 and 200 stroops, total 1500) committed.
- AC5: the testnet-tier test built a fresh fixture, planned it (`closable`, cleanup/convert/merge) and found the sequence number and subentry count unchanged (70 s).
- AC6: merge-only, data-only, one offer with its trustline, and raised thresholds are covered here; sponsored trustlines and pool shares are covered in `order.test.ts`.
- 128 unit tests pass.

### File List

- `eslint.config.js` (modified: read-only zone rule)
- `test/unit/plan/dry-run.test.ts`, `test/unit/plan/__snapshots__/dry-run.test.ts.snap` (new)
- `test/testnet/plan-readonly.test.ts` (new)
- `docs/stories/1-6-dry-run-guarantee-tests.md`, `docs/stories/sprint-status.yaml`

## Senior Developer Review (AI)

- Date: 2026-09-26
- Scope: commits 8ff5100..b8fbb19 (Epic 1), adversarial review plus an edge-case walk by an independent review agent (read-only), 18 findings across the epic.
- Fixes: commits d2d9203 (planner and inspector), cc01a72 (property test), 47218a6 (fixture builder and plan output), c769364 (evidence).
- Outcome: changes requested, all resolved; one item accepted as a risk.

### Action Items

- [x] Low: the "never reads a secret" test only proved the secret was not printed; it now records every environment read and every HTTP method, and the plan-versus-close test compares the whole plan.
- [x] Low (accepted risk, no change): `.env` is loaded for every command, so `DUSTIN_*_SECRET` values from it reach `process.env` during `dustin plan`. The planner never reads them (proved by the environment-read test) and they are never printed or sent.

## Change Log

- 2026-09-26: Import boundary for the read-only zone, request and type tests, full plan snapshot, live read-only test. Status: review.
- 2026-09-26: Review findings resolved. Status: done.
