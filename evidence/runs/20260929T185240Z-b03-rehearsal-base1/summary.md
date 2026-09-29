# Matrix row B-03, the rebuilt baseline fixture (FIX-base-1) 20260929T185240Z-b03-rehearsal-base1

Matrix row B-03 (docs/edge-cases-and-test-matrix.md, section 4): the recipe of the builder's baseline fixture `messy-20260926T035942Z`, on which the existing tool was recorded (B-01, evidence/baseline/README.md), rebuilt from Friendbot with `dustin fixture create --profile messy` (FIX-base-1: zero spendable XLM) and closed by Dustin through the command line with the default ladder order. The recipe hash in the new manifest is the baseline fixture's, so the account Dustin closes is built identically to the one the existing tool stopped on.

Written by `node scripts/evidence-cli.mjs baseline-zero`. Public data only: public keys, hashes, envelopes and Horizon JSON. The secret keys reached `dustin close` through its environment only; every file here was scanned for secret seeds and for the fixture's secret keys before it was written.

## What the reviewer should see

1. The recipe: the rebuilt fixture `messy-20260929T185242Z-9f9ece` has the recipe hash `a00bfd18c386d2f536daf544513ee7153c433f62a68437bc3a0af11bdc4ddd9b`, the baseline fixture's (`test/fixtures/horizon/messy/manifest.json`). See `fixture-manifest.json`.
2. `dustin fixture verify fixture-manifest.json --snapshot fixture-verification.json` exited 0: 12 of 12 checks passed right after the build, zero spendable XLM among them. See `fixture-verify.txt` and `fixture-verification.json`.
3. `dustin plan GAHTCBQYLICZJGHGZNGV67FHXKKJJ72XCGL7D24BB6MOHDTXIDF255KO --to GDXMXWEVQ5AST3QVDIJWYLQCSEIXFNR6GEDYZRE7WYBTGIPPLFUHARSZ --sponsor GAUOSB252DSKOR5ZB2UR6L43XJJG6B623Z67S3D6URKVXRLEYMR5TQNS` exited 0: status CLOSABLE, 3 transactions (cleanup (9 ops), convert (2 ops), merge (1 op)). See `plan.txt` and `plan.json`.
4. `dustin close GAHTCBQYLICZJGHGZNGV67FHXKKJJ72XCGL7D24BB6MOHDTXIDF255KO --to GDXMXWEVQ5AST3QVDIJWYLQCSEIXFNR6GEDYZRE7WYBTGIPPLFUHARSZ --execute --yes --report report.json` exited 0: report status `closed`; tx 1 (cleanup, applied in ledger 4936888) [74107c9554ba8bf93497b13786c029eee788f93a4215184565026d47bf35ddd7](https://stellar.expert/explorer/testnet/tx/74107c9554ba8bf93497b13786c029eee788f93a4215184565026d47bf35ddd7); tx 2 (convert, applied in ledger 4936889) [12cc646a8022022c7e0593f766dc47b6c1c9465293d0950b3c6c152d53c0484b](https://stellar.expert/explorer/testnet/tx/12cc646a8022022c7e0593f766dc47b6c1c9465293d0950b3c6c152d53c0484b); tx 3 (merge, applied in ledger 4936890) [d83b46ec8578e42f4a187e6faf9cb36cab66d0f166c6366400b98baaff2affc6](https://stellar.expert/explorer/testnet/tx/d83b46ec8578e42f4a187e6faf9cb36cab66d0f166c6366400b98baaff2affc6), each a fee bump paid by the sponsor. See `transcript.txt` and `report.json`.
5. Horizon answers HTTP 404 for the account afterwards ([Horizon](https://horizon-testnet.stellar.org/accounts/GAHTCBQYLICZJGHGZNGV67FHXKKJJ72XCGL7D24BB6MOHDTXIDF255KO), `account-after.json`); the destination received the merged 4.0000007 XLM (`balances.json`). The side-by-side table with the existing tool's recordings is `evidence/baseline/b03-comparison-rehearsal.md`.

## Run

| Field | Value |
|---|---|
| Captured (UTC) | 2026-09-29T18:53:59.709Z |
| Case | `baseline-zero` (matrix row B-03 after the recording B-01; SOW 6.1 Deliverable 3) |
| Network passphrase | `Test SDF Network ; September 2015` |
| Horizon | https://horizon-testnet.stellar.org |
| Fixture | messy-20260929T185242Z-9f9ece (profile messy) |
| Account | [GAHTCBQYLICZJGHGZNGV67FHXKKJJ72XCGL7D24BB6MOHDTXIDF255KO](https://stellar.expert/explorer/testnet/account/GAHTCBQYLICZJGHGZNGV67FHXKKJJ72XCGL7D24BB6MOHDTXIDF255KO) ([Horizon](https://horizon-testnet.stellar.org/accounts/GAHTCBQYLICZJGHGZNGV67FHXKKJJ72XCGL7D24BB6MOHDTXIDF255KO)) |
| Destination | [GDXMXWEVQ5AST3QVDIJWYLQCSEIXFNR6GEDYZRE7WYBTGIPPLFUHARSZ](https://stellar.expert/explorer/testnet/account/GDXMXWEVQ5AST3QVDIJWYLQCSEIXFNR6GEDYZRE7WYBTGIPPLFUHARSZ) ([Horizon](https://horizon-testnet.stellar.org/accounts/GDXMXWEVQ5AST3QVDIJWYLQCSEIXFNR6GEDYZRE7WYBTGIPPLFUHARSZ)) |
| Fee sponsor (fee account of every transaction of the close) | [GAUOSB252DSKOR5ZB2UR6L43XJJG6B623Z67S3D6URKVXRLEYMR5TQNS](https://stellar.expert/explorer/testnet/account/GAUOSB252DSKOR5ZB2UR6L43XJJG6B623Z67S3D6URKVXRLEYMR5TQNS) ([Horizon](https://horizon-testnet.stellar.org/accounts/GAUOSB252DSKOR5ZB2UR6L43XJJG6B623Z67S3D6URKVXRLEYMR5TQNS)) |
| Reserve sponsor (sponsors the SPTA trustline) | [GCLAIQ2TKEKQ3MBGRWGOEXTKQJHHKNPJRXTVVA2LESOMC7B5P3BR625T](https://stellar.expert/explorer/testnet/account/GCLAIQ2TKEKQ3MBGRWGOEXTKQJHHKNPJRXTVVA2LESOMC7B5P3BR625T) ([Horizon](https://horizon-testnet.stellar.org/accounts/GCLAIQ2TKEKQ3MBGRWGOEXTKQJHHKNPJRXTVVA2LESOMC7B5P3BR625T)) |
| Issuer of DUSTA, DUSTB, DUSTC and SPTA | [GBLO3ZDPW24EUUKOW2HY3SAHZODEZZSO22JONQWCZZQWJDN2QUUUASNY](https://stellar.expert/explorer/testnet/account/GBLO3ZDPW24EUUKOW2HY3SAHZODEZZSO22JONQWCZZQWJDN2QUUUASNY) ([Horizon](https://horizon-testnet.stellar.org/accounts/GBLO3ZDPW24EUUKOW2HY3SAHZODEZZSO22JONQWCZZQWJDN2QUUUASNY)) |
| Ledgers | latest before the close 4936886; after it 4936890 |
| Report status | closed |
| Plan hash of the run | `4177aa9e7f41b16fbb369fd9d3bb554cec89a4a8a93539938c287e2fe7f13af9` |
| Merged XLM (from the merge result) | 4.0000007 |
| Fees paid by the account / by the sponsor | 0 / 1500 stroops |
| Horizon for the account afterwards | HTTP 404 |

## Commands

Each ran as `node dist/cli/main.js` from this repository's build, shown here as `dustin`.

| # | Command | Expected exit | Exit | Output |
|---|---|---|---|---|
| 1 | `dustin fixture create --profile messy --dir .fixture --json` | 0 | 0 | `fixture-create.txt`, `fixture-manifest.json` |
| 2 | `dustin fixture verify fixture-manifest.json --snapshot fixture-verification.json` | 0 | 0 | `fixture-verify.txt` |
| 3 | `dustin plan GAHTCBQYLICZJGHGZNGV67FHXKKJJ72XCGL7D24BB6MOHDTXIDF255KO --to GDXMXWEVQ5AST3QVDIJWYLQCSEIXFNR6GEDYZRE7WYBTGIPPLFUHARSZ --sponsor GAUOSB252DSKOR5ZB2UR6L43XJJG6B623Z67S3D6URKVXRLEYMR5TQNS` | 0 | 0 | `plan.txt` |
| 4 | `dustin plan GAHTCBQYLICZJGHGZNGV67FHXKKJJ72XCGL7D24BB6MOHDTXIDF255KO --to GDXMXWEVQ5AST3QVDIJWYLQCSEIXFNR6GEDYZRE7WYBTGIPPLFUHARSZ --sponsor GAUOSB252DSKOR5ZB2UR6L43XJJG6B623Z67S3D6URKVXRLEYMR5TQNS --json` | 0 | 0 | `plan-json.txt`, `plan.json` |
| 5 | `dustin close GAHTCBQYLICZJGHGZNGV67FHXKKJJ72XCGL7D24BB6MOHDTXIDF255KO --to GDXMXWEVQ5AST3QVDIJWYLQCSEIXFNR6GEDYZRE7WYBTGIPPLFUHARSZ --execute --yes --report report.json` | 0 | 0 | `transcript.txt` |

## Transactions of the close

| # | Phase | Hash | Result | Ledger | Fee charged (stroops) | Fee account is the sponsor | Source is the account | Inner max_fee | Links |
|---|---|---|---|---|---|---|---|---|---|
| 1 | cleanup | `74107c9554ba8bf93497b13786c029eee788f93a4215184565026d47bf35ddd7` | applied | 4936888 | 1000 | yes (sponsor) | yes | 0 | [explorer](https://stellar.expert/explorer/testnet/tx/74107c9554ba8bf93497b13786c029eee788f93a4215184565026d47bf35ddd7), [Horizon](https://horizon-testnet.stellar.org/transactions/74107c9554ba8bf93497b13786c029eee788f93a4215184565026d47bf35ddd7) |
| 2 | convert | `12cc646a8022022c7e0593f766dc47b6c1c9465293d0950b3c6c152d53c0484b` | applied | 4936889 | 300 | yes (sponsor) | yes | 0 | [explorer](https://stellar.expert/explorer/testnet/tx/12cc646a8022022c7e0593f766dc47b6c1c9465293d0950b3c6c152d53c0484b), [Horizon](https://horizon-testnet.stellar.org/transactions/12cc646a8022022c7e0593f766dc47b6c1c9465293d0950b3c6c152d53c0484b) |
| 3 | merge | `d83b46ec8578e42f4a187e6faf9cb36cab66d0f166c6366400b98baaff2affc6` | applied | 4936890 | 200 | yes (sponsor) | yes | 0 | [explorer](https://stellar.expert/explorer/testnet/tx/d83b46ec8578e42f4a187e6faf9cb36cab66d0f166c6366400b98baaff2affc6), [Horizon](https://horizon-testnet.stellar.org/transactions/d83b46ec8578e42f4a187e6faf9cb36cab66d0f166c6366400b98baaff2affc6) |

## Checks

| Result | Check | Observed |
|---|---|---|
| PASS | The rebuilt fixture's recipe hash is the baseline fixture's (messy-20260926T035942Z) | a00bfd18c386d2f536daf544513ee7153c433f62a68437bc3a0af11bdc4ddd9b (baseline a00bfd18c386d2f536daf544513ee7153c433f62a68437bc3a0af11bdc4ddd9b) |
| PASS | The dry-run plan is closable and ends in the merge | status closable; transactions cleanup (9 ops), convert (2 ops), merge (1 op) |
| PASS | The report says closed, verified gone, with no stop | status closed; verification HTTP 404; stop none |
| PASS | Horizon answers HTTP 404 for the account afterwards | HTTP 404 |
| PASS | Every transaction of the close on the ledger is a fee bump: fee account the sponsor, source the account, inner max_fee 0 | 3 of 3 transactions on the ledger |
| PASS | The destination's XLM grew by exactly the merged amount | 10.0000000 -> 14.0000007 XLM (+4.0000007); merged 4.0000007 XLM |
| PASS | The whole XLM balance of the account reached the destination, plus the sale | account 4.0000000 XLM before; merged 4.0000007 XLM |

## Balances

Latest ledger before the close 4936886, after it 4936890.

- Account `GAHTCBQYLICZJGHGZNGV67FHXKKJJ72XCGL7D24BB6MOHDTXIDF255KO`: 4.0000000 XLM -> missing (404); trustlines DUSTA 0.0000007 -> none, DUSTB 0.0000003 -> none, DUSTC 0.0000005 -> none, SPTA 0.0000001 -> none.
- Destination `GDXMXWEVQ5AST3QVDIJWYLQCSEIXFNR6GEDYZRE7WYBTGIPPLFUHARSZ`: 10.0000000 XLM -> 14.0000007 XLM (+4.0000007), num_sponsoring 0 -> 0.
- Reserve sponsor `GCLAIQ2TKEKQ3MBGRWGOEXTKQJHHKNPJRXTVVA2LESOMC7B5P3BR625T`: 10.0000000 XLM -> 10.0000000 XLM (+0.0000000), num_sponsoring 1 -> 0.
- Fee sponsor `GAUOSB252DSKOR5ZB2UR6L43XJJG6B623Z67S3D6URKVXRLEYMR5TQNS`: 9865.9997200 XLM -> 9865.9995700 XLM (-0.0001500), num_sponsoring 0 -> 0.

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
- `tx-1.json`: Horizon's record of transaction 1, 74107c9554ba8bf93497b13786c029eee788f93a4215184565026d47bf35ddd7.
- `tx-2.json`: Horizon's record of transaction 2, 12cc646a8022022c7e0593f766dc47b6c1c9465293d0950b3c6c152d53c0484b.
- `tx-3.json`: Horizon's record of transaction 3, d83b46ec8578e42f4a187e6faf9cb36cab66d0f166c6366400b98baaff2affc6.

Explorer and Horizon links resolve only until the next testnet reset (scheduled for 2026-12-16), which deletes every account and transaction; the JSON, the XDR and the transcripts in this directory are the durable record.
