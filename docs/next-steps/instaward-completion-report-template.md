# Dustin — Instaward Completion Report (Template)

Template produced on 2026-09-25 from the `scf-tranche-reporter` format, adapted to a Stellar Instaward. It maps one to one onto the accepted SOW (`SUCCESSFUL_SOW.md`): section 5.1 (weekly plan), section 6.1 (planned evidence), section 6.2 (ambassador verification checklist), Appendix A (deliverable tracker) and Appendix B (binary success metric). Replace every `[ ]` placeholder; delete nothing else. The reviewer is the chapter lead, who may have limited technical expertise, so every evidence link must be openable in a browser without tooling.

## Report header

| Field | Value |
|---|---|
| Program | Stellar Instawards, via the Stellar Türkiye ambassador chapter |
| Project | Dustin |
| SOW status | Accepted; awarded budget $5,000; planned effort 200 hours at $25/hour |
| Suggested sprint start (SOW) | 2026-08-09 |
| Actual sprint window | 2026-09-22 (funds received) to 2026-10-22 (final deadline) |
| Report date | [ date ] |
| Reporting party | The builder |
| Reviewer | The chapter lead |
| Repository | [ public URL ] at tag [ tag ] / commit [ full SHA ] |
| npm package | [ package name and version ] or "not published" with reason |
| Network | Stellar testnet only (mainnet is out of scope per SOW section 4.1) |

## A. Binary success metric (SOW Appendix B, no partial credit)

| Criterion | Status (Met / Not met) | Evidence (explorer link, file, or screenshot) |
|---|---|---|
| Fixture account on testnet holds zero spendable XLM before the close | [ ] | [ explorer link to the fixture account before the close, or committed snapshot ] |
| Fixture holds at least 3 trustlines with non-zero balances | [ ] | [ link ] |
| Fixture holds at least 1 open offer | [ ] | [ link ] |
| Fixture holds at least 1 data entry | [ ] | [ link ] |
| Every transaction in the close is fee-bumped by the sponsor (closed account pays no fee) | [ ] | [ list of fee-bump transaction hashes with explorer links; the inner source is the fixture, the fee source is the sponsor ] |
| The account no longer exists on a public testnet explorer | [ ] | [ explorer link showing the account not found ] |
| The full transaction chain is linkable from the evidence package | [ ] | [ evidence package link ] |

Pass requires every row Met. If any row is Not met, say so here and in section F; do not submit a partial success as a pass.

## B. Deliverable reports (SOW sections 4.1 and 6.1)

### Deliverable 1 — `planClose()`, the read-only planner

**Planned (SOW):** an SDK function that inspects any account and returns an ordered close plan (offers to cancel, balances to dispose of and how, trustlines and data entries to remove, XLM recovered, final merge), grouped into the minimum number of transactions with a reason and fee estimate per step; dry run by default; changes nothing; rendered from a CLI.

**Delivered:** [ one paragraph: what exists, where, how to run it ]

**Completion criteria mapping:**

| Criterion | Status | Evidence |
|---|---|---|
| Returns a correct ordered plan for the fixture account as a dry run | [ ] | [ committed CLI output file in the repository, with commit SHA ] |
| Covers trustlines, open offers, data entries, sponsored reserves, liquidity pool shares (detected) | [ ] | [ test names or output lines ] |
| Groups steps into the minimum number of transactions with reason and fee estimate per step | [ ] | [ output excerpt ] |
| Never mutates state (dry-run guarantee) | [ ] | [ test name; note that the account sequence number is unchanged after a plan ] |
| CLI renders the plan for any testnet account | [ ] | [ command line and sample output ] |

**Evidence (SOW 6.1 evidence type: public repo + CLI output):**
- Source: [ repository URL, path to the planner module, commit SHA ]
- Committed output for the fixture: [ path ]
- Reproduction command: [ exact command ]

**Deviations:** [ none / description and reason ]

**Effort:** planned 60 hours / $1,500 — actual [ hours ] / [ $ ]

### Deliverable 2 — `executeClose()`, live on testnet

**Planned (SOW):** executes the plan against a real account with every transaction fee-bumped by a sponsor; disposal ladder for leftover balances (path payment, return to issuer, transfer to destination, unclosable with reason); sponsored trustline unwinding with the reserve returned to the sponsor; `ACCOUNT_MERGE_SEQNUM_TOO_FAR` guard; submission with retry and failure recovery; first end-to-end close of the messy fixture.

**Delivered:** [ one paragraph ]

**Completion criteria mapping:**

