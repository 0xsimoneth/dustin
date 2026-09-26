# Baseline: the existing tool on the messy fixture

SOW Deliverable 3 asks for a recorded baseline run of the existing tool (StellarExpert's Account Demolisher) against the same fixture Dustin closes, "so the gap can be checked rather than taken on trust". This folder holds that recording and the Horizon evidence around it.

## Fixture

| Field | Value |
|---|---|
| Fixture id | `messy-20260926T035942Z` |
| Fixture account | `GAZF3X7YYCI7PHZYZDQOGPLVN2RVD37YIQG7YEY6QJW6IK224Y4R3MBK` |
| Destination | `GBQGFM635UIV2BTCTYSMKKJBESY47VXZLCIPGKW3GZJSSY6B45U2DH2C` |
| Explorer | https://stellar.expert/explorer/testnet/account/GAZF3X7YYCI7PHZYZDQOGPLVN2RVD37YIQG7YEY6QJW6IK224Y4R3MBK |
| Public manifest | `test/fixtures/horizon/messy/manifest.json` |
| State | balance 4.0000000 XLM = minimum balance, spendable 0; 4 trustlines with dust (1 sponsored), 2 open offers, 1 data entry |

## Recording protocol

1. Build the CLI: `npm run build`.
2. Snapshot the fixture before the run:
   `node dist/cli/main.js fixture verify .fixture/messy-20260926T035942Z/manifest.json --snapshot evidence/baseline/verify-before.json`
   Every check must pass.
3. Start the screen recording (terminal prompt reduced to `$ `, no personal names, paths or other tabs visible).
4. Open https://stellar.expert/demolisher/testnet in a clean browser profile. Paste the fixture's secret key (the `fixture` entry in `.fixture/messy-20260926T035942Z/keys.json`; testnet only) and the destination above. Start the tool and keep recording until it stops. Record the exact message it shows.
5. Stop the recording. Save it as `evidence/baseline/demolisher-2026-09-26.mp4` (or keep it outside git and put the link below if it is too large) and a still frame of the stopping point as `evidence/baseline/demolisher-stop.png`.
6. Snapshot the fixture after the run:
   `node dist/cli/main.js fixture verify .fixture/messy-20260926T035942Z/manifest.json --snapshot evidence/baseline/verify-after.json`
   Every check must still pass, which proves Dustin later closes the same, unchanged account.

## Expected observation

From the tool's public client source (`business-logic/demolisher/demolisher-tx-builder.js` in https://github.com/stellar-expert/stellar-expert-explorer, MIT), every transaction is sourced from and paid by the account being closed, with no fee bump. An unbumped transaction from this fixture is rejected by the network with `tx_insufficient_balance` (the fixture builder recorded exactly that). The expected stopping point is therefore the first transaction, retried and then abandoned. This is an expectation to be confirmed by the recording, not a claim.

## Result

| Field | Value |
|---|---|
| Recorded on (UTC) | to be filled |
| Tool URL and version seen | to be filled |
| Where it stopped (message, time in the recording) | to be filled |
| Transactions it submitted | to be filled |
| Fixture unchanged afterwards | to be filled (`verify-after.json`) |
