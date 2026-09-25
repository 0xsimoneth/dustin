# Stellar Instawards — Statement of Work (Accepted)

> Status: **Accepted**. Awarded budget: **$5,000**.
> Actual sprint window: funds received **2026-09-22**, final delivery deadline **2026-10-22** (the suggested start date in section 1 was superseded).
> Program: Stellar Instawards, via the Stellar Türkiye ambassador chapter.

## 1. Project & Team Information

| Field | Details |
|---|---|
| Project Name | Dustin |
| Builder / Team Name | the builder (0xsimoneth) |
| Primary Contact | the builder; contact details are held off-repository |
| Ambassador Chapter | Stellar Türkiye |
| Ambassador Chapter Lead | the chapter lead; name held off-repository |
| Date Submitted | 2026-07-27 |
| Suggested Sprint Start Date | 2026-08-09 |

## 2. Instawards Overview & Intent

### 2.1 Instawards Purpose (for Builder Context)

Instawards are designed to support short, clearly scoped, execution-focused work that helps a project make tangible progress toward building on Stellar. Instawards are meant to fund specific, achievable outcomes that can be completed and demonstrated within 30 days or less. This SOW represents a shared commitment between the Builder and the Ambassador Chapter Lead on what will be delivered, why it matters, and how success will be verified.

## 3. Problem Statement & Objective

### Problem Being Addressed

A Stellar account cannot be merged while it still holds subentries. Trustlines, open offers and data entries all block AccountMerge, and a trustline itself cannot be removed while it holds any balance. Closing an account is therefore an ordered teardown, and the base reserves stay locked until it finishes.

There is already a tool for this, and it is worth being precise about what it does. StellarExpert's Account Demolisher has been live since 2019, is MIT licensed, and automates most of the sequence: it cancels offers, sells leftover assets on the DEX, removes trustlines and data entries, and merges the account. Reading its source shows exactly where it stops.

Every intermediate transaction it builds is sourced from, and paid for by, the account being closed, and its server declines to co-sign a merge that pays out less than 1 XLM. That excludes the accounts that most need closing. An account sitting at its minimum reserve, say 1 XLM base plus two trustlines at 0.5 each while holding exactly 2 XLM, has nothing spendable and cannot submit any transaction at all. Removing the trustlines would release the reserve, but a fee is required to remove them. Fee-bump transactions exist for exactly this case, and the tool does not use them.

The same source has no handling for sponsored reserves, where the released reserve returns to the sponsor rather than the account holder, and no preflight, so an irreversible operation begins the moment a secret key is pasted into a web form. It also has no programmatic interface, which means a wallet cannot offer account closure to its users without sending them off to that form. The request for a callable library was filed in 2019 as stellar/js-stellar-wallets issue 98. It is still open with no comments, in a repository archived in 2024.

### Objective of This Instaward

After 30 days, Dustin will close a deliberately messy Stellar testnet account that has zero spendable balance, using fee-sponsored transactions so the account being closed never pays a fee. In one flow it cancels the offers, disposes of the leftover balances, removes the trustlines and data entries, and merges to a destination the user picks.

**Success metric (binary):** one testnet account holding zero spendable XLM, at least 3 trustlines with non-zero balances, at least 1 open offer and at least 1 data entry is fully closed and merged. Pass means anyone can open the explorer, see the transaction chain, and see that the account no longer exists. There is no partial credit.

**Why this is achievable in 30 days:** this is classic Stellar work with the JavaScript SDK, with no smart contracts involved. Fee-sponsored submission is ground already covered in earlier work, so the new part is the ordering logic and the fallback ladder for leftover balances, both of which are testable offline against a fixture account before anything goes live.

## 4. Scope of Work (30-Day Deliverables)

> Important guidance: This scope must be achievable within 30 calendar days. If the work feels larger, it should be reduced or split into more achievable phases.

### 4.1 In-Scope Deliverables

#### Deliverable 1 — `planClose()`, the read-only planner

An SDK function that inspects any account and returns an ordered close plan: which offers to cancel, which balances need disposing and how, which trustlines and data entries to remove, how much XLM will be recovered, and the final merge. Grouped into the minimum number of transactions, with a reason and a fee estimate per step. Runs as a dry run by default and changes nothing.

**Why this matters:** Closing an account is irreversible, and the existing tool starts executing as soon as a key is pasted. A plan that can be read before anything is signed is what makes this safe to expose in a wallet, and it is also the part an integrator reads first.

#### Deliverable 2 — `executeClose()`, live on testnet

Executes the plan against a real account, with every transaction fee-bumped by a sponsor so a zero-XLM account can be closed. Includes the disposal ladder for leftover balances: sell via path payment first, send back to the issuer if there is no path, send to the destination account if it holds the trustline, and report the item as unclosable with a stated reason if none of those work. Also unwinds sponsored trustlines, where the released reserve returns to the sponsor rather than the account holder.

