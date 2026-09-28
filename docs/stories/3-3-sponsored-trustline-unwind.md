# Story 3.3: Sponsored trustline unwind with reserve attribution

Status: done

## Story

As a sponsor of someone else's trustline,
I want the close to release my reserve back to me and say so,
so that the user is not told they will receive XLM that is actually mine.

The unwind itself was built in Epic 1 and Epic 2: the planner attributes every sponsored entry (`src/plan/recovery.ts`), the account removes a sponsored trustline alone, and the executor credits the reserves of the removals that applied (edge case E9). Both E2-S6 live closes saw the reserve sponsor's `num_sponsoring` go from 1 to 0. This story adds the observed side: the report records what Horizon showed for each reserve sponsor before and after the run, and the receipt prints it next to the planned figure.

## Acceptance Criteria

As written in `docs/epics-and-stories.md` (Story 3.3). Two are met in another form than their wording; each is marked as a documented deviation, with the reason.

1. AC-E3-S3-1: Given SPN sponsored by the fixture sponsor, when closed, then the fixture sponsor's `num_sponsoring` decreases by 1 and its minimum balance by 0.5 XLM (asserted live before and after), and its XLM balance is unchanged.
   - **Met**, live and offline. The messy fixture's sponsored trustline is SPTA and its sponsor is the reserve sponsor, an account separate from the fee sponsor (canonical decision 3, PRD assumption A-4); "SPN" and "the fixture sponsor" are the AC's older names for them. Live: `num_sponsoring` 1 -> 0, minimum balance 1.5 -> 1.0 XLM, balance 10.0000000 before and after, and the report's observed figures say the same.
