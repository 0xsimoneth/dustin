# Story 3.6: Edge-case test matrix

Status: done

## Story

As another team evaluating Dustin,
I want a test matrix I can run myself that covers the cases that break naive implementations,
so that I can inspect the close flow before adopting it.

## Acceptance Criteria

As written in `docs/epics-and-stories.md` (Story 3.6). AC-3 was rewritten on 2026-09-28 to the two proofs below, when the builder accepted them (decision D-8, PRD "Decisions after review").

1. AC-E3-S6-1: Then `npm test` runs every offline matrix case in under 60 s with no network, and `npm run test:testnet` runs the live cases against variant accounts it builds itself with fresh keys.
2. AC-E3-S6-2: Then each SOW-named case (illiquid leftover balance, sponsored trustline, sequence number too far, authorization-required trustline, clawback-enabled trustline, liquidity pool shares, raised multisig thresholds) has at least one live test and one offline test named after its matrix row.
   - **Met since the merge of E3-S3 and E3-S4 (2026-09-28).** Illiquid leftover balance (S-01), authorization-required (S-02, S-05, S-06), clawback-enabled (S-07), liquidity pool shares (S-08) and raised thresholds (S-09) have row-named tests at both levels from this story. The sponsored trustline (S-03) and the sequence guard (S-04) got theirs from E3-S3 and E3-S4: offline `test/unit/execute/sponsors-observed.test.ts` (S-03), `test/unit/plan/guard-boundary.test.ts` and `test/unit/execute/sequence-guard.test.ts` (S-04); live `test/testnet/sponsored-unwind.test.ts` and `test/testnet/sequence-guard.test.ts`. The whole live tier passed on the integrated code (commit 88fd05d, 2026-09-28 11:29 to 11:34 UTC: 10 files, 51 tests). Before that merge this criterion was five of seven.
3. AC-E3-S6-3 (as rewritten on 2026-09-28): Then the deauthorized authorization-required case asserts the plan is unclosable before any submission, and the payment to the issuer that the planner never plans is forced in two ways, each asserted to fail with `op_src_not_authorized` and to be reported: a negative probe outside any plan, and a trustline the issuer revokes after planning, after which `allowPartial` runs the rest. The original wording asked for the payment to be forced with `allowPartial`.
   - **Met; accepted by the builder on 2026-09-28 (decision D-8).** The planner never plans a payment it knows will fail: a trustline that is not authorized is unclosable before any rung is tried (day-1 experiment 13), so a run with `allowPartial` on the frozen account never submits that payment. The payment is forced in two ways instead. As a negative probe outside any plan, fee-bumped by the sponsor: `op_src_not_authorized`. On the `auth-revoke` variant, which is authorized when planned and revoked by its issuer right before the executor's first submission: the planned return fails with `op_src_not_authorized`, and the failure is recorded on the transaction, on the step and on the re-plan; the re-plan reports the asset unclosable (`TRUSTLINE_NOT_AUTHORIZED`), `allowPartial` runs the rest, and without `allowPartial` the run stops with `PLAN_NOT_CLOSABLE`.
4. AC-E3-S6-4: Then the clawback case asserts `is_clawback_enabled` is surfaced by the inspector and that the issuer-return route succeeds.
5. AC-E3-S6-5: Then `docs/test-matrix.md` maps each row to its test files and last result.

How each is met, and the test that proves it:

