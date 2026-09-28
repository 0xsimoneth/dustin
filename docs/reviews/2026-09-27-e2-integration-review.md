# Review of the Epic 2 integration (2026-09-27)

Review of the work merged to `main` on 2026-09-26 and 2026-09-27, git range `706cd73..ee001d5`:

- a shared-contract commit;
- three branches built in parallel and merged in order A, B, C:
  - executor hardening and E2-S3;
  - public API, CLI and E2-S4;
  - test infrastructure, pool-share planning and the evidence writer;
- the integration fixes;
- two live evidence closes (E2-S6);
- the fixes made in answer to this review.

It follows `docs/reviews/2026-09-26-e0-e2-review.md` (findings R1 to R19).

## Method

The `code-review` workflow ran over the combined diff, 89 files, in four layers:

- a Blind Hunter that saw the diff only;
- two Edge Case Hunters that used the `review-edge-case-hunter` skill with read access to the repository, one over the executor and one over the CLI, renderer, planner and evidence code;
- an Acceptance Auditor that checked the diff against:
  - the canonical decisions in `docs/README.md`;
  - findings R1 to R19;
  - stories E2-S3 to E2-S6;
  - PRD FR-11 to FR-20 and NFR-02 to NFR-04;
  - the SOW.

A fifth, independent adversarial review of the executor ran beside them.

Most findings were confirmed with throwaway probes in a scratch copy of the repository. Protocol facts were checked through the Raven MCP (developers.stellar.org), the stellar-horizon result-code mapping and the stellar-core source.

After the fixes, the offline tier passes with 58 files and 508 tests. CI is green on Node 22 and 24 for every push. Both live closes ended with Horizon answering 404 for the closed account.

## Verdict

The Epic 2 surface the SOW needs is in place and evidenced:
- `executeClose()` with retry, recovery and resume (E2-S3);
- `dustin close --execute` with the typed confirmation and a receipt (E2-S4);
- a zero-spendable account closed on testnet with sponsor-paid fee bumps, both through the SDK and through the CLI (E2-S6).

The week 2 expected output of the SOW ("a zero-XLM account is closed end to end on testnet with sponsored fees, with verifiable transaction hashes and the account gone from the explorer") is met, a week early.

The review found real defects in the recovery paths, most of them reachable only when Horizon misbehaves (a 504 whose lookups fail, a lagging replica, a validation-time `tx_failed`), plus CLI edge cases. All confirmed defects were fixed with a test that failed first, except those listed under "Deferred" and "Decisions for the builder".

## Status of findings R1 to R19

| ID | Status | Where |
|---|---|---|
| R1 report survives thrown errors | closed | c161ad5; hardened in 03f472e, 40d8c50 |
| R2 over-budget plan refused before signing | closed | 0869136 (executor), 0ce4ebf (budget line in the plan), bbde119 (re-plans) |
| R3 executor exported, `close --execute` wired | closed | 3c6c3e8, d9bb80c |
| R4 personal data in the SOW copy | redacted in the tree (706cd73); history still holds it | builder decision below |
| R5 personal e-mail in the first commit's author | open | builder decision below |
| R6 testnet check on every entry point | closed | afa0e8a (CLI), 0869136 (executor submit endpoint) |
| R7 `.env` only in `close --execute`, only the two secrets | closed | 3130434 |
| R8 plan text promises a sequence-guard wait | open | E3-S4 |
| R9, R10 merge preflight: muxed destination, SEP-29 | closed | 9246dd6 |
| R11 refused POSTs, decoded polled failures | closed | a2cc215; three-state lookups 57fcb41; validation-time `tx_failed` f5dc4e2 |
| R12 re-plan reproduces the plan's options | closed | 9747ff8 |
| R13 unknown pool on a 404 | closed | d7bb121 |
| R14 pool-share removal coverage | closed | 4210820 (fake ledger), 3901c89 (live probe) |
| R15 tracker | closed | 133f4ef (E1); E2 rows reconciled in this session's tracker update |
| R16 live close evidence | closed | e42b6e2 (writer), 5e1fda7 and ee001d5 (evidence) |
| R17 repository seed scan in CI | closed | 9e1894d |
| R18 fee override clamped in the estimate | closed | 4f7cc31 |
| R19 local configuration detail in HANDOFF | done | 706cd73 |

