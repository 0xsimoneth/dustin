# Unclosable exit through the CLI 20260928T125414Z-edge-frozen

The SOW's week-3 outcome, "the deliberately illiquid asset exits through the unclosable path with a stated reason", on the `edge` fixture (docs/README.md canonical decision 3; matrix rows S-02 and S-01). Its `auth-frozen` account, as the manifest describes it: FRZ from an AUTH_REQUIRED + AUTH_REVOCABLE issuer: authorized, dust paid, then authorization cleared (frozen). Also illiquid ILQX dust with a live issuer and no market, and a data entry. The close without `--partial` refuses before signing anything; with `--partial` it runs everything else and leaves the account open with the frozen trustline.

Written by `node scripts/evidence-cli.mjs edge-frozen`. Public data only: public keys, hashes, envelopes and Horizon JSON. The secret keys reached `dustin close` through its environment only; every file here was scanned for secret seeds and for the fixture's secret keys before it was written.

## What the reviewer should see

1. `dustin fixture verify fixture-manifest.json --snapshot fixture-verification.json` exited 0: every account of the edge fixture was built as its recipe says, 62 of 62 checks passed; the auth-frozen account's: auth-frozen holds zero spendable XLM: balance 2.5000000, minimum 2.5000000, spendable 0.0000000; auth-frozen holds 0.0000003 ILQX: balance 0.0000003, is_authorized true, is_authorized_to_maintain_liabilities true; auth-frozen has the data entry dustin.fixture: present; auth-frozen: the FRZ trustline is not authorized (frozen): balance 0.0000005, is_authorized false, is_authorized_to_maintain_liabilities false. See `fixture-verify.txt` and `fixture-verification.json`.
2. `dustin plan GDFGHTTTVDNYBJFHXHKKRO5EBZWKDCEO6RZFIDJ3QBUEWY3NHMYEP5X5 --to GBT652JTX4KRA2XPKPFRRAGJA6U6N2HGRTPOJI6ZINRPCKYMV6C3NU73 --sponsor GAA76S5MCCU2YQ34QY2YRZECO2HRNIKAPHNWTR4IMKB7CRK5D2T67QAN` exited 0: status PARTIAL, no merge. The unclosable item is `TRUSTLINE_NOT_AUTHORIZED` for 0.0000005 FRZ: "Issuer GAILLB42O7XS6VYSB5ADBC6VOEPYOCCMWXGV47N4ANTWAMUPPKQIQANL has not authorized the FRZ trustline (or revoked it), so the balance of 0.0000005 FRZ cannot be sent anywhere, not even back to the issuer." Remedy: "Ask the issuer GAILLB42O7XS6VYSB5ADBC6VOEPYOCCMWXGV47N4ANTWAMUPPKQIQANL to authorize the trustline again (SetTrustLineFlags), then run the plan again." The illiquid ILQX is returned to its issuer [GCQTUFWH6OCLTRWUQUGPUYJON3UJRXWOE5JVD5YMYMJQ5AU7TKWA7YRS](https://stellar.expert/explorer/testnet/account/GCQTUFWH6OCLTRWUQUGPUYJON3UJRXWOE5JVD5YMYMJQ5AU7TKWA7YRS) (rung `return_to_issuer`, a burn), and its trustline and the data entry are removed. See `plan.txt` and `plan.json`.
3. `dustin close GDFGHTTTVDNYBJFHXHKKRO5EBZWKDCEO6RZFIDJ3QBUEWY3NHMYEP5X5 --to GBT652JTX4KRA2XPKPFRRAGJA6U6N2HGRTPOJI6ZINRPCKYMV6C3NU73 --execute --yes` exited 3: "Not executed: the plan cannot end in a merge (status PARTIAL), so nothing was signed or submitted", with `TRUSTLINE_NOT_AUTHORIZED`, the issuer GAILLB42O7XS6VYSB5ADBC6VOEPYOCCMWXGV47N4ANTWAMUPPKQIQANL and the remedy; the account's sequence number was 21111039865126913 before and 21111039865126913 after. See `transcript-refused.txt`.
4. `dustin close GDFGHTTTVDNYBJFHXHKKRO5EBZWKDCEO6RZFIDJ3QBUEWY3NHMYEP5X5 --to GBT652JTX4KRA2XPKPFRRAGJA6U6N2HGRTPOJI6ZINRPCKYMV6C3NU73 --execute --yes --partial --report report.json` exited 4: report status `partial`; tx 1 (cleanup, applied in ledger 4915308) [8c12934d5a03eeee5224e0b06f67a8b00f74f576f461b928321ab476f2550c73](https://stellar.expert/explorer/testnet/tx/8c12934d5a03eeee5224e0b06f67a8b00f74f576f461b928321ab476f2550c73), fee-bumped by the sponsor: ILQX returned to its issuer, its trustline and the data entry removed. No merge was submitted, and the receipt lists FRZ under "Not closed" with its reason and remedy. See `transcript.txt` and `report.json`; Horizon's records are in `tx-<n>.json`.
5. Horizon answers HTTP 200 for the account afterwards ([Horizon](https://horizon-testnet.stellar.org/accounts/GDFGHTTTVDNYBJFHXHKKRO5EBZWKDCEO6RZFIDJ3QBUEWY3NHMYEP5X5), `account-after.json`): it still exists and holds only the frozen FRZ trustline (0.0000005 FRZ, `is_authorized` false) and 2.5000000 XLM.

## Run

| Field | Value |
|---|---|
| Captured (UTC) | 2026-09-28T12:55:28.614Z |
| Case | `edge-frozen` (SOW week 3, canonical decision 3; matrix rows S-02 and S-01) |
| Network passphrase | `Test SDF Network ; September 2015` |
| Horizon | https://horizon-testnet.stellar.org |
| Fixture | edge-20260928T125416Z-933e2d (profile edge) |
| Account (edge variant auth-frozen) | [GDFGHTTTVDNYBJFHXHKKRO5EBZWKDCEO6RZFIDJ3QBUEWY3NHMYEP5X5](https://stellar.expert/explorer/testnet/account/GDFGHTTTVDNYBJFHXHKKRO5EBZWKDCEO6RZFIDJ3QBUEWY3NHMYEP5X5) ([Horizon](https://horizon-testnet.stellar.org/accounts/GDFGHTTTVDNYBJFHXHKKRO5EBZWKDCEO6RZFIDJ3QBUEWY3NHMYEP5X5)) |
| Destination | [GBT652JTX4KRA2XPKPFRRAGJA6U6N2HGRTPOJI6ZINRPCKYMV6C3NU73](https://stellar.expert/explorer/testnet/account/GBT652JTX4KRA2XPKPFRRAGJA6U6N2HGRTPOJI6ZINRPCKYMV6C3NU73) ([Horizon](https://horizon-testnet.stellar.org/accounts/GBT652JTX4KRA2XPKPFRRAGJA6U6N2HGRTPOJI6ZINRPCKYMV6C3NU73)) |
| Fee sponsor (fee account of every transaction of the close) | [GAA76S5MCCU2YQ34QY2YRZECO2HRNIKAPHNWTR4IMKB7CRK5D2T67QAN](https://stellar.expert/explorer/testnet/account/GAA76S5MCCU2YQ34QY2YRZECO2HRNIKAPHNWTR4IMKB7CRK5D2T67QAN) ([Horizon](https://horizon-testnet.stellar.org/accounts/GAA76S5MCCU2YQ34QY2YRZECO2HRNIKAPHNWTR4IMKB7CRK5D2T67QAN)) |
| Issuer of FRZ (AUTH_REQUIRED, AUTH_REVOCABLE) | [GAILLB42O7XS6VYSB5ADBC6VOEPYOCCMWXGV47N4ANTWAMUPPKQIQANL](https://stellar.expert/explorer/testnet/account/GAILLB42O7XS6VYSB5ADBC6VOEPYOCCMWXGV47N4ANTWAMUPPKQIQANL) ([Horizon](https://horizon-testnet.stellar.org/accounts/GAILLB42O7XS6VYSB5ADBC6VOEPYOCCMWXGV47N4ANTWAMUPPKQIQANL)) |
| Issuer of ILQX | [GCQTUFWH6OCLTRWUQUGPUYJON3UJRXWOE5JVD5YMYMJQ5AU7TKWA7YRS](https://stellar.expert/explorer/testnet/account/GCQTUFWH6OCLTRWUQUGPUYJON3UJRXWOE5JVD5YMYMJQ5AU7TKWA7YRS) ([Horizon](https://horizon-testnet.stellar.org/accounts/GCQTUFWH6OCLTRWUQUGPUYJON3UJRXWOE5JVD5YMYMJQ5AU7TKWA7YRS)) |
| Ledgers | latest before the close 4915305; after it 4915308 |
| Report status | partial (Everything that could run has run; the account still exists because 1 item(s) block the merge (see unclosable and blockers).) |
| Plan hash of the run | `7ecb40bca57b8f51e3681bdc9a9f2941b37bfc68788a873c90704d4616d0c371` |
| Merged XLM (from the merge result) | none: no merge applied |
| Fees paid by the account / by the sponsor | 0 / 400 stroops |
| Horizon for the account afterwards | HTTP 200 |

## Commands

Each ran as `node dist/cli/main.js` from this repository's build, shown here as `dustin`.

| # | Command | Expected exit | Exit | Output |
|---|---|---|---|---|
| 1 | `dustin fixture create --profile edge --dir .fixture --json` | 0 | 0 | `fixture-create.txt`, `fixture-manifest.json` |
| 2 | `dustin fixture verify fixture-manifest.json --snapshot fixture-verification.json` | 0 | 0 | `fixture-verify.txt` |
| 3 | `dustin plan GDFGHTTTVDNYBJFHXHKKRO5EBZWKDCEO6RZFIDJ3QBUEWY3NHMYEP5X5 --to GBT652JTX4KRA2XPKPFRRAGJA6U6N2HGRTPOJI6ZINRPCKYMV6C3NU73 --sponsor GAA76S5MCCU2YQ34QY2YRZECO2HRNIKAPHNWTR4IMKB7CRK5D2T67QAN` | 0 | 0 | `plan.txt` |
| 4 | `dustin plan GDFGHTTTVDNYBJFHXHKKRO5EBZWKDCEO6RZFIDJ3QBUEWY3NHMYEP5X5 --to GBT652JTX4KRA2XPKPFRRAGJA6U6N2HGRTPOJI6ZINRPCKYMV6C3NU73 --sponsor GAA76S5MCCU2YQ34QY2YRZECO2HRNIKAPHNWTR4IMKB7CRK5D2T67QAN --json` | 0 | 0 | `plan-json.txt`, `plan.json` |
| 5 | `dustin close GDFGHTTTVDNYBJFHXHKKRO5EBZWKDCEO6RZFIDJ3QBUEWY3NHMYEP5X5 --to GBT652JTX4KRA2XPKPFRRAGJA6U6N2HGRTPOJI6ZINRPCKYMV6C3NU73 --execute --yes` | 3 | 3 | `transcript-refused.txt` |
| 6 | `dustin close GDFGHTTTVDNYBJFHXHKKRO5EBZWKDCEO6RZFIDJ3QBUEWY3NHMYEP5X5 --to GBT652JTX4KRA2XPKPFRRAGJA6U6N2HGRTPOJI6ZINRPCKYMV6C3NU73 --execute --yes --partial --report report.json` | 4 | 4 | `transcript.txt` |

## Transactions of the close

| # | Phase | Hash | Result | Ledger | Fee charged (stroops) | Fee account is the sponsor | Source is the account | Inner max_fee | Links |
|---|---|---|---|---|---|---|---|---|---|
| 1 | cleanup | `8c12934d5a03eeee5224e0b06f67a8b00f74f576f461b928321ab476f2550c73` | applied | 4915308 | 400 | yes (sponsor) | yes | 0 | [explorer](https://stellar.expert/explorer/testnet/tx/8c12934d5a03eeee5224e0b06f67a8b00f74f576f461b928321ab476f2550c73), [Horizon](https://horizon-testnet.stellar.org/transactions/8c12934d5a03eeee5224e0b06f67a8b00f74f576f461b928321ab476f2550c73) |

## Checks

| Result | Check | Observed |
|---|---|---|
| PASS | The plan is partial: FRZ is unclosable with TRUSTLINE_NOT_AUTHORIZED, the reason names its issuer, no merge | status partial; unclosable TRUSTLINE_NOT_AUTHORIZED FRZ; steps dispose_balance, remove_trustline, remove_data |
| PASS | The illiquid ILQX (no market, live issuer) is returned to its issuer | rung return_to_issuer |
| PASS | Without --partial, `dustin close --execute` signs nothing and says why | the output says "Not executed" and names TRUSTLINE_NOT_AUTHORIZED, GAILLB42O7XS6VYSB5ADBC6VOEPYOCCMWXGV47N4ANTWAMUPPKQIQANL and the remedy |
| PASS | The account's sequence number did not move during the refused close | 21111039865126913 before, 21111039865126913 after |
| PASS | With --partial, everything else ran and no merge was submitted (report status partial) | status partial; cleanup applied |
| PASS | The receipt lists what stays unclosable, with the reason and the remedy | it lists TRUSTLINE_NOT_AUTHORIZED, GAILLB42O7XS6VYSB5ADBC6VOEPYOCCMWXGV47N4ANTWAMUPPKQIQANL |
| PASS | Every transaction of the close on the ledger is a fee bump: fee account the sponsor, source the account, inner max_fee 0 | 1 of 1 transactions on the ledger |
| PASS | Horizon still has the account afterwards (HTTP 200) | HTTP 200 |
| PASS | Afterwards the account holds only the frozen FRZ trustline, and no data entry | FRZ 0.0000005 (is_authorized false); 0 data entries; subentry_count 1 |
| PASS | The account's XLM balance did not change: the sponsor paid every fee | 2.5000000 -> 2.5000000 XLM |

## Balances

Latest ledger before the close 4915305, after it 4915308.

- Account `GDFGHTTTVDNYBJFHXHKKRO5EBZWKDCEO6RZFIDJ3QBUEWY3NHMYEP5X5`: 2.5000000 XLM -> 2.5000000 XLM (+0.0000000), num_sponsoring 0 -> 0; trustlines ILQX 0.0000003 -> none.
- Destination `GBT652JTX4KRA2XPKPFRRAGJA6U6N2HGRTPOJI6ZINRPCKYMV6C3NU73`: 2.0000000 XLM -> 2.0000000 XLM (+0.0000000), num_sponsoring 0 -> 0.
- Fee sponsor `GAA76S5MCCU2YQ34QY2YRZECO2HRNIKAPHNWTR4IMKB7CRK5D2T67QAN`: 9972.9994399 XLM -> 9972.9993999 XLM (-0.0000400), num_sponsoring 0 -> 0.

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
- `transcript-refused.txt`: `dustin close --execute --yes` without `--partial`: the refusal.
- `transcript.txt`: the close that ran (`--report report.json`), with its receipt.
- `report.json`: the close report written by `--report`, with both envelopes of every transaction as XDR.
- `account-after.json`: Horizon's answer for the account after the close: status and body.
- `balances.json`: XLM, num_sponsoring and trustlines of each role before and after, and the ledgers.
- `tx-1.json`: Horizon's record of transaction 1, 8c12934d5a03eeee5224e0b06f67a8b00f74f576f461b928321ab476f2550c73.

Explorer and Horizon links resolve only until the next testnet reset (scheduled for 2026-12-16), which deletes every account and transaction; the JSON, the XDR and the transcripts in this directory are the durable record.