2. AC-E3-S3-2: Then the plan's `recovery.reservesReleasedToSponsors` contains `{ sponsor: <fixture sponsor>, entries: 1, xlm: "0.5" }`, `xlmToDestination` excludes it, and the receipt repeats it.
   - **Met as a documented deviation** of the names. The field is `recovery.reservesReturnedToSponsors` (PRD section 7; decision D-2 keeps the SDK's names), and `entries` lists the entries (`["trustline SPTA:<issuer>"]`), so its length is the count the AC gives; `xlm` has seven decimals, `"0.5000000"`. `xlmToDestination` is the account's native balance plus the quoted sale, without the sponsored reserve, and the receipt repeats the figure under "Reserves released to sponsors".
3. AC-E3-S3-3: Given the account entry itself is sponsored (synthetic unit case), then the plan reports 2 base reserves released to that sponsor on merge.
   - **Met**, offline: the plan attributes `"1.0000000"` XLM (two base reserves, entry `"account entry"`) to the account entry's sponsor, and the report credits it once the merge applied and the account is gone.
4. AC-E3-S3-4: Then the CLI summary shows "Reserves released to sponsors" as its own line (UX-DR2).
   - **Met as a documented deviation** of where. The line is in the plan's summary block, which `dustin plan` and `dustin close --execute` print before the typed confirmation (UX-DR2 describes that block), and in the receipt after the run, where it carries the observed figures. The short list of four facts that `dustin close --execute` prints right before the question (`summary()` in `src/cli/commands/close.ts`, owned by the E2-S4 work) does not repeat it; the plan printed just above it does.

How each is met, and the test that proves it:

| AC | Behaviour | Tests |
|---|---|---|
| 1 | The executor reads each reserve sponsor its fresh plan names in `recovery.reservesReturnedToSponsors` right before the first submission (`CloseRun.start()`, after the sponsor-funds check) and again right after the final check (`verify()`), together with any sponsor a re-plan named. It records `num_sponsoring`, the XLM balance and the minimum balance, `(2 + subentries + num_sponsoring - num_sponsored) x base reserve`, with the ledger Horizon reported, in `recovery.sponsorsObserved`. A read that fails leaves that figure null and adds a warning; it never changes the outcome of the close. | Offline: `test/unit/execute/sponsors-observed.test.ts` "S-03, AC-E3-S3-1 (offline): records the reserve sponsor's num_sponsoring, minimum balance and XLM balance before the first submission and after the final check" (it also checks the reads come before the first POST and after the final 404), "warns instead of failing the close when a sponsor cannot be read", "keeps the figure from before when only the read after the run fails", "reads no sponsor when the plan names none", "reads a sponsor that only a re-plan names after the run, with no figure from before". Live: `test/testnet/sponsored-unwind.test.ts` "AC-E3-S3-1: num_sponsoring falls by 1, the minimum balance by 0.5 XLM, and the XLM balance is unchanged", "AC-E3-S3-1, AC-E3-S3-2: the report's observed figures say the same, next to the planned reserve", "S-03: the transaction that removed SPTA carries the account's signature only, and Horizon shows trustline_sponsorship_removed" |
| 2 | Unchanged planner: the SPTA removal step says "needs only this account's signature and returns its 0.5 XLM reserve to the reserve sponsor ..., not to this account" and has `reserveReleasedTo: { to: "sponsor", sponsor }`. The report credits the reserve when the removal applied (edge case E9). | `test/unit/plan/recovery.test.ts` "sends the balance plus quoted proceeds to the destination and attributes sponsored reserves"; `test/unit/plan/order.test.ts` "removes a sponsored trustline like any other and attributes its reserve to the sponsor"; `test/unit/render/report-sponsors.test.ts` "shows the planned reserves on their own line, sponsor by sponsor" (plan) and "AC-E3-S3-4: shows the planned reserve and, next to it, the observed num_sponsoring, minimum balance and XLM balance" (receipt). Live: `test/testnet/sponsored-unwind.test.ts` "AC-E3-S3-2: the plan returns the SPTA reserve to the reserve sponsor, and xlmToDestination leaves it out" |
| 3 | The planner attributes two base reserves to the account entry's sponsor when the plan merges; the executor credits them once the account is gone after its merge. | `test/unit/execute/sponsors-observed.test.ts` "AC-E3-S3-3 (offline): a sponsored account entry releases two base reserves to its sponsor with the merge" (plan, report, and the sponsor's `num_sponsoring` 2 lower after the merge); `test/unit/plan/recovery.test.ts` "attributes a sponsored account entry (2 reserves) and sponsored signers and offers"; `test/unit/execute/review-fixes.test.ts` "credits the sponsored account entry that the merge removed" |
| 4 | Receipt, Result section: "Reserves released to sponsors: 0.5000000 XLM, never this account's", then per sponsor the planned reserve with its entries and, under it, "observed on Horizon: num_sponsoring 1 -> 0, minimum balance 1.5000000 -> 1.0000000 XLM (0.5000000 XLM released), XLM balance 10.0000000 -> 10.0000000 (unchanged)". It says what was not read when a read failed, names a sponsor this run released nothing to, and says "none" when nothing was sponsored. The plan's summary block has the same heading line. Since the closing review (CC-9, `052aea9`) a copy saved while the run is going (status `running`) reads as a run in progress: "Reserves released to sponsors: attributed when the run ends" (the executor attributes the reserves at the end, so the list is empty in every running copy), "reserve of sponsor ...: attributed when the run ends", and "not read yet" for the reading after the run, where it said "none", "nothing returned to sponsor ... by this run" and "not read after the run". | `test/unit/render/report-sponsors.test.ts`: "AC-E3-S3-4: shows the planned reserve and, next to it, the observed num_sponsoring, minimum balance and XLM balance", "says what was not read, when a read failed", "shows an observed sponsor that this run released nothing to", "says none when no entry was sponsored, and keeps reports without observations readable", "shows the planned reserves on their own line, sponsor by sponsor", "says none when the plan releases no sponsored reserve". Live: `test/testnet/sponsored-unwind.test.ts` "AC-E3-S3-4: the receipt shows Reserves released to sponsors on its own line, planned and observed" |

The receipt of the live S-03 close:

```
Result
  4.0000007 XLM merged into the destination GBPN...VNUR (read from the merge result)
  Reserves released to sponsors: 0.5000000 XLM, never this account's
    0.5000000 XLM reserve returned to sponsor GAPO...Q5XB, never this account's (trustline SPTA)
      observed on Horizon: num_sponsoring 1 -> 0, minimum balance 1.5000000 -> 1.0000000 XLM (0.5000000 XLM released),
      XLM balance 10.0000000 -> 10.0000000 (unchanged)
  0 XLM in fees paid by the account
  0.0001500 XLM (1,500 stroops) in fees paid by the sponsor
```

Matrix rows of `docs/edge-cases-and-test-matrix.md` section 4 covered here, besides the ACs:

