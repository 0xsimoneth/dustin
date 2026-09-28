# Sequence-guard wait through the CLI 20260928T125223Z-e3s4-wait

Story E3-S4 (AC-E3-S4-2; matrix row S-04), a live transcript of the sequence-guard wait, on a fresh `messy` fixture. A BumpSequence raises the account's sequence number to (latest ledger + 12) << 32, so a merge fails with ACCOUNT_MERGE_SEQNUM_TOO_FAR in every ledger before (sequence number at the merge >> 32) + 1 (docs/README.md canonical decision 10). The account holds zero spendable XLM, so the sponsor fee-bumps the BumpSequence. The dry-run plan runs the merge alone and says the executor waits; `dustin close --execute` runs the cleanup, waits for the ledger, then merges.

Written by `node scripts/evidence-cli.mjs seq-wait`. Public data only: public keys, hashes, envelopes and Horizon JSON. The secret keys reached `dustin close` through its environment only; every file here was scanned for secret seeds and for the fixture's secret keys before it was written.

## What the reviewer should see

1. Setup: a BumpSequence from the account to (4915280 + 12) << 32 = 21111018390290432, fee-bumped by the sponsor: [cb474fdf5f1b37d015e7c4007c34b83ef58ad5ca3e35a331bca3be516ecd2964](https://stellar.expert/explorer/testnet/tx/cb474fdf5f1b37d015e7c4007c34b83ef58ad5ca3e35a331bca3be516ecd2964) (ledger 4915281). See `setup.json`.
2. `dustin plan GBOZONXB4R6US3HGYH3B6J2ZXTARMY6T2ER4NX3CRP36X4OJFHBK7J5S --to GD3SL7JZIN7KRPVSHYTXX47BZ4ZGVI6NK3T6YO2NHAQ743XDUELELWHS --sponsor GA4WL3KMS5GLVJSDVDTVAWV6OO2MMNXLYN2YZRZNZ5NZVKZMGASEERRL` exited 0: status CLOSABLE, 3 transactions (cleanup (9 ops), convert (2 ops), merge (1 op)), the merge alone last, because the sequence guard makes it wait until ledger 4915293 (sequence number at the merge 21111018390290435); the plan says the executor waits. See `plan.txt` and `plan.json`.
3. `dustin close GBOZONXB4R6US3HGYH3B6J2ZXTARMY6T2ER4NX3CRP36X4OJFHBK7J5S --to GD3SL7JZIN7KRPVSHYTXX47BZ4ZGVI6NK3T6YO2NHAQ743XDUELELWHS --execute --yes --report report.json` exited 0: the transactions before the merge applied first, tx 1 (cleanup, applied in ledger 4915284) [61cc1a588651b1e9af4dc884cc9f6be175f434538ea807fc4c3ba6770632b153](https://stellar.expert/explorer/testnet/tx/61cc1a588651b1e9af4dc884cc9f6be175f434538ea807fc4c3ba6770632b153); tx 2 (convert, applied in ledger 4915285) [998011faedb03175f2f6808f24e8c6241e6bb0988534dad93311120cb33f6311](https://stellar.expert/explorer/testnet/tx/998011faedb03175f2f6808f24e8c6241e6bb0988534dad93311120cb33f6311); then the command printed the wait ("tx 3/3  waiting for the sequence guard: the merge can land from ledger 4,915,293", "the latest ledger is 4,915,285, about 40 s to go", "waited     ledger 4,915,292 has closed; the merge can land from ledger 4,915,293"); then the merge [f66c93cbd27d397f6c3e683a455b32bb150f0c51334fd955b2db5fa5838456e9](https://stellar.expert/explorer/testnet/tx/f66c93cbd27d397f6c3e683a455b32bb150f0c51334fd955b2db5fa5838456e9) applied in ledger 4915293, the unblocking ledger itself. No merge was refused with op_seq_num_too_far. See `transcript.txt` and `report.json`.
4. Horizon answers HTTP 404 for the account afterwards ([Horizon](https://horizon-testnet.stellar.org/accounts/GBOZONXB4R6US3HGYH3B6J2ZXTARMY6T2ER4NX3CRP36X4OJFHBK7J5S), `account-after.json`); the destination received the merged 4.0000007 XLM (`balances.json`).

## Run

| Field | Value |
|---|---|
| Captured (UTC) | 2026-09-28T12:54:14.752Z |
| Case | `seq-wait` (story E3-S4, AC-E3-S4-2; matrix row S-04) |
| Network passphrase | `Test SDF Network ; September 2015` |
| Horizon | https://horizon-testnet.stellar.org |
| Fixture | messy-20260928T125224Z-4d622f (profile messy) |
| Account | [GBOZONXB4R6US3HGYH3B6J2ZXTARMY6T2ER4NX3CRP36X4OJFHBK7J5S](https://stellar.expert/explorer/testnet/account/GBOZONXB4R6US3HGYH3B6J2ZXTARMY6T2ER4NX3CRP36X4OJFHBK7J5S) ([Horizon](https://horizon-testnet.stellar.org/accounts/GBOZONXB4R6US3HGYH3B6J2ZXTARMY6T2ER4NX3CRP36X4OJFHBK7J5S)) |
| Destination | [GD3SL7JZIN7KRPVSHYTXX47BZ4ZGVI6NK3T6YO2NHAQ743XDUELELWHS](https://stellar.expert/explorer/testnet/account/GD3SL7JZIN7KRPVSHYTXX47BZ4ZGVI6NK3T6YO2NHAQ743XDUELELWHS) ([Horizon](https://horizon-testnet.stellar.org/accounts/GD3SL7JZIN7KRPVSHYTXX47BZ4ZGVI6NK3T6YO2NHAQ743XDUELELWHS)) |
| Fee sponsor (fee account of every transaction of the close) | [GA4WL3KMS5GLVJSDVDTVAWV6OO2MMNXLYN2YZRZNZ5NZVKZMGASEERRL](https://stellar.expert/explorer/testnet/account/GA4WL3KMS5GLVJSDVDTVAWV6OO2MMNXLYN2YZRZNZ5NZVKZMGASEERRL) ([Horizon](https://horizon-testnet.stellar.org/accounts/GA4WL3KMS5GLVJSDVDTVAWV6OO2MMNXLYN2YZRZNZ5NZVKZMGASEERRL)) |
| Reserve sponsor (sponsors the SPTA trustline) | [GACQCWDOZ4TGFKSJRPKU4XSKGSN34QWJ4T2TZCOMCLWK6LWT2X23YS7H](https://stellar.expert/explorer/testnet/account/GACQCWDOZ4TGFKSJRPKU4XSKGSN34QWJ4T2TZCOMCLWK6LWT2X23YS7H) ([Horizon](https://horizon-testnet.stellar.org/accounts/GACQCWDOZ4TGFKSJRPKU4XSKGSN34QWJ4T2TZCOMCLWK6LWT2X23YS7H)) |
| Issuer of DUSTA, DUSTB, DUSTC and SPTA | [GAYMDGFMVQPC7LNQHWDBSU373U26TJBAAMVAVWI2O25XNDAY2YLRZFPZ](https://stellar.expert/explorer/testnet/account/GAYMDGFMVQPC7LNQHWDBSU373U26TJBAAMVAVWI2O25XNDAY2YLRZFPZ) ([Horizon](https://horizon-testnet.stellar.org/accounts/GAYMDGFMVQPC7LNQHWDBSU373U26TJBAAMVAVWI2O25XNDAY2YLRZFPZ)) |
| Ledgers | latest before the close 4915282; after it 4915293 |
| Report status | closed |
| Plan hash of the run | `a65f0221ea4fe75f1fdeebfc6441a8d140fc9001f860c25191f9714c32defc8e` |
| Merged XLM (from the merge result) | 4.0000007 |
| Fees paid by the account / by the sponsor | 0 / 1500 stroops |
| Horizon for the account afterwards | HTTP 404 |

## Commands

Each ran as `node dist/cli/main.js` from this repository's build, shown here as `dustin`.

| # | Command | Expected exit | Exit | Output |
|---|---|---|---|---|
| 1 | `dustin fixture create --profile messy --dir .fixture --json` | 0 | 0 | `fixture-create.txt`, `fixture-manifest.json` |
| 2 | `dustin fixture verify fixture-manifest.json --snapshot fixture-verification.json` | 0 | 0 | `fixture-verify.txt` |
| 3 | `dustin plan GBOZONXB4R6US3HGYH3B6J2ZXTARMY6T2ER4NX3CRP36X4OJFHBK7J5S --to GD3SL7JZIN7KRPVSHYTXX47BZ4ZGVI6NK3T6YO2NHAQ743XDUELELWHS --sponsor GA4WL3KMS5GLVJSDVDTVAWV6OO2MMNXLYN2YZRZNZ5NZVKZMGASEERRL` | 0 | 0 | `plan.txt` |
| 4 | `dustin plan GBOZONXB4R6US3HGYH3B6J2ZXTARMY6T2ER4NX3CRP36X4OJFHBK7J5S --to GD3SL7JZIN7KRPVSHYTXX47BZ4ZGVI6NK3T6YO2NHAQ743XDUELELWHS --sponsor GA4WL3KMS5GLVJSDVDTVAWV6OO2MMNXLYN2YZRZNZ5NZVKZMGASEERRL --json` | 0 | 0 | `plan-json.txt`, `plan.json` |
| 5 | `dustin close GBOZONXB4R6US3HGYH3B6J2ZXTARMY6T2ER4NX3CRP36X4OJFHBK7J5S --to GD3SL7JZIN7KRPVSHYTXX47BZ4ZGVI6NK3T6YO2NHAQ743XDUELELWHS --execute --yes --report report.json` | 0 | 0 | `transcript.txt` |

## Setup transactions

Submitted by this script before the plan, to give the fixture the state this case needs.

| Purpose | Hash | Result | Ledger | Fee account | Source | Links |
|---|---|---|---|---|---|---|
| BumpSequence to (4915280 + 12) << 32, fee-bumped by the sponsor | `cb474fdf5f1b37d015e7c4007c34b83ef58ad5ca3e35a331bca3be516ecd2964` | applied | 4915281 | `GA4WL3KMS5GLVJSDVDTVAWV6OO2MMNXLYN2YZRZNZ5NZVKZMGASEERRL` | `GBOZONXB4R6US3HGYH3B6J2ZXTARMY6T2ER4NX3CRP36X4OJFHBK7J5S` | [explorer](https://stellar.expert/explorer/testnet/tx/cb474fdf5f1b37d015e7c4007c34b83ef58ad5ca3e35a331bca3be516ecd2964), [Horizon](https://horizon-testnet.stellar.org/transactions/cb474fdf5f1b37d015e7c4007c34b83ef58ad5ca3e35a331bca3be516ecd2964) |

## Transactions of the close

| # | Phase | Hash | Result | Ledger | Fee charged (stroops) | Fee account is the sponsor | Source is the account | Inner max_fee | Links |
|---|---|---|---|---|---|---|---|---|---|
| 1 | cleanup | `61cc1a588651b1e9af4dc884cc9f6be175f434538ea807fc4c3ba6770632b153` | applied | 4915284 | 1000 | yes (sponsor) | yes | 0 | [explorer](https://stellar.expert/explorer/testnet/tx/61cc1a588651b1e9af4dc884cc9f6be175f434538ea807fc4c3ba6770632b153), [Horizon](https://horizon-testnet.stellar.org/transactions/61cc1a588651b1e9af4dc884cc9f6be175f434538ea807fc4c3ba6770632b153) |
| 2 | convert | `998011faedb03175f2f6808f24e8c6241e6bb0988534dad93311120cb33f6311` | applied | 4915285 | 300 | yes (sponsor) | yes | 0 | [explorer](https://stellar.expert/explorer/testnet/tx/998011faedb03175f2f6808f24e8c6241e6bb0988534dad93311120cb33f6311), [Horizon](https://horizon-testnet.stellar.org/transactions/998011faedb03175f2f6808f24e8c6241e6bb0988534dad93311120cb33f6311) |
| 3 | merge | `f66c93cbd27d397f6c3e683a455b32bb150f0c51334fd955b2db5fa5838456e9` | applied | 4915293 | 200 | yes (sponsor) | yes | 0 | [explorer](https://stellar.expert/explorer/testnet/tx/f66c93cbd27d397f6c3e683a455b32bb150f0c51334fd955b2db5fa5838456e9), [Horizon](https://horizon-testnet.stellar.org/transactions/f66c93cbd27d397f6c3e683a455b32bb150f0c51334fd955b2db5fa5838456e9) |

## Checks

| Result | Check | Observed |
|---|---|---|
| PASS | The plan is closable, runs the merge alone last, and says the executor waits for the unblocking ledger | status closable; transactions cleanup (9 ops), convert (2 ops), merge (1 op); guard ok false, sequence at merge 21111018390290435, unblocks at ledger 4915293 |
| PASS | The report says closed, verified gone, with no stop | status closed; verification HTTP 404; stop none |
| PASS | Horizon answers HTTP 404 for the account afterwards | HTTP 404 |
| PASS | Every transaction of the close on the ledger is a fee bump: fee account the sponsor, source the account, inner max_fee 0 | 3 of 3 transactions on the ledger |
| PASS | The destination's XLM grew by exactly the merged amount | 10.0000000 -> 14.0000007 XLM (+4.0000007); merged 4.0000007 XLM |
| PASS | The transcript shows the cleanup, then the wait for the sequence guard, then the merge | tx 3/3  waiting for the sequence guard: the merge can land from ledger 4,915,293 / the latest ledger is 4,915,285, about 40 s to go / waited     ledger 4,915,292 has closed; the merge can land from ledger 4,915,293 |
| PASS | The merge applied in or after the unblocking ledger 4915293, and none failed with op_seq_num_too_far | 1 merge envelope(s); applied in ledger 4915293 |

## Balances

Latest ledger before the close 4915282, after it 4915293.

- Destination `GD3SL7JZIN7KRPVSHYTXX47BZ4ZGVI6NK3T6YO2NHAQ743XDUELELWHS`: 10.0000000 XLM -> 14.0000007 XLM (+4.0000007), num_sponsoring 0 -> 0.
- Reserve sponsor `GACQCWDOZ4TGFKSJRPKU4XSKGSN34QWJ4T2TZCOMCLWK6LWT2X23YS7H`: 10.0000000 XLM -> 10.0000000 XLM (+0.0000000), num_sponsoring 1 -> 0.
- Fee sponsor `GA4WL3KMS5GLVJSDVDTVAWV6OO2MMNXLYN2YZRZNZ5NZVKZMGASEERRL`: 9865.9997000 XLM -> 9865.9995500 XLM (-0.0001500), num_sponsoring 0 -> 0.

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
- `tx-1.json`: Horizon's record of transaction 1, 61cc1a588651b1e9af4dc884cc9f6be175f434538ea807fc4c3ba6770632b153.
- `tx-2.json`: Horizon's record of transaction 2, 998011faedb03175f2f6808f24e8c6241e6bb0988534dad93311120cb33f6311.
- `tx-3.json`: Horizon's record of transaction 3, f66c93cbd27d397f6c3e683a455b32bb150f0c51334fd955b2db5fa5838456e9.

Explorer and Horizon links resolve only until the next testnet reset (scheduled for 2026-12-16), which deletes every account and transaction; the JSON, the XDR and the transcripts in this directory are the durable record.
