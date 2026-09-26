# Story 1.1: Build the messy fixture account on testnet

Status: done

## Story

As the builder,
I want one re-runnable command that constructs the messy fixture account exactly as the SOW describes it, and one that proves it meets the success metric,
so that the planner, the baseline recording, the test matrix and the live close all run against the same reproducible account.

## Acceptance Criteria

1. Given a network connection to testnet, when `dustin fixture create --profile messy` runs, then a new fixture account exists whose Horizon record shows 4 trustlines that all hold a non-zero balance (3 reserved by the account, 1 sponsored by a separate reserve sponsor), 2 open offers, 1 data entry, `subentry_count` 7 and `num_sponsored` 1.
2. Then the fixture's XLM balance equals its minimum balance to the stroop (4.0000000 XLM at a 0.5 XLM base reserve), so spendable XLM is 0, and an unbumped transaction from the fixture is rejected with `tx_insufficient_balance` (proof recorded in the manifest).
3. Then a public manifest is written (public keys, assets, offer ids, data entry, expected values, construction transaction hashes, explorer links, recipe hash) and the secret keys are written to a separate file under the gitignored `.fixture/` directory with mode 0600; no secret appears in the manifest, in the output or in any committed file.
4. Then every fixture transaction that the fixture account sources is fee-bumped by the fee sponsor with inner fee 0, and the reserve sponsor is a different account from the fee sponsor.
5. Then the fixture exercises every disposal rung the default ladder needs for a full close: DUSTA has a market (a market maker's bid) and a strict-send path to XLM is observable on Horizon before the command finishes; DUSTB has no market and a live issuer; DUSTC has no market and the destination holds an authorized trustline for it; SPTA is the sponsored trustline. The fixture's own offers never cross the market maker's bid and never sell XLM.
6. Given a manifest, when `dustin fixture verify <manifest>` runs, then it prints PASS or FAIL with the Horizon values for each SOW Appendix B precondition (zero spendable XLM; at least 3 trustlines with non-zero balances; at least 1 open offer; at least 1 data entry) and for the fixture invariants (sponsored trustline and its sponsor, `subentry_count`, `num_sponsored`, no pool shares, `num_sponsoring` 0, `AUTH_IMMUTABLE` not set, destination exists), optionally writes a JSON snapshot, and exits 0 when everything passes and 3 otherwise.
7. Given a snapshot whose balance is one stroop above or below the minimum, the spendable check fails (unit test on recorded Horizon JSON).
8. Running `dustin fixture create --profile messy` again builds a new, independent fixture with fresh keys and an identical inventory shape, so the fixture can be rebuilt after a testnet reset.

## Tasks / Subtasks

- [x] Task 1: amounts and reserve arithmetic in BigInt stroops (AC: 2, 7)
  - [x] `src/amounts.ts`: parse and format 7-decimal amounts as BigInt stroops, no JS numbers
  - [x] `src/inspect/reserve.ts`: minimum balance and spendable balance from a Horizon account record and the base reserve
- [x] Task 2: fee bid policy (AC: 4)
  - [x] `src/config/fees.ts`: base fee from `fee_stats` (max of last ledger base fee and `fee_charged.p80`), floor 100, per-operation cap
- [x] Task 3: fee-bump wrapping (AC: 4)
  - [x] `src/sponsor/fee-bump.ts`: wrap a signed inner transaction in a fee bump signed by the sponsor; hex hashes
- [x] Task 4: the messy recipe as data (AC: 1, 4, 5)
  - [x] `src/fixture/messy.ts`: accounts, assets, amounts, offers and the ordered construction steps as a pure function of public keys
- [x] Task 5: the builder (AC: 1-5, 8)
  - [x] `src/fixture/builder.ts`: runs the steps on testnet, drains to the exact minimum with a fee-bumped payment, waits for the DUSTA path, records the unbumped-rejection proof, writes the manifest and the keys file
- [x] Task 6: the verifier (AC: 6, 7)
  - [x] `src/fixture/verify.ts`: pure checks over Horizon JSON plus a loader
- [x] Task 7: CLI (AC: 3, 6)
  - [x] `dustin fixture create --profile messy [--dir <path>] [--out <manifest>] [--json]` (keys always go to `<dir>/<id>/keys.json`) and `dustin fixture verify <manifest> [--snapshot <file>] [--json]`
- [x] Task 8: tests
  - [x] unit: amounts, reserve arithmetic, fee policy, recipe invariants, verify checks on recorded JSON including the one-stroop cases
  - [x] testnet: build a messy fixture and verify it

## Dev Notes

- Canonical decision 3 (docs/README.md): `messy` holds 4 trustlines with dust (3 self-reserved, 1 sponsored by a separate reserve sponsor), 2 open offers, 1 data entry, balance exactly at the minimum (4.0 XLM), every balance disposable, closed fully. The `edge` profile (frozen trustline) is a separate story in Epic 3.
- Recipe: docs/edge-cases-and-test-matrix.md section 5.2, with one correction. Step 7 there sells DUSTA at price 1 while the market maker bids 1 XLM per DUSTA; a sell limit at or below the best bid is marketable and fills immediately (https://developers.stellar.org/docs/learn/fundamentals/liquidity-on-stellar-sdex-liquidity-pools#orders), so the fixture's DUSTA offer is priced far above the bid.
- Day-1 experiments (docs/progress-log.md): inner fee `"0"` works for a zero-spendable source; the owner alone removes a sponsored trustline; a strict-send quote can be empty in the ledger that created the bid, so the builder polls; `Transaction.hash()` returns a `Uint8Array` in SDK 17.1.0.
- Minimum balance: `(2 + subentry_count + num_sponsoring - num_sponsored) x base_reserve`, spendable = balance - minimum - native selling liabilities (CAP-33, https://developers.stellar.org/docs/build/guides/transactions/sponsored-reserves). The base reserve is read from the latest ledger, not hard-coded.
- Exit code 3 for a failing verify follows the PRD command table (docs/prd.md section 6); decision 5 does not cover `fixture verify`.
- Architecture section 4.10 places the fixture builder in `src/fixture/`; it is a write-zone module and is never imported by `src/inspect` or `src/plan`.

### References

- docs/epics-and-stories.md, Story 1.1
- docs/prd.md FR-21, FR-22
- docs/edge-cases-and-test-matrix.md section 5
- docs/README.md canonical decision 3

## Dev Agent Record

### Agent Model Used

dev-story workflow (AI developer agent)

### Implementation Plan

- The recipe is data (`MESSY`) plus a pure step builder (`messySteps(roles)`), so its invariants are unit-tested without the network: 4 trustlines (1 sponsored), 2 offers, 1 data entry, no offer sells XLM, the fixture's DUSTA ask (100 XLM) sits far above the market maker's bid (1 XLM).
- The builder funds one fee sponsor from Friendbot and creates every other account from it (one Friendbot call per build). Every transaction sourced by another account is fee-bumped by the sponsor with inner fee `"0"`; the reserve sponsor is a separate account.
- The drain is computed from live Horizon values in BigInt stroops and fee-bumped, so the fixture lands exactly on its minimum; the builder then polls Horizon's strict-send path finder for DUSTA (day-1 experiment 6) and records an unbumped probe rejected with `tx_insufficient_balance`.
- Output: `.fixture/<id>/manifest.json` (public), `.fixture/<id>/keys.json` (mode 0600, created with `wx`), `.fixture/<id>/horizon/*.json` (raw Horizon responses). The recorded JSON of the first live fixture is committed as offline test vectors in `test/fixtures/horizon/messy/`.
- `src/reader/horizon-json.ts` is the read-only Horizon client (GET only, 404 as `null`, retries on network errors, 429 and 5xx) that the inspector in E1-S3 will build on.

### Debug Log References

- Red observed for amounts, reserve, fees, recipe and verify tests (missing modules) before implementation. The Horizon JSON client tests were written together with the client and passed on their first run, so their red phase was not observed separately.
- `as const` combined with `satisfies MessyAsset[]` did not keep the asset tuple, so index destructuring failed `noUncheckedIndexedAccess`; the step builder now filters the asset list by role instead.

### Completion Notes List

- Live fixture built with the CLI on 2026-09-26: `messy-20260926T035942Z`, account `GAZF3X7YYCI7PHZYZDQOGPLVN2RVD37YIQG7YEY6QJW6IK224Y4R3MBK`, destination `GBQGFM635UIV2BTCTYSMKKJBESY47VXZLCIPGKW3GZJSSY6B45U2DH2C`, fee sponsor `GBISNFQ4KAM62Z22MGKULQ7PI6H3RVMMWJZTWU6NP2DAIYAVN7XYQN4K`, reserve sponsor `GAFW2SI3HWF354G43KDJP74TU2OSNFXMDN7OTYXAGTW3MNCRJLUKGGLE`; offers 826680 and 826681; drain transaction `a4d48c9286440d03a16a75d914e9f4013b937df9a1a41a68b6e5145808c7e141`. All 12 checks passed.
- AC1-AC5: shown by that build (balance 4.0000000 = minimum, spendable 0; 4 trustlines with dust; SPTA sponsored by the reserve sponsor; 2 offers; 1 data entry; DUSTA path 0.0000007 -> 0.0000007 XLM; unbumped probe `tx_insufficient_balance` with the sequence unchanged; keys file mode 0600).
- AC6-AC7: `dustin fixture verify` on the recorded JSON exits 0; one extra stroop makes the spendable check fail and exits 3; the pure verifier fails on one stroop above or below the minimum.
- AC8: the testnet-tier test built a second, independent fixture with fresh keys and it passed every check (`DUSTIN_TESTNET=1`, 42 s).
- 59 unit tests and 2 testnet tests pass; lint, format check and typecheck pass.

### File List

- `src/amounts.ts` (new)
- `src/inspect/reserve.ts` (new)
- `src/inspect/horizon-types.ts` (new)
- `src/config/fees.ts` (new)
- `src/config/network.ts` (modified: Friendbot URL)
- `src/errors/dustin-error.ts` (modified: fixture error codes)
- `src/sponsor/fee-bump.ts` (new)
- `src/reader/horizon-json.ts` (new)
- `src/fixture/messy.ts` (new)
- `src/fixture/builder.ts` (new)
- `src/fixture/manifest.ts` (new)
- `src/fixture/verify.ts` (new)
- `src/cli/commands/fixture.ts` (new)
- `src/cli/program.ts`, `src/cli/run.ts`, `src/cli/main.ts` (modified)
- `test/unit/amounts.test.ts`, `test/unit/inspect/reserve.test.ts`, `test/unit/config/fees.test.ts`, `test/unit/fixture/messy.test.ts`, `test/unit/fixture/verify.test.ts`, `test/unit/reader/horizon-json.test.ts`, `test/unit/cli/fixture-verify.test.ts` (new)
- `test/testnet/fixture-messy.test.ts` (new)
- `test/fixtures/horizon/messy/*.json` (new: recorded Horizon JSON and the public manifest)
- `docs/stories/1-1-messy-fixture-builder.md`, `docs/stories/sprint-status.yaml` (modified)

## Senior Developer Review (AI)

- Date: 2026-09-26
- Scope: commits a7048e9..c8ea0b1 (Epic 1), adversarial review plus an edge-case walk by an independent review agent (read-only), 18 findings across the epic.
- Fixes: commits 6806927 (planner and inspector), 2358130 (property test), 9475995 (fixture builder and plan output), 1c9868e (evidence).
- Outcome: changes requested, all resolved.

### Action Items

- [x] Low: keys lived only in memory until the build ended, and the manifest was written before keys.json. The builder now hands the keys over before any account is funded and the CLI stores keys.json (mode 600, never overwritten) first.
- [x] Low: fixture ids had one-second resolution; they now carry a random 6-hex suffix.
- [x] Low: the builder's own 504 handling polled for about 60 s of a 120 s time bound and reported a failed transaction as retryable. Steps and the zero-spendable probe now use the shared `submitAndConfirm`.
- [x] Low: `fixture verify` printed lines up to 172 columns; the output now wraps at 120.

## Change Log

- 2026-09-26: messy fixture recipe, builder, verifier and CLI; first live fixture built and verified. Status: review.
- 2026-09-26: Review findings resolved. Status: done.
