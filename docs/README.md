# Dustin planning documents

Planning package for Dustin, the Stellar Instaward project defined in the accepted Statement of Work (`../SUCCESSFUL_SOW.md`). Everything here was produced on 2026-09-25 with the stellar-build methodology skills and personas, with protocol facts grounded through the Raven MCP against developers.stellar.org, the stellar-protocol CAPs, stellar-core and js-stellar-sdk sources, and live testnet probes. Nothing has been built yet; the sprint has not started.

The SOW is the contract. Where a document below proposes something the SOW does not require, it is labelled "stretch (outside SOW)".

## Read in this order

1. `../SUCCESSFUL_SOW.md`, the accepted scope, budget, weekly plan and evidence table.
2. `research/raven-ground-truth.md`, the verified protocol rules every other document relies on.
3. `product-brief.md` then `prd.md`, what is being built and the acceptance criteria.
4. `architecture.md` and `adr/`, how it is built and why.
5. `technical-spike.md` and `edge-cases-and-test-matrix.md`, the exact SDK calls, result codes, fixtures and the D3 matrix.
6. `epics-and-stories.md` and `stories/sprint-status.yaml`, the 200-hour work breakdown.
7. `ux-design.md`, `documentation-plan.md`, `evidence/`, `demo-video-script.md`, `write-up-outline.md`, the deliverable surfaces and the evidence package.
8. `analysis/`, `prfaq.md`, `premortem.md`, `skill-sweep.md`, `next-steps/`, positioning, risks and what comes after the 30 days.

## Document map

