# Test evidence (story E4-S3)

The SOW's evidence for Deliverable 3 is a "test results screenshot" of the passing matrix, the public repository and the baseline recording (`SUCCESSFUL_SOW.md` section 6.1). This directory holds the first: the complete output of one full green run of each tier on the same code, and an image of each run's summary. The matrix these runs cover, row by row, is [`docs/test-matrix.md`](../../docs/test-matrix.md).

Both runs are of commit `0df4d09` (`0df4d0957448bf8eaf41437e5a9f403e286443df`): the branch of story E4-S3 after the merge of main at `e8cdf16` (stories E4-S1 and E4-S2), with Node v24.15.0 on macOS (arm64), on 2026-09-28.

| File | What it is |
|---|---|
| [`offline.txt`](offline.txt) | The complete output of `npm test -- --reporter=default`, started 22:30:37 UTC: 113 files, 1057 tests passed in 15.18 s (the live tier ran at the same time; alone the tier takes about 7 s), with the network blocked for the whole tier (`test/setup/no-network.ts`). The default reporter is named because vitest picks its `minimal` reporter in a shell it takes for an AI agent, and that one prints no per-file lines. |
| [`offline.png`](offline.png) | The 113 per-file lines and the summary of `offline.txt`, rendered from the captured terminal output. |
| [`testnet.txt`](testnet.txt) | The complete output of `DUSTIN_TESTNET=1 npm run test:testnet -- --reporter=verbose`, 22:30:31 to 22:35:33 UTC: 11 files, 58 tests passed in 301.09 s against the public testnet. Every test built its own accounts from Friendbot with fresh keys; the output holds every transaction hash the tests printed, with its purpose. |
| [`testnet.png`](testnet.png) | The 58 per-test lines (cut at 150 characters) and the summary of `testnet.txt`, rendered from the captured terminal output. |

What the text files hold: the output as it was captured, under three header lines that give the command, the UTC time, the commit and the Node version. Nothing is removed but ANSI codes (there were none: the output did not go to a terminal), with one change the repository rules require: vitest's `RUN` line names the local working directory, which reads `<repository root>` instead. vitest's own "Start at" is the machine's local time (UTC+3); the header gives UTC. Both files pass the seed scan (`containsSecretSeed` in `src/errors/redact.ts`, and the CI pattern `(?<![A-Z2-7])S[A-Z2-7]{55}(?![A-Z2-7])`): the live tests print public keys and hashes only.

The images are not screen captures. Each is rendered from the captured terminal output with ImageMagick and says so in its first line. The summary text is the header, the per-file (offline) or per-test (live) result lines and vitest's closing lines:

```
grep -E '^ (✓|×) \|unit\||^ +(Test Files|Tests|Start at|Duration) ' offline.txt > offline-summary.txt
magick -background white -fill '#1a1a1a' -font Menlo.ttc -pointsize 13 -interline-spacing 3 \
  label:@offline-summary.txt -bordercolor white -border 24 -strip offline.png
```

(the same for `testnet.txt`, with `|testnet|`; `Menlo.ttc` is the macOS system font, given by its file path.)

The live tier ran three times on this branch. Before the merge of main, on `0da27eb`: a first run (21:21:46 to 21:36:53 UTC) passed 57 of 58, `S-07b` timing out at 300 s while this machine's network was down (no test file logged anything from 21:22:55 to 21:33:52 UTC; its fee-bumped close applied once the network was back), and a second run passed 58 of 58 (21:37:48 to 21:42:52 UTC, 304 s). `testnet.txt` is the third, after the merge, green in full.

Reproduce: `npm ci`, then `npm test` (about 10 s) and `DUSTIN_TESTNET=1 npm run test:testnet` (about 5 minutes; it needs Friendbot and testnet Horizon, and no key or `.env`: every live test makes its own throwaway accounts).

CI runs of the same code: to be added by the integrator after the merges (the offline CI run and the manual testnet tier job).
