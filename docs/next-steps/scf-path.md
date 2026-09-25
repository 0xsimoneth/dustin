# Dustin — SCF Path After the Instaward

Working draft produced on 2026-09-25 by running the stellar-build launch-phase skills (`scf-round-watcher`, `scf-prescreen-checker`, `scf-interest-form-drafter`, `scf-referral-preparer`, `scf-submission-drafter`, `scf-budget-builder`, `scf-reviewer`) against the accepted Instaward SOW (`SUCCESSFUL_SOW.md`). Every volatile value carries an as-of date. Nothing in this document has been submitted anywhere. The builder is referred to as "the builder"; the ambassador chapter lead as "the chapter lead".

## 0. Summary

- **SCF round status (as of 2026-09-25):** SCF #46 is open in the Submission phase with a Build Submission deadline of **November 8, 2026**. It is at the Interest Form stage and lists no submissions yet. SCF #45 still shows Panel Review on the site even though its recap (40 awards, about $4.04M in XLM) was published on 2026-09-23.
- **Critical finding:** SCF #44 (deadline June 14, 2026) carried an **"Account Demolisher" RFP** and funded **two** account-closing projects at **$120K each** (LumenWipe – Account Demolisher, category Developer Tooling; Account Demolisher, category End-User Application). Two more account-closing submissions in the same round were not awarded. LumenWipe merged hosted CAP-15 fee-bump sponsorship for reserve-locked accounts on 2026-09-08 (PR #216, into its `feature/phase-2` branch), so "sponsored fees" is no longer only roadmap for them. No listing of open RFPs was reachable on communityfund.stellar.org on 2026-09-25 and no further account-closure submissions appear in the SCF #45 index, so the Account Demolisher RFP should be treated as answered unless the SCF team says otherwise. The SOW's framing ("the only existing tool is StellarExpert's demolisher") is out of date, and the SCF FAQ says developer tooling is mainly funded through RFPs and the Public Goods Award.
- **Recommended next step (SOW section 7):** apply for a **follow-on Instaward** (first of at most two, $5,000 cap) scoped to integrator readiness, **continue independently** on publication and on composability with the funded projects, and treat the **SCF Build Award as conditional**: submit the Interest Form for SCF #46 only if, by 2026-10-29, the builder has a named integrator commitment and the Instaward completion evidence has been accepted by the chapter lead. Otherwise keep the same material for a later round.
- **Self-review verdict on a Build Award submitted today:** AT RISK at prescreen and "do not fund as currently framed" at panel. The gaps are differentiation against two funded projects, no traction, a single not-yet-named builder, and no Soroban component under Open Track weighting. The budget structure itself validates cleanly ($60,000, 10/20/30/40 tranches). The honest answer to "why fund another account closer" is in sections 6.1 and 8: Dustin is an embeddable, backend-free library with a read-only planner, sponsored-trustline unwinding, and a public fixture, test matrix and baseline recordings; the two funded tools are hosted applications, and the right relationship is complementary, possibly collaborative.

## 1. SCF round status (scf-round-watcher)

### 1.1 Rounds as shown on communityfund.stellar.org/awards, fetched 2026-09-25

| Round | Status on site | Deadline shown | rec-id | Notes |
|---|---|---|---|---|
| SCF #46 | Submission (open) | November 8, 2026 | recxrSMYwAl8vcglg | Max award "$150,000 in XLM". Round page: "No submissions added yet"; teams must submit the Interest Form first to be eligible for the formal submission. |
| SCF #45 | Panel Review | August 16, 2026 | reccaFUJmN4HNQxvo | Round page shows no submission data yet. Recap published 2026-09-23: 40 awards, about $4.04M XLM (Open 8 / $838K; Integration 28 / $2.76M; RFP Developer Tooling 4 / $445K). |
| SCF #44 | Ended | June 14, 2026 | rec4FnYypcsKpBRB4 | Site: 45 awarded, 75+ received. Recap (2026-07-24): 175 submissions, 46 awards, $4.57M XLM (Open 12 of 50; Integration 26 of 95; RFP track for targeted developer tooling, delegate-reviewed). The 45 vs 46 difference is a source conflict. |
| SCF #43 | Ended | April 26, 2026 | reciQ16Y1ztmnmE3N | Recap (2026-06-02): 85 submissions, 29 awarded. |
| SCF #42 | Ended | March 15, 2026 | recweELi12M0ftBYZ | |
| SCF #41 | Ended | February 8, 2026 | recTLIVf9LOTBtkld | |
| SCF #40 | Ended | November 9, 2025 | rec9zh7vNhlW5M1Hc | Recap (2025-12-31): 85 submissions, 24 awarded, $2.18M XLM. |

The site reports 46 rounds in total and 504 previously awarded submissions (as of 2026-09-25). Rounds #33 and earlier show no deadline dates on the page.

### 1.2 What the round watcher could and could not do

