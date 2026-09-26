# Handoff prompt for the implementation agent

Paste everything below this line into a fresh Claude Code session opened in the repository root.

---

You are taking over Dustin, a Stellar Instaward project ($5,000, 30 days) that closes messy Stellar classic accounts with fee-bumped sponsored transactions. Planning is complete; your job is to build it. Implementation started on 2026-09-26: read `docs/progress-log.md` and `docs/stories/sprint-status.yaml` first to see what is done, in review, or blocked, and continue from the "Next" line of the latest session summary.

## Hard rules

1. Read `CLAUDE.md` in the repository root and follow it: commits authored only as `0xsimoneth` (verify `git config user.name` and `git config user.email` before the first commit and stop if they differ), the `origin` remote must stay exactly as `CLAUDE.md` specifies, run `gh auth switch --user 0xsimoneth` before any `gh` command, no "Co-Authored-By" or "Generated with" lines, no personal names, emails, usernames or local absolute paths anywhere in code, docs, commits or PRs, everything in English.
2. Do not touch `stellar-build/`, `.stellar-build/`, `CLAUDE.md` or `.git/info/exclude`.
3. Testnet only. Never configure, sign for or submit to mainnet. Never print, log or commit a secret; secrets come from `DUSTIN_ACCOUNT_SECRET` and `DUSTIN_SPONSOR_SECRET` (a `.env.example` documents them, `.env` is gitignored).
4. Do not publish to npm, create GitHub releases or record videos yourself; prepare them and hand the action to the builder.
5. For any Stellar protocol or SDK fact, do not answer from memory: use the Raven MCP (`mcp__stellar-raven__search`, then `mcp__stellar-raven__execute` with `stellarDocs.*`, `scout.*`), the js-stellar-sdk source, or stellar-core source, and cite the URL in a code comment or doc. `docs/research/raven-ground-truth.md` already holds the verified rules.

## Read first, in this order (about 8,000 lines, all of it)

1. `docs/README.md`: document map, the 14 canonical decisions that override anything else, the sprint calendar, open questions, day-1 checklist.
2. `SUCCESSFUL_SOW.md`: the contract. Deliverables D1 to D4, the binary success metric, section 6.1 evidence, the weekly expected outputs.
3. `docs/research/raven-ground-truth.md`: merge preconditions, fee-bump rules, sponsored reserves, reserve arithmetic, the sequence guard (`seq >= ledgerSeq << 32`), testnet reset.
4. `docs/prd.md`: FR-01 to FR-30, NFR-01 to NFR-12, CLI and SDK surfaces, test cases, the "Decisions after review" section.
5. `docs/architecture.md` and `docs/adr/ADR-0001` to `ADR-0006`.
6. `docs/technical-spike.md`: exact SDK constructors, Horizon endpoints, fee-bump mechanics, toolchain versions, section 8.4 day-1 experiments.
7. `docs/edge-cases-and-test-matrix.md`: the 31-row D3 matrix and the fixture recipe.
8. `docs/epics-and-stories.md` and `docs/stories/sprint-status.yaml`: the 31 stories with acceptance criteria; keep the YAML statuses current.
9. `docs/ux-design.md`: CLI contract, confirmation gates, plan and report layouts, exit codes.
10. `docs/documentation-plan.md`, `docs/write-up-outline.md`, `docs/evidence/evidence-package-template.md`, `docs/demo-video-script.md`: what D4 must look like.
11. `docs/analysis/`, `docs/prfaq.md`, `docs/premortem.md`, `docs/next-steps/`: positioning, risks, what happens after the sprint. Skim.

Where documents disagree, `docs/README.md` "Canonical decisions" wins. Summarise them back in your first message so the builder can correct you.

## Calendar

Funds received 2026-09-22, final deadline 2026-10-22. Week 1 ends 2026-09-28 (fixture, baseline recording, `planClose()` dry run), week 2 ends 2026-10-05 (zero-XLM account closed end to end with sponsored fees), week 3 ends 2026-10-12 (ladder, sponsored unwind, sequence guard, test matrix, messy fixture closed), week 4 ends 2026-10-19 (npm publish, demo, evidence, write-up), buffer to 2026-10-22. Check today's date and say where the sprint stands.

## How to work

- Use the stellar-build skills: `elliot-dev` plus `dev-story` for each story, `code-review` and `review-edge-case-hunter` before marking a story done, `investigate` when something fails on testnet.
- Test first (red, green, refactor). Offline unit tests with recorded Horizon fixtures run on every commit; testnet integration tests run behind an explicit flag and build a fresh fixture per run.
- One commit per story or smaller, English messages, story ID in the message. Update `docs/stories/sprint-status.yaml` when a story changes state and append a dated entry to `docs/progress-log.md` (create it) at the end of every session: what was done, what is blocked, next step.
- Non-negotiable technical decisions (from `docs/README.md`): package `stellar-dustin` with bin `dustin`; TypeScript 5.9, tsup (ESM and CJS), vitest, commander, Node 22.12 or newer, `@stellar/stellar-sdk` 17.1.0 pinned; Horizon only; every transaction fee-bumped with the sponsor signing only the outer envelope and the inner fee set to 0; base fee from `fee_stats` p80 with a per-operation cap and a per-close budget of 5 XLM; all amounts as BigInt stroops; `changeTrust` limit as the string `"0"`; `close` without `--execute` is a dry run; typed confirmation is the last four characters of the destination; `--yes` only with `--execute`; `--partial` to proceed with unclosable items; exit codes 0 to 6 as in `docs/README.md` decision 5; two fixtures, `messy` for the metric and `edge` for the unclosable case; ladder in SOW order by default with `--prefer-destination` as an option (decision 8, approved); planner is pure and type-level unable to sign; sequence guard reported as `unblocksAtLedger`.

## Review findings to close first

An independent review of Epics 0 to 2 is in `docs/reviews/2026-09-26-e0-e2-review.md`. Before starting E2-S3 proper, close R1 (report survives thrown errors), R2 (refuse over-budget plans before signing) and R6 (testnet Horizon check on every entry point); fold R7, R9 to R12, R17 and R18 into E2-S3/E2-S4; R13 and R14 belong to E3-S5; R15 is a tracker fix; R16 defines what E2-S6 must commit under `evidence/runs/`. Do not run a live evidence close until R1 to R3 are closed.

## Start here (day 1)

1. Run the day-1 experiments from `docs/technical-spike.md` section 8.4 on testnet with throwaway keys, including the merged-issuer payment test (`docs/README.md` open question 3), and record the results in `docs/progress-log.md`. The ladder code depends on that answer.
2. Epic 0: scaffold the repository exactly as `docs/architecture.md` section "Repository layout" describes, with lint, tests, CI (offline tier on every push, testnet tier gated), MIT license, `.env.example`, a testnet-only guard, and a README skeleton from `docs/documentation-plan.md`. Prepare `npm publish --dry-run`; the builder reserves the npm name.
3. Epic 1: fixture builder for the `messy` profile from the recipe in `docs/edge-cases-and-test-matrix.md`, a `fixture verify` command that checks every SOW Appendix B precondition, then the inspector, the ordering engine, grouping and fee estimation, the dry-run guarantee, and `dustin plan` with the committed plan output for the fixture.
4. Tell the builder when a human action is needed: reserving the npm name with 2FA, the chapter lead's written acknowledgement of the two-fixture reading, recording the Demolisher baseline and the 60-second demo, and choosing video hosting.

Begin by reading the documents, then reply with: the sprint day and what is due this week, the canonical decisions in your own words, the day-1 experiment plan, and the first three stories you will implement.
