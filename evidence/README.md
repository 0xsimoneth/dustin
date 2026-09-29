# Dustin evidence package

This page is for the chapter lead, and it is the page to read first. It maps the accepted Statement of Work ([`SUCCESSFUL_SOW.md`](../SUCCESSFUL_SOW.md)) to the evidence, row by row: section 6.1 (the planned evidence), section 6.2 (the verification checklist), Appendix A (the deliverable tracker) and Appendix B (the binary success metric). Nothing here needs any tool: every item is a file in this repository or a page that opens in a browser.

State on 2026-09-28 (sprint day 7 of 30). Four items are the builder's to do and are marked **pending** wherever they appear, never ticked: the recording of the existing tool on the baseline fixture, the 60-second video, the npm publish, and the chapter lead's written acknowledgement of the two-fixture reading ([what is pending](#pending-the-builders-actions)).

Explorer and Horizon links stop resolving at the next testnet reset, scheduled for 2026-12-16 17:00 UTC; the JSON, XDR and transcripts committed in each run directory are the durable record ([what survives a reset](#what-survives-a-testnet-reset)). Everything here is public data: public keys, hashes, envelopes and Horizon JSON, never a secret.

## A plain-language checklist

The chapter lead's copy of SOW section 6.2, with what to open and what to look for ([documentation plan](../docs/documentation-plan.md), section 7). Ten minutes end to end.

| Deliverable | Open this | You should see | State of the evidence |
|---|---|---|---|
| D1 `planClose()` | [`plan/fixture-plan.txt`](plan/fixture-plan.txt) | A numbered list of steps S01 to S12 ending in the merge, a reason ("why:") and a transaction for each, the fee bid paid by the sponsor, and a summary that says how much XLM reaches the destination. Its heading says "dry run: nothing is signed, nothing is submitted". | Present |
| D2 Live close | The [transaction chain](#the-transaction-chain-of-the-metric-close) below, then the closed account's [Horizon page](https://horizon-testnet.stellar.org/accounts/GCPPFHGLKA7GCBWJXBH4EXFXS3OXAMXFLOBAZLU2K3KKMO6JKZORNFW7) | Each transaction page names the sponsor as the fee account and the closed account as the source. The account's Horizon page answers "Resource Missing" with status 404: the account no longer exists. | Present; the video that SOW 6.1 also lists for D2 is pending (the builder's) |
| D3 Edge cases | The [test matrix](../docs/test-matrix.md), the images [`tests/offline.png`](tests/offline.png) and [`tests/testnet.png`](tests/testnet.png) of the green runs, then the [baseline protocol](baseline/README.md) | The seven SOW-named cases (illiquid balance, sponsored trustline, sequence number too far, authorization required, clawback enabled, liquidity pool shares, raised thresholds), each green at both levels; the unclosable exit of a frozen balance through the CLI ([`edge-frozen`](runs/20260928T125414Z-edge-frozen/summary.md)). | Tests present; the baseline recording is pending (the builder's) |
| Docs, demo, evidence | The [README](../README.md), the [write-up](../docs/write-up.md), this page | The write-up lists the ordering rules R1 to R9 and what is not handled, in plain language. | Present; the video is pending (the builder's) |

## SOW 6.2, the verification checklist

Left for the chapter lead to fill; not pre-ticked.

| Deliverable | Evidence Present | Evidence Partial | Evidence Missing | Comments |
|---|---|---|---|---|
| Deliverable 1 | ☐ | ☐ | ☐ | |
| Deliverable 2 | ☐ | ☐ | ☐ | |
| Deliverable 3 | ☐ | ☐ | ☐ | |
| Documentation, demo and evidence | ☐ | ☐ | ☐ | |

## SOW 6.1, row by row

| Deliverable | Evidence Type | Description (SOW 6.1) | Where it lives | State |
|---|---|---|---|---|
| Deliverable 1: `planClose()` | Public repo + CLI output | Run the dry run yourself against any testnet account and read the plan it prints, or read the committed output for the fixture account in the repo. | Repository https://github.com/0xsimoneth/dustin. The committed output for the builder's fixture account: [`plan/fixture-plan.txt`](plan/fixture-plan.txt) and [`plan/fixture-plan.json`](plan/fixture-plan.json) (fixture `messy-20260926T035942Z`, captured 2026-09-26 at ledger 4,875,055). The plan of the metric account right before its close: [`runs/20260928T112252Z-e3-cli/plan.txt`](runs/20260928T112252Z-e3-cli/plan.txt). Run it yourself: `dustin plan <account> --to <destination>` ([README](../README.md#quick-start-cli)). | Present |
| Deliverable 2: Live close on testnet | Transaction hashes (links) + 60-second video | Open the linked transaction chain on a public testnet explorer, then look up the closed account and see that it no longer exists. The video shows the same close from the CLI, start to finish. | The [transaction chain](#the-transaction-chain-of-the-metric-close) and the closed account below; the run directory [`runs/20260928T112252Z-e3-cli/`](runs/20260928T112252Z-e3-cli/summary.md). The video: `<pending: builder records the 60-second video (E4-S6)>`, placeholder in [`demo/README.md`](demo/README.md). | Hashes and account present; video pending |
| Deliverable 3: Edge cases and tests | Test results screenshot + public repo + baseline recording | See the passing test matrix, then clone the repo and run it yourself against the fixture account. The baseline recording shows the existing tool stopping on the same account, so the gap can be checked rather than taken on trust. | The [test matrix](../docs/test-matrix.md) (32 rows, each with its tests and last run); the tests under [`test/`](../test/); the test results in [`tests/`](tests/README.md): the complete output of a green run of each tier on commit `0df4d09` (offline: 113 files, 1057 tests; live: 11 files, 58 tests in 301 s) and an image of each summary, [`offline.png`](tests/offline.png) and [`testnet.png`](tests/testnet.png), rendered from the captured output rather than captured from a screen; run it yourself: [README, Run the tests yourself](../README.md#run-the-tests-yourself). The baseline: [`baseline/README.md`](baseline/README.md) (the protocol), recording `<pending: builder records the Demolisher baseline (E1-S2, matrix B-01 and B-02)>`. | Tests and matrix present; baseline recording pending |
| Documentation, demo and evidence | Public repo + write-up + 60-second video | Read a short write-up covering the ordering rules and what is not handled, and watch the full close from the CLI, start to finish. | [README](../README.md), [write-up](../docs/write-up.md), [integration notes](../docs/integration-notes.md), this evidence package; the demo script [`docs/demo-video-script.md`](../docs/demo-video-script.md). The video: `<pending: builder records the 60-second video (E4-S6)>`. | Write-up, notes and package present; video pending |

## SOW Appendix B, row by row

The binary success metric, checked against the CLI metric close of 2026-09-28 ([`runs/20260928T112252Z-e3-cli/`](runs/20260928T112252Z-e3-cli/summary.md), story E3-S7). The SDK run of the same minute, [`runs/20260928T112239Z-e3/`](runs/20260928T112239Z-e3/summary.md), holds the same files for its own account and meets every row too.

| # | Appendix B item | Status | Evidence |
|---|---|---|---|
| 1 | Fixture account on testnet holds zero spendable XLM | ☑ | [`fixture-verification.json`](runs/20260928T112252Z-e3-cli/fixture-verification.json): balance 4.0000000 XLM, minimum balance 4.0000000 XLM, spendable 0, checked right before the close |
| 2 | Fixture holds at least 3 trustlines with non-zero balances | ☑ | same file: 4 (DUSTA 0.0000007, DUSTB 0.0000003, DUSTC 0.0000005, SPTA 0.0000001, the last one sponsored by a separate reserve sponsor) |
| 3 | Fixture holds at least 1 open offer | ☑ | same file: 2 open offers |
| 4 | Fixture holds at least 1 data entry | ☑ | same file: 1 data entry (`dustin.fixture`) |
| 5 | Every transaction in the close is fee-bumped by the sponsor (the closed account pays no fee) | ☑ | [`tx-1.json`](runs/20260928T112252Z-e3-cli/tx-1.json), [`tx-2.json`](runs/20260928T112252Z-e3-cli/tx-2.json), [`tx-3.json`](runs/20260928T112252Z-e3-cli/tx-3.json): Horizon's records show `fee_account` = the sponsor, `source_account` = the closed account and inner `max_fee` 0; on the explorer: [tx 1](https://stellar.expert/explorer/testnet/tx/0ee9fb5e4bb683519af3190e45c6e0350a0819aa509d65fddb34a247e65dcaac), [tx 2](https://stellar.expert/explorer/testnet/tx/f7161ce4667cc9b3457aa6daa948f8b39df847b0576ab73849ac7325ad81f700), [tx 3](https://stellar.expert/explorer/testnet/tx/36e53646514a36c673830955b661b91de297842481295f458de8c5911e5c989c) |
| 6 | The account no longer exists on a public testnet explorer | ☑ | [`account-after.json`](runs/20260928T112252Z-e3-cli/account-after.json): Horizon answered HTTP 404; [explorer page of the account](https://stellar.expert/explorer/testnet/account/GCPPFHGLKA7GCBWJXBH4EXFXS3OXAMXFLOBAZLU2K3KKMO6JKZORNFW7), [Horizon](https://horizon-testnet.stellar.org/accounts/GCPPFHGLKA7GCBWJXBH4EXFXS3OXAMXFLOBAZLU2K3KKMO6JKZORNFW7) |
| 7 | The full transaction chain is linkable from the evidence package | ☑ | [`summary.md`](runs/20260928T112252Z-e3-cli/summary.md) (every hash with its explorer link), [`report.json`](runs/20260928T112252Z-e3-cli/report.json) (both envelopes of every transaction as XDR), [`transcript.txt`](runs/20260928T112252Z-e3-cli/transcript.txt) (the command's output, with the receipt) |

The destination received exactly 4.0000007 XLM: the fixture's 4.0000000 XLM plus 0.0000007 XLM from selling DUSTA. The reserve sponsor's `num_sponsoring` went from 1 to 0 and its minimum balance from 1.5 to 1.0 XLM, with its XLM balance unchanged: the sponsored trustline's reserve went back to the sponsor, never to the closed account.

## SOW Appendix A: the deliverable tracker

### Sprint calendar (actual)

| Sprint week | Dates | SOW expected output | State on 2026-09-28 |
|---|---|---|---|
| Day 1 | 2026-09-22 | Funds received; sprint clock starts | Done |
| Week 1 | 2026-09-22 to 2026-09-28 | Fixture built, Demolisher baseline recorded, planClose() dry run printed | Fixture built (2026-09-26) and dry run committed ([`plan/`](plan/fixture-plan.txt)); the Demolisher baseline recording is pending (the builder's) |
| Week 2 | 2026-09-29 to 2026-10-05 | Zero-XLM account closed end to end with sponsored fees | Delivered early, on 2026-09-26 ([`runs/20260926T125350Z/`](runs/20260926T125350Z/summary.md)) |
| Week 3 | 2026-10-06 to 2026-10-12 | Disposal ladder, sponsored unwind, sequence guard, test matrix, messy fixture closed | Delivered early, on 2026-09-28 (the metric close, the [test matrix](../docs/test-matrix.md), the [wait](runs/20260928T125223Z-e3s4-wait/summary.md), the [unclosable exit](runs/20260928T125414Z-edge-frozen/summary.md)) |
| Week 4 | 2026-10-13 to 2026-10-19 | npm publish, 60-second demo, evidence package, write-up | Being done early: write-up, integration notes and this evidence package on 2026-09-28; the npm publish and the video are pending (the builder's) |
| Buffer | 2026-10-20 to 2026-10-22 | Review fixes; **final deadline 2026-10-22** | |

### Tracker

| # | Deliverable | Status | Evidence link |
|---|---|---|---|
| D1 | `planClose()` read-only planner + CLI dry run | ☑ Done | [`plan/fixture-plan.txt`](plan/fixture-plan.txt), [`plan/fixture-plan.json`](plan/fixture-plan.json); the dry-run tests in the [test matrix](../docs/test-matrix.md) (row M-01) |
| D2 | `executeClose()` fee-sponsored close on testnet | ☑ Done | The metric close: [`runs/20260928T112252Z-e3-cli/`](runs/20260928T112252Z-e3-cli/summary.md) (CLI) and [`runs/20260928T112239Z-e3/`](runs/20260928T112239Z-e3/summary.md) (SDK); the 60-second video SOW 6.1 lists for D2 is tracked under D4 |
| D3 | Edge cases, fixture account, baseline recording, test matrix | ◐ In progress: the fixture builder, the edge cases and the test matrix are done; the baseline recording is pending (the builder's, E1-S2) | [Test matrix](../docs/test-matrix.md) (27 of 32 rows green, B-03 planned, 2 not covered, B-01 and B-02 human action), [`tests/`](tests/README.md), [`runs/20260928T125414Z-edge-frozen/`](runs/20260928T125414Z-edge-frozen/summary.md), [`baseline/README.md`](baseline/README.md) |
| D4 | README, integration notes, write-up, 60s demo, evidence package | ◐ In progress: the README, the integration notes, the write-up and this evidence package are done; the 60-second video and the npm publish are pending (the builder's) | [README](../README.md), [integration notes](../docs/integration-notes.md), [write-up](../docs/write-up.md), this page; [`demo/README.md`](demo/README.md) (video placeholder) |

## The transaction chain of the metric close

### Capture record

| Field | Value |
|---|---|
| Network | Stellar testnet, passphrase `Test SDF Network ; September 2015`, Horizon https://horizon-testnet.stellar.org |
| Close performed on | 2026-09-28, 11:23:45 to 11:24:03 UTC (`dustin close --execute`, exit code 0) |
| Ledger range of the close | 4914209 to 4914211 |
| Code at capture | commit `d6cd66ef8d7fcf0e46163667e1a13c20c1f02d6a` (the complete Epic 3 code); the run was committed in `562d5420b0002ec3af32b788a6d1826c72e10d45` |
| npm package and version | not published; `stellar-dustin` 0.1.0 is prepared and its publish is pending (the builder's) |
| Fixture | `messy-20260928T112252Z-580d8f`, built from Friendbot at 11:22:52 UTC in ledgers 4914199 to 4914205 |
| Next announced testnet reset | 2026-12-16 17:00 UTC |

### Accounts

| Role | Address | Links |
|---|---|---|
| Closed account (the fixture) | `GCPPFHGLKA7GCBWJXBH4EXFXS3OXAMXFLOBAZLU2K3KKMO6JKZORNFW7` | [explorer](https://stellar.expert/explorer/testnet/account/GCPPFHGLKA7GCBWJXBH4EXFXS3OXAMXFLOBAZLU2K3KKMO6JKZORNFW7), [Horizon](https://horizon-testnet.stellar.org/accounts/GCPPFHGLKA7GCBWJXBH4EXFXS3OXAMXFLOBAZLU2K3KKMO6JKZORNFW7) (404 after the close) |
| Destination | `GDPZI3OAYYEAXTYY2OHFDZAEEG4PXNBN7AHNLQTEH22O5HTBGBSVB2TS` | [explorer](https://stellar.expert/explorer/testnet/account/GDPZI3OAYYEAXTYY2OHFDZAEEG4PXNBN7AHNLQTEH22O5HTBGBSVB2TS), [Horizon](https://horizon-testnet.stellar.org/accounts/GDPZI3OAYYEAXTYY2OHFDZAEEG4PXNBN7AHNLQTEH22O5HTBGBSVB2TS) |
| Fee sponsor (fee account of every transaction) | `GBCHRHGJMTMA2MNEVJWZL5GRYXQ3OF5CRKVMZHPFPASSW2DBLPQFEHOG` | [explorer](https://stellar.expert/explorer/testnet/account/GBCHRHGJMTMA2MNEVJWZL5GRYXQ3OF5CRKVMZHPFPASSW2DBLPQFEHOG), [Horizon](https://horizon-testnet.stellar.org/accounts/GBCHRHGJMTMA2MNEVJWZL5GRYXQ3OF5CRKVMZHPFPASSW2DBLPQFEHOG) |
| Reserve sponsor (sponsored the SPTA trustline) | `GCFMPHR7TIPDOYD2UHXSE2PLWIMFYIEWC2NQ3N4RKLSSDVXODU5REILD` | [explorer](https://stellar.expert/explorer/testnet/account/GCFMPHR7TIPDOYD2UHXSE2PLWIMFYIEWC2NQ3N4RKLSSDVXODU5REILD), [Horizon](https://horizon-testnet.stellar.org/accounts/GCFMPHR7TIPDOYD2UHXSE2PLWIMFYIEWC2NQ3N4RKLSSDVXODU5REILD) |
| Issuer of DUSTA, DUSTB, DUSTC and SPTA | `GCCRAGHQYDLZET7XYSCRIVHWSRMA2UJWTBFLCPJT7RMCQ2JP4SS3X2EX` | [explorer](https://stellar.expert/explorer/testnet/account/GCCRAGHQYDLZET7XYSCRIVHWSRMA2UJWTBFLCPJT7RMCQ2JP4SS3X2EX) |
| Market maker (the bid that bought DUSTA) | `GBTV2OLUNFMAIWCQU6KW2VNXSTZK2R2H4DTPDKZ6GUTLHWTLIPHH7LL2` | [explorer](https://stellar.expert/explorer/testnet/account/GBTV2OLUNFMAIWCQU6KW2VNXSTZK2R2H4DTPDKZ6GUTLHWTLIPHH7LL2) |

### The three transactions

Every row has the sponsor as the fee account and the closed account as the source: that is Appendix B row 5. The last row is the merge.

| # | Purpose | Operations in the inner transaction | Hash (the fee bump's) | Inner hash | Ledger | Closed (UTC) | Fee charged to the sponsor | Links |
|---|---|---|---|---|---|---|---|---|
| 1 | Cleanup | cancel offers 828521 and 828522; return DUSTB, DUSTC and SPTA to their issuer (burn) and remove each trustline; delete the data entry `dustin.fixture` (9 operations) | `0ee9fb5e4bb683519af3190e45c6e0350a0819aa509d65fddb34a247e65dcaac` | `cf6c648de8f55e1011951b64c5c5ebe88ea0de71b4dd093f9e7b09846b6ef40a` | 4914209 | 11:23:52 | 1,000 stroops | [explorer](https://stellar.expert/explorer/testnet/tx/0ee9fb5e4bb683519af3190e45c6e0350a0819aa509d65fddb34a247e65dcaac), [Horizon](https://horizon-testnet.stellar.org/transactions/0ee9fb5e4bb683519af3190e45c6e0350a0819aa509d65fddb34a247e65dcaac), [record](runs/20260928T112252Z-e3-cli/tx-1.json) |
| 2 | Sale | sell 0.0000007 DUSTA for XLM by strict-send path payment to the account itself; remove the DUSTA trustline (2 operations) | `f7161ce4667cc9b3457aa6daa948f8b39df847b0576ab73849ac7325ad81f700` | `93e1103db1b6bd514a0dc8b34d3ef1d9045fb647367dbd90a8b353796aed435d` | 4914210 | 11:23:57 | 300 stroops | [explorer](https://stellar.expert/explorer/testnet/tx/f7161ce4667cc9b3457aa6daa948f8b39df847b0576ab73849ac7325ad81f700), [Horizon](https://horizon-testnet.stellar.org/transactions/f7161ce4667cc9b3457aa6daa948f8b39df847b0576ab73849ac7325ad81f700), [record](runs/20260928T112252Z-e3-cli/tx-2.json) |
| 3 | Merge | merge into the destination (1 operation) | `36e53646514a36c673830955b661b91de297842481295f458de8c5911e5c989c` | `aa140dc126168f0a01f261e362e32edbc088365930859f45ea9c4d3c846b9801` | 4914211 | 11:24:02 | 200 stroops | [explorer](https://stellar.expert/explorer/testnet/tx/36e53646514a36c673830955b661b91de297842481295f458de8c5911e5c989c), [Horizon](https://horizon-testnet.stellar.org/transactions/36e53646514a36c673830955b661b91de297842481295f458de8c5911e5c989c), [record](runs/20260928T112252Z-e3-cli/tx-3.json) |

The fee sponsor paid 1,500 stroops (0.0001500 XLM) in all, against a bid of 1,262,430 stroops within a 5 XLM budget; the fee arithmetic is in the [write-up](../docs/write-up.md), section 5.

### Before and after: the fixture account

| Item | Before (checked at 11:23:37 UTC) | After |
|---|---|---|
| Account on the ledger | yes ([`account-before.json`](runs/20260928T112252Z-e3-cli/account-before.json)) | no: Horizon HTTP 404 ([`account-after.json`](runs/20260928T112252Z-e3-cli/account-after.json)) |
| XLM balance | 4.0000000 | merged into the destination, whose balance went from 10.0000000 to 14.0000007 XLM ([`balances.json`](runs/20260928T112252Z-e3-cli/balances.json)) |
| Spendable XLM | 0.0000000 | |
| Minimum balance | 4.0000000 = (2 + 7 subentries − 1 sponsored) × 0.5 XLM | |
| DUSTA 0.0000007 | trustline with dust | sold for 0.0000007 XLM in tx 2, trustline removed |
| DUSTB 0.0000003 | trustline with dust | returned to its issuer (burned) in tx 1, trustline removed |
| DUSTC 0.0000005 | trustline with dust | returned to its issuer (burned) in tx 1, trustline removed |
| SPTA 0.0000001 | trustline with dust, reserve paid by the reserve sponsor | returned to its issuer (burned) in tx 1, trustline removed; its 0.5 XLM reserve released to the reserve sponsor (`num_sponsoring` 1 to 0, minimum balance 1.5 to 1.0 XLM, XLM balance 10.0000000 unchanged) |
| Open offers | 2 (828521, 828522) | cancelled in tx 1 |
| Data entries | 1 (`dustin.fixture`) | deleted in tx 1 |
| Fees paid by the account | 0 | 0 |
| Fees paid by the fee sponsor | | 1,500 stroops (9865.9997200 to 9865.9995700 XLM) |

### How the fixture was built (supporting evidence for Deliverable 3)

From the run's [`fixture-manifest.json`](runs/20260928T112252Z-e3-cli/fixture-manifest.json); every build transaction after the first is fee-bumped by the fee sponsor.

| Step | Ledger | Hash |
|---|---|---|
| create-accounts (not fee-bumped) | 4914199 | [`5e49966e0cf3f6b2131a30dcf2d9c51c807cde5f012f65c2d4746c6ca3d83d84`](https://stellar.expert/explorer/testnet/tx/5e49966e0cf3f6b2131a30dcf2d9c51c807cde5f012f65c2d4746c6ca3d83d84) |
| trustlines | 4914200 | [`854f69519bee0124d983fa43df9279a0075b8e9bdd1847383310c4dc0f5ffed3`](https://stellar.expert/explorer/testnet/tx/854f69519bee0124d983fa43df9279a0075b8e9bdd1847383310c4dc0f5ffed3) |
| sponsored-trustline | 4914201 | [`25bf0820b6d94a2bb901de043737f9819949b5841918451cd1f8d458b7583bb2`](https://stellar.expert/explorer/testnet/tx/25bf0820b6d94a2bb901de043737f9819949b5841918451cd1f8d458b7583bb2) |
| dust-payments | 4914202 | [`7136d9cf968100d3052049199f6b862ed31cc6972b1a5d91d6512f1a70a82e0c`](https://stellar.expert/explorer/testnet/tx/7136d9cf968100d3052049199f6b862ed31cc6972b1a5d91d6512f1a70a82e0c) |
| market-maker-bid | 4914203 | [`e96c0b3292dfe313a9b4d0b8274b50cd25957c478c60b39e510af26444092c9b`](https://stellar.expert/explorer/testnet/tx/e96c0b3292dfe313a9b4d0b8274b50cd25957c478c60b39e510af26444092c9b) |
| offers-and-data | 4914204 | [`5adedcdebc60758cbcd176f1dbeff31437ae13446d428bc986d52efbfb059f06`](https://stellar.expert/explorer/testnet/tx/5adedcdebc60758cbcd176f1dbeff31437ae13446d428bc986d52efbfb059f06) |
| drain-to-minimum | 4914205 | [`9bd9b8dbfd5c7bd607c1169ae4be5ee08a4ffc6a78f870ff15220aad52eece56`](https://stellar.expert/explorer/testnet/tx/9bd9b8dbfd5c7bd607c1169ae4be5ee08a4ffc6a78f870ff15220aad52eece56) |

## The other recorded runs

Every run directory holds its own `summary.md` with the accounts, the hashes and the links; the layout and how to reproduce a run are in [`runs/README.md`](runs/README.md).

| Run | What it shows | Result |
|---|---|---|
| [`runs/20260928T112239Z-e3/`](runs/20260928T112239Z-e3/summary.md) | The metric close through the SDK (`executeClose()`), story E3-S7 | 3 fee bumps in ledgers 4914192 to 4914194; 4.0000007 XLM merged; 1,500 stroops paid by the sponsor; Horizon 404 |
| [`runs/20260928T125223Z-e3s4-wait/`](runs/20260928T125223Z-e3s4-wait/summary.md) | The sequence-guard wait through the CLI (story E3-S4, matrix row S-04): a BumpSequence to (4915280 + 12) << 32; the command runs the cleanup and the sale, prints the wait ("the merge can land from ledger 4,915,293") and merges in ledger 4915293, the unblocking ledger itself | exit 0; no merge refused with `op_seq_num_too_far`; Horizon 404 |
| [`runs/20260928T125414Z-edge-frozen/`](runs/20260928T125414Z-edge-frozen/summary.md) | The SOW's week-3 unclosable exit on the `edge` fixture (62 of 62 checks): a frozen FRZ trustline from an AUTH_REQUIRED + AUTH_REVOCABLE issuer, `TRUSTLINE_NOT_AUTHORIZED` with the issuer and the remedy | exit 3 without `--partial` (sequence number unchanged); exit 4 with it: the illiquid ILQX burned, its trustline and the data entry removed, FRZ left under "Not closed" |
| [`runs/20260928T125528Z-e3s2-partial/`](runs/20260928T125528Z-e3s2-partial/summary.md) | A memo-required issuer (SEP-29, story E3-S2): DUSTA sold, DUSTC sent to the destination, DUSTB and SPTA `NO_DISPOSAL_ROUTE` with every rung ruled out | exit 3 without `--partial`; exit 4 with it and the partial-close receipt |
| [`runs/20260926T125350Z/`](runs/20260926T125350Z/summary.md) | The first live close, week 2, through the SDK (story E2-S6) | 3 fee bumps; 4.0000007 XLM merged; Horizon 404 |
| [`runs/20260927T200015Z-cli/`](runs/20260927T200015Z-cli/summary.md) | The first live close through the CLI, week 2 | exit 0; Horizon 404 |

The tests, on the merged code of stories E4-S1 to E4-S3 (commit `0df4d09`, 2026-09-28): the offline tier passed 113 files and 1057 tests, and the whole live tier 11 files and 58 tests in 301 s against the public testnet, with every account built from Friendbot. The complete output of both runs, every transaction hash the live tests printed, and an image of each summary are in [`tests/`](tests/README.md). The last CI run of the live tier is [Testnet tier, run 36424696971](https://github.com/0xsimoneth/dustin/actions/runs/36424696971), on commit `d0d711c` (10 files, 51 tests, 321 s).

## Checking this page

`npm run evidence:check` (`scripts/evidence-check.mjs`, story E4-S3) reads this page and every `runs/*/summary.md`. Every relative link must point to a committed file, every transaction hash linked on Horizon or StellarExpert must answer 200 on testnet Horizon, and every other https link must answer below 400; a Horizon `/accounts/<id>` that answers 404 is listed as "account gone", which is what a closed account shows. It sends GET requests only, refuses any network but the testnet, and needs the internet; after the testnet reset of 2026-12-16 it fails by design. Its run on 2026-09-28 at 22:48 UTC, on this page and the seven run summaries: 8 files, 219 links; 210 ok, 5 "account gone" (the closed metric account `GCPPFHGLKA7GCBWJXBH4EXFXS3OXAMXFLOBAZLU2K3KKMO6JKZORNFW7`, linked three times on this page, and the closed account of the sequence-guard wait, twice in its summary), 4 skipped (links to headings of this page), 0 failed; exit code 0.

## What survives a testnet reset

| Item | Survives the reset of 2026-12-16 | Notes |
|---|---|---|
| Explorer and Horizon links on this page and in each `summary.md` | no | After the reset the network no longer knows the addresses and hashes. |
| `report.json` of every run | yes | Every transaction with its hash, ledger, fee, fee account, result codes, and both envelopes (inner and fee bump) as XDR. Decoding a fee-bump envelope with the SDK shows its fee source (the sponsor) and its inner source (the account), and its hash is the explorer's. |
| `tx-<n>.json`, `account-before.json`, `account-after.json`, `balances.json` | yes | Horizon's own answers at the time: the fee account and the source of each transaction, the account before the close, and the 404 after it. |
| `transcript.txt`, `plan.txt`, `plan.json`, `fixture-verification.json` | yes | The command's output with the receipt, the dry-run plan, and the Appendix B checks before the close. |
| The video and the baseline recording | yes, once recorded | Pending (the builder's); hosted outside the repository, linked here. |
| The fixture accounts | no, but rebuilt in one command | `dustin fixture create --profile messy`; `node scripts/evidence-cli.mjs metric` records a fresh metric close with new links. After a reset, `dustin fixture verify` stops with `RESET_SUSPECTED` (exit 3) when the manifest records a ledger beyond Horizon's latest one or an account of the fixture answers 404 with no history on Horizon; a merged fixture account keeps its history and is reported as closed instead (matrix row X-15). |

If the review happens after a reset, the builder re-runs the fixture builder and the close and adds a new run directory; the runs of 2026-09-28 stay here as the record of the first capture.

## Pending: the builder's actions

None of these is done, and none is ticked anywhere in this package.

| Item | SOW | What is needed | Where it will be linked |
|---|---|---|---|
| Baseline recording of the existing tool on the baseline fixture `messy-20260926T035942Z` (matrix B-01, then B-02 with 1 XLM added) | 4.1 D3, 5.1 week 1, 6.1 D3 | The builder records the StellarExpert Account Demolisher on the fixture, following [`baseline/README.md`](baseline/README.md) | `<pending: builder records the Demolisher baseline>` in [`baseline/README.md`](baseline/README.md) and in 6.1 above |
| Dustin's close of the rebuilt baseline fixtures (matrix B-03) | 6.1 D3 ("the same account") | After the recordings | a new directory under `runs/` |
| The 60-second video | 5.1 week 4, 6.1 D2 and docs row | The builder records it following [`docs/demo-video-script.md`](../docs/demo-video-script.md) and uploads it | `<pending: builder records the 60-second video (E4-S6)>` in [`demo/README.md`](demo/README.md), the README and 6.1 above |
| The npm publish of `stellar-dustin` 0.1.0 | 5.1 week 4 | `npm publish` from the builder's account, with 2FA | `<pending: builder publishes stellar-dustin 0.1.0 to npm>` in the README |
| The chapter lead's written acknowledgement of the two-fixture reading of week 3 ([canonical decision 3](../docs/README.md)) | 5.1 week 3 | The chapter lead confirms that `messy` carries the metric and `edge` carries the unclosable exit | `<pending: chapter lead's acknowledgement>` |

The completion report that goes to the chapter lead is drafted in [`completion-report.md`](completion-report.md), for the builder to finish and send.

## Assumptions

1. The metric is judged on the CLI metric close of 2026-09-28; the SDK run and the week-2 closes are corroborating evidence. Both metric closes ran on fresh fixtures built from the recipe of the builder's baseline fixture, which is kept for the recording (canonical decision 3; matrix rows B-01 to B-03).
2. The explorer's wording for a merged account is its own; the Horizon 404 is the check that does not depend on a third-party site.
3. "Done" in the Appendix A tracker means the evidence is committed and linked here; the chapter lead's verdict is the SOW 6.2 table above.

## Sources

- Accepted SOW, sections 6.1, 6.2, Appendix A and Appendix B: [`SUCCESSFUL_SOW.md`](../SUCCESSFUL_SOW.md)
- The run layout and how to reproduce a run: [`runs/README.md`](runs/README.md); the test matrix: [`docs/test-matrix.md`](../docs/test-matrix.md)
- Template: [`docs/evidence/evidence-package-template.md`](../docs/evidence/evidence-package-template.md); reviewer checklist: [`docs/documentation-plan.md`](../docs/documentation-plan.md), section 7
- Testnet resets (2 to 4 a year, announced ahead, deleting every account and transaction): https://developers.stellar.org/docs/networks
- Horizon, retrieve an account (a 404 means the account is not on the ledger): https://developers.stellar.org/docs/data/apis/horizon/api-reference/retrieve-an-account
- Fee-bump transactions (the fee account pays; the inner source signs): https://developers.stellar.org/docs/build/guides/transactions/fee-bump-transactions
