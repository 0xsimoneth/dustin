# Story 1.4: Close plan model, ordering engine and disposal ladder

Status: done

## Story

As an integrator,
I want a pure function that turns an account snapshot into an ordered close plan, with a disposal route for every leftover balance and every blocker explained,
so that the plan can be executed top to bottom without any step being blocked by a later one.

## Acceptance Criteria

1. Given the recorded messy fixture, when it is planned with the default ladder, then the steps are: cancel both offers; for DUSTB, DUSTC and SPTA a payment to the issuer followed by the trustline removal; the data entry removal; for DUSTA a strict-send path payment to the account itself followed by the trustline removal; and the merge last. Every step lists the steps it depends on, and no step depends on a later one.
2. The disposal ladder follows canonical decision 8: path payment, return to issuer, send to destination, unclosable. With `preferDestination` the destination transfer is tried before the return to issuer. The plan records the order used, the chosen rung, the viable fallbacks and the reason each other rung was ruled out. A path payment uses the best quote, `destMin` = quote minus the slippage (default 1%, never below 1 stroop), and is not planned when the quote could rely on the account's own offers.
3. A balance on a trustline that is not authorized, or only authorized to maintain liabilities, is an unclosable item with its code, a reason naming the issuer and a remedy; its trustline is not removed and the merge is omitted. A merged issuer does not make a balance unclosable (day-1 experiment 4); a memo-required issuer rules out the return to issuer.
4. Blockers are detected and reported, never acted on: account missing, `AUTH_IMMUTABLE`, `num_sponsoring > 0` (with the sponsored claimable balances), liquidity pool shares (and the trustlines of the pool's assets, which cannot be removed while the pool share exists), master key weight 0, master weight below the medium or high threshold, destination missing, destination equal to the account, destination memo-required without a memo, and the sequence-number guard. Each blocker and unclosable item has a non-empty reason and remedy.
5. Plan status is `closable` when the plan ends in a merge, `partial` when only per-balance items prevent the merge, and `blocked` when a blocker prevents the merge or nothing can be signed.
6. The sequence guard follows canonical decision 10: `sequenceAtMerge` = sequence + index of the merge transaction + 1; the merge is allowed while `sequenceAtMerge < (ledger + 1) << 32`; otherwise `unblocksAtLedger = (sequenceAtMerge >> 32) + 1` with an ETA of 5 seconds per ledger; within the wait limit (default 120 ledgers) it is a warning, beyond it a `SEQNUM_TOO_FAR` blocker.
7. Recovery accounting: XLM to the destination = the native balance plus the quoted path-payment proceeds; reserves of sponsored entries (trustlines, offers, signers, the account entry itself) are listed per reserve sponsor and never counted for the account; fees paid by the account are always 0.
8. The plan is JSON-stable, contains descriptors only (no key, no signed envelope) and is identical for the same snapshot and options.

## Tasks / Subtasks

- [x] Task 1: plan types (`src/plan/model.ts`) (AC: 8)
- [x] Task 2: disposal ladder (`src/plan/ladder.ts`) (AC: 2, 3)
- [x] Task 3: blockers and status (`src/plan/blockers.ts`) (AC: 4, 5)
- [x] Task 4: sequence guard (`src/plan/guard.ts`) (AC: 6)
- [x] Task 5: ordering and dependencies, recovery (`src/plan/plan.ts`, `src/plan/recovery.ts`) (AC: 1, 7)
- [x] Task 6: pool constituents in the inspector (`GET /liquidity_pools/{id}`) (AC: 4)
- [x] Task 7: tests on the recorded fixture and synthetic variants (AC: 1-8)

### Review Follow-ups (AI)

- [x] [AI-Review][Low] Plan the removal of a zero-balance pool-share trustline (`changeTrust` with the pool asset, limit 0) before its pool's asset trustlines, and block only non-zero shares (architecture section 4.4).

## Dev Notes

- Canonical decisions 6, 8, 9, 10, 11 (docs/README.md); architecture sections 4.3, 4.4, 5 and 8; PRD FR-02, FR-03, FR-06, FR-08, FR-14.
- Pulled forward from E2-S5 (route resolution) and the planning half of E3-S4 (guard), so the Week 1 plan shows resolved rungs and the guard.
- Rung 1 sends the proceeds to the closing account itself, which leaves through the merge (architecture 4.4); day-1 experiment 14 verified a self-destination strict-send path payment.
- Own offers (edge case B-24): a strict-send conversion from asset X to asset Y consumes offers that sell Y for X. If the account has an offer selling Y for X on any hop of the quoted path, the quote may rest on liquidity that the cancellations remove, so rung 1 is ruled out for that balance.
- Grouping into transactions, fee estimates and the plan hash are E1-S5.

### References

- docs/epics-and-stories.md, Stories 1.4 and 2.5
- docs/architecture.md sections 4.3-4.4, 5, 6, 8
- docs/progress-log.md, day-1 experiments 4, 10, 13, 14

## Dev Agent Record

### Agent Model Used

dev-story workflow (AI developer agent)

### Implementation Plan

- `orderClose()` builds atomic units in execution order: one per offer cancellation, one per cleanup disposal with its trustline removal (or a lone removal for an empty trustline), one per data entry, one per path payment with its removal (phase `convert`), and the merge (phase `merge`) only when nothing blocks it. Step ids follow execution order, so `dependsOn` always points backwards.
- `chooseRung()` evaluates all three rungs for every balance, picks the first viable one in the configured order and keeps the other viable ones as executor fallbacks; ruled-out rungs carry their reason, which also opens the step's reason text.
- `mergeBlockers()` and `signingCapability()` assume the master key only. No signable cleanup (master weight 0 or below the medium threshold) yields no steps at all.
- `recoverySummary()` counts XLM to the destination only when the plan merges, and lists sponsored trustlines, offers, signers and the account entry per reserve sponsor.
- `sequenceGuard()` is the pure guard; the planner places it on the merge transaction in E1-S5.

### Debug Log References

- Red: the four test files failed on missing modules.
- One test first set only `authorized: false`; Horizon reports `is_authorized_to_maintain_liabilities: true` on fully authorized lines and both false on a frozen line (day-1 experiment 13), so the test now sets both. The classification was right.

### Completion Notes List

- AC1: the recorded fixture orders as cancel 826680, cancel 826681, DUSTB/DUSTC/SPTA return and removal pairs, the data entry, the DUSTA path payment and removal, then the merge; no step depends on a later one.
- AC2: SOW order and `preferDestination` (DUSTC goes to the destination); `destMin` floors at 1 stroop; a quote that could use the account's own offer is ruled out.
- AC3: deauthorized and maintain-liabilities balances are unclosable with the issuer named; a merged issuer still burns; a memo-required issuer is ruled out without a memo.
- AC4-AC5: blockers and status covered for immutable, sponsoring with claimable balances, thresholds, master weight 0, destination missing, self and memo-required, pool shares and their asset trustlines.
- AC6: guard boundary tests pass (`sequenceAtMerge = (L+1) << 32` is refused and unblocks at L+2); the plan-level warning or blocker is wired in E1-S5.
- AC7: recovery on the fixture is 4.0000007 XLM to the destination and 0.5 XLM to the reserve sponsor for SPTA.
- AC8: steps contain operation descriptors only.
- 109 unit tests pass; lint and typecheck pass.

### File List

- `src/plan/model.ts`, `src/plan/ladder.ts`, `src/plan/blockers.ts`, `src/plan/guard.ts`, `src/plan/recovery.ts`, `src/plan/order.ts` (new)
- `src/inspect/inspect.ts`, `src/inspect/snapshot.ts`, `src/reader/ledger-reader.ts` (modified: pool assets)
- `test/helpers/snapshots.ts`, `test/unit/plan/ladder.test.ts`, `test/unit/plan/guard.test.ts`, `test/unit/plan/order.test.ts`, `test/unit/plan/recovery.test.ts` (new)
- `test/unit/inspect/inspect.test.ts` (modified)
- `docs/stories/1-4-plan-model-ordering-engine.md`, `docs/stories/1-5-grouping-fee-estimation.md`, `docs/stories/sprint-status.yaml`

## Senior Developer Review (AI)

- Date: 2026-09-26
- Scope: commits 8ff5100..b8fbb19 (Epic 1), adversarial review plus an edge-case walk by an independent review agent (read-only), 18 findings across the epic.
- Fixes: commits d2d9203 (planner and inspector), cc01a72 (property test), 47218a6 (fixture builder and plan output), c769364 (evidence).
- Outcome: changes requested, all resolved.

### Action Items

- [x] Medium: liquidity pool shares were unclosable items (status `partial`); they are now a `LIQUIDITY_POOL_SHARES` merge blocker (canonical decision 11, 1-4 AC4/AC5).
- [x] Low: slippage was rounded down, so `destMin` equalled the quote for dust; it is rounded up and clamped to at least 1 stroop.
- [x] Low: the signing check ignored the low threshold; cleanup needs max(low, medium) and the merge max(low, high). The widened property test then found that a raised medium threshold alone gave a blocked plan with no blocker; it now reports `THRESHOLD_UNMET`.
- [x] Low: rung 3 could pay the account itself; a destination equal to the account is ruled out.
- [x] Low: a pool-share trustline with a zero balance must be removed like any other trustline (architecture section 4.4). It is now removed with `changeTrust` on the pool asset (limit 0, the pool id checked against its two assets) before its pool's asset trustlines, which depend on it; only held shares are a blocker, and an empty line whose pool Horizon did not return is reported.
- [x] Low: sponsored offers were credited to their sponsor even without a cancel step; attribution now follows the cancel steps, sorted by code point.

## Change Log

- 2026-09-26: Plan model, disposal ladder, blockers, guard, recovery and the ordering engine. Status: review.
- 2026-09-26: Review findings resolved except the zero-balance pool-share item. Status: review.
- 2026-09-26: Empty pool-share trustlines are removed; review complete. Status: done.
