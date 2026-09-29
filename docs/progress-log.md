# Progress log

One dated entry per working session: what was done, what is blocked, the next step.

## 2026-09-26 (sprint day 5, week 1)

### Day-1 experiments (docs/technical-spike.md section 8.4)

Script: `scripts/spike/day1.ts`. Raw results (public keys, hashes, Horizon result codes; no secrets): `docs/research/day1-experiments-2026-09-26.json`. Testnet, protocol 28, Horizon ledger 4874030 at the start of the run, fee sponsor `GD7Q65UF75MAHRK3F7LA6HFPZRQEOIR7LXIF2DZQAWWAPXFBM3MEEKDL`. Every account was a throwaway created for the run. Base fee bid: `fee_stats.fee_charged.p80` = 82,746 stroops per operation.

| # | Question | Observed | Transaction (outer hash) |
|---|---|---|---|
| 1 | Can an account with zero spendable XLM source a fee-bumped transaction whose inner fee is `"0"`? | Yes. Account at 3.0000000 XLM with a 3.0000000 minimum. An unbumped transaction from it was rejected with `tx_insufficient_balance` and did not consume its sequence number. The fee-bumped `manageData` delete with inner fee `"0"` succeeded; the account balance stayed 3.0000000. Horizon shows `fee_account` = sponsor, `inner_transaction.max_fee` = `"0"`, `max_fee` = 165,492 (2 x 82,746 bid) and `fee_charged` = 200. Inner fee `"100"` also succeeds with the balance unchanged. | `7fb410dbc1ac43e902e156ac14757d78fa9376ec0aa1498c5690e587c18e5c56` (control: `db6e7acbbefe41de7600481571020a9f8ab803f5fa01f9c2823b2186537d262d`) |
| 2 | Does `manageSellOffer(amount "0")` delete an offer created with `manageBuyOffer`? | Yes, using the offer record's own assets and `price_r` (the record stores it as selling XLM, buying DUST, `price_r` 2/1). | `4ab3b9b38c9521079606851b7c265379cfd7660156d93c3cbf6102be73aeef29` |
| 3 | Does the owner alone delete a sponsored trustline, with the reserve returning to the sponsor? | Yes. Reserve sponsor `num_sponsoring` 1 -> 0, owner `num_sponsored` 1 -> 0, reserve sponsor balance unchanged (no XLM moves). Effects: `trustline_removed`, `trustline_sponsorship_removed`. Adding the reserve sponsor's signature to the inner transaction is rejected: `tx_fee_bump_inner_failed` / inner `tx_bad_auth_extra`. | `400a437f699c8f5a8b8ab2aeb05cb34d3968c41acbb3c5e643e1448c4beb5673` |
| 4 | Open question 3: what happens to a payment to an issuer whose account was merged away? | The issuer merged while holders still had its asset. A payment of 0.0000005 ORPH to the merged issuer **succeeded and burned the balance** (holder balance 0). A zero-balance trustline to the merged issuer and the emptied trustline were both deleted. Creating a new trustline to the merged issuer fails with `op_no_issuer`. | merge `cae2746d199681fee1574edae1f952820fc721d9cfc6e643b11d081974914cf1`, burn `cbb400ba4d715ac58447e74b3be10ef4d8ca58ce2f477d60d5bda38f05a3f0c9`, delete `be2f5ef42531f154dc69ab9b9489c7b8f0226be475519c8fcdd7da376da9a5ba`, `op_no_issuer` `571db84a8c10b79628224c72999f56f730593e85c6f39e095da33a3e41ee0f91` |
| 5 | Sequence guard | Sequence bumped to `(4874033 + 20) << 32` = 20933898233970688. A merge with sequence ...689 in the next ledgers failed with `op_seq_num_too_far` and consumed the sequence number. Formula `unblocksAtLedger = (seqAtMerge >> 32) + 1` gave 4874054. The later merge (submitted at ledger 4874061) succeeded in ledger 4874062 and the account returned 404. The exact first valid ledger was not isolated in this run; the boundary is covered by unit tests and the E3-S4 live test. | fail `1d13837c133ce2fa2518a876c19cd6ae5b79fc54d26c9e453dfa155fbf5f8ebb`, success `a9273e95eadea1a56af9603feeaba825e7bcb7eb93fc91f668b85a8907b35560` |
| 6 | Does Horizon strict-send find a path for dust against a seeded bid? | Yes. 0.0000007 DUST against a bid at 1 XLM per DUST: one record, `destination_amount` 0.0000007, empty path. **The first query in the ledger that created the bid returned 0 records; the next, one second later, returned the path** (the first full run queried once and got nothing). An asset with no market returns 0 records. | bid setup in ledger 4874040 |
| 7 | Can the last `changeTrust "0"` and `accountMerge` share one transaction? | Yes. Account 404 afterwards; the destination was credited exactly the merged balance (3.0000007 XLM). | `d095ceb956bb10b91500fe4c0472296916e013042240e653bf047e3e526a0624` |
| 10 | SEP-29 on a fee-bumped merge | Without a memo the SDK throws `AccountRequiresMemoError` (operation index 0) before submitting; the account is untouched. With a text memo the merge succeeds. | `38b2a16d74c0b5d8e98e101989d7b5fa24844f75438caff78b6dd332ece7d80f` |
| 11 | Does Horizon keep the history of a merged account? | Yes. `GET /accounts/{id}/operations` returns 200 with the full history, `account_merge` last. | n/a |
| 12 | Base reserve and ledger cadence | `base_reserve_in_stroops` 5,000,000, `base_fee_in_stroops` 100, protocol 28; 32 ledgers in 160 s (5.0 s per ledger). | n/a |
| 13 | Deauthorized trustlines (`AUTH_REQUIRED` + `AUTH_REVOCABLE` + `AUTH_CLAWBACK_ENABLED` issuer) | Deauthorized line holding 0.0000005: payment to the issuer fails with `op_src_not_authorized`, `changeTrust "0"` fails with `op_invalid_limit`. Authorized-to-maintain-liabilities: payment fails with `op_src_not_authorized`. After the issuer's clawback, the deauthorized zero-balance line was deleted. | fail `a50947b27138d1cc9f0885b5ce5699d75c58f05386b30206c600b0099d26c6da`, delete `d324ca3f66dab12e14de56e2b69a9964a35452b6bd7ca0893f73a76081876edf` |
| 14 | Path payment with destination = source | `pathPaymentStrictSend` DUST -> XLM to the sending account itself plus `changeTrust "0"` in one transaction succeeded; 7 stroops of proceeds landed in the account. | `45bcddf5b0492f2e4f6e99b71bf89ac5bfffdddcccfe251cdd8b4e3c49f25aaa` |
| 15 | Can a fee bump be looked up by its inner hash? | Yes. `GET /transactions/{inner hash}` returns 200 with `fee_account`. | n/a |