| Document | Answers | Produced with |
|---|---|---|
| `research/raven-ground-truth.md` | Merge preconditions, fee-bump rules, sponsored reserves, reserve arithmetic, sequence guard (stellar-core verified), testnet reset | Raven MCP + stellar-core source |
| `product-brief.md` | Problem, users, value, success metric, constraints, risks | nicole-pm, product-brief |
| `prd.md` | 30 FRs, 12 NFRs, 26 test cases, CLI and SDK surface, traceability to SOW D1-D4 and section 6.1, release plan | nicole-pm, prd |
| `prfaq.md` | Working-backwards press release and the hardest FAQ answers, including the SCF #44 competitors | prfaq |
| `ux-design.md` | CLI interaction design, confirmation gates, plan and report mockups, SDK ergonomics, 60-second storyboard | kaan-ux-designer, create-ux-design |
| `architecture.md`, `adr/ADR-0001..0006` | Components, ordering rules R1-R9, grouping, plan schema, executor recovery, security, verdict on frontend/backend/contract | tyler-architect, create-architecture, dapp, data, assets, standards, soroban |
| `technical-spike.md` | Exact SDK constructors, Horizon endpoints, fee-bump mechanics, Demolisher source analysis, toolchain versions, day-1 experiments | elliot-dev, dev-story |
| `edge-cases-and-test-matrix.md` | ~85 edge cases with result codes, the 31-row D3 matrix, fixture recipe, top-10 metric killers | review-edge-case-hunter, investigate |
| `epics-and-stories.md`, `stories/sprint-status.yaml` | Epic 0-4, 31 stories, 135 acceptance criteria, 200 h ledger matching the SOW budget, critical path | create-epics-and-stories |
| `documentation-plan.md`, `write-up-outline.md`, `evidence/evidence-package-template.md`, `demo-video-script.md` | README and integration-notes outlines, the write-up skeleton with glossary, the evidence package mirroring SOW 6.1/6.2, the 60-second shot list | bri-tech-writer |
| `analysis/competitive-landscape.md`, `analysis/market-and-integrators.md` | StellarExpert Demolisher (verified live and probed), LumenWipe, Account Demolisher (SCF #44), wallet built-ins, prior-art planner, dormant-account numbers, integrator segments | justin-analyst, stellar-competitive-landscape, scf-competitor-analyst |
| `premortem.md`, `skill-sweep.md` | 15 failure stories with mitigations, red team of the SOW's claims, minimum system, skill applicability, beyond-SOW ideas | brainstorming, advanced-elicitation |
| `next-steps/scf-path.md`, `next-steps/instaward-completion-report-template.md`, `next-steps/mainnet-readiness.md` | SCF round status, recommended next step, Build Award outline, completion report template, mainnet gate | scf-* skills, deploy-stellar-mainnet |

## Canonical decisions

The documents were written in parallel and disagree in a few places. The following decisions are canonical and override any conflicting sentence elsewhere.

1. **Scope of the 30 days: SDK + CLI only.** No frontend, no backend service, no smart contract. A Soroban contract cannot be a fee-bump fee source and adds nothing to the metric (ADR-0001); the sponsor key lives in an environment variable per the SOW (ADR-0002). A hosted sponsor relay and a web demo are post-Instaward stretch items only.
2. **Package name: `stellar-dustin`, binary `dustin`.** The bare npm name `dustin` belongs to an unrelated 2022 package. Reserve the scoped or prefixed name in week 1 under the repository's pseudonymous identity, with 2FA and a granular publish token.
3. **Two fixtures, not one.** The SOW's week-3 wording (the illiquid asset "exits through the unclosable path" while the fixture "is closed") cannot hold on one account, because an undisposable balance blocks trustline removal and therefore the merge. Fixture profile `messy` is the metric account: 4 trustlines with dust (3 self-reserved, 1 sponsored by a separate reserve sponsor), 2 open offers, 1 data entry, balance exactly at the minimum (4.0 XLM = zero spendable), every balance disposable, closed fully. Fixture profile `edge` carries a frozen authorization-required trustline and ends `partial` with an unclosable reason. "0 XLM" is read as zero spendable; a `literal-zero` fully sponsored variant is optional. The chapter lead should acknowledge this reading in writing during week 1.
4. **CLI contract.** `dustin plan <G> --to <G>` and `dustin close <G> --to <G> --execute [--yes] [--partial] [--json] [--memo <m>]`. `close` without `--execute` behaves exactly like `plan`. Execution shows the freshly re-inspected plan, then requires the user to type the last four characters of the destination address; `--yes` replaces that prompt and is honoured only with `--execute`. Unclosable items stop the run before anything is signed unless `--partial` is given (SDK option `allowPartial`). Secrets come from `DUSTIN_ACCOUNT_SECRET` and `DUSTIN_SPONSOR_SECRET`, a file, or a hidden prompt, never from argv. `--to` is canonical, `--destination` is an alias. This supersedes `--allow-partial` in the epics and the `--yes`-only flow in the PRD.
5. **Exit codes.** 0 plan printed or account closed and verified gone; 1 unexpected error; 2 usage or validation error (bad address, secret on argv, wrong key, mainnet requested, missing secrets); 3 nothing executed (confirmation missing or declined, or blockers without `--partial`); 4 partial, account still exists; 5 stopped or failed during execution, re-run to continue; 6 Horizon unreachable before any submission. This supersedes the PRD table and UX-DR4 in the epics.
6. **Transaction grouping.** Deterministic cleanup (cancel offers, delete data, issuer and destination returns, removals of emptied trustlines) goes into one fee-bumped transaction of up to 100 operations; each market-dependent path payment and its trustline removal is isolated in its own transaction; the merge joins the first transaction when there are no market steps (a simple messy account closes in one fee-bumped transaction) and otherwise runs alone last after a fresh preflight. The plan carries a content hash and is rebuilt if the account changed.
7. **Fees.** Every transaction is fee-bumped; the sponsor signs only the outer envelope and never the inner operations. The inner fee is 0. The base fee comes from Horizon `fee_stats` (p80) with a per-operation cap and a per-close budget (default 5 XLM); the CLI refuses to start when the sponsor cannot cover the budget. Testnet has real surge pricing (`max_fee` p50 of 204,000 stroops observed on 2026-09-25), so a fixed 100-stroop fee is not acceptable. Retries after `tx_too_late` rebuild with the same sequence; never rely on 10x replace-by-fee.
8. **Disposal ladder.** The SOW order is the default: path payment to XLM, return to issuer, transfer to the destination if it holds the trustline, otherwise unclosable with a stated reason. Because a payment to an existing issuer of an authorized trustline cannot fail, rung 3 is reachable only when the burn is impossible. **Approved by the builder on 2026-09-25:** the CLI flag `--prefer-destination` (SDK option `preferDestination: true`) tries the destination transfer before the return to issuer, then falls back to the burn; the default stays the SOW order, and the demo, fixture close and evidence are produced with the default. Path finding uses Horizon strict-send paths with `destMin` derived from the quote and a slippage bound; the account's own offers are cancelled first so they never count as liquidity.
9. **Arithmetic and SDK traps.** All amounts are BigInt stroops, never JS numbers; `changeTrust` limit is the string `"0"`; `AccountRequiresMemoError` (SEP-29) applies to the merge, so `--memo` exists; pool-share trustlines count two subentries and report `is_authorized: false` without being frozen.
10. **Sequence guard.** The merge fails when the post-increment sequence number is at or above `currentLedgerSeq << 32` (stellar-core `MergeOpFrame`). The planner reports `unblocksAtLedger = (seq >> 32) + 1` with a wait estimate of about 5 seconds per ledger; `BumpSequence` cannot lower a sequence number and is not a remedy.
11. **Merge blockers reported, not resolved.** `numSponsoring > 0` (including claimable balances the account created), liquidity pool shares, raised thresholds or a master weight of 0, `AUTH_IMMUTABLE`, and a missing or memo-required destination are detected in the plan with a remedy string. Sponsored trustlines are removed by the owner alone and their reserve returns to the reserve sponsor, so they contribute 0 to recovered XLM; the report attributes every stroop.
12. **Evidence durability.** Testnet resets to genesis about quarterly; the next reset is scheduled for 2026-12-16 17:00 UTC and deletes every account, transaction and explorer link. The evidence package therefore stores transaction XDR, Horizon JSON, screenshots and the video in the repository, and the fixture builder is one idempotent command. The sprint runs 2026-09-22 to 2026-10-22, so the review window stays clear of the reset.
13. **Positioning.** Never claim "the only tool that closes zero-XLM accounts". SCF #44 ran an "Account Demolisher" RFP and funded LumenWipe (hosted API plus thin SDK client; a hosted fee-bump sponsor endpoint was merged on 2026-09-08, still listed as roadmap in its README, production status unknown) and Account Demolisher (web app that rejects fee-bump envelopes). An unfunded prior-art planner with a mandatory dry-run also exists. Dustin's verifiable position is: an embeddable, backend-free library and CLI; plan-first with a read-only planner; fee-bumped close of zero-XLM accounts with the integrator's own sponsor key; sponsored-reserve accounting; a published fixture, test matrix and baseline recording. The write-up acknowledges the SCF #44 awardees and the prior-art planner.
14. **StellarExpert Demolisher facts.** Verified on 2026-09-25: the client is MIT-licensed inside the explorer monorepo, every transaction is sourced from and paid by the closed account, there is no fee-bump or sponsorship logic, no preview, secrets are pasted into the browser, and the tool is live (route present, testnet co-signer responding). The below-1-XLM co-sign refusal was confirmed by a black-box probe (0.5 and 0.9999999 XLM rejected, 1 and 5 XLM signed). The baseline recording still has to show it, per PRD FR-25.

## Sprint calendar

| Sprint week | Dates | SOW expected output |
|---|---|---|
| Day 1 | 2026-09-22 | Funds received; sprint clock starts |
| Week 1 | 2026-09-22 to 2026-09-28 | Fixture built, Demolisher baseline recorded, planClose() dry run printed |
| Week 2 | 2026-09-29 to 2026-10-05 | Zero-XLM account closed end to end with sponsored fees |
| Week 3 | 2026-10-06 to 2026-10-12 | Disposal ladder, sponsored unwind, sequence guard, test matrix, messy fixture closed |
| Week 4 | 2026-10-13 to 2026-10-19 | npm publish, 60-second demo, evidence package, write-up |
| Buffer | 2026-10-20 to 2026-10-22 | Review fixes; **final deadline 2026-10-22** |

## Open questions for the builder and the chapter lead

1. Resolved: funds were received on 2026-09-22 and the final deadline is 2026-10-22. Week dates are in the calendar below; today (2026-09-25) is day 4 with no code written yet, so Epic 0 and the fixture must start immediately.
2. Written acknowledgement of the two-fixture reading of week 3 (decision 3).
3. Payment to an issuer that has been merged away: one analysis reads stellar-core as burning without checking the destination, another expects `op_no_destination`. Settle it with the day-1 experiment in `technical-spike.md` section 8.4 before the ladder is coded.
4. Resolved: ladder policy is decision 8 (SOW order by default, `--prefer-destination` as an option), approved 2026-09-25.
5. Publishing identity: the npm organisation or prefix, matching the repository's pseudonymous identity, plus 2FA.
6. Video hosting for the 60-second demo, and whether the raw take is archived in the repository.
7. After the sprint: follow-on Instaward versus SCF Build Award, and whether Instaward funding counts toward the SCF lifetime cap (`next-steps/scf-path.md`; SCF #46 Build submission deadline is 2026-11-08).

## Known disagreements between documents

Resolved by the canonical decisions above: exit-code tables (ux-design vs prd vs epics UX-DR4); `--partial` vs `--allow-partial`; `--to` vs `--destination`; the typed-confirmation field (destination tail vs account tail); the package name (`dustin` vs `stellar-dustin`); whether the below-1-XLM Demolisher rule is verified (it is, by probe, since the analysis document was written); whether a merged issuer makes a balance unclosable (open question 3).

## Day-1 checklist

- Confirm the start date and the fixture reading with the chapter lead.
- Run the day-1 experiments from `technical-spike.md` section 8.4 and the ISS test.
- Scaffold the repository (Epic 0), reserve the npm name, enable CI with a gated testnet job.
- Build fixture `messy` from the recipe in `edge-cases-and-test-matrix.md`, verify it, record the Demolisher baseline on it, re-verify the fixture unchanged.
- Freeze the plan JSON schema and the `UnclosableCode` enum before writing the executor.
