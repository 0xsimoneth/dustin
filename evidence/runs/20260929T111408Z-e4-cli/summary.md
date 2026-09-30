# Live CLI close 20260929T111408Z-e4-cli

The Epic 3 metric close (story E3-S7; SOW Appendix B) driven end to end through the command line on a fresh `messy` fixture: `dustin fixture create --profile messy`, `dustin fixture verify`, the dry-run `dustin plan`, then `dustin close --execute --yes --report`, with the default ladder order (the SOW order).

Written by `node scripts/evidence-cli.mjs metric`. Public data only: public keys, hashes, envelopes and Horizon JSON. The secret keys reached `dustin close` through its environment only; every file here was scanned for secret seeds and for the fixture's secret keys before it was written.

## What the reviewer should see

1. `dustin fixture verify fixture-manifest.json --snapshot fixture-verification.json` exited 0: 12 of 12 checks passed right before the close, the four SOW Appendix B preconditions among them (holds zero spendable XLM: balance 4.0000000, minimum 4.0000000, native selling liabilities 0.0000000, spendable 0.0000000; at least 3 trustlines with non-zero balances: 4 (DUSTA 0.0000007, DUSTB 0.0000003, DUSTC 0.0000005, SPTA 0.0000001); at least 1 open offer: 2 (ids 838443, 838444); at least 1 data entry: 1 (dustin.fixture)). See `fixture-verify.txt` and `fixture-verification.json`.
2. `dustin plan GCIVEA6YVJCSYE2Y7V2IUEYATOO36X7GQOAYNOI2MDNOW7HI4LPJVKZT --to GBR43GJ2WAHU7FPEAYLNFR4WJUQMCJGOOS6ESF2O6ZBB6GVWL6FVS3OY --sponsor GBDOAFW4WYIOVCBZNVI4CF4QOD2J3HZYMMQZSOF2LOSNZGZCSMVBIGMQ` exited 0: status CLOSABLE, 3 transactions (cleanup (9 ops), convert (2 ops), merge (1 op)), every fee paid by the sponsor. See `plan.txt` and `plan.json`.
3. `dustin close GCIVEA6YVJCSYE2Y7V2IUEYATOO36X7GQOAYNOI2MDNOW7HI4LPJVKZT --to GBR43GJ2WAHU7FPEAYLNFR4WJUQMCJGOOS6ESF2O6ZBB6GVWL6FVS3OY --execute --yes --report report.json` exited 0: report status `closed`; the command itself checked the account gone ("Verifying GET /accounts/... -> 404"). See `transcript.txt`, with the receipt, and `report.json`.
4. On the explorer, each transaction of the close is a fee bump whose fee account is the sponsor and whose source is the account: tx 1 (cleanup, applied in ledger 4931386) [835457ceff4b0443ec52ebbb408edc8988627e5de8442d28dda85b3331b52a5b](https://stellar.expert/explorer/testnet/tx/835457ceff4b0443ec52ebbb408edc8988627e5de8442d28dda85b3331b52a5b); tx 2 (convert, applied in ledger 4931387) [c6c99beddca7685293bdb0e156e320cbb4189e4247e4451578b60e82ba76de61](https://stellar.expert/explorer/testnet/tx/c6c99beddca7685293bdb0e156e320cbb4189e4247e4451578b60e82ba76de61); tx 3 (merge, applied in ledger 4931388) [dd56e18f152dc7f15ee370dce9b8ddae556e90f04dd1cd52fe3281df4bf118e2](https://stellar.expert/explorer/testnet/tx/dd56e18f152dc7f15ee370dce9b8ddae556e90f04dd1cd52fe3281df4bf118e2). Horizon's records are in `tx-<n>.json`.
5. Horizon answers HTTP 404 for the account afterwards ([Horizon](https://horizon-testnet.stellar.org/accounts/GCIVEA6YVJCSYE2Y7V2IUEYATOO36X7GQOAYNOI2MDNOW7HI4LPJVKZT), `account-after.json`); the destination received the merged 4.0000007 XLM (`balances.json`).

## Run

| Field | Value |
|---|---|
| Captured (UTC) | 2026-09-29T11:15:30.670Z |
| Case | `metric` (story E3-S7, SOW Appendix B) |
| Network passphrase | `Test SDF Network ; September 2015` |
| Horizon | https://horizon-testnet.stellar.org |
| Fixture | messy-20260929T111410Z-0b6cd8 (profile messy) |
| Account | [GCIVEA6YVJCSYE2Y7V2IUEYATOO36X7GQOAYNOI2MDNOW7HI4LPJVKZT](https://stellar.expert/explorer/testnet/account/GCIVEA6YVJCSYE2Y7V2IUEYATOO36X7GQOAYNOI2MDNOW7HI4LPJVKZT) ([Horizon](https://horizon-testnet.stellar.org/accounts/GCIVEA6YVJCSYE2Y7V2IUEYATOO36X7GQOAYNOI2MDNOW7HI4LPJVKZT)) |
| Destination | [GBR43GJ2WAHU7FPEAYLNFR4WJUQMCJGOOS6ESF2O6ZBB6GVWL6FVS3OY](https://stellar.expert/explorer/testnet/account/GBR43GJ2WAHU7FPEAYLNFR4WJUQMCJGOOS6ESF2O6ZBB6GVWL6FVS3OY) ([Horizon](https://horizon-testnet.stellar.org/accounts/GBR43GJ2WAHU7FPEAYLNFR4WJUQMCJGOOS6ESF2O6ZBB6GVWL6FVS3OY)) |
| Fee sponsor (fee account of every transaction of the close) | [GBDOAFW4WYIOVCBZNVI4CF4QOD2J3HZYMMQZSOF2LOSNZGZCSMVBIGMQ](https://stellar.expert/explorer/testnet/account/GBDOAFW4WYIOVCBZNVI4CF4QOD2J3HZYMMQZSOF2LOSNZGZCSMVBIGMQ) ([Horizon](https://horizon-testnet.stellar.org/accounts/GBDOAFW4WYIOVCBZNVI4CF4QOD2J3HZYMMQZSOF2LOSNZGZCSMVBIGMQ)) |
| Reserve sponsor (sponsors the SPTA trustline) | [GCKXIJUENGYY2LO6PYVDWIDMJ6XEXZZUOM3NBQR2BCAWODSSP6NNT7BB](https://stellar.expert/explorer/testnet/account/GCKXIJUENGYY2LO6PYVDWIDMJ6XEXZZUOM3NBQR2BCAWODSSP6NNT7BB) ([Horizon](https://horizon-testnet.stellar.org/accounts/GCKXIJUENGYY2LO6PYVDWIDMJ6XEXZZUOM3NBQR2BCAWODSSP6NNT7BB)) |
| Issuer of DUSTA, DUSTB, DUSTC and SPTA | [GARJTWEIMDGREFQHZPFNBM5XN5GTDYCTTCDBMMC2QPZQXHPFFTSLCVXL](https://stellar.expert/explorer/testnet/account/GARJTWEIMDGREFQHZPFNBM5XN5GTDYCTTCDBMMC2QPZQXHPFFTSLCVXL) ([Horizon](https://horizon-testnet.stellar.org/accounts/GARJTWEIMDGREFQHZPFNBM5XN5GTDYCTTCDBMMC2QPZQXHPFFTSLCVXL)) |
| Ledgers | latest before the close 4931384; after it 4931388 |
| Report status | closed |
| Plan hash of the run | `c6ab874babbf474e6ce8ab16a70b5a27f4c847349190b8fe4a3b5d892fa03427` |
| Merged XLM (from the merge result) | 4.0000007 |
| Fees paid by the account / by the sponsor | 0 / 1500 stroops |
| Horizon for the account afterwards | HTTP 404 |

## Commands

Each ran as `node dist/cli/main.js` from this repository's build, shown here as `dustin`.

| # | Command | Expected exit | Exit | Output |
|---|---|---|---|---|
| 1 | `dustin fixture create --profile messy --dir .fixture --json` | 0 | 0 | `fixture-create.txt`, `fixture-manifest.json` |
| 2 | `dustin fixture verify fixture-manifest.json --snapshot fixture-verification.json` | 0 | 0 | `fixture-verify.txt` |
| 3 | `dustin plan GCIVEA6YVJCSYE2Y7V2IUEYATOO36X7GQOAYNOI2MDNOW7HI4LPJVKZT --to GBR43GJ2WAHU7FPEAYLNFR4WJUQMCJGOOS6ESF2O6ZBB6GVWL6FVS3OY --sponsor GBDOAFW4WYIOVCBZNVI4CF4QOD2J3HZYMMQZSOF2LOSNZGZCSMVBIGMQ` | 0 | 0 | `plan.txt` |
| 4 | `dustin plan GCIVEA6YVJCSYE2Y7V2IUEYATOO36X7GQOAYNOI2MDNOW7HI4LPJVKZT --to GBR43GJ2WAHU7FPEAYLNFR4WJUQMCJGOOS6ESF2O6ZBB6GVWL6FVS3OY --sponsor GBDOAFW4WYIOVCBZNVI4CF4QOD2J3HZYMMQZSOF2LOSNZGZCSMVBIGMQ --json` | 0 | 0 | `plan-json.txt`, `plan.json` |
| 5 | `dustin close GCIVEA6YVJCSYE2Y7V2IUEYATOO36X7GQOAYNOI2MDNOW7HI4LPJVKZT --to GBR43GJ2WAHU7FPEAYLNFR4WJUQMCJGOOS6ESF2O6ZBB6GVWL6FVS3OY --execute --yes --report report.json` | 0 | 0 | `transcript.txt` |

## Transactions of the close

| # | Phase | Hash | Result | Ledger | Fee charged (stroops) | Fee account is the sponsor | Source is the account | Inner max_fee | Links |
|---|---|---|---|---|---|---|---|---|---|
| 1 | cleanup | `835457ceff4b0443ec52ebbb408edc8988627e5de8442d28dda85b3331b52a5b` | applied | 4931386 | 1000 | yes (sponsor) | yes | 0 | [explorer](https://stellar.expert/explorer/testnet/tx/835457ceff4b0443ec52ebbb408edc8988627e5de8442d28dda85b3331b52a5b), [Horizon](https://horizon-testnet.stellar.org/transactions/835457ceff4b0443ec52ebbb408edc8988627e5de8442d28dda85b3331b52a5b) |
| 2 | convert | `c6c99beddca7685293bdb0e156e320cbb4189e4247e4451578b60e82ba76de61` | applied | 4931387 | 300 | yes (sponsor) | yes | 0 | [explorer](https://stellar.expert/explorer/testnet/tx/c6c99beddca7685293bdb0e156e320cbb4189e4247e4451578b60e82ba76de61), [Horizon](https://horizon-testnet.stellar.org/transactions/c6c99beddca7685293bdb0e156e320cbb4189e4247e4451578b60e82ba76de61) |
| 3 | merge | `dd56e18f152dc7f15ee370dce9b8ddae556e90f04dd1cd52fe3281df4bf118e2` | applied | 4931388 | 200 | yes (sponsor) | yes | 0 | [explorer](https://stellar.expert/explorer/testnet/tx/dd56e18f152dc7f15ee370dce9b8ddae556e90f04dd1cd52fe3281df4bf118e2), [Horizon](https://horizon-testnet.stellar.org/transactions/dd56e18f152dc7f15ee370dce9b8ddae556e90f04dd1cd52fe3281df4bf118e2) |

## Checks

| Result | Check | Observed |
|---|---|---|
| PASS | The dry-run plan is closable and ends in the merge | status closable; transactions cleanup (9 ops), convert (2 ops), merge (1 op) |
| PASS | The report says closed, verified gone, with no stop | status closed; verification HTTP 404; stop none |
| PASS | Horizon answers HTTP 404 for the account afterwards | HTTP 404 |
| PASS | Every transaction of the close on the ledger is a fee bump: fee account the sponsor, source the account, inner max_fee 0 | 3 of 3 transactions on the ledger |
| PASS | The destination's XLM grew by exactly the merged amount | 10.0000000 -> 14.0000007 XLM (+4.0000007); merged 4.0000007 XLM |
| PASS | The reserve sponsor's num_sponsoring went from 1 to 0 (the SPTA reserve went back to it) | 1 -> 0 |

## Balances

Latest ledger before the close 4931384, after it 4931388.

- Destination `GBR43GJ2WAHU7FPEAYLNFR4WJUQMCJGOOS6ESF2O6ZBB6GVWL6FVS3OY`: 10.0000000 XLM -> 14.0000007 XLM (+4.0000007), num_sponsoring 0 -> 0.
- Reserve sponsor `GCKXIJUENGYY2LO6PYVDWIDMJ6XEXZZUOM3NBQR2BCAWODSSP6NNT7BB`: 10.0000000 XLM -> 10.0000000 XLM (+0.0000000), num_sponsoring 1 -> 0.
- Fee sponsor `GBDOAFW4WYIOVCBZNVI4CF4QOD2J3HZYMMQZSOF2LOSNZGZCSMVBIGMQ`: 9865.9997200 XLM -> 9865.9995700 XLM (-0.0001500), num_sponsoring 0 -> 0.

## Files

- `summary.md`: this page.
- `fixture-create.txt`: `dustin fixture create`: the command and its build log (public keys and hashes).
- `fixture-manifest.json`: the fixture's public manifest, as `dustin fixture create --json` printed it.
- `fixture-verify.txt`: `dustin fixture verify` on that manifest, right after the build.
- `fixture-verification.json`: what it checked (`--snapshot`); for a messy fixture the checks with `"appendixB": true` are the SOW Appendix B preconditions.
- `plan.txt`: the dry-run `dustin plan`.
- `plan-json.txt`: the same command with `--json`: its standard error and exit code.
- `plan.json`: its standard output: the plan as JSON.
- `account-before.json`: Horizon's view of the account before the close.
- `transcript.txt`: the close that ran (`--report report.json`), with its receipt.
- `report.json`: the close report written by `--report`, with both envelopes of every transaction as XDR.
- `account-after.json`: Horizon's answer for the account after the close: status and body.
- `balances.json`: XLM, num_sponsoring and trustlines of each role before and after, and the ledgers.
- `tx-1.json`: Horizon's record of transaction 1, 835457ceff4b0443ec52ebbb408edc8988627e5de8442d28dda85b3331b52a5b.
- `tx-2.json`: Horizon's record of transaction 2, c6c99beddca7685293bdb0e156e320cbb4189e4247e4451578b60e82ba76de61.
- `tx-3.json`: Horizon's record of transaction 3, dd56e18f152dc7f15ee370dce9b8ddae556e90f04dd1cd52fe3281df4bf118e2.
- `explorer-account.png`, `explorer-tx-1.png` to `explorer-tx-3.png`, `horizon-account-404.png`, `screenshots.json`: the public pages of this close, captured on 2026-09-30 by `node scripts/demo/explorer-shots.mjs` (below).

Explorer and Horizon links resolve only until the next testnet reset (scheduled for 2026-12-16), which deletes every account and transaction; the JSON, the XDR, the transcripts and the screenshots in this directory are the durable record.

## Screenshots

Captured on 2026-09-30 between 15:37 and 15:38 UTC with `node scripts/demo/explorer-shots.mjs --playwright <directory where playwright is installed> evidence/runs/20260929T111408Z-e4-cli` (Chromium through Playwright, the whole page at 1920 pixels wide; a strip above each page names its URL and the time it was captured; [`screenshots.json`](screenshots.json) lists them):

| File | Page | What it shows |
|---|---|---|
| [`explorer-account.png`](explorer-account.png) | StellarExpert, the closed account | "Account (deleted)", "Balances unavailable", and the account's history, newest first: the merge into the destination, the sale of DUSTA, the cleanup, then the fixture's build |
| [`explorer-tx-1.png`](explorer-tx-1.png) | StellarExpert, transaction 1 | Successful in ledger 4931386; source account the closed account; fee source account the fee sponsor; fee charged 0.0001 XLM; its nine operations, all shown |
| [`explorer-tx-2.png`](explorer-tx-2.png) | StellarExpert, transaction 2 | Successful in ledger 4931387; the strict-send sale of 0.0000007 DUSTA and the trustline's removal; fee source the fee sponsor |
| [`explorer-tx-3.png`](explorer-tx-3.png) | StellarExpert, transaction 3 | Successful in ledger 4931388; the merge into the destination; fee source the fee sponsor |
| [`horizon-account-404.png`](horizon-account-404.png) | Horizon, the closed account | HTTP 404, "Resource Missing" |

