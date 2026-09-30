# Final audit (2026-09-30)

The builder's brief of 2026-09-30 (sprint day 9 of 30; final deadline 2026-10-22) listed nine items to close without waiting for the builder's own actions, and gave six decisions in advance (K1 to K6). This page records, item by item, what was done, in which commit, and the evidence that it holds. Every commit is authored as `0xsimoneth`; every push was followed by CI.

## The builder's decisions

| # | Decision | Where it is recorded |
|---|---|---|
| K1 | Rewrite the history (review findings R4, R5) | PRD decision D-7, "Done on 2026-09-30"; `docs/runbooks/history-rewrite.md`, "Done on 2026-09-30" |
| K2 | Switch on private vulnerability reporting | `docs/runbooks/release.md`, "Before the release" |
| K3 | The JSON schemas ship in the npm package (FR-10, FR-30) | PRD decision D-17 |
| K4 | Add `stellar-dustin/testing` and an `examples/` directory | PRD decision D-18 |
| K5 | No clean-up of the throwaway fixtures; nothing under `.fixture/` is touched | `docs/HANDOFF.md`, rule 5 |
| K6 | Produce the video again with StellarExpert's pages; keep the first take as a backup | `evidence/demo/README.md`; story 4-6 |

## 1. The history rewrite

Commits `622d1b8` (the remap) and `bb42753` (the records).

