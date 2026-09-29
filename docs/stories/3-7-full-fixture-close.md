# Story 3.7: Full messy fixture close on testnet, recorded

Status: done

## Story

As the Ambassador Chapter Lead,
I want the messy fixture account closed and merged with a linkable transaction chain,
so that the binary success metric is met.

## Acceptance Criteria

As written in `docs/epics-and-stories.md` (Story 3.7):

1. AC-E3-S7-1: Given the fixture verified by `fixture:verify` immediately before, when `dustin plan` runs with the drain destination, then the plan shows 2 offer cancellations, 1 data deletion, LIQ path-payment, RET issuer-return, ILQ destination-transfer, SPN issuer-return, 4 trustline removals (one sponsored) and the merge; and `dustin plan` with a destination that does not trust ILQ shows ILQ as unclosable; both outputs are committed under `evidence/plan/`.
2. AC-E3-S7-2: When `dustin close --yes` runs, then every transaction succeeds, every one is a fee bump with the sponsor as fee account, and `GET /accounts/{fixture}` returns 404.
3. AC-E3-S7-3: Then the drain account received 4.0 XLM plus the LIQ proceeds, the fixture sponsor's `num_sponsoring` is 0, and the receipt, the CLI transcript and explorer links are stored in `evidence/closes/fixture-<date>/`.
4. AC-E3-S7-4: Then Appendix B rows 5 to 7 (all fees sponsored, account gone, chain linkable) are checked in `evidence/README.md` with links.

Two closes were recorded on 2026-09-28 with the complete Epic 3 code (commit 8cdf5b8: the ladder, the sponsored unwind with the observed release, the sequence-guard wait and the review round 3 fixes), both with the default ladder order (the SOW order, canonical decision 8), each on a fresh `messy` fixture built from Friendbot with throwaway keys:

- `evidence/runs/20260928T112239Z-e3/`: through the SDK, by `test/testnet/execute-close.test.ts` with `DUSTIN_EVIDENCE=1 DUSTIN_EVIDENCE_LABEL=e3`.
- `evidence/runs/20260928T112252Z-e3-cli/`: through the CLI, by `scripts/evidence-cli-close.mjs` (`dustin fixture create`, `dustin fixture verify`, the dry-run `dustin plan`, then `dustin close --execute --yes --report`). That script was replaced afterwards by `scripts/evidence-cli.mjs` (commit `d473913`), whose case `metric` (label `e3-cli`) runs the same close; the run above was recorded with the earlier script.

The builder's baseline fixture `messy-20260926T035942Z` was not touched: it is kept for the Demolisher recording (E1-S2), and closing that same account with Dustin follows the recording (matrix row B-03).

How each AC is met:

