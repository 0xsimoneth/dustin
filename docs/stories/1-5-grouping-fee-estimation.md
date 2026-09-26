# Story 1.5: Transaction grouping, fee estimation and plan hash

Status: ready-for-dev

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

- [ ] Task 1: grouping (`src/plan/grouping.ts`) (AC: 1, 2)
- [ ] Task 2: fees (`src/plan/fees.ts`) (AC: 3)
- [ ] Task 3: plan hash (AC: 4)
- [ ] Task 4: `planClose()` public entry point (AC: 6)
- [ ] Task 5: tests, including a seeded property test over generated snapshots (AC: 1-5)

## Dev Notes

- docs/README.md canonical decisions 6 and 7; architecture section 5.2; PRD FR-04, FR-05, FR-10.
- Day-1 experiment 1: a bid of 82,746 stroops per operation was charged 100 per operation; the bid is a ceiling, not the price.

### References

- docs/epics-and-stories.md, Story 1.5

## Dev Agent Record

### Agent Model Used

dev-story workflow (AI developer agent)

### Implementation Plan

### Debug Log References

### Completion Notes List

### File List

## Change Log
