---
title: Dustin 60-second demo, shot list and recording checklist
status: draft
owner: the builder
aligns with: docs/ux-design.md section 4 (storyboard), SUCCESSFUL_SOW.md section 3 (binary success metric), Appendix B
---

# Dustin demo video script (60 seconds)

The video has one job: let a viewer with no Stellar knowledge see the messy account, see the plan, see the sponsor paying, and see the account disappear. It shows the same close that the evidence package links to, so every address and hash on screen must match `docs/evidence/README.md`.

## What the video has to prove

The SOW success metric is binary. Each checkbox in SOW Appendix B is covered by a specific shot, so a reviewer can tick the list from the video alone.

| SOW Appendix B checkbox | Proven in shot | How it is visible |
|---|---|---|
| Fixture holds zero spendable XLM | 2 | Explorer balance panel: 4 XLM, "available 0" or equivalent; caption says it |
| At least 3 trustlines with non-zero balances | 2 | Four asset lines with balances |
| At least 1 open offer | 2 | Offers tab shows 2 |
| At least 1 data entry | 2 | Data tab shows 1 |
| Every transaction fee-bumped by the sponsor | 6 and 7 | "fee paid by sponsor" on each transaction line; report says "fees paid by the closed account: 0" |
| The account no longer exists on a public explorer | 8 | Explorer page after reload, then Horizon 404 |
| Full transaction chain linkable | 6 and 9 | Three hashes with explorer links; end card repeats them |

## Shot list

Format: 1920 x 1080, 16:9, 60 seconds or less, burned-in captions plus a sidecar `.srt`. Voice-over is optional; if it is not recorded, the captions carry the full message.

