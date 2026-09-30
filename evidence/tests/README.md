# Test evidence (story E4-S3)

The SOW's evidence for Deliverable 3 is a "test results screenshot" of the passing matrix, the public repository and the baseline recording (`SUCCESSFUL_SOW.md` section 6.1). This directory holds the first: the complete output of one full green run of each tier on the same code, and an image of each run's summary. The matrix these runs cover, row by row, is [`docs/test-matrix.md`](../../docs/test-matrix.md).

`offline.txt` is of commit `e563470` (`e5634709d8cecc92eda0c259ce528e60b4a041fc`), `main` on 2026-09-30: the 0.1.0 code with every fix of the Epic 4 review merged, the `stellar-dustin/testing` entry and the schemas in the package (PRD decisions D-17 and D-18); `testnet.txt` is of commit `049274f` (`049274f4f80c0c19de60222d940273b01b8ab1bb`), the branch of story E4-S3 after the merge of main at `af62f8e`, on 2026-09-28, and the live tier of the 0.1.0 code ran in CI (below). Both with Node v24.15.0 on macOS (arm64).

| File | What it is |
|---|---|
| [`offline.txt`](offline.txt) | The complete output of `npm test -- --reporter=default`, started 18:16:33 UTC on 2026-09-30: 125 files, 1236 tests passed in 8.72 s, with the network blocked for the whole tier (`test/setup/no-network.ts`). (The earlier captures of this file: on `97454bf` (2026-09-30, before the testing entry), 124 files and 1231 tests in 8.15 s; on `3fd5fe5` (2026-09-29), 122 files and 1212 tests in 7.30 s; the first, on `049274f`, 113 files and 1057 tests in 15.18 s while the live tier ran at the same time; the independent review of 2026-09-29 measured 14.8 s and 10.9 s, vitest's own figures, on two fresh clones of `7c53a1b` ([review](../../docs/reviews/2026-09-29-e4-review.md), step 1).) The default reporter is named because vitest picks its `minimal` reporter in a shell it takes for an AI agent, and that one prints no per-file lines. |
| [`offline.png`](offline.png) | The 125 per-file lines and the summary of `offline.txt`, rendered from the captured terminal output (again on 2026-09-30, with the capture). |
| [`testnet.txt`](testnet.txt) | The complete output of `DUSTIN_TESTNET=1 npm run test:testnet -- --reporter=verbose`, 22:30:31 to 22:35:33 UTC: 11 files, 58 tests passed in 301.09 s against the public testnet. Every test built its own accounts from Friendbot with fresh keys; the output holds every transaction hash the tests printed, with its purpose. |
| [`testnet.png`](testnet.png) | The 58 per-test lines (cut at 150 characters) and the summary of `testnet.txt`, rendered from the captured terminal output; rendered again on 2026-09-30 only so that its header names the commit as the rewritten history does (`049274f`). |
| [`testnet-ci-36757533611.txt`](testnet-ci-36757533611.txt) | The complete log of the CI run of the live tier on `main` at `e563470`, [Testnet tier, run 36757533611](https://github.com/0xsimoneth/dustin/actions/runs/36757533611) (11 files, 58 tests, 345.07 s, 2026-09-30), downloaded the same day and changed only as the next file was. |
| [`testnet-ci-36560464977.txt`](testnet-ci-36560464977.txt) | The complete log of the CI run of the live tier on the 0.1.0 code, [Testnet tier, run 36560464977](https://github.com/0xsimoneth/dustin/actions/runs/36560464977) (11 files, 58 tests, 341.93 s), downloaded on 2026-09-30 with `gh run view 36560464977 --log`, because GitHub deletes a run's logs after the repository's retention period, 90 days here (`gh api repos/0xsimoneth/dustin/actions/permissions/artifact-and-log-retention`). Only the job name and the timestamp at the start of each line, the terminal colour codes and the runner's checkout directory (`<repository root>`) were changed; its header says so. |
| [`transactions/`](transactions/README.md) | Horizon's record of each of the 208 transactions that the test matrix, the write-up, the baseline protocol and stories 3-1 to 3-4 cite only as text, one `<hash>.json` per transaction, captured on 2026-09-30 before the testnet reset of 2026-12-16; `npm run evidence:check` checks every file, compares it with Horizon while the testnet keeps it, and fails a cited transaction without a record. |

What the text files hold: the output as it was captured, under three header lines that give the command, the UTC time, the commit and the Node version. Nothing is removed but ANSI codes (there were none: the output did not go to a terminal), with one change the repository rules require: vitest's `RUN` line names the local working directory, which reads `<repository root>` instead. vitest's own "Start at" is the machine's local time (UTC+3); the header gives UTC. Both files pass the seed scan (`containsSecretSeed` in `src/errors/redact.ts`, and the CI pattern `(?<![A-Z2-7])S[A-Z2-7]{55}(?![A-Z2-7])`): the live tests print public keys and hashes only.

The images are not screen captures, and the builder accepted them as the SOW's "test results screenshot" on 2026-09-29 (PRD decision D-16), with one real screen capture of a CI run beside them (next section). Each is rendered from the captured terminal output with ImageMagick and says so in its first line. The summary text is the header, the per-file (offline) or per-test (live) result lines and vitest's closing lines:

```
{ echo "Rendered from the captured terminal output (evidence/tests/offline.txt), not a screen capture."
  sed -n '1,2p' offline.txt
  grep -E '^ (✓|×) \|unit\||^ +(Test Files|Tests|Start at|Duration) ' offline.txt; } > offline-summary.txt
magick -background white -fill '#1a1a1a' -font /System/Library/Fonts/Menlo.ttc -pointsize 13 -interline-spacing 3 \
  label:@offline-summary.txt -bordercolor white -border 24 -strip offline.png
```

(the same for `testnet.txt`, with `|testnet|`, its command and time written out as the first three lines, each test line cut at 150 characters, and a blank line before the tests and before the summary; `Menlo.ttc` is the macOS system font, given by its file path.)

The live tier ran three times on this branch. Before the merge of main, on `f3b483a`: a first run (21:21:46 to 21:36:53 UTC) passed 57 of 58, `S-07b` timing out at 300 s while this machine's network was down (no test file logged anything from 21:22:55 to 21:33:52 UTC; its fee-bumped close applied once the network was back), and a second run passed 58 of 58 (21:37:48 to 21:42:52 UTC, 304 s). `testnet.txt` is the third, after the merge, green in full.

Reproduce: `npm ci`, then `npm test` (8 to 15 s by the figures above) and `DUSTIN_TESTNET=1 npm run test:testnet` (about 5 minutes; it needs Friendbot and testnet Horizon, and no key or `.env`: every live test makes its own throwaway accounts).

CI runs of the 0.1.0 code, commit `ab1fdae` (its source is the source of `3fd5fe5`, whose offline run was an earlier capture of `offline.txt`; the commits after it changed documents and evidence, added scripts with their unit tests (the demo, B-03, the hash remap, the stored transaction records of `evidence:check`) and left the package code alone until 2026-09-30, when the `stellar-dustin/testing` entry and the schemas joined the package (PRD decisions D-17 and D-18), and both tiers ran again on that code, below): the manual testnet tier job [Testnet tier, run 36560464977](https://github.com/0xsimoneth/dustin/actions/runs/36560464977), 2026-09-29 11:14 to 11:20 UTC, passed 11 files and 58 tests in 341.93 s (Node 24, on GitHub's runner); the offline tier [CI, run 36560430762](https://github.com/0xsimoneth/dustin/actions/runs/36560430762) passed on Node 22.12.0, 22 and 24. CI passes the offline tier on every push to main.

The CI run of the live tier on `main` at `e563470` (2026-09-30, the testing entry and the schemas in the package added to the 0.1.0 code): [Testnet tier, run 36757533611](https://github.com/0xsimoneth/dustin/actions/runs/36757533611), 18:17 to 18:23 UTC, passed 11 files and 58 tests in 345.07 s (Node 24, on GitHub's runner); its log is [`testnet-ci-36757533611.txt`](testnet-ci-36757533611.txt).

## CI runs and the rewritten history

On 2026-09-30 the history of the repository was rewritten to remove personal data from two old objects (review findings R4 and R5; [`docs/runbooks/history-rewrite.md`](../../docs/runbooks/history-rewrite.md)). Every commit hash changed and no file did: each rewritten commit from the SOW's redaction onwards holds exactly the tree it held before. The documents cite the new hashes, while a GitHub Actions run page keeps the hash of the commit it ran on, which is no longer in the repository. The runs this package cites, with both hashes:

| Run | Workflow | Commit on the run page (before the rewrite) | The same commit after the rewrite |
|---|---|---|---|
| [36424696971](https://github.com/0xsimoneth/dustin/actions/runs/36424696971) | Testnet tier | `d0d711c25f7c723251d23eff67796c31b7e538ef` | `60af60d48061e4aee57c28024a708bef3b1db6ba` |
| [36539346346](https://github.com/0xsimoneth/dustin/actions/runs/36539346346) | CI | `e865bec9e052842cb6791d24e0d8215c680be5e5` | `7c53a1b7eb6cd551aa3104aa4af1db6cf672d683` |
| [36560430762](https://github.com/0xsimoneth/dustin/actions/runs/36560430762) | CI | `7bd04aeecdf1dfc244181f492b5a73a54291214a` | `ab1fdae1ce4ac36e89a228e87485bf6e8a7ae1c0` |
| [36560464977](https://github.com/0xsimoneth/dustin/actions/runs/36560464977) | Testnet tier | `7bd04aeecdf1dfc244181f492b5a73a54291214a` | `ab1fdae1ce4ac36e89a228e87485bf6e8a7ae1c0` |

Each run tested the tree that its new commit holds, so its record stays valid. The header lines of `offline.txt` and `testnet.txt` name the new hashes. The first CI run on the rewritten history is [CI, run 36639605562](https://github.com/0xsimoneth/dustin/actions/runs/36639605562), green on Node 22.12.0, 22 and 24.

## The CI screenshot

A screenshot of a GitHub Actions run page, taken by the builder in a browser, completes story E4-S3 (PRD decision D-16). Its place is this directory, and its name is `ci-run-<run id>.png`, after the number at the end of the run's URL.

| Field | Value |
|---|---|
| Run to capture | [Testnet tier, run 36560464977](https://github.com/0xsimoneth/dustin/actions/runs/36560464977) (the live tier on the 0.1.0 code, 11 files, 58 tests, 342 s); or a later run of the testnet workflow on the commit that is tagged `v0.1.0`, if the builder dispatches one |
| File | `ci-run-36560464977.png` (or `ci-run-<run id>.png` for the later run) |
| Screenshot | `<pending: builder captures the run page as evidence/tests/ci-run-<run id>.png>` |
| Taken on (UTC) | `<pending>` |

What the frame should show: the run's title and number, the green status, the commit, the branch `main`, the date, and the job's "Run the testnet tier" step expanded to its last lines ("Test Files 11 passed", "Tests 58 passed"). Nothing else: no other tab, no bookmark bar, no account menu opened. The page is public, so the capture holds nothing that is not already public; check it for a local path or a name anyway before committing it. Once it is committed, the row above names the file and E4-S3 is done.
