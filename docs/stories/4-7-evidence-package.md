# Story 4.7: Evidence package and SOW tracker

Status: in-progress

## Story

As the Ambassador Chapter Lead,
I want one page that maps every SOW evidence row to a link,
so that I can complete the verification checklist by clicking.

## Acceptance Criteria

As written in `docs/epics-and-stories.md` (Story 4.7):

1. AC-E4-S7-1: Then `evidence/README.md` maps every SOW 6.1 row and every Appendix B row to artifacts with links: repository, committed plan output, receipts with hashes to explorer pages, the closed account's explorer page, the baseline recording, test screenshots, the write-up and the demo.
   - **Met for every artifact that exists; two are pending, human action by the builder.** `evidence/README.md` opens with a plain-language checklist mirroring SOW 6.2 (`docs/documentation-plan.md` section 7), then the SOW 6.2 table left unticked for the chapter lead, SOW 6.1 row by row, Appendix B row by row (the table of story E3-S7 kept exact), the transaction chain of the metric close with explorer and Horizon links, the accounts, the before and after of the fixture and its build transactions, the other recorded runs, the test output, and what survives a testnet reset. The baseline recording and the demo are placeholders (`<pending: ...>`) in a table of the builder's pending actions, never marked done. The test screenshots are story E4-S3's `evidence/tests/`, linked from the package.
2. AC-E4-S7-2: Then the Appendix A tracker is reproduced with status and evidence links for D1 to D4.
   - **Met.** The calendar and the tracker, with D1 and D2 done, D3 and D4 in progress, each naming what is pending. The same statuses and links are in `SUCCESSFUL_SOW.md` Appendix A, and the seven Appendix B boxes there are ticked with their evidence links (the only change to the SOW).
3. AC-E4-S7-3: Then `npm run evidence:check` verifies every link resolves and every listed hash exists on Horizon.
   - **Written by story E4-S3 (`scripts/evidence-check.mjs`), not by this record.** The package names the command in its section "Checking this page"; its run on the merged package is part of the reconcile pass.

Also written for this story: `evidence/completion-report.md`, the draft of the completion report from `docs/next-steps/instaward-completion-report-template.md`, for the builder to finish and send.

## Tasks / Subtasks

- [x] Task 1: `evidence/README.md` rewritten as the evidence package (AC-1, AC-2)
- [x] Task 2: `SUCCESSFUL_SOW.md` Appendices A and B (AC-2); each Appendix B box checked against `evidence/README.md` before it was ticked
- [x] Task 3: `evidence/completion-report.md`, the draft for the builder
- [ ] Task 4: the baseline recording and the video linked — human action by the builder (E1-S2, E4-S6)
- [ ] Task 5 (reconcile pass): run `npm run evidence:check` on the merged package (AC-3) and check the statements that depend on stories E4-S1 to E4-S3

## Dev Notes

- Every figure is copied from the committed run directories; the capture record names the code commit (`d6cd66ef8d7fcf0e46163667e1a13c20c1f02d6a`) and the commit that recorded the run (`562d5420b0002ec3af32b788a6d1826c72e10d45`).
- The files under `evidence/runs/` are historical records and were not edited; the package links to them.
- The template's screenshot list (`evidence/screenshots/`) does not exist in this repository; the package links the JSON, XDR and transcripts that do, and the builder's screenshots of the take are listed in the demo script's checklist.

### References

- docs/epics-and-stories.md, Story 4.7; docs/prd.md FR-29
- docs/evidence/evidence-package-template.md; docs/documentation-plan.md section 7; docs/next-steps/instaward-completion-report-template.md
- SUCCESSFUL_SOW.md sections 6.1, 6.2, Appendix A and Appendix B

## Dev Agent Record

### Completion Notes List

- 2026-09-28: evidence package, SOW appendices and the completion report draft written. Pending, the builder's: the baseline recording (B-01, B-02, then B-03), the video, the npm publish, the chapter lead's acknowledgement of the two-fixture reading, the hours and the next step in the completion report.

### File List

- `evidence/README.md`, `SUCCESSFUL_SOW.md` (Appendices A and B only)
- `evidence/completion-report.md`, `docs/stories/4-7-evidence-package.md` (new)

## Change Log

- 2026-09-28: evidence package, SOW tracker and the completion report draft. Status: in-progress (the baseline recording and the video are the builder's; AC-3 follows the merge of E4-S3).