Also observed:

- Horizon omits `is_clawback_enabled` when it is false and shows `true` when set (edge-cases U11 confirmed).
- SDK trap: in `@stellar/stellar-sdk` 17.1.0 `Transaction.hash()` and `FeeBumpTransaction.hash()` return a `Uint8Array` (`lib/esm/base/transaction_base.d.ts`), so `.toString("hex")` produces comma-separated decimals. Always hex-encode with `Buffer.from(tx.hash()).toString("hex")`.
- SDK 17.1.0 `TransactionBuilder` only rejects an undefined `fee`, and `buildFeeBumpTransaction` requires the bump base fee to be at least the inner per-operation fee and at least 100 stroops (`lib/esm/base/transaction_builder.js`), so inner fee `"0"` is valid. `changeTrust` turns a falsy numeric `0` limit into the maximum (`lib/esm/base/operations/change_trust.js`); the string `"0"` is required.
- Not run here: experiment 8 (headless Demolisher run) belongs to E1-S2; experiment 9 (the below-1-XLM co-sign refusal) was already probed on 2026-09-25.

Consequences for the ladder (to be applied in E2-S5 and E3-S2):

- Rung 2 (return to issuer) needs only an authorized holder trustline; the issuer account does not have to exist. `ISSUER_ACCOUNT_MISSING` is informational, not an unclosable reason.
- The only unclosable balances are trustlines that are not authorized or only authorized to maintain liabilities (plus pool shares, which are out of scope).
- In the default SOW order, rung 3 (destination) is reached only if rung 2 is refused for another reason, in practice a memo-required issuer without `--memo`. With `--prefer-destination` rung 3 is tried first.
- A strict-send quote taken in the same ledger as an offer change can be empty. The fixture builder polls until the path appears, and the plan records the ledger its quotes were taken at.

