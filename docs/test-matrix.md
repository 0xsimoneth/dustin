# D3 test matrix: rows, tests and status

This file maps every row of the D3 matrix (`docs/edge-cases-and-test-matrix.md` section 4) to the tests that cover it, with the level, the status and the owner (Story 3.6, AC-E3-S6-5). The planning documents call it a 31-row matrix; the table in section 4 has **32 rows**: M-01, S-01 to S-09, X-01 to X-19 and B-01 to B-03 (1 + 9 + 19 + 3). All 32 are listed below.

State as of 2026-09-28, on the E3-S5/E3-S6 branch. Rows other agents are covering now are marked planned, with the owner. The "Last run" column is left empty for the integrator, who fills it after the final run of both tiers.

Legend:

- **Level** is what the matrix asks for: `unit` (offline, recorded Horizon JSON or the fake ledger), `testnet` (live), `both`, or `recording` (a screen recording by the builder).
- **Status**: `green` means every level the row asks for has a passing test; `planned` means a level the row asks for is being written by the named owner; `not covered` means a level has no test and no owner; `human action` means a person has to do it.
- Test references drop the common prefix and suffix: `plan/ladder` is `test/unit/plan/ladder.test.ts`, and `testnet/edge` is `test/testnet/edge.test.ts`. The text after `›` is the test's name.

## How to run each tier (AC-E3-S6-1)

| Tier | Command | What it needs | Duration |
|---|---|---|---|
| Offline (unit) | `npm test` | Nothing. The network is blocked for the whole tier (`test/setup/no-network.ts`); the tests read recorded Horizon JSON (`test/fixtures/horizon/messy`, `pool-share`, `edge`) or run on the fake ledger (`test/helpers/fake-ledger.ts`, `test/helpers/edge-ledger.ts`). | 65 files, 580 tests, 4 to 7 s on 2026-09-28 (the limit is 60 s) |
| Live (testnet), all files | `DUSTIN_TESTNET=1 npm run test:testnet` | Internet access to Friendbot and testnet Horizon. Every file builds its own throwaway accounts from Friendbot with fresh keys; nothing is shared between runs and the builder's baseline fixture is never touched. | several minutes |
| Live, one file | `DUSTIN_TESTNET=1 npx vitest run --project testnet test/testnet/edge.test.ts` | as above | about 140 s for `edge` (2026-09-28) |

Options of the live tier:

- `DUSTIN_RECORD=1` re-records the offline vectors from the run's fresh fixture: `testnet/edge` writes `test/fixtures/horizon/edge/`, `testnet/pool-share-removal` writes `test/fixtures/horizon/pool-share/`. Both refuse to write a file that contains a secret seed.
- `DUSTIN_EVIDENCE=1` makes `testnet/execute-close` write `evidence/runs/<UTC stamp>/`.
- The live tests print every transaction hash with its purpose. In a shell that vitest recognises as an AI agent it picks its `minimal` reporter, which hides the output of passing tests; add `--reporter=verbose` to see it.

The fixtures the live tests build can also be built by hand:

- `dustin fixture create --profile messy`: the metric account (SOW Appendix B).
- `dustin fixture create --profile edge`: one throwaway account per edge variant (table below).
- `dustin fixture verify <dir>/<id>/manifest.json`: re-checks either profile against Horizon (exit 0 when every check passes, 3 when one fails).

`fixture create` writes the keys to `.fixture/<id>/keys.json` (mode 600, gitignored, testnet only), and the public manifest and the recorded Horizon JSON beside them.

The `edge` profile (`src/fixture/edge.ts`) has these variants, all funded by one Friendbot call and holding zero spendable XLM:

