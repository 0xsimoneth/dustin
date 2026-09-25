---
title: Dustin
document: Product Brief
status: draft
version: 0.1
created: 2026-09-25
updated: 2026-09-25
source_of_truth: SUCCESSFUL_SOW.md (accepted Statement of Work, Stellar Instawards, $5,000, 30 days)
---

# Product Brief: Dustin

Dustin is a JavaScript/TypeScript SDK and CLI that closes messy Stellar classic (G) accounts on testnet. It plans the teardown as a read-only dry run, then executes it with every transaction fee-bumped by a sponsor, so an account with zero spendable XLM can be closed and merged into a destination the user picks.

## Executive summary

A Stellar account cannot be merged while it holds subentries, and a trustline cannot be removed while it holds a balance. Closing an account is therefore an ordered teardown (cancel offers, dispose of leftover balances, remove trustlines and data entries, merge), and the reserves it locks (1 XLM base plus 0.5 XLM per subentry) stay locked until the teardown finishes. The accounts that most need closing are the ones that cannot do it themselves: an account sitting exactly at its minimum reserve has nothing spendable, so it cannot pay the fee for the very operations that would free its reserves.

Dustin closes that gap with two functions and a CLI. `planClose()` inspects any account and returns an ordered close plan: which offers to cancel, how each leftover balance is disposed of, which trustlines and data entries are removed, how much XLM comes back and to whom, and the final merge, grouped into the minimum number of transactions, with a reason and a fee estimate per step, as a dry run that changes nothing. `executeClose()` runs that plan with every transaction fee-bumped by a sponsor, applies a disposal ladder for leftover balances (path payment, then return to issuer, then transfer to the destination if it holds the trustline, otherwise report the item as unclosable with a stated reason), unwinds sponsored trustlines so the reserve returns to the reserve sponsor, guards against `ACCOUNT_MERGE_SEQNUM_TOO_FAR`, and retries or recovers on failure.