| Criterion | Status | Evidence |
|---|---|---|
| Zero-XLM account closed end to end with sponsored fees (week 2 simple close) | [ ] | [ transaction hashes ] |
| Full messy fixture closed end to end (week 3) | [ ] | [ transaction hashes, in order ] |
| Every transaction fee-bumped by the sponsor | [ ] | [ per-hash note: inner source = fixture, fee source = sponsor ] |
| Disposal ladder exercised: path payment, issuer return, destination transfer, unclosable with reason | [ ] | [ one hash or log line per rung; the illiquid asset must exit through the unclosable path with its stated reason ] |
| Sponsored trustline unwound with reserve returned to sponsor | [ ] | [ hash plus sponsor balance before/after ] |
| Sequence-number guard prevents `ACCOUNT_MERGE_SEQNUM_TOO_FAR` | [ ] | [ test name or log ] |
| Retry and failure recovery | [ ] | [ test name or recorded interrupted run ] |
| Account gone from a public explorer | [ ] | [ link ] |

**Evidence (SOW 6.1 evidence type: transaction hashes + 60-second video):**
- Transaction chain: [ ordered list of hashes with explorer links ]
- Closed account: [ explorer link ]
- Video: [ URL ] (shows the same close from the CLI, start to finish)

**Deviations:** [ none / description and reason ]

**Effort:** planned 80 hours / $2,000 — actual [ hours ] / [ $ ]

### Deliverable 3 — Edge cases and test matrix

**Planned (SOW):** test coverage for illiquid leftover balance, sponsored trustlines, `ACCOUNT_MERGE_SEQNUM_TOO_FAR`, authorization-required and clawback-enabled trustlines, liquidity pool shares (detected and reported, not withdrawn); construction of the messy fixture (3 trustlines with dust, 2 open offers, 1 data entry, 1 sponsored trustline, 0 XLM, plus a deliberately illiquid asset); a recorded baseline run of the existing StellarExpert tool against the same fixture showing where it stops; raised multisig thresholds detected and reported.

**Delivered:** [ one paragraph ]

**Completion criteria mapping:**

| Criterion | Status | Evidence |
|---|---|---|
| Fixture builder script creates the messy account deterministically | [ ] | [ path, command, resulting account link ] |
| Matrix: illiquid leftover balance | [ ] | [ test name ] |
| Matrix: sponsored trustline (reserve to sponsor) | [ ] | [ test name ] |
| Matrix: `ACCOUNT_MERGE_SEQNUM_TOO_FAR` | [ ] | [ test name ] |
| Matrix: authorization-required trustline | [ ] | [ test name ] |
| Matrix: clawback-enabled trustline | [ ] | [ test name ] |
| Matrix: liquidity pool shares detected and reported | [ ] | [ test name ] |
| Matrix: raised multisig thresholds detected and reported | [ ] | [ test name ] |
| Baseline recording of the existing tool stopping on the fixture | [ ] | [ video URL and the step where it stops ] |
| Test run screenshot | [ ] | [ image path or CI run link ] |

**Evidence (SOW 6.1 evidence type: test results screenshot + public repo + baseline recording):**
- Test command: [ exact command ]; results: [ N passed / M skipped ] on commit [ SHA ]
- Baseline recording: [ URL ]

**Deviations:** [ none / description and reason ]

**Effort:** planned 40 hours / $1,000 — actual [ hours ] / [ $ ]

### Deliverable 4 — Documentation, demo and evidence

**Planned (SOW):** public repository with README and integration notes; write-up covering ordering rules and known limits; 60-second demo video; evidence package with transaction hashes and explorer links; npm publication (week 4).

**Delivered:** [ one paragraph ]

**Completion criteria mapping:**

| Criterion | Status | Evidence |
|---|---|---|
| README and integration notes | [ ] | [ URL ] |
| Write-up: ordering rules and what is not handled | [ ] | [ URL ] |
| 60-second demo video | [ ] | [ URL ] |
| Evidence package with hashes and explorer links | [ ] | [ URL ] |
| npm package published | [ ] | [ URL ] or reason not published |

**Deviations:** [ none / description and reason ]

**Effort:** planned 20 hours / $500 — actual [ hours ] / [ $ ]

## C. Weekly plan versus actual (SOW section 5.1)

| Week | Planned work (SOW) | Expected output (SOW) | Actual output | Dates |
|---|---|---|---|---|
| 1 — Inventory and planner | Build fixture; run the existing tool and record where it stops; write inspector and ordering logic; CLI | Correct dry-run plan for the fixture printed in the CLI; baseline recording | [ ] | [ ] |
| 2 — Simple close, end to end | `executeClose()` for cases with no leftover balance; fee sponsorship wired | Zero-XLM account closed on testnet with sponsored fees; hashes; account gone | [ ] | [ ] |
| 3 — Leftover balance ladder | Disposal ladder; sponsored trustline unwinding; sequence guard; edge-case matrix; close the full fixture | Messy fixture closed; tests pass including the illiquid asset via the unclosable path | [ ] | [ ] |
| 4 — Publish and demo | Error handling and CLI polish; npm publish; 60-second demo; evidence package; write-up | Demo, evidence package, write-up; D1 to D3 closed | [ ] | [ ] |

## D. Evidence verification checklist (SOW section 6.2, for the chapter lead)

