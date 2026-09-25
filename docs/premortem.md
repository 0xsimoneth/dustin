# Dustin — Pre-mortem, Red Team and First Principles

Method: `advanced-elicitation` methods 34 (Pre-mortem Analysis), 17 (Red Team vs Blue Team) and 39 (First Principles Analysis), run non-interactively against the accepted Statement of Work (`SUCCESSFUL_SOW.md`, the source of truth). Written 2026-09-25. The builder is referred to as "the builder"; the reviewer is the ambassador chapter lead.

The frame for every story below: **it is day 30 and the binary success metric (SOW section 3) failed.** There is no partial credit, so a story counts as "fatal" when it alone makes any Appendix B checkbox false.

## 0. Top five by expected loss

| Rank | Story | Why it leads |
|---|---|---|
| 1 | #3 The success fixture was built so it cannot be closed | The SOW itself puts a "deliberately illiquid asset that exits through the unclosable path" on the same account whose full close is the metric. Any unclosable trustline blocks `AccountMerge`. Fatal by construction unless fixtures are split. |
| 2 | #2 Testnet reset erased the fixture and the evidence chain | Next reset is scheduled for 2026-12-16 17:00 UTC; the sprint start is unconfirmed; explorer links are the evidence. |
| 3 | #1 The sprint start was never pinned down | The SOW's suggested start (2026-08-09) is 47 days in the past and every deliverable is still "Not started"; without a written start date there is no day 30. |
| 4 | #4 "Zero spendable XLM" or "every transaction fee-bumped" was not literally true | Both are checklist items a reviewer can falsify with one Horizon call. |
| 5 | #12 Evidence was not reviewer-readable | The reviewer has "minimal technical expertise" (SOW section 6); a list of hashes is not evidence to them. |

## 1. Fifteen failure stories

Likelihood is a rough prior for a solo builder on a 30-day clock. "Owner-week" says who does the mitigation and in which sprint week (Week 0 = before day 1).

### #1 Schedule: the sprint start was never confirmed, so day 30 was never defined

> Update 2026-09-25: resolved. Funds were received on 2026-09-22 and the final deadline is 2026-10-22; the calendar is in docs/README.md. The residual risk is compression: day 4 has passed with no code, so Week 1 outputs are due by 2026-09-28.
- **Story.** The SOW says "Suggested Sprint Start Date 2026-08-09". Today is 2026-09-25. Appendix A still shows D1–D4 "Not started". Either the sprint silently started and is already 17 days overdue, or it has not started and no one has written down the new date. On "day 30" the builder and the chapter disagree about what day it is, and the review lands in a window that collides with the December testnet reset.
- **Likelihood.** High (it is already true today).
- **Impact.** High; becomes fatal when combined with #2.
- **Early warning sign.** No written start/end date in the repo or in a message to the chapter before any code is written.
- **Mitigation.** Week 0, the builder with the chapter lead: agree the start date in writing, derive day 30, and record both in `README.md`. Choose a start no later than **2026-10-26** so that day 30 (2026-11-25) leaves three weeks of review before the 2026-12-16 reset. If the start must be later, plan the final close and the evidence capture for the first week after the reset instead, and say so in the SOW tracker.

### #2 Testnet reset: the fixture, the transaction chain and the explorer links vanished
- **Story.** SDF resets testnet "2-4 times per year at 17:00 UTC", announced at least two weeks ahead; the docs list **December 16, 2026** as the scheduled 2026 date. Testnet Horizon's earliest ledger today is 128, closed 2025-12-17T17:30:12Z, so the network is in its last quarter before the reset. Resets "clear all ledger entries ... transactions, and historical data from Stellar Core, Horizon, and the Stellar RPC". If the sprint slips into December, or the chapter reviews in January, "open the explorer and see the transaction chain" is impossible for reasons unrelated to Dustin.
- **Likelihood.** Medium overall; high if the start date is after 2026-11-01.
- **Impact.** Fatal for the explorer-based checks in Appendix B.
- **Early warning sign.** A reset notice on the Stellar status page or the dashboard; a day-30 date within three weeks of 2026-12-16.
- **Mitigation.** Week 1, the builder: make fixture creation a scripted, idempotent command (`fixture:create`) so the whole messy account can be rebuilt in minutes after any reset. Week 4, the builder: the evidence package must survive a reset — store each transaction's envelope XDR, result XDR, Horizon JSON, and dated explorer screenshots next to the links, and state the reset date in the write-up ("links valid until 2026-12-16 17:00 UTC; after that, re-run `fixture:create` and `close` to reproduce"). Prefer Horizon and explorer links over RPC for evidence: the public testnet RPC keeps only ~7 days of history (ledger retention window 120,960 ledgers on 2026-09-25).

