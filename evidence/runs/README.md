# Live close evidence

Each directory `evidence/runs/<UTC stamp>/` (for example `20261001T101500Z/`), or `<UTC stamp>-<label>/` when the run was labelled, records one live run on the Stellar testnet against a freshly built fixture. They let the SOW claims (an account with zero spendable XLM closed with sponsor-paid fee bumps; an unclosable item reported with its reason) be checked independently rather than taken on trust.

Two writers produce them:

- SDK runs: `test/testnet/execute-close.test.ts` with `DUSTIN_EVIDENCE=1`, the close of a `messy` fixture through `executeClose()`. Label `-e3` for the Epic 3 metric close.
- CLI runs: `scripts/evidence-cli.mjs <case>`, each case a run through the real command line (`node dist/cli/main.js`) on a fixture it builds with `dustin fixture create`:

| Case | Default label | What the run shows |
|---|---|---|
| `metric` | `e3-cli` | Story E3-S7 and SOW Appendix B: a `messy` fixture verified, planned, then closed with `dustin close --execute --yes --report` (exit 0); Horizon answers 404 for the account afterwards. |
| `edge-frozen` | `edge-frozen` | The SOW's week-3 outcome on the `edge` fixture (docs/README.md canonical decision 3; matrix rows S-02 and S-01): the `auth-frozen` account's frozen, illiquid FRZ. Without `--partial` the close exits 3 and signs nothing, naming `TRUSTLINE_NOT_AUTHORIZED`, the issuer and the remedy; with `--partial --report` it exits 4: ILQX is returned to its issuer, its trustline and the data entry are removed, no merge is submitted, and the account keeps only the frozen trustline. |
| `memo-partial` | `e3s2-partial` | Story E3-S2 (AC-E3-S2-3), the partial-close receipt: the issuer sets the SEP-29 data entry `config.memo_required` = 1, so the plan sends DUSTC to the destination (rung 3) and finds no route for DUSTB and SPTA (`NO_DISPOSAL_ROUTE`, every rung ruled out). Without `--partial` the close exits 3; with `--partial --report` it exits 4, and its receipt lists each unclosable item. |
| `seq-wait` | `e3s4-wait` | Story E3-S4 (AC-E3-S4-2; matrix row S-04): a BumpSequence, fee-bumped by the sponsor, raises the account's sequence number to (latest ledger + 12) << 32. The plan runs the merge alone; the close runs the cleanup, prints the wait for the sequence guard, merges in or after the unblocking ledger (exit 0), and Horizon answers 404. |
| `baseline-zero` | `b03-base1` | Matrix row B-03, after the recordings B-01 and B-02 (`evidence/baseline/README.md`): the recipe of the baseline fixture `messy-20260926T035942Z` rebuilt (FIX-base-1, zero spendable XLM; the run checks that its recipe hash is the baseline fixture's), planned and closed with `dustin close --execute --yes --report` (exit 0); Horizon answers 404 afterwards. `scripts/baseline-b03.mjs` runs it together with the next case. |
| `baseline-plus1` | `b03-base2` | Matrix row B-03: the same recipe rebuilt (FIX-base-2), then 1 XLM paid to the account by its fee sponsor (in `setup.json`), planned and closed; the destination receives the whole balance, 5 XLM plus the sale. |

Older labels: `-cli` is the week-2 close through the command line; `-b03-rehearsal-base1` and `-b03-rehearsal-base2` are the rehearsal of `node scripts/baseline-b03.mjs --before-recordings` on 2026-09-29, which ran the two B-03 cases end to end before the recordings exist (every check passed; matrix row B-03 itself runs after the recordings). The runs up to `20260928T112252Z-e3-cli` were written before this script and hold fewer files; each run's `summary.md` lists its own.

## Layout

| File | Content |
|---|---|
| `summary.md` | One page for a reviewer: what to check, in plain words (which command, which exit code, which reason, which hashes); the accounts and transactions with their explorer and Horizon links; the checks the run made of itself; the balance changes. |
| `FAILED.md` | Only in a run that did not meet its expectations: the step that failed and what could not be recorded. Such a run is kept because its fixture may be spent, but it is not evidence of its case. |
| `fixture-create.txt` | CLI runs: `dustin fixture create` and its build log (public keys and the construction hashes). |
| `fixture-manifest.json` | The fixture's public manifest: public keys, assets, offers, data entries, expected reserve figures and the hashes of the construction transactions. For an `edge` fixture, one entry per variant with its expected plan. |
| `fixture-verify.txt`, `fixture-verification.json` | The fixture checks, run before the close: in CLI runs `dustin fixture verify --snapshot`, right after the build and before any setup transaction (the text is `fixture-verify.txt`). For a `messy` fixture the four checks with `"appendixB": true` are the SOW Appendix B preconditions: zero spendable XLM, at least 3 trustlines with a balance, at least 1 open offer, at least 1 data entry. |
| `setup.json` | Cases `memo-partial` and `seq-wait`: the transaction the script submitted before the plan (the issuer's data entry, or the BumpSequence), with its envelope XDR and Horizon's record. |
| `plan.txt`, `plan.json` | The dry-run plan, as `dustin plan` prints it and as JSON. The SDK summary adds a "Disposal ladder" table: each leftover balance with its planned and applied rung. |
| `plan-json.txt` | CLI runs: the `dustin plan --json` command, its standard error and its exit code. |
| `account-before.json` | Horizon `GET /accounts/{account}` just before the close. |
| `transcript-refused.txt` | Cases `edge-frozen` and `memo-partial`: `dustin close --execute --yes` without `--partial`, which refuses before signing anything (exit 3). |
| `transcript.txt` | CLI runs: the close that ran, `dustin close --execute --yes --report report.json`, with its receipt. Every CLI transcript starts with its command and ends with its exit code. |
| `report.json` | The `CloseReport`: accounts, plan hash, status, and for every transaction the outer and inner hash, ledger, fee charged, fee account, result codes and both envelopes (inner and fee bump) as XDR. From 2026-09-28 it also holds `recovery.sponsorsObserved`: each reserve sponsor's `num_sponsoring`, minimum balance and XLM balance read before and after the close. |
| `tx-<n>.json` | Horizon `GET /transactions/{hash}` for the n-th submitted transaction of the close: `fee_account` is the fee sponsor and `source_account` the account. `null` for an envelope that never reached the ledger. |
| `account-after.json` | Horizon `GET /accounts/{account}` after the close: HTTP 404 and Horizon's error body for a closed account, or HTTP 200 and the account for a partial close. |
| `balances.json` | XLM balance, `num_sponsoring` and trustlines of each role (the destination, the reserve sponsor, the fee sponsor, and for a partial close the account) before and after the close, and the latest ledger before and after it. |
| `explorer-account.png`, `explorer-tx-<n>.png`, `horizon-account-404.png`, `screenshots.json` | So far the metric close on the 0.1.0 code (`20260929T111408Z-e4-cli`): its public pages, captured by `node scripts/demo/explorer-shots.mjs --playwright <directory where playwright is installed> <run directory>` before the testnet reset: StellarExpert's page of the account and of each transaction (every operation shown), and Horizon's answer for the account, each whole page under a strip with its URL and the time it was captured. |

## Reproduce a run

Requirements: Node 22.12 or later and access to the public testnet (Horizon and Friendbot). No key is needed: the fixture builder creates every account from Friendbot.

Through the SDK:

```sh
npm ci
DUSTIN_TESTNET=1 DUSTIN_EVIDENCE=1 npm run test:testnet -- test/testnet/execute-close.test.ts
```

The test builds a new fixture, verifies it, plans and executes the close, checks every transaction on Horizon and writes a new directory here; its path is printed at the end. `DUSTIN_EVIDENCE_LABEL=e3` appends `-e3` to the directory name; a label other than lower-case letters, digits and hyphens is refused before any fixture is built. Without `DUSTIN_EVIDENCE=1` the same test runs and writes nothing.

Through the command line, one case per run:

```sh
npm ci && npm run build
node scripts/evidence-cli.mjs metric          # evidence/runs/<stamp>-e3-cli/
node scripts/evidence-cli.mjs edge-frozen     # evidence/runs/<stamp>-edge-frozen/
node scripts/evidence-cli.mjs memo-partial    # evidence/runs/<stamp>-e3s2-partial/
node scripts/evidence-cli.mjs seq-wait        # evidence/runs/<stamp>-e3s4-wait/
node scripts/evidence-cli.mjs baseline-zero   # evidence/runs/<stamp>-b03-base1/ (or both: node scripts/baseline-b03.mjs)
node scripts/evidence-cli.mjs baseline-plus1  # evidence/runs/<stamp>-b03-base2/
```

A second argument replaces the default label. Each run takes one to three minutes, prints each command with its exit code, and ends with a JSON summary that names its directory. The script checks every exit code against the case: an unexpected one stops the run and prints that command's output, with any secret removed. It exits 0 when the run met every expectation, 1 otherwise, and 2 for a usage error. The fixture's keys stay in the gitignored `.fixture/` directory and reach `dustin close` only through its environment, never its command line; the network settings of the environment (`DUSTIN_HORIZON_URL`, `DUSTIN_EXPLORER_BASE`) are not passed on, so every run uses the public testnet and its explorer. Commit a directory together with the code it was captured with, and only when it has no `FAILED.md`.

To check a transaction without the network, decode its fee-bump envelope from `report.json` with the SDK: `TransactionBuilder.fromXDR(feeBumpEnvelopeXdr, "Test SDF Network ; September 2015")` shows the fee source (the sponsor) and the inner transaction (source, sequence number, operations), and `Buffer.from(tx.hash()).toString("hex")` is the transaction hash in the explorer link.

## No secrets

Every file holds public data only: public keys, hashes, envelopes with signatures, and Horizon JSON. Every file is scanned before anything reaches this directory, for a secret seed with both rules of `containsSecretSeed` (`src/errors/redact.ts`: a standalone seed-shaped string, or a checksum-valid seed glued to other characters) and for each of the fixture's secret keys as StrKey, raw hex and raw base64. One hit refuses the whole run, and nothing is written. The SDK writer (`test/helpers/evidence.ts`) scans the files it builds in memory; the CLI script stages the whole run in a temporary directory, where the CLI writes its `--report` and `--snapshot` files, scans it there and only then moves it here. An existing run directory is never overwritten.

## Testnet resets

The testnet is reset to genesis about once a quarter; the next reset is scheduled for 2026-12-16 (docs/README.md, canonical decision 12). A reset deletes every account and transaction, so the explorer and Horizon links in `summary.md` stop resolving. That is why the report, the envelope XDR, the transcripts and the Horizon JSON are stored here: they remain the record after the links are gone. After a reset, running the commands above produces fresh runs with new links.