| Deliverable | Evidence present | Evidence partial | Evidence missing | Comments |
|---|---|---|---|---|
| Deliverable 1: `planClose()` | ☐ | ☐ | ☐ | |
| Deliverable 2: live close on testnet | ☐ | ☐ | ☐ | |
| Deliverable 3: edge cases and tests | ☐ | ☐ | ☐ | |
| Documentation, demo and evidence | ☐ | ☐ | ☐ | |

## E. Hours and budget summary (SOW section 4.2)

| Item | Planned hours | Actual hours | Planned budget | Actual (hours × $25) | Notes |
|---|---|---|---|---|---|
| D1 `planClose()` | 60 | [ ] | $1,500 | [ ] | |
| D2 `executeClose()` | 80 | [ ] | $2,000 | [ ] | |
| D3 Edge cases and test matrix | 40 | [ ] | $1,000 | [ ] | |
| Documentation, demo and evidence | 20 | [ ] | $500 | [ ] | |
| **Total** | **200** | [ ] | **$5,000** | [ ] | The award is fixed at $5,000; actual hours are reported for transparency, not for re-billing |

No infrastructure, hosting or subscription costs were budgeted (testnet RPC and friendbot are free). If any were incurred, list them here as unbudgeted and unreimbursed.

## F. Deviations and scope changes

- Scope changes: [ what changed, why, and whether the chapter lead was told before this report ]
- Timeline changes: [ if delivery ran past the 30 days, by how much and why ]
- Approach changes: [ e.g. a different disposal order, a different sponsor model ]
- Out-of-scope items (SOW section 4.1) confirmed untouched: mainnet; contract accounts (C addresses); liquidity pool withdrawal; raised-threshold multisig automation; claimable balance cleanup; production key management (sponsor key remained an environment variable); wallet UI; third-party wallet integration. [ confirm each, or explain any exception ]

If none: "No deviations from the accepted SOW."

## G. Known limits and open issues

- [ list every case the tool reports as unclosable and why ]
- [ list any flaky test, testnet reset dependency, or fixture rebuild caveat ]
- [ security notes: the sponsor key is an environment variable; not for mainnet ]

## H. Next-step alignment (SOW section 7)

Selected option: [ ] Apply to SCF Build Award / [ ] Continue independently / [x] Apply for a follow-on Instaward / [ ] Seek other ecosystem support

Reasoning and the proposed follow-on scope are in `docs/next-steps/scf-path.md` (sections 3.2 and 3.3). The mainnet gate that would have to close before any mainnet use is in `docs/next-steps/mainnet-readiness.md` and is outside this SOW.

## I. Evidence quality checklist (from the tranche reporter; complete before sending)

- [ ] Every URL opened in a fresh browser session (no login) and reaches the intended page
- [ ] Repository is public; commit SHA or tag for this report is stated in the header
- [ ] Every transaction hash links to a public testnet explorer page
- [ ] The closed account link shows "not found" (or the explorer's equivalent), captured also as a screenshot in case the testnet is reset
- [ ] The demo video is uploaded to a stable host and covers the full close, start to finish
- [ ] The baseline recording shows the existing tool's stopping point clearly, with the fixture address visible
- [ ] Every deliverable is addressed, including incomplete ones with an explanation and a plan
- [ ] No secret keys, environment files or personal data appear in any evidence artifact
- [ ] Testnet reset risk noted: evidence that depends on live testnet state is also committed as files

## Assumptions

- The Instaward has no formal tranche form; this template mirrors the SCF Build Tranche Completion Form structure so that the same material can be reused for an SCF Build Award later. The chapter lead may accept a shorter report; keep sections A, B and D at minimum.
- Hours are reported at the SOW's flat $25/hour for transparency; the award amount does not change with actual hours.
- The reviewer is assumed to verify evidence in a browser only, as SOW section 6 requires.
- Stellar testnet is periodically reset; the template therefore asks for committed files and screenshots alongside live links.
- The template was produced without access to the delivered code or evidence; all statuses are placeholders.

## Sources

- `SUCCESSFUL_SOW.md`: sections 3 (objective and success metric), 4.1 (deliverables and out of scope), 4.2 (budget: D1 60 h / $1,500; D2 80 h / $2,000; D3 40 h / $1,000; documentation 20 h / $500; total 200 h / $5,000), 5.1 (weekly plan), 6.1 and 6.2 (evidence), 7 (next step), Appendix A and B
- stellar-build skill `scf-tranche-reporter` (report structure, evidence table, deviation handling, common delays)
- SCF Handbook, fetched 2026-09-25: tranche submission within 90 days of the last payment and timegating between tranches (https://stellar.gitbook.io/scf-handbook/scf-awards/build-award and https://stellar.gitbook.io/scf-handbook) — quoted only as context for reusing this report format for a Build Award
- `docs/next-steps/scf-path.md` and `docs/next-steps/mainnet-readiness.md` (companion documents produced on 2026-09-25)