| AC | Behaviour | Tests |
|---|---|---|
| 1 | `npm test` is the offline tier: 65 files, 580 tests, about 6 s on 2026-09-28, with the network blocked (`test/setup/no-network.ts`); the edge rows run from the Horizon JSON recorded right after a live build (`test/fixtures/horizon/edge/`) and on the fake ledger loaded from it (`test/helpers/edge-ledger.ts`). `npm run test:testnet` with `DUSTIN_TESTNET=1` runs the live tier; `test/testnet/edge.test.ts` builds a fresh `edge` fixture per run from one Friendbot call, every account with new keys. | `test/unit/plan/edge-recorded.test.ts`, `test/unit/execute/edge-recorded.test.ts`, `test/unit/execute/edge-partial.test.ts`, `test/unit/plan/blockers.test.ts`, `test/unit/fixture/edge*.test.ts`; live `test/testnet/edge.test.ts` (13 of 13 passed twice on 2026-09-28) |
| 2 | See the index of SOW-named cases in `docs/test-matrix.md`. | row-named tests in the files above |
| 3 | The frozen FRZ is `TRUSTLINE_NOT_AUTHORIZED` in the plan, naming its issuer, before anything is submitted; without `allowPartial` nothing is posted and the account's sequence number is unchanged; with it, the ILQX burn, the ILQX removal and the data removal apply in one fee-bumped transaction, the merge is left out and the account keeps exactly one trustline, FRZ. The forced payment: see the deviation above. | Live: `test/testnet/edge.test.ts` "S-02 (with S-01 applied): the frozen FRZ is unclosable before any submission; ...", "S-02 negative probe (AC-E3-S6-3): a payment of the frozen FRZ to its issuer fails with op_src_not_authorized", "S-02 forced with allowPartial (AC-E3-S6-3): the trustline is revoked after planning, the planned return fails with op_src_not_authorized and is reported, and the rest runs". Offline: `test/unit/execute/edge-recorded.test.ts` "S-02 (recorded): ...", "S-02 negative probe (recorded): ...", "S-02 forced (AC-E3-S6-3, recorded): ...", "S-02 forced without allowPartial (recorded): ..."; `test/unit/plan/edge-recorded.test.ts` "S-02 (recorded): ..." |
| 4 | The CLAW trustline was created after its issuer set `AUTH_REVOCABLE` and `AUTH_CLAWBACK_ENABLED`, so Horizon shows `is_clawback_enabled: true`; the inspector surfaces it as `clawbackEnabled`, the plan warns that the issuer can change the balance before execution, and the return to the issuer, the removal and the merge apply in one fee-bumped transaction. S-07b: a clawback between planning and submission makes the return fail with `op_underfunded`; the executor re-plans (no drift) and closes. | Live: `test/testnet/edge.test.ts` "S-07 (AC-E3-S6-4): the inspector surfaces is_clawback_enabled, the planner warns, and the return to the issuer closes the account", "S-07b: the issuer claws the dust back after planning; ...". Offline: `test/unit/plan/edge-recorded.test.ts` "S-07 (recorded, AC-E3-S6-4): ..."; `test/unit/execute/edge-recorded.test.ts` "S-07 (recorded): ...", "S-07b (recorded): ..." |
| 5 | `docs/test-matrix.md`: all 32 rows (the documents say 31), each with its level, offline and live tests, status, owner and an empty "Last run" column for the integrator; how to run each tier; the index of SOW-named cases; the coverage counts (15 green, 8 planned, 7 not covered, 2 human action); the differences from the matrix text; every hash of the second live run. | n/a |

## Tasks / Subtasks

- [x] Task 1: the `edge` recipe as data (`src/fixture/edge.ts`): helpers, one account per variant, the ordered steps as a pure function of the public keys and the base reserve, each variant's expected plan
- [x] Task 2: the verifier (`src/fixture/edge-verify.ts`): per-variant checks over Horizon JSON, also used to poll after each step
- [x] Task 3: the builder (`src/fixture/edge-builder.ts`): Friendbot funds the fee sponsor, the sponsor creates everything, every other transaction is fee-bumped, Horizon is polled after each step, the manifest (public), the keys (separate) and the recorded Horizon JSON
- [x] Task 4: CLI `dustin fixture create --profile edge` and `dustin fixture verify` for edge manifests (`src/cli/commands/fixture.ts`); edge manifest types (`src/fixture/manifest.ts`); `fixtureId` takes the profile, `friendbot` is exported (`src/fixture/builder.ts`; the messy builder, steps and manifest are unchanged)
- [x] Task 5: first live build through the CLI; its recording committed as the offline vectors (`test/fixtures/horizon/edge/`)
- [x] Task 6: offline tests: recipe (`test/unit/fixture/edge.test.ts`), verifier and CLI (`test/unit/fixture/edge-verify.test.ts`), key handover (`test/unit/fixture/edge-builder.test.ts`), planner (`test/unit/plan/edge-recorded.test.ts`), executor (`test/unit/execute/edge-recorded.test.ts`)
- [x] Task 7: live tests (`test/testnet/edge.test.ts`), two green runs
- [x] Task 8: `docs/test-matrix.md`

### Closing review (2026-09-28)

Findings of the closing review (`docs/reviews/2026-09-28-e3-review.md`) that concern this story, each code fix with a test that failed first:

- CA-1 (`353c506`): the test matrix brought to the merged Epic 3 code; the "Last run" column filled by the integrator from the final run of both tiers (below).
- CA-5 (`d473913`, `bcc9310`): the SOW's week-3 unclosable exit on the `edge` fixture is committed as a CLI run (below).
- CA-15 (`89457af`): this record names FRZ as the deliberately illiquid asset of canonical decision 3 and says the guard cases run on bumped messy fixtures.
- CP-7 (`84b387d`): the remedy of a trustline that is not authorized offers a clawback only when the trustline is clawback-enabled, so the frozen FRZ's remedy asks the issuer to authorize it again.
- Fixture builder robustness, in `src/fixture/edge-builder.ts` and the messy builder: CP-8 (`5d25d86`, a failed Friendbot try asks Horizon whether the account was funded), CP-9 (`4c35276`, `eae40a5`, a Horizon failure after the build submitted keeps the manifest and `dustin fixture create` exits 5), CP-10 (`d2651f0`, the build reads through a Horizon that lags the ledger), CP-11 (`800a79f`, a settle id whose check did not run counts as open), CP-12 (`869dd14`, `onKeys` is awaited before Friendbot funds anything), CP-13 (`e46acb1`, `settleTimeoutMs` is validated), CP-14 (`a491ed1`, `fixture verify` validates every role, the network and the pool id of a manifest).

