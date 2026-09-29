# Story 4.6: 60-second demo video

Status: in-progress

## Story

As the Ambassador Chapter Lead,
I want a 60-second video of a full close from the CLI,
so that I can see the tool work start to finish.

## Acceptance Criteria

As written in `docs/epics-and-stories.md` (Story 4.6):

1. AC-E4-S6-1: Then the video is at most 60 seconds and shows `dustin plan` on a freshly rebuilt messy fixture, the confirmation, `dustin close`, the receipt and the explorer page returning "account not found".
   - **Pending: human action by the builder.** The builder records the video by following `docs/demo-video-script.md`, which gives the setup, the commands in order (`dustin fixture create --profile messy`, `dustin fixture verify`, `dustin plan <G> --to <G> --sponsor <G>`, `dustin close <G> --to <G> --execute`, the typed confirmation, the explorer and Horizon pages), the 60-second cut and the reference values of the recorded CLI metric close to compare a take against.
2. AC-E4-S6-2: Then it is published (unlisted is acceptable) and linked from the README and `evidence/README.md`.
   - **Pending: human action by the builder.** The link slot is `<pending: builder records the 60-second video (E4-S6)>` in `evidence/demo/README.md`, the README's Demo section and the SOW 6.1 table of `evidence/README.md`.
3. AC-E4-S6-3: Then `evidence/demo/script.md` contains the shot list and exact commands so it can be re-recorded after a testnet reset.
   - **Met, with a deviation of path, decided by the builder (PRD decision D-14).** The rehearsal lives in `docs/demo-video-script.md`; `evidence/demo/README.md` points to it from the evidence directory. The shot list and the exact commands are in the script, and they run on a freshly built fixture, so the video can be re-recorded after a reset.

## Tasks / Subtasks

- [x] Task 1: the demo script as a rehearsal: setup, commands, reference values, the cut, the checklists (`docs/demo-video-script.md`)
- [x] Task 2: `evidence/demo/README.md` with the video slot and the pointer to the script
- [ ] Task 3: record, edit and upload the video — human action by the builder
- [ ] Task 4: fill the video link, duration and SHA-256 in `evidence/demo/README.md`, the README and `evidence/README.md` — the builder, after Task 3

## Dev Notes

- Shot 3 (the unsponsored attempt) has no Dustin command, and the script says so: it offers a frame of the baseline recording once it exists, the fixture builder's own logged probe ("Unbumped transaction from the fixture rejected with tx_insufficient_balance"), or cutting the shot.
- The recorded CLI metric close ran with `--yes` because a script drove it; the video shows the typed confirmation instead.
- The reference values (accounts, hashes, ledgers, the 75-line plan, the 166-line transcript, the 18-second run) are from `evidence/runs/20260928T112252Z-e3-cli/`; a fresh fixture gives new ones, and the script says to replace them.

### References

- docs/epics-and-stories.md, Story 4.6; docs/prd.md FR-28
- docs/ux-design.md section 4 (storyboard); SUCCESSFUL_SOW.md section 6.1 and Appendix B

## Dev Agent Record

### Completion Notes List

- 2026-09-28: rehearsal script and video slot written. The recording is the builder's.

### File List

- `docs/demo-video-script.md` (rewritten)
- `evidence/demo/README.md`, `docs/stories/4-6-demo-video.md` (new)

## Change Log

- 2026-09-28: rehearsal script and the video slot. Status: in-progress (AC-1 and AC-2 wait for the builder's recording).
- 2026-09-29: the script's reference transcript is the metric close on the 0.1.0 code (`evidence/runs/20260929T111408Z-e4-cli/`), and the three lines the independent review found wrong are fixed (`docs/reviews/2026-09-29-e4-review.md`, D-9): the "Unbumped" line is the last line of the build log on standard error, before the summary and the checks on standard output; `dustin plan` prints no unclosable line when there is none; the transcript's line count. The review ran the script as written on a fresh fixture, with the typed confirmation on a pseudo-terminal, and every other quoted line matched. The script's path is backed by PRD decision D-14. Status: in-progress (the video is the builder's).