### Session summary (2026-09-26)

Done:

- Epic 0 (scaffold, lint, format, two test tiers, CI, testnet guard, licence) reviewed and done.
- Epic 1 done except E1-S2: fixture builder and live `messy` fixture `messy-20260926T035942Z`, account inspector, plan model and ordering engine, grouping and fees, dry-run guarantee, `dustin plan` and the dry-run `dustin close`, committed plan evidence (`evidence/plan/`).
- Epic 1 code review: 18 findings, all resolved except one accepted risk (`.env` is loaded for `dustin plan`, whose secrets are never read). The widened property test (600 seeds) found one more case: a raised medium threshold alone gave a blocked plan without a blocker; fixed. Empty pool-share trustlines are now removed (architecture section 4.4).
- E2-S1 (sponsor-paid fee-bump engine) and E2-S2 (execute a close plan) implemented; a live close of a fresh messy fixture passed on testnet (account 404, sponsor paid every fee, destination credited exactly the merged amount). Both are in review.
- CI is green on Node 22 and 24; all commits are pushed.
- The npm publish dry run of the 0.0.1 placeholder is prepared (`npm pack --dry-run`, `check:package`).

Traps recorded this session:

- SDK 17.1.0 `Keypair.sign()` returns a `Uint8Array`, like `Transaction.hash()`; hex-encode with `Buffer.from(...)`.
- `tx_fee_bump_inner_failed` means the inner transaction was included and failed only when `inner_transaction` is `tx_failed`; other inner codes (for example `tx_bad_auth_extra`, `tx_bad_seq`) were rejected at validation and consumed nothing (`src/execute/submit.ts`).

Blocked (human actions):

- `npm login` and `npm publish` of the 0.0.1 name placeholder with 2FA.
- E1-S2: record the Demolisher baseline run per `evidence/baseline/README.md`.
- Choose the video hosting; the chapter lead's written acknowledgement comes at the end.

Next: E2-S3 retry and recovery (unknown outcomes, ladder fallback, fee escalation, `tx_bad_seq`), E2-S4 `close --execute` with typed confirmation and a receipt, then E2-S6 live evidence and the Epic 2 review.

## 2026-09-27 (sprint day 6, week 1)

### Session summary (2026-09-26 to 2026-09-27)

Done:

- The SOW copy is redacted and the E0 to E2 review is recorded (706cd73).
- Epic 2 was built in three parallel branches on a shared contract (82b337a), merged in order and each checked in CI:
  - Executor hardening and E2-S3 (25fdcc1): retry, recovery and resume. Covers 504s, `tx_too_late`, `tx_bad_seq`, `tx_insufficient_fee`, 429s, re-planning on operation failures with fallback down the ladder, and the report kept on thrown errors.
  - Public API, CLI and E2-S4 (185f85c): `dustin close --execute` with a fresh plan, the typed confirmation of the destination's last four characters, `--yes`, `--partial`, `--memo`, `--json`, `--report`, exit codes 0 to 6 and the receipt.
  - Pool-share handling, test infrastructure and the evidence writer (321eea8).
- Review findings R1 to R3, R6, R7 and R9 to R18 are closed.
- E2-S6: two live closes on testnet, each of a fresh zero-spendable messy fixture with sponsor-paid fee bumps:
  - through the SDK: `evidence/runs/20260926T125350Z/` (5e1fda7);
  - through the CLI, with its transcript: `evidence/runs/20260927T200015Z-cli/` (ee001d5).

  The SOW week 2 expected output is met a week early. The builder's baseline fixture was not touched.
- A combined code review ran over the merged work, with four layers (Blind Hunter, two Edge Case Hunters, Acceptance Auditor) plus an independent executor review. Findings and dispositions are in `docs/reviews/2026-09-27-e2-integration-review.md`. Fixes are in 1e5c5af, aefba65, 3dabfc0 and 953fbd7; documentation corrections are in 8c890b9.
- The offline tier stands at 58 files and 508 tests. CI is green on Node 22 and 24 for every push.

Traps recorded this session:

