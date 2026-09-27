# Live CLI close 20260927T200015Z

The same close as `evidence/runs/20260926T125350Z/`, driven end to end through the command line: `dustin fixture create`, `dustin fixture verify`, then `dustin close --execute --yes --report`. Public data only: public keys, hashes, envelopes and Horizon JSON; the secrets were passed to the command in its environment and appear in no file.

| Field | Value |
|---|---|
| Fixture | messy-20260927T200015Z-6f9a86 (profile messy) |
| Closed account | [GBBF5QVZJKGOUSK57AUHJ6I2DCT4EDRWIHAN4BJRHOVILN7P3XEMNYA7](https://stellar.expert/explorer/testnet/account/GBBF5QVZJKGOUSK57AUHJ6I2DCT4EDRWIHAN4BJRHOVILN7P3XEMNYA7) |
| Destination | [GAH2NP3B2L4YKKHX5DEDRUC7VLOX5L43IPJRB2LLSYOAMJYGZ4MPUJJY](https://stellar.expert/explorer/testnet/account/GAH2NP3B2L4YKKHX5DEDRUC7VLOX5L43IPJRB2LLSYOAMJYGZ4MPUJJY) |
| Fee sponsor | [GDIS2L4EMZVOY3NIOXY3VJRWFVSPBK2WIO2WNZRLJOJQ2KUNAPIRKQDF](https://stellar.expert/explorer/testnet/account/GDIS2L4EMZVOY3NIOXY3VJRWFVSPBK2WIO2WNZRLJOJQ2KUNAPIRKQDF) |
| Reserve sponsor | [GDGG6WCEM3SYNLC4MAPI5HUDEOR3QQQQ5RQNY2USF64JOXTBQUZDUYGK](https://stellar.expert/explorer/testnet/account/GDGG6WCEM3SYNLC4MAPI5HUDEOR3QQQQ5RQNY2USF64JOXTBQUZDUYGK) |
| CLI exit code | 0 |
| Report status | closed |
| Horizon for the account afterwards | HTTP 404 |

| # | Phase | Hash | Result | Ledger | Explorer |
|---|---|---|---|---|---|
| 1 | cleanup | `7a995eee92b92a79b67f19bbc35456946fa76566601370c662ce40cdb0159da2` | applied | 4903138 | [explorer](https://stellar.expert/explorer/testnet/tx/7a995eee92b92a79b67f19bbc35456946fa76566601370c662ce40cdb0159da2) |
| 2 | convert | `be2217d74ec259ce06fde82038e87bca0af43923ee9318ebe300197ee61d29d6` | applied | 4903139 | [explorer](https://stellar.expert/explorer/testnet/tx/be2217d74ec259ce06fde82038e87bca0af43923ee9318ebe300197ee61d29d6) |
| 3 | merge | `36d8362b643c8b5886a3b61dcb0ba97fbc755c856d29c953c846edd15a99c4f6` | applied | 4903140 | [explorer](https://stellar.expert/explorer/testnet/tx/36d8362b643c8b5886a3b61dcb0ba97fbc755c856d29c953c846edd15a99c4f6) |

Files: `transcript.txt` (the command's output), `report.json` (the close report written by `--report`), `fixture-verification.json` (SOW Appendix B checks before the close), `tx-<n>.json` (Horizon's record of each hash), `account-after.json` (Horizon's answer for the closed account). Explorer links stop resolving at the next testnet reset (scheduled for 2026-12-16).
