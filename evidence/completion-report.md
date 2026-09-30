# Dustin — Instaward Completion Report (draft)

> **Draft for the builder to finish and send.** Prepared on 2026-09-28 (sprint day 7 of 30) and updated on 2026-09-29 after the independent pre-release review, from [`docs/next-steps/instaward-completion-report-template.md`](../docs/next-steps/instaward-completion-report-template.md), with every figure taken from the committed evidence. It is not sent and not final: every item that is the builder's to do is marked `<pending: ...>`, and the builder fills those, checks every link in a fresh browser session (section I) and sends the report to the chapter lead. Nothing marked pending may be reported as done.

## Report header

| Field | Value |
|---|---|
| Program | Stellar Instawards, via the Stellar Türkiye ambassador chapter |
| Project | Dustin |
| SOW status | Accepted; awarded budget $5,000; planned effort 200 hours at $25/hour |
| Suggested sprint start (SOW) | 2026-08-09 |
| Actual sprint window | 2026-09-22 (funds received) to 2026-10-22 (final deadline) |
| Report date | `<pending: the date the builder sends the report>` (draft of 2026-09-28) |
| Reporting party | The builder |
| Reviewer | The chapter lead |
| Repository | https://github.com/0xsimoneth/dustin at tag `<pending: v0.1.0, created by the builder>` / commit `<pending: the full SHA the builder reports>` |
| npm package | `stellar-dustin` 0.1.0, prepared; `<pending: builder publishes stellar-dustin 0.1.0 to npm and adds the package URL>` |
| Network | Stellar testnet only (mainnet is out of scope per SOW section 4.1) |
| Evidence package | [`evidence/README.md`](README.md): SOW 6.1, 6.2, Appendix A and Appendix B row by row |

## A. Binary success metric (SOW Appendix B, no partial credit)