| Variant | Rows | What it holds |
|---|---|---|
| auth-frozen | S-02, S-01 | FRZ dust, frozen by its `AUTH_REQUIRED` + `AUTH_REVOCABLE` issuer; illiquid ILQX dust; a data entry |
| auth-maintain | S-06 | MNT dust reduced to maintain-liabilities, with an open offer selling MNT |
| auth-authorized | S-05 | AUTH dust, authorized by the same issuer |
| auth-revoke | S-02 (AC-E3-S6-3) | RVK dust and a data entry, revoked by the live test after planning |
| clawback | S-07 | CLAW dust from an `AUTH_REVOCABLE` + `AUTH_CLAWBACK_ENABLED` issuer |
| clawback-drift | S-07 (S-07b) | CLAW dust, clawed back by the live test after planning |
| pool-share | S-08 | LPA and LPB trustlines, shares of the LPA/LPB pool from a deposit, a data entry |
| multisig | S-09 | a second signer of weight 1, high threshold 2, master weight 1, a data entry |
| claimable | X-01 | a claimable balance it created for the destination |
| immutable | X-04 | `AUTH_IMMUTABLE` |

## The SOW-named cases (AC-E3-S6-2)

SOW Deliverable 3 names seven cases. Each needs at least one offline and one live test named after its matrix row.

| SOW case | Row | Offline test named after the row | Live test named after the row | Status |
|---|---|---|---|---|
| Illiquid leftover balance | S-01 (and S-02 for the unclosable variant) | `plan/edge-recorded` › S-01 (recorded): the illiquid ILQX has no strict-send path, so it is returned to its live issuer | `testnet/edge` › S-01: the illiquid ILQX (no market, live issuer) has no strict-send path, so the plan returns it to its issuer; › S-02 (with S-01 applied): ... the partial close burns ILQX, removes it ... | green |
| Sponsored trustline, the reserve returns to the sponsor | S-03 | none named yet; covered by `plan/order` › removes a sponsored trustline like any other and attributes its reserve to the sponsor | planned: `testnet/sponsored-unwind` (later agent); meanwhile `testnet/execute-close` asserts the reserve sponsor's `num_sponsoring` back to 0 | planned |
| `ACCOUNT_MERGE_SEQNUM_TOO_FAR` | S-04 | none named yet; covered by `plan/guard` › is exact at the boundary, and others (row S-04 below) | planned: `testnet/sequence-guard` (later agent) | planned |
| Authorization-required trustline | S-02, S-05, S-06 | `plan/edge-recorded` › S-02 (recorded), S-05 (recorded), S-06 (recorded); `execute/edge-recorded` › S-02, S-05, S-06 (recorded) | `testnet/edge` › S-02 (four tests), S-05, S-06 | green |
| Clawback-enabled trustline | S-07 | `plan/edge-recorded` › S-07 (recorded, AC-E3-S6-4); `execute/edge-recorded` › S-07 (recorded), S-07b (recorded) | `testnet/edge` › S-07 (AC-E3-S6-4), S-07b | green |
| Liquidity pool shares (detected and reported) | S-08 | `plan/blockers` › S-08 (two tests); `plan/edge-recorded` › S-08 (recorded, AC-E3-S5-1); `execute/edge-recorded` › S-08 (recorded) | `testnet/edge` › S-08 | green |
| Raised multisig thresholds (detected and reported) | S-09 | `plan/blockers` › S-09 (two tests); `plan/edge-recorded` › S-09 (recorded, AC-E3-S5-2); `execute/edge-recorded` › S-09 (recorded) | `testnet/edge` › S-09 (AC-E3-S5-5) | green |

Five of the seven cases are green at both levels with row-named tests. S-03 and S-04 have offline tests under other names and their row-named live tests are assigned (`testnet/sponsored-unwind`, `testnet/sequence-guard`).

## The matrix

