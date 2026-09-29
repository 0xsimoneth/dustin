---
title: Dustin 60-second demo, rehearsal script
status: final rehearsal script (story E4-S6); the automated take of 2026-09-29 follows it (section "The automated take"); hosting the video is pending
owner: the builder
aligns with: docs/ux-design.md section 4 (storyboard), SUCCESSFUL_SOW.md section 3 (binary success metric), Appendix B, evidence/README.md
---

# Dustin demo video: rehearsal script (60 seconds)

The video has one job: let a viewer with no Stellar knowledge see the messy account, see the plan, see the sponsor paying, and see the account disappear. It shows one close from the CLI, start to finish, on a freshly built messy fixture, and the addresses and hashes on screen are the ones the builder then adds to the evidence package.

This page is a rehearsal the builder can follow word for word: the setup, the commands in order, what each one prints, the 60-second cut, and a reference for every value. The reference values come from the CLI metric close recorded on the 0.1.0 code on 2026-09-29 ([`evidence/runs/20260929T111408Z-e4-cli/`](../evidence/runs/20260929T111408Z-e4-cli/summary.md), its [fixture build](../evidence/runs/20260929T111408Z-e4-cli/fixture-create.txt), its [plan](../evidence/runs/20260929T111408Z-e4-cli/plan.txt) and its [transcript](../evidence/runs/20260929T111408Z-e4-cli/transcript.txt)); the independent review of 2026-09-29 ran this script as written on a fresh fixture, with the typed confirmation, and every quoted line matched ([review](reviews/2026-09-29-e4-review.md), step 2). They are there so a take can be compared against a known good run. **Every address, hash, ledger, bid and plan hash in a take will differ: replace each reference value with your fresh fixture's values** in the evidence package after the take. The shapes (12 steps, 3 transactions, 4.0000007 XLM, 1,500 stroops, the 404) should match.

The video was produced from this script on 2026-09-29 (section "The automated take"); its record and, once hosted, its link are in [`evidence/demo/README.md`](../evidence/demo/README.md): `<pending: builder approves and hosts the 60-second video (E4-S6)>`.

## What the video has to prove

The SOW success metric is binary. Each checkbox in SOW Appendix B is covered by a shot, so the chapter lead can tick the list from the video alone.

| SOW Appendix B checkbox | Proven in shot | How it is visible |
|---|---|---|
| Fixture holds zero spendable XLM | 2 and 4 | The plan's "Balance" line: "4.0000000 XLM, minimum balance 4.0000000 XLM, spendable 0.0000000 XLM"; the explorer's balance panel |
| At least 3 trustlines with non-zero balances | 2 | Four asset lines with balances on the explorer page |
| At least 1 open offer | 2 | The explorer's offers tab shows 2 |
| At least 1 data entry | 2 | The explorer's data tab shows 1 |
| Every transaction fee-bumped by the sponsor | 6 and 7 | "fee-bumped by the sponsor" and "fee charged to the sponsor" on each transaction; the receipt's "0.0000000 XLM in fees paid by the account" |
| The account no longer exists on a public explorer | 8 | The explorer page after reload, then the Horizon 404 |
| Full transaction chain linkable | 6 and 9 | Three hashes with explorer links; the end card repeats them |

## Before the day

