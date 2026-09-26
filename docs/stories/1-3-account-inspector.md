# Story 1.3: Account inspector across all subentry types

Status: done

## Story

As an integrator,
I want `inspectAccount()` to return a complete, typed, serialisable snapshot of everything on an account that affects closing,
so that the planner and my own UI share one source of truth.

## Acceptance Criteria

1. Given a G address, when it is inspected, then the snapshot includes: sequence, subentry count, `num_sponsoring`, `num_sponsored`, the account's own sponsor, thresholds, master weight and signers (weight, type, sponsor), flags, the native balance with liabilities, the minimum and spendable balance, every trustline (asset, balance, limit, buying and selling liabilities, `is_authorized`, `is_authorized_to_maintain_liabilities`, `is_clawback_enabled`, sponsor, last modified ledger), every pool-share balance (pool id, balance), every open offer fetched through all pages (id, selling, buying, amount, price), and every data entry (name, base64 value).
2. Then the snapshot also carries what the ladder and the merge checks need: for each distinct issuer of a non-zero balance, whether the issuer account exists and whether it is SEP-29 memo-required; for the destination, whether it exists, whether it is memo-required and its trustlines; for each non-zero, non-pool balance, the best strict-send quote to XLM for the full balance (or none); the number of claimable balances the account sponsors when `num_sponsoring > 0`; the base reserve, the fee statistics and the ledger the snapshot was taken at.
3. Given a C address, an M address or a malformed input as the account, then a `DustinError` is thrown before any network call (`CONTRACT_ACCOUNT` or `INVALID_ADDRESS`); given an account that does not exist, the snapshot says `exists: false` rather than throwing.
4. Given the Horizon JSON recorded from the live messy fixture, then unit tests assert the fields above without network access, and the exact list of requests made (all GET).
5. The minimum balance is `(2 + subentries + num_sponsoring - num_sponsored) x base reserve` with the base reserve read from the latest ledger; all amounts are strings of stroop-exact decimals.
6. The snapshot round-trips through `JSON.stringify`/`JSON.parse` unchanged and carries a `snapshotHash` over its account-state fields (market quotes, fee statistics and the observation ledger excluded).

## Tasks / Subtasks

- [x] Task 1: `LedgerReader` interface and the Horizon implementation over the read-only JSON client (AC: 2, 4)
- [x] Task 2: address validation (AC: 3)
- [x] Task 3: `inspectAccount()` building `AccountSnapshot` (AC: 1, 2, 5, 6)
- [x] Task 4: canonical JSON and `snapshotHash` (AC: 6)
- [x] Task 5: tests on the recorded fixture plus synthetic variants (pool shares, missing account, sponsoring with claimable balances, memo-required destination, frozen trustline) (AC: 1-6)

## Dev Notes

- Architecture section 4.2 (Inspector, `LedgerReader`), ADR-0004 (Horizon only, GET only), PRD FR-01.
- Pulled forward from E2-S5: the snapshot collects the quotes, issuer facts and destination facts that the ladder needs, so the Week 1 plan for the fixture shows resolved rungs instead of `pending-resolution`.
- Day-1 experiment 4: a merged issuer does not block a burn, so issuer existence is informational; SEP-29 on the issuer still matters, because the SDK refuses a memo-less payment to a memo-required account (experiment 10, `AccountRequiresMemoError`).
- SEP-29 marker: data entry `config.memo_required` with value `1` (Horizon shows base64 `MQ==`), https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0029.md.
- Pool-share balances report `is_authorized: false` without being frozen (canonical decision 9).

### References

- docs/epics-and-stories.md, Story 1.3
- docs/architecture.md section 4.2
- docs/prd.md FR-01

## Dev Agent Record

### Agent Model Used

dev-story workflow (AI developer agent)

### Implementation Plan

- `LedgerReader` (`src/reader/ledger-reader.ts`) is the only way the inspector reaches the ledger; `horizonReader()` implements it over the read-only JSON client. Its methods are all reads.
- `inspectAccount()` validates addresses first (G only for the account; G or M for the destination; C is `CONTRACT_ACCOUNT`), then checks the network passphrase through the reader, then reads in parallel: latest ledger, fee statistics, the account, the destination; then offers, distinct issuers of non-zero balances, one strict-send quote per authorized non-zero trustline, and claimable balances only when `num_sponsoring > 0`.
- `snapshotHash` is the sha256 of the canonical JSON of the account-state fields (`src/canonical-json.ts`); quotes, fee statistics and the observation ledger are excluded so that market moves do not look like drift.
- The strict-send request path is built by one function shared with the fixture recorder, so recorded responses match the inspector's requests exactly.

### Debug Log References

- Red: the inspector test file failed on missing modules; green after implementation.

### Completion Notes List

- AC1-AC2, AC4-AC5: asserted on the Horizon JSON recorded from the live fixture, including the exact request list (11 GETs, no other method). Live check against the fixture on testnet returned the same inventory and quotes (DUSTA 0.0000007 -> 0.0000007 XLM; DUSTB, DUSTC and SPTA without a path).
- AC3: C, M and malformed accounts, and a malformed destination, throw before any request; a missing account yields `exists: false`; a muxed destination is inspected through its base account.
- AC6: the snapshot round-trips through JSON; the hash ignores fee statistics and changes with one stroop of balance.
- Variants covered: pool shares, `num_sponsoring` with claimable balances, SEP-29 destination, deauthorized trustline (not quoted).
- 82 unit tests pass; lint, format check, typecheck and the package check pass.

### File List

- `src/inspect/inspect.ts`, `src/inspect/snapshot.ts`, `src/inspect/address.ts` (new)
- `src/reader/ledger-reader.ts` (new)
- `src/canonical-json.ts` (new)
- `src/fixture/builder.ts` (modified: shared strict-send path)
- `src/errors/dustin-error.ts`, `src/cli/exit-codes.ts` (modified: `INVALID_ADDRESS`, `CONTRACT_ACCOUNT`, exit 2)
- `src/index.ts` (modified: exports)
- `test/helpers/recorded-horizon.ts`, `test/unit/inspect/inspect.test.ts` (new)
- `docs/stories/1-3-account-inspector.md`, `docs/stories/sprint-status.yaml` (modified)

## Senior Developer Review (AI)

- Date: 2026-09-26
- Scope: commits a7048e9..c8ea0b1 (Epic 1), adversarial review plus an edge-case walk by an independent review agent (read-only), 18 findings across the epic.
- Fixes: commits 6806927 (planner and inspector), 2358130 (property test), 9475995 (fixture builder and plan output), 1c9868e (evidence).
- Outcome: changes requested, all resolved.

### Action Items

- [x] Medium: a muxed (M...) destination inherited its base account's SEP-29 `memo_required`, which blocked the plan and ruled out rung 3; the SDK skips the check for muxed addresses, so the inspector now reports `memoRequired: false` for them.
- [x] Low: sorting used locale-dependent `localeCompare`, so asset codes that differ only in case (B-20) could change step ids and the plan hash; the inspector sorts by code point.
- [x] Low: `INVALID_ADDRESS` and `CONTRACT_ACCOUNT` carried no remedy (1-7 AC4); both do now.

## Change Log

- 2026-09-26: Account inspector with ledger reader, address validation, snapshot hash and ladder inputs. Status: review.
- 2026-09-26: Review findings resolved. Status: done.
