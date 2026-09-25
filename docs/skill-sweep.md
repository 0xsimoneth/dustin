# Dustin — Skill Sweep and Beyond-SOW Brainstorm

Written 2026-09-25 against the accepted Statement of Work (`SUCCESSFUL_SOW.md`). Method: every installed stellar-build skill (bundle skills, the SCF lifecycle skills, the Stellar dev knowledge modules) plus the installed `demo-video` skill was read at its `SKILL.md` and mapped to Dustin's 30-day scope; then the `brainstorming` skill was run non-interactively (AI-recommended technique path) to list what lies beyond the SOW. The builder is referred to as "the builder".

Phases follow the installed `SKILL_ROUTER.md` journey (idea → planning → solutioning → implementation → review → launch → meta), plus "loop" for the learning-loop skills. Other skills installed on this machine that are not part of stellar-build (Cloudflare, OKX, sandbox, and plugin skills) were excluded: none touch a testnet CLI/SDK with no hosting.

Legend for "Applicable now": **yes** = use during the 30 days; **yes (light)** = a bounded pass of an hour or two; **optional** = harmless, not on the critical path; **later** = post-Instaward; **no** = not applicable to this scope.

## 1. Applicability sweep

| Skill | Phase | Applicable now | How exactly it would be used (one line) | Feeds |
|---|---|---|---|---|
| find-stellar-idea | Idea | no | The idea is fixed by an accepted SOW; re-running ideation would only invite scope creep. | — |
| brainstorming | Idea | yes | Run once (done, section 2) to park every non-SOW idea in a ranked list; re-run in Week 4 for the follow-on plan. | `docs/skill-sweep.md`, post-Instaward roadmap |
| stellar-competitive-landscape | Idea | yes | Query the LumenLoop directory for "account demolisher"; it returns the two SCF #44 RFP responders that the write-up must cite. | D4 write-up ("related work"), `docs/premortem.md` red team |
| scf-round-watcher | Idea | later | Check the open SCF round and deadlines when deciding the SOW section 7 next step (RFP track alignment vs Open track). | Next-step decision (SOW §7) |
| justin-analyst | Idea | yes (light) | One positioning pass: restate Dustin's differentiator against the RFP cohort as "fee-sponsored close for accounts that cannot pay". | D4 write-up positioning paragraph |
| advanced-elicitation | Idea | yes | Pre-mortem, red team and first principles against the SOW (done); rerun the pre-mortem at the Week 2 go/no-go. | `docs/premortem.md` |
| nicole-pm | Planning | no | The accepted SOW is the requirements document; a parallel PRD would fork the source of truth. | — |
| kaan-ux-designer | Planning | no | No UI is in scope; the CLI's plan rendering is a documentation concern, handled by bri-tech-writer. | — |
| prd | Planning | no | Same reason as nicole-pm; the SOW's Appendix B is the acceptance spec. | — |
| prfaq | Planning | no | Working Backwards is for forging a concept; the concept is accepted and funded. | — |
| product-brief | Planning | later | A one-page brief is the right input for an SCF interest form or referral after the Instaward evidence is accepted. | SCF interest form / referral package |
| create-ux-design | Planning | no | No screens to specify. | — |
| tyler-architect | Solutioning | yes (light) | A two-hour architecture pass to fix five decisions: single atomic transaction, pure planner over a snapshot, fee-bump-only submission boundary, Horizon dependency, evidence writer. | `docs/architecture.md` (short ADR list) |
| create-architecture | Solutioning | yes (light) | Use its decision format only, skipping the PRD prerequisite; produce one page, not the full workflow. | `docs/architecture.md`, write-up "ordering rules" |
| create-epics-and-stories | Solutioning | yes | Turn D1–D4 and the weekly plan into ~12 stories whose acceptance criteria are the Appendix B checkboxes and the matrix cases. | `docs/stories/*.md` |
| soroban | Solutioning | no | No contract is involved; classic operations only. | — |
| smart-contracts | Solutioning | no | Same as soroban. | — |
| dapp | Solutioning | yes (partial) | Its stellar-sdk transaction building, submission and error-handling guidance (Node.js) applies to `executeClose()`; ignore the wallet/browser sections. | `executeClose()` implementation, README integration notes |
| assets | Solutioning | yes | Issue the fixture assets, set and read authorization/clawback flags, and get `ChangeTrust` semantics right for the ladder and the matrix. | Fixture script, D3 matrix, write-up |
| data | Solutioning | yes | Horizon endpoints for accounts, offers, strict-send paths and fee stats; RPC health/send/get transaction; rate-limit handling. | `planClose()` inspector, premortem story #9 |
| agentic-payments | Solutioning | no | x402/MPP are unrelated; its "fee-sponsored client" pattern is at most a reference for the sponsor design. | — |
| zk-proofs | Solutioning | no | Not relevant. | — |
| cross-chain | Solutioning | no | Not relevant. | — |
| stellar-anchor-skill | Solutioning | no | No fiat rails or SEP-24/6 flows. | — |
| standards | Solutioning | yes (light) | Cite CAP-15 (fee bumps), CAP-33 (sponsored reserves) and CAP-1 (bump sequence) in the write-up; check SEP-7 for a keyless signing stretch idea. | Write-up references |
| elliot-dev | Implementation | yes | The persona for story execution with test-first discipline in Weeks 1–3. | Code, story completion notes |
| dev-story | Implementation | yes | Execute the stories from create-epics-and-stories one at a time, updating their status. | `docs/stories/*.md`, code |
| investigate | Implementation | yes (on demand) | When a testnet submission fails with an opaque result code, open a case file from decoded result XDR instead of guessing. | README troubleshooting, known limits |
| party-mode | Implementation | optional | One roundtable (analyst, architect, developer, writer) at the Week 3 go/no-go before the final recorded close. | Go/no-go note |
| code-review | Review | yes | Run before the first testnet close (Week 2) and before publish (Week 4) on the ordering engine and the fee-bump boundary. | Review notes, D3 matrix additions |
| review-edge-case-hunter | Review | yes | Run on the ordering function and the disposal ladder; its unhandled-path list seeds the D3 edge-case matrix. | D3 test matrix |
| deploy-stellar-mainnet | Launch | no | Mainnet is out of scope; revisit its key-management and monitoring gates only in a post-Instaward mainnet phase. | — |
| scf-interest-form-drafter | Launch | later | If the next step is an SCF application, draft the interest form from the evidence package. | SCF interest form |
| scf-referral-preparer | Launch | later | The chapter lead is a natural referrer; prepare the referral package after the Instaward is accepted. | Referral package |
| scf-prescreen-checker | Launch | later | Self-check a future Build Award draft. | SCF draft |
| scf-submission-drafter | Launch | later | Draft the Build Award application from the write-up and evidence. | SCF draft |
| scf-budget-builder | Launch | later | Its rate benchmarks are for six-figure Build Awards; the only use now is a 30-minute sanity check of the 60/80/40/20 hour split. | Internal hour rebalancing |
| scf-competitor-analyst | Launch | yes | Structured overlap/differentiation table against LumenWipe, the Account Demolisher app, the Apache-2.0 RFP SDK and the StellarExpert tool. | D4 write-up "related work" |
| scf-reviewer | Launch | yes (light) | In Week 4, read the evidence package with its "verify every link and claim" rule to catch what a sceptical reviewer would. | Evidence package QA |
| scf-round-reviewer | Launch | no | Reviews whole rounds from a CSV export; not a builder tool. | — |
| scf-tranche-reporter | Launch | yes (adapted) | Its deliverable → completion criteria → evidence → how-to-verify format is the best available template for the SOW section 6 evidence table. | `EVIDENCE.md` / evidence package |
| fetch-external-doc | Launch | no | Built for reviewers fetching submission attachments; nothing to fetch here. | — |
| navigate-skills | Meta | no | Discovery only; this sweep supersedes it. | — |
| stellar-help | Meta | no | Orientation only. | — |
| bri-tech-writer | Meta | yes | README, integration notes, the write-up (ordering rules and known limits), the evidence narrative and the 60-second video script. | All of D4 |
| learning-loop | Loop | no (passive) | Runs in the background; no action needed. | — |
| optimize-skills | Loop | no | Not part of delivering the SOW. | — |
| bench-skills | Loop | no | Not part of delivering the SOW. | — |
| reprompt | Loop | optional | Sharpen each story prompt before a dev-story run. | Story prompts |
| demo-video | Other (installed, not stellar-build) | no | It captures web apps through Playwright; the deliverable is a CLI recording, so use a terminal recorder or screen capture instead. | — |

