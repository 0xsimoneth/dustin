# Story 1.5: Transaction grouping, fee estimation and plan hash

Status: done

## Story

As a sponsor operator,
I want the plan grouped into the fewest fee-bumped transactions that keep failures isolated, with a fee estimate per step, per transaction and in total,
so that I know what a close will cost before I pay for it.

## Acceptance Criteria

1. Grouping follows canonical decision 6: deterministic cleanup (offer cancellations, returns to the issuer, transfers to the destination, removal of emptied trustlines, data removals) goes into one transaction of at most 100 operations; each path payment and its trustline removal is isolated in its own transaction; the merge joins the cleanup transaction when there is no path payment, otherwise it runs alone last.
2. A disposal and its trustline removal are never split across transactions, no transaction exceeds 100 operations, the merge is the last operation of the last transaction, and every step has a transaction index; a synthetic account with 150 offers and 3 trustlines yields at least 2 cleanup transactions.
3. Fees follow canonical decision 7: the per-operation bid is `max(last ledger base fee, fee_charged p80)`, at least 100 stroops and at most the cap (default 1,000,000), or an explicit override; the inner fee is 0; each transaction's fee-bump bid is `bid x (operations + 1)`; the plan total is the sum and is compared with the per-close budget (default 5 XLM). The fee payer is the fee sponsor; the account pays 0.
4. `planHash` is the sha256 of the canonical structural plan (steps, order, grouping, rungs, operations without market amounts); fee numbers and quotes do not change it.
5. Every step, transaction, blocker and unclosable item has a non-empty reason, and the fixture's reasons are snapshot-tested.
6. `planClose({ account, destination })` inspects the account and returns the plan; it needs no secret.

## Tasks / Subtasks

- [x] Task 1: grouping (`src/plan/grouping.ts`) (AC: 1, 2)
- [x] Task 2: fees (`src/plan/fees.ts`) (AC: 3)
- [x] Task 3: plan hash (AC: 4)
- [x] Task 4: `planClose()` public entry point (AC: 6)
- [x] Task 5: tests, including a seeded property test over generated snapshots (AC: 1-5)

## Dev Notes

- docs/README.md canonical decisions 6 and 7; architecture section 5.2; PRD FR-04, FR-05, FR-10.
- Day-1 experiment 1: a bid of 82,746 stroops per operation was charged 100 per operation; the bid is a ceiling, not the price.

### References

- docs/epics-and-stories.md, Story 1.5

## Dev Agent Record

### Agent Model Used

dev-story workflow (AI developer agent)

### Implementation Plan

- `groupUnits()` packs cleanup units up to the operation limit without splitting a unit, gives each conversion unit its own transaction, and appends the merge to the last cleanup transaction only when no conversion precedes it and there is room.
- `planFromSnapshot()` places the sequence guard on the merge's transaction. When the guard fails but the wait is within `maxWaitLedgers` (default 120), it regroups with a separate merge so the cleanup can land first and adds a warning; beyond that it drops the merge, adds `SEQNUM_TOO_FAR` and the plan is `blocked`.
- `feeSummary()` bids `max(last ledger base fee, fee_charged p80)` capped at 1,000,000 stroops (or the override, floored at 100), fee-bump bid `base x (ops + 1)`, inner fee 0, total against the 5 XLM budget.
- `planHash` hashes the canonical structure: step ids, kinds, transaction indexes, dependencies, subjects, rungs, destinations and operations without `destMin`; no fees, quotes or prose.
- A step's reason explains only the rungs tried before the chosen one; the full list of ruled-out rungs stays in `disposal.ruledOut`.
- `planClose()` validates the destination and fee sponsor, inspects with GET requests and plans. A contract account is refused with `CONTRACT_ACCOUNT` (exit 2) rather than returned as a blocked plan, a deviation from PRD FR-01 that keeps canonical decision 5 ("bad address" is exit 2).

### Debug Log References

- Red: the plan test file failed on the missing module; green after implementation. The reason snapshot was written on the first green run and updated once after limiting the explanation to earlier rungs.

### Completion Notes List

- AC1-AC2: the fixture groups as cleanup (9 operations), DUSTA sale (2) and merge (1); without the path payment it closes in one 12-operation transaction; 150 offers produce a first cleanup transaction of exactly 100 operations and the merge last.
- AC3: fee bid, override, cap, inner fee 0 and totals are asserted; live against the fixture the bid was 82,964 stroops per operation and the total bid 1,244,460 stroops, within the 5 XLM budget.
- AC4: the hash is unchanged by a fee override or a moved quote and changes with `preferDestination`.
- AC5: every step and transaction reason is non-empty; the fixture's reasons are snapshot-tested.
- AC6: `planClose()` against the live fixture returned `closable` with the same plan.
- A seeded property test over 300 generated accounts checks the operation limit, the fee arithmetic, backward dependencies, the merge position, the closable/merge equivalence, that every non-zero balance is either disposed of or reported, and hash determinism.
- 121 unit tests pass; lint and typecheck pass.

### File List

- `src/plan/grouping.ts`, `src/plan/fees.ts`, `src/plan/plan.ts`, `src/plan/plan-close.ts` (new)
- `src/plan/ladder.ts`, `src/plan/order.ts` (modified: reason text limited to earlier rungs)
- `src/index.ts` (modified: `planClose`, `planFromSnapshot`, plan types)
- `test/helpers/generate.ts`, `test/unit/plan/plan.test.ts`, `test/unit/plan/__snapshots__/plan.test.ts.snap` (new)
- `test/unit/smoke.test.ts` (modified)
- `docs/stories/1-5-grouping-fee-estimation.md`, `docs/stories/sprint-status.yaml` (modified)

## Senior Developer Review (AI)

- Date: 2026-09-26
- Scope: commits 8ff5100..b8fbb19 (Epic 1), adversarial review plus an edge-case walk by an independent review agent (read-only), 18 findings across the epic.
- Fixes: commits d2d9203 (planner and inspector), cc01a72 (property test), 47218a6 (fixture builder and plan output), c769364 (evidence).
- Outcome: changes requested, all resolved.

### Action Items

- [x] Low: the quoted path changed `planHash` (1-5 AC4); it is left out of the structural hash.
- [x] Low: a merge-only transaction claimed the cleanup had filled the operation limit; the reason now says there is nothing to clean up.
- [x] Low: `PlanOptions` were not validated (fractional or negative slippage, NaN fees, a 1-operation limit); invalid values throw `CONFIG_INVALID`, and the memo is limited to 28 bytes.
- [x] Low: the property generator never produced blockers, a failing guard, pools, B-24 or rung 3 without room, used random keys, and did not assert 1-5 AC2. It now covers all of them over 600 seeds with deterministic keys and asserts that each branch is reached.

## Change Log

- 2026-09-26: Grouping, fee summary, guard placement, structural plan hash and `planClose()`. Status: review.
- 2026-09-26: Review findings resolved. Status: done.