The Instaward funds 30 days and 200 hours of work with one binary success test: a deliberately messy testnet account with zero spendable XLM, at least three trustlines with non-zero balances, at least one open offer and at least one data entry is fully closed and merged, verifiable by anyone on a public testnet explorer. The delivery also includes a test matrix for the cases that break naive implementations, a recorded baseline run of the existing tool (StellarExpert's Account Demolisher) stopping on the same account, documentation, a 60-second demo, and an evidence package.

## The problem

**Protocol mechanics make closing an ordered problem.** `AccountMerge` fails with `ACCOUNT_MERGE_HAS_SUB_ENTRIES` while the account holds any non-signer subentry (trustlines, offers, data entries). `ChangeTrust` with limit 0 fails with `CHANGE_TRUST_INVALID_LIMIT` while the trustline still holds a balance or buying liabilities, and open offers lock balances as liabilities. So the order is fixed: offers first, then balances, then trustlines and data, then the merge. Sponsored reserves add a twist: when a sponsored trustline is removed, the freed reserve goes back to the sponsor, not to the account holder.

**Economics trap the accounts that most need closing.** The minimum balance is `(2 + subentries + sponsoring - sponsored) x 0.5 XLM`. An account that holds exactly that amount has zero spendable XLM and cannot submit any fee-paying transaction, even though removing its own trustlines would release its own reserves. Fee-bump transactions exist for exactly this case: a separate fee account pays the fee while the sequence number and signatures still come from the account being closed.

**The existing tool stops short.** StellarExpert's Account Demolisher (live since 2019, MIT licensed, per the SOW) automates most of the sequence: it cancels offers, sells leftover assets on the DEX, removes trustlines and data entries, and merges. Per the SOW's reading of its source, every intermediate transaction is sourced from and paid by the account being closed; its server declines to co-sign a merge that pays out less than 1 XLM; it has no handling for sponsored reserves; it has no preflight, so execution begins the moment a secret key is pasted into a web form; and it has no programmatic interface. The request for a callable library, `stellar/js-stellar-wallets` issue 98 ("Add helper that closes a user's account"), was opened on 2019-08-12, has no comments, and the repository was archived on 2024-02-08.

**Who feels it, and what it costs.** Individual users hold dust-filled accounts they cannot empty and reserves they cannot recover. Wallets and anchors cannot offer "close account" without sending users to a third-party web form with a secret key. Reviewers and integrators cannot evaluate a closing tool they cannot inspect before it acts. The status quo is locked XLM, stuck users, support load, and a feature no wallet can ship.

## The solution

- **`planClose()`, the read-only planner (D1).** Inspects every subentry type (trustlines, open offers, data entries, sponsored reserves, liquidity pool shares), resolves dependencies with an ordering engine, groups operations into the minimum number of transactions, attaches a reason string and a fee estimate to each step, reports how much XLM is recovered and which reserves return to which sponsor, and never mutates state. `dustin plan <G...> --to <G...>` prints it.
- **`executeClose()`, the live close (D2).** Executes the plan against a real testnet account with every transaction fee-bumped by a sponsor, runs the disposal ladder for leftover balances, unwinds sponsored trustlines, applies the `ACCOUNT_MERGE_SEQNUM_TOO_FAR` guard, submits with retry and failure recovery, and returns a report with every transaction hash. `dustin close <G...> --to <G...>` drives it, printing hashes and explorer links as they land and finishing with an "account no longer exists" check.
- **Edge cases and test matrix (D3).** A fixture builder that constructs the messy account on testnet (3 trustlines with dust, 2 open offers, 1 data entry, 1 sponsored trustline, zero spendable XLM) plus a deliberately illiquid asset; a test matrix for illiquid balances, sponsored trustlines, `ACCOUNT_MERGE_SEQNUM_TOO_FAR`, authorization-required and clawback-enabled trustlines, liquidity pool shares (detected and reported), and raised multisig thresholds (detected and reported); and a recorded baseline run of the existing tool stopping on the same fixture.
- **Documentation, demo and evidence (D4).** Public repository with README and integration notes, a write-up on ordering rules and known limits, a 60-second demo video, an evidence package with transaction hashes and explorer links, and an npm package under the MIT license.

What the user experiences: run the plan, read it, nothing is signed. Run the close, watch the hashes land, open the explorer, see the account gone.

## What makes this different

Dustin is not the first account closer, and the brief does not pretend otherwise: the Account Demolisher handles the common case and has for years. Dustin's wedge is narrow and specific.

1. **Fee-sponsored closes.** Every transaction is a fee-bump paid by a sponsor, so the zero-spendable account, the one the existing tool provably cannot serve, can be closed.
2. **It reads before it writes.** The plan is a data structure a wallet can show and a person can read before anything is signed. Closing is irreversible; a preflight is what makes it safe to expose.
3. **Sponsored-reserve aware.** The plan states which reserves return to a reserve sponsor rather than to the account holder, and the executor unwinds sponsored trustlines accordingly.
4. **A callable library.** Typed `ClosePlan` and `CloseReport` objects, a pluggable signer, and a CLI. This is what issue 98 asked for in 2019.
5. **Inspectable correctness.** A published test matrix, a fixture anyone can rebuild, and a baseline recording turn "the existing tool stops here" from a claim into something a reviewer can watch.

There is no technical moat: this is classic Stellar with the public JavaScript SDK and Horizon. The advantage is execution and the correctness of the ordering and fallback rules, which is why the test matrix is a deliverable rather than an afterthought.

## Who this serves and the value proposition

| Persona | Situation today | What Dustin gives them | Success looks like |
|---|---|---|---|
| **Wallet or anchor integrator** (developer) | Cannot offer "close account" without sending users to a third-party web form; no library exists | `planClose()` to preview, `executeClose()` with their own sponsor and signer, deterministic JSON plans, documented ordering rules and limits, MIT license | Embeds a close flow in an afternoon; the plan preview is what they show users; nothing surprises them in production because the limits are written down |
| **Individual user with a stuck account** | Holds dust across several trustlines, maybe an old offer and a data entry, and sits at the minimum reserve with nothing spendable; the web tool cannot help | `dustin plan` to see exactly what will happen and how much XLM comes back; `dustin close` with a funded sponsor key to do it in one flow | The account is gone, the XLM is in the destination, and every step is linkable on the explorer |
| **Ambassador reviewer** (evidence consumer, minimal technical expertise) | Must judge whether each deliverable is present and sufficient | An evidence package that maps every SOW evidence row to a link: transaction chain, explorer lookup showing the account no longer exists, committed plan output, test results, baseline recording, 60-second video | Every checkbox in SOW section 6.2 and Appendix B can be ticked with a browser and no local setup |

The builder also acts as operator of the fixture and baseline recording; that is a workflow, not a persona.

## Success criteria

The SOW's binary metric, verbatim:

> **Success metric (binary):** one testnet account holding zero spendable XLM, at least 3 trustlines with non-zero balances, at least 1 open offer and at least 1 data entry is fully closed and merged. Pass means anyone can open the explorer, see the transaction chain, and see that the account no longer exists. There is no partial credit.

Appendix B of the SOW breaks this into the checklist the evidence package must satisfy, verbatim:

- Fixture account on testnet holds **zero spendable XLM**
- Fixture holds **at least 3 trustlines with non-zero balances**
- Fixture holds **at least 1 open offer**
- Fixture holds **at least 1 data entry**
- Every transaction in the close is **fee-bumped by the sponsor** (closed account pays no fee)
- The account **no longer exists** on a public testnet explorer
- The full transaction chain is linkable from the evidence package

Evidence acceptance follows SOW section 6.1: D1 is judged from the public repo and CLI output (dry run against any testnet account, plus committed fixture output); D2 from linked transaction hashes and the 60-second video; D3 from a test results screenshot, the public repo, and the baseline recording; D4 from the public repo, the write-up, and the video.

## Scope

**In scope (exactly the SOW deliverables):**

- D1: `planClose()` read-only planner, CLI dry run, inspection across all subentry types, ordering engine, transaction grouping, per-step fee estimation and reasons, dry-run guarantee.
- D2: `executeClose()` live on testnet, fee-sponsored submission, disposal ladder (path payment, issuer return, destination transfer, unclosable-with-reason), sponsored trustline unwinding, `ACCOUNT_MERGE_SEQNUM_TOO_FAR` guard, submission with retry and failure recovery, first end-to-end close of the messy fixture.
- D3: messy fixture construction (3 trustlines with dust, 2 open offers, 1 data entry, 1 sponsored trustline, zero spendable XLM) plus a deliberately illiquid asset, recorded baseline run of the existing tool, test coverage for illiquid leftover balances, sponsored trustlines, `ACCOUNT_MERGE_SEQNUM_TOO_FAR`, authorization-required trustlines, clawback-enabled trustlines, liquidity pool shares (detected and reported), raised multisig thresholds (detected and reported).
- D4: public repository with README and integration notes, write-up on ordering rules and known limits, 60-second demo video, evidence package with transaction hashes and explorer links, npm package.

**Out of scope (SOW, explicit):** mainnet (testnet only, no real value); contract accounts (C addresses); liquidity pool share withdrawal (detected and reported, not automated); multisig accounts with raised thresholds (detected and reported, not automated); claimable balance cleanup; production key management (the sponsor uses an env key); wallet UI (the CLI is the interface); third-party wallet integration work.

Anything beyond the list above is labeled **stretch (outside SOW)** in the PRD and is not committed.

## Constraints

- **Time and budget:** 30 calendar days; 200 hours at a flat $25/hour = $5,000, allocated D1 60 h, D2 80 h, D3 40 h, documentation/demo/evidence 20 h. No infrastructure, hosting, or subscription costs.
- **Network:** testnet only. Horizon testnet and friendbot are free and public; the fee sponsor is funded from friendbot. Testnet resets periodically (typically 2 to 4 times per year; the docs list 2026-12-16 as a scheduled reset), and a reset clears all ledger entries and history, so evidence must also be archived offline.
- **Keys:** the sponsor uses an environment-variable key for this scope; no production key management.
- **Interface:** a CLI demo is the interface; integration UI is left to the integrator.
- **Stack:** JavaScript/TypeScript on `@stellar/stellar-sdk` and Horizon; no smart contracts; Node.js LTS; publishable to npm; MIT license; public repository.
- **Evidence:** must be verifiable by the Ambassador Chapter Lead with minimal technical expertise, with a browser.
- **Protocol facts the design relies on** (all cited in Sources): merge requires no non-signer subentries and fails while the account sponsors reserves; the fee account of a fee-bump pays instead of the inner source; fee-bump fee must cover inner operations plus one and be at least the inner fee; minimum balance formula with sponsorship; transactions carry 1 to 100 operations; `ManageSellOffer` amount 0 deletes an offer; sending an asset to its issuer burns it; `AUTH_REVOCABLE` freezes prevent transferring the asset; a pool share trustline costs 2 base reserves; `ACCOUNT_MERGE_SEQNUM_TOO_FAR` triggers when the sequence number is not less than `ledgerSeq << 32`.

## Risks

| # | Risk | Impact | Mitigation |
|---|---|---|---|
| R1 | The Account Demolisher has no usable testnet mode, or its behavior changed since the SOW was written | Baseline recording cannot be made on testnet | Verify on day 1. Fallback: run its MIT-licensed source locally against testnet Horizon and record that; as secondary evidence, record a walkthrough of the source showing where it stops |
| R2 | Testnet reset during or after the sprint | Transaction history and the closed account's absence disappear from explorers | Archive every transaction envelope (XDR), Horizon responses, explorer screenshots and the video in the repo; the fixture builder can recreate the fixture after a reset |
| R3 | Testnet DEX liquidity is unreliable | Path-payment disposal cannot be demonstrated | The fixture provisions its own market-maker account and order book; the ladder falls back to issuer return when no path exists |
| R4 | A transaction is atomic: one failing operation fails the whole transaction | A close stalls mid-flow | Nothing is applied on failure, so the state is unchanged; the executor re-plans from the refreshed state, downgrades the failing item on the ladder, and resubmits; recovery is tested offline with recorded responses |
| R5 | Protocol edge behavior not documented (for example payments of an asset whose issuer account was merged away) | A planned disposal rung fails at apply time | Treated as empirical test cases; the ladder handles both outcomes; the success-metric fixture does not depend on undocumented behavior |
| R6 | The "unclosable" exit and "fully merged" success metric cannot both hold on one account | Ambiguous acceptance | Two fixtures: A (fully closable, exercises path payment and issuer return) and B (a stranded asset exits through the unclosable path with a stated reason); see PRD |
| R7 | Secret key handling in a CLI | Key leakage in logs, shell history or reports | Keys only from environment variables; redaction in every log, error and report; testnet only in v1 |
| R8 | Scope creep toward LP withdrawal, multisig co-signing, claimable balances | Missed deadline | Detect-and-report only, as the SOW states; everything else goes to the stretch list |
| R9 | D2 is the heaviest line (80 h) | Late integration risk | Week 2 closes a simple zero-XLM account end to end before the ladder is built in week 3 |
| R10 | npm package name unavailable | Publishing delay in week 4 | Decide the name in week 1 |
| R11 | Fee surge or Horizon timeouts on testnet | Submission failures | Base fee from `/fee_stats` with a cap; generous friendbot funding of the sponsor; timeout handling that polls by hash before resubmitting |

## Vision

If this works, Dustin becomes the library wallets embed for "close account" flows on Stellar: the plan preview becomes the standard way to show a user what closing means, and the sponsor role becomes a hosted service. Mainnet support with proper key management, automated liquidity pool and claimable balance cleanup, and multisig co-signing are natural next steps, but all of them sit outside this SOW.

## Assumptions

- A-1. "0 XLM" in the SOW's fixture description and "zero spendable XLM" in the success metric mean the same thing: `balance - minimum balance - XLM selling liabilities = 0`. A fully sponsored account with a literal 0 XLM balance is covered as a test variant, not as the success-metric fixture.
- A-2. The sponsored trustline in the fixture is a fourth trustline in addition to the three trustlines with non-zero balances, so both readings of the SOW ("3 trustlines with dust ... 1 sponsored trustline") are satisfied.
- A-3. The SOW's "deliberately illiquid asset that exits through the unclosable path" cannot live on the success-metric account, which must be fully merged. It lives on a second fixture (B) whose stranded asset is both illiquid and frozen by its issuer. On the success-metric fixture (A), the illiquid asset exits through the return-to-issuer rung.
- A-4. "Fee sponsor" (pays fees via fee-bump, env key) and "reserve sponsor" (the account that sponsored a ledger entry's reserve) are distinct roles and distinct testnet accounts in the fixture, so the evidence shows unambiguously where each XLM goes.
- A-5. The baseline run is recorded first, on the same fixture instance, and the fixture is re-verified unchanged before Dustin closes it; if the existing tool changed the state, a fresh instance is built and the recording repeated.
- A-6. The disposal ladder keeps the SOW's order (path payment, issuer return, destination transfer, unclosable) as the default; a configurable order is stretch.
- A-7. The Stellar Account Demolisher's MIT license and the specific limits quoted in the SOW are taken from the SOW; only the tool's existence and feature list were corroborated independently in this pass.
- A-8. The suggested sprint start date in the SOW (2026-08-09) has passed; the release plan uses weeks relative to the actual start agreed with the Ambassador Chapter Lead.
- A-9. Node.js LTS at delivery means the 22.x and 24.x lines.
- A-10. The public testnet explorer used for links is StellarExpert's testnet explorer; any public testnet explorer that resolves transaction hashes and account ids is acceptable.
- A-11. The builder is identified in the repository only as the GitHub account `0xsimoneth`; no personal contact details from the SOW are copied into project documents.

## Sources

- Accepted Statement of Work: `SUCCESSFUL_SOW.md` in this repository (problem statement, deliverables, budget, weekly plan, evidence table, Appendix B).
- Stellar developer docs, List of Operations (Account merge, Change trust, Manage data, Manage sell offer, Path payment strict send, sponsorship operations, thresholds): https://developers.stellar.org/docs/learn/fundamentals/transactions/list-of-operations
- Horizon result codes, Account Merge (`ACCOUNT_MERGE_HAS_SUB_ENTRIES`, `ACCOUNT_MERGE_SEQNUM_TOO_FAR`, `ACCOUNT_MERGE_IS_SPONSOR`, `ACCOUNT_MERGE_DEST_FULL`, `ACCOUNT_MERGE_IMMUTABLE_SET`): https://developers.stellar.org/docs/data/apis/horizon/api-reference/errors/result-codes/operation-specific/account-merge
- Horizon result codes, Change Trust (`CHANGE_TRUST_INVALID_LIMIT`): https://developers.stellar.org/docs/data/apis/horizon/api-reference/errors/result-codes/operation-specific/change-trust
- Horizon result codes, Path Payment Strict Send: https://developers.stellar.org/docs/data/apis/horizon/api-reference/errors/result-codes/operation-specific/path-payment-strict-send
- Fee-bump transactions (fee account, validity rules): https://developers.stellar.org/docs/build/guides/transactions/fee-bump-transactions
- Sponsored reserves (sandwich, effect on minimum balance, counters on removal): https://developers.stellar.org/docs/build/guides/transactions/sponsored-reserves
- Lumens, minimum balance and base reserve: https://developers.stellar.org/docs/learn/fundamentals/lumens#minimum-balance
- Accounts and subentries: https://developers.stellar.org/docs/learn/fundamentals/stellar-data-structures/accounts#subentries
- Operations and transactions (1 to 100 operations, one transaction at a time): https://developers.stellar.org/docs/learn/fundamentals/transactions/operations-and-transactions
- Fees, inclusion fee and surge pricing: https://developers.stellar.org/docs/learn/fundamentals/fees-resource-limits-metering
- Asset access control flags (`AUTH_REQUIRED`, `AUTH_REVOCABLE`, `AUTH_CLAWBACK_ENABLED`, `AUTH_IMMUTABLE`): https://developers.stellar.org/docs/tokens/control-asset-access
- Burning assets (send back to issuer): https://developers.stellar.org/docs/learn/fundamentals/stellar-data-structures/assets#deleting-or-burning-assets
- Liquidity pools, pool share trustlines: https://developers.stellar.org/docs/learn/fundamentals/liquidity-on-stellar-sdex-liquidity-pools
- Networks, testnet reset cadence: https://developers.stellar.org/docs/networks#testnet-and-futurenet-data-reset
- Horizon error handling, synchronous submission and timeouts: https://developers.stellar.org/docs/data/apis/horizon/api-reference/errors/error-handling
- StellarExpert Account Demolisher: https://stellar.expert/demolisher/public/
- `stellar/js-stellar-wallets` issue 98, "Add helper that closes a user's account": https://github.com/stellar/js-stellar-wallets/issues/98
- JavaScript SDK type declarations (`TransactionBuilder.buildFeeBumpTransaction`, `Operation.*`): https://github.com/stellar/js-stellar-base/blob/master/types/index.d.ts