## Dev Notes

- Canonical decision 3: `messy` is the metric account; `edge` carries the frozen authorization-required trustline and ends `partial` with an unclosable reason. The auth-frozen variant is that account: zero spendable XLM, a frozen FRZ balance, illiquid ILQX dust (no market, live issuer: it is burned, S-01) and a data entry; its partial close is fee-sponsored and stops before the merge with the reason `TRUSTLINE_NOT_AUTHORIZED`. FRZ, frozen by its issuer and with no market, is the SOW's "deliberately illiquid asset that exits through the unclosable path with a stated reason" (canonical decision 3; matrix row S-02); the architecture's wording for it is "must exit through rung 4" (section 4.10).
- Deviation from architecture section 4.10 (recorded 2026-09-28): the edge profile has no `bumpSequence` variant. The sequence-guard cases run on messy fixtures bumped inside `test/testnet/sequence-guard.test.ts` (E3-S4), which keeps the edge build short and lets each guard case pick its own bump.
- One account per variant (edge-cases section 5.3, assumption A9): a frozen balance, a pool share, a raised threshold, a sponsorship or `AUTH_IMMUTABLE` each make an account unmergeable. Helpers are shared: a destination, an `AUTH_REQUIRED` + `AUTH_REVOCABLE` issuer (FRZ, MNT, AUTH, RVK), an `AUTH_REVOCABLE` + `AUTH_CLAWBACK_ENABLED` issuer (CLAW) and a plain issuer (ILQX, LPA, LPB). `AUTH_IMMUTABLE`, the claimable balance and the pool deposit exist only on the variant built for them; `test/unit/fixture/edge.test.ts` checks it.
- Zero spendable by construction: each variant is created with its final minimum balance, `(2 + subentries + numSponsoring) x base reserve` plus the XLM that leaves it (CAP-33, https://developers.stellar.org/docs/build/guides/transactions/sponsored-reserves), and every transaction it sources is fee-bumped, so no drain step is needed. The base reserve is read from the ledger.
- Protocol facts (https://developers.stellar.org/docs/tokens/control-asset-access): with `AUTH_REQUIRED` a trustline waits for the issuer's `SetTrustLineFlags`; `AUTH_REVOCABLE` lets the issuer revoke it, which "cancels the account's open orders", or reduce it to limited authorization, which "does not cancel the account's open orders"; `AUTHORIZED_TO_MAINTAIN_LIABILITIES` allows the holder to "maintain current orders, withdraw from a liquidity pool, or cancel current orders"; `AUTH_CLAWBACK_ENABLED` applies to trustlines established after it is set and "requires that revocable is also set". Observed live on 2026-09-28: the MNT offer stayed after the reduction and was cancelled by the S-06 partial close; Horizon showed `is_clawback_enabled: true` on both CLAW trustlines.
- `LiquidityPoolDeposit` into an empty pool deposits exactly the maximum amounts (https://developers.stellar.org/docs/learn/fundamentals/transactions/list-of-operations#liquidity-pool-deposit); the pool id is the SDK's `getLiquidityPoolId` for LPA/LPB at 30 bps, the same the fake ledger computes. Observed: 1.0000000 shares for 1 LPA and 1 LPB.
- Negative probes are fee-bumped by the fixture's sponsor, so the probed account pays nothing; each consumes one sequence number. Observed codes: `op_src_not_authorized` (payment of frozen FRZ), `op_invalid_limit` (removal of FRZ with its balance), `op_cannot_delete` (removal of LPA while the share trustline exists), `op_is_sponsor` and `op_immutable_set` (merges).
- Mid-run changes (S-07b, AC-E3-S6-3 forced): the live test hands `executeClose` a submitter that runs the issuer's transaction once, right before the first envelope is posted, after the executor planned and signed (edge case C-04). The offline twins change the fake ledger at the same moment. `ExecuteOptions.submitter` is internal until 0.1.0 (PRD section 7); tests only.
- Recording: the builder runs the inspector for every variant through a fetch that keeps each JSON answer, so the vectors are exactly what the planner reads. `DUSTIN_RECORD=1` on the live test re-records them; the second live run did and wrote the same 34 files, which were not kept (the committed vectors come from the CLI build). Every recorded file passes the seed scan.
- Vitest picks its `minimal` reporter in an AI agent shell and hides the console output of passing tests, so the first live run's hashes were not printed; the second ran with `--reporter=verbose`.
- The live test builds its fixture in memory and does not save the keys (like the messy live tests); `dustin fixture create --profile edge` saves them under `.fixture/`.

### References

- docs/epics-and-stories.md, Story 3.6; docs/prd.md FR-21 to FR-24, sections 9.2 to 9.4
- docs/edge-cases-and-test-matrix.md sections 4 and 5.3; docs/architecture.md section 4.10; docs/adr/ADR-0005-testing-strategy.md
- docs/README.md canonical decisions 3, 4, 11, 12

## Dev Agent Record

### Completion Notes List

- CLI build, 2026-09-28: `dustin fixture create --profile edge` built `edge-20260928T095236Z-432c80` in 7 transactions (ledgers 4913116 to 4913122; the first `0fec074b0455ea6a2e8f0e102b5131cf74f95d32778d7326864d449e6c9b77f0`), all 62 verification checks passed, and every variant planned exactly as its manifest expects. Its recording is `test/fixtures/horizon/edge/`.
- Live test runs, 2026-09-28: 13 of 13 passed twice (about 140 s each). The second, on `edge-20260928T100439Z-d5767b` (fee sponsor `GANXQBYVDD7FQ5TCCTL3RZ6FYTE2S4VYBMY5UJKFTECVS6EDAHHQCWZZ`), submitted 7 build transactions and 17 test transactions; every hash with its purpose is in `docs/test-matrix.md`.
- Offline tier: 65 files, 580 tests, about 6 s (58 files, 514 tests before Stories 3.5 and 3.6).
- Through the CLI, on the final Epic 3 code (2026-09-28 12:54 to 12:55 UTC): `node scripts/evidence-cli.mjs edge-frozen` built a fresh `edge` fixture, `edge-20260928T125416Z-933e2d`, whose 62 checks all passed, and recorded [`evidence/runs/20260928T125414Z-edge-frozen/`](../../evidence/runs/20260928T125414Z-edge-frozen/summary.md): the plan of the auth-frozen account is PARTIAL with `TRUSTLINE_NOT_AUTHORIZED` for 0.0000005 FRZ, naming the issuer and the remedy; `dustin close --execute --yes` exited 3 with the account's sequence number unchanged; with `--partial` it exited 4 after one fee-bumped cleanup, `8c12934d5a03eeee5224e0b06f67a8b00f74f576f461b928321ab476f2550c73` (ledger 4915308), which burned the illiquid ILQX and removed its trustline and the data entry; the receipt lists FRZ under "Not closed", and Horizon still shows the account with only the frozen FRZ trustline and 2.5 XLM.
- Final run of both tiers on the closing code (`60af60d`; integrator, 2026-09-28): offline 89 files, 864 tests in 5.7 s; live, the testnet CI job [run 36424696971](https://github.com/0xsimoneth/dustin/actions/runs/36424696971), 10 files, 51 tests in 321 s, `test/testnet/edge.test.ts` included. The matrix's "Last run" column records it row by row. Counts on that code: 27 of 32 rows with an offline test, 16 with a live test, 21 green, 1 planned (B-03), 8 not covered, 2 human action (B-01, B-02).

### File List

- `src/fixture/edge.ts`, `src/fixture/edge-verify.ts`, `src/fixture/edge-builder.ts` (new)
- `src/fixture/manifest.ts`, `src/fixture/builder.ts`, `src/cli/commands/fixture.ts` (modified)
- `test/fixtures/horizon/edge/` (34 files, new), `test/helpers/edge-ledger.ts` (new)
- `test/unit/fixture/edge.test.ts`, `test/unit/fixture/edge-verify.test.ts`, `test/unit/fixture/edge-builder.test.ts`, `test/unit/plan/edge-recorded.test.ts`, `test/unit/execute/edge-recorded.test.ts`, `test/testnet/edge.test.ts` (new)
- `docs/test-matrix.md`, `docs/stories/3-6-edge-case-test-matrix.md` (new)

## Change Log

- 2026-09-28: `edge` fixture profile, its recorded vectors, the edge rows offline and live, `docs/test-matrix.md`. Status: review (AC-2 waits for the S-03 and S-04 live tests of other stories; the deviation in AC-3 needs the builder's acceptance).
- 2026-09-28: closing review CA-1, CA-5, CA-15, CP-7 and CP-8 to CP-14 fixed; the unclosable exit on the `edge` fixture recorded through the CLI; the matrix's "Last run" column filled from the final run of both tiers.
- 2026-09-28: the builder accepted the AC-3 proofs (decision D-8) and AC-3 was rewritten to them. Status: done.