**Why this matters:** This is the flow itself, and the zero-XLM case is the one the existing tool provably cannot serve. Those accounts cannot help themselves: removing their trustlines would free their own reserves, but they cannot pay the fee to do it.

#### Deliverable 3 — Edge cases and test matrix

Test coverage for the cases that break naive implementations: illiquid leftover balance, sponsored trustlines where the reserve returns to the sponsor rather than the user, `ACCOUNT_MERGE_SEQNUM_TOO_FAR`, authorization-required and clawback-enabled trustlines, and liquidity pool shares (detected and reported, not withdrawn). Includes construction of the messy fixture account used to drive the matrix, and a recorded baseline run of the existing tool against that same fixture showing where it stops.

**Why this matters:** Wallets will not adopt a close flow they cannot inspect. The test matrix is what turns this from a demo into something another team can pick up, and the baseline run turns the gap from a claim into something a reviewer can watch.

### Out of Scope (Explicitly Not Included)

- Mainnet. Testnet only, no real value.
- Contract accounts (C addresses). Classic G address accounts only.
- Liquidity pool share withdrawal. Detected and reported, not automated.
- Multisig accounts with raised thresholds. Detected and reported, not automated.
- Claimable balance cleanup.
- Production key management. The sponsor uses an env key for this scope.
- Wallet UI. A CLI demo is the interface for this scope, integration UI is left to the integrator.
- Third-party wallet integration work.

### 4.2 Deliverable-Aligned Budget Request

**Requested Budget Amount: $5,000**

**Rationale for Budget Request:**

The full amount covers engineering time at a flat $25 per hour. No infrastructure, hosting, or subscription costs are included in this request. Testnet RPC access is free and public, and the fee-sponsoring account is funded from the testnet friendbot at no cost.

| Item | Budget | Hours | Covers |
|---|---|---|---|
| D1, `planClose()` — the read-only planner | $1,500 | 60 | Account inspection across all subentry types (trustlines, open offers, data entries, sponsored reserves, liquidity pool shares), the ordering engine that resolves dependencies between them, transaction grouping into the minimum number of submissions, per-step fee estimation and reason strings, dry-run guarantees so the planner can never mutate state, and the CLI surface that renders the plan. |
| D2, `executeClose()` — live close on testnet | $2,000 | 80 | Fee-sponsored submission so a zero-XLM account can be closed, the leftover-balance disposal ladder (path payment, issuer return, destination transfer, unclosable-with-reason), sponsored trustline unwinding where the reserve returns to the sponsor rather than the user, the `ACCOUNT_MERGE_SEQNUM_TOO_FAR` guard, transaction submission with retry and failure recovery, and the first end-to-end close of the messy fixture account on testnet. |
| D3, Edge cases and test matrix | $1,000 | 40 | Construction of the messy fixture account (3 trustlines with dust, 2 open offers, 1 data entry, 1 sponsored trustline, 0 XLM) plus a deliberately illiquid asset, the recorded baseline run of the existing tool against it, and test coverage for the cases that break naive implementations: illiquid leftover balance, authorization-required trustlines, clawback-enabled trustlines, liquidity pool shares, and raised multisig thresholds. |
| Documentation, demo, and evidence | $500 | 20 | Public repository with README and integration notes, the write-up covering ordering rules and known limits, the 60-second demo video, and the evidence package with transaction hashes and explorer links. |
| **Total** | **$5,000** | **200** | |

## 5. 30-Day Execution Plan & Timeline

### 5.1 Weekly Breakdown

| Week | Planned Work | Expected Output |
|---|---|---|
| **Week 1 — Inventory and planner** | Build the messy fixture account on testnet (3 trustlines with dust, 2 open offers, 1 data entry, 1 sponsored trustline, 0 XLM). Run the existing StellarExpert tool against it and record where it stops. Write the account inspector and the ordering logic behind `planClose()`. Drive it from a CLI. | `planClose()` returns a correct ordered plan for the fixture, as a dry run, printed in the CLI. Nothing is submitted yet. A recorded baseline showing the existing tool failing on the same account. |
| **Week 2 — Simple close, end to end** | Implement `executeClose()` for the cases with no leftover balance: cancel offers, remove data entries, remove zero-balance trustlines, merge to destination. Wire fee sponsorship so the account needs no XLM. | A zero-XLM account is closed end to end on testnet with sponsored fees, with verifiable transaction hashes and the account gone from the explorer. |
| **Week 3 — The leftover balance ladder** | Add the disposal ladder (path payment, issuer, destination, unclosable with reason). Handle sponsored trustline unwinding and the sequence number guard. Write the edge case test matrix. Close the full messy fixture. | The messy fixture is closed. Tests pass, including the deliberately illiquid asset that exits through the unclosable path with a stated reason. |
| **Week 4 — Publish and demo** | Error handling and CLI output polish. Publish the repository as an npm package. Record the 60-second demo. Assemble the evidence package and the write-up. | 60-second demo, evidence package with explorer links, write-up published in the repo. D1, D2 and D3 closed. |

