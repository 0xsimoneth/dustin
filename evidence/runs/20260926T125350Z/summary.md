# Live close 20260926T125350Z

Written by `test/testnet/execute-close.test.ts` with `DUSTIN_EVIDENCE=1`. Public data only: public keys, hashes, envelopes and Horizon JSON.

| Field | Value |
|---|---|
| Captured (UTC) | 2026-09-26T12:53:50.086Z |
| Close started / finished | 2026-09-26T12:53:30.278Z / 2026-09-26T12:53:48.189Z |
| Network passphrase | `Test SDF Network ; September 2015` |
| Horizon | https://horizon-testnet.stellar.org |
| Ledgers | before the close 4880724; transactions 4880726, 4880727, 4880728; after verification 4880728 |
| Fixture | messy-20260926T125242Z-8bf277 (profile messy) |
| Closed account | [GDH42OX6P454OHI7CJQH6DTLBPQNGOQVSJMVCQYGQQU7ETDCTDX5BJKX](https://stellar.expert/explorer/testnet/account/GDH42OX6P454OHI7CJQH6DTLBPQNGOQVSJMVCQYGQQU7ETDCTDX5BJKX) |
| Destination | [GDEUJWJRTQX7B3DVETOGN6GZ2DDJ2LFHVDA6LG745JNT6T57NDSDXXUN](https://stellar.expert/explorer/testnet/account/GDEUJWJRTQX7B3DVETOGN6GZ2DDJ2LFHVDA6LG745JNT6T57NDSDXXUN) |
| Fee sponsor (fee account of every transaction) | [GBUJSYZGG5NVF2STUFLNPIEPMYJLCUK6VHUYGX6XMNPKF53QOHMWQPEZ](https://stellar.expert/explorer/testnet/account/GBUJSYZGG5NVF2STUFLNPIEPMYJLCUK6VHUYGX6XMNPKF53QOHMWQPEZ) |
| Reserve sponsor | [GBQX4JSNEGV3AR3LER7MPPYW7HLR3WT2PFM542RC4MBKLJH6ZKJED6JQ](https://stellar.expert/explorer/testnet/account/GBQX4JSNEGV3AR3LER7MPPYW7HLR3WT2PFM542RC4MBKLJH6ZKJED6JQ) |
| Status | closed |
| Plan hash | `30306a740cf72366221fbe8a3f4df2c8435333a9a6fa81155220721a4d322f3b` |
| Merged XLM (from the merge result) | 4.0000007 |
| Fees paid by the closed account / by the sponsor | 0 / 1500 stroops |

## Transactions

| # | Phase | Hash | Ledger | Fee charged (stroops) | Successful | Fee account is the sponsor | Source is the closed account | Explorer | Horizon |
|---|---|---|---|---|---|---|---|---|---|
| 1 | cleanup | `274e5ba5e27b7587afcd005168e48b50024473fa809b5675aca66044b642b7e7` | 4880726 | 1000 | yes | yes (sponsor) | yes | [explorer](https://stellar.expert/explorer/testnet/tx/274e5ba5e27b7587afcd005168e48b50024473fa809b5675aca66044b642b7e7) | [Horizon](https://horizon-testnet.stellar.org/transactions/274e5ba5e27b7587afcd005168e48b50024473fa809b5675aca66044b642b7e7) |
| 2 | convert | `1b066b616c2e0ca3e16dbd97135c4ef97d612d8893403f0e92d41ea784f6acd8` | 4880727 | 300 | yes | yes (sponsor) | yes | [explorer](https://stellar.expert/explorer/testnet/tx/1b066b616c2e0ca3e16dbd97135c4ef97d612d8893403f0e92d41ea784f6acd8) | [Horizon](https://horizon-testnet.stellar.org/transactions/1b066b616c2e0ca3e16dbd97135c4ef97d612d8893403f0e92d41ea784f6acd8) |
| 3 | merge | `46a17cac527c329fbfb532660ab08e9ffcd80c06f595fa0f5a716513fee3ee2f` | 4880728 | 200 | yes | yes (sponsor) | yes | [explorer](https://stellar.expert/explorer/testnet/tx/46a17cac527c329fbfb532660ab08e9ffcd80c06f595fa0f5a716513fee3ee2f) | [Horizon](https://horizon-testnet.stellar.org/transactions/46a17cac527c329fbfb532660ab08e9ffcd80c06f595fa0f5a716513fee3ee2f) |

## Fixture before the close (SOW Appendix B)

Verification passed.

| Result | Appendix B | Check | Observed |
|---|---|---|---|
| PASS | yes | holds zero spendable XLM | balance 4.0000000, minimum 4.0000000, native selling liabilities 0.0000000, spendable 0.0000000 |
| PASS | yes | at least 3 trustlines with non-zero balances | 4 (DUSTA 0.0000007, DUSTB 0.0000003, DUSTC 0.0000005, SPTA 0.0000001) |
| PASS | yes | at least 1 open offer | 2 (ids 826793, 826794) |
| PASS | yes | at least 1 data entry | 1 (dustin.fixture) |
| PASS | no | trustline SPTA is sponsored by the reserve sponsor | sponsor GBQX4JSNEGV3AR3LER7MPPYW7HLR3WT2PFM542RC4MBKLJH6ZKJED6JQ |
| PASS | no | subentry count | 7 |
| PASS | no | entries sponsored by another account | 1 |
| PASS | no | sponsors nothing (a sponsoring account cannot be merged) | 0 |
| PASS | no | holds no liquidity pool shares | 0 |
| PASS | no | AUTH_IMMUTABLE is not set | false |
| PASS | no | the master key alone meets the high threshold | master weight 1, high threshold 0 |
| PASS | no | the destination account exists | exists |

## After the close

- `GET https://horizon-testnet.stellar.org/accounts/GDH42OX6P454OHI7CJQH6DTLBPQNGOQVSJMVCQYGQQU7ETDCTDX5BJKX` answered HTTP 404: the account no longer exists (`account-after.json`).
- Destination GDEUJWJRTQX7B3DVETOGN6GZ2DDJ2LFHVDA6LG745JNT6T57NDSDXXUN: 10.0000000 -> 14.0000007 XLM (+4.0000007), sponsoring 0 -> 0.
- Reserve sponsor GBQX4JSNEGV3AR3LER7MPPYW7HLR3WT2PFM542RC4MBKLJH6ZKJED6JQ: 10.0000000 -> 10.0000000 XLM (+0.0000000), sponsoring 1 -> 0.
- Fee sponsor GBUJSYZGG5NVF2STUFLNPIEPMYJLCUK6VHUYGX6XMNPKF53QOHMWQPEZ: 9865.9997200 -> 9865.9995700 XLM (-0.0001500), sponsoring 0 -> 0.

## Files

- `report.json`: the close report, with the inner and fee-bump envelope XDR of every transaction.
- `fixture-manifest.json`: the fixture's public manifest.
- `fixture-verification.json`: the pre-close verification.
- `account-before.json`: Horizon's view of the account before the close.
- `tx-1.json`: Horizon's record of transaction 274e5ba5e27b7587afcd005168e48b50024473fa809b5675aca66044b642b7e7.
- `tx-2.json`: Horizon's record of transaction 1b066b616c2e0ca3e16dbd97135c4ef97d612d8893403f0e92d41ea784f6acd8.
- `tx-3.json`: Horizon's record of transaction 46a17cac527c329fbfb532660ab08e9ffcd80c06f595fa0f5a716513fee3ee2f.
- `account-after.json`: Horizon's answer for the account after the close.
- `balances.json`: XLM positions before and after, and the ledgers.

Explorer links resolve only until the next testnet reset (scheduled for 2026-12-16), which deletes every account and transaction; the JSON and XDR in this directory are the durable record.
