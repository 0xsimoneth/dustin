# Live close evidence

Each directory `evidence/runs/<UTC stamp>/` (for example `20261001T101500Z/`) records one live close of a freshly built `messy` fixture on the Stellar testnet. It is written by `test/testnet/execute-close.test.ts` when `DUSTIN_EVIDENCE=1` is set, so that the SOW Deliverable 2 claim (an account with zero spendable XLM closed with sponsor-paid fee bumps) can be checked independently rather than taken on trust.

## Layout

| File | Content |
|---|---|
| `summary.md` | One page for a reviewer: date, network passphrase, ledgers, every account and transaction with its explorer and Horizon link, the pre-close checks, the 404 after the close and the balance changes. |
| `report.json` | The `CloseReport` returned by `executeClose()`: accounts, plan hash, status, and for every transaction the outer and inner hash, ledger, fee charged, fee account, result codes and both envelopes (inner and fee bump) as XDR. |
| `fixture-manifest.json` | The fixture's public manifest: public keys, assets, offers, data entry, expected reserve figures and the hashes of the construction transactions. |
| `fixture-verification.json` | The fixture checks run right before the close. The four with `"appendixB": true` are the SOW Appendix B preconditions: zero spendable XLM, at least 3 trustlines with a balance, at least 1 open offer, at least 1 data entry. |
| `account-before.json` | Horizon `GET /accounts/{fixture}` just before the close. |
| `tx-<n>.json` | Horizon `GET /transactions/{hash}` for the n-th submitted transaction: `fee_account` is the fee sponsor and `source_account` the closed account. |
| `account-after.json` | Horizon `GET /accounts/{fixture}` after the close: HTTP status 404 and Horizon's error body. |
| `balances.json` | XLM balance and `num_sponsoring` of the destination, the reserve sponsor and the fee sponsor before and after the close, and the latest ledger before the close and after its verification. |

## Reproduce a run

Requirements: Node 22.12 or later and access to the public testnet (Horizon and Friendbot). No key is needed: the fixture builder creates every account from Friendbot and keeps the secret keys in memory for the length of the run.

```sh
npm ci
DUSTIN_TESTNET=1 DUSTIN_EVIDENCE=1 npm run test:testnet -- test/testnet/execute-close.test.ts
```

The test builds a new fixture, verifies it, plans and executes the close, checks every transaction on Horizon and writes a new directory here; its path is printed at the end. Commit the directory together with the code it was captured with. Without `DUSTIN_EVIDENCE=1` the same test runs and writes nothing.

To check a transaction without the network, decode its fee-bump envelope from `report.json` with the SDK: `TransactionBuilder.fromXDR(feeBumpEnvelopeXdr, "Test SDF Network ; September 2015")` shows the fee source (the sponsor) and the inner transaction (source, sequence number, operations), and `Buffer.from(tx.hash()).toString("hex")` is the transaction hash in the explorer link.

## No secrets

Every file holds public data only: public keys, hashes, envelopes with signatures, and Horizon JSON. Before anything is written, the writer (`test/helpers/evidence.ts`) scans every file for a seed-shaped string with `containsSecretSeed` from `src/errors/redact.ts`, and for each of the fixture's secret keys; one hit refuses the whole run and nothing is written. An existing run directory is never overwritten.

## Testnet resets

The testnet is reset to genesis about once a quarter; the next reset is scheduled for 2026-12-16 (docs/README.md, canonical decision 12). A reset deletes every account and transaction, so the explorer and Horizon links in `summary.md` stop resolving. That is why the report, the envelope XDR and the Horizon JSON are stored here: they remain the record after the links are gone. After a reset, running the command above produces a fresh close with new links.