| Row | Case | Level | Offline tests | Live tests | Status | Owner, notes | Last run |
|---|---|---|---|---|---|---|---|
| M-01 | Messy fixture, full close (binary metric) | both | `execute/executor` › closes the messy fixture in the planned fee-bumped transactions and verifies it is gone; `plan/dry-run` › produces the committed plan for the recorded fixture at a fixed 100-stroop base fee; `plan/order` › orders offers, cleanup pairs, data, the path payment pair, then the merge; `cli/close-execute` › closes an account whose plan needs three transactions, printing every hash | `testnet/execute-close` › closes a fresh zero-spendable messy fixture with every fee paid by the sponsor (green 2026-09-26 and 2026-09-27, `evidence/runs/`); `testnet/fixture-messy` › builds a fresh fixture that meets SOW Appendix B and holds zero spendable XLM; `testnet/plan-readonly` › plans a closable close and leaves the account untouched | green on fresh fixtures; planned on the baseline fixture | Integrator: E3-S7 closes `messy-20260926T035942Z` with `testnet/execute-close` after B-01. Ladder agent: parts in `testnet/ladder` | |
| S-01 | Illiquid leftover balance | both | `plan/ladder` › returns DUSTB and SPTA to the issuer because no path exists; `plan/edge-recorded` › S-01 (recorded): the illiquid ILQX has no strict-send path, so it is returned to its live issuer; `execute/edge-recorded` › S-02 (recorded): ... burns ILQX, removes it and the data entry, and leaves only FRZ | `testnet/edge` › S-01: the illiquid ILQX (no market, live issuer) has no strict-send path, so the plan returns it to its issuer; › S-02 (with S-01 applied) (the burn and the removal, live); `testnet/execute-close` burns DUSTB | green | E3-S6. Ladder agent adds `testnet/ladder` | |
| S-02 | Illiquid and frozen: exits through the unclosable path (SOW week 3) | both | `plan/edge-recorded` › S-02 (recorded): the frozen FRZ is unclosable before any submission, naming its issuer; nothing touches FRZ and nothing merges; `execute/edge-recorded` › S-02 (recorded): refuses the frozen account without allowPartial; with it burns ILQX, removes it and the data entry, and leaves only FRZ; › S-02 negative probe (recorded); › S-02 forced (AC-E3-S6-3, recorded); › S-02 forced without allowPartial (recorded); `plan/ladder` › reports a deauthorized trustline as unclosable, naming the issuer; `cli/close-execute` › refuses an unclosable plan without --partial and names the item and its remedy (exit 3); › runs everything else with --partial and exits 4 | `testnet/edge` › S-02 (with S-01 applied): the frozen FRZ is unclosable before any submission; the partial close burns ILQX, removes it and the data entry, and stops before the merge; › S-02 negative probe (AC-E3-S6-3): a payment of the frozen FRZ to its issuer fails with op_src_not_authorized; › S-02 forced with allowPartial (AC-E3-S6-3): the trustline is revoked after planning, the planned return fails with op_src_not_authorized and is reported, and the rest runs | green | E3-S6 | |
| S-03 | Sponsored trustline unwinding | both | `plan/order` › removes a sponsored trustline like any other and attributes its reserve to the sponsor; `plan/recovery` › sends the balance plus quoted proceeds to the destination and attributes sponsored reserves; `execute/executor` › closes the messy fixture ... (SPTA is sponsored) | `testnet/execute-close` asserts the reserve sponsor's `num_sponsoring` back to 0 after the close (green); the row's own test with the `tx_bad_auth_extra` negative control is not written yet | planned | Later agent: `testnet/sponsored-unwind` (S-03, X-18). Day-1 experiment 3 observed the negative control on 2026-09-26 (not a test) | |
| S-04 | `ACCOUNT_MERGE_SEQNUM_TOO_FAR` | both | `plan/guard` › passes a normal account; › is exact at the boundary; › reports the ledger and ETA after a far bump; `plan/plan` › waits for a near guard with a separate merge, and blocks a far one; `execute/preflight` › stops at the sequence guard with the unblocking ledger; `execute/preflight-guard` › refuses the merge when the guard is not ok and names no ledger; `execute/recovery` › keeps op_seq_num_too_far a stop that names the ledger the merge can land in | none yet | planned (live) | Later agent: `testnet/sequence-guard` (E3-S4). Day-1 experiment 5 observed `op_seq_num_too_far` on 2026-09-26 (not a test) | |
| S-05 | Authorization-required trustline, authorized | testnet | `plan/edge-recorded` › S-05 (recorded): the authorized AUTH is returned to its AUTH_REQUIRED issuer and the account closes in one transaction; `execute/edge-recorded` › S-05 (recorded): closes auth-authorized in one fee-bumped transaction, returning AUTH to its issuer | `testnet/edge` › S-05: an authorized trustline of an AUTH_REQUIRED issuer is returned to the issuer and the account closes | green | E3-S6 | |
| S-06 | Authorized to maintain liabilities only | both | `plan/edge-recorded` › S-06 (recorded): MNT is MAINTAIN_LIABILITIES_ONLY while its open offer is cancelled with amount 0; `execute/edge-recorded` › S-06 (recorded): cancels the MNT offer, keeps the maintain-liabilities balance and stops before the merge; `plan/ladder` › distinguishes authorized-to-maintain-liabilities | `testnet/edge` › S-06: the maintain-liabilities MNT stays unclosable while its open offer is cancelled; the account keeps only the MNT trustline | green | E3-S6 | |
| S-07 | Clawback-enabled trustline (and S-07b, clawback between plan and execution) | testnet | `plan/edge-recorded` › S-07 (recorded, AC-E3-S6-4): the inspector surfaces is_clawback_enabled and the plan warns, then returns CLAW to its issuer; `execute/edge-recorded` › S-07 (recorded): closes the clawback-enabled holder through the return to issuer; › S-07b (recorded): a clawback after planning fails the return with op_underfunded; the executor re-plans and closes | `testnet/edge` › S-07 (AC-E3-S6-4): the inspector surfaces is_clawback_enabled, the planner warns, and the return to the issuer closes the account; › S-07b: the issuer claws the dust back after planning; the return fails with op_underfunded, the executor re-plans and closes | green | E3-S6 | |
| S-08 | Liquidity pool shares, detected and reported | both | `plan/blockers` › S-08: the remedy names the pool ...; › S-08: plans no changeTrust for held shares or for the pool's asset trustlines, and no merge; `plan/edge-recorded` › S-08 (recorded, AC-E3-S5-1); `execute/edge-recorded` › S-08 (recorded): the partial close removes only the data entry; removing LPA fails with op_cannot_delete; `execute/edge-partial` › S-08: LIQUIDITY_POOL_SHARES refuses without allowPartial ... (two tests); `plan/pool-shares`, `plan/pool-resolution`, `execute/pool-share-removal` (empty and held share lines) | `testnet/edge` › S-08: pool shares block the merge with the pool id in the remedy; ChangeTrust(0) on LPA fails with op_cannot_delete; the partial close removes only the data entry; `testnet/pool-share-removal` (an empty share line removed, review R14) | green | E3-S5, E3-S6 | |
| S-09 | Raised multisig thresholds, detected and reported | both | `plan/blockers` › S-09: names the weight the merge needs and the master key's weight, and which threshold blocks which step; › S-09: keeps the cleanup (medium) in the plan and leaves the merge (high) out; `plan/edge-recorded` › S-09 (recorded, AC-E3-S5-2); `execute/edge-recorded` › S-09 (recorded); `execute/edge-partial` › S-09 (three tests); `plan/order` › detects thresholds the master key cannot meet | `testnet/edge` › S-09 (AC-E3-S5-5): THRESHOLD_UNMET names both weights; without allowPartial nothing is signed; with it the data entry goes and the merge is left out | green | E3-S5, E3-S6. The matrix's signing variants (both keys supplied; master weight 0 with the second key) are out of scope: the SOW says multisig accounts are detected and reported, not automated | |
| X-01 | The account sponsors a claimable balance | both | `plan/blockers` › X-01: names the claimable balances the account created and how their sponsorship ends; `plan/edge-recorded` › X-01 (recorded, AC-E3-S5-4); `execute/edge-recorded` › X-01 (recorded); `plan/order` › detects merge blockers with remedies; `inspect/inspect` › detects pool shares, sponsoring with claimable balances, SEP-29 and a frozen trustline | `testnet/edge` › X-01: a claimable balance the account created blocks the merge (IS_SPONSOR); a merge attempt fails with op_is_sponsor | green | E3-S5, E3-S6. `/claimable_balances?sponsor=` is recorded in `test/fixtures/horizon/edge/claimable-balances-claimable.json` | |
| X-02 | The account sponsors another account's entry | unit (+ optional testnet) | `plan/blockers` › X-02: the remedy says to revoke or transfer the sponsorships first; `execute/edge-partial` › X-02: IS_SPONSOR refuses ... (two tests) | none (optional) | green | E3-S5. The blocker gives the number of sponsored reserves, not the entries (`/accounts?sponsor=` is not read) | |
| X-03 | Claimable balances claimable by the account | both | none | none | not covered | No owner. The inspector does not read `/claimable_balances?claimant=`, so the plan has no warning that such balances are lost with the merge (edge case A-03) | |
| X-04 | `AUTH_IMMUTABLE` on a throwaway account | both | `plan/blockers` › X-04: reports that the merge would fail with ACCOUNT_MERGE_IMMUTABLE_SET, first among the blockers; `plan/edge-recorded` › X-04 (recorded, AC-E3-S5-3); `execute/edge-recorded` › X-04 (recorded); `execute/edge-partial` › X-04 (two tests) | `testnet/edge` › X-04: AUTH_IMMUTABLE_SET is reported first and nothing is submitted; a merge attempt fails with op_immutable_set | green | E3-S5, E3-S6 | |
| X-05 | Destination validation (missing, self, C, M, SEP-29) | both | `plan/order` › detects destination problems; `inspect/inspect` › rejects C, M and malformed addresses before any request; › accepts a muxed destination and inspects its base account; `execute/preflight` › re-checks the base account of a muxed destination (review finding R9); › re-reads the destination's SEP-29 marker ... (R10); `execute/executor` › does not submit a memo-less merge to a destination that became memo-required; `cli/review-e1-cli` › are exempt from SEP-29, like the SDK's own check | none | not covered (live) | No owner. Day-1 experiment 10 observed `AccountRequiresMemoError` and a merge with a memo on 2026-09-26 (not a test) | |
| X-06 | Destination trustline states | both | `plan/ladder` › checks the destination trustline's authorization and room; › keeps the SOW order for DUSTC but sends it to the destination with prefer-destination; `plan/route-resolution` › burns by default, keeps the destination as the fallback and says the issuer is gone (in main since 16c9e56) | none yet | planned (live) | Ladder agent: `testnet/ladder` | |
| X-07 | Offer types (sell, buy, passive, selling XLM) | testnet | `plan/order` › cancels offers with their own assets and price, amount 0 (sell offers) | `testnet/execute-close` cancels the messy fixture's two sell offers; `testnet/edge` › S-06 cancels a sell offer on a maintain-liabilities line | not covered (buy, passive and XLM-selling offers) | No owner. Day-1 experiment 2 deleted an offer created with `manageBuyOffer` using `manageSellOffer` amount 0 on 2026-09-26 (not a test) | |
| X-08 | Stale offer (filled between plan and execution) | testnet | `execute/classify` (the table: `op_offer_not_found` re-plans); `execute/recovery` › stops when the re-plan limit is reached (repeated `op_offer_not_found`) | none | not covered (live) | No owner | |
| X-09 | Incoming payment after the plan | both | `execute/executor` › aborts on drift by default and continues with the fresh plan when asked; `execute/replan` › flags a new data entry, a new offer and a larger balance; `cli/close-execute` › stops without submitting when the account changes after the plan was shown (exit 3) | none | not covered (live) | No owner | |
| X-10 | Dust below DEX resolution | testnet | `plan/ladder` › never lets destMin fall below one stroop; `plan/review-e1` › rounds the slippage up so destMin sits below a dust quote; `plan/route-resolution` › treats answers that all round to zero as no path, so the balance goes to its issuer (in main) | none yet | planned | Ladder agent: `testnet/ladder` | |
| X-11 | The account's own offers are the only liquidity | both | `plan/ladder` › does not trust a quote that may run through the account's own offer; `plan/properties` (B-24 invariant over 600 seeds) | none yet | planned (live) | Ladder agent: `testnet/ladder` | |
| X-12 | Operation-limit chunking and ordering invariants | unit (+ optional testnet) | `plan/plan` › splits 150 offer cancellations and keeps the merge last; `plan/properties` › hold for 600 seeded accounts, including partial and blocked ones | none (optional) | green | E1-S5 | |
| X-13 | Fee-bump fee math and surge | unit | `sponsor/sponsor` › wraps with bid x (ops + 1), signs only the outer envelope and records the bid; › caps the bid and refuses a cap below the network minimum; `config/fees` (four tests); `execute/recovery` › AC-E2-S3-3 (three tests); › does not rebuild while no ledger has closed past the old envelope's time bound | not needed | green | E2-S1, E2-S3. Dustin never replaces a queued envelope with a 10x bid (canonical decision 7) | |
| X-14 | 504 timeout and `tx_bad_seq` reconciliation | unit | `execute/recovery` › AC-E2-S3-1: finds a 504'd transaction by hash and never posts it twice; › after tx_bad_seq, finds an earlier envelope that applied after all instead of rebuilding; `execute/submit` › treats a 504 as pending and finds the transaction by hash without resubmitting; `execute/review-fixes` › never sends a 504'd envelope that applied twice while lookups answer 503 | not needed | green | E2-S3 | |
| X-15 | Testnet reset detection | unit | none | not needed | not covered | No owner. Nothing detects a reset: a 404 for the account reads as `ACCOUNT_MISSING` | |
| X-16 | Fully sponsored account with 0.0000000 XLM (bonus) | testnet | `plan/recovery` › attributes a sponsored account entry (2 reserves) and sponsored signers and offers; `inspect/reserve` › counts sponsoring and a sponsored account entry | none | not covered (live) | Optional (canonical decision 3: a `literal-zero` variant is optional) | |
| X-17 | Numeric hygiene | unit | `amounts` (four tests); `plan/properties` | not needed | green | E1 | |
| X-18 | Sponsored signer | testnet | `plan/recovery` › attributes a sponsored account entry (2 reserves) and sponsored signers and offers | none yet | planned | Later agent: `testnet/sponsored-unwind` | |
| X-19 | Rate limiting (429) | unit | `execute/recovery` › posts the same envelope again after a 429, with exponential pauses; › stops when Horizon keeps answering 429; `reader/horizon-json` › retries 429, 5xx and network errors, then gives up with HORIZON_UNAVAILABLE | not needed | green | E2-S3 | |
| B-01 | Baseline: the existing tool on the master fixture (0 spendable) | recording | none | none | human action | Builder: Demolisher recording on `messy-20260926T035942Z` (E1-S2, `evidence/baseline/README.md`) | |
| B-02 | Baseline: the existing tool on the master fixture plus 1 XLM | recording | none | none | human action | Builder | |
| B-03 | Dustin on the identical rebuilt fixtures | testnet | none | none yet | planned | Integrator, after B-01 and B-02 (E3-S7) | |

