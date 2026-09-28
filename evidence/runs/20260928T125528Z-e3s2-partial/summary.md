# Partial close through the CLI 20260928T125528Z-e3s2-partial

Story E3-S2 (AC-E3-S2-3), its partial-close receipt, on a fresh `messy` fixture. The issuer of the four dust assets sets the SEP-29 data entry `config.memo_required` = 1, so a payment to it needs a memo, and the close carries none. The plan sells DUSTA by path payment (rung 1), sends DUSTC to the destination, which trusts it (rung 3), and finds no route at all for DUSTB and SPTA (`NO_DISPOSAL_ROUTE`, every rung ruled out). The close without `--partial` refuses before signing anything; with `--partial` it runs the rest, does not merge, and prints the partial-close receipt.

Written by `node scripts/evidence-cli.mjs memo-partial`. Public data only: public keys, hashes, envelopes and Horizon JSON. The secret keys reached `dustin close` through its environment only; every file here was scanned for secret seeds and for the fixture's secret keys before it was written.

## What the reviewer should see

1. Setup: the issuer [GDUQSZVUYLSBJFVRHETXDZF6TASCOEGZDP4NGXC53LT44WIHC5NH25ZX](https://stellar.expert/explorer/testnet/account/GDUQSZVUYLSBJFVRHETXDZF6TASCOEGZDP4NGXC53LT44WIHC5NH25ZX) set the data entry `config.memo_required` = 1 in its own transaction [813e46074c6db79ef34e0861f5ec7ace2c1425723c66f5f16930a69eefe0061f](https://stellar.expert/explorer/testnet/tx/813e46074c6db79ef34e0861f5ec7ace2c1425723c66f5f16930a69eefe0061f) (ledger 4915318). See `setup.json`.
2. `dustin plan GC5TGH4I2JACACJMBAS4IGLAFWCOOWWYXMVCQOKNE64FBGMTMLFMIGTS --to GB7SVMMN4UGKHSAZYEMMLXQ4NILUGQ6BAIYNRSSM4T5JXC64SELTWXY6 --sponsor GDCZRDFKPBLATSUNIFDPSJYTDF6FGUREF75QKAXDFMTW2XCYJCYGIZ6S` exited 0: status PARTIAL, no merge. DUSTC goes to the destination (rung `send_to_destination`) because the return to its issuer is ruled out: "issuer GDUQSZVUYLSBJFVRHETXDZF6TASCOEGZDP4NGXC53LT44WIHC5NH25ZX requires a memo (SEP-29) and none was given". Unclosable: `NO_DISPOSAL_ROUTE` 0.0000003 DUSTB (path_payment: Horizon found no strict-send path to XLM for the full balance; return_to_issuer: issuer GDUQSZVUYLSBJFVRHETXDZF6TASCOEGZDP4NGXC53LT44WIHC5NH25ZX requires a memo (SEP-29) and none was given; send_to_destination: the destination holds no DUSTB trustline); `NO_DISPOSAL_ROUTE` 0.0000001 SPTA (path_payment: Horizon found no strict-send path to XLM for the full balance; return_to_issuer: issuer GDUQSZVUYLSBJFVRHETXDZF6TASCOEGZDP4NGXC53LT44WIHC5NH25ZX requires a memo (SEP-29) and none was given; send_to_destination: the destination holds no SPTA trustline). See `plan.txt` and `plan.json`.
3. `dustin close GC5TGH4I2JACACJMBAS4IGLAFWCOOWWYXMVCQOKNE64FBGMTMLFMIGTS --to GB7SVMMN4UGKHSAZYEMMLXQ4NILUGQ6BAIYNRSSM4T5JXC64SELTWXY6 --execute --yes` exited 3: "Not executed: the plan cannot end in a merge (status PARTIAL), so nothing was signed or submitted", with both `NO_DISPOSAL_ROUTE` items, the rungs ruled out and the remedy; the account's sequence number was 21111095699701764 before and 21111095699701764 after. See `transcript-refused.txt`.
4. `dustin close GC5TGH4I2JACACJMBAS4IGLAFWCOOWWYXMVCQOKNE64FBGMTMLFMIGTS --to GB7SVMMN4UGKHSAZYEMMLXQ4NILUGQ6BAIYNRSSM4T5JXC64SELTWXY6 --execute --yes --partial --report report.json` exited 4: report status `partial`; tx 1 (cleanup, applied in ledger 4915321) [d87eb28d7dfff3bc5e3dc50d4b0db34807022f3a0a033b1f236373547dea3098](https://stellar.expert/explorer/testnet/tx/d87eb28d7dfff3bc5e3dc50d4b0db34807022f3a0a033b1f236373547dea3098); tx 2 (convert, applied in ledger 4915322) [eef625a2721c96651402c4c54beb1e75711c4eaa70076090046eaccf3e20fff8](https://stellar.expert/explorer/testnet/tx/eef625a2721c96651402c4c54beb1e75711c4eaa70076090046eaccf3e20fff8), fee-bumped by the sponsor; no merge was submitted. The receipt at the end of `transcript.txt` is the partial-close receipt: under "Not closed" it lists each unclosable item with its code, every rung ruled out and the remedy. See also `report.json` and `tx-<n>.json`.
5. Horizon answers HTTP 200 for the account afterwards ([Horizon](https://horizon-testnet.stellar.org/accounts/GC5TGH4I2JACACJMBAS4IGLAFWCOOWWYXMVCQOKNE64FBGMTMLFMIGTS), `account-after.json`): it holds only 0.0000003 DUSTB and 0.0000001 SPTA, and 4.0000007 XLM. The destination's DUSTC went from 0.0000000 to 0.0000005 (`balances.json`).

## Run

| Field | Value |
|---|---|
| Captured (UTC) | 2026-09-28T12:56:38.992Z |
| Case | `memo-partial` (story E3-S2, AC-E3-S2-3) |
| Network passphrase | `Test SDF Network ; September 2015` |
| Horizon | https://horizon-testnet.stellar.org |
| Fixture | messy-20260928T125529Z-fc8510 (profile messy) |
| Account | [GC5TGH4I2JACACJMBAS4IGLAFWCOOWWYXMVCQOKNE64FBGMTMLFMIGTS](https://stellar.expert/explorer/testnet/account/GC5TGH4I2JACACJMBAS4IGLAFWCOOWWYXMVCQOKNE64FBGMTMLFMIGTS) ([Horizon](https://horizon-testnet.stellar.org/accounts/GC5TGH4I2JACACJMBAS4IGLAFWCOOWWYXMVCQOKNE64FBGMTMLFMIGTS)) |
| Destination | [GB7SVMMN4UGKHSAZYEMMLXQ4NILUGQ6BAIYNRSSM4T5JXC64SELTWXY6](https://stellar.expert/explorer/testnet/account/GB7SVMMN4UGKHSAZYEMMLXQ4NILUGQ6BAIYNRSSM4T5JXC64SELTWXY6) ([Horizon](https://horizon-testnet.stellar.org/accounts/GB7SVMMN4UGKHSAZYEMMLXQ4NILUGQ6BAIYNRSSM4T5JXC64SELTWXY6)) |
| Fee sponsor (fee account of every transaction of the close) | [GDCZRDFKPBLATSUNIFDPSJYTDF6FGUREF75QKAXDFMTW2XCYJCYGIZ6S](https://stellar.expert/explorer/testnet/account/GDCZRDFKPBLATSUNIFDPSJYTDF6FGUREF75QKAXDFMTW2XCYJCYGIZ6S) ([Horizon](https://horizon-testnet.stellar.org/accounts/GDCZRDFKPBLATSUNIFDPSJYTDF6FGUREF75QKAXDFMTW2XCYJCYGIZ6S)) |
| Reserve sponsor (sponsors the SPTA trustline) | [GCXHKCD7JFENVKT4ZQCLND7D6Y7GQLBJYKJLM3V3C4DSAWQSRTXNFWHL](https://stellar.expert/explorer/testnet/account/GCXHKCD7JFENVKT4ZQCLND7D6Y7GQLBJYKJLM3V3C4DSAWQSRTXNFWHL) ([Horizon](https://horizon-testnet.stellar.org/accounts/GCXHKCD7JFENVKT4ZQCLND7D6Y7GQLBJYKJLM3V3C4DSAWQSRTXNFWHL)) |
| Issuer of DUSTA, DUSTB, DUSTC and SPTA | [GDUQSZVUYLSBJFVRHETXDZF6TASCOEGZDP4NGXC53LT44WIHC5NH25ZX](https://stellar.expert/explorer/testnet/account/GDUQSZVUYLSBJFVRHETXDZF6TASCOEGZDP4NGXC53LT44WIHC5NH25ZX) ([Horizon](https://horizon-testnet.stellar.org/accounts/GDUQSZVUYLSBJFVRHETXDZF6TASCOEGZDP4NGXC53LT44WIHC5NH25ZX)) |
| Ledgers | latest before the close 4915319; after it 4915322 |
| Report status | partial (Everything that could run has run; the account still exists because 2 item(s) block the merge (see unclosable and blockers).) |
| Plan hash of the run | `21a0efde25fd2bb5530dcf61559118d523688341086b88d8594b957f01d3562c` |
| Merged XLM (from the merge result) | none: no merge applied |
| Fees paid by the account / by the sponsor | 0 / 900 stroops |
| Horizon for the account afterwards | HTTP 200 |

## Commands

Each ran as `node dist/cli/main.js` from this repository's build, shown here as `dustin`.

| # | Command | Expected exit | Exit | Output |
|---|---|---|---|---|
| 1 | `dustin fixture create --profile messy --dir .fixture --json` | 0 | 0 | `fixture-create.txt`, `fixture-manifest.json` |
| 2 | `dustin fixture verify fixture-manifest.json --snapshot fixture-verification.json` | 0 | 0 | `fixture-verify.txt` |
| 3 | `dustin plan GC5TGH4I2JACACJMBAS4IGLAFWCOOWWYXMVCQOKNE64FBGMTMLFMIGTS --to GB7SVMMN4UGKHSAZYEMMLXQ4NILUGQ6BAIYNRSSM4T5JXC64SELTWXY6 --sponsor GDCZRDFKPBLATSUNIFDPSJYTDF6FGUREF75QKAXDFMTW2XCYJCYGIZ6S` | 0 | 0 | `plan.txt` |
| 4 | `dustin plan GC5TGH4I2JACACJMBAS4IGLAFWCOOWWYXMVCQOKNE64FBGMTMLFMIGTS --to GB7SVMMN4UGKHSAZYEMMLXQ4NILUGQ6BAIYNRSSM4T5JXC64SELTWXY6 --sponsor GDCZRDFKPBLATSUNIFDPSJYTDF6FGUREF75QKAXDFMTW2XCYJCYGIZ6S --json` | 0 | 0 | `plan-json.txt`, `plan.json` |
| 5 | `dustin close GC5TGH4I2JACACJMBAS4IGLAFWCOOWWYXMVCQOKNE64FBGMTMLFMIGTS --to GB7SVMMN4UGKHSAZYEMMLXQ4NILUGQ6BAIYNRSSM4T5JXC64SELTWXY6 --execute --yes` | 3 | 3 | `transcript-refused.txt` |
| 6 | `dustin close GC5TGH4I2JACACJMBAS4IGLAFWCOOWWYXMVCQOKNE64FBGMTMLFMIGTS --to GB7SVMMN4UGKHSAZYEMMLXQ4NILUGQ6BAIYNRSSM4T5JXC64SELTWXY6 --execute --yes --partial --report report.json` | 4 | 4 | `transcript.txt` |

## Setup transactions

Submitted by this script before the plan, to give the fixture the state this case needs.

| Purpose | Hash | Result | Ledger | Fee account | Source | Links |
|---|---|---|---|---|---|---|
| the issuer sets config.memo_required = 1 (SEP-29) | `813e46074c6db79ef34e0861f5ec7ace2c1425723c66f5f16930a69eefe0061f` | applied | 4915318 | `GDUQSZVUYLSBJFVRHETXDZF6TASCOEGZDP4NGXC53LT44WIHC5NH25ZX` | `GDUQSZVUYLSBJFVRHETXDZF6TASCOEGZDP4NGXC53LT44WIHC5NH25ZX` | [explorer](https://stellar.expert/explorer/testnet/tx/813e46074c6db79ef34e0861f5ec7ace2c1425723c66f5f16930a69eefe0061f), [Horizon](https://horizon-testnet.stellar.org/transactions/813e46074c6db79ef34e0861f5ec7ace2c1425723c66f5f16930a69eefe0061f) |

## Transactions of the close

| # | Phase | Hash | Result | Ledger | Fee charged (stroops) | Fee account is the sponsor | Source is the account | Inner max_fee | Links |
|---|---|---|---|---|---|---|---|---|---|
| 1 | cleanup | `d87eb28d7dfff3bc5e3dc50d4b0db34807022f3a0a033b1f236373547dea3098` | applied | 4915321 | 600 | yes (sponsor) | yes | 0 | [explorer](https://stellar.expert/explorer/testnet/tx/d87eb28d7dfff3bc5e3dc50d4b0db34807022f3a0a033b1f236373547dea3098), [Horizon](https://horizon-testnet.stellar.org/transactions/d87eb28d7dfff3bc5e3dc50d4b0db34807022f3a0a033b1f236373547dea3098) |
| 2 | convert | `eef625a2721c96651402c4c54beb1e75711c4eaa70076090046eaccf3e20fff8` | applied | 4915322 | 300 | yes (sponsor) | yes | 0 | [explorer](https://stellar.expert/explorer/testnet/tx/eef625a2721c96651402c4c54beb1e75711c4eaa70076090046eaccf3e20fff8), [Horizon](https://horizon-testnet.stellar.org/transactions/eef625a2721c96651402c4c54beb1e75711c4eaa70076090046eaccf3e20fff8) |

## Checks

| Result | Check | Observed |
|---|---|---|
| PASS | The plan is partial, with no merge | status partial; steps cancel_offer, cancel_offer, dispose_balance, remove_trustline, remove_data, dispose_balance, remove_trustline |
| PASS | DUSTC goes to the destination (rung 3): the return to its issuer needs a memo | rung send_to_destination; return to issuer ruled out: issuer GDUQSZVUYLSBJFVRHETXDZF6TASCOEGZDP4NGXC53LT44WIHC5NH25ZX requires a memo (SEP-29) and none was given |
| PASS | DUSTB and SPTA are unclosable with NO_DISPOSAL_ROUTE, every rung ruled out | NO_DISPOSAL_ROUTE DUSTB, NO_DISPOSAL_ROUTE SPTA |
| PASS | Without --partial, `dustin close --execute` signs nothing and says why | the output says "Not executed" and names NO_DISPOSAL_ROUTE 0.0000003 DUSTB, NO_DISPOSAL_ROUTE 0.0000001 SPTA and the remedy |
| PASS | The account's sequence number did not move during the refused close | 21111095699701764 before, 21111095699701764 after |
| PASS | With --partial, everything else ran and no merge was submitted (report status partial) | status partial; cleanup applied, convert applied |
| PASS | The receipt lists what stays unclosable, with the reason and the remedy | it lists NO_DISPOSAL_ROUTE 0.0000003 DUSTB, NO_DISPOSAL_ROUTE 0.0000001 SPTA, every rung of the ladder is ruled out |
| PASS | Every transaction of the close on the ledger is a fee bump: fee account the sponsor, source the account, inner max_fee 0 | 2 of 2 transactions on the ledger |
| PASS | Horizon still has the account afterwards (HTTP 200) | HTTP 200 |
| PASS | Afterwards the account holds exactly DUSTB 0.0000003 and SPTA 0.0000001, and no data entry | DUSTB 0.0000003, SPTA 0.0000001; 0 data entries |
| PASS | The destination's DUSTC grew by the 0.0000005 DUSTC sent to it | +0.0000005 DUSTC |
| PASS | The reserve sponsor still sponsors the SPTA trustline, which stays | num_sponsoring 1 -> 1 |

## Balances

Latest ledger before the close 4915319, after it 4915322.

- Account `GC5TGH4I2JACACJMBAS4IGLAFWCOOWWYXMVCQOKNE64FBGMTMLFMIGTS`: 4.0000000 XLM -> 4.0000007 XLM (+0.0000007), num_sponsoring 0 -> 0; trustlines DUSTA 0.0000007 -> none, DUSTC 0.0000005 -> none.
- Destination `GB7SVMMN4UGKHSAZYEMMLXQ4NILUGQ6BAIYNRSSM4T5JXC64SELTWXY6`: 10.0000000 XLM -> 10.0000000 XLM (+0.0000000), num_sponsoring 0 -> 0; trustlines DUSTC 0.0000000 -> 0.0000005.
- Reserve sponsor `GCXHKCD7JFENVKT4ZQCLND7D6Y7GQLBJYKJLM3V3C4DSAWQSRTXNFWHL`: 10.0000000 XLM -> 10.0000000 XLM (+0.0000000), num_sponsoring 1 -> 1.
- Fee sponsor `GDCZRDFKPBLATSUNIFDPSJYTDF6FGUREF75QKAXDFMTW2XCYJCYGIZ6S`: 9865.9997200 XLM -> 9865.9996300 XLM (-0.0000900), num_sponsoring 0 -> 0.

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
- `transcript-refused.txt`: `dustin close --execute --yes` without `--partial`: the refusal.
- `transcript.txt`: the close that ran (`--report report.json`), with its receipt.
- `report.json`: the close report written by `--report`, with both envelopes of every transaction as XDR.
- `account-after.json`: Horizon's answer for the account after the close: status and body.
- `balances.json`: XLM, num_sponsoring and trustlines of each role before and after, and the ledgers.
- `tx-1.json`: Horizon's record of transaction 1, d87eb28d7dfff3bc5e3dc50d4b0db34807022f3a0a033b1f236373547dea3098.
- `tx-2.json`: Horizon's record of transaction 2, eef625a2721c96651402c4c54beb1e75711c4eaa70076090046eaccf3e20fff8.

Explorer and Horizon links resolve only until the next testnet reset (scheduled for 2026-12-16), which deletes every account and transaction; the JSON, the XDR and the transcripts in this directory are the durable record.