## Findings of this review

Sources:
- IR: independent executor review.
- EX: Edge Case Hunter, executor.
- CL: Edge Case Hunter, CLI, renderer, planner and evidence.
- BH: Blind Hunter.
- AA: Acceptance Auditor.

Duplicates are merged under the first ID.

### Fixed in this session

**Executor (merged in 953fbd7; each fix has a test that failed first):**

| ID | Finding | Fix |
|---|---|---|
| IR-1 (major) | A lookup error (429, 5xx, timeout) after a 504 read as "not found"; the same operations were rebuilt at the next sequence number and the sponsor paid again | 57fcb41: lookups are found, missing or error; an error never allows a rebuild |
| IR-2 (major) | A merge that applied unseen ended `failed`/`stop` | 2084394 |
| IR-3 | A throwing `onReport`/`onEvent` observer lost an applied merge | 03f472e |
| IR-4 | A failed final check overwrote the real stop reason | 40d8c50 |
| IR-5 | A re-plan was not checked against the remaining budget | bbde119 |
| IR-6 | Waits judged by the local clock | eb6d3db |
| IR-7 | A re-run after `OUTCOME_UNKNOWN` knew nothing of the pending envelope | 387335b: the stop carries its hash and `maxTime` |
| IR-8 | Fake ledger's `tx_no_account` string | 2ddf6c3: `tx_no_source_account` |
| EX-1 | A second `tx_bad_seq` stopped without looking up an applied envelope | 2f424eb |
| EX-2 | A merge rebuilt after `tx_bad_seq` skipped the preflight | c65eeb4 |
| EX-3, EX-4 | An account read lagging the run's own transactions | 280a0c4: read again, bounded |
| EX-5, BH-15 | A 404 from a Horizon instance behind the one that answered the ledger time | 65af78a: the account's sequence number is the witness, since testnet Horizon sends no `Latest-Ledger` header on a 404 |
| EX-6, BH-10 | A 400 with inner `tx_failed` assumed included | 417cd96, f5dc4e2: the ledger decides, both ways |
| EX-7 | A refused bid still counted after a rebuild at a new sequence number | e958ebb |
| EX-8 | A re-plan that finds the account gone reported `partial` | 530aa7f |
| EX-9 | Reserves returned to sponsors taken from the first plan only | 98e238e |
| EX-11 | NaN or negative execute options: unbounded rebuild loop | 7a5b184 |
| BH-1 (major) | Copies published during a run said `aborted` | 2032559: new status `running` on copies |
| BH-3 | An unknown envelope was always rendered "can never apply" | c58decb (`mayStillApply`), receipt in 953fbd7 |
| BH-11 | The preflight passed a failed guard without an unblock ledger | 2ff749d |
| BH-16 | The sponsor's budget update spanned an await | 958485e |
| AA-4 | A step that fails twice was not reported as a blocker (AC-E2-S3-4) | 3acb031 |
| AA-5 | Story 2-3 reworded three ACs without marking the deviations | 4a216ce |

**CLI, renderer and evidence:**

| ID | Finding | Fix |
|---|---|---|
| AA-1 | A re-run with the same `--report` path replaced the earlier file and its hashes | 1e5c5af: kept under a timestamped name |
| AA-3, AA-6, AA-7 | README Status, story 2-4 and the README `--base-fee` row stale after the merge | 1e5c5af |
| AA-8, BH-6 | The confirmation named the first bid as the fee ceiling | 1e5c5af |
| CL-2, BH-12 | A closed stdout pipe (EPIPE) crashed a close mid-run | aefba65 |
| CL-3, BH-8 | An interruption before any submission exited 5 | aefba65: exits 1 |
| CL-4, BH-9 | An executor over-budget refusal exited 3, the CLI's own check 2 | aefba65: both 2 |
| CL-5, BH-4 | "Report written" printed when the writes failed | aefba65 |
| CL-6 | `--report ""` silently skipped | aefba65 |
| CL-7 | The memo was shown nowhere before the confirmation | aefba65 |
| CL-8 | The question was asked with stderr redirected to a log | aefba65 |
| CL-9 | A `.env` with a byte-order mark hid its first key | aefba65 |
| CL-10 | The plan suggested `--sponsor`, which `close` did not accept | aefba65 |
| CL-11 | A failed run whose merge applied read "stopped before the account was closed" | aefba65 |
| CL-13 | The evidence writer did not forbid raw seed forms | aefba65 |
| CL-14 | Evidence was written only after every assertion passed | aefba65 |
| BH-2 | A drift found after submissions printed "nothing was submitted" | 3dabfc0 |
| BH-5 | Predictable report temporary names followed symlinks; `--report .env` was accepted | 3dabfc0 |
| BH-13 | `--execute --json` refusals printed nothing on stdout | 3dabfc0 |
| BH-17 | The README quick start typed secrets into the shell history | 3dabfc0 |
| AA-2 | E2-S6 had no story record and no CLI transcript | ee001d5 (CLI run), `docs/stories/2-6-live-simple-close.md` |

