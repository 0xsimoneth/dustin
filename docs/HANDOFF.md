# Handoff: the sprint is technically complete; the builder's actions remain

State on 2026-09-30, sprint day 9 (funds received 2026-09-22; the final deadline, 2026-10-22, is 22 days away).

Everything the SOW asks for that an agent can do is done and recorded: `planClose()` and `dustin plan` (D1), `executeClose()` and `dustin close --execute` with sponsor-paid fee bumps, closed live on testnet many times (D2), the edge-case matrix with its fixtures and both test tiers (D3), the README, integration notes, write-up and evidence package (D4), the npm package prepared as `stellar-dustin` 0.1.0 with its JSON schemas and `stellar-dustin/testing`, and the 60-second video, produced again on 2026-09-30 with StellarExpert's pages. The history was rewritten on 2026-09-30 and `main` refuses force pushes. What is left needs the builder: a recording, a screenshot, an approval, a message, a publish, and the release session. The audit of 2026-09-30 is [`reviews/2026-09-30-final-audit.md`](reviews/2026-09-30-final-audit.md).

## The builder's actions, in order

Each line names its runbook, and what the agent does once the builder says it is done.

| # | Action | How | Then the agent |
|---|---|---|---|
| 1 | Record the existing tool on the baseline fixture (B-01), and on the recipe plus 1 XLM (B-02) | [`../evidence/baseline/README.md`](../evidence/baseline/README.md); the B-02 account is prepared (`GCT4MKGXIAT246OV246CVYXIZYT3FLXVOBIQ5BQ4Q5CQPKZGD7JBX4MM`, 1 XLM spendable) | Runs B-03, `node scripts/baseline-b03.mjs` (one command: two closes of the rebuilt recipe and `evidence/baseline/b03-comparison.md`), fills the baseline links, moves E1-S2 and E4-S7 on |
| 2 | Take a screenshot of the CI run page | `evidence/tests/ci-run-<run id>.png`, slot in [`../evidence/tests/README.md`](../evidence/tests/README.md#the-ci-screenshot) (decision D-16); the latest run of the live tier is [Testnet tier, run 36757533611](https://github.com/0xsimoneth/dustin/actions/runs/36757533611) | Commits it, names it in the evidence, moves E4-S3 to done |
| 3 | Watch the new video and approve it | `evidence/demo/dustin-demo-60s.mp4` (local, not in git; SHA-256 `6d2fe4c0afc2be94cb2b5cf056fcda4c1bb5a314a34903d87cda13b8538740dc`; its record is [`../evidence/demo/README.md`](../evidence/demo/README.md)); the first take stays beside it as a backup | Hosts it in the release session (step 6) |
| 4 | Send the message to the chapter lead and get the written acknowledgement of the two-fixture reading | [`runbooks/chapter-lead-message.md`](runbooks/chapter-lead-message.md) (English and Turkish) | Records the date (the reply stays off the repository) |
| 5 | `npm login` with 2FA and `npm publish` of 0.1.0 | [`runbooks/release.md`](runbooks/release.md), "The builder: publish to npm"; `npm pack --dry-run` lists 26 files | Checks what the registry serves |
| 6 | Say "apply the release runbook" to start the last session | [`runbooks/release.md`](runbooks/release.md): the tag `v0.1.0`, the GitHub release with the video as an asset, every link, the completion report ([`../evidence/completion-report.md`](../evidence/completion-report.md), its hours, dates and next step for the builder to fill and send) | Tags, drafts the release, fills the links; E4-S4, E4-S6, E4-S7 and Epic 4 close |
| 7 | Optional: ask GitHub Support to drop the old commits from its caches, and clear the old history from the local copy | [`runbooks/history-rewrite.md`](runbooks/history-rewrite.md), steps 8 and 9: the Support request (first changed commit `bedc4a6`), and in the usual working copy the agent worktrees of past sessions and their branches, which still point at the old history (keep the `.fixture/` keys one of them holds) | Records the ticket and the date |

## For the next agent session

Paste everything below this line into a fresh Claude Code session opened in the repository root.

---

You are continuing Dustin, a Stellar Instaward project ($5,000, deadline 2026-10-22) whose technical work is complete. Your job is to support the builder's remaining actions, listed in order in `docs/HANDOFF.md`, and to record each one when the builder says it is done. Read `docs/progress-log.md` (the latest entry) and `docs/stories/sprint-status.yaml` first.

Hard rules (they are written out here because `CLAUDE.md`, which holds them for Claude Code, is a local file of the builder's working copy: git ignores it, so it is not in the public repository):

1. Git and GitHub: every commit is authored as `0xsimoneth` <`333815469+0xsimoneth@users.noreply.github.com`>; check `git config user.name` and `git config user.email` before the first commit of a session and stop if either differs. Keep the `origin` remote as configured locally; never point it at another host or account, and never change global git, SSH or credential settings. Before any `gh` command, switch to that account (`gh auth switch --user 0xsimoneth`) and confirm it with `gh auth status`. `main` refuses force pushes and deletion (a repository ruleset since 2026-09-30).
2. Content: no "Co-Authored-By" or "Generated with" lines in commits or pull requests; no personal names, e-mails, usernames or local absolute paths in commits, issues, pull requests, code, comments or documents; everything in English, except the Turkish copy of the chapter lead message (`CONTRIBUTING.md`).
3. Testnet only; never weaken the mainnet refusal; secrets only on the `close --execute` path, from the environment, `.env` or the hidden prompt; throwaway keys for live runs.
4. The builder's own actions stay the builder's: the Demolisher recordings, the npm publish, approving the tag and the release, the force push of a history rewrite, and every message to the chapter lead. Prepare them; never do them unasked.
5. Never touch the baseline fixture `messy-20260926T035942Z` or the account prepared for the B-02 recording (`GCT4MKGXIAT246OV246CVYXIZYT3FLXVOBIQ5BQ4Q5CQPKZGD7JBX4MM`); their keys are in `.fixture/`, which git ignores. The other throwaway fixtures under `.fixture/` are left as they are: no clean-up (the builder's decision of 2026-09-30).
6. Stellar facts come from the Raven MCP or the sources, with URLs, never from memory; `docs/research/raven-ground-truth.md` holds the verified rules.
7. After any change: `npm run format:check`, `npm run lint`, `npm run typecheck`, `npm test`, and `npm run evidence:check` for evidence; stage explicit paths; push only on the builder's word, then check CI with `gh run list`.

Where things are: the runbooks in `docs/runbooks/`; the evidence package `evidence/README.md` (what is pending is listed at its end); the completion report draft `evidence/completion-report.md`; the video's generator `scripts/demo/make-demo.mjs` and its take records `evidence/demo/take-*/`; the screenshots of a run's public pages `scripts/demo/explorer-shots.mjs`; Horizon's records of the transactions the documents cite `evidence/tests/transactions/`; the fixture helpers for tests `src/testing.ts` (`stellar-dustin/testing`) and the examples `examples/`; B-03 `scripts/baseline-b03.mjs`; the hash remap after a rewrite `scripts/remap-commit-hashes.mjs`. `grep -rn '<pending:' README.md evidence docs` lists every slot the builder's actions fill.