### Use-now sequence (what the sweep implies for the 30 days)
1. Week 0–1: `advanced-elicitation` (done), `stellar-competitive-landscape` + `scf-competitor-analyst` (related-work table), `tyler-architect`/`create-architecture` (one page), `create-epics-and-stories` (stories with Appendix B criteria).
2. Weeks 1–3: `elliot-dev` + `dev-story`, `assets`, `data`, `dapp` (partial), `investigate` on failures, `review-edge-case-hunter` before the matrix, `code-review` before the first testnet close.
3. Week 4: `bri-tech-writer`, `scf-tranche-reporter` (adapted evidence format), `scf-reviewer` (light QA), `code-review` before publish, `brainstorming` for the follow-on plan.

## 2. Brainstorm: beyond the SOW

Session parameters: topic "what Dustin could become after the metric passes"; goals "a ranked stretch list and a clear scope verdict"; techniques (from the skill's registry) Reverse Brainstorming, SCAMPER, Role Playing (wallet developer, custodian operations lead, asset issuer, chapter reviewer, SCF reviewer), Resource Constraints, Question Storming; domain pivots every ten ideas (integration → services → reports → completeness → ecosystem → safety). Every item below is a **stretch (outside SOW)** unless marked otherwise.

### Raw inventory (grouped)
- **Integration surfaces.** Wallet SDK adapter with a signing callback (the account key never enters Dustin); keyless close via a SEP-7 transaction URI that any wallet signs, after which the sponsor fee-bumps; Stellar CLI plugin (`stellar close`); an MCP tool exposing the read-only planner to agent wallets; a Wallets Kit demo page.
- **Services.** Hosted fee-bump sponsor endpoint with policy checks; batch closer for custodians from a CSV; testnet "messy fixture generator" other teams can run after each reset; a `verify` command that checks an evidence bundle offline.
- **Reports.** Account-hygiene report ("what is locking your XLM"); dust-sweeper mode without closing; reserve calculator per wallet cohort; static HTML report export.
- **Completeness.** Liquidity-pool withdrawal; claimable-balance handling; multisig signature collection; mainnet hardening with hardware or KMS signing; Soroban sponsor vault.
- **Ecosystem.** Upstream the sponsor-aware planner into the Apache-2.0 RFP SDK; a public conformance suite for account closers built from the D3 matrix; a comparison table of closers in the write-up; a docs contribution on sponsored closes.
- **Safety.** Plan hash committed before execution; hermetic dry runs on a Quickstart local network; a "what the reviewer will see" preview before every submission.

### Top 10, ranked by value against effort
| Rank | Idea | Value | Effort | Why this rank |
|---|---|---|---|---|
| 1 | **Wallet SDK adapter with keyless signing** — stretch (outside SOW). `planClose()` → inner transaction as XDR/SEP-7 URI → wallet signs → sponsor fee-bumps. | High | Small–Medium | Answers the 2019 "helper a wallet can call" request without key custody; reuses everything built for the metric. |
| 2 | **`verify` evidence bundle** — stretch (outside SOW), borderline: pull in only if Week 4 has slack. One command re-checks hashes, fee accounts and inner fees from stored XDR, so evidence survives the 2026-12-16 reset. | Medium–High | Small | Directly de-risks review; no new surface area. |
| 3 | **Account-hygiene report** — stretch (outside SOW). Read-only reserves-by-subentry, dead trustlines, stale offers, sponsorships. | Medium | Small | The inspector already exists; a report is one renderer away. |
| 4 | **Upstream contribution to the Apache-2.0 RFP SDK** — stretch (outside SOW). Contribute sponsor-aware ordering and fee-bump submission as a PR. | High | Medium | Adoption through an SCF-visible codebase beats a fourth standalone tool. |
| 5 | **Batch closer for custodians** — stretch (outside SOW). N accounts, one sponsor, serialized submissions, CSV report. | Medium–High | Medium | The only user segment with many accounts to close; needs throttling and reporting. |
| 6 | **Hosted fee-bump sponsor service** — stretch (outside SOW). Accepts a signed inner transaction, applies policy (op whitelist, destination rules, rate limits), fee-bumps, submits. | High | Medium–Large | It is a backend with an abuse surface; only with a partner wallet and after the library is stable. |
| 7 | **Closer conformance suite** — stretch (outside SOW). Publish the D3 fixture matrix as a runnable suite any closer can pass. | Medium | Small–Medium | Cheap ecosystem credibility; turns D3 into a public good. |
| 8 | **Stellar CLI plugin** — stretch (outside SOW). Wrap the CLI surface as a CLI plugin binary. | Medium | Medium | Reach among developers; low novelty. |
| 9 | **Web demo page (read-only plan, no keys)** — stretch (outside SOW). Static page that runs `planClose()` against testnet. | Medium | Medium | Nice for reviewers, but a UI is exactly what the SOW excludes and what competitors already ship. |
| 10 | **Soroban-based sponsor vault** — stretch (outside SOW), not recommended. | Low | Large | A classic fee-bump's fee source must be an account (G address); a contract cannot pay fees, so the vault would only fund a G-account operator and adds no trust. |

Also considered, not ranked: liquidity-pool withdrawal and claimable-balance cleanup (completeness against the RFP tools, medium/medium), multisig signature collection (medium/large), mainnet hardening with KMS/hardware signing (high value, large effort, only after a security review), MCP tool for agent wallets (low/small), dust-sweeper mode (low/small).

### Verdict: does any frontend, backend or smart contract belong in the 30-day scope?
**No.** Reasons:
1. The binary metric needs none of them: one CLI, two environment secrets, Horizon and a fee-bump envelope close the fixture (see the first-principles section of `docs/premortem.md`).
2. The SOW explicitly excludes a wallet UI, production key management and third-party integration, and its budget carries zero infrastructure cost; a backend implies hosting and key custody that the SOW does not fund.
3. A contract cannot help with the core mechanism: fee-bump fee sources are accounts, not contracts, and every operation in the close is a classic ledger operation.
4. The 200-hour plan already averages 6.7 hours per calendar day; the pre-mortem's top risks are fixture design, schedule and evidence, none of which a UI improves.
5. The competitive field (two funded SCF #44 RFP projects with web apps) makes "another web app" the least differentiated thing Dustin could build; the embeddable, sponsor-aware library is the differentiated thing.

### What belongs in a post-Instaward phase
- **Phase 1 (library maturity, weeks 5–8):** wallet SDK adapter with keyless signing (#1), `verify` (#2), hygiene report (#3), upstream PR to the RFP SDK (#4), conformance suite (#7).
- **Phase 2 (services, only with a named partner wallet or custodian):** hosted sponsor service (#6) with abuse controls, batch closer (#5), CLI plugin (#8).
- **Phase 3 (mainnet and funding):** key management and monitoring per the mainnet checklist, an external review of the sponsor policy, then the SCF path (interest form, referral through the chapter, submission) using the launch-phase skills marked "later" above — positioned as the fee-sponsored complement to the RFP cohort, not as a competitor to it.

## Assumptions
- The installed skill set is what was found under the user skills directory on 2026-09-25: 20 methodology skills, 5 stellar-build skills, 4 loop skills, 10 SCF lifecycle skills (nine `scf-*` plus `fetch-external-doc`), 10 Stellar dev modules (`soroban`, `smart-contracts`, `dapp`, `assets`, `data`, `agentic-payments`, `zk-proofs`, `cross-chain`, `stellar-anchor-skill`, `standards`), and `demo-video` (installed but not part of the stellar-build bundle). Only installed skills are listed.
- Applicability was judged from each skill's `SKILL.md` and the router's trigger phrases, not from running the skills end to end.
- The brainstorming skill's interactive workflow (session file, technique menus, 100-idea target) was executed non-interactively and condensed; no session file was written because only the two documents in `docs/` were authorised.
- Value/effort scores are relative judgements for a solo builder continuing from the delivered library; "Small" is under a week, "Medium" one to three weeks, "Large" more than a month.
- Competitor and RFP facts are as observed on 2026-09-25 (see Sources) and were not verified by running competitor code.
- Documents named in the "Feeds" column (`docs/architecture.md`, `docs/stories/*.md`, `EVIDENCE.md`) are proposed, not yet created.

## Sources
- Accepted Statement of Work: `SUCCESSFUL_SOW.md` (sections 3, 4, 4.2, 5, 6, 7).
- Installed skill router and journey map: the `SKILL_ROUTER.md` shipped with stellar-build and the `navigate-skills` skill's phase grouping.
- Each installed skill's `SKILL.md` (or flat `.md` for the SCF skills), read on 2026-09-25; in particular `demo-video` (Playwright capture of web apps), `review-edge-case-hunter`, `code-review`, `scf-tranche-reporter` (evidence format), `scf-budget-builder` (Build Award benchmarks), `data`, `assets`, `dapp`, `standards`.
- stellar-build README (46 skills from three upstream sources: the bundle, the SCF lifecycle skills, and the Stellar dev knowledge modules).
- Fee-bump transactions (fee account is an account; validity rules): https://developers.stellar.org/docs/build/guides/transactions/fee-bump-transactions and CAP-15: https://github.com/stellar/stellar-protocol/blob/master/core/cap-0015.md
- Sponsored reserves and CAP-33: https://developers.stellar.org/docs/build/guides/transactions/sponsored-reserves and https://github.com/stellar/stellar-protocol/blob/master/core/cap-0033.md
- SEP-7 (URI scheme for signing requests), used by the keyless-signing idea: https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0007.md
- Testnet reset schedule (December 16, 2026): https://developers.stellar.org/docs/networks#testnet-and-futurenet-data-reset
- SCF #44 Account Demolisher RFP responders via the LumenLoop directory through Raven MCP on 2026-09-25: LumenWipe (awarded $36,000, https://lumenwipe.com) and Account Demolisher (awarded $72,000, https://demolisher.app); SCF handbook RFP track: https://stellar.gitbook.io/scf-handbook/scf-awards/build-award/rfp-track
- GitHub repository search for "demolisher stellar" on 2026-09-25 (three repositories created 2026-05-30 to 2026-06-09, including an Apache-2.0 TypeScript SDK with a mandatory dry-run preview).
- js-stellar-wallets issue 98 (open, 0 comments, 2019-08-12; repository archived), via the GitHub API on 2026-09-25: https://github.com/stellar/js-stellar-wallets/issues/98
- Companion analysis: `docs/premortem.md` in this repository.