- **AC-1: met, with documented deviations.**
  - Both runs verified the fixture right before the close: all 12 checks passed, among them the four SOW Appendix B preconditions (zero spendable XLM: balance 4.0000000 = minimum 4.0000000; 4 trustlines with a balance; 2 open offers; 1 data entry). Files: `fixture-verification.json` in each run directory.
  - The dry-run plan of each fixture is committed next to its close (`plan.txt` and `plan.json` in both run directories; the CLI run's `plan.txt` is the output of `dustin plan <fixture> --to <destination> --sponsor <sponsor>`). It shows 2 offer cancellations, 1 data deletion, DUSTA sold by path payment, DUSTB, DUSTC and SPTA returned to their issuer (burned), 4 trustline removals of which SPTA's is sponsored (its 0.5 XLM reserve returns to the reserve sponsor), and the merge, in 3 fee-bumped transactions (canonical decision 6).
  - Deviation (asset names): the fixture recipe of `docs/edge-cases-and-test-matrix.md` section 5.2 is the one built (canonical decision 3): DUSTA plays LIQ, DUSTB plays RET, DUSTC is the asset the destination trusts, SPTA plays SPN.
  - Deviation (DUSTC's route): in the default SOW order DUSTC is returned to its issuer and the transfer to the destination stays its fallback (canonical decision 8). The destination transfer is used with `--prefer-destination`, which was proven live on 2026-09-28 (E3-S2 AC-2, `test/testnet/ladder.test.ts`, docs/stories/3-2-ladder-issuer-destination-unclosable.md).
  - Deviation (the unclosable plan): "a destination that does not trust ILQ shows ILQ as unclosable" does not hold: a payment to its issuer burns an authorized balance even when the issuer account is gone (day-1 experiment 4, docs/README.md open question 3). Unclosable balances were shown live on other accounts instead: a trustline its issuer deauthorized (`TRUSTLINE_NOT_AUTHORIZED`, matrix S-02, `test/testnet/edge.test.ts`) and a balance whose issuer requires a memo when no memo is given (`NO_DISPOSAL_ROUTE`, E3-S2 AC-3, `test/testnet/ladder.test.ts`).
  - Deviation (path): the plan outputs sit in the run directories rather than `evidence/plan/`, which keeps the D1 plan of the baseline fixture (2026-09-26).
- **AC-2: met.** CLI run: `dustin close ... --execute --yes --report` exited 0; all 3 transactions applied (ledgers 4914209, 4914210, 4914211); Horizon shows the fee sponsor as `fee_account`, the closed account as `source_account` and inner `max_fee` 0 for each (`tx-1.json` to `tx-3.json`); `GET /accounts/GCPPFHGLKA7GCBWJXBH4EXFXS3OXAMXFLOBAZLU2K3KKMO6JKZORNFW7` answered 404 (`account-after.json`). The SDK run shows the same for its 3 transactions (ledgers 4914192 to 4914194) and its account `GCSK3ODHZH7O3PFMV676GEMKRIW34UHUET57HRNTRQV2RSB73JVOPCCT`.
- **AC-3: met, with a documented deviation of the path.** In both runs the destination received exactly 4.0000007 XLM: the 4.0000000 XLM the fixture held plus the 0.0000007 XLM of the DUSTA sale, read from the merge result and confirmed by the destination's balance (10.0000000 to 14.0000007). The reserve sponsor's `num_sponsoring` went from 1 to 0 and its minimum balance from 1.5 to 1.0 XLM with its XLM balance unchanged, as the report's new `recovery.sponsorsObserved` records and the receipt prints ("Reserves released to sponsors: 0.5000000 XLM ... observed on Horizon: num_sponsoring 1 -> 0"). The receipt and the CLI transcript are `transcript.txt`, the report is `report.json`, and every explorer link is in `summary.md`. The directory is `evidence/runs/<UTC stamp>-e3-cli/` rather than `evidence/closes/fixture-<date>/` (builder decision D-4 in the PRD).
- **AC-4: met.** `evidence/README.md` (new) lists SOW Appendix B rows 1 to 7 with links to these runs; rows 5 to 7 are checked.

## Tasks / Subtasks

- [x] Task 1: evidence runs carry a label and the approved plan (`test/helpers/evidence.ts`: `<stamp>-<label>`, `plan.json`, `plan.txt`, a "Disposal ladder" table of planned and applied rungs; tests in `test/unit/helpers/evidence.test.ts`)
- [x] Task 2: a reproducible CLI evidence run (`scripts/evidence-cli-close.mjs`), tried once on a throwaway fixture that was not kept
- [x] Task 3: SDK close with evidence (`evidence/runs/20260928T112239Z-e3/`)
- [x] Task 4: CLI close with evidence and transcript (`evidence/runs/20260928T112252Z-e3-cli/`)
- [x] Task 5: `evidence/README.md` with the Appendix B checklist
- [x] Task 6, moved on 2026-09-28: closing the builder's baseline fixture itself follows the Demolisher recording and is the builder's call (story E1-S2 and matrix row B-03). The builder reserved that account for the recording, so this story's closes ran on fresh fixtures built from the same recipe (canonical decision 3), and every acceptance criterion is shown on them.

### Closing review (2026-09-28)

The closing review of Epic 3 (edge-case review of the CLI CC, acceptance audit CA). The evidence tooling was fixed by agent G and merged in `9465a30`; the findings that concern this story:

- [x] [Review][Patch] CC-3 to CC-7, CC-4 = CA-19 `scripts/evidence-cli.mjs <case> [label]` replaces `scripts/evidence-cli-close.mjs`: it checks the case and the label before anything runs, stages the run in a temporary directory, checks every exit code against the case, scans every staged file for secret seeds and for each fixture secret before the run is moved into `evidence/runs/`, keeps what was gathered with `FAILED.md` when a step fails after a submission, and reads an envelope Horizon does not know as "not on the ledger" in `summary.md`. Its case `metric` is this story's CLI close; the cases `edge-frozen`, `memo-partial` and `seq-wait` record the artifacts of CA-5, CA-4 and CA-3 (`d473913`)
- [x] [Review][Patch] CC-11 The live close checks its evidence label before it builds a fixture, so a label the writer would refuse fails in milliseconds instead of after the close has spent the fixture (`assertEvidenceLabel` in `test/helpers/evidence.ts`, called first by `test/testnet/execute-close.test.ts`) (`611bffd`)
- [x] [Review][Patch] CA-9 Task 6 moved to the builder (story E1-S2, matrix row B-03), recorded above by the integrator

## Dev Notes

- Every transaction of both closes is a fee bump paid by the fee sponsor; the closed accounts paid 0 (canonical decision 7; CAP-15, https://github.com/stellar/stellar-protocol/blob/master/core/cap-0015.md).
- The sponsored trustline was removed by the owner alone; its reserve went back to the reserve sponsor, which signed nothing (sponsored reserves, https://developers.stellar.org/docs/build/guides/transactions/sponsored-reserves#effect-on-minimum-balance; day-1 experiment 3).
- Returning an asset to its issuer burns it (https://developers.stellar.org/docs/learn/fundamentals/stellar-data-structures/assets#deleting-or-burning-assets).
- The merge is the last operation, alone in the last transaction after a fresh preflight, because a market-dependent sale precedes it (canonical decision 6; https://developers.stellar.org/docs/learn/fundamentals/transactions/list-of-operations#account-merge).
- Explorer links stop resolving at the testnet reset scheduled for 2026-12-16; the JSON and XDR in the run directories are the durable record (canonical decision 12).

### References

- docs/epics-and-stories.md, Story 3.7; SUCCESSFUL_SOW.md section 3 (success metric) and Appendix B; docs/README.md canonical decisions 3, 6, 7, 8, 12 and open question 3
- docs/stories/3-1-ladder-path-payment.md, 3-2-ladder-issuer-destination-unclosable.md, 3-3-sponsored-trustline-unwind.md, 3-4-seqnum-too-far-guard.md
- evidence/runs/README.md

## Dev Agent Record

### Completion Notes List

- SDK run, fixture messy-20260928T112138Z-f08060: account GCSK3ODHZH7O3PFMV676GEMKRIW34UHUET57HRNTRQV2RSB73JVOPCCT, destination GBGZBVYU37JVDVYKNGX3IZJNNXELMNXCRLIE7IKKF3JNM2JAUYM554OV, fee sponsor GAOJTIMBWLVJJDXDTZZEQJ4Z6GQIFGJS2YQKWNVQYQGKGBFDCBVNBYER, reserve sponsor GBTG2YJPCWRPXSRQBPHWJS2QR6AIR2BCFWFJCZLSVGDLUTQWCB6CZJVH. Cleanup `55a12730e24961e27a9e089fc0d542f6416a1d3d0efc125b47b962907a16593f` (ledger 4914192), sale `6e0e882060a280925e2dc23b099182624d63d95b04fcd51bb38eefbff49f6449` (4914193), merge `7335c6225593513ceee297b626eadc03bf1d9ee40256e2162b039edb245faac6` (4914194). 4.0000007 XLM merged; sponsor fees 1,500 stroops.
- CLI run, fixture messy-20260928T112252Z-580d8f: account GCPPFHGLKA7GCBWJXBH4EXFXS3OXAMXFLOBAZLU2K3KKMO6JKZORNFW7, destination GDPZI3OAYYEAXTYY2OHFDZAEEG4PXNBN7AHNLQTEH22O5HTBGBSVB2TS, fee sponsor GBCHRHGJMTMA2MNEVJWZL5GRYXQ3OF5CRKVMZHPFPASSW2DBLPQFEHOG, reserve sponsor GCFMPHR7TIPDOYD2UHXSE2PLWIMFYIEWC2NQ3N4RKLSSDVXODU5REILD. Cleanup `0ee9fb5e4bb683519af3190e45c6e0350a0819aa509d65fddb34a247e65dcaac` (4914209), sale `f7161ce4667cc9b3457aa6daa948f8b39df847b0576ab73849ac7325ad81f700` (4914210), merge `36e53646514a36c673830955b661b91de297842481295f458de8c5911e5c989c` (4914211). Exit code 0; 4.0000007 XLM merged; sponsor fees 1,500 stroops.
- No file in either directory holds a seed-shaped string or any of the fixtures' secrets (checked by the writers before writing, and by the CI scan pattern afterwards).

### File List

- evidence/runs/20260928T112239Z-e3/ (new), evidence/runs/20260928T112252Z-e3-cli/ (new), evidence/README.md (new), evidence/runs/README.md
- scripts/evidence-cli-close.mjs (new; replaced by scripts/evidence-cli.mjs in commit `d473913`, closing review)
- test/helpers/evidence.ts, test/unit/helpers/evidence.test.ts, test/testnet/execute-close.test.ts

## Change Log

- 2026-09-28: SDK and CLI metric closes recorded with the complete Epic 3 code; evidence index. Status: review (the deviations in AC-1 and AC-3 need the builder's acceptance; the baseline fixture's own close waits for the Demolisher recording).
- 2026-09-28: closing review of Epic 3 (record updated by the documentation pass): the CLI evidence script is now `scripts/evidence-cli.mjs` (case `metric`; CC-3 to CC-7, CA-19), the live close checks its label first (CC-11), with their commits in the section "Closing review (2026-09-28)". The recorded runs are unchanged.
- 2026-09-28: Status: done (`docs/reviews/2026-09-28-e3-review.md`, verdicts). The deviations follow canonical decision 3 (AC-1) and the evidence layout the builder accepted in D-4 and PRD sections 12.1 and 12.2 (AC-3); the baseline fixture's own close is matrix row B-03, after the recording.
