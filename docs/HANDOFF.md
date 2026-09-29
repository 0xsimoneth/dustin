# Handoff: the sprint is technically complete; the builder's actions remain

State on 2026-09-29, sprint day 8 (funds received 2026-09-22; the final deadline, 2026-10-22, is 23 days away).

Everything the SOW asks for that an agent can do is done and recorded: `planClose()` and `dustin plan` (D1), `executeClose()` and `dustin close --execute` with sponsor-paid fee bumps, closed live on testnet many times (D2), the edge-case matrix with its fixtures and both test tiers (D3), the README, integration notes, write-up and evidence package (D4), the npm package prepared as `stellar-dustin` 0.1.0, and the 60-second video produced from the rehearsal script on a fresh fixture. What is left needs the builder: a recording, a screenshot, an upload, a message, a publish, and the decision on the history.

## The builder's actions, in order

Each line names its runbook, and what the agent does once the builder says it is done.

| # | Action | How | Then the agent |
|---|---|---|---|
| 1 | Done on 2026-09-30: the history rewrite (review findings R4, R5; decision D-7) | [`runbooks/history-rewrite.md`](runbooks/history-rewrite.md), "Done on 2026-09-30"; left for the builder: the GitHub Support request (step 8) and the old agent worktrees of the local copy (step 9) | Recorded in the PRD (D-7), the tracker and the progress log |
| 2 | Record the existing tool on the baseline fixture (B-01), and on the recipe plus 1 XLM (B-02) | [`../evidence/baseline/README.md`](../evidence/baseline/README.md); `node scripts/baseline-b03.mjs --prepare-b02` builds the B-02 account | Runs B-03, `node scripts/baseline-b03.mjs` (one command: two closes of the rebuilt recipe and `evidence/baseline/b03-comparison.md`), fills the baseline links, moves E1-S2 and E4-S7 on |
| 3 | Take a screenshot of the CI run page | `evidence/tests/ci-run-<run id>.png`, slot in [`../evidence/tests/README.md`](../evidence/tests/README.md#the-ci-screenshot) (decision D-16) | Commits it, names it in the evidence, moves E4-S3 to done |
| 4 | Watch the video, approve it, host it | `evidence/demo/dustin-demo-60s.mp4` (local, not in git; its record is `evidence/demo/take-*/summary.md`); hosting as the `v0.1.0` release asset, step 4 of [`runbooks/release.md`](runbooks/release.md) | Fills the video link in the README, `evidence/README.md`, `evidence/demo/README.md` and the completion report; E4-S6 done |
| 5 | Send the message to the chapter lead and get the written acknowledgement of the two-fixture reading | [`runbooks/chapter-lead-message.md`](runbooks/chapter-lead-message.md) (English and Turkish) | Records the date (the reply stays off the repository) |
| 6 | `npm login` with 2FA and `npm publish`; approve the tag and the release | [`runbooks/release.md`](runbooks/release.md) (private vulnerability reporting is on since 2026-09-30) | Checks the registry, tags `v0.1.0`, drafts the release with the video, updates every link; E4-S4 done |
| 7 | Fill the completion report's hours, dates and next step, check it in a fresh browser, send it | [`../evidence/completion-report.md`](../evidence/completion-report.md), sections E, H and I | Closes the tracker (E4-S7, Epic 4) and the progress log |

## For the next agent session

Paste everything below this line into a fresh Claude Code session opened in the repository root.

---

You are continuing Dustin, a Stellar Instaward project ($5,000, deadline 2026-10-22) whose technical work is complete. Your job is to support the builder's remaining actions, listed in order in `docs/HANDOFF.md`, and to record each one when the builder says it is done. Read `docs/progress-log.md` (the latest entry) and `docs/stories/sprint-status.yaml` first.

Hard rules:

1. Follow `CLAUDE.md`: commits only as `0xsimoneth` (check `git config user.name` and `git config user.email` before the first commit and stop if they differ), `origin` exactly as `CLAUDE.md` says, `gh auth switch --user 0xsimoneth` before any `gh` command, no "Co-Authored-By" or "Generated with" lines, no personal names, e-mails, usernames or local absolute paths anywhere, everything in English.
2. Testnet only; never weaken the mainnet refusal; secrets only on the `close --execute` path, from the environment, `.env` or the hidden prompt; throwaway keys for live runs.
3. The builder's own actions stay the builder's: the Demolisher recordings, the npm publish, approving the tag and the release, the force push of a history rewrite, and every message to the chapter lead. Prepare them; never do them unasked.
4. Never touch the baseline fixture `messy-20260926T035942Z` (its keys are in `.fixture/`, ignored by git).
5. Stellar facts come from the Raven MCP or the sources, with URLs, never from memory; `docs/research/raven-ground-truth.md` holds the verified rules.
6. After any change: `npm run format:check`, `npm run lint`, `npm run typecheck`, `npm test`, and `npm run evidence:check` for evidence; stage explicit paths; push only on the builder's word, then check CI with `gh run list`.

Where things are: the runbooks in `docs/runbooks/`; the evidence package `evidence/README.md` (what is pending is listed at its end); the completion report draft `evidence/completion-report.md`; the video's generator `scripts/demo/make-demo.mjs` and its take records `evidence/demo/take-*/`; B-03 `scripts/baseline-b03.mjs`; the hash remap after a rewrite `scripts/remap-commit-hashes.mjs`. `grep -rn '<pending:' README.md evidence docs` lists every slot the builder's actions fill.