- Safety net first, outside the repository: a mirror clone of GitHub and a bundle of every local ref (`git bundle verify`: okay; `git fsck` of the mirror: clean). They hold the old history and stay offline until GitHub Support confirms step 8 of the runbook.
- `git filter-repo` 2.47.0 on a fresh clone, with `--sensitive-data-removal`, `--replace-text` (the three rows of the first `SUCCESSFUL_SOW.md`) and `--mailmap` (the root commit's author e-mail); the input files were written outside the repository and the personal data was never printed. First changed commit: the root, `bedc4a6`, now `77d36b9`.
- Checks before the push: 7 matching lines before the rewrite, 0 after, in `git log --all -p` with names, e-mails and messages, and 0 in every object of the rewritten repository, reachable or not; the only e-mails left are the noreply address and `noreply@github.com`; 364 commits before and after; the tree of `main` unchanged, byte for byte (`3f64462`), so not even the three lines of the first SOW version differ at the tip.
- `node scripts/remap-commit-hashes.mjs` with filter-repo's commit-map: the dry run found 649 citations in 45 files; 620 in 43 files were rewritten, each an exact old-to-new pair of the same length (checked token by token), and every changed line differs in nothing but its hashes. Two files keep their hashes on purpose: the history-rewrite runbook, which names the objects of the old history, and `test/unit/scripts/remap-commit-hashes.test.ts`, whose hashes are test data. Offline tier, lint, format, typecheck, build and the package check green before the push.
- `git push --force-with-lease=refs/heads/main:d7f557b… origin main` (`d7f557b...622d1b8`); `main` was the only branch on GitHub. CI green on Node 22.12.0, 22 and 24 ([run 36639605562](https://github.com/0xsimoneth/dustin/actions/runs/36639605562)).
- Protection: repository ruleset 24215741, "main: no force push, no deletion" (rules `non_fast_forward` and `deletion`, enforcement active, no bypass, no pull request required); `GET /repos/0xsimoneth/dustin/rules/branches/main` returns exactly those two rules.
- `evidence/tests/README.md` maps the commit each cited CI run names (36424696971, 36539346346, 36560430762, 36560464977) to the same commit after the rewrite; each holds the same tree.
- The usual working copy was moved onto the new `main` (fetch, reset). Removing the agent worktrees of past sessions and their branches, which still point at the old history, was refused by the session's permission classifier and is left to the builder (runbook step 9); one of those worktrees holds fixture keys under `.fixture/`, which stay.

## 2. Repository settings

Commit `c6a2059`. `PUT /repos/0xsimoneth/dustin/private-vulnerability-reporting` answered 204 and the check now prints `{"enabled":true}` (it printed `false` before). `gh repo edit` set the description, the README as the homepage, the topics `account-merge`, `cli`, `fee-bump`, `sponsored-reserves`, `stellar`, `testnet`, `typescript`, and switched the wiki and projects tabs off; `gh repo view --json` shows all of it.

## 3. Evidence that outlives the testnet reset

Commit `97454bf`. The testnet reset scheduled for 2026-12-16 at 17:00 UTC clears every account, transaction and historical record from Horizon ([Stellar networks](https://developers.stellar.org/docs/networks#testnet-and-futurenet-data-reset), read through the Raven MCP).

- `evidence/tests/testnet-ci-36560464977.txt`: the complete log of the 0.1.0 live tier, from `gh run view --log`, with the job name and timestamps at the start of each line, 875 colour codes and the runner's checkout directory (18 lines) removed; no seed-shaped string. GitHub keeps this repository's logs for 90 days (`GET /repos/0xsimoneth/dustin/actions/permissions/artifact-and-log-retention`).
- `evidence/tests/transactions/`: Horizon's record of each of the 208 transactions that the test matrix (34), the write-up, the baseline protocol and stories 3-1 to 3-4 cite only as text, as `GET /transactions/<hash>` answered (captured 2026-09-29 22:39 to 22:47 UTC); 14 other cited transactions already had their record in a run directory, and 3 cited 64-hex values are not transactions (the baseline recipe hash; the outer and inner hash of an envelope refused at validation, never on the ledger).
- `scripts/evidence-check.mjs` now judges every stored record offline (name, JSON, the record of that very transaction), compares it with Horizon's answer while the testnet keeps it (ledger, close time, result, envelopes), and fails a transaction that one of the seven documents cites without a stored record; nine new tests (`test/unit/scripts/evidence-check-stored.test.ts`).

## 4. The test counts

Commits `1d9e420` and `cd9605f`. Every current count now names the latest runs: the offline tier on `main` (`evidence/tests/offline.txt`, captured again at `97454bf` and then at `e563470`, the final package code: 125 files, 1236 tests in 8.72 s), and the live tier of 11 files and 58 tests, in CI on the 0.1.0 code (run 36560464977, 342 s) and on `e563470` (run [36757533611](https://github.com/0xsimoneth/dustin/actions/runs/36757533611), 345 s, dispatched on `main` because the testing entry changed the package code, with its log kept as `evidence/tests/testnet-ci-36757533611.txt`). The README, the evidence package, the write-up, the completion report and the test matrix (its state, the durations, the run list, and the "Last run" of all 29 tested rows) were swept; the images of both tiers were rendered again, the live one only so that its header names the rewritten commit.

## 5. Screenshots and the video

Commits `1b87096` (screenshots) and `194cab8` (video). StellarExpert's testnet index was one ledger behind Horizon on 2026-09-30.

- `scripts/demo/explorer-shots.mjs`, with the Playwright set-up of `make-demo.mjs`, captured the whole pages of the metric close into `evidence/runs/20260929T111408Z-e4-cli/`: the account ("Account (deleted)", "Balances unavailable", the merge first in its history), each transaction with every operation shown (successful, the account as source, the sponsor as fee source) and Horizon's 404, each under a strip with its URL and capture time, listed in `screenshots.json`. The completion report's screenshot placeholder is closed.
- The video was produced again with the storyboard's explorer shots on a fresh throwaway fixture (`messy-20260930T170147Z-b5d6bd`; the baseline fixture and the B-02 account were not touched): before the close, the account's page (balances, data entry, sponsored reserve) and its history (the two offers and the data entry being created); after it, the page loaded again and Horizon's 404. 59.80 s, 1920 x 1080, SHA-256 `6d2fe4c0afc2be94cb2b5cf056fcda4c1bb5a314a34903d87cda13b8538740dc`, at `evidence/demo/dustin-demo-60s.mp4`, not in git. The first take is kept as `evidence/demo/dustin-demo-60s-take-20260929T184550Z.mp4` (SHA-256 unchanged, `7de0640d…`), its captions and GIF in its take directory.
- One difference from the storyboard: StellarExpert's "Active Offers" tab kept its loading mark on testnet accounts holding open offers (over a minute, two accounts), so the offers are shown in the account's history.

## 6. The schemas in the package

Commits `34ca321` and `6a9622f`. The schemas moved to `schemas/` (their `$id` follows), `package.json` publishes `schemas/` and `CHANGELOG.md` and exports `stellar-dustin/schemas/*`, and `scripts/check-package.mjs` requires both schemas and resolves them through the package. FR-10 and FR-30 carry "As built" notes and are met as written; FR-04 (grouping), FR-05 (fees) and FR-09 (the exit codes of `dustin plan`) carry notes that point to canonical decisions 5 and 6 (and 7 for the fee); decision D-17 records it.

## 7. `stellar-dustin/testing` and the examples

Commit `e563470`.

- `src/testing.ts`: the `messy` and `edge` builders (every key from `Keypair.random()`, every account funded by Friendbot, no secret read from the environment or the caller), `checkMessyFixture()` (the check of `dustin fixture verify`, whose loader it now shares), the other checks, the manifest readers, and `recordedReader()`/`recordedFetch()` over a build's recorded Horizon responses. `test/unit/testing/testing.test.ts` covers the exports, keys never taken from the environment (two builds, twelve distinct new seeds, none equal to the stubbed secrets), the check and an offline plan of the recorded messy fixture.
- tsup builds it beside the SDK in ESM and CommonJS with declarations and shared chunks; `npm run check:package` (26 files) loads both formats and checks that an error the testing entry throws is an instance of the SDK's `DustinError`.
- `examples/close-with-sponsor.ts` (plan, `renderPlan`, the typed confirmation, `executeClose` with events, `allowPartial` and `preferDestination`, the error codes) and `examples/plan-a-fixture.ts`; `npm run typecheck:examples` checks them in CI against the built package's declarations, which strict mode also checks.
- The README and the integration notes (sections 1, 16 and 17) describe and link them; architecture sections 4.8, 4.10, 9 and 10 now describe the code as built; decision D-18 records it.

## 8. The public index

Commit `5db8c6f`: a dated state in `docs/README.md` (the "nothing built yet" sentences gone; open question 5 resolved by canonical decision 2); the rules written out in `docs/HANDOFF.md`, which says that `CLAUDE.md` is a local file git ignores; no SSH host alias left in the repository (the runbook uses the origin remote as configured locally); the sentence on the commits after 0.1.0 in `evidence/tests/README.md` made true; and the language exception for the Turkish copy of the chapter lead message in `CONTRIBUTING.md`.

## 9. The records

This commit: `docs/stories/sprint-status.yaml` (its session entry), `docs/progress-log.md`, `docs/HANDOFF.md` (the builder's list below), the evidence package's state, stories 4-3, 4-4, 4-6 and 4-7, and this page. `npm run evidence:check` on 2026-09-30 at 18:30 UTC: 22 files, 1,247 links, 12 listed transaction hashes and 208 stored transaction records; 1,431 ok, 34 "gone (merged)", 0 failed, 2 unchecked (the medium.com page behind a bot protection); exit 3.

## CI

| Commit | Run | Result |
|---|---|---|
| `622d1b8` | CI [36639605562](https://github.com/0xsimoneth/dustin/actions/runs/36639605562) | green (Node 22.12.0, 22, 24) |
| `bb42753` | CI [36640221301](https://github.com/0xsimoneth/dustin/actions/runs/36640221301) | green |
| `c6a2059` | CI [36640396873](https://github.com/0xsimoneth/dustin/actions/runs/36640396873) | green |
| `97454bf` | CI [36641823196](https://github.com/0xsimoneth/dustin/actions/runs/36641823196) | green |
| `1d9e420` | CI [36642378149](https://github.com/0xsimoneth/dustin/actions/runs/36642378149) | green |
| `1b87096` | CI [36748007051](https://github.com/0xsimoneth/dustin/actions/runs/36748007051) | green |
| `194cab8` | CI [36751576933](https://github.com/0xsimoneth/dustin/actions/runs/36751576933) | green |
| `34ca321` | CI [36754045741](https://github.com/0xsimoneth/dustin/actions/runs/36754045741) | failed: the commit held only the move of the schemas, and `schemas.test.ts` could not open `docs/plan-schema.json` (below) |
| `6a9622f` | CI [36754133871](https://github.com/0xsimoneth/dustin/actions/runs/36754133871) | green |
| `e563470` | CI [36757357773](https://github.com/0xsimoneth/dustin/actions/runs/36757357773); Testnet tier [36757533611](https://github.com/0xsimoneth/dustin/actions/runs/36757533611) | green; the live tier 11 files, 58 tests |
| `cd9605f` | CI [36758845171](https://github.com/0xsimoneth/dustin/actions/runs/36758845171) | green |
| `5db8c6f` | CI [36759021370](https://github.com/0xsimoneth/dustin/actions/runs/36759021370) | green |

The run of this commit is on the repository's Actions page; the session's final message names its result.

## What did not go as planned

- **An incomplete commit reached `main`.** The `git add` of `34ca321` named a path the move had already removed, so it staged nothing, and the commit carried only the renames that `git mv` had staged; its CI failed. `6a9622f` added the rest a minute later and CI passed; no force push was used (and the ruleset refuses one). Since then every commit was preceded by a check that nothing intended was left unstaged.
- **The local clean-up after the rewrite** (removing the old agent worktrees and branches) was refused by the permission classifier and is the builder's (step 9 of the runbook).
- **The network of the build machine paused for about fifteen minutes at a time**, several times; the page captures retry each page up to four times, and one after-close explorer shot needed a second attempt while StellarExpert ingested the merge.
- **StellarExpert's "Active Offers" tab** did not render on testnet (section 5).

## Left for the builder, in order

1. Record the existing tool on the baseline fixture (B-01) and on the prepared account (B-02); then the agent runs `node scripts/baseline-b03.mjs` (B-03).
2. A real screenshot of a CI run page as `evidence/tests/ci-run-<run id>.png` (E4-S3).
3. Watch the new video and approve it (E4-S6).
4. The message to the chapter lead and the written acknowledgement of the two-fixture reading.
5. `npm login` with 2FA and the publish of `stellar-dustin` 0.1.0.
6. "Apply the release runbook": the last session, with the tag, the release and the video as its asset, the links, and the completion report.
7. Optional: the GitHub Support request that drops the old commits from GitHub's caches, and the old agent worktrees and branches of the local copy (runbook steps 8 and 9).

## Sources

- git filter-repo manual (`--sensitive-data-removal`, `--replace-text`, `--mailmap`, the commit-map): https://github.com/newren/git-filter-repo/blob/main/Documentation/git-filter-repo.txt
- GitHub, removing sensitive data from a repository: https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository
- GitHub REST API, repository rulesets and their rules (`non_fast_forward`, `deletion`): https://docs.github.com/en/rest/repos/rules, https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets
- GitHub REST API, private vulnerability reporting: https://docs.github.com/en/rest/repos/repos#enable-private-vulnerability-reporting-for-a-repository
- GitHub CLI, `gh repo edit`: https://cli.github.com/manual/gh_repo_edit
- Stellar networks, testnet resets and the scheduled date: https://developers.stellar.org/docs/networks#testnet-and-futurenet-data-reset
- Horizon, retrieve a transaction: https://developers.stellar.org/docs/data/apis/horizon/api-reference/retrieve-a-transaction
- Fee-bump transactions (the fee account pays and signs the outer envelope): https://developers.stellar.org/docs/build/guides/transactions/fee-bump-transactions
- StellarExpert testnet explorer: https://stellar.expert/explorer/testnet
