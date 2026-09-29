# Test evidence (story E4-S3)

The SOW's evidence for Deliverable 3 is a "test results screenshot" of the passing matrix, the public repository and the baseline recording (`SUCCESSFUL_SOW.md` section 6.1). This directory holds the first: the complete output of one full green run of each tier on the same code, and an image of each run's summary. The matrix these runs cover, row by row, is [`docs/test-matrix.md`](../../docs/test-matrix.md).

`offline.txt` is of commit `9184fa6` (`9184fa6ea9f91a82946531c4221786bf3e2d8dfc`), the 0.1.0 code with every fix of the Epic 4 review merged, on 2026-09-29; `testnet.txt` is of commit `0df4d09` (`0df4d0957448bf8eaf41437e5a9f403e286443df`), the branch of story E4-S3 after the merge of main at `e8cdf16`, on 2026-09-28, and the live tier of the 0.1.0 code ran in CI (below). Both with Node v24.15.0 on macOS (arm64).

| File | What it is |
|---|---|
| [`offline.txt`](offline.txt) | The complete output of `npm test -- --reporter=default`, started 11:50:37 UTC on 2026-09-29: 122 files, 1212 tests passed in 7.30 s, with the network blocked for the whole tier (`test/setup/no-network.ts`). (The first capture of this file, on `0df4d09`, passed 113 files and 1057 tests in 15.18 s while the live tier ran at the same time; the independent review of 2026-09-29 measured 14.8 s and 10.9 s, vitest's own figures, on two fresh clones of `e865bec` ([review](../../docs/reviews/2026-09-29-e4-review.md), step 1).) The default reporter is named because vitest picks its `minimal` reporter in a shell it takes for an AI agent, and that one prints no per-file lines. |
| [`offline.png`](offline.png) | The 122 per-file lines and the summary of `offline.txt`, rendered from the captured terminal output. |
| [`testnet.txt`](testnet.txt) | The complete output of `DUSTIN_TESTNET=1 npm run test:testnet -- --reporter=verbose`, 22:30:31 to 22:35:33 UTC: 11 files, 58 tests passed in 301.09 s against the public testnet. Every test built its own accounts from Friendbot with fresh keys; the output holds every transaction hash the tests printed, with its purpose. |
| [`testnet.png`](testnet.png) | The 58 per-test lines (cut at 150 characters) and the summary of `testnet.txt`, rendered from the captured terminal output. |

What the text files hold: the output as it was captured, under three header lines that give the command, the UTC time, the commit and the Node version. Nothing is removed but ANSI codes (there were none: the output did not go to a terminal), with one change the repository rules require: vitest's `RUN` line names the local working directory, which reads `<repository root>` instead. vitest's own "Start at" is the machine's local time (UTC+3); the header gives UTC. Both files pass the seed scan (`containsSecretSeed` in `src/errors/redact.ts`, and the CI pattern `(?<![A-Z2-7])S[A-Z2-7]{55}(?![A-Z2-7])`): the live tests print public keys and hashes only.

The images are not screen captures, and the builder accepted them as the SOW's "test results screenshot" on 2026-09-29 (PRD decision D-16), with one real screen capture of a CI run beside them (next section). Each is rendered from the captured terminal output with ImageMagick and says so in its first line. The summary text is the header, the per-file (offline) or per-test (live) result lines and vitest's closing lines:

```
grep -E '^ (✓|×) \|unit\||^ +(Test Files|Tests|Start at|Duration) ' offline.txt > offline-summary.txt
magick -background white -fill '#1a1a1a' -font Menlo.ttc -pointsize 13 -interline-spacing 3 \
  label:@offline-summary.txt -bordercolor white -border 24 -strip offline.png
```

(the same for `testnet.txt`, with `|testnet|`; `Menlo.ttc` is the macOS system font, given by its file path.)

The live tier ran three times on this branch. Before the merge of main, on `0da27eb`: a first run (21:21:46 to 21:36:53 UTC) passed 57 of 58, `S-07b` timing out at 300 s while this machine's network was down (no test file logged anything from 21:22:55 to 21:33:52 UTC; its fee-bumped close applied once the network was back), and a second run passed 58 of 58 (21:37:48 to 21:42:52 UTC, 304 s). `testnet.txt` is the third, after the merge, green in full.

Reproduce: `npm ci`, then `npm test` (11 to 15 s by the figures above) and `DUSTIN_TESTNET=1 npm run test:testnet` (about 5 minutes; it needs Friendbot and testnet Horizon, and no key or `.env`: every live test makes its own throwaway accounts).

CI runs of the 0.1.0 code, commit `7bd04ae` (its source is the source of `9184fa6`; the commits after it change documents and evidence only): the manual testnet tier job [Testnet tier, run 36560464977](https://github.com/0xsimoneth/dustin/actions/runs/36560464977), 2026-09-29 11:14 to 11:20 UTC, passed 11 files and 58 tests in 341.93 s (Node 24, on GitHub's runner); the offline tier [CI, run 36560430762](https://github.com/0xsimoneth/dustin/actions/runs/36560430762) passed on Node 22.12.0, 22 and 24. CI passes the offline tier on every push to main.

## The CI screenshot

A screenshot of a GitHub Actions run page, taken by the builder in a browser, completes story E4-S3 (PRD decision D-16). Its place is this directory, and its name is `ci-run-<run id>.png`, after the number at the end of the run's URL.

| Field | Value |
|---|---|
| Run to capture | [Testnet tier, run 36560464977](https://github.com/0xsimoneth/dustin/actions/runs/36560464977) (the live tier on the 0.1.0 code, 11 files, 58 tests, 342 s); or a later run of the testnet workflow on the commit that is tagged `v0.1.0`, if the builder dispatches one |
| File | `ci-run-36560464977.png` (or `ci-run-<run id>.png` for the later run) |
| Screenshot | `<pending: builder captures the run page as evidence/tests/ci-run-<run id>.png>` |
| Taken on (UTC) | `<pending>` |

What the frame should show: the run's title and number, the green status, the commit, the branch `main`, the date, and the job's "Run the testnet tier" step expanded to its last lines ("Test Files 11 passed", "Tests 58 passed"). Nothing else: no other tab, no bookmark bar, no account menu opened. The page is public, so the capture holds nothing that is not already public; check it for a local path or a name anyway before committing it. Once it is committed, the row above names the file and E4-S3 is done.
