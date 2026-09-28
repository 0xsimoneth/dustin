# Live close 20260928T112239Z-e3

Written by `test/testnet/execute-close.test.ts` with `DUSTIN_EVIDENCE=1`. Public data only: public keys, hashes, envelopes and Horizon JSON.

| Field | Value |
|---|---|
| Captured (UTC) | 2026-09-28T11:22:39.956Z |
| Close started / finished | 2026-09-28T11:22:23.487Z / 2026-09-28T11:22:38.792Z |
| Network passphrase | `Test SDF Network ; September 2015` |
| Horizon | https://horizon-testnet.stellar.org |
| Ledgers | before the close 4914190; transactions 4914192, 4914193, 4914194; after verification 4914194 |
| Fixture | messy-20260928T112138Z-f08060 (profile messy) |
| Closed account | [GCSK3ODHZH7O3PFMV676GEMKRIW34UHUET57HRNTRQV2RSB73JVOPCCT](https://stellar.expert/explorer/testnet/account/GCSK3ODHZH7O3PFMV676GEMKRIW34UHUET57HRNTRQV2RSB73JVOPCCT) |
| Destination | [GBGZBVYU37JVDVYKNGX3IZJNNXELMNXCRLIE7IKKF3JNM2JAUYM554OV](https://stellar.expert/explorer/testnet/account/GBGZBVYU37JVDVYKNGX3IZJNNXELMNXCRLIE7IKKF3JNM2JAUYM554OV) |
| Fee sponsor (fee account of every transaction) | [GAOJTIMBWLVJJDXDTZZEQJ4Z6GQIFGJS2YQKWNVQYQGKGBFDCBVNBYER](https://stellar.expert/explorer/testnet/account/GAOJTIMBWLVJJDXDTZZEQJ4Z6GQIFGJS2YQKWNVQYQGKGBFDCBVNBYER) |
| Reserve sponsor | [GBTG2YJPCWRPXSRQBPHWJS2QR6AIR2BCFWFJCZLSVGDLUTQWCB6CZJVH](https://stellar.expert/explorer/testnet/account/GBTG2YJPCWRPXSRQBPHWJS2QR6AIR2BCFWFJCZLSVGDLUTQWCB6CZJVH) |
| Status | closed |
| Plan hash | `b400eef44f112f474543c65f7cbb8707f88709f5ddbaf68262e17eaf9d1ad06c` |
| Merged XLM (from the merge result) | 4.0000007 |
| Fees paid by the closed account / by the sponsor | 0 / 1500 stroops |

## Transactions

| # | Phase | Hash | Ledger | Fee charged (stroops) | Successful | Fee account is the sponsor | Source is the closed account | Explorer | Horizon |
|---|---|---|---|---|---|---|---|---|---|
| 1 | cleanup | `55a12730e24961e27a9e089fc0d542f6416a1d3d0efc125b47b962907a16593f` | 4914192 | 1000 | yes | yes (sponsor) | yes | [explorer](https://stellar.expert/explorer/testnet/tx/55a12730e24961e27a9e089fc0d542f6416a1d3d0efc125b47b962907a16593f) | [Horizon](https://horizon-testnet.stellar.org/transactions/55a12730e24961e27a9e089fc0d542f6416a1d3d0efc125b47b962907a16593f) |
| 2 | convert | `6e0e882060a280925e2dc23b099182624d63d95b04fcd51bb38eefbff49f6449` | 4914193 | 300 | yes | yes (sponsor) | yes | [explorer](https://stellar.expert/explorer/testnet/tx/6e0e882060a280925e2dc23b099182624d63d95b04fcd51bb38eefbff49f6449) | [Horizon](https://horizon-testnet.stellar.org/transactions/6e0e882060a280925e2dc23b099182624d63d95b04fcd51bb38eefbff49f6449) |
| 3 | merge | `7335c6225593513ceee297b626eadc03bf1d9ee40256e2162b039edb245faac6` | 4914194 | 200 | yes | yes (sponsor) | yes | [explorer](https://stellar.expert/explorer/testnet/tx/7335c6225593513ceee297b626eadc03bf1d9ee40256e2162b039edb245faac6) | [Horizon](https://horizon-testnet.stellar.org/transactions/7335c6225593513ceee297b626eadc03bf1d9ee40256e2162b039edb245faac6) |

## Disposal ladder

Ladder order: `sow` (the SOW order: path payment, return to issuer, transfer to the destination).

| Step | Asset | Amount | Planned rung | Applied rung | Outcome | Transaction |
|---|---|---|---|---|---|---|
| S03 | DUSTB:GBNHUQETET3O5SMXJ2PMQXVL7K6TLDGNMGSENGNOGFJ2GAAPZNNUJOMR | 0.0000003 | return_to_issuer | return_to_issuer | applied | `55a12730e24961e27a9e089fc0d542f6416a1d3d0efc125b47b962907a16593f` |
| S05 | DUSTC:GBNHUQETET3O5SMXJ2PMQXVL7K6TLDGNMGSENGNOGFJ2GAAPZNNUJOMR | 0.0000005 | return_to_issuer | return_to_issuer | applied | `55a12730e24961e27a9e089fc0d542f6416a1d3d0efc125b47b962907a16593f` |
| S07 | SPTA:GBNHUQETET3O5SMXJ2PMQXVL7K6TLDGNMGSENGNOGFJ2GAAPZNNUJOMR | 0.0000001 | return_to_issuer | return_to_issuer | applied | `55a12730e24961e27a9e089fc0d542f6416a1d3d0efc125b47b962907a16593f` |
| S10 | DUSTA:GBNHUQETET3O5SMXJ2PMQXVL7K6TLDGNMGSENGNOGFJ2GAAPZNNUJOMR | 0.0000007 | path_payment | path_payment | applied | `6e0e882060a280925e2dc23b099182624d63d95b04fcd51bb38eefbff49f6449` |

## Fixture before the close (SOW Appendix B)

Verification passed.

| Result | Appendix B | Check | Observed |
|---|---|---|---|
| PASS | yes | holds zero spendable XLM | balance 4.0000000, minimum 4.0000000, native selling liabilities 0.0000000, spendable 0.0000000 |
| PASS | yes | at least 3 trustlines with non-zero balances | 4 (DUSTA 0.0000007, DUSTB 0.0000003, DUSTC 0.0000005, SPTA 0.0000001) |
| PASS | yes | at least 1 open offer | 2 (ids 828518, 828519) |
| PASS | yes | at least 1 data entry | 1 (dustin.fixture) |
| PASS | no | trustline SPTA is sponsored by the reserve sponsor | sponsor GBTG2YJPCWRPXSRQBPHWJS2QR6AIR2BCFWFJCZLSVGDLUTQWCB6CZJVH |
| PASS | no | subentry count | 7 |
| PASS | no | entries sponsored by another account | 1 |
| PASS | no | sponsors nothing (a sponsoring account cannot be merged) | 0 |
| PASS | no | holds no liquidity pool shares | 0 |
| PASS | no | AUTH_IMMUTABLE is not set | false |
| PASS | no | the master key alone meets the high threshold | master weight 1, high threshold 0 |
| PASS | no | the destination account exists | exists |

## After the close

- `GET https://horizon-testnet.stellar.org/accounts/GCSK3ODHZH7O3PFMV676GEMKRIW34UHUET57HRNTRQV2RSB73JVOPCCT` answered HTTP 404: the account no longer exists (`account-after.json`).
- Destination GBGZBVYU37JVDVYKNGX3IZJNNXELMNXCRLIE7IKKF3JNM2JAUYM554OV: 10.0000000 -> 14.0000007 XLM (+4.0000007), sponsoring 0 -> 0.
- Reserve sponsor GBTG2YJPCWRPXSRQBPHWJS2QR6AIR2BCFWFJCZLSVGDLUTQWCB6CZJVH: 10.0000000 -> 10.0000000 XLM (+0.0000000), sponsoring 1 -> 0.
- Fee sponsor GAOJTIMBWLVJJDXDTZZEQJ4Z6GQIFGJS2YQKWNVQYQGKGBFDCBVNBYER: 9865.9997200 -> 9865.9995700 XLM (-0.0001500), sponsoring 0 -> 0.

## Files

- `plan.json`: the close plan the run was approved with (`planClose()` output, read-only).
- `plan.txt`: the same plan as `dustin plan` prints it.
- `report.json`: the close report, with the inner and fee-bump envelope XDR of every transaction.
- `fixture-manifest.json`: the fixture's public manifest.
- `fixture-verification.json`: the pre-close verification.
- `account-before.json`: Horizon's view of the account before the close.
- `tx-1.json`: Horizon's record of transaction 55a12730e24961e27a9e089fc0d542f6416a1d3d0efc125b47b962907a16593f.
- `tx-2.json`: Horizon's record of transaction 6e0e882060a280925e2dc23b099182624d63d95b04fcd51bb38eefbff49f6449.
- `tx-3.json`: Horizon's record of transaction 7335c6225593513ceee297b626eadc03bf1d9ee40256e2162b039edb245faac6.
- `account-after.json`: Horizon's answer for the account after the close.
- `balances.json`: XLM positions before and after, and the ledgers.

Explorer links resolve only until the next testnet reset (scheduled for 2026-12-16), which deletes every account and transaction; the JSON and XDR in this directory are the durable record.
