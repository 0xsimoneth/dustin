# The 60-second demo

SOW Deliverable 2 and the documentation row of SOW 6.1 ask for a 60-second video that shows the close from the CLI, start to finish (story E4-S6). The video was produced again on 2026-09-30, from the rehearsal script by `scripts/demo/make-demo.mjs`, on a fresh `messy` fixture on the testnet, with its browser shots from StellarExpert's testnet explorer as the storyboard asks (the builder's decision K6 of 2026-09-30); the first take, of 2026-09-29, is kept as a backup (below). The builder watches the video, approves it and hosts it. This page holds its record and, once it is hosted, its link.

| Field | Value |
|---|---|
| Video link | `<pending: builder approves and hosts the 60-second video (E4-S6)>`; proposed: the asset `dustin-demo-60s.mp4` of the `v0.1.0` GitHub release ([`docs/runbooks/release.md`](../../docs/runbooks/release.md), step 4) |
| File | `evidence/demo/dustin-demo-60s.mp4` on the machine that made it; ignored by git (`.gitignore`), 14,602,476 bytes |
| Duration | 0:59.8 (59.80 s) |
| Format | 1920 x 1080, H.264, 30 frames per second, no sound; it makes sense with the sound off |
| SHA-256 of the file | `6d2fe4c0afc2be94cb2b5cf056fcda4c1bb5a314a34903d87cda13b8538740dc` |
| Captions | burned in on a band at the top, and the sidecar [`dustin-demo.srt`](dustin-demo.srt) (the same seven captions as the first take) |
| Recorded on (UTC) | 2026-09-30, 17:01:41 to 17:05:30 (the three terminal recordings; the close in ledgers 4,952,864 to 4,952,868), the pages after it right after |
| Fixture closed in the video | `messy-20260930T170147Z-b5d6bd`, account `GC6ZX4GCHOHZBSNKMPNSPO2FXNBVRVSPUOMCN5KP7JIJZDRMF2XUAACV` |
| Its three transactions | `5cadb010d1a463cb3d115caf0614eb1b31b6c9ee47d8d5994e69d56e538bec4e`, `1a4acd278f77f10f6ad344499c53f144ac56f9a703780d66e16a94d03c5a1ef4`, `3b6bd13146034ea60e6b74a496fff40071af68dd7ef39a30ee474af823ca2e50` (on the end card) |
| The browser shots | Before the close: the account on StellarExpert, its balances (4 XLM and the four dust balances), its data entry and the sponsored reserve, then its history with the two offers and the data entry being created. After it: the same page loaded again, "Account (deleted)" with the merge first in its history, then Horizon's 404 "Resource Missing" |
| CLI version shown | `dustin` 0.1.0, the build of the commit the take ran on |
| Record of the take | [`take-20260930T170141Z/summary.md`](take-20260930T170141Z/summary.md): the accounts and transactions with their links, Horizon's records, the cut shot by shot, the three terminal recordings and eight key frames |
| A short GIF | [`dustin-demo.gif`](dustin-demo.gif): the close from the confirmation to the receipt, 19.5 s, 955 x 731 |

![The close from the typed confirmation to the receipt](dustin-demo.gif)

## The first take, kept as a backup

The take of 2026-09-29 ([`take-20260929T184550Z/summary.md`](take-20260929T184550Z/summary.md)) showed the same close on another fresh fixture, with its browser shots from Stellar Explorer (https://testnet.steexp.com) and Horizon, because StellarExpert's testnet explorer had stopped ingesting ledgers that day. Its video is kept, not in git, as `evidence/demo/dustin-demo-60s-take-20260929T184550Z.mp4` on the machine that made it (14,290,298 bytes, 59.80 s, SHA-256 `7de0640d94ccc669efa14fdcc3d46af177874a79eaa76152c2f5ca16cdbc2f1b`); its captions and GIF moved into its take directory on 2026-09-30. It stays usable if the builder prefers it.

## How it was made

The rehearsal script [`docs/demo-video-script.md`](../../docs/demo-video-script.md) is the shot list and the exact commands (the builder decided that the rehearsal lives there, PRD decision D-14; story E4-S6's criterion AC-E4-S6-3 names `evidence/demo/script.md`, and this pointer meets it). Its section "The automated take" says how `scripts/demo/make-demo.mjs` follows it: asciinema recordings of the real commands typed by `scripts/demo/take.exp`, browser pages captured with Playwright, the cut with agg and ffmpeg, every file scanned for secrets and local paths. It also lists the differences from a take by hand; since the second take the browser shots are StellarExpert's, as the storyboard asks, except that its "Active Offers" tab did not render on testnet on 2026-09-30, so the offers are shown by the history of their creation.

To make it again, after a testnet reset or to replace this take: `node scripts/demo/make-demo.mjs --playwright <directory where playwright is installed>` (about six minutes; a new `take-<stamp>/` directory; move the current `dustin-demo-60s.mp4` aside first, since the new take writes over it). A take by hand, following the script, is equally valid.

## Before hosting: what the builder checks

- Watch it once with the sound off: every shot readable at 1080p, the captions in step with the picture.
- Check the frames for anything personal (none is expected: the prompt is `$ `, the pages were captured in a clean headless browser).
- Compare the SHA-256 above with the file being uploaded.

## The reference runs

The CLI metric close recorded on the 0.1.0 code on 2026-09-29 shows the same close from the command line, with `--yes` because a script drove it: [`../runs/20260929T111408Z-e4-cli/transcript.txt`](../runs/20260929T111408Z-e4-cli/transcript.txt) and [`../runs/20260929T111408Z-e4-cli/summary.md`](../runs/20260929T111408Z-e4-cli/summary.md). The first recording, of 2026-09-28, is [`../runs/20260928T112252Z-e3-cli/`](../runs/20260928T112252Z-e3-cli/summary.md).
