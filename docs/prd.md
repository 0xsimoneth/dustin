---
title: Dustin
document: Product Requirements Document
status: draft
version: 0.1
created: 2026-09-25
updated: 2026-09-28
source_of_truth: SUCCESSFUL_SOW.md (accepted Statement of Work, Stellar Instawards, $5,000, 30 days)
companion: docs/product-brief.md
---

# PRD: Dustin

Fee-sponsored closing of messy Stellar classic (G) accounts on testnet: a read-only planner, a live executor, a CLI, a test matrix, and an evidence package.

## 0. Document purpose

This PRD turns the accepted Statement of Work (SOW) into requirements the builder can implement and the Ambassador Chapter Lead can verify. It is for the builder (implementation), for a downstream architecture and story breakdown, and for the reviewer who must map evidence to deliverables. Every SOW deliverable (D1 to D4) and every evidence row in SOW section 6.1 is covered by at least one functional requirement (FR) and appears in the traceability matrix in section 12. Nothing in the SOW scope is dropped; anything beyond the SOW is labeled "stretch (outside SOW)" in section 14 and is not committed. Vocabulary is anchored in the Glossary (section 3). Inferences made without a human decision are tagged `[ASSUMPTION]` inline and indexed under "Assumptions" at the end.

## 1. Goals

- **G-1 (the binary test).** Close and merge one deliberately messy testnet account that holds zero spendable XLM, at least 3 trustlines with non-zero balances, at least 1 open offer and at least 1 data entry, with every transaction fee-bumped by a sponsor, so that anyone can see the transaction chain and the account's absence on a public testnet explorer (SOW section 3, Appendix B).
- **G-2 (safe to expose).** A plan that can be read before anything is signed: `planClose()` never mutates state and needs no secret key.
- **G-3 (serves the accounts the existing tool cannot).** Zero-spendable accounts, sponsored trustlines, and the leftover-balance ladder are first-class.
- **G-4 (inspectable).** A test matrix, a rebuildable fixture, and a recorded baseline run of the existing tool make the gap checkable rather than taken on trust.
- **G-5 (adoptable).** A typed SDK on npm under MIT, a CLI, README, integration notes, and a write-up on ordering rules and known limits.

## 2. Users

### 2.1 Personas

- **P-1 Integrator** (wallet or anchor developer). Wants to offer "close account" inside their product without sending users to a third-party web form. Reads the plan API first, cares about deterministic output, a pluggable signer, secret handling, and written limits. Consumes the SDK, README, integration notes and write-up.
- **P-2 Stuck-account user** (individual). Holds dust on several trustlines, an old offer or two, maybe a data entry, and sits at the minimum reserve with nothing spendable. Has the account's secret key and a destination account. On testnet for this scope, also holds a friendbot-funded sponsor key. Consumes the CLI.
- **P-3 Ambassador reviewer** (evidence consumer, minimal technical expertise). Must tick each row of SOW sections 6.1 and 6.2 and Appendix B. Consumes the evidence package, the explorer links, the video, the test results screenshot, and the baseline recording, with a browser and no local setup.

The builder acts as operator of the fixture builder and the baseline recording. That is a workflow (section 9), not a persona.

### 2.2 Jobs to be done

- P-1: "Show my user exactly what closing will do, then do it, with my sponsor paying, and tell me when it cannot be done and why."
- P-2: "Get my XLM out of an account I can no longer use, without first buying XLM to pay fees."
- P-3: "Confirm each deliverable is present and sufficient from links I can click."

### 2.3 Key user journeys

- **UJ-1. P-1 previews a close inside a wallet.** The integrator calls `planClose({ account, destination, feeSponsor })`, renders `plan.steps` with their `reason` strings and the recovery summary, shows the `unclosable` and `blockers` lists with remedies, and only when the user confirms calls `executeClose(plan, signers, { confirm: true })` with the wallet's own signer callback. Climax: the report's `verification.accountExists === false`. Edge case: state drifted between preview and execution; `onDrift: 'abort'` returns without submitting, and the wallet re-runs the preview.
- **UJ-2. P-2 closes a stuck account from the CLI.** `dustin plan G... --to G...` prints the ordered plan, the fee the sponsor will pay, and the XLM the destination will receive. `dustin close G... --to G...` with `DUSTIN_ACCOUNT_SECRET` and `DUSTIN_SPONSOR_SECRET` set prints the same plan, asks for confirmation (or `--yes`), prints each transaction hash with its explorer link as it lands, and ends with "account G... no longer exists". Edge case: one leftover balance cannot be moved; the CLI stops before burning anything unless `--partial` was given, and prints the unclosable reason and remedy.
- **UJ-3. P-3 verifies the evidence.** Opens `evidence/README.md`, follows the Appendix B checklist row by row: fixture verification snapshot, baseline recording, transaction links, the explorer lookup that returns "account not found", the test results screenshot, the video. Every row resolves to a link or a committed file.
- **UJ-4. The builder records the baseline.** Builds Fixture A with `dustin fixture create`, verifies it with `dustin fixture verify`, snapshots it with `dustin baseline`, records the existing tool stopping on it, re-verifies the fixture is unchanged, then closes the same account with Dustin.

## 3. Glossary

