# Dustin evidence package

This page is for the chapter lead, and it is the page to read first. It maps the accepted Statement of Work ([`SUCCESSFUL_SOW.md`](../SUCCESSFUL_SOW.md)) to the evidence, row by row: section 6.1 (the planned evidence), section 6.2 (the verification checklist), Appendix A (the deliverable tracker) and Appendix B (the binary success metric). Nothing here needs any tool: every item is a file in this repository or a page that opens in a browser.

State on 2026-09-29 (sprint day 8 of 30). Four items are the builder's to do and are marked **pending** wherever they appear, never ticked: the recording of the existing tool on the baseline fixture, the 60-second video, the npm publish, and the chapter lead's written acknowledgement of the two-fixture reading ([what is pending](#pending-the-builders-actions)).

Explorer and Horizon links stop resolving at the next testnet reset, scheduled for 2026-12-16 17:00 UTC; the JSON, XDR and transcripts committed in each run directory are the durable record ([what survives a reset](#what-survives-a-testnet-reset)). Everything here is public data: public keys, hashes, envelopes and Horizon JSON, never a secret.

## A plain-language checklist

The chapter lead's copy of SOW section 6.2, with what to open and what to look for ([documentation plan](../docs/documentation-plan.md), section 7). Ten minutes end to end.

| Deliverable | Open this | You should see | State of the evidence |
|---|---|---|---|
| D1 `planClose()` | [`runs/20260929T111408Z-e4-cli/plan.txt`](runs/20260929T111408Z-e4-cli/plan.txt), the plan the 0.1.0 code printed | A numbered list of steps S01 to S12 ending in the merge, a reason ("why:") and a transaction for each, the fee bid paid by the sponsor, and a summary that says how much XLM reaches the destination. Its heading says "dry run: nothing is signed, nothing is submitted". | Present |
| D2 Live close | The [transaction chain](#the-transaction-chain-of-the-metric-close) below, then the closed account's [Horizon page](https://horizon-testnet.stellar.org/accounts/GCIVEA6YVJCSYE2Y7V2IUEYATOO36X7GQOAYNOI2MDNOW7HI4LPJVKZT) | Each transaction page names the sponsor as the fee account and the closed account as the source. The account's Horizon page answers "Resource Missing" with status 404: the account no longer exists. | Partial until the video: the live close is present and linked; the 60-second video that SOW 6.1 lists for D2 is pending (the builder's) |
| D3 Edge cases | The [test matrix](../docs/test-matrix.md), the images [`tests/offline.png`](tests/offline.png) and [`tests/testnet.png`](tests/testnet.png) of the green runs, then the [baseline protocol](baseline/README.md) | The seven SOW-named cases (illiquid balance, sponsored trustline, sequence number too far, authorization required, clawback enabled, liquidity pool shares, raised thresholds), each green at both levels; the unclosable exit of a frozen balance through the CLI ([`edge-frozen`](runs/20260928T125414Z-edge-frozen/summary.md)). | Tests present; the baseline recording is pending (the builder's) |
| Docs, demo, evidence | The [README](../README.md), the [write-up](../docs/write-up.md), this page | The write-up lists the ordering rules R1 to R9 and what is not handled, in plain language. | Written; the video is pending (the builder's) |

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
| Deliverable 1: `planClose()` | Public repo + CLI output | Run the dry run yourself against any testnet account and read the plan it prints, or read the committed output for the fixture account in the repo. | Repository https://github.com/0xsimoneth/dustin. The plan the 0.1.0 code prints, for the metric account right before its close: [`runs/20260929T111408Z-e4-cli/plan.txt`](runs/20260929T111408Z-e4-cli/plan.txt) and [`plan.json`](runs/20260929T111408Z-e4-cli/plan.json) (2026-09-29, ledger 4,931,383). The committed output for the builder's baseline fixture: [`plan/fixture-plan.txt`](plan/fixture-plan.txt) and [`plan/fixture-plan.json`](plan/fixture-plan.json) (fixture `messy-20260926T035942Z`, captured 2026-09-26 at ledger 4,875,055, before the output was polished, so it reads "0 XLM" where the final code prints "0.0000000 XLM"). Run it yourself: `dustin plan <account> --to <destination>` ([README](../README.md#quick-start-cli)). | Present |
| Deliverable 2: Live close on testnet | Transaction hashes (links) + 60-second video | Open the linked transaction chain on a public testnet explorer, then look up the closed account and see that it no longer exists. The video shows the same close from the CLI, start to finish. | The [transaction chain](#the-transaction-chain-of-the-metric-close) and the closed account below; the run directory [`runs/20260929T111408Z-e4-cli/`](runs/20260929T111408Z-e4-cli/summary.md), on the 0.1.0 code, and the first recording of 2026-09-28, [`runs/20260928T112252Z-e3-cli/`](runs/20260928T112252Z-e3-cli/summary.md). The video: `<pending: builder records the 60-second video (E4-S6)>`, placeholder in [`demo/README.md`](demo/README.md). | Hashes and account present; video pending |
| Deliverable 3: Edge cases and tests | Test results screenshot + public repo + baseline recording | See the passing test matrix, then clone the repo and run it yourself against the fixture account. The baseline recording shows the existing tool stopping on the same account, so the gap can be checked rather than taken on trust. | The [test matrix](../docs/test-matrix.md) (32 rows, each with its tests and last run); the tests under [`test/`](../test/); the test results in [`tests/`](tests/README.md): the complete output of a green run of each tier on commit `0df4d09` (offline: 113 files, 1057 tests; live: 11 files, 58 tests in 301 s) and an image of each summary, [`offline.png`](tests/offline.png) and [`testnet.png`](tests/testnet.png), rendered from the captured output rather than captured from a screen; run it yourself: [README, Run the tests yourself](../README.md#run-the-tests-yourself). The baseline: [`baseline/README.md`](baseline/README.md) (the protocol), recording `<pending: builder records the Demolisher baseline (E1-S2, matrix B-01 and B-02)>`. | Tests and matrix present; baseline recording pending |
| Documentation, demo and evidence | Public repo + write-up + 60-second video | Read a short write-up covering the ordering rules and what is not handled, and watch the full close from the CLI, start to finish. | [README](../README.md), [write-up](../docs/write-up.md), [integration notes](../docs/integration-notes.md), this evidence package; the demo script [`docs/demo-video-script.md`](../docs/demo-video-script.md). The video: `<pending: builder records the 60-second video (E4-S6)>`. | Write-up, notes and package written; video pending |

## SOW Appendix B, row by row

The binary success metric, checked against the latest CLI metric close, on the 0.1.0 code of 2026-09-29 ([`runs/20260929T111408Z-e4-cli/`](runs/20260929T111408Z-e4-cli/summary.md)). The first recordings of the same close, on 2026-09-28 through the CLI ([`runs/20260928T112252Z-e3-cli/`](runs/20260928T112252Z-e3-cli/summary.md), the run the ticked boxes of `SUCCESSFUL_SOW.md` Appendix B link) and through the SDK ([`runs/20260928T112239Z-e3/`](runs/20260928T112239Z-e3/summary.md)), hold the same files for their own accounts and meet every row too.

| # | Appendix B item | Status | Evidence |
|---|---|---|---|
| 1 | Fixture account on testnet holds zero spendable XLM | ☑ | [`fixture-verification.json`](runs/20260929T111408Z-e4-cli/fixture-verification.json): balance 4.0000000 XLM, minimum balance 4.0000000 XLM, spendable 0, checked right before the close |
| 2 | Fixture holds at least 3 trustlines with non-zero balances | ☑ | same file: 4 (DUSTA 0.0000007, DUSTB 0.0000003, DUSTC 0.0000005, SPTA 0.0000001, the last one sponsored by a separate reserve sponsor) |
| 3 | Fixture holds at least 1 open offer | ☑ | same file: 2 open offers (838443, 838444) |
| 4 | Fixture holds at least 1 data entry | ☑ | same file: 1 data entry (`dustin.fixture`) |
| 5 | Every transaction in the close is fee-bumped by the sponsor (the closed account pays no fee) | ☑ | [`tx-1.json`](runs/20260929T111408Z-e4-cli/tx-1.json), [`tx-2.json`](runs/20260929T111408Z-e4-cli/tx-2.json), [`tx-3.json`](runs/20260929T111408Z-e4-cli/tx-3.json): Horizon's records show `fee_account` = the sponsor, `source_account` = the closed account and inner `max_fee` 0; on the explorer: [tx 1](https://stellar.expert/explorer/testnet/tx/835457ceff4b0443ec52ebbb408edc8988627e5de8442d28dda85b3331b52a5b), [tx 2](https://stellar.expert/explorer/testnet/tx/c6c99beddca7685293bdb0e156e320cbb4189e4247e4451578b60e82ba76de61), [tx 3](https://stellar.expert/explorer/testnet/tx/dd56e18f152dc7f15ee370dce9b8ddae556e90f04dd1cd52fe3281df4bf118e2) |
| 6 | The account no longer exists on a public testnet explorer | ☑ | [`account-after.json`](runs/20260929T111408Z-e4-cli/account-after.json): Horizon answered HTTP 404; [explorer page of the account](https://stellar.expert/explorer/testnet/account/GCIVEA6YVJCSYE2Y7V2IUEYATOO36X7GQOAYNOI2MDNOW7HI4LPJVKZT), [Horizon](https://horizon-testnet.stellar.org/accounts/GCIVEA6YVJCSYE2Y7V2IUEYATOO36X7GQOAYNOI2MDNOW7HI4LPJVKZT) |
| 7 | The full transaction chain is linkable from the evidence package | ☑ | [`summary.md`](runs/20260929T111408Z-e4-cli/summary.md) (every hash with its explorer link), [`report.json`](runs/20260929T111408Z-e4-cli/report.json) (both envelopes of every transaction as XDR, with each transaction's operations and links), [`transcript.txt`](runs/20260929T111408Z-e4-cli/transcript.txt) (the command's output, with the receipt) |

The destination received exactly 4.0000007 XLM: the fixture's 4.0000000 XLM plus 0.0000007 XLM from selling DUSTA. The reserve sponsor's `num_sponsoring` went from 1 to 0 and its minimum balance from 1.5 to 1.0 XLM, with its XLM balance unchanged: the sponsored trustline's reserve went back to the sponsor, never to the closed account.

## SOW Appendix A: the deliverable tracker

### Sprint calendar (actual)

| Sprint week | Dates | SOW expected output | State on 2026-09-29 |
|---|---|---|---|
| Day 1 | 2026-09-22 | Funds received; sprint clock starts | Done |
| Week 1 | 2026-09-22 to 2026-09-28 | Fixture built, Demolisher baseline recorded, planClose() dry run printed | Fixture built (2026-09-26) and dry run committed ([`plan/`](plan/fixture-plan.txt)); the Demolisher baseline recording is pending (the builder's) |
| Week 2 | 2026-09-29 to 2026-10-05 | Zero-XLM account closed end to end with sponsored fees | Delivered early, on 2026-09-26 ([`runs/20260926T125350Z/`](runs/20260926T125350Z/summary.md)) |
| Week 3 | 2026-10-06 to 2026-10-12 | Disposal ladder, sponsored unwind, sequence guard, test matrix, messy fixture closed | Delivered early, on 2026-09-28 (the metric close, the [test matrix](../docs/test-matrix.md), the [wait](runs/20260928T125223Z-e3s4-wait/summary.md), the [unclosable exit](runs/20260928T125414Z-edge-frozen/summary.md)) |
| Week 4 | 2026-10-13 to 2026-10-19 | npm publish, 60-second demo, evidence package, write-up | Started early: the write-up, the integration notes and this evidence package are written, 0.1.0 is prepared, and the metric close was recorded again on the 0.1.0 code on 2026-09-29; the npm publish and the video are pending (the builder's) |
| Buffer | 2026-10-20 to 2026-10-22 | Review fixes; **final deadline 2026-10-22** | |

### Tracker

| # | Deliverable | Status | Evidence link |
|---|---|---|---|
| D1 | `planClose()` read-only planner + CLI dry run | ☑ Done | The plan the 0.1.0 code prints, [`runs/20260929T111408Z-e4-cli/plan.txt`](runs/20260929T111408Z-e4-cli/plan.txt) (2026-09-29); the baseline fixture's plan, [`plan/fixture-plan.txt`](plan/fixture-plan.txt) and [`plan/fixture-plan.json`](plan/fixture-plan.json) (2026-09-26); the dry-run tests in the [test matrix](../docs/test-matrix.md) (row M-01) |
| D2 | `executeClose()` fee-sponsored close on testnet | ◐ In progress: the live close is done and linked; the 60-second video that SOW 6.1 lists for D2 is pending (the builder's) | The metric close on the 0.1.0 code, [`runs/20260929T111408Z-e4-cli/`](runs/20260929T111408Z-e4-cli/summary.md) (CLI, 2026-09-29); the first recordings, [`runs/20260928T112252Z-e3-cli/`](runs/20260928T112252Z-e3-cli/summary.md) (CLI) and [`runs/20260928T112239Z-e3/`](runs/20260928T112239Z-e3/summary.md) (SDK); the video slot, [`demo/README.md`](demo/README.md) |
| D3 | Edge cases, fixture account, baseline recording, test matrix | ◐ In progress: the fixture builder, the edge cases and the test matrix are done; the baseline recording is pending (the builder's, E1-S2) | [Test matrix](../docs/test-matrix.md) (27 of 32 rows green, B-03 planned, 2 not covered, B-01 and B-02 human action), [`tests/`](tests/README.md), [`runs/20260928T125414Z-edge-frozen/`](runs/20260928T125414Z-edge-frozen/summary.md), [`baseline/README.md`](baseline/README.md) |
| D4 | README, integration notes, write-up, 60s demo, evidence package | ◐ In progress: the README, the integration notes, the write-up and this evidence package are written, and their stories stay open; pending (the builder's): the 60-second video, the npm publish, and the baseline recording this package links | [README](../README.md), [integration notes](../docs/integration-notes.md), [write-up](../docs/write-up.md), this page; [`demo/README.md`](demo/README.md) (video placeholder) |

## The transaction chain of the metric close

The latest CLI metric close, recorded by `node scripts/evidence-cli.mjs metric e4-cli` on the 0.1.0 code. The first recording of 2026-09-28 is listed under [the other recorded runs](#the-other-recorded-runs).

### Capture record

| Field | Value |
|---|---|
| Network | Stellar testnet, passphrase `Test SDF Network ; September 2015`, Horizon https://horizon-testnet.stellar.org |
| Close performed on | 2026-09-29, 11:15:11 to 11:15:29 UTC (`dustin close --execute --yes --report`, exit code 0) |
| Ledger range of the close | 4931386 to 4931388 |
| Code at capture | the build of commit `7bd04ae` (the 0.1.0 code with the fixes of the Epic 4 review); the run was committed in `37e6e93` |
| npm package and version | `stellar-dustin` 0.1.0, prepared; its publish is the builder's and pending |
| Fixture | `messy-20260929T111410Z-0b6cd8`, built from Friendbot at 11:14:10 UTC in ledgers 4931375 to 4931381 |
| Next announced testnet reset | 2026-12-16 17:00 UTC |

### Accounts

| Role | Address | Links |
|---|---|---|
| Closed account (the fixture) | `GCIVEA6YVJCSYE2Y7V2IUEYATOO36X7GQOAYNOI2MDNOW7HI4LPJVKZT` | [explorer](https://stellar.expert/explorer/testnet/account/GCIVEA6YVJCSYE2Y7V2IUEYATOO36X7GQOAYNOI2MDNOW7HI4LPJVKZT), [Horizon](https://horizon-testnet.stellar.org/accounts/GCIVEA6YVJCSYE2Y7V2IUEYATOO36X7GQOAYNOI2MDNOW7HI4LPJVKZT) (404 after the close) |
| Destination | `GBR43GJ2WAHU7FPEAYLNFR4WJUQMCJGOOS6ESF2O6ZBB6GVWL6FVS3OY` | [explorer](https://stellar.expert/explorer/testnet/account/GBR43GJ2WAHU7FPEAYLNFR4WJUQMCJGOOS6ESF2O6ZBB6GVWL6FVS3OY), [Horizon](https://horizon-testnet.stellar.org/accounts/GBR43GJ2WAHU7FPEAYLNFR4WJUQMCJGOOS6ESF2O6ZBB6GVWL6FVS3OY) |
| Fee sponsor (fee account of every transaction) | `GBDOAFW4WYIOVCBZNVI4CF4QOD2J3HZYMMQZSOF2LOSNZGZCSMVBIGMQ` | [explorer](https://stellar.expert/explorer/testnet/account/GBDOAFW4WYIOVCBZNVI4CF4QOD2J3HZYMMQZSOF2LOSNZGZCSMVBIGMQ), [Horizon](https://horizon-testnet.stellar.org/accounts/GBDOAFW4WYIOVCBZNVI4CF4QOD2J3HZYMMQZSOF2LOSNZGZCSMVBIGMQ) |
| Reserve sponsor (sponsored the SPTA trustline) | `GCKXIJUENGYY2LO6PYVDWIDMJ6XEXZZUOM3NBQR2BCAWODSSP6NNT7BB` | [explorer](https://stellar.expert/explorer/testnet/account/GCKXIJUENGYY2LO6PYVDWIDMJ6XEXZZUOM3NBQR2BCAWODSSP6NNT7BB), [Horizon](https://horizon-testnet.stellar.org/accounts/GCKXIJUENGYY2LO6PYVDWIDMJ6XEXZZUOM3NBQR2BCAWODSSP6NNT7BB) |
| Issuer of DUSTA, DUSTB, DUSTC and SPTA | `GARJTWEIMDGREFQHZPFNBM5XN5GTDYCTTCDBMMC2QPZQXHPFFTSLCVXL` | [explorer](https://stellar.expert/explorer/testnet/account/GARJTWEIMDGREFQHZPFNBM5XN5GTDYCTTCDBMMC2QPZQXHPFFTSLCVXL) |
| Market maker (the bid that bought DUSTA) | `GCSA2THKGK7KLM3PZ4CZLGY7KT34VXZOCZCLUDOCZBF2KYUUGRLXKM5T` | [explorer](https://stellar.expert/explorer/testnet/account/GCSA2THKGK7KLM3PZ4CZLGY7KT34VXZOCZCLUDOCZBF2KYUUGRLXKM5T) |

### The three transactions

Every row has the sponsor as the fee account and the closed account as the source: that is Appendix B row 5. The last row is the merge.

| # | Purpose | Operations in the inner transaction | Hash (the fee bump's) | Inner hash | Ledger | Closed (UTC) | Fee charged to the sponsor | Links |
|---|---|---|---|---|---|---|---|---|
| 1 | Cleanup | cancel offers 838443 and 838444; return DUSTB, DUSTC and SPTA to their issuer (burn) and remove each trustline; delete the data entry `dustin.fixture` (9 operations) | `835457ceff4b0443ec52ebbb408edc8988627e5de8442d28dda85b3331b52a5b` | `dcdbd48e109cb5e63dac00de87c235dabfc00e19819f9d870e89a30d0c2ef396` | 4931386 | 11:15:17 | 1,000 stroops | [explorer](https://stellar.expert/explorer/testnet/tx/835457ceff4b0443ec52ebbb408edc8988627e5de8442d28dda85b3331b52a5b), [Horizon](https://horizon-testnet.stellar.org/transactions/835457ceff4b0443ec52ebbb408edc8988627e5de8442d28dda85b3331b52a5b), [record](runs/20260929T111408Z-e4-cli/tx-1.json) |
| 2 | Sale | sell 0.0000007 DUSTA for XLM by strict-send path payment to the account itself; remove the DUSTA trustline (2 operations) | `c6c99beddca7685293bdb0e156e320cbb4189e4247e4451578b60e82ba76de61` | `8ce327efd55a2e42c153d03cb9025d1c6dda7eefab5c6d46782f640bf2054c7f` | 4931387 | 11:15:22 | 300 stroops | [explorer](https://stellar.expert/explorer/testnet/tx/c6c99beddca7685293bdb0e156e320cbb4189e4247e4451578b60e82ba76de61), [Horizon](https://horizon-testnet.stellar.org/transactions/c6c99beddca7685293bdb0e156e320cbb4189e4247e4451578b60e82ba76de61), [record](runs/20260929T111408Z-e4-cli/tx-2.json) |
| 3 | Merge | merge into the destination (1 operation) | `dd56e18f152dc7f15ee370dce9b8ddae556e90f04dd1cd52fe3281df4bf118e2` | `c45bb68d9f57857d26b6779a5ed2a9188330cfc94ce5e96186ffce035014472d` | 4931388 | 11:15:27 | 200 stroops | [explorer](https://stellar.expert/explorer/testnet/tx/dd56e18f152dc7f15ee370dce9b8ddae556e90f04dd1cd52fe3281df4bf118e2), [Horizon](https://horizon-testnet.stellar.org/transactions/dd56e18f152dc7f15ee370dce9b8ddae556e90f04dd1cd52fe3281df4bf118e2), [record](runs/20260929T111408Z-e4-cli/tx-3.json) |

The fee sponsor paid 1,500 stroops (0.0001500 XLM) in all, against a bid of 462,795 stroops (30,853 per counted operation) within a 5 XLM budget; the fee arithmetic is in the [write-up](../docs/write-up.md), section 5.

### Before and after: the fixture account

| Item | Before (checked at 11:15:01 UTC) | After |
|---|---|---|
| Account on the ledger | yes ([`account-before.json`](runs/20260929T111408Z-e4-cli/account-before.json)) | no: Horizon HTTP 404 ([`account-after.json`](runs/20260929T111408Z-e4-cli/account-after.json)) |
| XLM balance | 4.0000000 | merged into the destination, whose balance went from 10.0000000 to 14.0000007 XLM ([`balances.json`](runs/20260929T111408Z-e4-cli/balances.json)) |
| Spendable XLM | 0.0000000 | |
| Minimum balance | 4.0000000 = (2 + 7 subentries − 1 sponsored) × 0.5 XLM | |
| DUSTA 0.0000007 | trustline with dust | sold for 0.0000007 XLM in tx 2, trustline removed |
| DUSTB 0.0000003 | trustline with dust | returned to its issuer (burned) in tx 1, trustline removed |
| DUSTC 0.0000005 | trustline with dust | returned to its issuer (burned) in tx 1, trustline removed |
| SPTA 0.0000001 | trustline with dust, reserve paid by the reserve sponsor | returned to its issuer (burned) in tx 1, trustline removed; its 0.5 XLM reserve released to the reserve sponsor (`num_sponsoring` 1 to 0, minimum balance 1.5 to 1.0 XLM, XLM balance 10.0000000 unchanged) |
| Open offers | 2 (838443, 838444) | cancelled in tx 1 |
| Data entries | 1 (`dustin.fixture`) | deleted in tx 1 |
| Fees paid by the account | 0 | 0 |
| Fees paid by the fee sponsor | | 1,500 stroops (9865.9997200 to 9865.9995700 XLM) |

### How the fixture was built (supporting evidence for Deliverable 3)

From the run's [`fixture-manifest.json`](runs/20260929T111408Z-e4-cli/fixture-manifest.json) and [`fixture-create.txt`](runs/20260929T111408Z-e4-cli/fixture-create.txt); every build transaction after the first is fee-bumped by the fee sponsor, and the build ends by checking that an unbumped transaction from the drained account is refused (`tx_insufficient_balance`).

| Step | Ledger | Hash |
|---|---|---|
| create-accounts (not fee-bumped) | 4931375 | [`68508092b92d9cd08fe377985d711575b2a26261b45ac67d281ef568d6dded03`](https://stellar.expert/explorer/testnet/tx/68508092b92d9cd08fe377985d711575b2a26261b45ac67d281ef568d6dded03) |
| trustlines | 4931376 | [`624dca48382cc5021101ee72f0d7838ca3854aa595427833b9f9b1a193fc7e3d`](https://stellar.expert/explorer/testnet/tx/624dca48382cc5021101ee72f0d7838ca3854aa595427833b9f9b1a193fc7e3d) |
| sponsored-trustline | 4931377 | [`1a4a89617763f94bd8366dbad2936539c66dab7bdf0618579133747f21976015`](https://stellar.expert/explorer/testnet/tx/1a4a89617763f94bd8366dbad2936539c66dab7bdf0618579133747f21976015) |
| dust-payments | 4931378 | [`221ba810b12ad87a8fb9fdfba019595b84fde36ab990a46e053501bf8f03f7e4`](https://stellar.expert/explorer/testnet/tx/221ba810b12ad87a8fb9fdfba019595b84fde36ab990a46e053501bf8f03f7e4) |
| market-maker-bid | 4931379 | [`1b87c6d5c3721171ea574590dfb5f18fe1ffb1506fd522761fe433f9f8756523`](https://stellar.expert/explorer/testnet/tx/1b87c6d5c3721171ea574590dfb5f18fe1ffb1506fd522761fe433f9f8756523) |
| offers-and-data | 4931380 | [`cf1b1ad4b6e64cabab79367ae2c0298a89b2eb80c3202e3dade7de990d0aaf2b`](https://stellar.expert/explorer/testnet/tx/cf1b1ad4b6e64cabab79367ae2c0298a89b2eb80c3202e3dade7de990d0aaf2b) |
| drain-to-minimum | 4931381 | [`7c80447e5466eb92d371036168d39baed785c333498355949dbec50cb160a61b`](https://stellar.expert/explorer/testnet/tx/7c80447e5466eb92d371036168d39baed785c333498355949dbec50cb160a61b) |

## The other recorded runs

Every run directory holds its own `summary.md` with the accounts, the hashes and the links; the layout and how to reproduce a run are in [`runs/README.md`](runs/README.md).

| Run | What it shows | Result |
|---|---|---|
| [`runs/20260928T112252Z-e3-cli/`](runs/20260928T112252Z-e3-cli/summary.md) | The first recording of the metric close through the CLI (story E3-S7), before the output was polished: account `GCPPFHGLKA7GCBWJXBH4EXFXS3OXAMXFLOBAZLU2K3KKMO6JKZORNFW7`, cleanup `0ee9fb5e4bb683519af3190e45c6e0350a0819aa509d65fddb34a247e65dcaac`, sale `f7161ce4667cc9b3457aa6daa948f8b39df847b0576ab73849ac7325ad81f700`, merge `36e53646514a36c673830955b661b91de297842481295f458de8c5911e5c989c` (ledgers 4914209 to 4914211); the run the ticked boxes of the SOW's Appendix B link | exit 0; 4.0000007 XLM merged; 1,500 stroops paid by the sponsor; Horizon 404 |
| [`runs/20260928T112239Z-e3/`](runs/20260928T112239Z-e3/summary.md) | The metric close through the SDK (`executeClose()`), story E3-S7 | 3 fee bumps in ledgers 4914192 to 4914194; 4.0000007 XLM merged; 1,500 stroops paid by the sponsor; Horizon 404 |
| [`runs/20260928T125223Z-e3s4-wait/`](runs/20260928T125223Z-e3s4-wait/summary.md) | The sequence-guard wait through the CLI (story E3-S4, matrix row S-04): a BumpSequence to (4915280 + 12) << 32; the command runs the cleanup and the sale, prints the wait ("the merge can land from ledger 4,915,293") and merges in ledger 4915293, the unblocking ledger itself | exit 0; no merge refused with `op_seq_num_too_far`; Horizon 404 |
| [`runs/20260928T125414Z-edge-frozen/`](runs/20260928T125414Z-edge-frozen/summary.md) | The SOW's week-3 unclosable exit on the `edge` fixture (62 of 62 checks): a frozen FRZ trustline from an AUTH_REQUIRED + AUTH_REVOCABLE issuer, `TRUSTLINE_NOT_AUTHORIZED` with the issuer and the remedy | exit 3 without `--partial` (sequence number unchanged); exit 4 with it: the illiquid ILQX burned, its trustline and the data entry removed, FRZ left under "Not closed" |
| [`runs/20260928T125528Z-e3s2-partial/`](runs/20260928T125528Z-e3s2-partial/summary.md) | A memo-required issuer (SEP-29, story E3-S2): DUSTA sold, DUSTC sent to the destination, DUSTB and SPTA `NO_DISPOSAL_ROUTE` with every rung ruled out | exit 3 without `--partial`; exit 4 with it and the partial-close receipt |
| [`runs/20260926T125350Z/`](runs/20260926T125350Z/summary.md) | The first live close, week 2, through the SDK (story E2-S6) | 3 fee bumps; 4.0000007 XLM merged; Horizon 404 |
| [`runs/20260927T200015Z-cli/`](runs/20260927T200015Z-cli/summary.md) | The first live close through the CLI, week 2 | exit 0; Horizon 404 |

The tests, on the merged code of stories E4-S1 to E4-S3 (commit `0df4d09`, 2026-09-28): the offline tier passed 113 files and 1057 tests, and the whole live tier 11 files and 58 tests in 301 s against the public testnet, with every account built from Friendbot. The complete output of both runs, every transaction hash the live tests printed, and an image of each summary are in [`tests/`](tests/README.md). The last CI run of the live tier is [Testnet tier, run 36424696971](https://github.com/0xsimoneth/dustin/actions/runs/36424696971), on commit `d0d711c` (10 files, 51 tests, 321 s).

## Checking this page

`npm run evidence:check` (`scripts/evidence-check.mjs`) reads every Markdown file under `evidence/`, this page and the run summaries among them, and the repository's `README.md` and `docs/write-up.md`:

- every relative link must name a file committed to the repository, and an anchor must be a heading of the file it points to;
- every transaction hash, linked on Horizon or StellarExpert or listed in a code span or a table cell, must answer 200 on testnet Horizon;
- an account linked on Horizon or StellarExpert is asked on testnet Horizon: a 404 whose history ends in the account's own `account_merge` is "gone (merged)", which is what the evidence shows for a closed account, while a 404 with no history at all is a failure;
- every other https link must answer below 400.

It sends GET requests only, refuses any network but the testnet without a request, and needs the internet; after the testnet reset of 2026-12-16 it fails by design. It exits 0 when every link is fine, 1 when one failed, 2 for a usage error, and 3 when none failed but one could not be checked (a network error, a timeout, HTTP 429 or 5xx after its retries, or a bot protection's 403). Its run of 2026-09-29 at 11:47 UTC, on the 16 files it reads by default (the Markdown files under `evidence/`, `README.md` and `docs/write-up.md`): 593 links and 12 listed transaction hashes; 579 ok, 24 "gone (merged)" (the closed accounts of the evidence, each with its own `account_merge`), 0 failed, and 2 unchecked: the SCF #44 round recap on medium.com, cited twice in the write-up, whose bot protection answered HTTP 403 to the automated check (open it in a browser). Exit code 3, "unchecked only".

## What survives a testnet reset

| Item | Survives the reset of 2026-12-16 | Notes |
|---|---|---|
| Explorer and Horizon links on this page and in each `summary.md` | no | After the reset the network no longer knows the addresses and hashes. |
| `report.json` of every run | yes | Every transaction with its hash, ledger, fee, fee account, result codes, and both envelopes (inner and fee bump) as XDR. Decoding a fee-bump envelope with the SDK shows its fee source (the sponsor) and its inner source (the account), and its hash is the explorer's. The report of the 0.1.0 run also names each transaction's operations. |
| `tx-<n>.json`, `account-before.json`, `account-after.json`, `balances.json` | yes | Horizon's own answers at the time: the fee account and the source of each transaction, the account before the close, and the 404 after it. |
| `transcript.txt`, `plan.txt`, `plan.json`, `fixture-verification.json` | yes | The command's output with the receipt, the dry-run plan, and the Appendix B checks before the close. |
| The video and the baseline recording | yes, once recorded | Pending (the builder's); hosted outside the repository, linked here. |
| The fixture accounts | no, but rebuilt in one command | `dustin fixture create --profile messy`; `node scripts/evidence-cli.mjs metric` records a fresh metric close with new links. After a reset, `dustin fixture verify` stops with `RESET_SUSPECTED` (exit 3) when none of the fixture's accounts exists and either Horizon's latest ledger is more than 120 ledgers behind the one the manifest records or none of the missing accounts has any history on Horizon. Before a reset it reports a merged account as closed, with its merge, and an account without history while others exist as never funded or merged before the oldest ledger Horizon keeps (matrix row X-15). |

If the review happens after a reset, the builder re-runs the fixture builder and the close and adds a new run directory; the runs of 2026-09-26 to 2026-09-29 stay here as the record of the first captures.

## Pending: the builder's actions

None of these is done, and none is ticked anywhere in this package.

| Item | SOW | What is needed | Where it will be linked |
|---|---|---|---|
| Baseline recording of the existing tool on the baseline fixture `messy-20260926T035942Z` (matrix B-01, then B-02 with 1 XLM added) | 4.1 D3, 5.1 week 1, 6.1 D3 | The builder records the StellarExpert Account Demolisher on the fixture, following [`baseline/README.md`](baseline/README.md) | `<pending: builder records the Demolisher baseline>` in [`baseline/README.md`](baseline/README.md) and in 6.1 above |
| Dustin's close of the rebuilt baseline fixtures (matrix B-03) | 6.1 D3 ("the same account") | After the recordings | a new directory under `runs/` |
| The 60-second video | 5.1 week 4, 6.1 D2 and docs row | The builder records it following [`docs/demo-video-script.md`](../docs/demo-video-script.md) and uploads it | `<pending: builder records the 60-second video (E4-S6)>` in [`demo/README.md`](demo/README.md), the README and 6.1 above |
| The npm publish of `stellar-dustin` 0.1.0 | 5.1 week 4 | `npm publish` from the builder's account, with 2FA | the README's install line names the package; `<pending: builder publishes stellar-dustin 0.1.0 to npm>` |
| The chapter lead's written acknowledgement of the two-fixture reading of week 3 ([canonical decision 3](../docs/README.md)) | 5.1 week 3 | The chapter lead confirms that `messy` carries the metric and `edge` carries the unclosable exit | `<pending: chapter lead's acknowledgement>` |

The completion report that goes to the chapter lead is drafted in [`completion-report.md`](completion-report.md), for the builder to finish and send.

## Assumptions

1. The metric is judged on the latest CLI metric close, on the 0.1.0 code of 2026-09-29; the closes of 2026-09-28 (CLI and SDK) and of week 2 are corroborating evidence. Every metric close ran on a fresh fixture built from the recipe of the builder's baseline fixture, which is kept for the recording (canonical decision 3; matrix rows B-01 to B-03).
2. The explorer's wording for a merged account is its own; the Horizon 404 is the check that does not depend on a third-party site.
3. "Done" in the Appendix A tracker means that every piece of evidence SOW 6.1 lists for the deliverable is committed and linked here; a deliverable with one piece pending is "in progress". The chapter lead's verdict is the SOW 6.2 table above.

## Sources

- Accepted SOW, sections 6.1, 6.2, Appendix A and Appendix B: [`SUCCESSFUL_SOW.md`](../SUCCESSFUL_SOW.md)
- The run layout and how to reproduce a run: [`runs/README.md`](runs/README.md); the test matrix: [`docs/test-matrix.md`](../docs/test-matrix.md)
- Template: [`docs/evidence/evidence-package-template.md`](../docs/evidence/evidence-package-template.md); reviewer checklist: [`docs/documentation-plan.md`](../docs/documentation-plan.md), section 7
- Testnet resets (2 to 4 a year, announced ahead, deleting every account and transaction): https://developers.stellar.org/docs/networks
- Horizon, retrieve an account (a 404 means the account is not on the ledger): https://developers.stellar.org/docs/data/apis/horizon/api-reference/retrieve-an-account
- Fee-bump transactions (the fee account pays; the inner source signs): https://developers.stellar.org/docs/build/guides/transactions/fee-bump-transactions
