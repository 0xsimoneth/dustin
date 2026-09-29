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

## B-02: the same recipe plus 1 XLM

Matrix row B-02 records the existing tool on the baseline recipe with 1 XLM the account can spend, to see how far it gets when the fee is not the obstacle. The baseline fixture itself stays at zero spendable XLM, so B-02 uses a fresh fixture of the same recipe:

1. `node scripts/baseline-b03.mjs --prepare-b02` builds a fresh `messy` fixture (the recipe hash of the baseline fixture), saves its checks as `evidence/baseline/b02-verify-before-the-1-xlm.json`, pays it 1 XLM from its own fee sponsor, and prints the account, the destination and the payment's hash. Its keys stay in `.fixture/<id>/keys.json`.
2. Record the existing tool on that account exactly as in steps 3 to 5 above, and save the recording as `evidence/baseline/demolisher-b02.mp4` (or its link) with a still of where it stops.
3. Fill the B-02 lines of the result below, with every transaction hash the tool produced.

Prepared on 2026-09-29 by `--prepare-b02`, ready for the recording (or prepare a fresh one): fixture `messy-20260929T185626Z-60a26c`, account `GCT4MKGXIAT246OV246CVYXIZYT3FLXVOBIQ5BQ4Q5CQPKZGD7JBX4MM` (5.0000000 XLM, 1 XLM of it spendable), destination `GBWWAI5TUITATE6PEAPKXQK6Y2WI6B7BPGZ27QSSE2M3LBWOXQGDVDWK`, the 1 XLM paid by its fee sponsor in [`568ebca6787e8f82e52cd06f9650875cfa1b66fd31072ad59ab70d5a2f5612a5`](https://stellar.expert/explorer/testnet/tx/568ebca6787e8f82e52cd06f9650875cfa1b66fd31072ad59ab70d5a2f5612a5) (ledger 4936930); its checks before the 1 XLM: [`b02-verify-before-the-1-xlm.json`](b02-verify-before-the-1-xlm.json) (12 of 12 passed). Its secret key is the `fixture` entry of `.fixture/messy-20260929T185626Z-60a26c/keys.json` on the machine that prepared it.

## B-03: Dustin on the same recipe, after both recordings

One command, run once B-01 (and B-02) are recorded: `node scripts/baseline-b03.mjs`. It refuses to start while `evidence/baseline/verify-after.json` (step 6 above) is missing. It builds the CLI, rebuilds the recipe twice from Friendbot and closes each fixture through the command line, recorded under `evidence/runs/` like every other run:

- `scripts/evidence-cli.mjs baseline-zero` (FIX-base-1, zero spendable XLM), label `b03-base1`;
- `scripts/evidence-cli.mjs baseline-plus1` (FIX-base-2, the same after 1 XLM from the fee sponsor), label `b03-base2`.

Each run checks that the new fixture's recipe hash is the baseline fixture's (`a00bfd18c386d2f536daf544513ee7153c433f62a68437bc3a0af11bdc4ddd9b`, in `test/fixtures/horizon/messy/manifest.json`), that the plan is closable, that every transaction is a fee bump paid by the sponsor, and that Horizon answers 404 for the account afterwards. The script then writes `evidence/baseline/b03-comparison.md`, the side-by-side table of the matrix (tool, transactions submitted, where it stopped, the account afterwards, XLM delivered), with the existing tool's rows taken from the result below. The baseline fixture `messy-20260926T035942Z` itself is never closed by the script: whether to close it after the recordings is the builder's call. The command was rehearsed on 2026-09-29 with `--before-recordings`: both closes passed every check ([base 1](../runs/20260929T185240Z-b03-rehearsal-base1/summary.md), [base 2](../runs/20260929T185359Z-b03-rehearsal-base2/summary.md), [the rehearsal's table](b03-comparison-rehearsal.md)); the rehearsal does not stand for B-03, which runs after the recordings.

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
| B-02: fixture, recorded on, where it stopped, transactions | to be filled (the account prepared by `--prepare-b02`, above) |