- **Account** — the Stellar classic (G) account being closed. Its secret key signs inner transactions.
- **Destination** — the existing account that receives the Account's XLM through `AccountMerge`. May be a muxed (M) address.
- **Fee Sponsor** — the account that pays every transaction fee through a fee-bump transaction. Provided as an environment-variable key in this scope. Distinct from Reserve Sponsor.
- **Reserve Sponsor** — an account that sponsored the base reserve of a ledger entry (for example a trustline) of the Account. When the entry is removed, the reserve requirement returns to the Reserve Sponsor.
- **Subentry** — a trustline (including pool share trustlines), offer, signer, or data entry attached to the Account; each raises the minimum balance by one base reserve (0.5 XLM). Signers do not block a merge; the other three do.
- **Minimum Balance** — `(2 + numSubEntries + numSponsoring - numSponsored) x base reserve`.
- **Spendable XLM** — `balance - Minimum Balance - XLM selling liabilities`. "Zero spendable" means this equals 0.
- **Dust** — any non-zero balance held on a trustline that must be disposed of before the trustline can be removed.
- **Disposal Ladder** — the ordered fallback for Dust: `path_payment` (sell for XLM), `return_to_issuer` (burn), `send_to_destination` (only if the Destination holds an authorized trustline), `unclosable` (report with reason).
- **Rung** — one level of the Disposal Ladder.
- **Close Plan** — the ordered, grouped, read-only output of `planClose()`: steps, transactions, fees, recovery summary, unclosable items, blockers, warnings, status.
- **Close Step** — one unit of the Close Plan with a kind, a subject, a reason, a fee estimate, and dependencies.
- **Planned Transaction** — a group of Close Steps that will be submitted as one fee-bumped transaction (1 to 100 operations).
- **Unclosable Item** — an entry the ladder cannot dispose of, reported with an `UnclosableCode`, a reason, and a remedy.
- **Blocker** — a condition that makes the merge itself impossible (for example the Account sponsors reserves), reported with a code and a remedy.
- **Plan Status** — `closable` (ends in a merge), `partial` (some steps possible, merge not possible), `blocked` (nothing useful can be done).
- **Close Report** — the output of `executeClose()`: submitted transactions with hashes, per-step outcomes, unclosable items, verification, actual recovery.
- **Close Status** — the outcome recorded in a Close Report: `closed` (merged and verified gone), `partial` (some steps applied, merge not possible), `aborted` (nothing submitted, for example on Drift), `failed` (retries exhausted). Copies of a report published while the run is still going carry `running`, which never appears in a returned report (added 2026-09-27; `closed` means the merge applied, and a verified close is `closed` with `verification.accountExists === false`).
- **Snapshot** — the serializable Horizon-derived view of the Account that a Close Plan was computed from, identified by `snapshotHash`.
- **Dry Run** — a `planClose()` call: HTTP reads only, no signing, no submission.
- **Drift** — the Account's on-ledger state differing from the snapshot a Close Plan was computed from.
- **Fixture A** — the canonical messy testnet account that satisfies Appendix B and is fully closable. **Fixture B** — the stranded variant with one asset that exits through the `unclosable` rung. Variants are listed in section 9.
- **Baseline Run** — the recorded attempt of the existing tool (StellarExpert's Account Demolisher) against Fixture A, showing where it stops.
- **Evidence Package** — the `evidence/` directory in the repository mapping every SOW evidence row and Appendix B item to a link or committed file.
- **Explorer** — a public testnet block explorer that resolves transaction hashes and account ids.

## 4. Functional requirements

FRs are numbered globally. Each carries acceptance criteria. "Realizes" points to user journeys.

### 4.1 D1 — `planClose()`, the read-only planner

**Description.** `planClose()` reads the Account from Horizon, classifies every Subentry, resolves the dependency order, chooses a Rung for every Dust balance, groups the resulting operations into the minimum number of Planned Transactions, attaches a reason and a fee estimate to every Close Step, computes what XLM goes where, lists Unclosable Items and Blockers with remedies, and returns a serializable Close Plan. It never signs, never submits, and needs no secret. `dustin plan` renders it. Realizes UJ-1, UJ-2.

#### FR-01: Account inventory

`planClose()` (and the exported `inspectAccount()`) retrieves from Horizon everything that affects closability: account existence and address type (G only), XLM balance, `subentry_count`, `num_sponsoring`, `num_sponsored`, account `sponsor`, `sequence`, thresholds and master key weight and signers, account flags, every balance line (asset, balance, limit, buying and selling liabilities, authorization flags, clawback flag, per-trustline sponsor, liquidity pool share id), every open offer (fully paged), and every data entry.

Acceptance:
- For Fixture A the snapshot lists exactly 4 trustlines (3 with non-zero balances, 1 sponsored with a Reserve Sponsor id), 2 open offers, 1 data entry, and Spendable XLM equal to 0.
- Offers are paged to completion; a recorded-response test with more than 200 offers lists them all.
- A pool share balance is reported as `liquidity_pool_shares` with its pool id (variant LP).
- A non-existent account yields Plan Status `blocked` with Blocker `ACCOUNT_MISSING`; a C address yields `CONTRACT_ACCOUNT`; neither throws.
- The snapshot is serializable and carries `snapshotHash`.

#### FR-02: Dependency ordering engine

The planner orders Close Steps according to the normative rules in section 8 (offers before disposals and trustline removals; disposals before trustline removals; all Subentries before the merge; merge last).

Acceptance:
- A property-based test over generated inventories asserts every plan satisfies rules R1 to R9 and that no step depends on a later step.
- For Fixture A the order is: cancel 2 offers, dispose 3 balances, remove 4 trustlines, remove 1 data entry, merge.
- Ordering within a class is stable (rule R9) so two runs on the same snapshot produce identical step lists.

#### FR-03: Disposal Ladder planning

For every Dust balance the planner selects the first Rung whose preconditions hold and records the remaining Rungs as execution-time fallbacks: `path_payment` when Horizon `GET /paths/strict-send` (source asset and amount, destination asset XLM) returns at least one path whose XLM output is at least 1 stroop after the configured slippage; `return_to_issuer` when the trustline is fully authorized and, for an issuer that is memo-required under SEP-29, a memo is given (the issuer account does not have to exist: a payment to an issuer that was merged away succeeds and burns the balance, day-1 experiment 4, `docs/README.md` open question 3); `send_to_destination` when the Destination holds a trustline for the asset that is authorized and has limit room for the amount; otherwise `unclosable` with an `UnclosableCode`.

Acceptance:
- Fixture A asset A1 (direct XLM book) plans `path_payment` with path, estimated XLM out, and `destMin`.
- Fixture A asset A2 (2-hop book) plans `path_payment` with a 2-hop path.
- Fixture A asset A3 (no book, live issuer, authorized) plans `return_to_issuer` with the reason "no strict-send path found".
- Fixture B asset A5 (no book, frozen by issuer) plans `unclosable` with `TRUSTLINE_NOT_AUTHORIZED`, a reason naming the issuer, and the remedy "issuer must re-authorize or claw back".
- Variant ISS (issuer account merged away) plans `return_to_issuer` like any authorized balance: the payment to the merged-away issuer succeeds and burns the balance, and the emptied trustline can then be deleted. This was settled on 2026-09-26 by day-1 experiment 4 (`docs/progress-log.md`; `docs/README.md` open question 3, resolved); a missing issuer is informational in the step's reason and never an unclosable reason. The outcome is recorded in the write-up (`docs/write-up.md`, section 4).

#### FR-04: Transaction grouping

Close Steps are packed in dependency order into the minimum number of Planned Transactions: a new transaction starts only when the 100-operation cap is reached or the merge has to wait for the sequence guard (FR-14), in which case it runs alone. The merge is the last operation of the last transaction.

Acceptance:
- Fixture A produces 1 Planned Transaction with 11 operations.
- A synthetic inventory with 150 offers and 3 trustlines produces 2 transactions, the first with exactly 100 operations, the merge last in the second.
- No Planned Transaction exceeds 100 operations; every step has a `txIndex`.

#### FR-05: Per-step reason and fee estimate

Every Close Step carries a human-readable `reason` (what it does, why it is needed, why this Rung) and `feeEstimateStroops = operations in step x base fee`. Every Planned Transaction carries `innerFeeStroops = ops x base fee` and `feeBumpFeeStroops = (ops + 1) x base fee`, with `feeSource = fee_sponsor`. The base fee is `max(100 stroops, value derived from Horizon GET /fee_stats)` capped by `maxBaseFeeStroops`, or an explicit override.

Acceptance:
- No step has an empty `reason`.
- Sum of step estimates plus one base fee per transaction equals `fees.totalStroops`.
- With base fee 100 stroops, Fixture A shows inner fee 1,100 stroops and fee-bump fee 1,200 stroops (0.00012 XLM), payer = Fee Sponsor, Account pays 0.
- The base fee never falls below 100 stroops and never exceeds the cap.

#### FR-06: XLM recovery accounting

The plan states `recovery.xlmToDestination` (current balance plus estimated XLM from `path_payment` disposals; fees are 0 for the Account), `recovery.reservesReleasedToAccount`, and `recovery.reservesReturnedToSponsors[]` (per Reserve Sponsor, with the entries involved). Reserves of sponsored entries are excluded from the Account's figure.

Acceptance:
- Fixture A: `xlmToDestination` is 4.0000000 XLM plus the estimated path-payment output; `reservesReturnedToSponsors` lists the Reserve Sponsor with 0.5 XLM for trustline A4.
- After execution, the actual figures in the Close Report reconcile with the plan within the path-payment estimation tolerance, and the Destination's balance increase on Horizon matches the actual figure.

#### FR-07: Dry-run guarantee

`planClose()` performs HTTP GET requests only. It accepts no secret key, produces no signature, and never calls a submission endpoint. `dustin plan` runs without any secret in the environment.

Acceptance:
- A test with a mocked Horizon asserts zero non-GET requests during `planClose()`.
- `dustin plan` succeeds with `DUSTIN_ACCOUNT_SECRET` and `DUSTIN_SPONSOR_SECRET` unset.
- The `ClosePlan` type contains descriptors, not signed envelopes.

#### FR-08: Blockers and detect-and-report items

The planner never emits operations for conditions the SOW places out of automation; it reports them with codes and remedies and sets Plan Status accordingly: pool share trustlines (`LIQUIDITY_POOL_SHARES`, item), Account sponsoring reserves or claimable balances (`ACCOUNT_IS_SPONSORING`, blocker), raised thresholds that the master key cannot meet for medium or high operations (`THRESHOLD_UNMET`, blocker), master key weight 0 (`MASTER_KEY_DISABLED`, blocker), `AUTH_IMMUTABLE` set (`AUTH_IMMUTABLE`, blocker), sequence number not less than `ledgerSeq << 32` beyond the configured wait (`SEQNUM_TOO_FAR`, blocker with the earliest ledger), Destination missing (`DESTINATION_MISSING`, blocker), Destination unable to receive (`DESTINATION_FULL`, blocker), Account missing or a C address (`ACCOUNT_MISSING`, `CONTRACT_ACCOUNT`, blocker).

Acceptance:
- Variant LP yields Plan Status `partial`, one item `LIQUIDITY_POOL_SHARES` with the remedy "withdraw pool shares (LiquidityPoolWithdraw) before closing; not automated", and no merge step.
- Variant MS (high threshold above master weight) yields `blocked` with `THRESHOLD_UNMET` naming the required weight and the available weight.
- A Destination that returns 404 from Horizon yields `blocked` with `DESTINATION_MISSING`.
- Every Blocker and Unclosable Item has non-empty `reason` and `remedy`.

#### FR-09: CLI `dustin plan`

`dustin plan <G...> --to <G...> [--sponsor <G...>] [--json]` renders the Close Plan as a readable table (steps, transactions, fees, recovery, unclosable items, blockers) or as JSON, and exits 0 for `closable`, 3 for `partial`, 2 for `blocked`, 1 for errors. It works against any testnet G account, not only the fixture.

Acceptance:
- Running against Fixture A prints the 11-step plan and exits 0; running against the variant LP account exits 3.
- Running against an arbitrary funded testnet account created during the test exits 0 with a plan whose only step is the merge.
- `--json` output validates against the published `ClosePlan` JSON schema.

#### FR-10: Machine-readable plan, schema and hash

The Close Plan serializes to JSON with `schemaVersion`, a published JSON schema in the package, `snapshotHash` (canonical snapshot) and `planHash` (canonical structural plan: steps, order, grouping, rungs; fee numbers excluded).

Acceptance:
- Two `planClose()` calls on the same recorded snapshot yield byte-identical JSON except `createdAt`, and identical `planHash`.
- A change of base fee changes `fees` but not `planHash`.
- The schema file ships in the npm package and the JSON output validates against it.

### 4.2 D2 — `executeClose()`, live on testnet

**Description.** `executeClose()` takes a Close Plan and signers, re-verifies the Account's state, builds each Planned Transaction as an inner transaction signed by the Account and wraps it in a fee-bump transaction signed by the Fee Sponsor, submits sequentially, decodes results, falls down the Disposal Ladder on disposal failures, waits out the sequence-number guard, retries transient failures, and returns a Close Report with every hash. `dustin close` drives it. Realizes UJ-1, UJ-2.

#### FR-11: Fee-bumped submission

Every transaction is submitted as a fee-bump transaction built with `TransactionBuilder.buildFeeBumpTransaction(feeSponsor, baseFee, innerTx, networkPassphrase)`: inner source = Account, inner fee = ops x base fee, fee-bump fee at least `(ops + 1) x base fee` and at least the inner fee, inner envelope signed by the Account, outer envelope signed by the Fee Sponsor. The Account pays no fee.

Acceptance:
- For every transaction in the Close Report, Horizon's transaction record shows `fee_account` equal to the Fee Sponsor and `source_account` equal to the Account.
- The Account's XLM balance never decreases by a fee at any point (verified by comparing Horizon balances between transactions in test T-15).
- A close of Fixture A submits exactly the Planned Transactions of the plan (1 transaction) unless recovery (FR-15) required more, and the report explains any difference.

#### FR-12: Disposal Ladder execution with fallback

At execution time each `dispose_balance` step is attempted on its planned Rung. If the operation fails at apply time (decoded from the transaction result), the executor downgrades that item to the next Rung with a precondition that still holds, rebuilds the affected Planned Transaction from refreshed state, and resubmits. When no Rung remains, the item becomes an Unclosable Item, the trustline removal and the merge that depend on it are dropped, and the run continues with `allowPartial` semantics (FR-19).

Acceptance:
- Recorded-response test: a `PATH_PAYMENT_STRICT_SEND_TOO_FEW_OFFERS` result on A1 causes a rebuild in which A1 is on `return_to_issuer`, and the second submission succeeds.
- Fixture B: A5 ends as `unclosable` with `TRUSTLINE_NOT_AUTHORIZED`; every other subentry is removed; no merge is attempted; Close Status is `partial`.
- The Close Report's `steps[]` record the Rung each disposal actually applied with (`rung`); a disposal that fell down the ladder shows the later Rung, and `replans[]` shows the re-plan that moved it with the triggering result codes. There is no separate `fallback` status (decision of 2026-09-28, section 7).
- The receipt (`renderReport()`, printed by `dustin close --execute`) has a Disposals section: for each leftover balance, whether it was sold for XLM by path payment, burned by the return to its issuer, or sent to the destination, in which transaction and plan round, and, after a fall down the ladder, which rung failed first and with which code. Each unclosable item is listed under "Not closed" with its code, every rung ruled out and the remedy (stories E3-S1, E3-S2).

#### FR-13: Sponsored trustline unwinding

A sponsored trustline is unwound by the Account itself: dispose of its balance if any (ladder), then `ChangeTrust` with limit 0. The plan and report state that its reserve returns to the Reserve Sponsor, not to the Account.

The executor also records what Horizon showed for each Reserve Sponsor the plans name, before the first submission and after the final check, in `recovery.sponsorsObserved` (`num_sponsoring`, XLM balance, Minimum Balance and the ledger of each read; a read that fails leaves its figure null and adds a warning, and never changes the outcome). The receipt prints them under "Reserves released to sponsors", next to the planned reserve (story E3-S3).

Acceptance:
- After closing Fixture A, the Reserve Sponsor's `num_sponsoring` on Horizon has decreased by 1 and its Minimum Balance requirement dropped by 0.5 XLM; the Account's actual recovery excludes that 0.5 XLM. Observed live on 2026-09-28 and recorded in `recovery.sponsorsObserved`: `num_sponsoring` 1 to 0, Minimum Balance 1.5 to 1.0 XLM, XLM balance unchanged (story E3-S3, matrix row S-03; the metric closes `evidence/runs/20260928T112239Z-e3/` and `evidence/runs/20260928T112252Z-e3-cli/`).
- The Close Report's `recovery.reservesReturnedToSponsors` lists the Reserve Sponsor and trustline A4.
- Variant with dust on the sponsored trustline (offline, recorded) plans disposal then removal in that order.

#### FR-14: `ACCOUNT_MERGE_SEQNUM_TOO_FAR` guard

The planner evaluates the guard for the merge's own sequence number (the Account's sequence number plus the merge transaction's index plus one) against the earliest ledger the merge can land in (the observed ledger plus one), and reports it in `plan.sequenceGuard` (`ok`, `unblocksAtLedger`, `etaSeconds`) (canonical decision 10). When the guard fails:

- within the plan option `maxWaitLedgers` (default 120 ledgers, about 10 minutes), the plan stays `closable`, the merge runs alone in the last transaction, and a warning names the ledger. There is no separate wait step. Before that merge, and before every rebuild of it, the executor runs the merge preflight. When the guard is all that holds the merge back, the executor emits the `wait` event (`state: "start"`), polls Horizon's latest ledger every `pollIntervalMs`, and emits `state: "end"` once the ledger before `unblocksAtLedger` has closed. It then checks again and submits the merge. The wait has two bounds: the plan's `maxWaitLedgers`, counted from the latest ledger, and a local-clock limit of twice the time of the ledgers to wait for plus two more, at about 5 s per ledger. Beyond either bound the run stops before the merge with `SEQNUM_TOO_FAR` and `unblocksAtLedger`; a preflight that fails on the guard alone no longer gives `MERGE_PREFLIGHT_FAILED`;
- beyond `maxWaitLedgers` when planned, the plan has the Blocker `SEQNUM_TOO_FAR` with the ledger and an ETA in minutes, no merge step, and status `blocked`;
- a merge that fails on the ledger with `op_seq_num_too_far` (another client bumped the sequence number) makes the executor read the account again and recompute the guard. Within the bound the rest is planned again and the new merge waits; beyond it, or on a second such failure, the run stops with `SEQNUM_TOO_FAR` and the ledger.

The CLI prints the wait's start and end. A guard stop exits 3 when nothing was signed (a plan refused without `--partial`, or a merge-only run whose wait ran out), 4 for a partial run with `--partial`, and 5 for a run stopped part-way; the stop and the receipt name the ledger at which to run the close again (story E3-S4, review finding R8).

Acceptance:
- Variant SEQ-NEAR (sequence bumped a few ledgers ahead): the plan is `closable` with the merge alone in the last transaction and the unblocking ledger; the executor runs the cleanup, waits for the ledger and the merge applies; no `ACCOUNT_MERGE_SEQNUM_TOO_FAR` result appears in the report. Live on 2026-09-28: a bump of 16 ledgers, a wait of 60 s, and the merge applied in the unblocking ledger itself (story E3-S4, matrix row S-04).
- Variant SEQ-FAR (bumped far beyond `maxWaitLedgers`): Plan Status `blocked` with `SEQNUM_TOO_FAR` and the earliest ledger; `executeClose()` refuses to start unless `allowPartial` is set, in which case it removes subentries and skips the merge.
- The boundary: a merge whose sequence number is s applies only from ledger `(s >> 32) + 1`. Live, a merge submitted for the ledger before that failed with `op_seq_num_too_far`, and the executor's merge in that ledger applied.

#### FR-15: Submission, retry and failure recovery

Transactions are submitted one at a time (the Account performs one transaction at a time). The executor handles: Horizon 504 timeout by polling the transaction by hash before any rebuild and resubmitting the same envelope while its timebounds are valid; `tx_bad_seq` by refreshing the sequence and rebuilding; `tx_too_late` by rebuilding with fresh timebounds; `tx_insufficient_fee` by raising the base fee up to the cap; operation failures by decoding result codes, mapping them to the failing step, and either falling down the ladder (FR-12) or aborting with the codes in the report. Retries are bounded with exponential backoff; a transaction is never applied twice (sequence numbers guarantee this).

Acceptance:
- Recorded-response tests cover each branch above and assert the number of submissions, the final Close Status, and that the report carries `resultCodes` for failures.
- A 504 followed by a successful hash lookup produces no second submission.
- After `maxAttemptsPerTransaction` envelopes of one planned transaction the run ends `failed` with the last result codes, and running the close again continues from the ledger (FR-17).

#### FR-16: Pre-flight verification and Drift handling

Before submitting anything, `executeClose()` refreshes the Account snapshot, plans again from it and compares the fresh plan's `planHash` with the approved plan's. It also compares the approved plan's `recovery.xlmToDestination` with the fresh plan's, in stroops, because the plan hash leaves market quotes out: a lower fresh amount (for example a sale's quote that got worse while the confirmation waited) is Drift too, and a higher one is not (review finding BH-7, story E3-S1). On Drift it either aborts (`onDrift: 'abort'`, default) or re-plans and continues (`'replan'`). An abort caused by the amount alone ends `aborted` with stop `XLM_TO_DESTINATION_FELL`; both amounts are in `stop.xlmToDestination` and on the `drift` event. Under `'replan'` the run goes on with the fresh plan and a warning that names both amounts. Through the CLI such an abort exits 3 with nothing signed. It also verifies the Fee Sponsor and Destination exist and that Account, Destination and Fee Sponsor are three different accounts (as built, the Destination may be the Fee Sponsor, with a warning in the report; story E2-S2).

Acceptance:
- Recorded-response test: an issuer clawback between plan and execution (variant CLW) causes `abort` by default with a report status `aborted` and no submission; with `'replan'` the new plan omits the clawed-back balance and the run completes.
- A quote that falls between the approved plan and the fresh plan aborts with `XLM_TO_DESTINATION_FELL`, nothing signed, both amounts in the stop; with `'replan'` the run goes on with a warning; a quote that rises goes on silently. Mid-run re-plans keep their own rule: a sale that fails and falls down the ladder lowers the proceeds by design and is not Drift.
- Passing the Account as Destination or as Fee Sponsor throws `DustinError` before any network write.

#### FR-17: Idempotency and resumability

The Close Report is written incrementally by the CLI (`--report <path>`) and published to SDK callers through `onReport`. There is no resume option: the ledger is the source of truth, so resuming is running the close again. The executor re-inspects the Account, re-plans the remainder, skips steps whose subentries no longer exist, and continues (decision of 2026-09-28, section 7; story E2-S3 AC-5).

Acceptance:
- Interrupting a close after its first transaction and running the same close again completes it with exactly the remaining transactions.
- Re-running a completed close through `executeClose()` records Horizon's 404 (`verification.accountExists === false`) and submits nothing. The CLI stops such a re-run before the executor with exit code 3; recording the 404 there is deferred review finding AA-13 (E4-S2).

#### FR-18: Close Report

`executeClose()` returns, and `dustin close` writes, a Close Report containing every submitted transaction (hash, ledger, fee charged, fee account, inner and fee-bump envelope XDR, explorer URL, attempts, result codes), per-step outcomes, unclosable items, actual recovery figures, and a final verification that queries Horizon for the Account and records the 404.

Acceptance:
- For the Fixture A close, the report lists every hash, each resolves on the Explorer, and `verification.accountExists` is `false` with the Horizon status code recorded.
- The report contains no secret material (NFR-04 test).
- The report validates against the published `CloseReport` JSON schema.

#### FR-19: CLI `dustin close`

`dustin close <G...> --to <G...> --execute [--yes] [--partial] [--json] [--memo <m>] [--prefer-destination] [--base-fee <stroops>] [--report <path>]` loads `DUSTIN_ACCOUNT_SECRET` and `DUSTIN_SPONSOR_SECRET` from the environment (or `.env`), prints the plan, requires the typed confirmation of the destination's last four characters or `--yes`, refuses to start when Plan Status is not `closable` unless `--partial` is given, streams progress (one line per transaction with hash and explorer link; NDJSON with `--json` is deferred review finding AA-10, E4-S1), and exits with the codes of canonical decision 5 in `docs/README.md`: 0 closed and verified gone, 1 unexpected error, 2 usage or validation error, 3 nothing executed (no confirmation, blockers without `--partial`, or a failed sponsor or budget precondition), 4 partial, 5 stopped or failed during execution, 6 Horizon unreachable before any submission. There is no `--resume`: running the same command again continues from the ledger.

Acceptance:
- Closing Fixture A from the CLI prints the plan, the confirmation prompt, one hash line per transaction, and "account G... no longer exists", exit code 0.
- Running without `--partial` against Fixture B refuses with exit code 3 and prints the unclosable reason; with `--partial` it exits 4 after removing everything else.
- `--network mainnet` or a public network passphrase is refused with a clear message (NFR-01).

#### FR-20: Fee Sponsor prerequisites

Before execution the executor checks that the Fee Sponsor exists, is not the Account, and holds Spendable XLM of at least the plan's total fee estimate times a headroom factor (default 10x, covering retries and fee raises); otherwise it refuses with `DustinError` and the shortfall.

Acceptance:
- A Fee Sponsor with 0.0001 XLM spendable is refused with the required amount in the message.
- A friendbot-funded Fee Sponsor passes.

### 4.3 D3 — Edge cases, fixture, baseline, test matrix

**Description.** A fixture builder constructs the messy account and its variants on testnet from nothing but friendbot; a verifier proves the Appendix B preconditions; a test matrix covers the cases that break naive implementations in offline (recorded Horizon responses) and live tiers; the baseline run of the existing tool is recorded against Fixture A. Realizes UJ-3, UJ-4.

#### FR-21: Fixture builder `dustin fixture create`

`dustin fixture create [--variant a|a0|b|simple|seq-near|seq-far|lp|ms|clw|auth|iss] [--out <manifest.json>] [--secrets <path>]` builds the requested fixture on testnet as specified in section 9 using only friendbot-funded accounts, writes a public manifest (public keys, assets, issuers, expected plan summary) and a separate secrets file that is gitignored. The canonical Fixture A ends with Spendable XLM exactly 0. The command is repeatable after a testnet reset. The `simple` variant is not built: the Week 2 close used fresh Fixture A accounts instead (PRD decision D-4).

Acceptance:
- `dustin fixture create --variant a` followed by `dustin fixture verify` passes every check in FR-22.
- The manifest contains no secret key; the secrets file path is listed in `.gitignore`.
- Two builds produce accounts with identical inventories (asset codes, balances, offers, data, sponsorship shape).

#### FR-22: Fixture verifier `dustin fixture verify`

`dustin fixture verify <manifest.json>` checks and prints, with Horizon evidence, every Appendix B precondition: Spendable XLM equals 0; at least 3 trustlines with non-zero balances; at least 1 open offer; at least 1 data entry; plus the fixture's own invariants (sponsored trustline present with the Reserve Sponsor, expected minimum balance), and writes a JSON snapshot for the Evidence Package.

Acceptance:
- On Fixture A every check passes and the snapshot shows balance 4.0000000 XLM, `subentry_count` 7, `num_sponsored` 1.
- Draining one more stroop from a copy of the fixture, or adding 0.0000001 XLM, makes the spendable check fail.

#### FR-23: Fixture variants for the matrix

The builder can produce the variants in section 9: A0 (fully sponsored, literal 0 XLM balance), B (stranded asset frozen by its issuer), SIMPLE (no leftover balances; not built, PRD decision D-4), SEQ-NEAR and SEQ-FAR (`BumpSequence`), LP (pool share trustline with a deposit), MS (additional signer and raised high threshold), CLW (clawback-enabled asset), AUTH (authorization-required issuer in each authorization state), ISS (issuer account merged away).

Acceptance:
- Each variant builds on testnet and its manifest states the expected Plan Status and expected codes.
- The matrix tests (FR-24) consume variants by manifest, never by hard-coded keys.

#### FR-24: Test matrix

The repository ships the test matrix in section 9 under a single `npm test` (offline tier, recorded Horizon responses, runs in CI) and `npm run test:live` (testnet tier, builds its own fixtures), with a results summary that can be screenshotted for the Evidence Package. Cases required by the SOW: illiquid leftover balance, sponsored trustlines where the reserve returns to the sponsor rather than the user, `ACCOUNT_MERGE_SEQNUM_TOO_FAR`, authorization-required trustlines, clawback-enabled trustlines, liquidity pool shares (detected and reported, not withdrawn), raised multisig thresholds (detected and reported).

Acceptance:
- Every case in section 9 exists as a named test mapped to its FR; the offline tier passes in CI on every supported Node LTS line; the live tier passes against testnet before delivery.
- The committed screenshot and text summary in `evidence/tests/` match the test names in the repository.
- A reviewer following `README.md` can clone, install, and run `npm test` and `npm run test:live` against fresh fixtures.

#### FR-25: Baseline recording of the existing tool

`dustin baseline <G...> --out <dir>` snapshots the Account (Horizon JSON, `dustin fixture verify` result) and prints the recording protocol. The builder records the existing tool (StellarExpert's Account Demolisher, run against testnet, or its MIT-licensed source run locally against testnet Horizon if the hosted tool offers no testnet mode) attempting to close Fixture A, captures the exact stopping point (message, screen, and any submitted transaction), snapshots the Account again, and re-runs the verifier to prove the fixture is unchanged before Dustin closes the same account.

Acceptance:
- `evidence/baseline/` contains the recording (or a durable link), the before and after snapshots, and a note stating the account id, the timestamp, the tool version or commit, and the observed stopping point.
- The after snapshot passes `dustin fixture verify`, so the Dustin close in D2 runs on the same account.
- If the tool changed the state, the note says so and points to the fresh fixture instance used for the retake. `[ASSUMPTION: the existing tool cannot submit a fee-paying transaction from a zero-spendable account, so the state is expected to be unchanged.]`

### 4.4 D4 — Documentation, demo, evidence, packaging

**Description.** What a P-1 reads to integrate, what a P-3 clicks to verify, and what makes the package installable. Realizes UJ-1, UJ-3.

#### FR-26: README and integration notes

`README.md` covers installation, the testnet-only scope, CLI quickstart (`plan`, `close`, `fixture`, `baseline`, `evidence`), SDK quickstart (`planClose`, `executeClose`, signer callback, options), environment variables, exit codes, and how to run the tests. `docs/integration-notes.md` covers embedding the plan preview, confirmation, the signer interface, sponsor operation, error and `UnclosableCode` handling, Drift and re-running a stopped close (there is no separate resume), and JSON schemas.

Acceptance:
- A developer following the README on a clean machine reaches a printed plan for a testnet account within the documented steps, with no undocumented step.
- Every public export in the SDK surface (section 7) is documented.

#### FR-27: Write-up on ordering rules and known limits

`docs/write-up.md` (the name in story E4-S5; first version 2026-09-28) states the normative ordering rules (section 8), the Disposal Ladder preconditions and observed outcomes (including the empirical results of ISS and AUTH), the grouping rule and its atomicity consequence, the fee model, the sequence-number guard, and the list of what is detected and reported but not handled (pool shares, sponsoring reserves and claimable balances, raised thresholds, C addresses, mainnet), each with the remedy the user has.

Acceptance:
- Every `UnclosableCode` and Blocker code in section 7 appears in the write-up with its remedy.
- Every rule cites the protocol documentation it relies on.

#### FR-28: 60-second demo video

A video of at most 60 seconds shows, from the CLI, start to finish: the plan, the confirmation, the transaction hash landing, the Explorer showing the transaction, and the Explorer showing the account no longer exists.

Acceptance:
- Duration is 60 seconds or less; the account id and hash shown match the Evidence Package.
- The video is linked from `evidence/README.md` and the repository README.

#### FR-29: Evidence Package

`evidence/README.md` maps every row of SOW section 6.1 and every item of Appendix B to a link or committed file: fixture manifest and verification snapshot; committed `dustin plan` output for Fixture A (text and JSON); baseline recording and snapshots; Close Report with every transaction hash and Explorer link; inner and fee-bump envelope XDR per transaction; Horizon transaction records showing the fee account; the Horizon 404 snapshot for the closed account; test results screenshot and text; the video link. `dustin evidence build --report <path> --out <dir>` assembles the transaction-related files.

Acceptance:
- Every Appendix B item has a checked box next to a link that resolves.
- The package is complete offline: a reviewer can verify every item from the repository alone after a testnet reset, and every item from the Explorer before one.

#### FR-30: npm package and repository

The package builds ESM and CommonJS outputs with TypeScript declarations, exposes the `dustin` binary, includes the JSON schemas, the `LICENSE` (MIT), a `CHANGELOG.md`, and is published to npm with version 0.1.0 at delivery; CI runs the offline tier on every supported Node LTS line. `[ASSUMPTION: package name is `dustin` if available on npm, otherwise a scoped name under the builder's account; decided in Week 1.]`

Acceptance:
- `npx <package> plan <G...> --to <G...>` works on a clean machine with a supported Node LTS.
- `npm pack` contents include `dist/`, `schemas/`, `README.md`, `LICENSE`, and no secrets, fixtures secrets, or evidence binaries.
- The repository is public with the `LICENSE` file at its root.

## 5. Non-functional requirements

- **NFR-01 Safety and dry-run guarantee.** `planClose()` never mutates state (FR-07). `executeClose()` requires `confirm: true`, refuses Plan Status other than `closable` unless `allowPartial`, refuses when Account, Destination and Fee Sponsor are not three distinct accounts, and refuses any network passphrase other than testnet in v1. Acceptance: tests T-01, T-21; a public-network passphrase yields `DustinError` before any request.
- **NFR-02 Idempotency and resumability.** Re-running a close never re-applies a completed step or submits a duplicate transaction; a partially closed account is resumed by running the close again, with no report needed (FR-17). Acceptance: T-17.
- **NFR-03 Observability of transaction hashes.** Every submitted transaction's hash is emitted as an event and a log line with its Explorer URL before the next submission starts, and appears in the Close Report even when the run later fails. Acceptance: in T-16 the hash of a transaction that later times out is present in the report.
- **NFR-04 No secret key logging.** Secret keys are read only from environment variables or the `Signers` object, never accepted as CLI flags, never included in plans, reports, events, logs, or error messages; a redaction filter replaces any `S`-prefixed 56-character key that appears in a string with `S...REDACTED`. Acceptance: T-20 greps all outputs of a full CLI run for the secret and finds nothing.
- **NFR-05 Deterministic plan output.** Same snapshot, same options, same structural plan and `planHash`; stable ordering (rule R9); canonical JSON. Acceptance: T-19.
- **NFR-06 Node LTS support.** Supported and CI-tested on the current Node.js LTS lines at delivery (22.x and 24.x); ESM and CommonJS entry points; TypeScript declarations. `[ASSUMPTION: LTS lines at delivery are 22.x and 24.x.]`
- **NFR-07 npm publishable.** Semantic versioning starting at 0.1.0, `files` whitelist, `bin` entry, provenance-friendly build, no postinstall scripts.
- **NFR-08 MIT license.** `LICENSE` at the repository root and `license: MIT` in `package.json`.
- **NFR-09 Testnet only in v1.** Default Horizon `https://horizon-testnet.stellar.org`, default passphrase `Networks.TESTNET`; other passphrases refused (see NFR-01).
- **NFR-10 Planner performance.** A plan for an account with up to 1,000 subentries completes within 10 seconds against testnet Horizon with paging; no unbounded recursion in path finding (Horizon does the search).
- **NFR-11 Submission reliability.** Bounded retries with exponential backoff, per-transaction timebounds via `setTimeout`, timeout handling by hash lookup (FR-15); never a duplicate application.
- **NFR-12 Evidence usability.** Every evidence item is reachable from `evidence/README.md` with a browser and no local tooling (FR-29).

## 6. CLI command surface

| Command | Purpose | Secrets needed | Exit codes |
|---|---|---|---|
| `dustin plan <G...> --to <G...> [--sponsor <G...>] [--json] [--base-fee <stroops>]` | Print the Close Plan (Dry Run) | none | canonical decision 5: 0 plan printed, 2 usage error, 6 Horizon unreachable, 1 error |
| `dustin close <G...> --to <G...> --execute [--yes] [--partial] [--json] [--memo <m>] [--prefer-destination] [--base-fee <stroops>] [--report <path>]` | Execute the close with fee-bumped transactions; without `--execute` it is `plan` | `DUSTIN_ACCOUNT_SECRET`, `DUSTIN_SPONSOR_SECRET` | canonical decision 5: 0 closed and verified gone, 3 nothing executed, 4 partial, 5 stopped or failed, 2 usage error, 6 Horizon unreachable, 1 error |
| `dustin fixture create [--variant <name>] [--out <manifest>] [--secrets <path>]` | Build a fixture on testnet from friendbot | none (creates its own keys) | 0 built, 1 error |
| `dustin fixture verify <manifest>` | Prove Appendix B preconditions with Horizon evidence | none | 0 pass, 3 fail |
| `dustin baseline <G...> --out <dir>` | Snapshot the Account and print the baseline recording protocol | none | 0 |
| `dustin evidence build --report <path> --out <dir>` | Assemble transaction evidence (XDR, Horizon records, links, 404 proof) | none | 0 |
| `dustin verify-closed <G...>` | Confirm the Account no longer exists on Horizon | none | 0 gone, 3 still exists |

Global options: `--network testnet` (only value accepted in v1), `--horizon <url>`, `--explorer <base-url>`, `--verbose`. Progress lines are human-readable by default and NDJSON events with `--json`.

## 7. SDK API surface

Package exports (TypeScript), as implemented in `src/index.ts`. Names are normative. This section was rewritten on 2026-09-28 to match the code before the 0.1.0 publish freezes the API (builder decision on review finding AA-11): the code's names were kept, the earlier draft names (`verifyClosed(account, config)` returning `{ exists }`, `maxRetriesPerTransaction`, `submitTimeoutSeconds`, `tx_*` events) are gone, and so are the `resume` option and the `fallback` step status. Running a close again is how it resumes, because the ledger is the source of truth; the rung a disposal actually used is recorded on its step outcome (`rung`). Option defaults are stated inline.

Updated later on 2026-09-28 for the Epic 3 code and the third review round:
- the stop code `XLM_TO_DESTINATION_FELL`, `StopReason.xlmToDestination` and the same field on the `drift` event (review finding BH-7, story E3-S1);
- the `wait` event (story E3-S4);
- `recovery.sponsorsObserved`, with the exported types `SponsorObservation` and `SponsorState` (story E3-S3);
- `SubmittedTransaction.sequenceUsed` and `lookupError`, the upper bounds of the pauses and of `timeoutSeconds`, and the `closed` status rules (review round 3: R3-1, R3-10, R3-18, R3-22).

```ts
import type { FeeBumpTransaction, Keypair, Transaction } from "@stellar/stellar-sdk";

// Configuration (src/config/network.ts). Only the testnet is accepted in this release.
export interface DustinConfig {
  horizonUrl?: string;         // default "https://horizon-testnet.stellar.org"; must serve the testnet
  networkPassphrase?: string;  // only the testnet passphrase is accepted
  explorerBaseUrl?: string;    // default "https://stellar.expert/explorer/testnet"
}

// Planning (src/plan/model.ts, src/plan/plan-close.ts). Read-only: no secret, no signature.
export interface PlanOptions {
  destination: string;         // G... or M...; must exist
  feeSponsor?: string;         // G...; named as the fee payer in the plan
  memo?: string;               // at most 28 bytes; needed for a SEP-29 memo-required destination
  preferDestination?: boolean; // default false: SOW ladder order (canonical decision 8)
  slippageBps?: number;        // default 100 (1%); sets each path payment's destMin
  baseFeeStroops?: number;     // override of the bid per operation; default from GET /fee_stats (p80), at least 100
  maxBaseFeeStroops?: number;  // default 1,000,000: cap on the bid per operation
  budgetStroops?: number;      // default 50,000,000 (5 XLM): the sponsor's budget per close
  maxWaitLedgers?: number;     // default 120 (about 10 min): longest sequence-guard wait; within it the merge runs
                               // alone and the executor waits for it (FR-14), beyond it the plan is blocked (SEQNUM_TOO_FAR)
  maxOpsPerTransaction?: number; // default and maximum 100
}
export interface PlanCloseInput extends PlanOptions { account: string }   // the G... to close
export interface PlanCloseOptions { config?: DustinConfig; reader?: LedgerReader }

export type PlanStatus = "closable" | "partial" | "blocked";
export type CloseStepKind =
  | "cancel_offer" | "dispose_balance" | "remove_trustline" | "remove_data" | "merge";
export type DisposalRung = "path_payment" | "return_to_issuer" | "send_to_destination";
export type LadderOrder = "sow" | "prefer-destination";
export type UnclosableCode =
  | "TRUSTLINE_NOT_AUTHORIZED" | "MAINTAIN_LIABILITIES_ONLY" | "NO_DISPOSAL_ROUTE"
  | "LIQUIDITY_POOL_SHARES" | "POOL_ASSET_TRUSTLINE";
export type BlockerCode =
  | "ACCOUNT_MISSING" | "AUTH_IMMUTABLE_SET" | "IS_SPONSOR" | "MASTER_KEY_DISABLED"
  | "THRESHOLD_UNMET" | "DESTINATION_MISSING" | "DESTINATION_IS_SELF"
  | "DESTINATION_REQUIRES_MEMO" | "SEQNUM_TOO_FAR" | "LIQUIDITY_POOL_SHARES";

export type StepSubject =
  | { type: "offer"; offerId: string; selling: AssetRef; buying: AssetRef; amount: string }
  | { type: "trustline"; asset: CreditAssetRef; balance: string; sponsor: string | null }
  | { type: "data"; name: string }
  | { type: "pool_share"; poolId: string; balance: string; sponsor: string | null }
  | { type: "account"; destination: string };

export interface DisposalDecision {
  rung: DisposalRung;
  amount: string;
  to: string;                     // the account itself (rung 1), the issuer or the destination
  quotedXlm?: string;             // path_payment only
  destMinXlm?: string;            // path_payment only; never below 1 stroop
  fallbackRungs: DisposalRung[];  // later rungs that were viable in the snapshot
  ruledOut: Array<{ rung: DisposalRung; reason: string }>;
}

export interface CloseStep {
  id: string;                     // "S01", "S02", ... in execution order
  kind: CloseStepKind;
  txIndex: number;
  subject: StepSubject;
  reason: string;                 // what it does, why it is needed, why this rung
  dependsOn: string[];
  threshold: "medium" | "high";
  operation: OperationDescriptor; // serializable descriptor, never a signed envelope
  disposal?: DisposalDecision;    // dispose_balance only
  reserveReleasedTo?: { to: "account" } | { to: "sponsor"; sponsor: string };
  feeEstimateStroops: number;
}

export interface PlannedTransaction {
  index: number;
  phase: "cleanup" | "convert" | "merge";
  stepIds: string[];
  opCount: number;                // 1..100
  innerFeeStroops: 0;             // the closing account never pays a fee
  feeBumpFeeStroops: number;      // the sponsor's bid: base fee x (opCount + 1)
  reason: string;
}

export interface UnclosableItem {
  code: UnclosableCode; subject: StepSubject; reason: string; remedy: string; blocksMerge: true;
  rungsRuledOut?: Array<{ rung: DisposalRung; reason: string }>;
}
export interface Blocker { code: BlockerCode; reason: string; remedy: string; permanent: boolean }

export interface SequenceGuard {
  sequenceAtMerge: string; earliestLedger: number; ok: boolean;
  unblocksAtLedger: number | null; etaSeconds: number | null;
}

export interface RecoverySummary {
  xlmToDestination: string;       // native balance now plus quoted path-payment proceeds
  nativeBalance: string;
  quotedProceedsXlm: string;
  reservesReturnedToSponsors: Array<{ sponsor: string; xlm: string; entries: string[] }>;
  feesPaidByAccount: "0";
}

export interface FeeSummary {
  baseFeeStroops: number; basis: "fee_stats" | "override"; maxBaseFeeStroops: number;
  perTransactionStroops: number[]; totalStroops: number;
  budgetStroops: number; withinBudget: boolean;
  payer: string;                  // the fee sponsor's public key, or "fee_sponsor" when not given
}

export interface ClosePlan {
  schemaVersion: 1;
  kind: "dustin-close-plan";
  network: { passphrase: string; horizon: string };
  account: string; destination: string; feeSponsor: string | null; memo: string | null;
  options?: { slippageBps: number; maxOpsPerTransaction: number; maxWaitLedgers: number };
  observed: { ledger: number; closedAt: string };
  reserve: { balance: string; minimum: string; spendable: string; baseReserve: string };
  snapshotHash: string;
  planHash: string;               // structural: steps, order, grouping, rungs, blockers; no fees or quotes
  status: PlanStatus;
  ladderOrder: LadderOrder;
  steps: CloseStep[];
  transactions: PlannedTransaction[];
  unclosable: UnclosableItem[];
  blockers: Blocker[];
  warnings: string[];
  recovery: RecoverySummary;
  fees: FeeSummary;
  sequenceGuard: SequenceGuard | null;
}

// Execution (src/execute/*, src/sponsor/signer.ts).
export interface Signer { publicKey(): string; sign(tx: Transaction | FeeBumpTransaction): void | Promise<void> }
export function keypairSigner(keypair: Keypair): Signer;
export interface Signers { account: Signer; feeSponsor: Signer }

export interface ExecuteOptions {
  confirm: true;                          // literal true is required
  allowPartial?: boolean;                 // default false
  onDrift?: "abort" | "replan";           // default "abort"
  onEvent?: (event: CloseEvent) => void;
  onReport?: (report: CloseReport) => void; // a copy after every change; status "running" until the end
  config?: DustinConfig;
  reader?: LedgerReader;
  budgetStroops?: number;                 // overrides the plan's (default 5 XLM)
  maxBaseFeeStroops?: number;             // overrides the plan's (default 1,000,000)
  timeoutSeconds?: number;                // default 120, from 1 to 3600: validity of each inner transaction
  maxAttemptsPerTransaction?: number;     // default 5: envelopes per planned transaction
  maxReplans?: number;                    // default 3
  maxRateLimitRetries?: number;           // default 5: posts of one envelope after HTTP 429
  pollIntervalMs?: number;                // default 2000; a pause from 200 to 2^31 - 1 ms, never 0; also
                                          // the pace of the sequence-guard wait (FR-14)
  backoffMs?: number;                     // default 1000, doubled after each 429; a pause from 200 to
                                          // 2^31 - 1 ms, and the doubled pause never goes beyond that
  graceSeconds?: number;                  // default 10
  ledgerWaitSeconds?: number;             // default 60
  verifyTimeoutMs?: number;               // default 30000
  sleep?: (ms: number) => Promise<void>;  // default a timer; tests inject one that returns at once
  now?: () => number;                     // default Date.now
}
// A custom `submitter` is also accepted; it is internal and undocumented until 0.1.0.

export type CloseStatus = "closed" | "partial" | "aborted" | "failed" | "running";
// "running" appears only on copies published while a run is in progress (2026-09-27).
// "closed": a merge of this run applied, seen by hash, or proven by the account being gone after
// this run posted a merge envelope that could have applied (outcome unknown, or pending mid-POST).
// A merge envelope refused or failed on the ledger proves nothing, so the stop stands (review
// round 3, R3-1). A merge of this run that applied is always "closed" (R3-10):
// - verified gone: "closed" with verification.accountExists === false and no stop (CLI exit 0);
// - Horizon still returns the account at the final check: "closed" with stop ACCOUNT_STILL_EXISTS (CLI exit 5);
// - interrupted after the merge, before the final check: "closed" with verification null (CLI exit 5).
// "partial": an allowPartial run did everything else. "aborted": nothing was submitted.
// "failed": stopped part-way after a submission, with no merge of this run applied; run again to continue.

export interface SubmittedTransaction {
  index: number; phase: "cleanup" | "convert" | "merge"; stepIds: string[];
  attempts: number;               // posts of this envelope (a 429 posts it again)
  attempt: number;                // which envelope of the planned transaction (a rebuild adds one)
  round: number;                  // 0 for the plan the run started with, n for the n-th re-plan
  sequence: string; baseFeeStroops: number; maxTime: number; rebuiltBecause?: string;
  hash: string; innerHash: string;
  result: "pending" | "applied" | "failed" | "rejected" | "unknown";
  mayStillApply?: boolean;        // only while result is "unknown"
  sequenceUsed?: true;            // only while "unknown": not found by hash, but its sequence number is known used
  lookupError?: string;           // only while "unknown": why the outcome could not be settled (failed lookups or reads)
  ledger: number | null; feeChargedStroops: number | null; feeAccount: string;
  innerEnvelopeXdr: string; feeBumpEnvelopeXdr: string; explorerUrl: string;
  resultCodes?: { transaction?: string; innerTransaction?: string; operations?: string[] };
  explanation?: string;
}

export interface StepOutcome {
  stepId: string;
  status: "applied" | "failed" | "not_run";
  txIndex: number; txHash?: string;
  rung?: DisposalRung;            // the rung the disposal applied with; after a fall down the ladder it differs from the plan
  round?: number;                 // the plan round that applied the step, when not the first
  failures?: number; resultCodes?: SubmittedTransaction["resultCodes"]; explanation?: string;
}

export type StopCode =
  | "PLAN_CHANGED" | "XLM_TO_DESTINATION_FELL" | "PLAN_NOT_CLOSABLE" | "NOTHING_TO_EXECUTE"
  | "ACCOUNT_MISSING" | "OVER_BUDGET" | "OPERATION_FAILED" | "STEP_FAILED_TWICE" | "REPLAN_LIMIT"
  | "TRANSACTION_REJECTED" | "SEQUENCE_CONFLICT" | "FEE_LIMIT" | "RETRY_LIMIT" | "OUTCOME_UNKNOWN"
  | "MERGE_PREFLIGHT_FAILED" | "SEQNUM_TOO_FAR" | "ACCOUNT_STILL_EXISTS";
// XLM_TO_DESTINATION_FELL (review BH-7): the fresh plan made before signing sends less XLM to the
// destination than the approved plan; the plan hash leaves quotes out, so the amounts are compared
// separately (FR-16). SEQNUM_TOO_FAR comes from the plan's guard, from the merge preflight when the
// wait for the guard would pass the plan's maxWaitLedgers or its local-clock limit runs out, or from
// a merge that failed with op_seq_num_too_far (FR-14); a preflight that fails on the guard alone
// gives SEQNUM_TOO_FAR, not MERGE_PREFLIGHT_FAILED.

export interface StopReason {
  code: StopCode | DustinErrorCode; // a run outcome, or the code of the DustinError that interrupted the run
  stage: ErrorStage;
  verdict: ErrorVerdict;          // "replan": running the close again is the remedy; "stop": something must change first
  detail: string;
  round?: number; txIndex?: number; hash?: string; stepId?: string; resultCodes?: SubmittedTransaction["resultCodes"];
  unblocksAtLedger?: number;      // sequence-guard stops: the first ledger the merge can land in
  xlmToDestination?: { approved: string; fresh: string }; // drift before signing: both amounts, when the fresh one is lower
  maxTime?: number;               // OUTCOME_UNKNOWN: the envelope's upper time bound; run again after a ledger closed past it
}

export interface SponsorState {   // a reserve sponsor as Horizon showed it
  numSponsoring: number;          // Horizon num_sponsoring
  balance: string;                // its XLM balance; a close leaves it unchanged
  minimumBalance: string;         // (2 + subentries + num_sponsoring - num_sponsored) x base reserve
  ledger: number;                 // the latest ledger Horizon reported just before the read
}
export interface SponsorObservation {
  sponsor: string;
  before: SponsorState | null;    // read before the first submission; null when the read failed or only a re-plan named it
  after: SponsorState | null;     // read after the final check; null when the read failed
}

export interface CloseReport {
  schemaVersion: 1; kind: "dustin-close-report";
  network: { passphrase: string; horizon: string };
  account: string; destination: string; feeSponsor: string; planHash: string;
  status: CloseStatus;
  message: string | null;
  stop: StopReason | null;        // machine-readable reason a run stopped or did not start
  startedAt: string; finishedAt: string | null;
  transactions: SubmittedTransaction[];
  steps: StepOutcome[];
  replans: ReplanRecord[];        // each re-plan with its trigger, demoted assets and drift
  unclosable: UnclosableItem[];
  blockers: Array<Blocker | RunBlocker>; // RunBlocker: a step that failed twice (STEP_FAILED_TWICE)
  warnings: string[];
  recovery: {
    mergedXlm: string | null;     // read from the merge result
    reservesReturnedToSponsors: Array<{ sponsor: string; xlm: string; entries: string[] }>;
    feesPaidByAccount: "0"; feesPaidBySponsorStroops: number;
    sponsorsObserved?: SponsorObservation[]; // each reserve sponsor the plans name, before and after (FR-13);
                                             // absent in reports written before story E3-S3
  };
  verification: {
    accountExists: boolean; horizonStatus: 200 | 404; checkedAt: string; accountUrl: string; ledger?: number;
  } | null;
}

export type CloseEvent =
  | { type: "plan"; plan: ClosePlan; round?: number }
  | { type: "drift"; action: "abort" | "replan"; previousPlanHash: string; planHash: string;
      xlmToDestination?: { approved: string; fresh: string } } // set when the fresh amount is lower (BH-7)
  | { type: "preflight"; index: number; ok: boolean; detail: string }
  | { type: "wait"; reason: "sequence"; state: "start" | "end"; index: number;
      untilLedger: number; currentLedger: number } // the sequence-guard wait before a merge (FR-14)
  | { type: "tx:building"; index: number; phase: PlannedTransaction["phase"]; opCount: number; attempt?: number; round?: number }
  | { type: "tx:submitted"; index: number; hash: string; explorerUrl: string; attempt?: number; round?: number }
  | { type: "tx:confirmed"; index: number; hash: string; ledger: number; feeChargedStroops: number }
  | { type: "tx:failed"; index: number; hash: string; result: string; detail: string }
  | { type: "verified"; accountExists: boolean }
  | { type: "done"; status: CloseStatus };

export interface VerifyClosedOptions {
  config?: DustinConfig; reader?: LedgerReader;
  timeoutMs?: number;             // default 30000; 0 checks once
  intervalMs?: number;            // default 2000; a pause from 200 to 2^31 - 1 ms, never 0
  now?: () => number; sleep?: (ms: number) => Promise<void>;
}
export interface ClosedVerification {
  accountExists: boolean; horizonStatus: 200 | 404; checkedAt: string;
  ledger: number;                 // Horizon had ingested at least this ledger when it answered
  accountUrl: string;
}

export function inspectAccount(account: string, options?: { destination?: string; config?: DustinConfig; reader?: LedgerReader }): Promise<AccountSnapshot>;
export function planClose(input: PlanCloseInput, options?: PlanCloseOptions): Promise<ClosePlan>;
export function planFromSnapshot(snapshot: AccountSnapshot, options: PlanOptions): ClosePlan; // pure
export function executeClose(plan: ClosePlan, signers: Signers, options: ExecuteOptions): Promise<CloseReport>;
export function verifyClosed(account: string, options?: VerifyClosedOptions): Promise<ClosedVerification>;
export function renderPlan(plan: ClosePlan, options?: { next?: string; heading?: string }): string;
export function renderReport(report: CloseReport, options?: { plans?: readonly ClosePlan[]; explorerBaseUrl?: string }): string;
export function redact(text: string): string;
export function resolveConfig(config?: DustinConfig): ResolvedConfig;
export function verifyHorizonIsTestnet(horizonUrl: string, fetchImpl?: typeof fetch): Promise<void>;
export const DEFAULT_HORIZON_URL: string, DEFAULT_EXPLORER_BASE: string, TESTNET_PASSPHRASE: string;
export class DustinError extends Error {
  code: DustinErrorCode; stage: ErrorStage; retryable: boolean; verdict: ErrorVerdict;
  remedy?: string; details?: Record<string, string | number | boolean | null>;
  horizon?: HorizonFailure; report?: CloseReport;   // never carries a secret
}
```

Expected outcomes are returned, not thrown (ADR-0006): `executeClose()` returns a report whose `status` and `stop` say what happened, and throws only for configuration errors before anything is read or signed and for the unexpected; an error thrown after the report exists carries it in `error.report`, so no submitted hash is lost (review finding R1).

Implementation binds to `@stellar/stellar-sdk`: `Horizon.Server` for reads and submission; `TransactionBuilder` with `fee`, `networkPassphrase`, `setTimeout`; `TransactionBuilder.buildFeeBumpTransaction(feeSource, baseFee, innerTx, networkPassphrase)`; `Operation.manageSellOffer` / `Operation.manageBuyOffer` (amount `"0"` deletes), `Operation.pathPaymentStrictSend`, `Operation.changeTrust` (limit `"0"` deletes), `Operation.manageData` (value `null` deletes), `Operation.accountMerge`; fixture building additionally uses `Operation.beginSponsoringFutureReserves`, `Operation.endSponsoringFutureReserves`, `Operation.setTrustLineFlags`, `Operation.bumpSequence`, and `Operation.liquidityPoolWithdraw` only in tests. Tech choices beyond these bindings belong to the architecture document.

## 8. Ordering rules and grouping (normative)

- **R1. Offers first.** Cancel every open offer (sell and buy) before any disposal or trustline removal: offers lock balances as liabilities, `ChangeTrust` limit 0 fails while buying liabilities exist, and a path payment must not cross the Account's own offers.
- **R2. Dispose before removing.** Every Dust balance is disposed of before its trustline is removed; `ChangeTrust` limit 0 requires a zero balance.
- **R3. Ladder order.** Per balance: `path_payment`, then `return_to_issuer`, then `send_to_destination`, then `unclosable`. Preconditions are in FR-03; execution-time fallback follows the same order.
- **R4. Sponsored trustlines.** Removed by the Account like any other trustline once empty; their reserve returns to the Reserve Sponsor and is excluded from the Account's recovery figure.
- **R5. Data entries.** Removed at any point before the merge; placed after trustline removals in the same transaction for readability.
- **R6. Merge last.** The merge is the final operation of the final transaction. Preconditions: no non-signer Subentries remain, `num_sponsoring` is 0, no open sponsorship in the transaction, `AUTH_IMMUTABLE` not set, the Destination exists, the sequence number is less than `ledgerSeq << 32`, and the master key meets the high threshold.
- **R7. Grouping.** Fill transactions in dependency order up to 100 operations; start a new transaction only at the cap or when the merge must run alone to wait for the sequence guard (FR-14). A transaction is atomic: one failing operation fails the whole transaction and nothing is applied, so a single transaction is the default whenever the plan fits, and recovery re-plans from refreshed state.
- **R8. Detect-and-report never emits operations.** Pool shares, sponsoring reserves and claimable balances, raised thresholds, master weight 0, `AUTH_IMMUTABLE`, C addresses, and far-future sequence numbers produce Unclosable Items or Blockers with remedies; the merge is omitted when a Blocker exists.
- **R9. Stable order within a class.** Offers by offer id ascending; trustlines by asset code then issuer; data entries by key; deterministic output.
- **R10. Fees.** Base fee `max(100 stroops, fee_stats-derived)` capped; inner fee `ops x base`; fee-bump fee `(ops + 1) x base`, paid by the Fee Sponsor; per-step estimate `ops in step x base`; per-transaction estimate includes the extra base fee.

## 9. Fixture specification and test matrix

### 9.1 Fixture A (canonical, success-metric account)

| Element | Specification |
|---|---|
| Account | Created and funded from friendbot, then drained so that after the draining transaction's fee the balance equals the Minimum Balance exactly: `(2 + 7 - 1) x 0.5 = 4.0000000 XLM`, Spendable XLM 0 |
| Trustline A1 | Asset `LIQ` from issuer I1; dust balance; direct order book against XLM provided by the market maker (Rung `path_payment`) |
| Trustline A2 | Asset `HOP` from issuer I1; dust balance; order book only against `LIQ` (2-hop path `HOP -> LIQ -> XLM`, Rung `path_payment`) |
| Trustline A3 | Asset `ILQ` from issuer I2; dust balance; no order book anywhere (Rung `return_to_issuer`) |
| Trustline A4 | Asset `SPN` from issuer I2; zero balance; created inside a `BeginSponsoringFutureReserves` / `EndSponsoringFutureReserves` sandwich signed by the Reserve Sponsor and the Account |
| Offers | O1 sells a fraction of `LIQ` for XLM; O2 sells a fraction of `HOP` for `LIQ`. Neither locks XLM |
| Data entry | key `dustin.fixture`, value `messy` |
| Destination | D, exists, friendbot-funded |
| Fee Sponsor | FS, friendbot-funded, env key |
| Reserve Sponsor | RS, friendbot-funded, distinct from FS |
| Issuers | I1 (`LIQ`, `HOP`), I2 (`ILQ`, `SPN`); no authorization flags |
| Market maker | MM, holds `LIQ` and `HOP`, posts buy `LIQ` with XLM and buy `HOP` with `LIQ` |
| Expected plan | 1 transaction, 11 operations: cancel O1, O2; dispose A1, A2 (`path_payment`), A3 (`return_to_issuer`); remove A1, A2, A3, A4; remove data; merge |
| Expected result | Account gone; D receives 4.0000000 XLM plus path-payment output; RS `num_sponsoring` decreases by 1; FS pays 1,200 stroops at base fee 100 |

### 9.2 Fixture B (stranded variant)

Fixture A plus Trustline A5: asset `FRZ` from issuer I3 with `AUTH_REQUIRED` and `AUTH_REVOCABLE`; I3 authorizes the Account, sends dust, then revokes authorization (freeze). `FRZ` has no order book. Expected: A5 is `unclosable` with `TRUSTLINE_NOT_AUTHORIZED`, the reason names I3, the remedy is "issuer must re-authorize or claw back"; `executeClose()` refuses unless `allowPartial`; with `allowPartial`, everything else is removed, no merge is attempted, Close Status is `partial`, and the Account remains with exactly one trustline.

### 9.3 Variants

| Variant | Shape | Expected |
|---|---|---|
| A0 | Account created inside a sponsorship sandwich so its base reserve is sponsored; literal balance 0 XLM; otherwise as A | `closable`; plan shows the base reserve returning to the Reserve Sponsor |
| SIMPLE | 2 offers, 2 zero-balance trustlines, 1 data entry, zero spendable XLM | `closable`; Week 2 milestone account. Not built: the Week 2 close used fresh Fixture A (`messy`) accounts instead, a harder account, and the builder accepted the substitution on 2026-09-28 (story E2-S6) |
| SEQ-NEAR | A plus `BumpSequence` to `(currentLedger + 3) << 32` | `closable`, the merge alone in the last transaction; the executor waits for the guard, then the merge succeeds (FR-14) |
| SEQ-FAR | A plus `BumpSequence` to `(currentLedger + 100000) << 32` | `blocked`, `SEQNUM_TOO_FAR` with earliest ledger |
| LP | A plus a pool share trustline with a deposit | `partial`, `LIQUIDITY_POOL_SHARES` |
| MS | A plus an extra signer and high threshold above the master weight | `blocked`, `THRESHOLD_UNMET` |
| CLW | A with `LIQ` replaced by a clawback-enabled asset; issuer claws back between plan and execution in the recorded test | Drift handling per FR-16 |
| AUTH | Authorization-required issuer in three states: authorized (normal), unauthorized with zero balance (removable), authorized-to-maintain-liabilities with dust (unclosable) | Per state |
| ISS | A plus an asset whose issuer account was merged away; Destination holds the trustline | `return_to_issuer`: the payment burns the balance even though the issuer is gone (day-1 experiment 4; `docs/README.md` open question 3, resolved 2026-09-26); outcome recorded in the write-up |

### 9.4 Test matrix

| Id | Case | Tier | FR / NFR |
|---|---|---|---|
| T-01 | Dry-run guarantee: no non-GET request, no secret needed | offline | FR-07, NFR-01 |
| T-02 | Inventory completeness on Fixture A | live | FR-01 |
| T-03 | Ordering rules property test | offline | FR-02 |
| T-04 | Grouping at the 100-operation cap | offline | FR-04 |
| T-05 | Fee estimation arithmetic and floor/cap | offline | FR-05 |
| T-06 | Illiquid leftover balance exits by `return_to_issuer` (A3) | live | FR-03, FR-12 |
| T-07 | Illiquid and frozen balance exits by `unclosable` with stated reason (Fixture B) | live | FR-03, FR-12, FR-19 |
| T-08 | Liquid dust by `path_payment`, direct and 2-hop (A1, A2) | live | FR-03, FR-12 |
| T-09 | Sponsored trustline unwinding; reserve returns to the Reserve Sponsor | live | FR-13 |
| T-10 | `ACCOUNT_MERGE_SEQNUM_TOO_FAR` guard, near and far | live | FR-14 |
| T-11 | Authorization-required trustline in each state (AUTH) | live and offline | FR-03, FR-08 |
| T-12 | Clawback-enabled trustline and Drift (CLW) | offline | FR-16 |
| T-13 | Liquidity pool shares detected and reported (LP) | live | FR-08 |
| T-14 | Raised multisig thresholds detected and reported (MS) | live | FR-08 |
| T-15 | Fee-bump invariant: every transaction's fee account is the Fee Sponsor; Account never pays | live | FR-11 |
| T-16 | Retry and recovery branches: 504 then hash lookup, `tx_bad_seq`, `tx_too_late`, `tx_insufficient_fee`, operation failure with fallback | offline | FR-15, NFR-03, NFR-11 |
| T-17 | Resume after interruption; re-run of a completed close submits nothing | offline and live | FR-17, NFR-02 |
| T-18 | Zero-XLM close end to end: a fresh Fixture A closed by `test/testnet/execute-close.test.ts`, evidence in `evidence/runs/<UTC stamp>/` (replaces the SIMPLE variant, decision of 2026-09-28) | live | FR-11, FR-18 |
| T-19 | Deterministic plan and `planHash` | offline | FR-10, NFR-05 |
| T-20 | Secret redaction across logs, events, reports, errors | offline | NFR-04 |
| T-21 | Testnet-only guard | offline | NFR-01, NFR-09 |
| T-22 | Fixture verifier proves Appendix B preconditions | live | FR-22 |
| T-23 | Fully sponsored account with literal 0 XLM balance (A0) | live | FR-01, FR-06 |
| T-24 | Issuer account missing (ISS): empirical outcome recorded | live | FR-03, FR-12 |
| T-25 | Destination missing and Destination equals Account | offline | FR-08, FR-16 |
| T-26 | Offer cancellation (sell and buy) and data entry removal | live | FR-02 |

## 10. Success metrics

**Primary**

- **SM-1 (SOW, verbatim):** "one testnet account holding zero spendable XLM, at least 3 trustlines with non-zero balances, at least 1 open offer and at least 1 data entry is fully closed and merged. Pass means anyone can open the explorer, see the transaction chain, and see that the account no longer exists. There is no partial credit." Validates FR-01 to FR-22 on Fixture A; evidenced by FR-29.

**Secondary**

- **SM-2:** Every case in the test matrix (section 9.4) passes: offline tier in CI on every supported Node LTS line, live tier against testnet before delivery. Validates FR-24.
- **SM-3:** Every row of SOW section 6.1 and every item of Appendix B resolves to a link or committed file in the Evidence Package, checkable with a browser. Validates FR-25, FR-28, FR-29.
- **SM-4:** A developer reaches a printed plan from the README within the documented steps, on a clean machine. Validates FR-26, FR-30.

**Counter-metrics (do not optimize)**

- **SM-C1:** Transaction count. Fewer transactions is a goal only within rule R7; never merge steps in a way that hides a failure or applies a partial teardown without a Close Report. Counterbalances FR-04.
- **SM-C2:** Disposal aggressiveness. Burning or selling is never done without a plan the user confirmed, and never on an account that cannot end in a merge unless `allowPartial` was requested. Counterbalances FR-12.
- **SM-C3:** Coverage theater. Test names must map to FRs and to observable Horizon state; no test passes on mocked behavior that the live tier contradicts. Counterbalances SM-2.

## 11. Scope

### 11.1 In scope

Exactly the SOW deliverables: D1 (FR-01 to FR-10), D2 (FR-11 to FR-20), D3 (FR-21 to FR-25), D4 (FR-26 to FR-30), plus the cross-cutting NFRs. Nothing in the SOW scope is dropped.

### 11.2 Out of scope (SOW, explicit)

- Mainnet. Testnet only, no real value.
- Contract accounts (C addresses). Classic G address accounts only.
- Liquidity pool share withdrawal. Detected and reported, not automated.
- Multisig accounts with raised thresholds. Detected and reported, not automated.
- Claimable balance cleanup.
- Production key management. The sponsor uses an env key for this scope.
- Wallet UI. A CLI demo is the interface; integration UI is left to the integrator.
- Third-party wallet integration work.

Anything else is stretch (section 14).

## 12. Traceability matrix

### 12.1 SOW deliverable to requirements to evidence

| SOW deliverable | Requirements | Evidence artifact (SOW 6.1) |
|---|---|---|
| D1 `planClose()` read-only planner, CLI dry run | FR-01, FR-02, FR-03, FR-04, FR-05, FR-06, FR-07, FR-08, FR-09, FR-10; NFR-01, NFR-05, NFR-10 | Public repo; `dustin plan` runnable against any testnet account (FR-09); committed plan output for Fixture A in `evidence/plan/` (FR-29) |
| D2 `executeClose()` live on testnet, fee-sponsored, ladder, sponsored unwinding, seqnum guard, retry and recovery | FR-11, FR-12, FR-13, FR-14, FR-15, FR-16, FR-17, FR-18, FR-19, FR-20; NFR-02, NFR-03, NFR-04, NFR-09, NFR-11 | Transaction hashes with Explorer links and the Horizon 404 for the Account in `evidence/runs/<UTC stamp>/` (FR-18, FR-29; the layout is `evidence/runs/README.md`); 60-second video (FR-28) |
| D3 Edge cases, fixture, baseline recording, test matrix | FR-21, FR-22, FR-23, FR-24, FR-25 | Test results screenshot and text in `evidence/tests/` (FR-24); public repo with `npm test` and `npm run test:live` (FR-24, FR-26); baseline recording and snapshots in `evidence/baseline/` (FR-25) |
| D4 README, integration notes, write-up, 60-second demo, evidence package, npm package | FR-26, FR-27, FR-28, FR-29, FR-30; NFR-06, NFR-07, NFR-08, NFR-12 | Public repo (FR-30); write-up `docs/write-up.md` (FR-27); video (FR-28); `evidence/README.md` (FR-29) |

### 12.2 Appendix B checklist to requirements

| Appendix B item | Proven by | Evidence file |
|---|---|---|
| Fixture holds zero spendable XLM | FR-21, FR-22 | `evidence/fixture/verify-before.json` |
| At least 3 trustlines with non-zero balances | FR-21, FR-22 | same |
| At least 1 open offer | FR-21, FR-22 | same |
| At least 1 data entry | FR-21, FR-22 | same |
| Every transaction fee-bumped by the sponsor | FR-11, FR-18 | `evidence/runs/<UTC stamp>/tx-<n>.json` (fee account), `evidence/runs/<UTC stamp>/report.json` |
| Account no longer exists on a public testnet explorer | FR-18, `verifyClosed()` | `evidence/runs/<UTC stamp>/account-after.json`, Explorer link |
| Full transaction chain linkable from the evidence package | FR-18, FR-29 | `evidence/README.md` |

## 13. Release plan

Actual sprint window: funds received 2026-09-22, final deadline 2026-10-22, buffer 2026-10-20 to 2026-10-22.

Weeks are relative to the sprint start agreed with the Ambassador Chapter Lead. Each week's definition of done quotes the SOW's expected output (section 5.1) and adds the verification that proves it.

### Week 1 (2026-09-22 to 2026-09-28) — Inventory and planner

Work: repository scaffold (TypeScript, ESM and CJS builds, CI on supported Node LTS lines, MIT license, npm name decided); fixture builder and verifier (FR-21, FR-22); Fixture A built and verified; baseline recorded and fixture re-verified unchanged (FR-25); inventory (FR-01), ordering (FR-02), ladder planning (FR-03), grouping (FR-04), reasons and fees (FR-05), recovery accounting (FR-06), dry-run guarantee (FR-07), blockers (FR-08), `dustin plan` (FR-09), schema and hash (FR-10).

Definition of done (SOW): "`planClose()` returns a correct ordered plan for the fixture, as a dry run, printed in the CLI. Nothing is submitted yet. A recorded baseline showing the existing tool failing on the same account." Verification: `evidence/plan/fixture-a.plan.txt` and `.json` committed; `evidence/fixture/verify-before.json` committed; `evidence/baseline/` complete with before and after snapshots; T-01 to T-05 and T-22 passing; no transaction submitted by Dustin (the Account's sequence number is unchanged from the verify-before snapshot).

### Week 2 (2026-09-29 to 2026-10-05) — Simple close, end to end

Work: fee-bumped submission (FR-11), submission and retry basics (FR-15), pre-flight and Drift (FR-16), Close Report (FR-18), `dustin close` (FR-19), Fee Sponsor checks (FR-20); a zero-spendable Fixture A closed end to end (the SIMPLE variant was replaced by the harder Fixture A, decision of 2026-09-28).

Definition of done (SOW): "A zero-XLM account is closed end to end on testnet with sponsored fees, with verifiable transaction hashes and the account gone from the explorer." Verification: T-15 and T-18 passing; the close report with hashes and Explorer links archived under `evidence/runs/<UTC stamp>/` together with the Horizon transaction record showing the Fee Sponsor as fee account and the Horizon 404 for the account (met on 2026-09-26 and 2026-09-27: `evidence/runs/20260926T125350Z/`, SDK run, and `evidence/runs/20260927T200015Z-cli/`, CLI run with transcript).

### Week 3 (2026-10-06 to 2026-10-12) — The leftover balance ladder

Work: ladder execution and fallback (FR-12), sponsored trustline unwinding (FR-13), sequence-number guard (FR-14), resume (FR-17), fixture variants (FR-23), test matrix (FR-24); Fixture A closed; Fixture B closed partially with the stranded asset reported.

Definition of done (SOW): "The messy fixture is closed. Tests pass, including the deliberately illiquid asset that exits through the unclosable path with a stated reason." Verification: every Appendix B item satisfied for Fixture A (section 12.2 files present); T-06 to T-14, T-16, T-17, T-19 to T-21, T-23 to T-26 passing; Fixture B report shows `unclosable` with `TRUSTLINE_NOT_AUTHORIZED` and a stated reason; test results captured to `evidence/tests/`.

### Week 4 (2026-10-13 to 2026-10-19) — Publish and demo

Work: error handling and CLI output polish; README and integration notes (FR-26); write-up (FR-27); 60-second demo (FR-28); Evidence Package (FR-29); npm publish 0.1.0 (FR-30); Appendix A tracker updated with evidence links.

Definition of done (SOW): "60-second demo, evidence package with explorer links, write-up published in the repo. D1, D2 and D3 closed." Verification: `npx <package> plan` works on a clean machine; `evidence/README.md` maps every SOW 6.1 row and Appendix B item to a resolving link; offline copies (XDR, Horizon JSON, screenshots, video) present so the package survives a testnet reset; SM-1 to SM-4 met.

## 14. Stretch (outside SOW)

Candidates only; none is committed, scheduled, or budgeted.

- Web demo UI that renders a Close Plan and drives a close with a browser wallet.
- Hosted Fee Sponsor service (fee-bump relay with policy limits and abuse controls).
- Mainnet support with production key management and a two-step confirmation.
- Configurable Disposal Ladder order (for example prefer `send_to_destination` over `return_to_issuer` to preserve value).
- Automated liquidity pool share withdrawal and claimable balance cleanup.
- Automated revocation of sponsorships the Account provides (`RevokeSponsorship`) before the merge.
- Multisig co-signing flow for accounts with raised thresholds.
- Wallet integrations (browser wallet signing, multi-wallet kits) and a SEP-style transaction hand-off.
- Contract (C address) and smart-account support.
- Stellar RPC as an alternative data source to Horizon.
- Batch closing of many accounts from one sponsor.
- Fixture builder as a general testnet data-automation tool for reset recovery.

## 15. Open questions

1. npm package name (`dustin` if available, otherwise a scoped name). Owner: the builder. Decide in Week 1.
2. Does the hosted Account Demolisher offer a testnet mode? If not, the baseline is recorded by running its MIT-licensed source locally against testnet Horizon. Owner: the builder. Verify on day 1.
3. Observed behavior of payments of an asset whose issuer account was merged away (variant ISS); determines whether `send_to_destination` is reachable in practice or `ISSUER_ACCOUNT_MISSING` applies. Owner: the builder. Week 3. Resolved on 2026-09-26 by day-1 experiment 4 (`docs/progress-log.md`; `docs/README.md` open question 3): the payment succeeds and burns the balance, so `return_to_issuer` needs only an authorized holder trustline and `ISSUER_ACCOUNT_MISSING` is informational, not an unclosable reason.
4. Sprint start date, since the SOW's suggested date has passed; also whether the 2026-12-16 testnet reset falls inside the review window. Owner: the builder with the Ambassador Chapter Lead.
5. Whether the reviewer prefers the video hosted as a repository release asset or an external link; both are acceptable per SOW 6.1. Owner: the Ambassador Chapter Lead.

## Decisions after review

- D-1 (2026-09-25, approved by the builder): the disposal ladder keeps the SOW order by default. A CLI flag `--prefer-destination` and an SDK option `preferDestination: true` try the destination transfer (rung 3) before the return to issuer (rung 2) and fall back to the burn when the destination cannot receive the asset. The plan states which order was used per balance. The messy fixture close, the demo and the evidence package use the default order. Effort: about 1 to 2 hours inside D2; no change to the SOW scope.
- D-2 (2026-09-28, builder, review finding AA-11): the SDK keeps the names it was built with. Section 7 was rewritten to match the code: `verifyClosed(account, options)` returning `{ accountExists, horizonStatus, checkedAt, ledger, accountUrl }`, `maxAttemptsPerTransaction`, `timeoutSeconds`, `tx:*` events. The `resume` option and the `fallback` step status are removed: running a close again is how it resumes, and the rung actually used is on the step outcome.
- D-3 (2026-09-28, builder, review findings CL-12 and BH-14): the CI seed scan uses the standalone pattern `(?<![A-Z2-7])S[A-Z2-7]{55}(?![A-Z2-7])` (`git grep -P`), so a muxed address that contains a seed-shaped run no longer fails CI.
- D-4 (2026-09-28, builder): the E2-S6 deviations are accepted: live closes of fresh Fixture A (`messy`) accounts instead of a SIMPLE variant, evidence in `evidence/runs/<UTC stamp>/` instead of `evidence/closes/`, and `test/testnet/execute-close.test.ts` instead of `simple-close.test.ts`.
- D-5 (2026-09-28, builder, review decision 5 of 2026-09-27): pauses between requests to Horizon (`pollIntervalMs`, `backoffMs`, `verifyClosed`'s `intervalMs`, the read client's retry backoff) are at least 200 ms and never 0; the pause function is injected (`sleep`), a timer by default, and tests inject one that returns at once.
- D-6 (2026-09-28, builder): an over-budget refusal and `SPONSOR_UNDERFUNDED` exit with code 3, "nothing executed"; canonical decision 5 in `docs/README.md` now reads "3 = nothing executed: no confirmation, blockers without `--partial`, or a sponsor or budget precondition failed".
- D-7 (2026-09-28, builder): the history rewrite for review findings R4 and R5 is postponed; the rest of the work goes on without it.

## Assumptions

- A-1. "0 XLM" (SOW D3 budget line) and "zero spendable XLM" (SOW success metric) are read as the same condition: `balance - Minimum Balance - XLM selling liabilities = 0`. The literal 0-balance case is covered by variant A0 (T-23), not by the success-metric fixture.
- A-2. The "1 sponsored trustline" is a fourth trustline in addition to the "3 trustlines with dust", so both readings of the SOW are satisfied; the sponsored trustline holds a zero balance in Fixture A and dust in an offline variant.
- A-3. The SOW's requirement that "the deliberately illiquid asset exits through the unclosable path with a stated reason" and its requirement that the fixture be "fully closed and merged" cannot both hold on one account. Resolution: Fixture A (success metric) has an illiquid asset that exits by `return_to_issuer`; Fixture B has an illiquid, issuer-frozen asset that exits by `unclosable` with a stated reason. Both are in D3.
- A-4. Fee Sponsor and Reserve Sponsor are distinct roles and distinct accounts in the fixture, so the evidence attributes every XLM movement unambiguously.
- A-5. "Minimum number of transactions" is read together with atomicity: a single transaction is the default whenever the plan fits in 100 operations; splits happen only at the cap or when the merge must run alone to wait for the sequence guard (FR-14).
- A-6. The Disposal Ladder keeps the SOW order (path payment, issuer return, destination transfer, unclosable) as the default; changing the order is stretch.
- A-7. The baseline is recorded on the same Fixture A instance that Dustin later closes; if the existing tool changes the state, a fresh instance is built and recorded, and the note says so.
- A-8. `executeClose()` refuses to run on a plan that cannot end in a merge unless `allowPartial` is set, to avoid burning or selling assets on an account that will remain.
- A-9. The environment variables are `DUSTIN_ACCOUNT_SECRET` and `DUSTIN_SPONSOR_SECRET`; secrets are never accepted as CLI flags.
- A-10. Node.js LTS lines at delivery are 22.x and 24.x.
- A-11. The Explorer used for links is StellarExpert's testnet explorer; any public testnet explorer that resolves transaction hashes and account ids is acceptable.
- A-12. Whether a payment of an asset whose issuer no longer exists succeeds is not settled by the documentation; it is an empirical test (T-24), and the success-metric fixture does not depend on it. Settled on 2026-09-26 by day-1 experiment 4: it succeeds and burns the balance (`docs/README.md` open question 3).
- A-13. The Account Demolisher's MIT license and the limits quoted in the SOW's problem statement are taken from the SOW; the tool's existence and feature list were corroborated independently.
- A-14. The builder appears in project documents only as the GitHub account `0xsimoneth`; no SOW contact details are copied.
- A-15. Base fee on testnet is normally the network minimum of 100 stroops; example figures in this document use that value.
- A-16. The npm package name is `dustin` if it is available, otherwise a scoped name under the builder's account; the choice is made in Week 1 and does not affect any requirement.

## Sources

- Accepted Statement of Work: `SUCCESSFUL_SOW.md` in this repository (sections 3, 4.1, 4.2, 5.1, 6.1, 6.2, Appendix A, Appendix B).
- List of Operations (Account merge preconditions and threshold High; Change trust, Manage data, Manage sell offer, Manage buy offer, Path payment strict send, Begin/End sponsoring future reserves, Revoke sponsorship, Bump sequence): https://developers.stellar.org/docs/learn/fundamentals/transactions/list-of-operations
- Account Merge result codes (`ACCOUNT_MERGE_HAS_SUB_ENTRIES`, `ACCOUNT_MERGE_SEQNUM_TOO_FAR` "must be less than (ledgerSeq << 32)", `ACCOUNT_MERGE_IS_SPONSOR`, `ACCOUNT_MERGE_DEST_FULL`, `ACCOUNT_MERGE_IMMUTABLE_SET`, `ACCOUNT_MERGE_NO_ACCOUNT`): https://developers.stellar.org/docs/data/apis/horizon/api-reference/errors/result-codes/operation-specific/account-merge
- Change Trust result codes (`CHANGE_TRUST_INVALID_LIMIT`, `CHANGE_TRUST_LOW_RESERVE`): https://developers.stellar.org/docs/data/apis/horizon/api-reference/errors/result-codes/operation-specific/change-trust
- Path Payment Strict Send result codes (`SRC_NOT_AUTHORIZED`, `TOO_FEW_OFFERS`, `OFFER_CROSS_SELF`, `UNDER_DESTMIN`, `NO_ISSUER`, `LINE_FULL`): https://developers.stellar.org/docs/data/apis/horizon/api-reference/errors/result-codes/operation-specific/path-payment-strict-send
- Transaction result codes (`tx_bad_seq`, `tx_too_late`, `tx_failed`, `tx_insufficient_fee`): https://developers.stellar.org/docs/data/apis/horizon/api-reference/errors/result-codes/transactions
- Horizon error handling for submissions (504 timeouts, retry): https://developers.stellar.org/docs/data/apis/horizon/api-reference/errors/error-handling
- Fee-bump transactions (fee account pays; sequence from the inner source; fee at least minimum for inner operations plus one and at least the inner fee): https://developers.stellar.org/docs/build/guides/transactions/fee-bump-transactions
- Sponsored reserves (sandwich, minimum balance formula, counters on removal, `REVOKE_SPONSORSHIP_LOW_RESERVE`): https://developers.stellar.org/docs/build/guides/transactions/sponsored-reserves
- Lumens: minimum balance, base reserve 0.5 XLM, 1,000-subentry cap: https://developers.stellar.org/docs/learn/fundamentals/lumens#minimum-balance
- Accounts: subentries and G versus C addresses: https://developers.stellar.org/docs/learn/fundamentals/stellar-data-structures/accounts
- Operations and transactions: 1 to 100 operations, one transaction at a time: https://developers.stellar.org/docs/learn/fundamentals/transactions/operations-and-transactions
- Fees, inclusion fee, 100-stroop minimum, surge pricing: https://developers.stellar.org/docs/learn/fundamentals/fees-resource-limits-metering
- Signatures and multisig thresholds: https://developers.stellar.org/docs/learn/fundamentals/transactions/signatures-multisig
- Asset access control flags and authorization levels: https://developers.stellar.org/docs/tokens/control-asset-access
- Burning assets by sending them to the issuer: https://developers.stellar.org/docs/learn/fundamentals/stellar-data-structures/assets#deleting-or-burning-assets
- Liquidity pools: pool share trustlines cost 2 base reserves; authorization effects: https://developers.stellar.org/docs/learn/fundamentals/liquidity-on-stellar-sdex-liquidity-pools
- Path payments guide (strict send; settlement when destination equals source): https://developers.stellar.org/docs/build/guides/transactions/path-payments
- Muxed accounts as merge and payment destinations: https://developers.stellar.org/docs/build/guides/transactions/pooled-accounts-muxed-accounts-memos
- Networks: testnet reset cadence and scheduled dates: https://developers.stellar.org/docs/networks#testnet-and-futurenet-data-reset
- Automating testnet reset data (friendbot URL): https://developers.stellar.org/docs/build/guides/basics/automate-reset-data
- Horizon API reference: retrieve an account, strict-send payment paths, fee stats: https://developers.stellar.org/docs/data/apis/horizon/api-reference/retrieve-an-account , https://developers.stellar.org/docs/data/apis/horizon/api-reference/list-strict-send-payment-paths , https://developers.stellar.org/docs/data/apis/horizon/api-reference/retrieve-fee-stats
- JavaScript SDK type declarations (`TransactionBuilder.buildFeeBumpTransaction`, `Operation.*`, `FeeBumpTransaction`): https://github.com/stellar/js-stellar-base/blob/master/types/index.d.ts
- StellarExpert Account Demolisher: https://stellar.expert/demolisher/public/
- `stellar/js-stellar-wallets` issue 98, "Add helper that closes a user's account" (opened 2019-08-12, open, no comments, repository archived 2024-02-08): https://github.com/stellar/js-stellar-wallets/issues/98
