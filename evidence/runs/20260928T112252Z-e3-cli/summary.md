# Live CLI close 20260928T112252Z-e3-cli

The Epic 3 metric close (story E3-S7) driven end to end through the command line: `dustin fixture create --profile messy`, `dustin fixture verify`, the dry-run `dustin plan`, then `dustin close --execute --yes --report`, all with the default ladder order (the SOW order). Public data only: public keys, hashes, envelopes and Horizon JSON; the secrets were passed to the close command in its environment and appear in no file.

| Field | Value |
|---|---|
| Captured (UTC) | 2026-09-28T11:24:04.574Z |
| Fixture | messy-20260928T112252Z-580d8f (profile messy) |
| Closed account | [GCPPFHGLKA7GCBWJXBH4EXFXS3OXAMXFLOBAZLU2K3KKMO6JKZORNFW7](https://stellar.expert/explorer/testnet/account/GCPPFHGLKA7GCBWJXBH4EXFXS3OXAMXFLOBAZLU2K3KKMO6JKZORNFW7) |
| Destination | [GDPZI3OAYYEAXTYY2OHFDZAEEG4PXNBN7AHNLQTEH22O5HTBGBSVB2TS](https://stellar.expert/explorer/testnet/account/GDPZI3OAYYEAXTYY2OHFDZAEEG4PXNBN7AHNLQTEH22O5HTBGBSVB2TS) |
| Fee sponsor (fee account of every transaction) | [GBCHRHGJMTMA2MNEVJWZL5GRYXQ3OF5CRKVMZHPFPASSW2DBLPQFEHOG](https://stellar.expert/explorer/testnet/account/GBCHRHGJMTMA2MNEVJWZL5GRYXQ3OF5CRKVMZHPFPASSW2DBLPQFEHOG) |
| Reserve sponsor | [GCFMPHR7TIPDOYD2UHXSE2PLWIMFYIEWC2NQ3N4RKLSSDVXODU5REILD](https://stellar.expert/explorer/testnet/account/GCFMPHR7TIPDOYD2UHXSE2PLWIMFYIEWC2NQ3N4RKLSSDVXODU5REILD) |
| CLI exit code | 0 |
| Report status | closed |
| Merged XLM (from the merge result) | 4.0000007 |
| Fees paid by the closed account / by the sponsor | 0 / 1500 stroops |
| Horizon for the account afterwards | HTTP 404 |
| Ledgers | before 4914207; after 4914211 |

| # | Phase | Hash | Result | Ledger | Fee account is the sponsor | Source is the closed account | Inner max_fee | Explorer |
|---|---|---|---|---|---|---|---|---|
| 1 | cleanup | `0ee9fb5e4bb683519af3190e45c6e0350a0819aa509d65fddb34a247e65dcaac` | applied | 4914209 | yes (sponsor) | yes | 0 | [explorer](https://stellar.expert/explorer/testnet/tx/0ee9fb5e4bb683519af3190e45c6e0350a0819aa509d65fddb34a247e65dcaac) |
| 2 | convert | `f7161ce4667cc9b3457aa6daa948f8b39df847b0576ab73849ac7325ad81f700` | applied | 4914210 | yes (sponsor) | yes | 0 | [explorer](https://stellar.expert/explorer/testnet/tx/f7161ce4667cc9b3457aa6daa948f8b39df847b0576ab73849ac7325ad81f700) |
| 3 | merge | `36e53646514a36c673830955b661b91de297842481295f458de8c5911e5c989c` | applied | 4914211 | yes (sponsor) | yes | 0 | [explorer](https://stellar.expert/explorer/testnet/tx/36e53646514a36c673830955b661b91de297842481295f458de8c5911e5c989c) |

Balances:

- Destination GDPZI3OAYYEAXTYY2OHFDZAEEG4PXNBN7AHNLQTEH22O5HTBGBSVB2TS: 10.0000000 -> 14.0000007 XLM, num_sponsoring 0 -> 0.
- Reserve sponsor GCFMPHR7TIPDOYD2UHXSE2PLWIMFYIEWC2NQ3N4RKLSSDVXODU5REILD: 10.0000000 -> 10.0000000 XLM, num_sponsoring 1 -> 0.
- Fee sponsor GBCHRHGJMTMA2MNEVJWZL5GRYXQ3OF5CRKVMZHPFPASSW2DBLPQFEHOG: 9865.9997200 -> 9865.9995700 XLM, num_sponsoring 0 -> 0.

Files: `transcript.txt` (the close command's output), `plan.txt` and `plan.json` (the dry-run plan before the close), `report.json` (the close report written by `--report`), `fixture-manifest.json`, `fixture-verification.json` (SOW Appendix B checks before the close), `account-before.json`, `tx-<n>.json` (Horizon's record of each hash), `account-after.json` (Horizon's answer for the closed account), `balances.json`. Explorer links stop resolving at the next testnet reset (scheduled for 2026-12-16); the JSON and XDR are the durable record.
