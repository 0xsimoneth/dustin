# The 60-second demo

SOW Deliverable 2 and the documentation row of SOW 6.1 ask for a 60-second video that shows the close from the CLI, start to finish (story E4-S6). The video was produced on 2026-09-29 from the rehearsal script by `scripts/demo/make-demo.mjs`, on a fresh `messy` fixture on the testnet; the builder watches it, approves it and hosts it. This page holds its record and, once it is hosted, its link.

| Field | Value |
|---|---|
| Video link | `<pending: builder approves and hosts the 60-second video (E4-S6)>`; proposed: the asset `dustin-demo-60s.mp4` of the `v0.1.0` GitHub release ([`docs/runbooks/release.md`](../../docs/runbooks/release.md), step 4) |
| File | `evidence/demo/dustin-demo-60s.mp4` on the machine that made it; ignored by git (`.gitignore`), 14,290,298 bytes |
| Duration | 0:59.8 (59.80 s) |
| Format | 1920 x 1080, H.264, 30 frames per second, no sound; it makes sense with the sound off |
| SHA-256 of the file | `7de0640d94ccc669efa14fdcc3d46af177874a79eaa76152c2f5ca16cdbc2f1b` |
| Captions | burned in on a band at the top, and the sidecar [`dustin-demo.srt`](dustin-demo.srt) |
| Recorded on (UTC) | 2026-09-29, 18:45 to 18:48 (the close in ledgers 4,936,816 to 4,936,818) |
| Fixture closed in the video | `messy-20260929T184553Z-26ba57`, account `GCJDPLX33KGDE23WETABGFZSGIUXTLTGCB3PN3RY2CLW3DTTE3VJ2PID` |
| Its three transactions | `c50b60c4f77dc7fbab436d0e7ec07ba6308fef878f7babff41846deb3c6957e9`, `84ae16b059145bc40e32cde955dc34f1c44815aab172e68afbca3e4a5b67f735`, `17ba87c58fc5c5849e3b9510c2ba607742c87f6c0d2dcd82bfc3ffda8d32e8f3` (on the end card) |
| CLI version shown | `dustin` 0.1.0, the build of the commit the take ran on |
| Record of the take | [`take-20260929T184550Z/summary.md`](take-20260929T184550Z/summary.md): the accounts and transactions with their links, Horizon's records, the cut shot by shot, the three terminal recordings and seven key frames |
| A short GIF | [`dustin-demo.gif`](dustin-demo.gif): the close from the confirmation to the receipt, 15.6 s, 955 x 731 |

![The close from the typed confirmation to the receipt](dustin-demo.gif)

## How it was made

The rehearsal script [`docs/demo-video-script.md`](../../docs/demo-video-script.md) is the shot list and the exact commands (the builder decided that the rehearsal lives there, PRD decision D-14; story E4-S6's criterion AC-E4-S6-3 names `evidence/demo/script.md`, and this pointer meets it). Its section "The automated take" says how `scripts/demo/make-demo.mjs` follows it: asciinema recordings of the real commands typed by `scripts/demo/take.exp`, browser pages captured with Playwright, the cut with agg and ffmpeg, every file scanned for secrets and local paths. It also lists the differences from a take by hand; the main one is that the browser shots come from Stellar Explorer (https://testnet.steexp.com) and Horizon, because StellarExpert's testnet explorer had stopped ingesting ledgers that day.

To make it again, after a testnet reset or to replace this take: `node scripts/demo/make-demo.mjs --playwright <directory where playwright is installed>` (about six minutes; a new `take-<stamp>/` directory). A take by hand, following the script, is equally valid.

## Before hosting: what the builder checks

- Watch it once with the sound off: every shot readable at 1080p, the captions in step with the picture.
- Check the frames for anything personal (none is expected: the prompt is `$ `, the pages were captured in a clean headless browser).
- Compare the SHA-256 above with the file being uploaded.

## The reference runs

The CLI metric close recorded on the 0.1.0 code on 2026-09-29 shows the same close from the command line, with `--yes` because a script drove it: [`../runs/20260929T111408Z-e4-cli/transcript.txt`](../runs/20260929T111408Z-e4-cli/transcript.txt) and [`../runs/20260929T111408Z-e4-cli/summary.md`](../runs/20260929T111408Z-e4-cli/summary.md). The first recording, of 2026-09-28, is [`../runs/20260928T112252Z-e3-cli/`](../runs/20260928T112252Z-e3-cli/summary.md).