**Documentation:** 8c890b9 corrected Horizon's spelling of three result codes in ADR-0006 and architecture section 4.7 (`op_offer_not_found`, `op_not_aut_maintain_liabilities`, `op_under_dest_min`) and recorded how the planner resolves an unknown pool.

### Kept by decision

- EX-10: `closed` means the merge applied. A verified close is `closed` with `verification.accountExists === false`, and the CLI exits 0 only then. This is documented in `CloseStatus` and story 2-3.

### Deferred

| ID | Finding | Target |
|---|---|---|
| CL-1 | Ctrl-C or SIGTERM during execution exits 130 without a receipt. Every hash is printed as it is submitted and published before its POST, so `--report` keeps it | E4-S2 |
| AA-9 | The persisted report has no per-transaction operation summary and no account or destination URL (the printed receipt has both) | E4-S1 |
| AA-10 | `--json` prints human-readable progress on stderr instead of NDJSON events, and does not make the run non-interactive (PRD FR-19, ux-design 2.8) | E4-S1 |
| AA-13 | A CLI re-run after a completed close exits 3 (`ACCOUNT_MISSING` blocker) and records no 404; canonical decision 5 allows 3, PRD FR-17 wants the 404 | E4-S2 |
| BH-7 | Confirmed amounts are not enforced on the fresh plan. `planHash` leaves out quotes and `destMin`, so a worse quote while the prompt waits lowers the merged amount without a drift | E3-S1: compare `xlmToDestination` with the confirmed plan |
| AA-14 | Path-payment proceeds go to the closing account (architecture 4.4, both evidence runs), while AC-E3-S1-1 says straight to the destination | E3-S1: settle the document conflict |
| R8 | The sequence-guard wait is not implemented, though the plan text announces it | E3-S4 |
| E2-S5 | Route resolution exists since E1-S4, but E2-S5 has no story record and its ACs are unverified | next session |
| EX-3, EX-4, EX-5 | The lagging-replica protections rest on reasoning about Horizon replicas that is not verified on the SDF testnet | watch in live runs |

### Decisions for the builder

1. **History rewrite for R4 and R5.** Still open from the previous review: `git filter-repo` plus a force push. Every hash changes, including those cited in this file and in `evidence/plan/`.
2. **SDK names versus PRD section 7 (AA-11).** The code has:
   - `verifyClosed(account, options)` returning `{accountExists, horizonStatus, checkedAt, ledger, accountUrl}`;
   - `maxAttemptsPerTransaction` and `timeoutSeconds`;
   - `tx:*` events;
   - no `fallback` step status and no `resume` option.
   
   Either rename these to PRD section 7 or amend it, before the 0.1.0 publish freezes the API.
3. **CI seed-scan pattern (CL-12, BH-14).** The specified `git grep -E 'S[A-Z2-7]{55}'` also matches inside about a third of muxed `M...` addresses and inside long base32 runs, so a legitimate muxed-address fixture would fail CI. No tracked file matches today. The alternative is the standalone rule the redactor uses, `git grep -P '(?<![A-Z2-7])S[A-Z2-7]{55}(?![A-Z2-7])'`.
4. **E2-S6 deviations.** Accept them, or ask for the `simple` profile and `simple-close.test.ts`:
   - two messy fixtures closed instead of a `simple` profile;
   - `evidence/runs/` instead of `evidence/closes/`;
   - `execute-close.test.ts` instead of `simple-close.test.ts`.