- **No ledger header on 404s.** Testnet Horizon sends no `Latest-Ledger` header on a 404 (observed 2026-09-27). A lookup's 404 cannot be dated, so the executor uses the account's sequence number as the witness.
- **Scripted failures in offline tests.** A scripted 400 with inner `tx_failed` must be recorded on the fake ledger as included (`recordIncludedFaults` in `test/unit/execute/harness.ts`). Otherwise the executor reads it, correctly, as a refusal at validation.
- **Horizon's code spellings.** Horizon writes `op_offer_not_found`, `op_not_aut_maintain_liabilities` and `op_under_dest_min`. ADR-0006 and the architecture now match.

Blocked (human actions):

- **npm.** `npm login`, then `npm publish` of the 0.0.1 name placeholder with 2FA.
- **Baseline recording.** E1-S2: record the Demolisher baseline on `messy-20260926T035942Z`, per `evidence/baseline/README.md`.
- **Chapter lead.** Choose the video hosting, and get the chapter lead's written acknowledgement of the two-fixture reading.
- **History rewrite (R4, R5).** Decide whether to rewrite history.
- **Review decisions.** Settle the decisions listed in the new review:
  - SDK names against PRD section 7;
  - the CI seed-scan pattern;
  - the E2-S6 deviations;
  - zero pauses;
  - the over-budget exit code.
- **Testnet CI job.** Dispatch the manual testnet CI job once (E2-S6 task 6).

Next:
1. Re-review the second-round fixes of E2-S3 and E2-S4 (953fbd7, aefba65, 3dabfc0) and move both stories to done.
2. Check E2-S5 against the existing ladder and write its record.
3. Epic 3:
   - E3-S4: the sequence-guard wait (R8);
   - E3-S1 and E3-S2: ladder execution (settle AA-14 and BH-7);
   - E3-S5: the detection-only blockers;
   - E3-S6: the test matrix with the `edge` fixture;
   - E3-S7: the metric close of the baseline fixture, after the Demolisher recording.

## 2026-09-28 (sprint day 7, week 1)

### Session summary (2026-09-28)

Done:

- The builder's decisions of 2026-09-28 were applied in one commit before any parallel work (2e0d5cb; PRD "Decisions after review" D-2 to D-7): PRD section 7 follows the SDK as built, the CI seed scan uses lookarounds, the E2-S6 deviations are accepted, every pause is injected and at least 200 ms, sponsor and budget refusals exit 3, and the history rewrite is postponed.
- E2-S5: story record and its two missing AC-3 tests (16c9e56); done.
- E2-S3 and E2-S4: review round 3 over the second-round fixes found 37 findings, one major (a merge refused on the ledger still ended `closed` when another party removed the account); all fixed with failing-first tests (1e0cba9); both done.
- Epic 3 was built by parallel agents in their own worktrees, on disjoint files, and merged in order with every gate green after each merge:
  - E3-S1 and E3-S2 (df54ea7): the ladder live, with the sale through a market maker's bid, the burn, the transfer to the destination (`--prefer-destination`) and unclosable items with every rung ruled out and a remedy; BH-7 and AA-14 closed.
  - E3-S5 and E3-S6 (a59f7e9): the detection-only blockers with their remedies; the `edge` fixture profile (ten variants from one Friendbot call), its recorded vectors, the live edge tests and `docs/test-matrix.md`.
  - E3-S3 and E3-S4 (fe900e7): the report records each reserve sponsor's `num_sponsoring`, minimum balance and XLM balance before and after; the executor waits for the sequence guard within `maxWaitLedgers` (120 by default) and stops with `unblocksAtLedger` beyond it (review R8 closed).
  - E3-S7 (562d542): the metric close of fresh messy fixtures through the SDK and the CLI, with `evidence/README.md` checking SOW Appendix B row by row.
  - Documentation in three rounds (3556788, b6303b2, 7299895): the first write-up, the integration notes, the README to the documentation plan, and the PRD, architecture, UX and story records brought to the code.
- The closing review of the whole session (`c7be815..562d542`, five layers) found 64 findings, none major. Every code finding was fixed with a failing-first test (c53d437 planner and fixture, d0d711c executor, CLI and receipt, fdcd050 evidence tooling). Findings, dispositions, deferred items and the decisions left to the builder are in `docs/reviews/2026-09-28-e3-review.md`.
- Three more CLI runs on the final code (fa2755b): the sequence-guard wait (the merge applied in the unblocking ledger itself), the unclosable exit of the `edge` fixture's frozen trustline (exit 3, then 4 with `--partial`), and the partial-close receipt of a memo-required issuer.
- Tests: the offline tier has 89 files and 864 tests (5.7 s). The live tier, 10 files and 51 tests, passed locally at 562d542 (285 s) and in the manual testnet CI job at d0d711c (run 36424696971, 321 s), which closes E2-S6. CI passed on Node 22 and 24 for every push.
- Test matrix: 32 rows; 27 have an offline test and 16 a live test; 21 green, 1 planned (B-03), 8 not covered, 2 human action (B-01, B-02).
- Tracker: Epic 2 done; Epic 3 done except E3-S6, which waits for the builder's acceptance of its AC-3 deviation.