## 6. Evidence of Completion (Required)

> Important guidance: Evidence should be clear, verifiable, and easy to review by the Ambassador Chapter Lead with minimal technical expertise.

### 6.1 Planned Evidence to Be Submitted

| Deliverable | Evidence Type | Description |
|---|---|---|
| Deliverable 1: `planClose()` | Public repo + CLI output | Run the dry run yourself against any testnet account and read the plan it prints, or read the committed output for the fixture account in the repo. |
| Deliverable 2: Live close on testnet | Transaction hashes (links) + 60-second video | Open the linked transaction chain on a public testnet explorer, then look up the closed account and see that it no longer exists. The video shows the same close from the CLI, start to finish. |
| Deliverable 3: Edge cases and tests | Test results screenshot + public repo + baseline recording | See the passing test matrix, then clone the repo and run it yourself against the fixture account. The baseline recording shows the existing tool stopping on the same account, so the gap can be checked rather than taken on trust. |
| Documentation, demo and evidence | Public repo + write-up + 60-second video | Read a short write-up covering the ordering rules and what is not handled, and watch the full close from the CLI, start to finish. |

### 6.2 Evidence Verification Checklist (For Ambassador Use)

For each deliverable, the Ambassador Chapter Lead will assess whether evidence is present and sufficient.

| Deliverable | Evidence Present | Evidence Partial | Evidence Missing | Comments |
|---|---|---|---|---|
| Deliverable 1 | ☐ | ☐ | ☐ | |
| Deliverable 2 | ☐ | ☐ | ☐ | |
| Deliverable 3 | ☐ | ☐ | ☐ | |
| Documentation, demo and evidence | ☐ | ☐ | ☐ | |

## 7. Next-Step Alignment

### 7.1 Anticipated Next Step After Completion

After this Instaward, the most likely next step is:

- ☐ Apply to SCF Build Award
- ☐ Continue development independently
- ☐ Apply for a follow-on Instaward (if eligible)
- ☐ Seek other ecosystem support
- ☐ Other: ____________________

## 8. Instawards Constraints Acknowledgement

By submitting this SOW, the Builder acknowledges:

- ☐ This scope will be completed within 30 days or less.
- ☐ Instawards support execution, not open-ended exploration.
- ☐ A project may receive no more than two follow-on Instawards.
- ☐ Each Instaward is capped at $5,000.
- ☐ Total Instawards funding may not exceed $15,000.

## 9. Submission Confirmation

Once finalized, this Statement of Work will be submitted by the Ambassador Chapter Lead via the Instawards Airtable submission form for review and approval.

---

## Appendix A — Deliverable Tracker

### Sprint calendar (actual)

| Sprint week | Dates | SOW expected output |
|---|---|---|
| Day 1 | 2026-09-22 | Funds received; sprint clock starts |
| Week 1 | 2026-09-22 to 2026-09-28 | Fixture built, Demolisher baseline recorded, planClose() dry run printed |
| Week 2 | 2026-09-29 to 2026-10-05 | Zero-XLM account closed end to end with sponsored fees |
| Week 3 | 2026-10-06 to 2026-10-12 | Disposal ladder, sponsored unwind, sequence guard, test matrix, messy fixture closed |
| Week 4 | 2026-10-13 to 2026-10-19 | npm publish, 60-second demo, evidence package, write-up |
| Buffer | 2026-10-20 to 2026-10-22 | Review fixes; **final deadline 2026-10-22** |


| # | Deliverable | Status | Evidence link |
|---|---|---|---|
| D1 | `planClose()` read-only planner + CLI dry run | ☐ Not started | |
| D2 | `executeClose()` fee-sponsored close on testnet | ☐ Not started | |
| D3 | Edge cases, fixture account, baseline recording, test matrix | ☐ Not started | |
| D4 | README, integration notes, write-up, 60s demo, evidence package | ☐ Not started | |

## Appendix B — Success Metric Checklist (binary, no partial credit)

- [ ] Fixture account on testnet holds **zero spendable XLM**
- [ ] Fixture holds **at least 3 trustlines with non-zero balances**
- [ ] Fixture holds **at least 1 open offer**
- [ ] Fixture holds **at least 1 data entry**
- [ ] Every transaction in the close is **fee-bumped by the sponsor** (closed account pays no fee)
- [ ] The account **no longer exists** on a public testnet explorer
- [ ] The full transaction chain is linkable from the evidence package
