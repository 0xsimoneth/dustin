# Story 4.5: Write-up on ordering rules and known limits

Status: review

## Story

As a reviewer,
I want a short write-up of the ordering rules and what is not handled,
so that I understand both what Dustin does and where it stops.

## Acceptance Criteria

As written in `docs/epics-and-stories.md` (Story 4.5):

1. AC-E4-S5-1: Then `docs/write-up.md` explains why closing is ordered (subentries block the merge, balances block trustline removal, liabilities block both), the six ordering rules, the grouping rules, the disposal ladder with its failure mapping, sponsorship accounting and the sequence guard math, each with a citation.
   - **Met, with one deviation of wording.** Section 1 gives the three reasons with links to developers.stellar.org. Section 2 states the ordering rules as the architecture numbers them, R1 to R9 (`docs/architecture.md` section 5.1): nine, not six, because the architecture is the source and has nine. Each rule is one sentence, the protocol fact with its link, and where it shows in the recorded CLI metric close (steps S01 to S12, transactions 1 to 3 of `evidence/runs/20260928T112252Z-e3-cli/`). Section 3 is the grouping. Section 4 is the disposal ladder: a Mermaid diagram as built (`src/plan/ladder.ts`), the rung table, and the failure mapping of `src/execute/classify.ts`, naming the result codes that move an asset down the ladder (`op_too_few_offers`, `op_under_dest_min`, `op_cross_self`). Section 5 is fee sponsorship with the real arithmetic of the CLI metric close: a bid of 84,162 stroops per operation, bids of 841,620, 252,486 and 168,324 stroops, Horizon's `max_fee` equal to each, 1,000 + 300 + 200 = 1,500 stroops charged, and the fee sponsor's balance down by exactly 0.0001500 XLM; the SDK close bid 28,758 and was charged the same. Section 6 is sponsorship accounting with the observed release: `num_sponsoring` 1 to 0, the minimum balance 1.5 to 1.0 XLM, the XLM balance unchanged. Section 7 is the sequence guard's formula and the recorded wait of `evidence/runs/20260928T125223Z-e3s4-wait/`: (4915280 + 12) << 32, a merge sequence number of 21111018390290435, the unblocking ledger 4915293, the merge in ledger 4915293.
2. AC-E4-S5-2: Then the known limits section covers pool shares, raised thresholds, claimable balances, contract accounts, mainnet, key management and each unclosable class, with the reason and what a user can do.
   - **Met.** Section 8 in three groups, as the integrator asked: by the SOW (every out-of-scope item of SOW section 4.1 with what Dustin does and what a user can do, and this release's own limits), by the protocol (every `UnclosableCode` and `BlockerCode` exported in `src/plan/model.ts`, with its meaning and remedy, plus `STEP_FAILED_TWICE`), and by the evidence (the testnet reset of 2026-12-16, the explorer links, what survives, the fresh fixtures, `--yes` in the recorded run, the two-fixture reading).
3. AC-E4-S5-3: Then a prior-art section covers the StellarExpert Demolisher, the archived js-stellar-wallets issue 98 and the other open-source demolisher repositories found during planning, stating what differs.
   - **Met.** Section 9: the StellarExpert Account Demolisher, js-stellar-wallets issue 98, the two SCF #44 awardees (LumenWipe and Account Demolisher), the unfunded scf-account-demolisher planner, and the two other repositories of `docs/edge-cases-and-test-matrix.md` U5 (Stellar-Account-Demolisher; account-demolisher, which was not reviewed during planning, so nothing is claimed about it). Each entry says what differs. Every project is named by its project name; the owner handles appear only in the URLs (canonical decision 15, PRD decision D-12). The Demolisher's stopping point on the baseline fixture stays a placeholder until the builder's recording (story E1-S2).

## Tasks / Subtasks

- [x] Task 1: read the SOW, the canonical decisions, the architecture's rules R1 to R9 and section 8, the PRD decisions D-1 to D-13, the test matrix and every committed run
- [x] Task 2: rules R1 to R9 with the metric close's steps, each with its link
- [x] Task 3: the ladder diagram as built and the failure mapping from `src/execute/classify.ts`
- [x] Task 4: the fee arithmetic from `plan.txt`, `report.json` and `tx-1.json` to `tx-3.json` of the CLI metric close
- [x] Task 5: the observed reserve release and the recorded sequence-guard wait
- [x] Task 6: known limits in three groups; prior art by project name and URL
- [ ] Task 7 (reconcile pass): check every statement that depends on the parallel work against the merged code of E4-S1 to E4-S3 (the hidden prompt, the interruption, D-10, the 404 on a re-run, `docs/errors.md`, the claimant warning, `RESET_SUSPECTED`, `evidence/tests/`)

## Dev Notes

- Every hash, ledger, fee and amount is copied from `evidence/runs/*/summary.md`, `report.json`, `tx-*.json`, `transcript.txt`, `plan.txt`, `plan.json`, `balances.json`, `docs/test-matrix.md` or a story record; the fee products (84,162 × 10, × 3, × 2) equal Horizon's `max_fee` of each transaction.
- Protocol facts reuse the links already verified in the first write-up and in `docs/research/raven-ground-truth.md`.
- The document map of the documentation plan named the write-up `docs/ordering-rules-and-known-limits.md`; the file is `docs/write-up.md`, the name in the story.

### References

- docs/epics-and-stories.md, Story 4.5; docs/prd.md FR-27
- docs/architecture.md sections 5.1, 5.2, 8; docs/documentation-plan.md section 3; docs/write-up-outline.md
- docs/README.md canonical decisions 3, 6, 7, 8, 10, 12, 13, 14, 15

## Dev Agent Record

### Completion Notes List

- 2026-09-28: `docs/write-up.md` final for 0.1.0. Placeholders left for the builder: the Demolisher recording and its stopping point (E1-S2), the 60-second video (E4-S6).

### File List

- `docs/write-up.md` (rewritten)
- `docs/stories/4-5-write-up.md` (new)

## Change Log

- 2026-09-28: final write-up. Status: review (the reconcile pass against E4-S1 to E4-S3 follows the merge).