1. **Build the CLI** from the commit that becomes 0.1.0, and put `dustin` on the PATH, so the terminal shows `dustin` and not `node dist/cli/main.js`:

   ```bash
   npm ci && npm run build && npm link
   dustin --version
   ```

   Once `stellar-dustin` 0.1.0 is published (pending, the builder's action), `npm install -g stellar-dustin` does the same, and the version in the video is then the published one.

2. **Build two fixtures, A and B.** A close is irreversible, so the backup take needs its own account; there is no second take on the same address.

   ```bash
   dustin fixture create --profile messy      # fixture A
   dustin fixture create --profile messy      # fixture B, the backup
   ```

   Each writes its build log to standard error, then prints its id, the account, the destination, the fee sponsor, the explorer link and the manifest path, then its checks, on standard output. For reference, the metric fixture `messy-20260929T111410Z-0b6cd8` was built in seven transactions in consecutive ledgers (4931375 to 4931381), with the log lines `create-accounts ok`, `trustlines ok`, `sponsored-trustline ok`, `dust-payments ok`, `market-maker-bid ok`, `offers-and-data ok`, `drain-to-minimum ok`, then "Drained: balance 4.0000000 = minimum 4.0000000, spendable 0", "Strict-send path for DUSTA: 0.0000007 -> 0.0000007 XLM" and "Unbumped transaction from the fixture rejected with tx_insufficient_balance" ([`fixture-create.txt`](../evidence/runs/20260929T111408Z-e4-cli/fixture-create.txt), recorded with `--json`, so its standard output is the manifest). Without `--json` the summary and the twelve checks follow on standard output after the "Unbumped" line. Write down, for each fixture: the account `G...` (reference `GCIVEA6YVJCSYE2Y7V2IUEYATOO36X7GQOAYNOI2MDNOW7HI4LPJVKZT`), the destination (reference `GBR43GJ2WAHU7FPEAYLNFR4WJUQMCJGOOS6ESF2O6ZBB6GVWL6FVS3OY`), the fee sponsor (reference `GBDOAFW4WYIOVCBZNVI4CF4QOD2J3HZYMMQZSOF2LOSNZGZCSMVBIGMQ`) and the id.

3. **Verify both** against SOW Appendix B, and keep the snapshot for the evidence package:

   ```bash
   dustin fixture verify .fixture/<id>/manifest.json --snapshot .fixture/<id>/verification.json
   ```

   Twelve `PASS` lines, four of them marked `[Appendix B]`, then "Fixture verified: every check passed." and exit code 0 (reference output of the metric fixture: [`fixture-verify.txt`](../evidence/runs/20260929T111408Z-e4-cli/fixture-verify.txt)).

4. **Put the fixture's two secrets in `.env`, off camera**, without printing them: the account's key is `secrets.fixture` and the fee sponsor's is `secrets.sponsor` in `.fixture/<id>/keys.json`.

   ```bash
   node -e 'const k = require("./.fixture/<id>/keys.json").secrets; require("fs").writeFileSync(".env", `DUSTIN_ACCOUNT_SECRET=${k.fixture}\nDUSTIN_SPONSOR_SECRET=${k.sponsor}\n`, { mode: 0o600 })'
   ```

   Never type, paste or echo a secret on camera. A secret missing from the environment and `.env` is asked for with a hidden prompt (only on a terminal and without `--json`), which echoes nothing, but `.env` keeps the take shorter.

5. **Dry-run the plan on both fixtures** (`dustin plan`, below) and check it says `Status CLOSABLE: the plan ends in a merge`. The plan prints no unclosable section when there is nothing unclosable; the line `unclosable   0 items` appears only in the confirmation block of `close --execute`. A video that ends in PARTIAL does not meet the metric.

6. **Copy the fixture A account, destination and sponsor** into the evidence package draft; they must match the video.

## Terminal

- [ ] Window exactly 120 columns wide, so no line wraps: human text wraps at 120 columns and a full hash or URL stands whole on its own line (story E4-S1); height enough for the plan's summary and the confirmation block. The output has no colour, so the terminal theme decides the look.
- [ ] Monospace font at 18 point or larger; a high-contrast light theme; check legibility on a phone-sized preview.
- [ ] Prompt reduced to `$ ` (no user name, host name or directory).
- [ ] `clear` before each shot; shell history and autocomplete suggestions off.
- [ ] Secrets only in `.env` (step 4). Check the plan and the receipt once more for anything that looks like an `S...` key; Dustin never prints one.
- [ ] Notifications, calendars and dock or taskbar badges hidden.

## Browser

- [ ] A clean profile with no bookmarks bar, no extensions visible, no other tabs' titles readable.
- [ ] Pre-opened tabs, in order: the fixture's explorer page (`https://stellar.expert/explorer/testnet/account/<fixture G>`), its offers tab, its data tab, the fixture's Horizon page (`https://horizon-testnet.stellar.org/accounts/<fixture G>`), the destination's explorer page.
- [ ] Zoom 125 percent so balances read at 1080p.
- [ ] Reload the fixture page on camera in shot 8; do not cut to a pre-loaded "after" tab.

## The take, command by command

One continuous take per fixture: take A on fixture A; if anything goes wrong, take B on fixture B. Never restart a take on an account whose close has already begun.

### Command 1: the plan (shot 4)

```bash
dustin plan <fixture G> --to <destination G> --sponsor <sponsor G>
```

Reference: 75 lines of output after the command line ([`plan.txt`](../evidence/runs/20260929T111408Z-e4-cli/plan.txt)). What to look for, top to bottom:

| Line | Reference value | In your take |
|---|---|---|
| Heading | `Dustin plan  (dry run: nothing is signed, nothing is submitted)` | the same |
| Balance | `4.0000000 XLM, minimum balance 4.0000000 XLM, spendable 0.0000000 XLM (base reserve 0.5000000)` | the same |
| Fees | `bid up to 0.0626445 XLM (41,763 stroops per operation), paid by the sponsor; the account pays 0` | your bid follows the fee stats of the moment |
| Status | `CLOSABLE: the plan ends in a merge` | the same |
| Steps | S01 and S02 cancel two offers; S03 to S08 return DUSTB, DUSTC and SPTA to their issuer and remove their trustlines, SPTA's "reserve sponsored by" the reserve sponsor; S09 deletes `dustin.fixture`; S10 sells 0.0000007 DUSTA by path payment; S11 removes DUSTA; S12 merges ("cannot be undone") | the same steps; offer ids and addresses differ |
| Transactions | `tx 1 cleanup 9 ops`, `tx 2 convert 2 ops`, `tx 3 merge 1 op` | the same |
| Summary | `4.0000007 XLM arrives at GBR4...S3OY (balance 4.0000000 + sale 0.0000007)`; `0.0000000 XLM paid by the account; every fee is sponsored`; `sequence guard ok` | 4.0000007 XLM if the DUSTA bid is still there; 4.0000000 if the sale fell back to the burn |

Slow zoom on the "why:" lines of two steps, then on the summary block.

### Command 2: the close and the typed confirmation (shots 5 to 7)

```bash
dustin close <fixture G> --to <destination G> --execute
```

The command reads the account again, prints the fresh plan (the same 72 lines, headed "re-read for execution: nothing is signed before you confirm"), then the confirmation block. Reference, lines 75 to 83 of the [transcript](../evidence/runs/20260929T111408Z-e4-cli/transcript.txt):

```text
You are about to close GCIVEA6YVJCSYE2Y7V2IUEYATOO36X7GQOAYNOI2MDNOW7HI4LPJVKZT on testnet.
  destination  GBR43GJ2WAHU7FPEAYLNFR4WJUQMCJGOOS6ESF2O6ZBB6GVWL6FVS3OY
  receives     4.0000007 XLM through the merge in tx 3, which cannot be undone
  sponsor      GBDOAFW4WYIOVCBZNVI4CF4QOD2J3HZYMMQZSOF2LOSNZGZCSMVBIGMQ
  pays         every fee; the plan bids 0.0462795 XLM
  at most      5.0000000 XLM, the close budget; retries and re-plans can bid more than the plan, never more
  can spend    9864.9997200 XLM
  signs        3 fee-bumped transactions, 12 operations, signed by the account
  unclosable   0 items
```

Then the question: `Type the last 4 characters of the destination <destination G> to confirm: `. Type the last four characters of your destination at normal speed (for the reference destination, `S3OY`) and press Enter. Do not add `--json`: machine mode never asks and would refuse the run without `--yes`. The recorded run used `--yes` and `--report report.json` because a script drove it, so its transcript shows "CONFIRMATION SKIPPED" in place of the question and ends with "Report written to report.json"; do not use `--yes` in the video.

What follows, with the reference values (lines 87 to 110 of the transcript):

| Line | Reference value | Timing in the reference |
|---|---|---|
| `tx 1/3  cleanup  9 operations, signed by the account, fee-bumped by the sponsor` | submitted `835457ceff4b0443ec52ebbb408edc8988627e5de8442d28dda85b3331b52a5b`, confirmed ledger 4,931,386, fee charged to the sponsor 0.0001000 XLM (1,000 stroops) | ledger closed 11:15:17 UTC |
| `tx 2/3  convert  2 operations ...` | submitted `c6c99beddca7685293bdb0e156e320cbb4189e4247e4451578b60e82ba76de61`, confirmed ledger 4,931,387, 300 stroops | 11:15:22 UTC |
| `tx 3/3  merge preflight ok: no subentries left, nothing sponsored, destination exists, sequence guard ok` | | |
| `tx 3/3  merge  1 operation ...` | submitted `dd56e18f152dc7f15ee370dce9b8ddae556e90f04dd1cd52fe3281df4bf118e2`, confirmed ledger 4,931,388, 200 stroops | 11:15:27 UTC |
| `Verifying    GET /accounts/<fixture G> -> 404: the account no longer exists` | | |

The run from the answer to the receipt took about 18 seconds in the reference (started 11:15:11.056, finished 11:15:28.993 UTC): one ledger, about 5 seconds, per transaction. Then the receipt (lines 112 to 167), headed `Dustin close receipt   CLOSED: the account was merged and no longer exists`. For shot 7 show its "Result" block:

```text
Result
  4.0000007 XLM merged into the destination GBR4...S3OY (read from the merge result)
  Reserves released to sponsors: 0.5000000 XLM, never this account's
    0.5000000 XLM reserve returned to sponsor GCKX...T7BB, never this account's (trustline SPTA)
      observed on Horizon: num_sponsoring 1 -> 0, minimum balance 1.5000000 -> 1.0000000 XLM (0.5000000 XLM released),
      XLM balance 10.0000000 -> 10.0000000 (unchanged)
  0.0000000 XLM in fees paid by the account
  0.0001500 XLM (1,500 stroops) in fees paid by the sponsor
```

The command exits 0. Reference transcript length: 169 lines, of which the first is the command line, 167 are its output (the last one "Report written to report.json", from `--report`) and the last is the recorder's `[exit code 0]`. Command 2 as written here, without `--yes` and `--report`, prints 166 lines after its command line, the question in place of the "CONFIRMATION SKIPPED" line; the review's take was exactly that.

### The browser (shots 2 and 8)

- Before the close (shot 2): the fixture's explorer page, its offers tab (2 offers) and its data tab (1 entry).
- After the close (shot 8): reload the fixture's explorer page on camera; the merge is the last operation in its history (the page's own wording for a merged account is the explorer's). Then the Horizon tab, reloaded: HTTP 404 with the title "Resource Missing" ([reference body](../evidence/runs/20260929T111408Z-e4-cli/account-after.json)).
- After the take, off the cut: open the three transaction links from the terminal, so the raw take proves them.

## The 60-second cut

Format: 1920 x 1080, 16:9, 60 seconds or less, burned-in captions plus a sidecar `.srt`. Voice-over is optional; the captions carry the message.

| Time | Shot | On screen | Caption (burned in) |
|---|---|---|---|
| 0:00 - 0:05 | 1. Title card | "Dustin", the fixture address in full, "Stellar testnet" | This Stellar account holds 4 XLM but cannot spend any of it, so it cannot even pay the fee to close itself. |
| 0:05 - 0:13 | 2. Browser, the fixture before | Balances: 4 XLM and four assets with balances; offers tab: 2; data tab: 1; the address in the URL bar | Before: 4 trustlines with balances, 2 open offers, 1 data entry. All 4 XLM are locked as reserve. |
| 0:13 - 0:16 | 3. The unsponsored attempt | See "Shot 3" below | Without a sponsor, the account cannot pay a fee. |
| 0:16 - 0:26 | 4. Terminal, `dustin plan` | Command 1; zoom on the reason column and the summary | The plan is read-only. Every step has a reason. Nothing is signed yet. |
| 0:26 - 0:31 | 5. Terminal, confirmation | Command 2's confirmation block; the four characters typed | To run it, you confirm the destination. |
| 0:31 - 0:44 | 6. Terminal, execution | tx 1/3, 2/3, 3/3 with hashes, ledgers and "fee charged to the sponsor"; ledger waits cut, timestamps kept | Three transactions. Every fee is paid by the sponsor. The account pays nothing. |
| 0:44 - 0:49 | 7. Terminal, the receipt | "CLOSED"; the Result block | Result: 4 XLM arrived at the destination. Fees paid by the account: zero. |
| 0:49 - 0:56 | 8. Browser, after | Fixture page reloaded; the Horizon 404 | After: the account no longer exists. Anyone can check this link. |
| 0:56 - 1:00 | 9. End card | Repository URL, the three transaction hashes, "testnet only" | Dustin. Read the plan, then close the account. Testnet only. |

If shot 6 runs longer than 13 seconds in real time, cut the waits between confirmations and keep the timestamps and ledger numbers on screen, so the run is evidently real. Do not speed up the typing in shot 5.

### Shot 3: the unsponsored attempt

Dustin has no command that submits an unsponsored transaction on purpose, and the video must not pretend it does. Three honest options, in order of preference:

1. **A frame of the baseline recording**, once it exists: the existing tool's first transaction refused on the baseline fixture (story E1-S2, [`evidence/baseline/README.md`](../evidence/baseline/README.md)). The caption then says it is the existing tool. `<pending: builder records the Demolisher baseline>`.
2. **The fixture builder's own probe**: `dustin fixture create` submits one unbumped transaction from the drained fixture and logs "Unbumped transaction from the fixture rejected with tx_insufficient_balance" on standard error, as the last line of its build log, right before the summary and the checks on standard output. Record fixture A's build (step 2 above) and use the frame that shows that line; the caption says it is the fixture builder's check.
3. **Cut the shot** and give its three seconds to shot 4.

## Checklists

### Compare a take against the reference

- [ ] The plan says CLOSABLE, 12 steps, 3 transactions and "spendable 0.0000000 XLM", and prints no unclosable section; the confirmation block says `unclosable   0 items`.
- [ ] Every transaction line says "fee-bumped by the sponsor" and shows a hash, a ledger and "fee charged to the sponsor".
- [ ] The receipt says CLOSED, "0.0000000 XLM in fees paid by the account", and the Horizon check says 404.
- [ ] The fixture address on the title card, in shot 2 and in shot 8 is the same.
- [ ] The command exited 0.

### Edit

- [ ] Trim to 60 seconds or less; cut ledger waits only inside shot 6.
- [ ] Captions top-centre, white on a dark band, one sentence each, no result codes and no "XDR"; the same captions as `.srt`.
- [ ] Check every frame for secrets, personal names, e-mail addresses, local file paths and unrelated tabs.
- [ ] End card: repository URL, the three hashes in full, "testnet only".
- [ ] Verify the output: 1920 x 1080, 60 seconds or less, makes sense with the sound off; compute its SHA-256.

### After the take

- [ ] Upload the video (unlisted is fine) and put the link, the duration and the SHA-256 in [`evidence/demo/README.md`](../evidence/demo/README.md), the README's Demo section and the evidence package (SOW 6.1, D2 and the docs row).
- [ ] Record fixture A's close as evidence: the account, destination, sponsor and the three hashes, with the transcript if the take's terminal output was saved.
- [ ] Take screenshots of the key frames (the plan, the confirmation, the transactions, the receipt, the explorer after, the Horizon 404) before the testnet reset of 2026-12-16.

## Tooling note

The `demo-video` skill available to the builder drives a web page with Playwright and composites a screencast; it is built for browser UIs, not for a terminal. The take is therefore produced by the repository's own script (next section), and the manual procedure above stays valid for a take by hand.

## The automated take (`scripts/demo/make-demo.mjs`)

On 2026-09-29 the video was produced from this script by `node scripts/demo/make-demo.mjs --playwright <directory where playwright is installed>`, on a fresh fixture, without any other input. Its record is `evidence/demo/take-<UTC stamp>/summary.md`: the accounts, the three transactions with Horizon's records, the shots with the second of the recording each one comes from, and the three recordings themselves.

What it does, in the order of this page:

1. **Builds the CLI** and puts `dustin` on the PATH through `npm link` into a temporary prefix (the global npm prefix is not touched).
2. **Records the terminal takes** with asciinema (`asciinema rec --headless`, 120 columns by 60 rows, asciicast v2), while `scripts/demo/take.exp` (expect) types each command at a steady speed in a clean bash whose prompt is `$ `: `dustin fixture create --profile messy` (the build, on camera, for shot 3), then `dustin plan <G> --to <G> --sponsor <G>`, then `dustin close <G> --to <G> --execute`, answering the typed confirmation with the destination's last four characters, 280 ms apart. Between the takes, off camera: `dustin fixture verify` with its snapshot, the wait for Horizon's DUSTA path, and the `.env` of the take's directory (mode 600), written right before the close and removed right after it. No secret is typed, printed or passed on a command line.
3. **Captures the browser pages** with Playwright (Chromium, 1920 x 910, under a strip that names the URL): before the close, the account's balances and its two offers on Stellar Explorer (https://testnet.steexp.com, which reads Horizon live) and its data entry on Horizon; after the close, Horizon's 404 for the account and the account's last operation, the `account_merge` of transaction 3.
4. **Checks the close** before anything is kept: three transactions shown, the receipt CLOSED, each transaction successful on Horizon with `fee_account` the sponsor and `source_account` the account, Horizon 404 for the account, the merge its last operation.
5. **Cuts the video** as the table of "The 60-second cut" says: each terminal shot is rendered from its recording with agg (theme github-light, 26-pixel font) and framed at 1080p; only the pauses are shortened (the confirmation's typing never is; the ledger waits of shot 6 keep as much of their length as fits); captions are burned in on a band at the top; the whole is 59.8 seconds, 1920 x 1080, H.264, no sound. It also writes the captions as `evidence/demo/dustin-demo.srt`, a short GIF of the close (`evidence/demo/dustin-demo.gif`) and seven key frames.
6. **Scans** every text file for secret seeds, the fixture's secret keys and local paths before writing under `evidence/demo/`; the MP4 (`evidence/demo/dustin-demo-60s.mp4`) is ignored by git and is hosted as a release asset.

Differences from the manual take, and why:

- **The explorer pages.** On 2026-09-29 StellarExpert's testnet explorer had stopped ingesting at ledger 4,935,523 (its API's last ledger did not move for a minute while Horizon was 784 ledgers ahead), so an account built that day did not exist on it. The automated take shows the same facts from Stellar Explorer and from Horizon itself, which the evidence package already treats as the check that does not depend on a third-party site (`evidence/README.md`, assumption 2). Shot 8 shows Horizon's "Resource Missing" 404 and the account's `account_merge`, both fetched after the close. A manual take on StellarExpert, as written above, remains possible once it has caught up.
- **Shot 3** uses option 2: a frame of the take's own fixture build, the moment the builder's unsponsored transaction is refused with `tx_insufficient_balance`; the caption says it is the fixture builder's check.
- **The terminal window** is recorded at 60 rows, so that the whole receipt stays on the recorded screen, and each shot shows a 1080p window of it (the plan's steps, then its summary; the confirmation block; the transactions; the receipt's heading, then its Result block). Nothing is drawn on the terminal's picture but that window.
- **The prompt and the typing** are a script's: the characters appear one by one at a steady speed. The video is a recording of a real run, not a screen capture of a person typing.

To make it again (after a testnet reset, or to replace the take): install asciinema 3, agg 1.9 or newer and ffmpeg with libass (on macOS: `brew install asciinema agg ffmpeg`; `expect` ships with macOS), Playwright in any directory (`npm install playwright` there; its Chromium is `npx playwright install chromium`), then run the command above from the repository root. It takes about six minutes and makes a new take directory.

## Assumptions

1. Command names, options, the confirmation question and the output lines quoted here are those of the 0.1.0 code (the build of `ab1fdae`) and of the recorded run; the builder checks them against the build the video is recorded with.
2. The reference values are those of `evidence/runs/20260929T111408Z-e4-cli/`; a fresh fixture gives new addresses, hashes, ledgers and a new fee bid, while the structure (12 steps, 3 transactions, 4.0000007 XLM when the DUSTA bid holds, 1,500 stroops at the ledger's base fee) is the recipe's.
3. The explorer's wording for a merged account is its own; the caption says "no longer exists" and the Horizon 404 is the check.
4. Voice-over is optional; the SOW requires a 60-second video showing the close from the CLI.

## Sources

1. Accepted Statement of Work, section 3 (success metric), 5.1 week 4, 6.1 (Deliverable 2 and the documentation row), Appendix B: `SUCCESSFUL_SOW.md`.
2. The recorded CLI metric close on the 0.1.0 code: `evidence/runs/20260929T111408Z-e4-cli/` (`summary.md`, `fixture-create.txt`, `fixture-verify.txt`, `plan.txt`, `transcript.txt`, `report.json`, `account-after.json`); the independent review's take of this script: `docs/reviews/2026-09-29-e4-review.md` (step 2, and D-9 for the three lines it corrected).
3. Storyboard, CLI output design and colour rules: `docs/ux-design.md` sections 2.5, 2.6, 2.10 and 4.
4. Fee-bump transactions, the fee account pays the fee: https://developers.stellar.org/docs/build/guides/transactions/fee-bump-transactions
5. Account merge removes the source account from the ledger: https://developers.stellar.org/docs/learn/fundamentals/transactions/list-of-operations#account-merge
6. Horizon 404 for a missing resource: https://developers.stellar.org/docs/data/apis/horizon/api-reference/errors/http-status-codes/standard
7. Testnet, Friendbot and resets: https://developers.stellar.org/docs/networks
8. StellarExpert testnet explorer: https://stellar.expert/explorer/testnet/
