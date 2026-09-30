# Story 4.6: 60-second demo video

Status: review

## Story

As the Ambassador Chapter Lead,
I want a 60-second video of a full close from the CLI,
so that I can see the tool work start to finish.

## Acceptance Criteria

As written in `docs/epics-and-stories.md` (Story 4.6):

1. AC-E4-S6-1: Then the video is at most 60 seconds and shows `dustin plan` on a freshly rebuilt messy fixture, the confirmation, `dustin close`, the receipt and the explorer page returning "account not found".
   - **Met by the take of 2026-09-30, awaiting the builder's approval of the video.** `scripts/demo/make-demo.mjs` produced the video again from `docs/demo-video-script.md` on a freshly built messy fixture (`messy-20260930T170147Z-b5d6bd`): 59.8 s, 1920 x 1080, the account's page on StellarExpert's testnet explorer before the close (balances, data entry, sponsored reserve; its history with the two offers), the fixture build and its refused unsponsored transaction, `dustin plan`, `dustin close --execute` with the destination's last four characters typed, the three sponsor-paid transactions, the receipt, then the explorer page loaded again ("Account (deleted)", the merge first in its history) and Horizon's 404 "Resource Missing". Record: `evidence/demo/README.md` and `evidence/demo/take-20260930T170141Z/summary.md`. The take of 2026-09-29 (`evidence/demo/take-20260929T184550Z/`) is kept as a backup.
   - The deviation of the first take (its explorer pages came from Stellar Explorer and Horizon, because StellarExpert's testnet explorer had stopped ingesting ledgers on 2026-09-29) is gone: the builder decided on 2026-09-30 (decision K6 of the final audit brief) that the video be produced again with StellarExpert's pages once it was ingesting again. One difference remains from a take by hand: StellarExpert's "Active Offers" tab did not render on testnet on 2026-09-30, so the offers are shown by the account's history (`docs/demo-video-script.md`, "The automated take").
2. AC-E4-S6-2: Then it is published (unlisted is acceptable) and linked from the README and `evidence/README.md`.
   - **Pending: human action by the builder.** The builder watches and approves the video and hosts it; proposed: the asset `dustin-demo-60s.mp4` of the `v0.1.0` release (`docs/runbooks/release.md`, step 4). The link slot is `<pending: builder approves and hosts the 60-second video (E4-S6)>` in `evidence/demo/README.md`, the README's Demo section, the SOW 6.1 table of `evidence/README.md` and the completion report. The README already shows the GIF of the close (`evidence/demo/dustin-demo.gif`).
3. AC-E4-S6-3: Then `evidence/demo/script.md` contains the shot list and exact commands so it can be re-recorded after a testnet reset.
   - **Met, with a deviation of path, decided by the builder (PRD decision D-14).** The rehearsal lives in `docs/demo-video-script.md`; `evidence/demo/README.md` points to it from the evidence directory. The shot list and the exact commands are in the script, and they run on a freshly built fixture, so the video can be re-recorded after a reset.

## Tasks / Subtasks

- [x] Task 1: the demo script as a rehearsal: setup, commands, reference values, the cut, the checklists (`docs/demo-video-script.md`)
- [x] Task 2: `evidence/demo/README.md` with the video slot and the pointer to the script
- [x] Task 3: record and edit the video: `scripts/demo/make-demo.mjs` (asciinema and `scripts/demo/take.exp` for the terminal, Playwright for the pages, agg and ffmpeg for the cut), the take of 2026-09-29
- [x] Task 3c: the video produced again with StellarExpert's pages, the first take kept as a backup (2026-09-30, the builder's decision K6)
- [ ] Task 3b: approve and upload the video — human action by the builder
- [x] Task 4a: the duration, the SHA-256, the captions, the fixture and its transactions in `evidence/demo/README.md`
- [ ] Task 4b: the video link in `evidence/demo/README.md`, the README, `evidence/README.md` and the completion report — the agent, once the builder has hosted it (`docs/runbooks/release.md`, step 5)

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
- 2026-09-29: the video produced by `scripts/demo/make-demo.mjs` from the rehearsal script on a fresh fixture (take `evidence/demo/take-20260929T184550Z/`): 59.8 s, 1920 x 1080, captions burned in and as `.srt`, a GIF of the close, seven key frames and the three terminal recordings committed; the MP4 ignored by git. The explorer shots come from Stellar Explorer and Horizon, since StellarExpert's testnet ingestion had stopped. Status: review (the builder approves and hosts the video; then its link, and done).
- 2026-09-30: the video produced again (take `evidence/demo/take-20260930T170141Z/`, SHA-256 `6d2fe4c0afc2be94cb2b5cf056fcda4c1bb5a314a34903d87cda13b8538740dc`, 59.8 s) with the browser shots from StellarExpert, which was ingesting again, as the storyboard asks (the builder's decision K6); the first take's MP4 is kept off git as `evidence/demo/dustin-demo-60s-take-20260929T184550Z.mp4`, its captions and GIF in its take directory. Status stays review until the builder approves and hosts the video.
