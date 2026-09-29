# Matrix row B-03, the rebuilt baseline fixture plus 1 XLM (FIX-base-2) 20260929T185359Z-b03-rehearsal-base2

Matrix row B-03 (docs/edge-cases-and-test-matrix.md, section 4): the baseline recipe rebuilt as for B-02 (FIX-base-2), a fresh `messy` fixture to which the fee sponsor pays 1 XLM, so the account holds 1 XLM it can spend, then closed by Dustin through the command line with the default ladder order. The recipe hash in the new manifest is the baseline fixture's.

Written by `node scripts/evidence-cli.mjs baseline-plus1`. Public data only: public keys, hashes, envelopes and Horizon JSON. The secret keys reached `dustin close` through its environment only; every file here was scanned for secret seeds and for the fixture's secret keys before it was written.

## What the reviewer should see

1. The recipe: the rebuilt fixture `messy-20260929T185401Z-9a66ec` has the recipe hash `a00bfd18c386d2f536daf544513ee7153c433f62a68437bc3a0af11bdc4ddd9b`, the baseline fixture's (`test/fixtures/horizon/messy/manifest.json`). See `fixture-manifest.json`.
2. `dustin fixture verify fixture-manifest.json --snapshot fixture-verification.json` exited 0: 12 of 12 checks passed right after the build, zero spendable XLM among them. See `fixture-verify.txt` and `fixture-verification.json`.
3. Then the fee sponsor paid the account 1 XLM: [c38b42e29eef0397a4ced7831fe88bb8717c94a977b54e95d17fdacbf73fe2d7](https://stellar.expert/explorer/testnet/tx/c38b42e29eef0397a4ced7831fe88bb8717c94a977b54e95d17fdacbf73fe2d7) (ledger 4936901); its balance went from 4.0000000 to 5.0000000 XLM, so it can spend 1 XLM. See `setup.json`.
4. `dustin plan GB6A3WJRNHSY5ZDZWB7GJY5ZVY2XTCQWO32W6SZ7AUYI4GEG6PQR44KZ --to GAQOROCDHEDKF5XN4XSMKA7TEK6TVSNPGRGRZF7H6WKIXYRZNJDGKI6Y --sponsor GAV7HAB33Q5J7LJO33XZ75RWLJUGDV3J52BJ4E7Q34MN3MLMUT424OGB` exited 0: status CLOSABLE, 3 transactions (cleanup (9 ops), convert (2 ops), merge (1 op)). See `plan.txt` and `plan.json`.
5. `dustin close GB6A3WJRNHSY5ZDZWB7GJY5ZVY2XTCQWO32W6SZ7AUYI4GEG6PQR44KZ --to GAQOROCDHEDKF5XN4XSMKA7TEK6TVSNPGRGRZF7H6WKIXYRZNJDGKI6Y --execute --yes --report report.json` exited 0: report status `closed`; tx 1 (cleanup, applied in ledger 4936904) [cce9e853202220b0302138b8a57e1a996fbbd5f8846b8f8c8e2405d42c876483](https://stellar.expert/explorer/testnet/tx/cce9e853202220b0302138b8a57e1a996fbbd5f8846b8f8c8e2405d42c876483); tx 2 (convert, applied in ledger 4936905) [a932f3dc988e1ea913ea774c086fedd431d185f73cd8eb9e3ea5ebb7433fd609](https://stellar.expert/explorer/testnet/tx/a932f3dc988e1ea913ea774c086fedd431d185f73cd8eb9e3ea5ebb7433fd609); tx 3 (merge, applied in ledger 4936906) [6d4307854ac2e977f57f5d10539647c8653c95f0f2285f647545c72928540a46](https://stellar.expert/explorer/testnet/tx/6d4307854ac2e977f57f5d10539647c8653c95f0f2285f647545c72928540a46), each a fee bump paid by the sponsor. See `transcript.txt` and `report.json`.
6. Horizon answers HTTP 404 for the account afterwards ([Horizon](https://horizon-testnet.stellar.org/accounts/GB6A3WJRNHSY5ZDZWB7GJY5ZVY2XTCQWO32W6SZ7AUYI4GEG6PQR44KZ), `account-after.json`); the destination received the merged 5.0000007 XLM (`balances.json`). The side-by-side table with the existing tool's recordings is `evidence/baseline/b03-comparison-rehearsal.md`.

## Run

| Field | Value |
|---|---|
| Captured (UTC) | 2026-09-29T18:55:20.338Z |
| Case | `baseline-plus1` (matrix row B-03 after the recording B-02; SOW 6.1 Deliverable 3) |
| Network passphrase | `Test SDF Network ; September 2015` |
| Horizon | https://horizon-testnet.stellar.org |
| Fixture | messy-20260929T185401Z-9a66ec (profile messy) |
| Account | [GB6A3WJRNHSY5ZDZWB7GJY5ZVY2XTCQWO32W6SZ7AUYI4GEG6PQR44KZ](https://stellar.expert/explorer/testnet/account/GB6A3WJRNHSY5ZDZWB7GJY5ZVY2XTCQWO32W6SZ7AUYI4GEG6PQR44KZ) ([Horizon](https://horizon-testnet.stellar.org/accounts/GB6A3WJRNHSY5ZDZWB7GJY5ZVY2XTCQWO32W6SZ7AUYI4GEG6PQR44KZ)) |
| Destination | [GAQOROCDHEDKF5XN4XSMKA7TEK6TVSNPGRGRZF7H6WKIXYRZNJDGKI6Y](https://stellar.expert/explorer/testnet/account/GAQOROCDHEDKF5XN4XSMKA7TEK6TVSNPGRGRZF7H6WKIXYRZNJDGKI6Y) ([Horizon](https://horizon-testnet.stellar.org/accounts/GAQOROCDHEDKF5XN4XSMKA7TEK6TVSNPGRGRZF7H6WKIXYRZNJDGKI6Y)) |
| Fee sponsor (fee account of every transaction of the close) | [GAV7HAB33Q5J7LJO33XZ75RWLJUGDV3J52BJ4E7Q34MN3MLMUT424OGB](https://stellar.expert/explorer/testnet/account/GAV7HAB33Q5J7LJO33XZ75RWLJUGDV3J52BJ4E7Q34MN3MLMUT424OGB) ([Horizon](https://horizon-testnet.stellar.org/accounts/GAV7HAB33Q5J7LJO33XZ75RWLJUGDV3J52BJ4E7Q34MN3MLMUT424OGB)) |
| Reserve sponsor (sponsors the SPTA trustline) | [GDGD7WV4JX2YOZYOOFBELSUVQBY6QJZEI2LH6EGIVJMM6PMWDZ2Y2AR4](https://stellar.expert/explorer/testnet/account/GDGD7WV4JX2YOZYOOFBELSUVQBY6QJZEI2LH6EGIVJMM6PMWDZ2Y2AR4) ([Horizon](https://horizon-testnet.stellar.org/accounts/GDGD7WV4JX2YOZYOOFBELSUVQBY6QJZEI2LH6EGIVJMM6PMWDZ2Y2AR4)) |
| Issuer of DUSTA, DUSTB, DUSTC and SPTA | [GCVJVGJETTCVLESFN2KHHRDJ2NY6GPN67LSC73RSNKALQ5ZPZOQ4X5P4](https://stellar.expert/explorer/testnet/account/GCVJVGJETTCVLESFN2KHHRDJ2NY6GPN67LSC73RSNKALQ5ZPZOQ4X5P4) ([Horizon](https://horizon-testnet.stellar.org/accounts/GCVJVGJETTCVLESFN2KHHRDJ2NY6GPN67LSC73RSNKALQ5ZPZOQ4X5P4)) |
| Ledgers | latest before the close 4936902; after it 4936906 |
| Report status | closed |
| Plan hash of the run | `ac0a9654cb2aa2220bc4c9b7de32d74135c15823e363c208b497380091b5ca4d` |
| Merged XLM (from the merge result) | 5.0000007 |
| Fees paid by the account / by the sponsor | 0 / 1500 stroops |
| Horizon for the account afterwards | HTTP 404 |

## Commands

Each ran as `node dist/cli/main.js` from this repository's build, shown here as `dustin`.

| # | Command | Expected exit | Exit | Output |
|---|---|---|---|---|
| 1 | `dustin fixture create --profile messy --dir .fixture --json` | 0 | 0 | `fixture-create.txt`, `fixture-manifest.json` |
| 2 | `dustin fixture verify fixture-manifest.json --snapshot fixture-verification.json` | 0 | 0 | `fixture-verify.txt` |
| 3 | `dustin plan GB6A3WJRNHSY5ZDZWB7GJY5ZVY2XTCQWO32W6SZ7AUYI4GEG6PQR44KZ --to GAQOROCDHEDKF5XN4XSMKA7TEK6TVSNPGRGRZF7H6WKIXYRZNJDGKI6Y --sponsor GAV7HAB33Q5J7LJO33XZ75RWLJUGDV3J52BJ4E7Q34MN3MLMUT424OGB` | 0 | 0 | `plan.txt` |
| 4 | `dustin plan GB6A3WJRNHSY5ZDZWB7GJY5ZVY2XTCQWO32W6SZ7AUYI4GEG6PQR44KZ --to GAQOROCDHEDKF5XN4XSMKA7TEK6TVSNPGRGRZF7H6WKIXYRZNJDGKI6Y --sponsor GAV7HAB33Q5J7LJO33XZ75RWLJUGDV3J52BJ4E7Q34MN3MLMUT424OGB --json` | 0 | 0 | `plan-json.txt`, `plan.json` |
| 5 | `dustin close GB6A3WJRNHSY5ZDZWB7GJY5ZVY2XTCQWO32W6SZ7AUYI4GEG6PQR44KZ --to GAQOROCDHEDKF5XN4XSMKA7TEK6TVSNPGRGRZF7H6WKIXYRZNJDGKI6Y --execute --yes --report report.json` | 0 | 0 | `transcript.txt` |

## Setup transactions

Submitted by this script before the plan, to give the fixture the state this case needs.

| Purpose | Hash | Result | Ledger | Fee account | Source | Links |
|---|---|---|---|---|---|---|
| Payment of 1 XLM from the fee sponsor to the account (matrix row B-02's "plus 1 XLM"), signed and paid by the sponsor | `c38b42e29eef0397a4ced7831fe88bb8717c94a977b54e95d17fdacbf73fe2d7` | applied | 4936901 | `GAV7HAB33Q5J7LJO33XZ75RWLJUGDV3J52BJ4E7Q34MN3MLMUT424OGB` | `GAV7HAB33Q5J7LJO33XZ75RWLJUGDV3J52BJ4E7Q34MN3MLMUT424OGB` | [explorer](https://stellar.expert/explorer/testnet/tx/c38b42e29eef0397a4ced7831fe88bb8717c94a977b54e95d17fdacbf73fe2d7), [Horizon](https://horizon-testnet.stellar.org/transactions/c38b42e29eef0397a4ced7831fe88bb8717c94a977b54e95d17fdacbf73fe2d7) |

## Transactions of the close

| # | Phase | Hash | Result | Ledger | Fee charged (stroops) | Fee account is the sponsor | Source is the account | Inner max_fee | Links |
|---|---|---|---|---|---|---|---|---|---|
| 1 | cleanup | `cce9e853202220b0302138b8a57e1a996fbbd5f8846b8f8c8e2405d42c876483` | applied | 4936904 | 1000 | yes (sponsor) | yes | 0 | [explorer](https://stellar.expert/explorer/testnet/tx/cce9e853202220b0302138b8a57e1a996fbbd5f8846b8f8c8e2405d42c876483), [Horizon](https://horizon-testnet.stellar.org/transactions/cce9e853202220b0302138b8a57e1a996fbbd5f8846b8f8c8e2405d42c876483) |
| 2 | convert | `a932f3dc988e1ea913ea774c086fedd431d185f73cd8eb9e3ea5ebb7433fd609` | applied | 4936905 | 300 | yes (sponsor) | yes | 0 | [explorer](https://stellar.expert/explorer/testnet/tx/a932f3dc988e1ea913ea774c086fedd431d185f73cd8eb9e3ea5ebb7433fd609), [Horizon](https://horizon-testnet.stellar.org/transactions/a932f3dc988e1ea913ea774c086fedd431d185f73cd8eb9e3ea5ebb7433fd609) |
| 3 | merge | `6d4307854ac2e977f57f5d10539647c8653c95f0f2285f647545c72928540a46` | applied | 4936906 | 200 | yes (sponsor) | yes | 0 | [explorer](https://stellar.expert/explorer/testnet/tx/6d4307854ac2e977f57f5d10539647c8653c95f0f2285f647545c72928540a46), [Horizon](https://horizon-testnet.stellar.org/transactions/6d4307854ac2e977f57f5d10539647c8653c95f0f2285f647545c72928540a46) |

## Checks

| Result | Check | Observed |
|---|---|---|
| PASS | The rebuilt fixture's recipe hash is the baseline fixture's (messy-20260926T035942Z) | recipe hash a00bfd18c386d2f536daf544513ee7153c433f62a68437bc3a0af11bdc4ddd9b (the baseline fixture's recipe hash a00bfd18c386d2f536daf544513ee7153c433f62a68437bc3a0af11bdc4ddd9b) |
| PASS | The dry-run plan is closable and ends in the merge | status closable; transactions cleanup (9 ops), convert (2 ops), merge (1 op) |
| PASS | The report says closed, verified gone, with no stop | status closed; verification HTTP 404; stop none |
| PASS | Horizon answers HTTP 404 for the account afterwards | HTTP 404 |
| PASS | Every transaction of the close on the ledger is a fee bump: fee account the sponsor, source the account, inner max_fee 0 | 3 of 3 transactions on the ledger |
| PASS | The destination's XLM grew by exactly the merged amount | 10.0000000 -> 15.0000007 XLM (+5.0000007); merged 5.0000007 XLM |
| PASS | The whole XLM balance of the account reached the destination, plus the sale | account 5.0000000 XLM before; merged 5.0000007 XLM |

## Balances

Latest ledger before the close 4936902, after it 4936906.

- Account `GB6A3WJRNHSY5ZDZWB7GJY5ZVY2XTCQWO32W6SZ7AUYI4GEG6PQR44KZ`: 5.0000000 XLM -> missing (404); trustlines DUSTA 0.0000007 -> none, DUSTB 0.0000003 -> none, DUSTC 0.0000005 -> none, SPTA 0.0000001 -> none.
- Destination `GAQOROCDHEDKF5XN4XSMKA7TEK6TVSNPGRGRZF7H6WKIXYRZNJDGKI6Y`: 10.0000000 XLM -> 15.0000007 XLM (+5.0000007), num_sponsoring 0 -> 0.
- Reserve sponsor `GDGD7WV4JX2YOZYOOFBELSUVQBY6QJZEI2LH6EGIVJMM6PMWDZ2Y2AR4`: 10.0000000 XLM -> 10.0000000 XLM (+0.0000000), num_sponsoring 1 -> 0.
- Fee sponsor `GAV7HAB33Q5J7LJO33XZ75RWLJUGDV3J52BJ4E7Q34MN3MLMUT424OGB`: 9864.9997100 XLM -> 9864.9995600 XLM (-0.0001500), num_sponsoring 0 -> 0.

## Files

- `summary.md`: this page.
- `fixture-create.txt`: `dustin fixture create`: the command and its build log (public keys and hashes).
- `fixture-manifest.json`: the fixture's public manifest, as `dustin fixture create --json` printed it.
- `fixture-verify.txt`: `dustin fixture verify` on that manifest, right after the build.
- `fixture-verification.json`: what it checked (`--snapshot`); for a messy fixture the checks with `"appendixB": true` are the SOW Appendix B preconditions.
- `setup.json`: the transactions this script submitted before the plan, with envelopes and Horizon's records.
- `plan.txt`: the dry-run `dustin plan`.
- `plan-json.txt`: the same command with `--json`: its standard error and exit code.
- `plan.json`: its standard output: the plan as JSON.
- `account-before.json`: Horizon's view of the account before the close.
- `transcript.txt`: the close that ran (`--report report.json`), with its receipt.
- `report.json`: the close report written by `--report`, with both envelopes of every transaction as XDR.
- `account-after.json`: Horizon's answer for the account after the close: status and body.
- `balances.json`: XLM, num_sponsoring and trustlines of each role before and after, and the ledgers.
- `tx-1.json`: Horizon's record of transaction 1, cce9e853202220b0302138b8a57e1a996fbbd5f8846b8f8c8e2405d42c876483.
- `tx-2.json`: Horizon's record of transaction 2, a932f3dc988e1ea913ea774c086fedd431d185f73cd8eb9e3ea5ebb7433fd609.
- `tx-3.json`: Horizon's record of transaction 3, 6d4307854ac2e977f57f5d10539647c8653c95f0f2285f647545c72928540a46.

Explorer and Horizon links resolve only until the next testnet reset (scheduled for 2026-12-16), which deletes every account and transaction; the JSON, the XDR and the transcripts in this directory are the durable record.