## Coverage counts

| Count | Rows |
|---|---|
| Rows with at least one offline test | 27 of 32 (all but X-03, X-15, B-01, B-02, B-03) |
| Rows with at least one live test (all or part of the row) | 12 of 32 (M-01, S-01, S-02, S-03, S-05, S-06, S-07, S-08, S-09, X-01, X-04, X-07) |
| Green: every level the row asks for passes | 15 (S-01, S-02, S-05, S-06, S-07, S-08, S-09, X-01, X-02, X-04, X-12, X-13, X-14, X-17, X-19) |
| Planned, with an owner | 8 (M-01 on the baseline fixture, S-03, S-04, X-06, X-10, X-11, X-18, B-03) |
| Not covered, no owner | 7 (X-03, X-05 live, X-07 buy/passive/XLM-selling, X-08 live, X-09 live, X-15, X-16 live) |
| Human action | 2 (B-01, B-02) |

15 + 8 + 7 + 2 = 32.

## Where the tests differ from the matrix text

These follow the canonical decisions in `docs/README.md` and the PRD's decisions after review, which override the matrix where they disagree.

- **Codes.** The code uses `THRESHOLD_UNMET` (matrix and Story 3.5: `RAISED_THRESHOLDS`), `AUTH_IMMUTABLE_SET` (Story 3.5: `AUTH_IMMUTABLE`) and `LIQUIDITY_POOL_SHARES` (architecture 5.3: `LP_SHARES_HELD`), as PRD section 7 lists them (decision D-2: the SDK keeps the names it was built with).
- **S-02, X-04: steps next to a blocker.** The matrix asks for no teardown steps while a merge blocker holds. The planner lists every safe cleanup step with the blocker (architecture 4.3), and the executor refuses to run any of them unless `allowPartial` (`--partial`) is set (canonical decision 4), so nothing is signed by default. The X-04 variant has no subentry, so its plan has no step at all.
- **S-08: plan status.** The planner marks held pool shares as a blocker, so the plan is `blocked`; PRD FR-08 expects `partial`. The test `plan/review-e1` › treats liquidity pool shares as a merge blocker, so the plan is blocked pins the current behaviour.
- **AC-E3-S6-3, the forced payment.** The planner never plans a payment it knows will fail, so no run submits one for the frozen FRZ. The payment is forced twice: as a negative probe outside any plan (`op_src_not_authorized`), and on the auth-revoke variant, whose trustline the issuer revokes after planning, so the executor's planned return fails with `op_src_not_authorized`, is recorded on the transaction, the step and the re-plan, and `allowPartial` runs the rest.
- **Fixture profiles.** Story 3.6 names the profiles `authreq`, `clawback`, `lp` and `multisig`, and PRD FR-21 a `--variant` flag. Canonical decision 3 defines two profiles, so the edge cases are variants of the one `edge` profile (`dustin fixture create --profile edge`), one account each.