5. **Zero pauses.** `pollIntervalMs`, `backoffMs` and similar options accept 0. The tests rely on that, but a real caller passing 0 polls Horizon without a pause. Choose between a floor and documentation.
6. **Exit code of an over-budget refusal.** It is 2, chosen for consistency with `SPONSOR_UNDERFUNDED`; canonical decision 5 names neither 2 nor 3 for it.

### Builder decisions of 2026-09-28

The builder settled the six decisions above; the PRD records them as D-2 to D-7 under "Decisions after review".

1. History rewrite (R4, R5): postponed. The rest of the work goes on without it; it stays on the list of human actions.
2. SDK names (AA-11): the code's names are kept and PRD section 7 was rewritten to match them. The `resume` option and the `fallback` step status are removed from the PRD: running a close again is how it resumes, and the rung a disposal used is on its step outcome.
3. CI seed scan (CL-12, BH-14): `.github/workflows/ci.yml` now runs `git grep -P '(?<![A-Z2-7])S[A-Z2-7]{55}(?![A-Z2-7])'`. A probe in a scratch repository confirmed the difference: the old pattern flagged a muxed address that contains a seed-shaped run, the new one flags only the standalone seed.
4. E2-S6 deviations: accepted. `evidence/runs/` and `test/testnet/execute-close.test.ts` stay; the story record, Story 2.6 in the epics and the PRD (T-18, week 2, section 12) say so.
5. Zero pauses: a floor. Pauses between requests to Horizon (`pollIntervalMs`, `backoffMs`, `verifyClosed`'s `intervalMs`, the read client's retry backoff, `submitAndConfirm`'s poll) are at least 200 ms; 0 is refused with `CONFIG_INVALID` before anything is read or signed (`src/config/pauses.ts`). The pause function is injected (`sleep`, a timer by default), and the tests inject one that returns at once (`test/helpers/no-sleep.ts`) instead of passing 0.
6. Exit code of an over-budget refusal: 3, and the same for `SPONSOR_UNDERFUNDED`. Canonical decision 5 now reads "3 = nothing executed: no confirmation, blockers without `--partial`, or a sponsor or budget precondition failed"; `src/cli/exit-codes.ts`, its tests and the README follow. This supersedes the "both 2" of CL-4 and BH-9 above.

## Evidence

- `evidence/runs/20260926T125350Z/`: SDK close of a fresh zero-spendable messy fixture.
  - 3 fee-bumped transactions in ledgers 4880726 to 4880728.
  - The destination was credited exactly 4.0000007 XLM.
  - The reserve sponsor's `num_sponsoring` went from 1 to 0.
  - Horizon answers 404 for the account.
- `evidence/runs/20260927T200015Z-cli/`: the same kind of close through `dustin close --execute --yes --report`, with the CLI transcript.
  - Ledgers 4903138 to 4903140, exit code 0.
  - Horizon answers 404 for the account.
- Live pool-share probe (R14): negative control `b5bfced51cbc17494d951ee06ab86081c2a38695f6dd4d623c7505fdc1b39de8` (`op_cannot_delete`), close `12051ff5d9be9f51dff8c374532e206e4718e350a237faa1885f64792835c3c0`; vectors in `test/fixtures/horizon/pool-share/`.
- In all 6 transactions of the two closes, Horizon shows the sponsor as `fee_account`, the closed account as `source_account` and inner `max_fee` 0.

## Sources

- stellar-horizon result-code mapping: https://github.com/stellar/stellar-horizon/blob/main/internal/codes/main.go
- Horizon result codes, manage sell offer: https://developers.stellar.org/docs/data/apis/horizon/api-reference/errors/result-codes/operation-specific/manage-sell-offer
- CAP-15 fee bumps: https://github.com/stellar/stellar-protocol/blob/master/core/cap-0015.md
- CAP-38 liquidity pools: https://github.com/stellar/stellar-protocol/blob/master/core/cap-0038.md
- SEP-29: https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0029.md
- stellar-core `TransactionFrame.cpp`, `ChangeTrustOpFrame.cpp`: https://github.com/stellar/stellar-core/tree/master/src/transactions
