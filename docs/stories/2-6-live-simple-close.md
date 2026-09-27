# Story 2.6: First live end-to-end close on testnet with evidence

Status: review

## Story

As the builder,
I want a recorded, verifiable close of a zero-spendable account on testnet,
so that the week 2 expected output of the SOW is met and the Deliverable 2 evidence chain starts.

## Acceptance Criteria

1. Given a "simple" account built by `fixture:build --profile simple` (1 offer, 1 data entry, 2 zero-balance trustlines, 0 spendable XLM), when `dustin close --yes` runs, then the account is closed in one fee-bumped transaction and the explorer shows the sponsor as fee account.
2. Then `evidence/closes/simple-<date>/` contains the receipt, the CLI transcript, the pre-close Horizon snapshot and the post-close 404 response.
3. Then `test/testnet/simple-close.test.ts` builds, closes and verifies such an account end to end and passes in the manual CI job.
4. Then the README "Status" section links the receipt and the explorer transaction.

How each is met, and the deviations:

- AC-1: met in substance with a harder account, as a documented deviation. No `simple` profile exists (canonical decision 3 defines two fixtures, `messy` for the metric and `edge` for the unclosable case). Two fresh `messy` fixtures were closed instead, each holding zero spendable XLM, 4 trustlines with dust (one sponsored by a separate reserve sponsor), 2 open offers and 1 data entry, which is every SOW Appendix B precondition. The close takes 3 fee-bumped transactions instead of 1 because the messy fixture holds a balance with a market, which canonical decision 6 isolates in its own transaction and follows with a separate merge; a fixture without a market step closes in one transaction (the offline CLI test `closes with --yes, streams each transaction and ends with the 404 verification (exit 0)` shows `tx 1/1`). The second run goes through the CLI: `dustin close --execute --yes --report`. Horizon shows the sponsor as `fee_account`, the closed account as `source_account` and inner `max_fee` 0 for all 6 transactions.
- AC-2: met at a different path, as a documented deviation. `evidence/runs/<UTC stamp>/` (the layout of review finding R16, `evidence/runs/README.md`) replaces `evidence/closes/simple-<date>/`:
  - `evidence/runs/20260926T125350Z/` (SDK run from `test/testnet/execute-close.test.ts`): the close report with both envelopes of every transaction, the pre-close Appendix B verification, the account before, Horizon's record of every hash, the balances before and after, and the post-close 404.
  - `evidence/runs/20260927T200015Z-cli/` (CLI run): the CLI transcript, the report written by `--report`, the pre-close Appendix B verification, Horizon's record of every hash and the post-close 404.
- AC-3: met by `test/testnet/execute-close.test.ts` instead of a separate `simple-close.test.ts`, as a documented deviation. It builds a fresh messy fixture, verifies Appendix B right before the close, closes it, and asserts the 404, the sponsor as fee account of every transaction on the ledger, the destination credited with exactly the merged amount and the reserve sponsor's `num_sponsoring` back to 0; with `DUSTIN_EVIDENCE=1` it writes the evidence before asserting. It passed live on 2026-09-26; the reordering that writes the evidence before the assertions (2026-09-27) has been checked only offline (typecheck, lint), not run live again. The manual CI job (`.github/workflows/testnet.yml`) has not been dispatched in this session.
- AC-4: met. README "Status" and "Evidence" link `evidence/runs/20260926T125350Z/summary.md`, which links every explorer transaction.

## Tasks / Subtasks

- [x] Task 1: evidence writer that refuses any seed-shaped string or known secret, never overwrites a run (`test/helpers/evidence.ts`, review R16)
- [x] Task 2: live close test writes evidence before asserting (`test/testnet/execute-close.test.ts`)
- [x] Task 3: live SDK close with evidence (`evidence/runs/20260926T125350Z/`)
- [x] Task 4: live CLI close with transcript (`evidence/runs/20260927T200015Z-cli/`)
- [x] Task 5: README Status and Evidence sections link the evidence
- [ ] Task 6: dispatch the manual testnet CI job once and link its run (builder, needs the GitHub UI or `gh workflow run`)

## Dev Notes

- Gate from the review of Epics 0 to 2: no live evidence close before R1 (report survives errors), R2 (over-budget plans refused before signing) and R3 (executor exported, `close --execute` wired) were closed; all three were merged and green in CI before the first run.
- Both runs used fresh fixtures. The builder's baseline fixture `messy-20260926T035942Z` stays untouched for the Demolisher recording (E1-S2); the metric close of that same account follows the recording (E3-S7, PRD FR-25).
- Explorer links resolve only until the testnet reset scheduled for 2026-12-16; the JSON and XDR files are the durable record (canonical decision 12).

### References

- docs/epics-and-stories.md, Story 2.6; SUCCESSFUL_SOW.md section 5.1 week 2 and Appendix B; docs/reviews/2026-09-27-e2-integration-review.md

## Dev Agent Record

### Completion Notes List

- SDK run (2026-09-26): 3 transactions in ledgers 4880726 to 4880728; the destination received exactly 4.0000007 XLM; the reserve sponsor's `num_sponsoring` went from 1 to 0; sponsor fees 1,500 stroops.
- CLI run (2026-09-27): exit code 0, 3 transactions in ledgers 4903138 to 4903140, 4.0000007 XLM merged (read from the merge result), 0.5 XLM reserve returned to the reserve sponsor, sponsor fees 1,500 stroops, Horizon 404 for the account.

### File List

- test/helpers/evidence.ts, test/testnet/execute-close.test.ts, evidence/runs/README.md
- evidence/runs/20260926T125350Z/, evidence/runs/20260927T200015Z-cli/
- README.md

## Change Log

- 2026-09-26: evidence writer (R16) and the first live close with evidence.
- 2026-09-27: live CLI close with transcript; story record. Status: review (the deviations in AC-1 to AC-3 need the builder's acceptance).