Judged on the latest metric close through the CLI, on the 0.1.0 code of 2026-09-29, [`evidence/runs/20260929T111408Z-e4-cli/`](runs/20260929T111408Z-e4-cli/summary.md). The first recordings of 2026-09-28, through the CLI ([`evidence/runs/20260928T112252Z-e3-cli/`](runs/20260928T112252Z-e3-cli/summary.md), the run the ticked boxes of the SOW's Appendix B link) and through the SDK ([`evidence/runs/20260928T112239Z-e3/`](runs/20260928T112239Z-e3/summary.md)), meet every row as well.

| Criterion | Status | Evidence |
|---|---|---|
| Fixture account on testnet holds zero spendable XLM before the close | Met | [`fixture-verification.json`](runs/20260929T111408Z-e4-cli/fixture-verification.json), checked at 11:15:01 UTC: balance 4.0000000 XLM, minimum balance 4.0000000 XLM, spendable 0.0000000 |
| Fixture holds at least 3 trustlines with non-zero balances | Met | same file: 4 (DUSTA 0.0000007, DUSTB 0.0000003, DUSTC 0.0000005, SPTA 0.0000001, the last one sponsored) |
| Fixture holds at least 1 open offer | Met | same file: 2 (ids 838443, 838444) |
| Fixture holds at least 1 data entry | Met | same file: 1 (`dustin.fixture`) |
| Every transaction in the close is fee-bumped by the sponsor (closed account pays no fee) | Met | Horizon's records [`tx-1.json`](runs/20260929T111408Z-e4-cli/tx-1.json), [`tx-2.json`](runs/20260929T111408Z-e4-cli/tx-2.json), [`tx-3.json`](runs/20260929T111408Z-e4-cli/tx-3.json): `fee_account` is the sponsor `GBDOAFW4WYIOVCBZNVI4CF4QOD2J3HZYMMQZSOF2LOSNZGZCSMVBIGMQ`, `source_account` is the closed account, inner `max_fee` is 0; [tx 1](https://stellar.expert/explorer/testnet/tx/835457ceff4b0443ec52ebbb408edc8988627e5de8442d28dda85b3331b52a5b), [tx 2](https://stellar.expert/explorer/testnet/tx/c6c99beddca7685293bdb0e156e320cbb4189e4247e4451578b60e82ba76de61), [tx 3](https://stellar.expert/explorer/testnet/tx/dd56e18f152dc7f15ee370dce9b8ddae556e90f04dd1cd52fe3281df4bf118e2) |
| The account no longer exists on a public testnet explorer | Met | [`account-after.json`](runs/20260929T111408Z-e4-cli/account-after.json) (HTTP 404); [explorer](https://stellar.expert/explorer/testnet/account/GCIVEA6YVJCSYE2Y7V2IUEYATOO36X7GQOAYNOI2MDNOW7HI4LPJVKZT), [Horizon](https://horizon-testnet.stellar.org/accounts/GCIVEA6YVJCSYE2Y7V2IUEYATOO36X7GQOAYNOI2MDNOW7HI4LPJVKZT); screenshots captured on 2026-09-30, before the testnet reset: the explorer's page of the account, "Account (deleted)" with the merge first in its history ([`explorer-account.png`](runs/20260929T111408Z-e4-cli/explorer-account.png)), the three transactions ([`explorer-tx-1.png`](runs/20260929T111408Z-e4-cli/explorer-tx-1.png), [`explorer-tx-2.png`](runs/20260929T111408Z-e4-cli/explorer-tx-2.png), [`explorer-tx-3.png`](runs/20260929T111408Z-e4-cli/explorer-tx-3.png)) and Horizon's 404 ([`horizon-account-404.png`](runs/20260929T111408Z-e4-cli/horizon-account-404.png)) |
| The full transaction chain is linkable from the evidence package | Met | [`evidence/README.md`](README.md#the-transaction-chain-of-the-metric-close) |

Every row is Met on committed evidence. The builder confirms each link in a fresh browser session before sending (section I).

## B. Deliverable reports (SOW sections 4.1 and 6.1)

### Deliverable 1 — `planClose()`, the read-only planner

**Planned (SOW):** an SDK function that inspects any account and returns an ordered close plan (offers to cancel, balances to dispose of and how, trustlines and data entries to remove, XLM recovered, final merge), grouped into the minimum number of transactions with a reason and fee estimate per step; dry run by default; changes nothing; rendered from a CLI.

**Delivered:** `planClose()` (`src/plan/plan-close.ts`, exported from `src/index.ts`) reads the account, its offers, issuers, destination, strict-send paths, fee statistics and the latest ledger from Horizon with GET requests only, and returns a `ClosePlan`: steps in the order of rules R1 to R9 ([architecture](../docs/architecture.md), section 5.1), each with a reason, grouped into cleanup, convert and merge transactions with a fee bid per transaction, the XLM that reaches the destination, the reserves that go back to reserve sponsors, blockers and unclosable items with remedies, and a plan hash. `dustin plan <account> --to <destination>` prints it for any testnet account.

**Completion criteria mapping:**

| Criterion | Status | Evidence |
|---|---|---|
| Returns a correct ordered plan for the fixture account as a dry run | Met | [`evidence/plan/fixture-plan.txt`](plan/fixture-plan.txt) and [`fixture-plan.json`](plan/fixture-plan.json), the builder's fixture `messy-20260926T035942Z`, committed in `c769364ccbc0fff6734b226d88894c540a1481ed` (2026-09-26), before the output was polished; the plan the 0.1.0 code prints, for the metric account right before its close: [`runs/20260929T111408Z-e4-cli/plan.txt`](runs/20260929T111408Z-e4-cli/plan.txt) (2026-09-29) |
| Covers trustlines, open offers, data entries, sponsored reserves, liquidity pool shares (detected) | Met | The committed plan (offers S01 and S02, disposals and trustline removals, the sponsored SPTA trustline with its reserve sponsor, the data entry); pool shares: `plan/blockers` › S-08 and `testnet/edge` › S-08 ([test matrix](../docs/test-matrix.md)) |
| Groups steps into the minimum number of transactions with reason and fee estimate per step | Met | "Transactions (3, each fee-bumped by the sponsor; inner fee 0)" with 9, 2 and 1 operations and a bid per transaction, in [`plan.txt`](runs/20260928T112252Z-e3-cli/plan.txt); the reading of "minimum" is in the [write-up](../docs/write-up.md), section 3 |
| Never mutates state (dry-run guarantee) | Met | `plan/dry-run` › planClose makes GET requests only and never touches a submission endpoint; › accepts no secret or signer in its types; `testnet/plan-readonly` › plans a closable close and leaves the account untouched |
| CLI renders the plan for any testnet account | Met | `dustin plan <G...> --to <G...>` ([README](../README.md#quick-start-cli)) |

**Evidence (SOW 6.1: public repo + CLI output):**

- Source: https://github.com/0xsimoneth/dustin, `src/plan/`, commit `<pending: the full SHA the builder reports>`
- Committed output for the fixture: `evidence/plan/fixture-plan.txt`
- Reproduction command: `dustin plan GAZF3X7YYCI7PHZYZDQOGPLVN2RVD37YIQG7YEY6QJW6IK224Y4R3MBK --to GBQGFM635UIV2BTCTYSMKKJBESY47VXZLCIPGKW3GZJSSY6B45U2DH2C --sponsor GBISNFQ4KAM62Z22MGKULQ7PI6H3RVMMWJZTWU6NP2DAIYAVN7XYQN4K` (the command in the committed file)

**Deviations:** none in scope. The package and CLI names follow canonical decisions 2 and 4 (section F).

**Effort:** planned 60 hours / $1,500 — actual `<pending: builder's hours>` / `<pending>`

### Deliverable 2 — `executeClose()`, live on testnet

**Planned (SOW):** executes the plan against a real account with every transaction fee-bumped by a sponsor; disposal ladder for leftover balances (path payment, return to issuer, transfer to destination, unclosable with reason); sponsored trustline unwinding with the reserve returned to the sponsor; `ACCOUNT_MERGE_SEQNUM_TOO_FAR` guard; submission with retry and failure recovery; first end-to-end close of the messy fixture.

**Delivered:** `executeClose()` (`src/execute/executor.ts`) re-reads the account and plans again before signing, stops on drift, signs every inner transaction with the account's signer and wraps it in a fee bump signed by the sponsor within a per-close budget, walks the disposal ladder and falls down it when the market moves, unwinds sponsored trustlines with the account's signature alone, waits for the sequence guard, recovers from timeouts without paying twice, verifies the account is gone and returns a report with every hash. `dustin close <account> --to <destination> --execute` runs it after a typed confirmation.

**Completion criteria mapping:**

| Criterion | Status | Evidence |
|---|---|---|
| Zero-XLM account closed end to end with sponsored fees (week 2 simple close) | Met, 2026-09-26 | [`runs/20260926T125350Z/`](runs/20260926T125350Z/summary.md): `274e5ba5e27b7587afcd005168e48b50024473fa809b5675aca66044b642b7e7`, `1b066b616c2e0ca3e16dbd97135c4ef97d612d8893403f0e92d41ea784f6acd8`, `46a17cac527c329fbfb532660ab08e9ffcd80c06f595fa0f5a716513fee3ee2f` (ledgers 4880726 to 4880728) |
| Full messy fixture closed end to end (week 3) | Met, 2026-09-28, and again on the 0.1.0 code on 2026-09-29 | [`runs/20260929T111408Z-e4-cli/`](runs/20260929T111408Z-e4-cli/summary.md), in order: `835457ceff4b0443ec52ebbb408edc8988627e5de8442d28dda85b3331b52a5b` (cleanup, ledger 4931386), `c6c99beddca7685293bdb0e156e320cbb4189e4247e4451578b60e82ba76de61` (sale, 4931387), `dd56e18f152dc7f15ee370dce9b8ddae556e90f04dd1cd52fe3281df4bf118e2` (merge, 4931388); the first recording, [`runs/20260928T112252Z-e3-cli/`](runs/20260928T112252Z-e3-cli/summary.md): `0ee9fb5e4bb683519af3190e45c6e0350a0819aa509d65fddb34a247e65dcaac` (4914209), `f7161ce4667cc9b3457aa6daa948f8b39df847b0576ab73849ac7325ad81f700` (4914210), `36e53646514a36c673830955b661b91de297842481295f458de8c5911e5c989c` (4914211) |
| Every transaction fee-bumped by the sponsor | Met | For each hash above: inner source the closed account, fee source the sponsor, inner `max_fee` 0 (`tx-<n>.json`); sponsor fees 1,500 stroops, account fees 0 |
| Disposal ladder exercised: path payment, issuer return, destination transfer, unclosable with reason | Met | Path payment: DUSTA sold in `f7161ce4667cc9b3457aa6daa948f8b39df847b0576ab73849ac7325ad81f700`. Issuer return: DUSTB, DUSTC and SPTA burned in `0ee9fb5e4bb683519af3190e45c6e0350a0819aa509d65fddb34a247e65dcaac`. Destination transfer: DUSTC sent to the destination in `d87eb28d7dfff3bc5e3dc50d4b0db34807022f3a0a033b1f236373547dea3098` ([`e3s2-partial`](runs/20260928T125528Z-e3s2-partial/summary.md)). Unclosable with reason: the frozen FRZ, `TRUSTLINE_NOT_AUTHORIZED` with its remedy, exit 3 without `--partial` and exit 4 with it ([`edge-frozen`](runs/20260928T125414Z-edge-frozen/summary.md)) |
| Sponsored trustline unwound with reserve returned to sponsor | Met | SPTA removed in `0ee9fb5e4bb683519af3190e45c6e0350a0819aa509d65fddb34a247e65dcaac`; reserve sponsor `GCFMPHR7TIPDOYD2UHXSE2PLWIMFYIEWC2NQ3N4RKLSSDVXODU5REILD`: `num_sponsoring` 1 to 0, minimum balance 1.5 to 1.0 XLM, XLM balance 10.0000000 before and after (`report.json`, `recovery.sponsorsObserved`) |
| Sequence-number guard prevents `ACCOUNT_MERGE_SEQNUM_TOO_FAR` | Met | [`e3s4-wait`](runs/20260928T125223Z-e3s4-wait/summary.md): a sequence number bumped to (4915280 + 12) << 32; the CLI waited and the merge `f66c93cbd27d397f6c3e683a455b32bb150f0c51334fd955b2db5fa5838456e9` applied in ledger 4915293, the unblocking ledger itself; tests `testnet/sequence-guard` (9 tests, matrix row S-04) |
| Retry and failure recovery | Met | `execute/recovery` › AC-E2-S3-1: finds a 504'd transaction by hash and never posts it twice (matrix X-14); live: a sale whose market vanished failed with `op_too_few_offers`, the executor re-planned DUSTA to its issuer and closed the account ([story E3-S1](../docs/stories/3-1-ladder-path-payment.md)) |
| Account gone from a public explorer | Met | [explorer](https://stellar.expert/explorer/testnet/account/GCPPFHGLKA7GCBWJXBH4EXFXS3OXAMXFLOBAZLU2K3KKMO6JKZORNFW7), [Horizon 404](https://horizon-testnet.stellar.org/accounts/GCPPFHGLKA7GCBWJXBH4EXFXS3OXAMXFLOBAZLU2K3KKMO6JKZORNFW7) |

**Evidence (SOW 6.1: transaction hashes + 60-second video):**

- Transaction chain: the three hashes above, with explorer and Horizon links in [`evidence/README.md`](README.md#the-transaction-chain-of-the-metric-close)
- Closed account: [explorer](https://stellar.expert/explorer/testnet/account/GCIVEA6YVJCSYE2Y7V2IUEYATOO36X7GQOAYNOI2MDNOW7HI4LPJVKZT) (the latest metric close); the first recording's, [explorer](https://stellar.expert/explorer/testnet/account/GCPPFHGLKA7GCBWJXBH4EXFXS3OXAMXFLOBAZLU2K3KKMO6JKZORNFW7)
- Video: produced on 2026-09-30 from the rehearsal script on a fresh fixture ([record](demo/README.md), [take](demo/take-20260930T170141Z/summary.md): account `GC6ZX4GCHOHZBSNKMPNSPO2FXNBVRVSPUOMCN5KP7JIJZDRMF2XUAACV`, its pages on StellarExpert before and after the close, three sponsor-paid fee bumps, Horizon 404; the take of 2026-09-29 kept as a backup); its link `<pending: builder approves and hosts the 60-second video (E4-S6)>`

**Status:** in progress. The live close is done and linked; the 60-second video that SOW 6.1 lists as D2's evidence too is produced and waits for the builder's approval and hosting, so D2 is not reported as done before it is linked.

**Deviations:** the metric close ran on fresh messy fixtures built from the recipe of the builder's baseline fixture; closing the baseline fixture itself follows its recording (matrix row B-03, pending). Evidence lives in `evidence/runs/<stamp>/` rather than `evidence/closes/` (PRD decision D-4).

**Effort:** planned 80 hours / $2,000 — actual `<pending: builder's hours>` / `<pending>`

### Deliverable 3 — Edge cases and test matrix

**Planned (SOW):** test coverage for illiquid leftover balance, sponsored trustlines, `ACCOUNT_MERGE_SEQNUM_TOO_FAR`, authorization-required and clawback-enabled trustlines, liquidity pool shares (detected and reported, not withdrawn); construction of the messy fixture (3 trustlines with dust, 2 open offers, 1 data entry, 1 sponsored trustline, 0 XLM, plus a deliberately illiquid asset); a recorded baseline run of the existing StellarExpert tool against the same fixture showing where it stops; raised multisig thresholds detected and reported.

**Delivered:** the fixture builder (`dustin fixture create --profile messy` for the metric account, `--profile edge` for one throwaway account per edge variant) and verifier (`dustin fixture verify`); the [test matrix](../docs/test-matrix.md) of 32 rows, 27 of them green, with every SOW-named case green at both levels; an offline tier of 125 files and 1236 tests, green on commit `e563470` (2026-09-30), and a live tier of 11 files and 58 tests, green in CI on the same commit (run 36757533611, 2026-09-30) and on the 0.1.0 code (run 36560464977, 2026-09-29). The baseline recording is pending.

**Completion criteria mapping:**

| Criterion | Status | Evidence |
|---|---|---|
| Fixture builder script creates the messy account deterministically | Met | `src/fixture/builder.ts`, `dustin fixture create --profile messy`; the metric fixture `messy-20260929T111410Z-0b6cd8` built in ledgers 4931375 to 4931381 ([manifest](runs/20260929T111408Z-e4-cli/fixture-manifest.json), [build log](runs/20260929T111408Z-e4-cli/fixture-create.txt)); the account [on the explorer](https://stellar.expert/explorer/testnet/account/GCIVEA6YVJCSYE2Y7V2IUEYATOO36X7GQOAYNOI2MDNOW7HI4LPJVKZT) |
| Matrix: illiquid leftover balance | Met | S-01: `testnet/edge` › S-01; `testnet/ladder` › S-01, AC-E3-S2-1; the unclosable variant S-02 through the CLI ([`edge-frozen`](runs/20260928T125414Z-edge-frozen/summary.md)) |
| Matrix: sponsored trustline (reserve to sponsor) | Met | S-03: `testnet/sponsored-unwind` › S-03 and › AC-E3-S3-1; `execute/sponsors-observed` › S-03, AC-E3-S3-1 (offline) |
| Matrix: `ACCOUNT_MERGE_SEQNUM_TOO_FAR` | Met | S-04: `testnet/sequence-guard` (9 tests); `plan/guard-boundary` › S-04, AC-E3-S4-4 |
| Matrix: authorization-required trustline | Met | S-02, S-05, S-06: `testnet/edge` › S-02 (four tests), S-05, S-06 |
| Matrix: clawback-enabled trustline | Met | S-07: `testnet/edge` › S-07 (AC-E3-S6-4), S-07b |
| Matrix: liquidity pool shares detected and reported | Met | S-08: `testnet/edge` › S-08; `plan/blockers` › S-08 |
| Matrix: raised multisig thresholds detected and reported | Met | S-09: `testnet/edge` › S-09 (AC-E3-S5-5); `plan/blockers` › S-09 |
| Baseline recording of the existing tool stopping on the fixture | Pending | `<pending: builder records the Demolisher baseline on messy-20260926T035942Z (matrix B-01, B-02) per evidence/baseline/README.md, with the step where it stops>` |
| Test run screenshot | Met: the images rendered from the captured output, accepted by the builder (PRD decision D-16), and a screenshot of the CI run page `<pending: builder captures evidence/tests/ci-run-<run id>.png>` | [`evidence/tests/offline.png`](tests/offline.png), [`evidence/tests/testnet.png`](tests/testnet.png) and the complete output beside them ([`evidence/tests/`](tests/README.md)); the live tier in CI on the 0.1.0 code, [Testnet tier, run 36560464977](https://github.com/0xsimoneth/dustin/actions/runs/36560464977) on `ab1fdae` (11 files, 58 tests, 342 s), and the offline tier [CI, run 36560430762](https://github.com/0xsimoneth/dustin/actions/runs/36560430762) on Node 22.12.0, 22 and 24 |

**Evidence (SOW 6.1: test results screenshot + public repo + baseline recording):**

- Test command: `npm test` (offline) and `DUSTIN_TESTNET=1 npm run test:testnet` (live). Offline: 125 files, 1236 tests passed on commit `e5634709d8cecc92eda0c259ce528e60b4a041fc` (2026-09-30; `evidence/tests/offline.txt`). Live: 11 files, 58 tests in 345 s on the same commit in CI, [Testnet tier, run 36757533611](https://github.com/0xsimoneth/dustin/actions/runs/36757533611) (its complete log, `evidence/tests/testnet-ci-36757533611.txt`); the same on the 0.1.0 code (commit `ab1fdae`), [Testnet tier, run 36560464977](https://github.com/0xsimoneth/dustin/actions/runs/36560464977), 2026-09-29, 342 s (`evidence/tests/testnet-ci-36560464977.txt`); and a local run on commit `049274f` (2026-09-28), 301 s ([`evidence/tests/`](tests/README.md))
- Baseline recording: `<pending: builder records the Demolisher baseline>`

**Deviations:** two fixtures instead of one for the week-3 wording (canonical decision 3): `messy` carries the metric and is closed; `edge` carries the deliberately illiquid, issuer-frozen asset that exits through the unclosable path with its reason. The chapter lead's written acknowledgement of this reading is `<pending: chapter lead's acknowledgement>`. Two matrix rows beyond the SOW-named cases have no live test (X-05, destination validation, and X-09, an incoming payment after the plan; both have offline tests), and the test matrix gives their reasons.

**Effort:** planned 40 hours / $1,000 — actual `<pending: builder's hours>` / `<pending>`

### Deliverable 4 — Documentation, demo and evidence

**Planned (SOW):** public repository with README and integration notes; write-up covering ordering rules and known limits; 60-second demo video; evidence package with transaction hashes and explorer links; npm publication (week 4).

**Delivered:** the README, the integration notes, the write-up and the evidence package, written for 0.1.0 (their stories stay open until the builder's items are in); the demo script as a rehearsal the builder follows, which the independent review ran as written; `SECURITY.md` and `CONTRIBUTING.md`; the package prepared as `stellar-dustin` 0.1.0. The video, the npm publish and the baseline recording the package links are pending.

**Completion criteria mapping:**

| Criterion | Status | Evidence |
|---|---|---|
| README and integration notes | Met | [README.md](../README.md), [docs/integration-notes.md](../docs/integration-notes.md) |
| Write-up: ordering rules and what is not handled | Met | [docs/write-up.md](../docs/write-up.md) |
| 60-second demo video | Produced, hosting pending | 59.8 s, 1920 x 1080, captions burned in and as `.srt`, the explorer's pages from StellarExpert, SHA-256 `6d2fe4c0afc2be94cb2b5cf056fcda4c1bb5a314a34903d87cda13b8538740dc` (the take of 2026-09-30); `<pending: builder approves and hosts the 60-second video (E4-S6)>`; script [docs/demo-video-script.md](../docs/demo-video-script.md); link slot [evidence/demo/README.md](demo/README.md) |
| Evidence package with hashes and explorer links | Met | [evidence/README.md](README.md) |
| npm package published | Pending | `<pending: builder publishes stellar-dustin 0.1.0 to npm>`; until then the README gives the from-source path |

**Deviations:** none in scope; the documentation plan's `CONTRIBUTING.md` and `CHANGELOG.md` sit beside the documents the SOW names.

**Effort:** planned 20 hours / $500 — actual `<pending: builder's hours>` / `<pending>`

## C. Weekly plan versus actual (SOW section 5.1)

| Week | Planned work (SOW) | Expected output (SOW) | Actual output | Dates |
|---|---|---|---|---|
| 1 — Inventory and planner | Build fixture; run the existing tool and record where it stops; write inspector and ordering logic; CLI | Correct dry-run plan for the fixture printed in the CLI; baseline recording | Fixture built and its dry-run plan committed; inspector, planner and `dustin plan` done. The baseline recording is pending (the builder's). | Plan committed 2026-09-26 |
| 2 — Simple close, end to end | `executeClose()` for cases with no leftover balance; fee sponsorship wired | Zero-XLM account closed on testnet with sponsored fees; hashes; account gone | Delivered early: zero-spendable messy accounts closed through the SDK and the CLI with sponsor-paid fee bumps; Horizon 404 | 2026-09-26 and 2026-09-27 (planned week 2026-09-29 to 2026-10-05) |
| 3 — Leftover balance ladder | Disposal ladder; sponsored trustline unwinding; sequence guard; edge-case matrix; close the full fixture | Messy fixture closed; tests pass including the illiquid asset via the unclosable path | Delivered early: the ladder with its fall-back, the sponsored unwind with the observed release, the sequence-guard wait, the 32-row matrix, the metric close, and the illiquid frozen asset's unclosable exit on the `edge` fixture | 2026-09-28 (planned week 2026-10-06 to 2026-10-12) |
| 4 — Publish and demo | Error handling and CLI polish; npm publish; 60-second demo; evidence package; write-up | Demo, evidence package, write-up; D1 to D3 closed | Being done early: CLI output and error handling polish (stories E4-S1 and E4-S2: machine mode with `--json`, the `--verbose` detail, the interruption on SIGINT or SIGTERM, the hidden prompt, `docs/errors.md` and the JSON schemas), the test evidence (E4-S3), the write-up, the integration notes and the evidence package on 2026-09-28; the independent pre-release review, its fixes and the metric close on the 0.1.0 code on 2026-09-29. The video was produced on 2026-09-29 and again on 2026-09-30, with StellarExpert's pages. Pending, the builder's: the npm publish, the video's hosting, the baseline recording that closes D3 | from 2026-09-28 (planned week 2026-10-13 to 2026-10-19) |

## D. Evidence verification checklist (SOW section 6.2, for the chapter lead)

| Deliverable | Evidence present | Evidence partial | Evidence missing | Comments |
|---|---|---|---|---|
| Deliverable 1: `planClose()` | ☐ | ☐ | ☐ | |
| Deliverable 2: live close on testnet | ☐ | ☐ | ☐ | |
| Deliverable 3: edge cases and tests | ☐ | ☐ | ☐ | |
| Documentation, demo and evidence | ☐ | ☐ | ☐ | |

## E. Hours and budget summary (SOW section 4.2)

The planned hours are the SOW's. Actual hours are the builder's to report; none are estimated here.

| Item | Planned hours | Actual hours | Planned budget | Actual (hours × $25) | Notes |
|---|---|---|---|---|---|
| D1 `planClose()` | 60 | `<pending: builder>` | $1,500 | `<pending>` | |
| D2 `executeClose()` | 80 | `<pending: builder>` | $2,000 | `<pending>` | |
| D3 Edge cases and test matrix | 40 | `<pending: builder>` | $1,000 | `<pending>` | |
| Documentation, demo and evidence | 20 | `<pending: builder>` | $500 | `<pending>` | |
| **Total** | **200** | `<pending: builder>` | **$5,000** | `<pending>` | The award is fixed at $5,000; actual hours are reported for transparency, not for re-billing |

No infrastructure, hosting or subscription costs were budgeted: the testnet Horizon and Friendbot are free, and every fixture and sponsor was funded from Friendbot. `<pending: builder confirms no unbudgeted costs were incurred>`

## F. Deviations and scope changes

The accepted SOW is the contract. The decisions below were recorded in [`docs/README.md`](../docs/README.md) (canonical decisions) and [`docs/prd.md`](../docs/prd.md) ("Decisions after review", D-1 to D-16) and change scope, wording or the form of the evidence; none removes a deliverable.

- **Scope reading.**
  - Canonical decision 1: SDK and CLI only, no frontend, backend or contract (the SOW names a CLI demo as the interface).
  - Canonical decision 3: two fixtures, because the week-3 wording cannot hold on one account; "0 XLM" read as zero spendable. The chapter lead's written acknowledgement is `<pending: chapter lead's acknowledgement>`.
  - Canonical decision 11: merge blockers (sponsoring, pool shares, raised thresholds, `AUTH_IMMUTABLE`, a missing or memo-required destination) are detected and reported, not resolved.
- **Names and interface.**
  - Canonical decision 2: the package is `stellar-dustin` with the command `dustin`, because the bare npm name belongs to an unrelated package.
  - Canonical decision 4: `dustin close --execute` with a typed confirmation of the destination's last four characters, `--yes` for scripts, `--partial` for partial closes; PRD decision D-11 replaced the draft's secret file with a hidden prompt.
  - Canonical decision 5 and PRD decision D-6: the exit codes 0 to 6, with a budget or sponsor refusal as 3, "nothing executed".
  - PRD decision D-2: the SDK keeps the names it was built with; there is no resume option, because running the close again continues from the ledger. PRD decision D-13: only the commands that are built are documented (no `dustin baseline` or `dustin evidence build`; the evidence runs are written by `scripts/evidence-cli.mjs` and the live close test).
- **Behaviour.**
  - Canonical decision 6: "the minimum number of transactions" read as the fewest under the 100-operation limit, the isolation of market steps and a fresh preflight before the merge.
  - Canonical decision 8 and PRD decision D-1: the SOW ladder order is the default; `--prefer-destination` is an added option.
  - PRD decision D-9: the slippage bound defaults to 100 basis points. PRD decision D-10: the sequence guard's time-dependent fields left the plan hash.
- **Evidence form.**
  - PRD decision D-4: the live closes ran on fresh messy fixtures, with evidence in `evidence/runs/`.
  - PRD decision D-8: the forced payment of a frozen balance is proven by a negative probe and by a trustline revoked after planning, since the planner never plans a payment it knows will fail.
  - The baseline fixture is kept for the recording; its own close follows it (matrix row B-03).
- **Engineering decisions without scope effect:** D-3 (the CI seed scan), D-5 (pauses of at least 200 ms), D-7 (a history rewrite postponed), D-12 and canonical decision 15 (third-party work cited by project name and URL), D-15 (the CLI's 120-column output and asset form), D-16 (the rendered test images kept, with a CI screenshot beside them).
- **Timeline.** Weeks 2 and 3 were delivered early (by 2026-09-28, day 7); week-4 work began on day 7. `<pending: builder states the delivery date of the remaining items>`.
- **Out-of-scope items (SOW section 4.1) confirmed untouched:** mainnet (refused, `MAINNET_REFUSED`); contract accounts (refused, `CONTRACT_ACCOUNT`); liquidity pool withdrawal (detected, `LIQUIDITY_POOL_SHARES`); raised-threshold multisig automation (detected, `THRESHOLD_UNMET`, `MASTER_KEY_DISABLED`); claimable balance cleanup (not done; an account that created claimable balances is `IS_SPONSOR`); production key management (the sponsor key stays an environment variable or a hidden prompt); wallet UI (none); third-party wallet integration (none).

## G. Known limits and open issues

The full list, with the code, the reason and what a user can do, is in the [write-up](../docs/write-up.md), section 8. In short:

- Unclosable items: a trustline that is not authorized (`TRUSTLINE_NOT_AUTHORIZED`) or authorized to maintain liabilities only (`MAINTAIN_LIABILITIES_ONLY`); a balance with no route (`NO_DISPOSAL_ROUTE`); pool shares and the asset trustlines of a held pool (`LIQUIDITY_POOL_SHARES`, `POOL_ASSET_TRUSTLINE`).
- Merge blockers: `IS_SPONSOR`, `AUTH_IMMUTABLE_SET`, `THRESHOLD_UNMET`, `MASTER_KEY_DISABLED`, `DESTINATION_MISSING`, `DESTINATION_IS_SELF`, `DESTINATION_REQUIRES_MEMO`, `SEQNUM_TOO_FAR`, `ACCOUNT_MISSING`.
- Release limits: only the master key signs; one close per account at a time.
- Testnet reset: the next reset, scheduled for 2026-12-16 17:00 UTC, deletes every account and transaction; the evidence that depends on live testnet state is also committed as files ([what survives](README.md#what-survives-a-testnet-reset)).
- Test matrix: 27 of 32 rows are green; B-03 is planned (after the baseline recording), B-01 and B-02 are the builder's recordings, and X-05 and X-09 have offline tests but no live test ([test matrix](../docs/test-matrix.md), with each row's reason).
- Security: the sponsor key is an environment variable, a `.env` entry or a hidden prompt; Dustin is not for mainnet.

## H. Next-step alignment (SOW section 7)

`<pending: builder selects the next step and writes the reasoning>`

Selected option: ☐ Apply to SCF Build Award / ☐ Continue independently / ☐ Apply for a follow-on Instaward / ☐ Seek other ecosystem support / ☐ Other

The options considered during planning are in [`docs/next-steps/scf-path.md`](../docs/next-steps/scf-path.md), and the mainnet gate that would have to close before any mainnet use is in [`docs/next-steps/mainnet-readiness.md`](../docs/next-steps/mainnet-readiness.md); both are outside this SOW.

## I. Evidence quality checklist (the builder completes it before sending)

- [ ] Every URL opened in a fresh browser session (no login) and reaches the intended page
- [ ] Repository is public; commit SHA or tag for this report is stated in the header
- [ ] Every transaction hash links to a public testnet explorer page
- [ ] The closed account link shows "not found" (or the explorer's equivalent), captured also as a screenshot in case the testnet is reset
- [ ] The demo video is uploaded to a stable host and covers the full close, start to finish
- [ ] The baseline recording shows the existing tool's stopping point clearly, with the fixture address visible
- [ ] Every deliverable is addressed, including incomplete ones with an explanation and a plan
- [ ] No secret keys, environment files or personal data appear in any evidence artifact
- [ ] Testnet reset risk noted: evidence that depends on live testnet state is also committed as files

## Assumptions

1. Figures are copied from the committed evidence under `evidence/runs/`, `evidence/plan/` and `docs/test-matrix.md` as of 2026-09-28; the builder re-checks them if a later run replaces any.
2. Hours are reported by the builder; this draft states only the SOW's planned hours.
3. The chapter lead verifies the evidence in a browser only, as SOW section 6 requires.

## Sources

- Accepted SOW: [`SUCCESSFUL_SOW.md`](../SUCCESSFUL_SOW.md), sections 4.1, 4.2, 5.1, 6.1, 6.2, 7, Appendix A and Appendix B
- Template: [`docs/next-steps/instaward-completion-report-template.md`](../docs/next-steps/instaward-completion-report-template.md)
- Evidence package: [`evidence/README.md`](README.md); write-up: [`docs/write-up.md`](../docs/write-up.md); test matrix: [`docs/test-matrix.md`](../docs/test-matrix.md)
- Decisions: [`docs/README.md`](../docs/README.md) (canonical decisions 1 to 15), [`docs/prd.md`](../docs/prd.md) (D-1 to D-13)