## Live runs of `testnet/edge` on 2026-09-28

Both runs passed 13 of 13 tests (about 140 s each). The first run's hashes were not printed (minimal reporter, see above). The second run, on fixture `edge-20260928T100439Z-d5767b`, submitted:

| Row | Purpose | Ledger | Transaction |
|---|---|---|---|
| build | create-accounts (sponsor, not fee-bumped) | 4913260 | `972a762fb03a50534e608a245e2b069a758564e7cd891be3edee0113e6f5ecf1` |
| build | issuer-flags | 4913261 | `f616b3438340b82a0357027cba8418027934bcbe35153a7bdcc9b6eda25ce30b` |
| build | trustlines | 4913262 | `94ee7cf4b8d400bb9f8f0284d75ad45fe2ab02ccccfe5bc95c06d15c0ac0302d` |
| build | authorize | 4913263 | `10adfc93185323c9ca4290f2d2c6041f49bf649cefd7a5b92685c74d8edfbcc1` |
| build | dust-payments | 4913264 | `971fabad3cf50651c7277be1412c29213cb930dd564f520407b174ed6f616c52` |
| build | holder-state | 4913265 | `0870812cd4b15f083bbe848f4cf22251fe10b928215ee07ee25662031bae0f06` |
| build | restrict | 4913266 | `f17f61bd713989368e59d237b949ed5f5121314f894f10390dc5d65371e9220d` |
| S-02 | auth-frozen partial close (ILQX burned, ILQX and data removed) | 4913269 | `c38f2b2f3e17db218711b603df307f39bfd77ce48c72fa13a357c0bcb3a80de2` |
| S-02 | probe: pay the frozen FRZ to its issuer (`op_src_not_authorized`) | 4913270 | `b79bb641745b5d1beb4617e45e7c87270ab5b6e75791fd6ae6bc9557b099129d` |
| S-02 | probe: remove FRZ with its balance (`op_invalid_limit`) | 4913271 | `011216abe07b5c1d1da9af82ab131a16ff61e6fb174f04e031270bc1fc867b9b` |
| S-02 | the issuer revokes RVK after the plan | 4913272 | `07bf0d2e884b37c644691e20b3396f37eb44d1d536f4d543d0745ca2dc996863` |
| S-02 | auth-revoke close: the planned return fails (`op_src_not_authorized`) | 4913273 | `0b9d36295b5d9bf663166d5ee07a08f5978f6da81f03441fe4acf739542b58dc` |
| S-02 | auth-revoke re-plan with `allowPartial`: data entry removed | 4913274 | `99c73cd9b8b01c07f837ae9769c5ab709e4df7db92932a83885b0db7a27b4bf8` |
| S-05 | auth-authorized full close | 4913275 | `e004cee93c21d545140cbcf5625c118f8f1dd489bd82e5c458c91f9d555fa615` |
| S-06 | auth-maintain partial close: the offer cancelled | 4913276 | `7e78d5de9b6e4bb5169ae8f8b688a33dffe2e44c287997ea09ce1f602221a661` |
| S-07 | clawback full close | 4913277 | `8e68b472451408b961a20734f2b0dc6f1835162f6cbb68e967a373f76ca48df1` |
| S-07 | the issuer claws CLAW back after the plan (S-07b) | 4913278 | `f00c961cd836af9d301139113b0ad503efd4e51af4b800d4742d855e5d6e6f02` |
| S-07 | clawback-drift close: the planned return fails (`op_underfunded`) | 4913279 | `c4596f745e1824c06655d4f9793fefc056b1d28ee6508d34470f866e34e8ea79` |
| S-07 | clawback-drift re-plan: trustline removed and merged | 4913280 | `a137c99b461059371d9fe9e40d50bab96c59a62fd9a34b41c928f0469a22ccfa` |
| S-08 | probe: remove LPA while the pool share exists (`op_cannot_delete`) | 4913281 | `73ea619ff8542fc04c38d7fdfea18b797e62c1f160eb3451b966badcbabd16c1` |
| S-08 | pool-share partial close: data entry removed | 4913282 | `b203b7cad02bfb35aa89514d2374238736500c5ee23eff3b390da88fc15bdc0c` |
| S-09 | multisig partial close: data entry removed | 4913284 | `816ad91249c5217b83420cc54befe9338c9c5c876f543fc4b4852f5f865375c0` |
| X-01 | probe: merge while sponsoring a claimable balance (`op_is_sponsor`) | 4913285 | `f2af42a2ea9bc28aa160bad3d604384158ad85ce0839def9f6c153aa2625efea` |
| X-04 | probe: merge an `AUTH_IMMUTABLE` account (`op_immutable_set`) | 4913286 | `d834586024d7c360f347e2ee6f54dfd9ed95c07d3d63f9b1fde275386f33e084` |

Every transaction after `create-accounts` is a fee bump paid by the fixture's sponsor `GANXQBYVDD7FQ5TCCTL3RZ6FYTE2S4VYBMY5UJKFTECVS6EDAHHQCWZZ`. Explorer links (until the testnet reset of 2026-12-16): `https://stellar.expert/explorer/testnet/tx/<hash>`.

The offline vectors in `test/fixtures/horizon/edge/` come from an earlier build of the same recipe through the CLI (`dustin fixture create --profile edge`, fixture `edge-20260928T095236Z-432c80`, ledgers 4913116 to 4913122); its manifest lists those hashes.