- **S-03, sponsored trustline unwinding (live).** The negative control of the row: the same removal (SPTA returned to its issuer, then `changeTrust` limit 0) with the reserve sponsor's signature on the inner transaction too, fee-bumped by the fee sponsor, is refused with `tx_fee_bump_inner_failed` / inner `tx_bad_auth_extra`. The account's sequence number is unchanged and Horizon has no record of the envelope. Dustin's own removal carries one inner signature (the account's) and one outer signature (the fee sponsor's), and Horizon shows `trustline_sponsorship_removed` with `former_sponsor` the reserve sponsor.
- **X-18, sponsored signer (live).** The reserve sponsor sponsors a second signer on a fresh fixture (a CAP-33 sandwich, fee-bumped). The plan attributes 1.0 XLM to the reserve sponsor: the SPTA trustline and the signer. The close takes its `num_sponsoring` from 2 to 0, its minimum balance from 2.0 to 1.0 XLM, its balance unchanged. The merge transaction shows `signer_sponsorship_removed`, and the report credits both entries.

## Live runs (2026-09-28, testnet)

Command: `DUSTIN_TESTNET=1 npx vitest run --project testnet --reporter=verbose test/testnet/sponsored-unwind.test.ts`. With `DUSTIN_UNWIND_RECORD=<file>` every hash is also written with its purpose (public data only).

Run 1 (11:06 to 11:09 UTC), on the code after `main` was merged (commit df91f73): 9 of 9 passed.

Every account is a throwaway created by `buildMessyFixture()` and funded from Friendbot. Each fixture transaction after `create-accounts` and every close transaction is a fee bump paid by the fixture's fee sponsor. The builder's baseline fixture `messy-20260926T035942Z` was not touched. Explorer links, until the testnet reset of 2026-12-16: `https://stellar.expert/explorer/testnet/tx/<hash>`.

### S-03: the sponsored trustline, with the negative control (AC-E3-S3-1, AC-E3-S3-2, AC-E3-S3-4)

Fixture `messy-20260928T110659Z-20cef0`:

| Role | Public key |
|---|---|
| Closed account | `GDPJ44M5HPYUVNZGOE3VKSBECKTOLZLNKOLCAIL77XX3QEAVZMUJXAUL` |
| Destination | `GBPN4CPA7K5QUYA5MCUGCT6GHYSBEH2NWFO3V4SFR7LHTHBC7YEXVNUR` |
| Fee sponsor | `GA2XYYCP52YNRI5HVXAKOONXSZ2KU3RT4TVXNSTR4U6PLHYDL2NGNYNU` |
| Reserve sponsor | `GAPOKYGF5P4TLHJIMKKSTZSN4FVQJF6EFY62UTIO7ZH5AXPLXD34Q5XB` |
| Issuer | `GAFENX4REVRXBIFXDSIPZ3JM5PE76L4SWDVTFXPKN7KA36DMIQKW56YL` |
| Market maker | `GAP2KSC6GNZG66A4P22TE7PCL7MDYGLNWX65F3SM7RSOQDXNK6OLSWRQ` |

| Ledger | Hash | Purpose |
|---|---|---|
| 4914008 | `a04cab29bca6683dc3738328a66c35ec46b0662bb6463e0bbdfca02a35589001` | fixture: create accounts |
| 4914009 | `ac17a48ec3520830097df1eb3c5d97a3cec52b71c33d4aca4f8e2efa026e1274` | fixture: trustlines |
| 4914010 | `6791ee852c8d791d56b0773c5153f5d063a3c791efd509c02f78cd4b8d381030` | fixture: sponsored trustline (SPTA, sponsored by the reserve sponsor) |
| 4914011 | `22b79fa48d61b54362c6671e4511e1f4e57bba6c4ddd43544fd9ecda77103b25` | fixture: dust payments |
| 4914012 | `a4299948d528bcb2ca7ba8daaa1718221f968fcebda78f9dce0333c77b555ada` | fixture: market maker's DUSTA bid |
| 4914013 | `8771eb88488a4749f6fc96fa43a262edb87c586c1aeb6d9792d8ebdb431b3879` | fixture: offers and data entry |
| 4914014 | `cefed78bdf4f3b4b5fec1bb68c90273a058399acc221e99dd197477bd57cc7a9` | fixture: drain to the minimum balance |
| - | none | reserve sponsor before (test's own read, ledger 4914014): `num_sponsoring` 1, balance 10.0000000, minimum 1.5000000 XLM |
| - | `f84e2416c5e7d04544ee0a5f330b86b8ec8599cf2912883e550e91ad9370f2a4` | negative control: SPTA returned and removed with the reserve sponsor's signature on the inner transaction too; refused `tx_fee_bump_inner_failed` / `tx_bad_auth_extra`, never on the ledger (inner hash `2d485b9f3b854fcfbb2734ee399c7f2dc53c9b2b069ed7f66cf715491767a8f3`) |
| 4914016 | `d1710f13666bd71de5082928110f7d0b73edcf0ce0308adbe1f67c6e438f760c` | close tx 1 (cleanup), applied: SPTA returned to its issuer and removed; effect `trustline_sponsorship_removed`, `former_sponsor` the reserve sponsor |
| 4914017 | `e93e2bfbb17f12fc93a77c5e46869f65abbb256a9c72a683199c3920a00f8afd` | close tx 2 (the DUSTA sale), applied |
| 4914018 | `c685b85159775d40b6b3cf6b3850311b122ec7eaea58b27103411e23751f3c8a` | close tx 3 (merge), applied; 4.0000007 XLM merged; account 404 |
| - | none | reserve sponsor after (ledger 4914018): `num_sponsoring` 0, balance 10.0000000, minimum 1.0000000 XLM; the report's `sponsorsObserved` recorded 1 -> 0, 1.5 -> 1.0 XLM, 10.0000000 -> 10.0000000 (before at ledger 4914015, after at 4914018) |

### X-18: a sponsored signer, removed by the merge

Fixture `messy-20260928T110759Z-fad022`; the sponsored signer is `GDBYVTSEV2L6MRGQJW4FMVETEBP6XIUBSU346Q3WUEC6HUVRWRUFNAKS`, a key created in memory, never funded and never used to sign.

| Role | Public key |
|---|---|
| Closed account | `GD2MEHZ6PRMN3ROMNMBCSB2BBC3TOOFNK6UAHCVNV7Z3LEF5OILB2ZTU` |
| Destination | `GAPH4X2SPFSTQLV5K4L24DN7BJGVHYTAKNZMFXGI5RXSXRQBPFKHCEIS` |
| Fee sponsor | `GCDGKAYTRQO6QBWYJ6JUQLE3JVNOECXJR3WDMMM7MXT7ONZE4FP55GYG` |
| Reserve sponsor | `GBG7GVFMUMUAMGTXQ7TWJN5YAQKKPSBAPEFLJZM4IZV6PLSETQYRWT33` |
| Issuer | `GCBMG2MK4CZGADGIKMUD6GAMRI6HB72FIWXB2PAONFKTBRVMTO3YRPFT` |
| Market maker | `GDELUZTIY5MUI5PD7HZ74AVLAUS6MJ5O2ORH5G25FRPIFAN3WLMDNUS7` |

| Ledger | Hash | Purpose |
|---|---|---|
| 4914020 | `6d563180e044c27315cd75af1a9d7607690c8886dbfc815e26e964fa3b8558bb` | fixture: create accounts |
| 4914021 | `7e322363aa74a7e6141be41101397a00ca7e951c3c39fabd4be4e3740a9a73b2` | fixture: trustlines |
| 4914022 | `976d9cf0c7e2df29a77f92cea4a238068494728166aa98e0dc53e7d5d68cd509` | fixture: sponsored trustline |
| 4914023 | `9e65ddc5e2968505cd9626688a13280c72cec2cb869ba30c3cd42a9c4326b594` | fixture: dust payments |
| 4914024 | `ce694170517892103aafc6a9b656486570db76d53161dca06abe76d101649b2c` | fixture: market maker's DUSTA bid |
| 4914025 | `46f0481db6bb6d05daf89bbe07c05573c655a53aabff5da1b1d9a79462c30724` | fixture: offers and data entry |
| 4914026 | `7005e85a378010b0b97ed2be6f40e64d8dc5c29532c176965d61da5c4b9a9a70` | fixture: drain to the minimum balance |
| 4914028 | `2da15ebf7560b1ba7c0438084a10390b1d1dda872fe4c7badadaee9b494f7988` | the reserve sponsor sponsors the second signer on the fixture (begin, setOptions, end) |
| - | none | reserve sponsor before (ledger 4914028): `num_sponsoring` 2, balance 10.0000000, minimum 2.0000000 XLM |
| 4914029 | `f9aa5fbc66509913cabdb9a93c1f40ed562286e86681829d1fd8ac5fe04b5bd0` | close tx 1 (cleanup), applied |
| 4914030 | `6a5afb13e10bd9cb5c759f64a04bc16828178960c41d61d02d39870f87f18a8c` | close tx 2 (the DUSTA sale), applied |
| 4914031 | `fd8bb1595c734ab7e6d019d249dddcb87c5d875f3707b409bb495b859b817dfd` | close tx 3 (merge), applied; effect `signer_sponsorship_removed` for the signer, `former_sponsor` the reserve sponsor; account 404 |
| - | none | reserve sponsor after (ledger 4914031): `num_sponsoring` 0, balance 10.0000000, minimum 1.0000000 XLM; the report credits 1.0000000 XLM (the SPTA trustline and the signer) and observed 2 -> 0 |

## Tasks / Subtasks

- [x] Task 1: offline tests first on the fake ledger, whose trustline removal already lowers the sponsor's `num_sponsoring` (AC: 1, 3)
- [x] Task 2: `recovery.sponsorsObserved` (`src/execute/report.ts`) and the reads before the first submission and after the final check (`src/execute/executor.ts` `observeSponsors`, called from `start()` and `verify()`) (AC: 1)
- [x] Task 3: "Reserves released to sponsors" in the receipt, planned and observed, and in the plan's summary block (`src/render/report-text.ts`, `src/render/plan-text.ts`) (AC: 2, 4)
- [x] Task 4: live tests, one fresh fixture per case: S-03 with its negative control, and X-18 (`test/testnet/sponsored-unwind.test.ts`) (AC: 1, 2, 4)

### Closing review (2026-09-28)

The closing review of Epic 3, fixed by agent F1 and merged in `d0d711c`, with its test in `test/unit/render/closing-review-render.test.ts` under the finding's id. The finding that concerns this story:

- [x] [Review][Patch] CC-9 A copy saved while the run is going (`status: "running"`) gets run-in-progress wording in the sponsor section ("attributed when the run ends", "not read yet") and in Disposals ("not run yet"), instead of final-outcome words [src/render/report-text.ts] (`052aea9`)

## Dev Notes

- Policy: canonical decisions 3 (the reserve sponsor is a separate account from the fee sponsor) and 11 (sponsored trustlines are removed by the owner alone and their reserve returns to the reserve sponsor); architecture section 6.2 and fact F11; PRD FR-13, UX-DR2; edge cases S-01, S-06, E9; matrix rows S-03 and X-18.
- Protocol facts checked for this story (2026-09-28):
  - Minimum balance = `(2 + numSubEntries + numSponsoring - numSponsored) x baseReserve`; removing a sponsored entry decrements the sponsor's `numSponsoring` and the owner's `numSponsored`, and moves no XLM (https://developers.stellar.org/docs/build/guides/transactions/sponsored-reserves#effect-on-minimum-balance; day-1 experiment 3).
  - `tx_bad_auth_extra` (`txBAD_AUTH_EXTRA`): "unused signatures attached to transaction" (https://developers.stellar.org/docs/data/apis/horizon/api-reference/errors/result-codes/transactions; Raven MCP). A fee bump reports an inner refusal as `tx_fee_bump_inner_failed` with the inner code, and nothing is consumed (day-1 experiment 3, `src/execute/submit.ts`).
  - The merge removes the account's signers one by one with `removeSignerWithPossibleSponsorship`, then the account entry with `removeEntryWithPossibleSponsorship`, so a sponsored signer and a sponsored account entry release their reserves to their sponsors (stellar-core `MergeOpFrame::doApplyFromV16`, https://github.com/stellar/stellar-core/blob/master/src/transactions/MergeOpFrame.cpp, read at `master` on 2026-09-28). The docs: signers "(including sponsored signers) are removed automatically during the merge" (https://developers.stellar.org/docs/learn/fundamentals/transactions/list-of-operations#account-merge).
- What "observed" means. Before: the sponsors the executor's fresh plan names, read after the sponsor-funds check and before the first transaction is built, so no transaction of the run has touched them. After: read right after the final check, so the account's 404 (or its last state) has been seen first; the sponsors a re-plan named are read then too, with no figure from before. Each read is one `GET /accounts/{sponsor}` plus one `GET /ledgers?order=desc&limit=1` per round of reads; a plan without sponsored entries reads nothing more. The minimum balance uses the base reserve of that ledger.
- A failed read is a warning ("The reserve sponsor G... could not be read before the first submission (...)"), and its figure stays null. The receipt then says which side was not read. The report still credits the planned reserves from the removals that applied (edge case E9): the observation is evidence next to the attribution, never its source.
- The observed figures are raw: another transaction of the sponsor during the run (its own payment, another sponsorship) shows in them as well. The receipt prints the change of the minimum balance and of the balance as they are, and says "unchanged" only when they are equal.
- The fake ledger (`test/helpers/fake-ledger.ts`) removes a merged account without lowering its entry sponsor's `num_sponsoring`; stellar-core does lower it (see above). The AC-3 offline test emulates stellar-core with a fetch wrapper of its own instead of changing the shared helper. A change to the helper would let other tests rely on it; it is suggested to the integrator.
- The field names follow the SDK (PRD decision D-2): `reservesReturnedToSponsors` for the plan's and the report's attribution, and the new `sponsorsObserved` for the observation. PRD section 7 did not list `sponsorsObserved` when this story was written; it lists it, with `SponsorObservation` and `SponsorState`, since the documentation update of 2026-09-28.

### References

- docs/epics-and-stories.md, Story 3.3; docs/README.md canonical decisions 3, 11
- docs/architecture.md section 6.2; docs/prd.md FR-13, section 7, "Decisions after review" D-2; UX-DR2 in docs/epics-and-stories.md
- docs/edge-cases-and-test-matrix.md S-01, S-06 and matrix rows S-03, X-18; docs/progress-log.md day-1 experiment 3
- docs/stories/2-3-retry-recovery-resume.md (edge case E9: reserves from the removals that applied)

## Dev Agent Record

### Agent Model Used

dev-story workflow (AI developer agent)

### Implementation Plan

- The reads sit where they see the state a run starts from and ends in: `start()` right before the first submission, `verify()` right after the final check. `stopped()`, `complete()` and the attribution itself (`recoverReserves()`) were not changed.
- One helper, `observeSponsors(when)`, reads a sponsor list and records one `SponsorObservation` per sponsor; it catches every error, so observing cannot change a close's outcome.
- The receipt keeps the planned line's wording ("... XLM reserve returned to sponsor ..., never this account's (...)") under the new heading, so existing readers of the receipt find it where it was.

### Debug Log References

- The offline tests were written first against the fake ledger; the first render test run showed the receipt wrapping the observed line after "released)," rather than where the test guessed. The renderer's wrap was kept (each line within 120 columns) and the test follows it.
- The live S-03 and X-18 cases passed on their first run.

### Completion Notes List

- Offline tier: see the Story 3.4 record (73 files and 635 tests before both stories; 81 files and 687 tests after both; 84 files and 752 tests after merging `main`). Lint, format, typecheck and build pass.
- Live tier: `test/testnet/sponsored-unwind.test.ts`, 9 tests, passed on 2026-09-28 (hashes above).
- New in the public surface: `CloseReport.recovery.sponsorsObserved` (optional in the type for reports written before it; always set by the executor), and the types `SponsorObservation` and `SponsorState` in `src/execute/report.ts`.

### File List

- `src/execute/executor.ts` (`observeSponsors`, calls in `start()` and `verify()`, the report's initial `sponsorsObserved`, `errorText`), `src/execute/report.ts`, `src/render/report-text.ts` (`sponsorLines`, `observedText`), `src/render/plan-text.ts` (modified)
- `test/unit/execute/sponsors-observed.test.ts`, `test/unit/render/report-sponsors.test.ts`, `test/testnet/sponsored-unwind.test.ts` (new)
- `docs/stories/3-3-sponsored-trustline-unwind.md` (new), `docs/epics-and-stories.md` (Story 3.3 only) (modified)

## Change Log

- 2026-09-28: observed reserve release to sponsors in the report, the receipt and the plan's summary; offline tests and a live run of S-03 (with its `tx_bad_auth_extra` control) and X-18. Status: review.
- 2026-09-28: closing review of Epic 3 (record updated by the documentation pass): CC-9, the run-in-progress wording of the sponsor section in a running copy, with its commit in the section "Closing review (2026-09-28)"; the note on PRD section 7 brought up to date.
- 2026-09-28: Status: done (`docs/reviews/2026-09-28-e3-review.md`, verdicts).