### #3 Fixture design: the success fixture was built so it cannot be closed
- **Story.** SOW D3 budgets "the messy fixture account ... plus a deliberately illiquid asset", and Week 3 expects "the deliberately illiquid asset that exits through the unclosable path with a stated reason" while also expecting "the messy fixture is closed". A trustline can only be removed at zero balance (`CHANGE_TRUST_INVALID_LIMIT` otherwise), and `AccountMerge` requires no trustlines, offers or data entries. So an account that contains one genuinely unclosable balance is, by protocol, unmergeable. The builder follows the SOW literally, the ladder correctly reports "unclosable", and the account still exists on day 30.
- **Likelihood.** Medium-high (the ambiguity is in the accepted text).
- **Impact.** Fatal.
- **Early warning sign.** `planClose()` on the success fixture prints any step classified "unclosable"; or a fixture trustline whose issuer the builder does not control.
- **Mitigation.** Week 1, the builder (acknowledged by the chapter lead in writing): split the fixtures. **Fixture A (metric)**: 0 spendable XLM, at least three trustlines with non-zero balances that each exit through a *different* rung of the ladder (path payment, return to issuer, send to a destination that holds the trustline), one sponsored trustline, at least one open offer, at least one data entry — fully closable by construction. **Fixture B (matrix)**: the illiquid, deauthorized, clawback-enabled, pool-share and raised-threshold cases, expected to end "unclosable with reason" and never merged. Note that "illiquid" alone is not "unclosable": with a cooperative issuer, an illiquid balance exits at rung two (return to issuer). Genuinely unclosable balances come from authorization state, not liquidity (see #8).

### #4 The metric's two literal conditions were not literally true
- **Story.** Condition one: "zero spendable XLM". Fixture construction paid fees from the fixture account, leaving 0.0093 XLM spendable, or the offers sold XLM (creating XLM selling liabilities) so the arithmetic was off. Condition two: "every transaction in the close is fee-bumped by the sponsor". One transaction in the chain went out through a plain `submitTransaction` during a late-night fix. The reviewer opens Horizon: `fee_account` on that transaction is the closed account. Checkbox false.
- **Likelihood.** Medium.
- **Impact.** Fatal (Appendix B items 1 and 5).
- **Early warning sign.** Before the close, `balance - minimum balance - selling liabilities` on Horizon `/accounts/{id}` is not exactly 0; any chain transaction whose Horizon record lacks `fee_bump_transaction` / whose `fee_account` differs from the sponsor.
- **Mitigation.** Week 2, the builder: `executeClose()` refuses to submit anything that is not a fee-bump envelope (assert at the submission boundary, not in the caller). Add a `verify` command that walks the chain and checks, for every transaction, `fee_account == sponsor`, inner fee charged == 0 (fee-bump results always report the inner fee as 0), and that the closed account is the inner source. Week 1, the builder: finish fixture construction with a fee-bumped sweep that sends the exact excess XLM to the sponsor so `available balance == 0` by the docs' formula `balance - minimum balance - liabilities.selling` where minimum balance is `(2 + numSubEntries + numSponsoring - numSponsored) × 0.5 XLM`. Make the fixture's offers sell the custom assets, never XLM, so `liabilities.selling` on XLM is 0.

### #5 Fee-bump mechanics: validity rules and sequencing failed under real submission
- **Story.** The outer fee was set to the inner fee; testnet was in surge pricing; `tx_insufficient_fee` and `tx_fee_bump_inner_failed` results piled up. A retry re-used the inner sequence number with a fee that was not 10x the first bid, so the replacement was silently dropped. Two steps submitted in parallel raced on the closed account's sequence number.
- **Likelihood.** Medium.
- **Impact.** Medium (delay, flaky demo), fatal only if it eats Week 2–3.
- **Early warning sign.** Any `tx_insufficient_fee` or `tx_bad_seq` in Week 2 smoke tests.
- **Mitigation.** Week 2, the builder, from the docs' validity rules: outer fee ≥ network minimum × (inner ops + 1) and ≥ the inner transaction's fee; a replacement for the same inner sequence number must bid ≥ 10× the first. Implement: read `/fee_stats` before each submission, set outer fee = max(inner fee, (ops + 1) × p90), serialize all submissions (one in flight), put time bounds on the inner transaction, and on `tx_insufficient_fee` rebuild with the 10× rule rather than resubmitting. Only the inner source's sequence number is consumed; the sponsor's is not, so many closes can share one sponsor.

### #6 Sponsored trustline unwinding was designed against the wrong rule
- **Story.** The builder read "unwinds sponsored trustlines" as "call `RevokeSponsorship` from the account being closed", got `op_not_sponsor`, then concluded the sponsor must co-sign the close, and built a two-party signing flow that the demo cannot show in 60 seconds.
- **Likelihood.** Medium-low.
- **Impact.** Medium (lost days); high if the final design needs a signature the demo does not have.
- **Early warning sign.** A `RevokeSponsorship` operation in any plan sourced by the closed account; a plan whose "XLM recovered" includes the sponsored 0.5 XLM.
- **Mitigation.** Week 1, the builder: encode the protocol rule in the planner — a sponsored entry is removed by its *owner's* normal operation (`ChangeTrust` limit 0), and "when a sponsored entry or subentry is removed, numSponsoring is decreased on the sponsoring account and numSponsored is decreased on the sponsored account". No sponsor signature is required to remove it; `RevokeSponsorship` is the sponsor's tool, not the closer's. The plan reports the released reserve as "returned to sponsor G..." and excludes it from the user's recovered XLM. Week 3 test: after the close, the sponsor's `num_sponsoring` has dropped by one and the destination received exactly the non-sponsored reserve plus balance.

### #7 Merge preconditions were discovered at the last step (sequence guard, sponsor status, immutable flag)
- **Story.** Everything up to the merge succeeded; the merge failed with `ACCOUNT_MERGE_IS_SPONSOR` because fixture construction had left a claimable balance created by the fixture account (its creator sponsors the reserve), or with `ACCOUNT_MERGE_SEQNUM_TOO_FAR` on a matrix account that had been bumped, or `ACCOUNT_MERGE_IMMUTABLE_SET`. The account is now empty but still exists — the worst possible end state for the metric.
- **Likelihood.** Low-medium.
- **Impact.** Fatal for that run; recoverable if caught early.
- **Early warning sign.** Horizon `/accounts/{id}` shows `num_sponsoring > 0`, `flags.auth_immutable == true`, or `sequence ≥ latestLedger × 2^32`.
- **Mitigation.** Week 1 (planner) and Week 3 (guard), the builder: `planClose()` checks all merge preconditions from the documented result codes before proposing anything — destination exists and differs from source, `AUTH_IMMUTABLE` not set, `num_sponsoring == 0` and no open sponsoring relationship, and the sequence rule "sequence number ... must be less than (ledgerSeq << 32)". The seqnum guard is a pure function `(sequence, latestLedger) → ok | waitLedgers(n) | unrecoverable`; a fresh account satisfies it one ledger after creation, so the realistic trigger is a prior `BumpSequence` — build the matrix case exactly that way on a throwaway account. Signers are not a blocker (they are removed automatically by the merge), so do not spend budget on signer teardown.

### #8 The disposal ladder fell through on the success fixture (no path, self-cross, dust, authorization)
- **Story.** Rung one: Horizon `/paths/strict-send` returned nothing because testnet has no market for the fixture asset, or the only path crossed the closed account's own offer (which had not been cancelled yet), or the dust amount rounded to zero XLM and failed `destMin`. Rung two: the issuer had `AUTH_REQUIRED` and the builder forgot to authorize the trustline, so the payment back to the issuer failed with `SRC_NOT_AUTHORIZED`. The balance stays, the trustline stays, the merge never happens.
- **Likelihood.** High for at least one asset in the first attempt.
- **Impact.** Fatal if it survives to the final run; otherwise a Week 3 bug.
- **Early warning sign.** Empty `/paths/strict-send` for a fixture asset; a fixture trustline with `is_authorized == false` or `is_authorized_to_maintain_liabilities == true`; an "unclosable" step on Fixture A.
- **Mitigation.** Week 1, the builder: the fixture script creates a market-maker account with a standing offer buying asset A for XLM, so rung one is demonstrable; asset B exits by return to its issuer (an issuer never needs a trustline to receive its own asset); asset C exits by payment to the destination, which holds the trustline. The fixture script explicitly authorizes every Fixture A trustline. Week 3, the builder: order is cancel-own-offers → path payments → issuer returns → destination payments → trustline removals → data removal → merge; derive `destMin` from the quoted path minus a slippage floor; treat amounts too small to route as "dust → issuer return"; classify `AUTHORIZED_TO_MAINTAIN_LIABILITIES` and deauthorized trustlines as unclosable with the reason "issuer must re-authorize or claw back" (that case lives on Fixture B).

### #9 Horizon throttling, outage, or the RPC gap stalled the close mid-chain
- **Story.** The planner polls in a tight loop; SDF's testnet Horizon rate-limits per IP at 3,600 requests/hour by default and answers 429; during the recorded take the chain stops between transaction two and three. Separately, the builder tried to go "RPC-only" because the docs call Horizon legacy, then discovered that the account-offers listing and strict-send path finding have no RPC equivalent.
- **Likelihood.** Medium.
- **Impact.** Medium-high (broken demo take; an account left half-closed, which re-planning can finish).
- **Early warning sign.** 429s in logs; incidents on the Stellar status page; a polling interval below one ledger close (~5 s).
- **Mitigation.** Week 2, the builder: a fixed request budget per close (account, offers, paths once; poll by hash with backoff); make Horizon and RPC URLs configurable so a third-party testnet Horizon or a local Quickstart node can stand in; make `executeClose()` re-plan from live state on every run so a crash mid-chain is resumed by running it again (every step is idempotent because it is derived from current ledger state, not from a saved plan).

### #10 Sponsor key hygiene: the secret leaked, or the sponsor was empty at demo time
- **Story.** The sponsor secret lived in `.env`, which was committed once "just to test CI", or it scrolled past in the recorded terminal. Or the testnet reset (see #2) wiped the sponsor account and friendbot rate-limited the re-fund during the demo.
- **Likelihood.** Medium.
- **Impact.** Medium; reputational rather than metric-fatal on testnet, but a leaked terminal can also expose the builder's real identity, which the repository rules forbid.
- **Early warning sign.** `.env` tracked by git; any log line containing an `S...` string; sponsor balance below 100 XLM before a run.
- **Mitigation.** Week 1, the builder: `.env.example` only, a secret scanner in pre-commit, and a logger that prints public keys only. Week 4, the builder: record the demo in a clean shell profile (no personal prompt, hostname or home path), check the sponsor balance as the first step of the demo script, and keep a second funded sponsor in reserve. Friendbot funds a *new* account with 10,000 XLM; do not rely on it to top up an existing one.

### #11 The baseline recording could not be made
- **Story.** SOW D3 promises "a recorded baseline run of the existing tool against that same fixture". On day 25 the builder opens the hosted tool and it either no longer exists (one competitor's README, written June 2026, states the hosted tool "is no more"), does not accept the testnet fixture, or its server refuses to co-sign below its 1 XLM payout threshold before the interesting failure is visible.
- **Likelihood.** Medium (availability unverified as of 2026-09-25; the route answers 200 with the explorer's application shell, which proves nothing).
- **Impact.** Medium-high for D3 evidence; not metric-fatal.
- **Early warning sign.** A day-1 browser check of the tool's testnet route fails or shows no testnet switch.
- **Mitigation.** Week 1, the builder: verify the hosted tool and its testnet support on day 1 and record that check. Fallbacks, in order: run the tool's published source locally against testnet (verify the license first — the SOW says MIT, an SCF #44 project description calls it public domain; do not vendor code until this is settled); if the source is unavailable, record a walkthrough of the relevant source lines plus a run of a currently live open-source closer (LumenWipe states its classic wind-down runs on testnet) and disclose the substitution to the chapter lead before submission, not after.

### #12 Evidence was not readable by the person who has to tick the boxes
- **Story.** The evidence package is a list of 64-character hashes. The reviewer opens one, sees "account not found" for the merged account and reads it as an error. The 60-second video shows a terminal scrolling JSON. The reviewer marks "Evidence Partial" on D2 and D4.
- **Likelihood.** High without deliberate design.
- **Impact.** High (the metric passes on-chain but fails in review).
- **Early warning sign.** No draft evidence page by the end of Week 3; nobody outside the builder has tried to verify a close.
- **Mitigation.** Week 4, the builder (draft in Week 3): an `EVIDENCE.md` with a numbered table — step, transaction hash, explorer link, one sentence "what to look for", screenshot — plus a before/after account snapshot and a "5-minute verification guide" written for a non-technical reader. Show "the account no longer exists" as three things together: the explorer's not-found page, the `account_merge` effect on the destination, and Horizon's 404 JSON, dated. Ask one person unfamiliar with Stellar to follow the guide before submission.

### #13 The demo was not recorded, or could not fit in 60 seconds
- **Story.** Each ledger closes in ~5 seconds. A close designed as eight separate transactions takes 45–60 seconds of waiting before any output, the take fails on transaction six, and by day 29 there is no recording. The installed `demo-video` skill turns out to be a Playwright pipeline for web apps and does not record terminals.
- **Likelihood.** Medium.
- **Impact.** Medium-high (D2 and D4 both cite the video).
- **Early warning sign.** No rehearsal recording by day 24; the plan for Fixture A contains more than three transactions.
- **Mitigation.** Week 3, the builder: group the whole close into the minimum number of transactions — for Fixture A, one inner transaction (operations apply sequentially and atomically, up to 100 per transaction) is enough, so the on-chain part of the demo is a single fee-bumped submission and one ledger close. Write the 60-second script (plan → confirm → submit → explorer) in Week 3. Week 4: record with a terminal recorder or screen capture, keep the uncut take as backup, and rehearse twice on fresh fixtures.

### #14 npm publish was blocked on day 29
- **Story.** `npm publish` fails: the unscoped name `dustin` already belongs to an unrelated package (v1.2.6, last modified 2022-06-16). The rename cascades through the README, the demo and the evidence links. Two-factor prompts and a registry account created that day add friction, and the package metadata is about to expose a personal identity that the repository rules keep out of this project.
- **Likelihood.** High for the name (certain), medium for the rest.
- **Impact.** Medium (D4), high if it forces a re-record of the demo.
- **Early warning sign.** `npm view dustin` returns an existing package (it does today).
- **Mitigation.** Week 1, the builder: pick a scoped name under a pseudonymous npm organisation matching the repository identity, publish a `0.0.1` placeholder to reserve it, set `author`/`repository` fields to that identity only, enable 2FA and a granular publish token. Week 3: `npm publish --dry-run` in CI. The demo and README use the scoped name from day one.

### #15 Scope creep: a frontend, a backend or a "sponsor service" ate Weeks 2–3
- **Story.** The competitor field is UI-heavy (two SCF #44 RFP projects ship web apps), so the builder starts a small web page "for the demo", then a tiny API "so the page can fee-bump", then key handling for that API. Day 30 arrives with a half-built app, `executeClose()` untested on the messy fixture, and the SOW's own out-of-scope list violated (wallet UI, production key management).
- **Likelihood.** Medium.
- **Impact.** High.
- **Early warning sign.** A `web/` or `server/` directory; `react`, `next`, `express` or `fastify` in `package.json`; any hosting account created.
- **Mitigation.** Week 0, the builder: write the scope guard into the README ("out of scope for the Instaward: UI, hosted services, contracts") and adopt one rule — nothing that is not needed for an Appendix B checkbox is built before D1–D3 are green. Park every such idea in the post-Instaward list (see `docs/skill-sweep.md`).

## 2. Red team: attacking the SOW's own claims

Format: claim → attack → what survives → hardening the blue team should apply. Sources are listed at the end.

### Claim A — "the zero-XLM case is the one the existing tool provably cannot serve"
- **Attack.** "Cannot" is a design choice, not a protocol impossibility. Any second account can send the stuck account a few stroops of XLM and the existing tool then works; on testnet this is free. The word "provably" rests on a reading of the tool's source at an unstated version and date, and the SOW's own facts about that source are now contested: the SOW says MIT-licensed, an SCF #44 project description calls the same tool public domain, and a June 2026 competitor README states the hosted tool "is no more". Finally, the SOW's premise "no programmatic interface ... issue 98 still open" was already stale at submission: SDF ran an "Account Demolisher" RFP, SCF #44 funded two responses to it (LumenWipe, $36,000; Account Demolisher, $72,000), and an Apache-2.0 TypeScript SDK responding to the same RFP appeared on GitHub in May 2026 with a mandatory dry-run preview and merge-precondition checks.
- **What survives.** The gap Dustin fills is real but narrower than written: none of the three READMEs mention fee-bump sponsorship as of 2026-09-25, and their target is DeFi-position unwinding and web flows for funded accounts. "Close an account that cannot pay for its own close, from a library, without a top-up" is still unclaimed. Issue 98 is verifiably open with zero comments in an archived repository (GitHub API, 2026-09-25).
- **Hardening.** Rewrite the "why it matters" paragraphs in the D4 write-up before a reviewer does it for you: cite the RFP cohort, position Dustin as the fee-sponsored, sponsor-aware planner that complements them, and keep "cannot serve without external help" as the precise claim. Record the tool's version/commit and license in the baseline recording.

### Claim B — "this is classic Stellar work ... with no smart contracts involved"
- **Attack.** True for the operations, but it hides the actual platform dependency: Horizon. The planner needs `/accounts/{id}/offers`, `/paths/strict-send` and `/fee_stats`; SDF's migration guide lists no RPC equivalents for path finding or offers, and the docs describe Horizon as legacy. Dustin is therefore a Horizon-dependent tool on a network where SDF "does not guarantee Testnet availability". Also, "no contracts" does not mean "no protocol drift": testnet is on protocol 28 today; the SDK pin must parse current XDR.
- **What survives.** No contract is needed, and adding one would not help — a classic fee-bump's fee source must be a G account, so a Soroban "sponsor vault" cannot pay fees itself.
- **Hardening.** Pin `@stellar/stellar-sdk` (17.1.0 on 2026-09-25), make Horizon/RPC endpoints configurable, and document "Horizon required for path finding and offer listing" as a known limit in the write-up.

### Claim C — "both of which are testable offline against a fixture account before anything goes live"
- **Attack.** Only the ordering logic is offline-testable, and only if the builder records account/offers JSON snapshots to test against. Path finding, fee statistics, authorization state and submission results need a network. "Offline" is being used to mean "not yet on testnet", which is not the same as hermetic.
- **What survives.** The planner can and should be a pure function over a recorded snapshot, which is the cheapest test surface in the project.
- **Hardening.** Snapshot-based unit tests for `planClose()` (recorded Horizon JSON for each matrix case), the Quickstart Docker image for hermetic integration runs, testnet only for the evidence run. The SOW's "fee-sponsored submission is ground already covered in earlier work" is unverifiable from the document; treat it as unproven until the first sponsored close lands in Week 2.

### Claim D — "anyone can open the explorer ... and see that the account no longer exists"
- **Attack.** After 2026-12-16 every testnet account "no longer exists", so the observation carries no information unless it is dated and paired with the chain that removed it. Even before the reset, a merged account and a never-created account look identical on Horizon (404).
- **Hardening.** Evidence pairs the creation transaction, a dated pre-close snapshot, the close chain, and the `account_merge` effect on the destination. State the validity window explicitly.

### Claim E — "grouped into the minimum number of transactions, with a reason and a fee estimate per step"
- **Attack.** The minimum for Fixture A is one transaction (≤ 100 operations, applied atomically), which makes "fee estimate per step" meaningless — fees are per transaction. If the builder ships one transaction per step to make the fee table look meaningful, the "minimum number" claim is false.
- **Hardening.** Report per-transaction fees with per-operation attribution, and say plainly that a single atomic transaction is the normal case; chunk only when an account exceeds the operation limit.

### Claim F — the budget: 200 hours in 30 days, 60/80/40/20
- **Attack.** 200 hours in 30 calendar days is 6.7 hours every day including weekends. D3 (40 h) has to cover fixture construction, a baseline recording, five edge-case classes and their fixtures; D4 (20 h) has to cover README, integration notes, a write-up, a 60-second video and an evidence package. Both look under-allocated relative to D1 (60 h for a read-only planner).
- **Hardening.** The dollar split is fixed by the SOW; the hours are not. Rebalance internally toward D3/D4 and protect Week 4 from engineering spill-over.

### Claim G — "wallets will not adopt a close flow they cannot inspect"
- **Attack.** Adoption is asserted, not evidenced, and wallet integration is out of scope. Two funded RFP projects are now the default answer to "how do I close an account", which lowers the odds that a wallet reaches for a third library.
- **Hardening.** Do not claim adoption in the write-up; claim inspectability and a clean integration surface, and list the one concrete adapter that would prove it (see the stretch ideas in `docs/skill-sweep.md`).

## 3. First principles: the minimum system that satisfies the metric

### Fundamental truths (documented protocol behaviour)
1. `AccountMerge` succeeds only when the source holds no trustlines, offers or data entries; signers are removed automatically. Additional blockers: `AUTH_IMMUTABLE`, being a sponsor, a missing or self destination, and `sequence ≥ ledgerSeq << 32`.
2. A trustline is removed with `ChangeTrust` limit 0, which requires a zero balance and no buying liabilities. An offer is cancelled with amount 0. A data entry is deleted with `ManageData` and no value.
3. A balance moves by `Payment` or `PathPaymentStrictSend`; an issuer needs no trustline to receive its own asset; an unauthorized trustline cannot send at all.
4. A fee-bump transaction lets a different account pay the fee; only the inner source's sequence number is consumed; the outer fee must be ≥ network minimum × (inner ops + 1) and ≥ the inner fee.
5. Operations inside one transaction apply in order and atomically; a transaction holds up to 100 operations.
6. Removing a sponsored entry releases the reserve to the sponsor automatically; minimum balance is `(2 + numSubEntries + numSponsoring - numSponsored) × 0.5 XLM`; available balance is `balance - minimum - liabilities.selling`.

### Therefore, the minimum system
- **Inspect.** Two Horizon reads (`/accounts/{id}`, `/accounts/{id}/offers`) plus one `/paths/strict-send` query per non-XLM balance.
- **Order.** A pure function from that snapshot to an operation list: cancel offers → dispose balances (path payment, else issuer, else destination, else stop and report) → remove trustlines → delete data → merge. It also runs the merge precondition checks and the sequence guard.
- **Build.** One inner transaction sourced by the closing account (chunked only above 100 operations), signed by that account.
- **Sponsor.** One fee-bump envelope signed by the sponsor, fee from `/fee_stats`.
- **Submit and verify.** Submit, poll by hash, then re-read the account (expect 404) and the destination's effects, and write the evidence rows.
- **Nothing else.** No database, no server, no UI, no contract, no plugin system, no retry engine (an atomic transaction either applies or does not; "recovery" is re-planning from live state and submitting again).

That is a few hundred lines of TypeScript with two secrets from the environment. Everything else in the SOW — the matrix, the baseline, the docs, the video — is evidence about this system, not part of it, and should be budgeted as such.

### The minimal Fixture A
- Accounts: sponsor S (friendbot-funded), issuers I1/I2/I3, market-maker M holding a standing offer buying asset A for XLM, destination D holding a trustline to asset C, and the account to close X, created by S.
- X holds trustlines to A (exits by path payment), B (exits by return to issuer), C (exits by payment to D), and one sponsored trustline created through the Begin/End sponsoring sandwich signed by S and X; each with a dust balance; two offers selling A; one data entry.
- With 4 trustlines, 2 offers and 1 data entry, `numSubEntries = 7` and `numSponsored = 1`, so the minimum balance is `(2 + 7 - 1) × 0.5 = 4.0 XLM`. The last construction step sweeps every stroop above 4.0 XLM to S in a fee-bumped payment so available balance is exactly zero.
- The close is one fee-bumped transaction of eleven operations; D receives 4.0 XLM, S's `num_sponsoring` drops by one, X returns 404.

### What is deliberately not needed for the metric
Liquidity pool withdrawal, claimable balances, multisig collection, mainnet key management, per-step fee tables, resumable job state, and any interface beyond a CLI. Each of these appears in the SOW only as "detected and reported" or as out of scope, and the pre-mortem shows that budget spent on them is the most likely cause of failing the one thing that is scored.

## Assumptions
- The actual sprint start is unconfirmed and treated as "to be confirmed with the chapter"; the SOW's suggested start (2026-08-09) is 47 days before the date of this document (2026-09-25). Day numbering in the mitigations is relative to whatever start is agreed.
- A single builder does all the work; "owner" therefore alternates between "the builder" and "the builder with the chapter lead" only where a written acknowledgement from the chapter is the mitigation.
- Testnet facts (last reset 2025-12-17, next scheduled reset 2026-12-16, protocol 28, base reserve 0.5 XLM, base fee 100 stroops, RPC retention ~7 days) are as observed on 2026-09-25 and may change; the reset date should be re-checked on the status page at sprint start.
- The status of the hosted StellarExpert tool and its license were unverified when this document was drafted; both readings (MIT per the SOW, public domain per an SCF #44 project description; "no more" per a June 2026 competitor README) are reported as found. Update 2026-09-25: the competitive landscape document verified that the tool is live (route and menu entry present in current explorer source, testnet co-signer responding, public mediator receiving merges on 2026-09-23 and 2026-09-24) and that the client is MIT-licensed inside the explorer monorepo, so failure story #10's day-1 check stays but its "tool is gone" branch is now unlikely.
- Competitor facts come from public READMEs, the LumenLoop directory and GitHub repository search on 2026-09-25; no competitor code was run.
- Fixture A's counts (4 trustlines, 2 offers, 1 data entry) are one valid instantiation of the SOW's "at least" thresholds, chosen so the sponsored trustline does not have to be counted toward the three non-zero-balance trustlines.
- The elicitation was run non-interactively; no clarification was requested from the builder or the chapter.

## Sources
- Accepted Statement of Work: `SUCCESSFUL_SOW.md` in this repository (sections 3, 4, 5, 6, Appendix B).
- Fee-bump transactions (validity rules, inner fee reported as 0, sequence number from inner source): https://developers.stellar.org/docs/build/guides/transactions/fee-bump-transactions
- Sponsored reserves (sandwich, revoke sponsorship, minimum balance formula, reserve release on removal): https://developers.stellar.org/docs/build/guides/transactions/sponsored-reserves
- Account merge preconditions, `ACCOUNT_MERGE_IS_SPONSOR`, signers not a blocker, sequence rule: https://developers.stellar.org/docs/learn/fundamentals/transactions/list-of-operations#account-merge
- Account merge result codes (`IMMUTABLE_SET`, `SEQNUM_TOO_FAR`, `NO_ACCOUNT`, `MALFORMED`): https://developers.stellar.org/docs/data/apis/horizon/api-reference/errors/result-codes/operation-specific/account-merge
- Change trust result codes (`CHANGE_TRUST_INVALID_LIMIT`, `NO_ISSUER`, `LOW_RESERVE`): https://developers.stellar.org/docs/data/apis/horizon/api-reference/errors/result-codes/operation-specific/change-trust
- Path payment strict send result codes (`SRC_NOT_AUTHORIZED`, `NO_TRUST`, `NO_DESTINATION`): https://developers.stellar.org/docs/data/apis/horizon/api-reference/errors/result-codes/operation-specific/path-payment-strict-send
- Minimum balance, base reserve, subentry types, available balance formula: https://developers.stellar.org/docs/learn/fundamentals/lumens#minimum-balance and https://developers.stellar.org/docs/learn/fundamentals/stellar-data-structures/accounts
- Asset authorization flags (`AUTH_REQUIRED`, `AUTH_REVOCABLE`, `AUTHORIZED_TO_MAINTAIN_LIABILITIES`, clawback, immutable): https://developers.stellar.org/docs/tokens/control-asset-access
- Networks: testnet reset cadence, scheduled 2026 reset date (December 16, 2026), friendbot behaviour, no availability guarantee: https://developers.stellar.org/docs/networks
- Horizon rate limiting (3,600 requests/hour per IP by default, 429): https://developers.stellar.org/docs/data/apis/horizon/api-reference/structure/rate-limiting
- Horizon to RPC migration (endpoints without RPC mappings): https://developers.stellar.org/docs/data/apis/migrate-from-horizon-to-rpc
- CAP-15 fee-bump transactions and CAP-33 sponsored reserves: https://github.com/stellar/stellar-protocol/blob/master/core/cap-0015.md and https://github.com/stellar/stellar-protocol/blob/master/core/cap-0033.md ; CAP-1 bump sequence: https://github.com/stellar/stellar-protocol/blob/master/core/cap-0001.md
- Testnet Horizon, earliest retained ledger 128 closed 2025-12-17T17:30:12Z and latest ledger 4,865,188 on 2026-09-25 (protocol 28, base reserve 5,000,000 stroops, base fee 100 stroops): https://horizon-testnet.stellar.org/ledgers?order=asc&limit=1 and https://horizon-testnet.stellar.org/ledgers?order=desc&limit=1
- Testnet RPC `getHealth` on 2026-09-25 (ledger retention window 120,960): https://soroban-testnet.stellar.org
- Stellar status page API (no scheduled maintenance listed on 2026-09-25): https://status.stellar.org/api/v2/scheduled-maintenances/upcoming.json
- js-stellar-wallets issue 98 (open, 0 comments, created 2019-08-12) and repository archived status, via the GitHub API on 2026-09-25: https://github.com/stellar/js-stellar-wallets/issues/98
- npm registry: `dustin` v1.2.6 (unrelated package, modified 2022-06-16); `@stellar/stellar-sdk` 17.1.0 (queried 2026-09-25).
- SCF #44 Account Demolisher RFP responders, via the LumenLoop ecosystem directory through Raven MCP on 2026-09-25: LumenWipe (Developer Tooling, awarded $36,000, https://lumenwipe.com) and Account Demolisher (Applications, awarded $72,000, https://demolisher.app); SCF handbook RFP track: https://stellar.gitbook.io/scf-handbook/scf-awards/build-award/rfp-track
- Competitor READMEs and repository metadata from a GitHub repository search for "demolisher stellar" on 2026-09-25 (three repositories created 2026-05-30 to 2026-06-09; the SDK repository is Apache-2.0 and describes a mandatory dry-run preview and merge-precondition validation).
- StellarExpert hosted tool routes answered HTTP 200 with the explorer application shell on 2026-09-25 (availability inconclusive): https://stellar.expert/demolisher/testnet