- Step 1 (find the active round): done. Exactly one round has status Submission (SCF #46).
- Steps 2 to 4 (submission list, per-project enrichment, repeat-builder and Electric Capital cross-reference): **not possible for SCF #46** — the round page lists no submissions ("No submissions added yet"). The same is true for the SCF #45 page. This is reported, not estimated.
- Step 5 (patterns): taken from the last two completed rounds instead (section 1.4).
- Cache: the skill asks for a cache under the user's stellar-build directory; **not written** because this task only permits writing the three documents under `docs/next-steps/`.
- Fetch failures: `communityfund.stellar.org/build` returned HTTP 404 on 2026-09-25; both Medium recap articles returned HTTP 403 to a direct fetch, so their content was taken from the LumenLoop content index (dated summaries) via the Raven MCP.

### 1.3 The SCF #44 account-closure cluster (fetched 2026-09-25)

The live SCF #44 round page lists four account-closure submissions:

| Submission | Result | Amount | Category | Notes |
|---|---|---|---|---|
| LumenWipe – Account Demolisher | Awarded | $120.0K | Developer Tooling | States that it "responds to the Account Demolisher RFP". Team of two engineers, described as active Stellar Ambassadors and a "two-time SCF Build Award team". |
| Account Demolisher | Awarded | $120.0K | End-User Application | Team size 1. Working open-source prototype end to end on testnet at submission time. |
| Stellar Wallet Demolisher (BlackHole) | Not awarded | $16.0K | Build | |
| Reliable tool to wipe an account | Not awarded | $92.0K | Build | |

Source conflict to record: the LumenLoop directory rows show `awarded_total` of 36,000 (LumenWipe) and 72,000 (Account Demolisher), while the live submission pages and the Scout index (scfAsOf 2026-08-12) show $120,000 each. The lower figures may be amounts paid to date; treat $120K as the award size.

RFP status (as of 2026-09-25): LumenWipe's submission states that it "responds to the Account Demolisher RFP"; the SCF #44 round page itself does not display the RFP. The communityfund.stellar.org home page lists no open RFPs, `/rfps` returns HTTP 404, the SCF #46 round page shows no RFP information, and the LumenLoop index holds no account-closure submission in SCF #45. Which RFPs the four SCF #45 RFP-track awards answered could not be determined from the sources reached. Conclusion: the RFP has been answered with two awards and is not visibly open; a Dustin submission would be Open Track unless SDF re-issues an account-tooling RFP, which must be checked with the SCF team before the target round.

Competitor state change since the SOW was written: LumenWipe merged PR #216 "feat(api): sponsor the fee of a wind-down transaction for reserve-locked accounts" on 2026-09-08 (base branch `feature/phase-2`), adding a `POST /:network/fee-bump/sponsor` endpoint with a wind-down operation allowlist, a `MAX_FEE_BUMP_STROOPS` cap, per-API-key rate limiting and a single-account restriction; PR #217 routed reserve-locked closes through it on the same day. The repository README fetched on 2026-09-25 still lists sponsored fees under Tranche 2 of the roadmap, and whether the feature is live on lumenwipe.com was not verified.

### 1.4 Patterns in recent rounds

- Integration Track dominates award counts (26 of 46 in #44, 28 of 40 in #45). Open Track is 8 to 12 awards per round. RFP Developer Tooling was 4 awards ($445K) in #45.
- Developer tooling outside an RFP is rare in recent awards, consistent with the FAQ statement that "some developer tooling" is supported through RFPs and the Public Goods Award.
- The Public Goods Award runs quarterly and funds SDKs and infrastructure (curated data lists Python Stellar SDK, Stellar PHP SDK, Scaffold Stellar, Scout, Solang, soropg, Soroban Security Portal, Stellarchain across Q3 2025 to Q2 2026; a 2026-07-02 article reports 17 projects and over $400,000 in Q2 2026). This is the natural "other ecosystem support" route for an adopted open-source library.
- Thesis alignment (optional step 5.5): none of the curated a16z or YC thesis entries names wallet hygiene or account tooling; Dustin does not ride an external investor thesis. Its demand signal is internal to Stellar (the RFP, plus SDK issues asking for a closing helper).

### 1.5 Program rules snapshot (SCF Handbook and FAQ, fetched 2026-09-25)

- Build Award: "up to $150,000 worth of XLM". Lifetime cap $150,000; up to $300,000 case by case only for projects already at $150,000.
- Tranches: T0 10% on approval, T1 20%, T2 30%, T3 40%. Each tranche must be submitted within 90 days of the last payment. Timegating applies: missing a deadline without notifying the SCF team forfeits the remainder.
- Typical duration 3 to 6 months. Review stages: prescreen (completeness), panel review, revision window, community vote (Open Track only). Only one project per submitter at a time.
- Eligible categories named on the FAQ: End-User Applications and Financial Protocols; "some developer tooling" via RFPs and the Public Goods Award. Other programs: Growth-Hack, Public Goods Award, Liquidity Award.
- Rules carried by the skills but not verified live on 2026-09-25 (labelled as skill-sourced wherever used below): 6-month timeline cap; ineligible costs (audits are covered by the Audit Bank; marketing, bounties, legal and entity registration, reimbursement of past work); Tranche 1 must be development, not research; three rejections trigger a three-round timeout; Interest Form before referral; referral reward up to 1% of the award, paid only after the final tranche; Open Track requires an AI-artifact disclosure and a smart-contract open-source plan.

## 2. Prescreen self-check (scf-prescreen-checker)

## Prescreen Simulation: Dustin (hypothetical SCF #46 Build Award, Open Track)

### Overall: AT RISK

### Completeness
- Status: FLAG
- Issues: the team section has no named, linkable member yet (this repository deliberately says "the builder"; the submission must name the person with public profiles and prior work). Repository, demo video and evidence package exist only as Instaward deliverables and must be public, stable and link-tested before submission. Timeline needs calendar dates, not durations. An architecture document link is expected.

### Stellar Integration
- Status: PASS
- Issues: essentiality is not in doubt. Dustin exists only because of Stellar account semantics: subentry reserves, AccountMerge ordering constraints, CAP-15 fee-bump transactions, CAP-33 sponsored reserves, SEP-29 memo-required destinations. It cannot be ported to another chain. The weakness is the absence of any Soroban component (see Red Flags).

### Eligibility
- Status: FLAG
- Issues: project type is fine (open-source software with an on-chain effect). But (1) the FAQ routes developer tooling mainly to RFPs and the Public Goods Award; (2) the Account Demolisher RFP was answered in SCF #44 with two $120K awards, so a general "account demolisher" reads as duplicate work; (3) $60,000 is within range; (4) whether Instaward funding counts toward the $150K lifetime cap is unknown and should be asked of the SCF team before submitting.

### Quality Threshold
- Status: PASS
- Issues: the SOW-derived material is specific and technical. The coherence risk is the opposite one: the first paragraph must answer "why fund a third closing tool" or the rest is not read.

### Red Flags
- No Soroban component (classic-only). Partially triggered: on-chain classic operations exist, but Open Track weighting favours Soroban-native design.
- Team identity not yet verifiable in the draft (fix before submission).
- Overlap with two funded SCF #44 projects (not a listed red flag, but the strongest practical risk).
- Not triggered: budget over $150K, marketing lines, non-technical MVP, token launch, unverifiable partnership claims, audit line item.

### Prescreen Risk Assessment
Likely to pass the completeness check once the team and links are filled in, but reaches the panel carrying a duplication concern that the submission must resolve in its first paragraph.

## 3. Recommended next step (SOW section 7)

### 3.1 Option comparison

| SOW section 7 option | Fit now | Reasoning |
|---|---|---|
| Apply to SCF Build Award | Conditional, deferred | SCF #46 is open until 2026-11-08 and the Interest Form is rolling, so timing is feasible. But SDF funded two overlapping projects three months ago, both promise SDK/API layers, one already runs on mainnet and merged hosted fee sponsorship on 2026-09-08, and the FAQ steers developer tooling to RFPs and Public Goods. A third submission needs a different thesis (section 6) and a named integrator to survive panel review. |
| Continue development independently | Yes, in parallel | Publishing the npm package, keeping the fixture and test matrix public, and offering the planner and test matrix upstream to the funded projects (all Apache 2.0 or MIT) costs nothing and is the most credible differentiation evidence a panel could see. |
| Apply for a follow-on Instaward | **Yes, recommended** | Matches the program's intent (short, execution-focused). Produces exactly the evidence a Build Award lacks: an integrator pilot, sponsor abuse controls, and the mainnet-readiness paperwork. Stays inside the SOW section 8 constraints (at most two follow-ons, $5,000 each, $15,000 total). |
| Seek other ecosystem support | Later | Public Goods Award once the library has adopters; Audit Bank does not apply (no contract). Not a substitute for adoption. |

### 3.2 Decision

1. **Now (after the Instaward closes):** submit the Instaward completion report (template in `docs/next-steps/instaward-completion-report-template.md`) and request a follow-on Instaward with the scope in 3.3.
2. **Decision gate 2026-10-29** (the sprint ends 2026-10-22, so the completion report cannot be accepted earlier; SCF #46 closes 2026-11-08)**:** submit the SCF #46 Interest Form (draft in section 4) only if all of the following hold: (a) the completion report is accepted with all Appendix B boxes ticked; (b) at least one wallet, anchor or custodian has agreed in writing to pilot Dustin as sponsor on testnet; (c) the "sponsor-side primitive" thesis in section 6 has been reviewed with a prospective referrer (section 5). If any condition fails, do not submit to #46; keep building and target a later round.
3. **Never:** submit a Build Award framed as "a better account demolisher". That framing lost twice in SCF #44 and won twice for teams that are already ahead on features.

### 3.3 Proposed follow-on Instaward scope ("Dustin 2: integrator readiness", 30 days, $5,000, 200 hours at $25/hour)

| Item | Hours | Budget | Output |
|---|---|---|---|
| A. Wallet-signing adapter: SEP-43 signing via Stellar Wallets Kit for the closing account, plus unsigned-XDR export, while the sponsor fee-bumps | 50 | $1,250 | The closing account never exposes a secret key to Dustin; CLI parity. |
| B. Sponsor abuse controls in the library: per-close fee cap, per-day budget, proof-of-control (closing account signs the inner transaction), kill switch, audit log | 60 | $1,500 | Testnet; unit and matrix tests. |
| C. Integrator pilot on testnet: one named wallet, anchor or custodian closes at least 25 messy fixture accounts through Dustin with its own sponsor key; feedback log | 50 | $1,250 | Linkable transaction chains; written feedback. |
| D. Mainnet-readiness paperwork that needs no mainnet (custody design, runbook, threat model, from `docs/next-steps/mainnet-readiness.md`) and npm publish with provenance | 40 | $1,000 | Published package; Gate 1 checklist closed except live items. |

Binary success metric: a third party closes at least 25 messy testnet accounts through Dustin using its own sponsor key, and every run is linkable from an evidence package. Mainnet remains out of scope.

## 4. Interest Form draft (scf-interest-form-drafter)

## Interest Form Draft: Dustin

**One-Line Description:** An open-source JavaScript/TypeScript SDK and CLI that lets wallets, anchors and custodians close their users' messy Stellar accounts — including accounts with zero spendable XLM — by fee-bumping every step from a sponsor key, so locked reserves are recovered and the account merges cleanly to a destination the user chooses.

**Project Description:**

A Stellar account cannot be merged while it holds trustlines, offers or data entries, and a trustline cannot be removed while it holds a balance. Closing is therefore an ordered teardown, and the base reserves stay locked until it finishes. The accounts that most need closing are the ones sitting at their minimum reserve with nothing spendable: they cannot pay the fee for the very transaction that would free their reserves. Existing closing tools are end-user web products where the account being closed pays for its own teardown, so they cannot serve this case, and none of them exposes a headless library a wallet can call on behalf of its users.

Dustin is the sponsor-side primitive. `planClose()` inspects any account and returns a read-only, ordered plan (offers to cancel, balances to dispose of and how, trustlines and data entries to remove, XLM to be recovered, the final merge) grouped into the minimum number of transactions with a reason and fee estimate per step. `executeClose()` runs that plan with every transaction wrapped in a fee-bump paid by the integrator's sponsor key, follows a disposal ladder for leftover balances (path payment, return to issuer, transfer to destination, or "unclosable with a stated reason"), unwinds sponsored trustlines so the released reserve goes back to the sponsor, and guards against `ACCOUNT_MERGE_SEQNUM_TOO_FAR`. Everything is testable offline against a public messy fixture account, and the repository contains a recorded baseline of the existing StellarExpert tool stopping on that fixture.

Why now: the Stellar Community Fund issued an Account Demolisher RFP in SCF #44 and funded two end-user tools, which confirms demand; what remains unfunded is the integrator layer — a library and a sponsor model that let wallets and anchors offer account closure inside their own products without sending users to a third-party web form. Dustin was built in a 30-day Instaward through the Stellar Türkiye ambassador chapter and runs on testnet today.

**Stellar Integration:**
- Classic operations: `AccountMerge`, `ChangeTrust`, `ManageSellOffer`/`ManageBuyOffer` cancellation, `ManageData`, `PathPaymentStrictSend`/`PathPaymentStrictReceive`, `SetOptions`.
- CAP-15 fee-bump transactions: every submitted transaction is fee-bumped by the sponsor, so the closing account needs no XLM.
- CAP-33 sponsored reserves: detection and unwinding of sponsored trustlines and data entries, with reserves returned to the sponsor.
- SEP-29 memo-required detection for destinations (planned for the mainnet-readiness gate); SEP-43 wallet signing through Stellar Wallets Kit (planned in the follow-on Instaward).
- Horizon and Stellar RPC for account inspection; Stellar testnet and friendbot for the fixture.
- No Soroban contracts. C-addresses, liquidity pool withdrawal and claimable balances are detected and reported, not automated, in the current scope.

**Team:**
- [NEEDS INPUT: the builder] — Founder and engineer — [NEEDS INPUT: one sentence of relevant experience, including prior fee-sponsored submission work referenced in the SOW] — [NEEDS INPUT: GitHub profile, LinkedIn or portfolio]
- Delivered a Stellar Instaward (Dustin, $5,000, 30 days) via the Stellar Türkiye ambassador chapter — [NEEDS INPUT: link to the completion evidence package]

**Current Stage:** Testnet prototype
- Public repository with README and integration notes: [NEEDS INPUT: URL]
- Messy fixture account closed end to end on testnet with sponsored fees: [NEEDS INPUT: transaction chain links]
- 60-second demo: [NEEDS INPUT: URL]
- Test matrix and recorded baseline of the existing tool: [NEEDS INPUT: URLs]

**Requested Budget Range:** $50K–$100K (target $60,000; see section 6.5)

---

### Draft Notes
- The one-liner must keep the words "wallets, anchors and custodians" and "sponsor key": they are the whole differentiation against the two funded tools.
- Do not claim mainnet. Do not claim users. If the follow-on Instaward pilot happens, add "piloted by [integrator] on testnet" with a link.
- Fill the team section with real names and links before submitting; unnamed teams rarely advance.
- Submit the Interest Form before approaching any referrer (the referral form selects projects by name from submitted Interest Forms).
- Range reasoning: the outline in section 6 totals $60,000, which sits at the bottom of the $50K–$100K band and below the Developer Tooling medians ($75,000 skill benchmark; $54,225 median cumulative award in the curated LumenLoop data, n=128).

## 5. Referral preparation note (scf-referral-preparer)

### 5.1 Prerequisites checklist

- [ ] Interest Form submitted (blocks everything else).
- [x] Something to show: testnet close of the fixture, repository, demo, baseline recording (Instaward deliverables; links to be filled in).
- [x] Can explain the project in two or three sentences (section 4 one-liner and first paragraph).
- [ ] Real, identifiable team with public profiles (currently "the builder" by rule in this repository; must be named in the package).
- [x] Homework on SCF done (this document).

### 5.2 Who could refer

- The chapter lead who accepted the Instaward SOW is the natural first candidate: Stellar Ambassadors are among the approved referrer groups, and the chapter lead has first-hand execution evidence (the completion report). Ask only after the completion report is accepted.
- Any other Ambassador, Navigator or Pilot who has seen the demo. Do not approach several referrers at once.
- Do not offer anything in exchange. The referral reward (skill-sourced: up to 1% of the award, paid only after the final tranche, at SCF's discretion; SDF employees excluded) is between the referrer and SCF.

### 5.3 Conflict-of-interest disclosure

The chapter lead has a formal program relationship with the builder (they submitted and verify the Instaward SOW). This is not a financial or advisory interest, but it must be stated on the referral form as relationship context so that nothing surprises the SCF team.

### 5.4 Referral package (fill before sending; share as a document, not a chat message)

```
## Referral Package: Dustin

### Overview
One-line description: [section 4 one-liner]
Project description: [section 4, three paragraphs]
Track: Open (Developer Tooling)  [DRAFT NOTE: confirm no active RFP fits; if an account-tooling RFP is open in the target round, RFP Track is the stronger fit]
Requested budget range: $50K–$100K (target $60,000)
Interest Form: submitted on [NEEDS INPUT: date] under the name "Dustin"

### Team
| Name | Role | Experience | Links |
| [NEEDS INPUT] | Founder, engineer | [NEEDS INPUT] | [NEEDS INPUT] |
Execution track record:
- Dustin Instaward delivered in 30 days: [NEEDS INPUT: completion report and evidence package links]
- Prior fee-sponsored submission work referenced in the SOW: [NEEDS INPUT: link]

### Stellar Readiness
Prior Stellar work: [NEEDS INPUT]
Current status: Testnet. Repository [NEEDS INPUT]. Demo [NEEDS INPUT]. Fixture close transaction chain [NEEDS INPUT].
Why Stellar: the product is Stellar's own account model (reserves, subentries, AccountMerge, fee-bumps, sponsorship); there is no chain-agnostic version of it.

### Traction and Demand
- Account Demolisher RFP in SCF #44 and two funded responses (demand confirmed by SDF).
- Open SDK issues requesting a closing helper (js-stellar-wallets #98, open since 2019-08-12 with no comments; the repository was archived on 2024-02-08).
- [NEEDS INPUT: integrator pilot commitment or letter of intent; without one, state honestly that there is none yet]

### Relationship Context
[NEEDS INPUT: how the referrer knows the builder; for the chapter lead: the Instaward SOW and its verification]

### Conflict of Interest Disclosure
[NEEDS INPUT: "No financial or advisory relationship exists" plus the program relationship above]
```

Assessment for a referrer: the strengths are a delivered scope, a precise technical thesis and a modest budget; the gaps that would give a referrer pause are the two funded competitors, the absence of an integrator, and a single-person team.

## 6. Draft Build Award submission outline (scf-submission-drafter)

### 6.1 Positioning

- **One sentence:** Dustin is the sponsor-side account-closing primitive for Stellar: a library, CLI and integrator-scoped sponsor service that let wallets, anchors and custodians close their users' messy accounts, including zero-XLM accounts, with every step fee-bumped and every merge previewed before it is signed.
- **Track:** Open (Developer Tooling). As of 2026-09-25 the Account Demolisher RFP has been answered with two SCF #44 awards and no open RFP list is reachable (section 1.3). [DRAFT NOTE: confirm with the SCF team before the target round; if SDF re-issues an account-tooling RFP, switch to RFP Track and answer its spec line by line.]
- **What this is not:** not a third end-user demolisher website, not DeFi position exits (funded twice in SCF #44), not a mediator-account service for exchanges.
- **Why fund this again (the reviewer's first question), answered:** the two funded projects are hosted applications with a backend in the flow (LumenWipe: Next.js web app, NestJS API, an SDK that is "a thin API fetch client", and a hosted fee-bump endpoint merged on 2026-09-08; Account Demolisher: Next.js web app with a mediator account and server-side envelope validation). A wallet, anchor or custodian that wants to close accounts inside its own product cannot embed either without depending on a third-party server. Dustin is the missing layer: (1) fee-bumped closure of zero-XLM accounts delivered on testnet inside a 30-day Instaward, with the integrator's own sponsor key rather than a hosted sponsor; (2) a backend-free library with a read-only `planClose()` that wallets can embed and show before anything is signed; (3) sponsored-trustline unwinding where the released reserve returns to the sponsor; (4) a published edge-case test matrix plus baseline recordings against a public fixture. The relationship is complementary: the hosted apps serve individuals, Dustin serves integrators, and Dustin can point users with Soroban or DeFi positions to the funded tools.
- **Collaboration and RFP-adjacent scope:** propose to the two awardees that Dustin's planner and test matrix become the shared library layer (all three code bases are Apache 2.0 or MIT); state this in the submission. Scopes that answer the RFP's intent without duplicating its awards: a wallet SDK adapter (SEP-43 signing plus unsigned-XDR hand-off, Deliverable 3), a custodial batch closer for anchors and custodial wallets that hold the keys of many dormant accounts and want one sponsor and one audit log (extension of Deliverables 2 and 7), and classic completeness for liquidity pool shares and claimable balances (Deliverable 4).
- **Why Stellar:** see section 4. Essential, not interchangeable.
- **Open Track requirements:** AI-artifact disclosure (state which documents, tests or code were AI-assisted); open-source plan (MIT or Apache 2.0 for the SDK, CLI and sponsor service; there are no smart contracts to open-source).

### 6.2 Technical architecture (describe with a diagram in the submission)

- Integrator application (wallet, anchor back office, custodian tooling) calls the Dustin SDK.
- `planClose(account)` reads Horizon/RPC state and returns a deterministic plan with a plan hash. Nothing is signed.
- `executeClose(plan, signers)` builds each inner transaction for the closing account, obtains its signature (wallet adapter via SEP-43, unsigned-XDR hand-off, or an in-memory key for automation), wraps it in a CAP-15 fee-bump signed by the sponsor, submits, and verifies state after each step. Execution refuses any plan whose hash differs from the previewed one.
- Sponsor signing is pluggable: integrator-held key (default) or the optional hosted sponsor service with integrator-scoped API keys, spend caps, proof-of-control and rate limits. No server ever sees the closing account's key.
- Safety layer: SEP-29 memo-required check, destination existence and flags check, `ACCOUNT_MERGE_SEQNUM_TOO_FAR` guard, time bounds, 100-operation splitting, sponsored-reserve unwinding, disposal ladder with "unclosable with reason".
- Networks: testnet and mainnet behind an explicit network switch (see `docs/next-steps/mainnet-readiness.md`).

### 6.3 Deliverables

**Tranche 1 (MVP, 20%, $12,000, weeks 1 to 6)** — starts where the Instaward ends.

**Deliverable 1 — Mainnet-safe core**
- Description: network abstraction (passphrases, RPC and Horizon providers), SEP-29 memo-required destination check, destination existence and flag checks, plan-hash pinning, typed irreversible-merge confirmation, time-bounded transactions.
- Completion criteria: on testnet, a plan executed after any state change is refused with a diff; a memo-required destination is refused with a reason; all matrix tests pass in CI on a public commit.
- Estimated completion: week 3.
- Budget: $5,000.

**Deliverable 2 — Integrator sponsor module v0**
- Description: library-level sponsor policy: per-close fee cap, per-day budget, allowlist, proof-of-control (closing account signs the inner transaction before the sponsor wraps it), kill switch, structured audit log.
- Completion criteria: a public test shows a sponsor refusing to wrap a transaction that exceeds its cap, an unallowlisted account, or an inner transaction not signed by the closing account.
- Estimated completion: week 5.
- Budget: $5,000.

**Deliverable 3 — Wallet-signing adapter**
- Description: SEP-43 signing through Stellar Wallets Kit and unsigned-XDR export so the closing account signs with its own wallet; CLI parity.
- Completion criteria: recorded testnet close where the closing account signs in a wallet and the sponsor fee-bumps; no secret key passes through Dustin.
- Estimated completion: week 6.
- Budget: $2,000.

[DRAFT NOTE: if the follow-on Instaward in section 3.3 is delivered first, Deliverables 2 and 3 are already done; replace them with Deliverable 7's pilot expansion and pull Deliverable 4 forward. Never bill funded work twice.]

**Tranche 2 (Testnet, 30%, $18,000, weeks 7 to 15)**

**Deliverable 4 — Classic completeness: claimable balances and liquidity pool shares**
- Description: claimable balances (claim or report, with sponsorship implications) and classic liquidity pool share withdrawal inside the disposal ladder.
- Completion criteria: fixture accounts holding claimable balances and pool shares close end to end on testnet; the matrix covers a pool with one-sided liquidity.
- Estimated completion: week 10.
- Budget: $6,000.

**Deliverable 5 — Multi-signer hand-off**
- Description: raised thresholds detected; partial-XDR export compatible with external signature coordination; the plan stays valid across signature gathering (sequence-number guard).
- Completion criteria: a 2-of-3 testnet account closes with signatures gathered out of band; recorded demo plus matrix test.
- Estimated completion: week 12.
- Budget: $4,000.

**Deliverable 6 — C-address and Soroban-balance awareness**
- Description: detect SEP-41 token balances by simulation and contract-account destinations; refuse with a stated reason and a pointer to tools that handle them. Deliberately no DeFi exits.
- Completion criteria: matrix cases for a Soroban token balance and a C-address destination produce correct refusals; documented in the write-up.
- Estimated completion: week 13.
- Budget: $3,000.

**Deliverable 7 — Adversarial matrix and integrator testnet pilot**
- Description: adversarial cases (mid-flow state changes, deleted issuers, auth-required and clawback-enabled trustlines, high-subentry splitting); hosted sponsor service v0 on testnet with integrator-scoped API keys; a named integrator closes at least 25 accounts.
- Completion criteria: CI run of the full matrix; pilot transaction chains and written feedback published.
- Estimated completion: week 15.
- Budget: $4,000 engineering plus $1,000 infrastructure.

**Tranche 3 (Mainnet, 40%, $24,000, weeks 16 to 26)**

**Deliverable 8 — Mainnet launch of SDK, CLI and sponsor service**
- Description: sponsor key custody (hardware-backed or HSM/KMS signer; hot sponsor with capped balance; cold top-up), server-side spend caps, monitoring and alerting, incident runbook, deployment log, canary closes of the builder's own accounts.
- Completion criteria: every Gate 1 and Gate 2 item in `docs/next-steps/mainnet-readiness.md` ticked with evidence; canary transaction hashes on mainnet; npm release with provenance.
- Estimated completion: week 21.
- Budget: $10,000.

**Deliverable 9 — UX readiness**
- Description: integration guide, reference integration (minimal web flow using the wallet adapter), human-readable errors for every refusal, end-user documentation.
- Completion criteria: a developer outside the team integrates Dustin from the guide alone in under one day and records it; docs site live.
- Estimated completion: week 24.
- Budget: $6,000 engineering plus $3,000 technical writing.

**Deliverable 10 — Integrator mainnet pilot, metrics and maintenance plan**
- Description: at least 100 accounts closed on mainnet through one integrator, or at least two integrators live; public metrics page; 12-month maintenance commitment with response targets.
- Completion criteria: linkable mainnet transaction chains, integrator confirmation, published maintenance plan.
- Estimated completion: week 26.
- Budget: $4,000 engineering plus $1,000 infrastructure.

### 6.4 Traction plan

- Pre-submission: one integrator letter of intent (follow-on Instaward pilot), RFP and SDK-issue demand evidence, testnet run counts.
- Targets to state: 1 integrator live on mainnet within 3 months of T3; 100 closed accounts within the same window; 3 integrators within 6 months. [DRAFT NOTE: only claim numbers the pilot supports.]

### 6.5 Budget (scf-budget-builder rules applied)

Rates: full-stack developer $2,000/week (bottom of the $2,000–$4,000 benchmark); technical writer $1,500/week (bottom of the $1,500–$2,500 benchmark). The Instaward used a flat $25/hour (about $1,000/week); the step-up is to a benchmark-consistent rate, still at the bottom of the range.

| Deliverable | Role | Rate | Effort | Cost |
|---|---|---|---|---|
| D1 Mainnet-safe core | Full-stack developer | $2,000/wk | 2.5 wk | $5,000 |
| D2 Integrator sponsor module v0 | Full-stack developer | $2,000/wk | 2.5 wk | $5,000 |
| D3 Wallet-signing adapter | Full-stack developer | $2,000/wk | 1 wk | $2,000 |
| **Tranche 1 subtotal** | | | 6 wk | **$12,000** |
| D4 Claimable balances and LP shares | Full-stack developer | $2,000/wk | 3 wk | $6,000 |
| D5 Multi-signer hand-off | Full-stack developer | $2,000/wk | 2 wk | $4,000 |
| D6 C-address and Soroban awareness | Full-stack developer | $2,000/wk | 1.5 wk | $3,000 |
| D7 Adversarial matrix and pilot | Full-stack developer | $2,000/wk | 2 wk | $4,000 |
| D7 Infrastructure (RPC provider, hosting, secrets) | — | — | — | $1,000 |
| **Tranche 2 subtotal** | | | 8.5 wk | **$18,000** |
| D8 Mainnet launch and custody | Full-stack developer | $2,000/wk | 5 wk | $10,000 |
| D9 UX readiness (engineering) | Full-stack developer | $2,000/wk | 3 wk | $6,000 |
| D9 UX readiness (documentation) | Technical writer | $1,500/wk | 2 wk | $3,000 |
| D10 Mainnet pilot and maintenance plan | Full-stack developer | $2,000/wk | 2 wk | $4,000 |
| D10 Infrastructure (6 months of sponsor service) | — | — | — | $1,000 |
| **Tranche 3 subtotal** | | | 10 wk dev + 2 wk writer | **$24,000** |
| **Deliverables total (T1+T2+T3 = 90%)** | | | | **$54,000** |
| T0 (10%, automatic on approval) | | | | $6,000 |
| **Total award requested** | | | ~25 weeks | **$60,000** |

Tranche mapping: T0 $6,000 (10%) / T1 $12,000 (20%) / T2 $18,000 (30%) / T3 $24,000 (40%).

Validation against the scf-budget-builder rules:

| Rule | Result |
|---|---|
| Total under $150K | Pass ($60,000) |
| No line item over 40% of total | Pass (largest is D8 at 16.7%) |
| No marketing line items | Pass |
| No audit line item (Audit Bank) | Pass; no contract to audit; security review is engineering time inside D8 |
| No legal or entity registration | Pass |
| Contingency at most 5% | Pass (none) |
| Rates within benchmarks | Pass (bottom of range) |
| Bottom-up, traceable to deliverables | Pass (every line names a deliverable) |
| Tranche allocation 10/20/30/40 | Pass (exact) |
| Proportional to category median | Pass: below the Developer Tooling median ($75,000 skill benchmark; $54,225 curated median), matching a single-builder scope |
| Timeline within 6 months | Pass, but tight (about 25 working weeks at one full-time builder; state the risk) |

### 6.6 Pre-submit checklist status

- [ ] One-sentence description clear to outsiders — drafted (section 6.1)
- [x] Stellar's role essential and explicit
- [ ] Architecture with diagram, data flow, key management — outline only (section 6.2)
- [ ] Team named with links — blocked until the builder fills it in
- [ ] Traction evidence specific and verifiable — blocked on the pilot
- [x] Deliverables in structured format; MVP technical; mainnet includes UX readiness
- [x] Budget bottom-up with rates, effort, tranche breakdown; no audit, marketing or contingency
- [ ] Every link works — links not yet public
- [ ] AI-artifact disclosure and open-source plan written
- [ ] Track confirmed against the target round's RFP list

## 7. Self-review (scf-reviewer)

## Checklist Review: Dustin
Track: Open (evaluated with Open Track weighting; Integration Track is not applicable because integrating an existing building block is not the core purpose)

Scores are 1 to 5 against what a funded Open Track Developer Tooling submission looks like in SCF #44 and #45.

### Integration Partner Fit
- Status: N/A (Open Track)
- Evidence: Stellar Wallets Kit and Horizon/RPC are dependencies, not the product.
- Concerns: none.

### Ecosystem Impact (Open Track: critical)
- Status: FLAG — score 2.5/5
- Evidence: an Account Demolisher RFP existed and two responses were funded in SCF #44; open SDK issues asked for a closing helper for years. Demand is real but is now being served.
- Concerns: incremental unless Dustin is adopted by wallets as the sponsor-side library; the funded projects each promise an API/SDK layer (LumenWipe: REST API plus a typed npm transaction builder in its Tranche 3).

### Technical Architecture (Open Track: high)
- Status: PASS with FLAG — score 3/5
- Evidence: planner/executor split, fee-bump wrapping of every transaction, sponsored-reserve unwinding, sequence guard, disposal ladder, test matrix and recorded baseline (SOW deliverables 1 to 3).
- Concerns: no Soroban component; key management is an env key in the Instaward scope; hosted sponsor service is only a design.

### Differentiation (Open Track: high)
- Status: FLAG — score 2/5
- Evidence: see section 8. Four defensible differences, each verifiable from public artifacts: (1) fee-bumped closure of zero-XLM accounts delivered on testnet in the Instaward with the integrator's own sponsor key; (2) a backend-free library with a read-only planner that wallets can embed (LumenWipe's SDK is "a thin API fetch client" to its NestJS backend; Account Demolisher is a web app); (3) sponsored-trustline unwinding with the reserve returned to the sponsor (neither funded application describes it; Account Demolisher hard-stops on sponsoring accounts); (4) a published edge-case test matrix plus baseline recordings of the existing tool against the same public fixture.
- Concerns: the reviewer's first question will be "why fund two account closers, let alone three". LumenWipe merged hosted CAP-15 fee-bump sponsorship on 2026-09-08 (PR #216, `feature/phase-2`) with an allowlist, fee cap and per-key rate limits, so "sponsored fees" is no longer a Dustin-only feature, only a Dustin-only deployment model (integrator-held key, no server); its Tranche 3 promises a typed npm transaction builder, which would narrow difference (2) if delivered. Account Demolisher already covers claimable balances, LP withdrawal and multisig that Dustin only reports. The concrete answer must be in the first paragraph: library versus hosted app, complementary audiences (integrators versus individuals), and a stated collaboration offer to make Dustin the shared library layer.

### Team Readiness
- Status: FLAG — score 2.5/5
- Evidence: a delivered 30-day Instaward is execution evidence; prior fee-sponsored submission work is referenced in the SOW.
- Concerns: single builder; not yet named with public profiles in the draft; no second maintainer.

### Traction
- Status: FLAG — score 2/5
- Evidence: testnet only; demand evidence is the RFP and SDK issues; the js-stellar-wallets issue #98 claim was verified live on 2026-09-25 (open, zero comments, repository archived 2024-02-08).
- Concerns: no users, no integrator, no metrics.

### Budget & Deliverables
- Status: PASS — score 4/5
- Evidence: section 6.5 validates against every scf-budget-builder rule; deliverables are independently verifiable.
- Concerns: 25 weeks at one full-time builder is close to the 6-month cap; D8 (custody and monitoring) is the most likely to slip.

### Ecosystem Commitment
- Status: FLAG — score 3/5
- Evidence: Stellar-only by construction; open-source plan; maintenance plan is a Tranche 3 deliverable.
- Concerns: no maintenance plan exists yet; no stated collaboration with the funded projects.

### Overall Assessment
- Recommendation: **Do not fund as currently framed; fund with conditions if repositioned** as the sponsor-side primitive with a named integrator and a written composability stance toward the SCF #44 awardees.
- Key strength: the only proposal in this space built for the party that pays (the integrator), with a read-only plan and a public test matrix.
- Key concern: two overlapping projects were funded three months ago at $120K each, both promise SDK/API layers, and one merged hosted fee sponsorship on 2026-09-08.
- Verification gaps: the SOW's claims about the StellarExpert tool (refuses merges paying out under 1 XLM; no fee-bumps; MIT licence) were not re-verified against its source on 2026-09-25, although both funded applications corroborate the sponsorship, claimable-balance, liquidity-pool and secret-key gaps; LumenWipe's mainnet metrics (10+ accounts closed, 100+ XLM recovered, 50+ testnet closes) are self-reported in its application; PR #216 was merged into a feature branch and its production deployment was not verified; whether Instaward funding counts toward the SCF lifetime cap is unknown.

### Biggest gaps, ranked
1. Differentiation against LumenWipe and Account Demolisher (must be the first paragraph of any submission).
2. No integrator, no traction, no mainnet.
3. Single unnamed builder; no maintenance plan.
4. No Soroban component under Open Track weighting; C-address awareness is only a refusal path.
5. Timeline at the 6-month cap for one person.

## 8. Competitor differentiation note

| | StellarExpert Account Demolisher | LumenWipe – Account Demolisher | Account Demolisher (demolisher.app) | Dustin (Instaward scope) |
|---|---|---|---|---|
| Status (as of 2026-09-25) | Live since 2019 (SOW) | SCF #44 Build Award $120K (responds to the Account Demolisher RFP); classic wind-down "runs today on testnet and mainnet" (README); hosted fee-bump sponsorship merged 2026-09-08 (PR #216, `feature/phase-2`) while the README still lists it under Tranche 2 | SCF #44 Build Award $120K; web app with testnet default and a mainnet/testnet/futurenet switch (README); testnet prototype end to end at submission | Testnet only; SDK + CLI |
| Interface | Web form, secret key pasted | Web UI, wallet adapter, stateless read-only REST API, `@lumenwipe/sdk` described as "a thin API fetch client"; typed npm transaction builder promised in Tranche 3 | Next.js web app; wallets via Stellar Wallets Kit (Freighter, Ledger, xBull, Albedo, Rabet, LOBSTR, Hana, WalletConnect); not a package | Library and CLI; no UI, no server, no mediator |
| Who pays fees | The closing account (SOW) | LumenWipe's own "dedicated, lightly funded" sponsor account via `POST /:network/fee-bump/sponsor` (PR #216, merged 2026-09-08): operation allowlist, `MAX_FEE_BUMP_STROOPS` cap, per-API-key rate limiting, single-account restriction; production status unverified | Closing account; its mediator validator "rejects malformed and fee-bumped envelopes" | The integrator's sponsor key; every transaction fee-bumped; zero-XLM is the primary case |
| Zero-XLM accounts | Cannot be served (SOW) | In code since 2026-09-08 (PR #217 routes reserve-locked closes through the sponsored fee-bump); application promised "an account at exactly its minimum balance closes end to end with sponsored fees" | Not addressed | Core scope, delivered on testnet in the Instaward (pending completion report) |
| Sponsored reserves | None (SOW; corroborated by both applications) | Claimable-balance sponsorship handling; accounts sponsoring others blocked | Hard stop when `numSponsoring` > 0; revokes held sponsorships | Unwinds sponsored trustlines on the closing account, reserve back to the sponsor |
| Soroban / DeFi | None | Five protocol exits, allowance inspector, SEP-41 conversion (Tranches 2 and 3) | SEP-41 discovery by simulation; exits for Blend, Aquarius, Soroswap, FxDAO | Detected and reported only; out of scope by design |
| Claimable balances / LP shares | None (SOW) | Yes (Tranche 1) / yes | Yes / classic LP withdrawal | Reported, not automated (Build Award D4 would add both) |
| Multisig | Web-form only (SOW) | Multi-key gathering (Tranche 1) | Refractor plus partial XDR | Reported; partial-XDR hand-off in Build Award D5 |
| Exchange destinations | Not handled (SOW) | Shared mediator account, open-source exchange registry | Temporary mediator account with server-side envelope validation | Refused with a reason (SEP-29 check planned); no mediator |
| Preview before signing | None; executes on key paste (SOW) | Deterministic dry-run plan | Dry-run plan tree with feasibility verdict | `planClose()` read-only plan with plan-hash pinning planned |
| Tests and baseline | — | Public E2E suite promised; adversarial suite in Tranche 2 | Adversarial corpus in Tranche 2 | Test matrix plus a recorded baseline of the existing tool on the same fixture |
| Licence | MIT (SOW; not re-verified) | Apache 2.0 | Apache 2.0 | [NEEDS INPUT: MIT or Apache 2.0] |

Other repositories found: two small personal repositories in the Electric Capital and Scout indexes (an account-merge tool and an unnamed TypeScript project) with no description or activity signal; not competitors. Adjacent but different: Authline (trustline onboarding SDK), OpenZeppelin Accounts Policy Builder, StellarExpert's refractor and tx-signers-inspector (both funded projects build on them), and SODAX, which shipped sponsored account activation for wallet partners in its SDK (article dated 2026-09-04) — the mirror image of Dustin's sponsored closure and a plausible integrator conversation.

### Reviewer risk: "why fund two account closers?"

Stated plainly, because a panel will: SDF funded two account-closing products in SCF #44, one of them now has hosted fee sponsorship in code, and both promise integrator-facing APIs. A Dustin submission that does not confront this in its first paragraph will not be read further. The concrete answer:

1. **Library versus hosted app.** Both funded tools put a server in the flow (LumenWipe's API builds unsigned transactions and sponsors fee-bumps from its own account; Account Demolisher routes exchange destinations through a mediator with server-side validation). Dustin has no server, no mediator and no hosted sponsor by default: the integrator holds the sponsor key and embeds `planClose()` and `executeClose()` in its own product. That is a different deployment model, not a better website.
2. **Complementary audiences.** The hosted apps serve individuals who arrive with a messy account; Dustin serves wallets, anchors and custodians closing accounts for their users, including in batch. Dustin refuses Soroban and DeFi positions with a reason and can point to the funded tools; they, in turn, could consume Dustin's planner and matrix.
3. **Collaboration offer.** Propose to both awardees that Dustin's planner, fixture builder and test matrix become the shared library layer; record the outcome of that conversation (accepted, declined, or no reply) in the submission. A declined offer still shows the panel that duplication was addressed in good faith.
4. **RFP-adjacent scope instead of a re-run of the RFP.** Wallet SDK adapter, custodial batch closer, and classic completeness for LP shares and claimable balances (section 6.1) answer the RFP's intent for integrators without re-funding what the hosted apps already deliver.

What Dustin should say, in one paragraph: "Two funded tools now let a person close their own account through a website. Dustin is for the other side of the transaction: the wallet, anchor or custodian that wants to close accounts for its users inside its own product, pay the fees itself, and read a plan before anything is signed. It is a library, not a site; it has no server in the signing path and no mediator account; and it is the only one built around the zero-XLM account as the primary case, with a public fixture, a test matrix and a recorded baseline. Where the funded tools go deep on Soroban and DeFi exits, Dustin stops and reports, and points to them." Offering the planner and test matrix upstream to the funded projects turns the overlap into a composability story a panel and a referrer can support.

## Assumptions

- The session was non-interactive; no question was asked of the builder. Every `[NEEDS INPUT]` marker is a fact only the builder can supply.
- The Instaward sprint is assumed to have started on the suggested date (2026-08-09) and to have ended around 2026-09-08; the completion report is assumed to be pending as of 2026-09-25. Nothing in this document asserts that the deliverables are complete.
- The builder is treated as a single person because the SOW names one builder; the Build Award budget is sized for one full-time engineer plus a part-time technical writer.
- Rates ($2,000/week developer, $1,500/week writer) are choices at the bottom of the skill's benchmark ranges, not the builder's actual rates.
- The round-watcher cache file was not written, and no reference guides (`submission-template.md`, `writing-budgets.md`, `submitting-tranches.md`, etc.) referenced by the skills exist locally; the skills' embedded rules were used instead. Rules that could not be verified live are labelled "skill-sourced".
- The competitor status columns rely on the SCF submission pages and repository READMEs fetched on 2026-09-25 and on self-reported figures in those applications; neither project's mainnet metrics were verified on-chain.
- LumenWipe's PR #216 and PR #217 are recorded as merged on 2026-09-08 into the `feature/phase-2` branch; a merge into a feature branch does not prove that the hosted fee-bump endpoint is live in production, and the README fetched on 2026-09-25 still lists sponsored fees as roadmap. The document therefore says "in code" rather than "shipped".
- "RFP answered / not visibly open" is inferred from the absence of any RFP listing on the pages reached on 2026-09-25 and from the two SCF #44 awards; it is not an SCF statement and must be confirmed with the SCF team.
- The SOW's technical claims about the StellarExpert tool are taken from the SOW; they are corroborated in part by the two funded applications but were not re-verified against source.
- The lifetime-cap treatment of Instaward funding is unknown and must be asked of the SCF team.
- The curated LumenLoop snapshot bundled with the stellar-build skills covers SCF rounds up to #43; rounds #44 to #46 come from live fetches and the Raven MCP.

## Sources

Live pages (fetched 2026-09-25 unless noted):
- SCF awards overview: https://communityfund.stellar.org/awards
- SCF #46 round page: https://communityfund.stellar.org/awards/recxrSMYwAl8vcglg
- SCF #45 round page: https://communityfund.stellar.org/awards/reccaFUJmN4HNQxvo
- SCF #44 round page: https://communityfund.stellar.org/awards/rec4FnYypcsKpBRB4
- LumenWipe – Account Demolisher submission: https://communityfund.stellar.org/submissions/recuKWaSdUL8Lkw9o
- Account Demolisher submission: https://communityfund.stellar.org/submissions/recqvIs2iRu34ESGo
- SCF Handbook: https://stellar.gitbook.io/scf-handbook and https://stellar.gitbook.io/scf-handbook/scf-awards/build-award (page states last updated 01/9/2026)
- SCF FAQ: https://stellar.gitbook.io/scf-handbook/additional-support/faq
- https://communityfund.stellar.org/build returned HTTP 404 on 2026-09-25
- js-stellar-wallets issue #98: https://github.com/stellar/js-stellar-wallets/issues/98 (open, 0 comments, repository archived 2024-02-08)
- LumenWipe repository README: https://github.com/LumenWipe/lumenwipe ; site https://lumenwipe.com ; docs https://docs.lumenwipe.com
- LumenWipe PR #216 (merged 2026-09-08, base `feature/phase-2`): https://github.com/LumenWipe/lumenwipe/pull/216 ; merged PRs mentioning fees (#216, #217, #220 on 2026-09-08; #277 on 2026-09-19; #127 on 2026-08-18): https://github.com/LumenWipe/lumenwipe/pulls?q=is%3Apr+is%3Amerged+fee
- SCF home page (no open RFP list shown): https://communityfund.stellar.org/ ; https://communityfund.stellar.org/rfps returned HTTP 404 on 2026-09-25
- SODAX sponsored account activation (article dated 2026-09-04, via LumenLoop): https://x.com/i/article/2095183191887822851
- Account Demolisher README: public repository linked from its SCF submission page; site https://demolisher.app ; docs https://docs.demolisher.app

Via the Raven MCP (LumenLoop content index, Scout index, Stellar developer docs), queried 2026-09-25:
- SCF #44 Round Recap (Medium, dated 2026-07-24; direct fetch returned HTTP 403): https://medium.com/stellar-community/scf-44-round-recap-b5e8acd87045
- SCF #45 Round Recap (Medium, dated 2026-09-23; direct fetch returned HTTP 403): https://medium.com/stellar-community/scf-45-round-recap-1ecf281821ab
- SCF #43 Round Recap (dated 2026-06-02): https://medium.com/stellar-community/scf-43-round-recap-62942f07757e
- SCF #40 Round Recap (dated 2025-12-31): https://medium.com/stellar-community/scf-40-round-recap-c01b44d85a04
- Introducing SCF v7.0 (dated 2026-01-16): https://stellar.org/blog/ecosystem/introducing-scf-v7
- Public Goods Award Q2 2026 (dated 2026-07-02): https://tansu.dev/blog/public-goods-award-q2
- LumenLoop operations: `get_scf_submissions` (slugs `lumenwipe`, `account-demolisher`), `search_directory`, `find_similar_scf_submissions`, `search_content_semantic`; Scout: `searchProjects` (scfAsOf 2026-08-12; statusAsOf 2026-09-01), `searchRepos` (generated 2026-09-25)
- Fee-bump transactions guide: https://developers.stellar.org/docs/build/guides/transactions/fee-bump-transactions
- Minimum balance and sponsored reserves: https://developers.stellar.org/docs/learn/fundamentals/lumens#minimum-balance
- Account merge operation: https://developers.stellar.org/docs/learn/fundamentals/transactions/list-of-operations#account-merge

Curated data bundled with the stellar-build skills (repository-relative, git-ignored):
- `stellar-build/skills/data/lumenloop/scf/rounds.json` (rounds through SCF #43 plus Public Goods and Liquidity awards)
- `stellar-build/skills/data/lumenloop/projects.json` (728 projects; Developer Tooling n=128 funded, median cumulative award $54,225)
- `stellar-build/skills/data/electric-capital/stellar-repos.json` (9,027 repositories)
- `stellar-build/skills/data/ideas/*.json` (thesis alignment check)

Project documents:
- `SUCCESSFUL_SOW.md` (accepted Instaward SOW, $5,000, 30 days)
- stellar-build skills used: `scf-round-watcher`, `scf-prescreen-checker`, `scf-interest-form-drafter`, `scf-referral-preparer`, `scf-submission-drafter`, `scf-budget-builder`, `scf-reviewer`