| Time | Shot | On screen | Caption (burned in) | Voice-over |
|---|---|---|---|---|
| 0:00 - 0:05 | 1. Title card | "Dustin", the fixture address in full, "Stellar testnet" | This Stellar account holds 4 XLM but cannot spend any of it, so it cannot even pay the fee to close itself. | Stellar accounts lock XLM as reserve for every asset, offer and data entry they hold. This one holds four XLM and can spend none of it. |
| 0:05 - 0:13 | 2. Browser, explorer page of the fixture, before | Balances: 4 XLM and four assets with balances; offers tab: 2; data tab: 1; the address is visible in the URL bar | Before: 4 trustlines with balances, 2 open offers, 1 data entry. All 4 XLM are locked as reserve. | Four trustlines with balances, two open offers, one data entry. Every one of them has to go before the account can be merged, and the account cannot pay for any of it. |
| 0:13 - 0:16 | 3. Terminal, the unsponsored attempt | The first transaction failing for lack of fee (Dustin's baseline command or a plain submission), one line of error | Without a sponsor, the first transaction fails: the account cannot pay a fee. | Try it the normal way and the very first transaction fails. No fee, no teardown. |
| 0:16 - 0:26 | 4. Terminal, `dustin plan` | `dustin plan <fixture> --to <destination>`; the step table; slow zoom on the reason column; the summary block | The plan is read-only. Every step has a reason. Nothing is signed yet. | Dustin first reads the account and prints a plan: cancel the offers, move the leftover balances out, remove the trustlines and the data entry, then merge. Every step has a reason and a fee. Nothing has been signed. |
| 0:26 - 0:31 | 5. Terminal, confirmation | `dustin close <fixture> --to <destination>` followed by the confirmation block naming the destination and the sponsor; the user types the confirmation | To run it, you confirm the destination. That proves you read it. | To execute, you confirm the destination. The sponsor account named here will pay every fee. |
| 0:31 - 0:44 | 6. Terminal, execution (ledger waits cut, timestamps kept) | tx 1 confirmed, tx 2 confirmed, tx 3 confirmed; each line with the hash, the ledger and an explorer link; "fee paid by sponsor" on each | Three transactions. Every fee is paid by the sponsor. The closed account pays nothing. | Three transactions go out. Each one is signed by the account and wrapped in a fee bump paid by the sponsor. Watch the ledger numbers: this is live on testnet. |
| 0:44 - 0:49 | 7. Terminal, the report | Verdict CLOSED; destination received `<amount>` XLM; sponsor paid `<fee>` XLM in fees; fees paid by the closed account: 0 | Result: 4 XLM arrived at the destination. Fees paid by the account: zero. | Four XLM arrived at the destination. The account paid nothing. |
| 0:49 - 0:56 | 8. Browser, after | Reload the fixture page: the merge is the last operation; then the Horizon URL for the fixture: a 404 response | After: the account no longer exists. Anyone can check this link. | Reload the explorer: the last operation is the merge. Ask the network directly: not found. The account is gone. |
| 0:56 - 1:00 | 9. End card | Repository URL, the three transaction hashes, "testnet only" | Dustin. Read the plan, then close the account. Testnet only. | Dustin. Read the plan, then close the account. Testnet only, for now. |

Total: 60 seconds. If the run takes more than 13 seconds of real time in shot 6, cut the waits between confirmations and keep the timestamps and ledger numbers on screen so the run is evidently real. Do not speed up the typing in shot 5.

## Recording checklist

### Before the day

- [ ] Build two fixtures, A and B, with the fixture builder, and verify both against the SOW list (zero spendable XLM, 3 trustlines with dust plus 1 sponsored, 2 offers, 1 data entry). A close is irreversible, so the backup take needs its own account; there is no second take on the same address.
- [ ] Record the baseline (existing tool) against fixture A before Dustin touches it, or against a third identical fixture, and note which.
- [ ] Fund the sponsor from friendbot; confirm it holds enough for all fee bumps plus its own reserve.
- [ ] Run `dustin plan` on both fixtures and check the plan reports zero blockers; a video that ends in PARTIAL does not meet the metric.
- [ ] Freeze the CLI build: the version in the video is the version published to npm.
- [ ] Copy the fixture A address, the destination address and the sponsor address into the evidence package draft; they must match the video.

### Terminal

- [ ] Window exactly 120 columns wide, so no plan row wraps; height enough for the plan table plus the summary.
- [ ] Monospace font at 18 point or larger; high-contrast light theme (compresses better than dark); confirm legibility on a phone-sized preview.
- [ ] Prompt reduced to `$ ` (no user name, host name or directory in the prompt).
- [ ] `clear` before each shot; shell history and autocomplete suggestions off.
- [ ] Secrets loaded by sourcing a local env file before recording starts. Never type or echo `DUSTIN_ACCOUNT_SECRET` or `DUSTIN_SPONSOR_SECRET` on camera. Dustin itself never prints secrets; check the plan and report output once more for anything that looks like an `S...` key.
- [ ] Colour on for the recording (status words still carry the meaning, per the CLI style guide).
- [ ] Notifications, clocks with personal calendars, and dock or taskbar badges hidden.

### Browser

- [ ] A clean profile with no bookmarks bar, no extensions visible, no other tabs' titles readable.
- [ ] Pre-opened tabs, in order: fixture account explorer page (before), the offers tab, the data tab, the fixture Horizon JSON, the destination account page. After the run, the three transaction pages open from the terminal links.
- [ ] Zoom 125 percent so balances read at 1080p.
- [ ] Reload the fixture page on camera in shot 8; do not cut to a pre-loaded "after" tab.

### Capture

- [ ] Screen recorder at 1920 x 1080, 60 fps if the machine can hold it, otherwise 30 fps; system audio off; microphone only if voice-over is recorded live.
- [ ] Record the terminal and the browser as one continuous take per fixture. Take A on fixture A; if anything goes wrong, take B on fixture B. Never restart a take on an account whose close has already begun.
- [ ] Keep a screenshot of every shot's key frame during the take; these become the evidence screenshots (`docs/evidence/README.md` section 5) so the video and the package share the same frames.
- [ ] After the take: open the three transaction links and the Horizon 404 on camera, even if they will be trimmed, so the raw take proves the links.

### Edit

- [ ] Trim to 60 seconds or less; cut ledger waits only inside shot 6.
- [ ] Burn in captions top-centre, white on a dark band, one sentence each, no result codes and no "XDR". Export the same captions as `.srt`.
- [ ] Check every frame for secrets, personal names, e-mail addresses, local file paths and unrelated tabs.
- [ ] End card: repository URL, the three hashes in full, "testnet only".
- [ ] Verify the output: 1920 x 1080, 60 seconds or less, plays with sound off and still makes sense; compute the SHA-256 and record it in the evidence package.
- [ ] Upload (unlisted is fine), attach the file to the GitHub release, paste the link into the README and the evidence package.

### Final check against the success metric

- [ ] Shot 2 shows all four SOW "before" conditions.
- [ ] Shots 6 and 7 show the sponsor paying every fee and the account paying zero.
- [ ] Shot 8 shows the explorer page and the Horizon 404 for the same address as shot 2.
- [ ] The hashes on the end card equal the hashes in `docs/evidence/README.md` section 3.3.

## Tooling note

The `demo-video` skill available to the builder drives a web page with Playwright and composites a 60 fps screencast with a virtual camera; it is built for browser UIs. The browser shots (2 and 8) can be produced with it, but the terminal shots are recorded with an ordinary screen recorder. Because the close is irreversible, the scripted-capture path (which assumes a re-runnable fixture) only applies if a fresh fixture is built per capture; the checklist above assumes one continuous manual take per fixture instead.

## Assumptions

1. Command names, option names and the confirmation gesture follow `docs/ux-design.md` (section 2 and the storyboard in section 4); `docs/epics-and-stories.md` names `--yes` where the UX document names `--execute` and a typed confirmation. The video uses whatever the shipped CLI does; captions do not mention flag names, so the script survives either.
2. The fixture numbers (4 XLM balance, three transactions, sponsor fee of the order of 0.00015 XLM) are the expected values from the fixture definition; the captions say "4 XLM" only if the captured run shows it.
3. Shot 3 uses either a `dustin baseline` command, if the CLI ships one, or a plain unsponsored submission attempt; the point of the shot is the failing fee, not the command.
4. Voice-over is optional; the SOW requires a 60-second video showing the close from the CLI, not narration.
5. The explorer's wording for a merged account is its own; the caption says "no longer exists" and the Horizon 404 is the check.

## Sources

1. Accepted Statement of Work, section 3 (success metric), 5.1 Week 4, 6.1 (Deliverable 2 and the documentation row), Appendix B: `SUCCESSFUL_SOW.md`.
2. Storyboard, CLI output design, report mockup and colour rules: `docs/ux-design.md` sections 2.5, 2.6, 2.10 and 4.
3. Fee-bump transactions, fee account pays the fee: https://developers.stellar.org/docs/build/guides/transactions/fee-bump-transactions
4. Account merge removes the source account from the ledger: https://developers.stellar.org/docs/learn/fundamentals/transactions/list-of-operations#account-merge
5. Horizon 404 for a missing resource: https://developers.stellar.org/docs/data/apis/horizon/api-reference/errors/http-status-codes/standard
6. Testnet friendbot funding and network facts: https://developers.stellar.org/docs/networks
7. StellarExpert testnet explorer: https://stellar.expert/explorer/testnet/
8. The `demo-video` skill (Playwright capture plus compositor; browser-only capture path), read for awareness during this session.