Traps recorded this session:

- **Vitest's reporter in an agent shell.** Vitest picks its `minimal` reporter when it detects an AI agent and hides the console output of passing tests, so the hashes a live test prints are lost; run the live tier with `--reporter=verbose`.
- **Node timers.** A `setTimeout` delay above 2^31 - 1 ms is replaced by 1 ms (https://nodejs.org/api/timers.html#settimeoutcallback-delay-args), so every pause is capped at `MAX_PAUSE_MS` (`src/config/pauses.ts`).
- **The sequence guard on the ledger.** A merge with sequence number s applies from ledger (s >> 32) + 1 and fails with `op_seq_num_too_far` one ledger earlier, consuming its sequence number; live, the waited merge applied in the unblocking ledger itself (4915293).
- **Dust and the path finder.** Horizon's strict-send path finder returns no record for dust below the order book's resolution, so the planner burns it; a sale forced by hand fails with `op_under_dest_min` (matrix X-10).
- **An own offer that sells XLM.** A fixture held at its minimum balance cannot carry an offer that sells XLM (its selling liabilities need XLM above the minimum), so matrix row X-11 is covered offline only.
- **Agent worktrees.** Inspect an agent's worktree with `git -C`; a `cd` into it from the main session moves the session's working directory there.

Blocked (human actions):

- **npm.** `npm login`, then `npm publish` of the 0.0.1 name placeholder with 2FA.
- **Baseline recording.** E1-S2: record the Demolisher baseline on `messy-20260926T035942Z` per `evidence/baseline/README.md` (matrix B-01, B-02); then Dustin closes the rebuilt baseline fixtures (B-03).
- **Video hosting** for the 60-second demo (E4-S6).
- **Chapter lead.** The written acknowledgement of the two-fixture reading.
- **History rewrite (R4, R5).** Postponed by decision D-7; still open.
- **Decisions** listed in the review: accept the E3-S6 AC-3 deviation; CA-11 and CA-18 (fix in week 4 or accept); third-party names in the prior-art citations.

Next: Epic 4, a week early: E4-S1 and E4-S2 (CLI output and error handling, with CA-11, CA-18, CL-1, AA-9, AA-10 and AA-13), E4-S3 (test evidence and reproducibility), E4-S4 (npm 0.1.0 prepared for the builder to publish; README and integration notes final), E4-S5 (the write-up final), E4-S6 (the demo script for the builder's recording), E4-S7 (the evidence package with every SOW 6.1 row).

## 2026-09-29 (sprint day 8, week 2)

### Session summary (2026-09-28 evening to 2026-09-29)

Epic 4 was done a week early, with the builder's structured brief and Claude as integrator.

Done:

- The builder's decisions were applied in one commit before any parallel work (20d4c03; PRD "Decisions after review" D-8 to D-13):
  - E3-S6 AC-3 accepted and rewritten; E3-S6 and Epic 3 done;
  - `slippageBps` keeps its 1% default;
  - CA-11 and CA-18 fixed in E4-S2 (the guard's timing out of the plan hash; a hidden prompt);
  - third-party work cited by project name and URL (canonical decision 15);
  - PRD section 6 and architecture 4.9 list only what is built.
  D-14 (64789be) records two more points of the brief: the write-up's R1 to R9 and the place of the rehearsal script.
- Wave 1, three agents in their own worktrees on disjoint files, merged in the order A, B, C with every gate green after each merge:
  - E4-S1 and E4-S2 (e8cdf16): `--json` machine mode (one document on standard output, NDJSON on standard error, never a question); SIGINT and SIGTERM with `ExecuteOptions.signal` and the stop code INTERRUPTED; the 404 recorded on a re-run; CA-11 per D-10; the hidden prompt per D-11; the whole exit-code table tested; `docs/plan-schema.json`, `docs/receipt-schema.json`, `docs/errors.md`, `--verbose`.
  - E4-S3 (ad3ed2f, ed0ab62): matrix rows X-03 (claimable balances naming the account), X-07 (buy, passive and XLM-selling offers), X-08 (an offer filled between plan and execution), X-11 live, X-15 (testnet reset detection) and X-16 (a fully sponsored 0 XLM account) covered; `evidence/tests/`; `npm run evidence:check`.
  - D4 documents (3598ed4): the final write-up, README, integration notes, CONTRIBUTING, the evidence package, the SOW appendices, the completion report draft and the demo rehearsal script.
- Release preparation (e865bec, f687930): CHANGELOG 0.1.0 and the version fields at 0.1.0. Nothing was published or tagged.
- Wave 2:
  - an independent pre-release review from a fresh public clone, following only the README: 20 findings, none blocking; the six setup and test commands took 96 s and the README's test section about 6.7 minutes;
  - the four-layer closing code review of the session (`code-review` with `review-edge-case-hunter`): 72 findings, one major (EX-1/BH-1: an envelope, even the merge, could be posted after Ctrl-C).
  Every code finding was fixed with a failing-first test by two fix agents (906257d, 86806dc); the documents were fixed by the documentation agent (9184fa6) and the integrator. CI checkouts no longer keep credentials, the offline tier also runs on Node 22.12.0, and `commander` is pinned exactly (11331df). Everything is in `docs/reviews/2026-09-29-e4-review.md`.
- Evidence on the 0.1.0 code:
  - a CLI metric close, `evidence/runs/20260929T111408Z-e4-cli/`: a fresh messy fixture closed in three sponsor-paid fee bumps, Horizon 404 afterwards;
  - the offline tier captured again: 122 files, 1212 tests;
  - the live tier in the testnet CI job: [run 36560464977](https://github.com/0xsimoneth/dustin/actions/runs/36560464977), 11 files, 58 tests, 342 s.
  CI passed on every push.
- Test matrix: 32 rows; 29 with an offline test and 20 with a live test; 27 green, 1 planned (B-03), 2 not covered (X-05 live, X-09 live), 2 human action (B-01, B-02).
- Tracker: E4-S2 and E4-S5 done; E4-S1 and E4-S3 in review (decisions for the builder); E4-S4, E4-S6 and E4-S7 in progress (the builder's actions).

Traps recorded this session:

- **An abort must be asked right before the POST.** Asking at the top of each planned transaction is not enough: the merge preflight, the signing and the ledger read in between are awaits a signal can land in (EX-1).
- **A cancelled pause must clear its timer.** A pause that resolves early on an abort but leaves its `setTimeout` running keeps the process alive, and a further Ctrl-C then kills it with 130 instead of the receipt's exit code (EX-6).
- **`process.exit` can drop queued pipe writes.** On macOS a 5 MB document was cut at 64 KB, so the forced exit waits for standard output and standard error to flush, at most 2 s.
- **Horizon lags behind the ledger.** A just-built fixture can be one ledger ahead of the Horizon instance that answers, so reset detection tolerates 120 ledgers and never suspects a reset while any manifest account exists (EP-1).
- **The API limit also stops subagents.** A fix agent stopped on a rate limit, not on its work; its commits were intact and it resumed where it stopped.

Blocked (human actions, in order):

1. The Demolisher baseline recording on `messy-20260926T035942Z` (B-01, B-02), then Dustin's close of the rebuilt baseline fixtures (B-03).
2. The 60-second video: recording and hosting, then its links in the README, `evidence/README.md` and the completion report (`docs/demo-video-script.md` is the rehearsal).
3. The chapter lead's written acknowledgement of the two-fixture reading.
4. The history rewrite (R4, R5), still postponed by D-7.
5. `npm login` with 2FA, then the publish of `stellar-dustin` 0.1.0 and the `v0.1.0` tag.
6. Sending `evidence/completion-report.md` to the chapter lead once its pending items are filled.

Also for the builder: the decisions in part 2 of the review (E4-S1's output width and asset form; E4-S3's rendered images; switching on private vulnerability reporting for SECURITY.md).

Next: the builder's actions above. Then E4-S1 and E4-S3 close on the builder's word, the video and baseline links are filled in, and Epic 4 is finished in the week-4 window or the buffer (deadline 2026-10-22).
