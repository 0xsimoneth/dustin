# Story 1.2: Record the baseline run of the existing tool

Status: in-progress

## Story

As a reviewer,
I want a recording of StellarExpert's Account Demolisher run against the messy fixture,
so that the gap Dustin closes is something I can watch rather than take on trust.

## Acceptance Criteria

1. Given the messy fixture verified immediately before, when the Demolisher testnet page is driven with that account, then a screen recording of the whole session is stored in `evidence/baseline/` (file, or a link if it is too large for git) with a `README.md` timeline.
2. Then the README states where the tool stopped (the exact message shown), the fixture state after the run (`fixture verify` snapshot) and which fixture items remained.
3. Then the README links the tool's URL, source location and license, and repeats claims about the tool only where the recording or the source confirms them; anything not confirmed is marked "not reproduced".
4. Then `dustin fixture verify` still passes after the run, so Dustin later closes the same, unchanged account (PRD FR-25).

## Tasks / Subtasks

- [x] Task 1: recording protocol and fixture details in `evidence/baseline/README.md` (AC: 1, 3)
- [ ] Task 2: `verify-before.json` snapshot, the recording and its still frame (AC: 1) — human action by the builder
- [ ] Task 3: `verify-after.json` snapshot and the filled Result table (AC: 2, 4)

## Dev Notes

- Fixture `messy-20260926T035942Z` (built by E1-S1). Its keys are in the gitignored `.fixture/` directory; the fixture secret is pasted into the Demolisher only, on testnet only.
- The below-1-XLM co-sign refusal was already probed on 2026-09-25 (docs/analysis/competitive-landscape.md); the recording should show whatever the tool actually does on this fixture.
- The recording is made by the builder; the agent prepares the protocol and fills the README from the snapshots afterwards.

### References

- docs/epics-and-stories.md, Story 1.2
- docs/prd.md FR-25
- docs/technical-spike.md section 7

## Dev Agent Record

### Agent Model Used

dev-story workflow (AI developer agent)

### Completion Notes List

- 2026-09-26: protocol written; waiting for the builder's recording.

### File List

- `evidence/baseline/README.md` (new)
- `docs/stories/1-2-baseline-recording.md` (new)

## Change Log

- 2026-09-26: Recording protocol prepared. Status: in-progress (blocked on the builder's recording).
