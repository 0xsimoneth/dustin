---
title: Dustin evidence package (template)
status: template, copy to docs/evidence/README.md and fill every <placeholder>
owner: the builder
mirrors: SUCCESSFUL_SOW.md sections 6.1 and 6.2, Appendix B
---

# Dustin evidence package

> How to use this template: copy it to `docs/evidence/README.md`, replace every `<placeholder>` with a real value, delete the blockquoted instructions, and keep every section heading. The reviewer reads the filled copy top to bottom without running anything. Section 1 and section 2 must keep the exact rows and wording of SOW sections 6.1 and 6.2 so the reviewer can tick the SOW checklist while reading.

## 0. Capture record

| Field | Value |
|---|---|
| Network | Stellar testnet, passphrase `Test SDF Network ; September 2015` |
| Close performed on | `<YYYY-MM-DD HH:MM UTC>` |
| Ledger range of the close | `<first ledger>` to `<last ledger>` |
| Repository commit at capture | `<40-character commit SHA>` |
| npm package and version | `dustin@<version>` |
| Fixture account | `<G... 56 characters, full>` |
| Destination account | `<G... full>` |
| Sponsor (fee-bump fee account) | `<G... full>` |
| Next announced testnet reset, if known | `<date or "none announced at capture time">` |

> Testnet is reset 2 to 4 times a year and every account, transaction and history record is deleted at a reset. Section 8 says what in this package survives a reset and how the fixture is rebuilt.

## 1. Planned evidence submitted (SOW 6.1, row for row)

| Deliverable | Evidence Type | Description (from the SOW) | Where it lives | Links |
|---|---|---|---|---|
| Deliverable 1: `planClose()` | Public repo + CLI output | Run the dry run yourself against any testnet account and read the plan it prints, or read the committed output for the fixture account in the repo. | Repository `<repo URL>`; committed plan `evidence/fixture-plan.txt` and `evidence/fixture-plan.json`; reproduce with `dustin plan <fixture G...> --to <destination G...>` | `<link to evidence/fixture-plan.txt at the capture commit>` |
| Deliverable 2: Live close on testnet | Transaction hashes (links) + 60-second video | Open the linked transaction chain on a public testnet explorer, then look up the closed account and see that it no longer exists. The video shows the same close from the CLI, start to finish. | Section 3.3 (transaction chain), section 3.2 (account links), section 6 (video) | `<tx 1 link>`, `<tx 2 link>`, `<tx 3 link>`, `<closed account link>`, `<video link>` |
| Deliverable 3: Edge cases and tests | Test results screenshot + public repo + baseline recording | See the passing test matrix, then clone the repo and run it yourself against the fixture account. The baseline recording shows the existing tool stopping on the same account, so the gap can be checked rather than taken on trust. | `evidence/screenshots/test-matrix.png`; tests under `test/`; `evidence/baseline/README.md` and `evidence/baseline/demolisher-<date>.mp4` | `<screenshot link>`, `<test directory link>`, `<baseline recording link>` |
| Documentation, demo and evidence | Public repo + write-up + 60-second video | Read a short write-up covering the ordering rules and what is not handled, and watch the full close from the CLI, start to finish. | `README.md`; `docs/ordering-rules-and-known-limits.md`; `docs/integration-notes.md`; section 6 (video) | `<README link>`, `<write-up link>`, `<video link>` |

## 2. Evidence verification checklist (SOW 6.2, for the reviewer)

> Leave this table for the reviewer. Do not pre-tick it.

| Deliverable | Evidence Present | Evidence Partial | Evidence Missing | Comments |
|---|---|---|---|---|
| Deliverable 1 | ☐ | ☐ | ☐ | |
| Deliverable 2 | ☐ | ☐ | ☐ | |
| Deliverable 3 | ☐ | ☐ | ☐ | |
| Documentation, demo and evidence | ☐ | ☐ | ☐ | |

## 3. Links

### 3.1 URL patterns used in this package

| What | Human-readable page (StellarExpert, testnet) | Raw record (Horizon, testnet) | What you will see |
|---|---|---|---|
| A transaction | `https://stellar.expert/explorer/testnet/tx/<hash>` | `https://horizon-testnet.stellar.org/transactions/<hash>` | The explorer page labels the transaction as a fee bump and names the fee account (the sponsor); Horizon returns JSON with `"successful": true`, the inner source account and the fee account. |
| The closed account, before the merge | `https://stellar.expert/explorer/testnet/account/<G...>` | `https://horizon-testnet.stellar.org/accounts/<G...>` | Balances (XLM and every trustline), `subentry_count`, `num_sponsored`; offers at `https://horizon-testnet.stellar.org/accounts/<G...>/offers`; data entries inside the account JSON under `data`. |
| The closed account, after the merge | same URL | same URL | The explorer shows the account merge as the last operation in its history; Horizon answers HTTP 404 (`"status": 404`, the JSON error body says the resource does not exist). The account no longer exists on the ledger. |
| The destination account | `https://stellar.expert/explorer/testnet/account/<G...>` | `https://horizon-testnet.stellar.org/accounts/<G...>` | An incoming account-merge operation carrying the fixture's whole XLM balance, and the XLM balance increased by that amount. |

> Both links are given for every item: the explorer is easier to read, and Horizon is the network's own answer that does not depend on any third-party site.

### 3.2 Accounts

| Role | Address (full) | Before the close | After the close |
|---|---|---|---|
| Fixture (closed) | `<G...>` | `<explorer link>` and `<Horizon link>` | same links: explorer shows merge as last operation; Horizon returns 404 |
| Destination | `<G...>` | `<explorer link>` | `<explorer link>` showing `<amount>` XLM received by account merge |
| Sponsor | `<G...>` | `<explorer link>` | `<explorer link>` showing the fee-bump fees paid and the sponsored reserve released |
| Issuer of asset `<CODE1>` | `<G...>` | | receives the returned balance, if the ladder returned it |
| Issuer of asset `<CODE2>` (illiquid, deliberately) | `<G...>` | | |
| Issuer of asset `<CODE3>` | `<G...>` | | |
| Issuer of the sponsored trustline asset `<CODE4>` | `<G...>` | | |

### 3.3 The transaction chain of the close

> One row per submitted transaction, in submission order. Every row must show the sponsor as the fee account: that is SOW Appendix B, "every transaction in the close is fee-bumped by the sponsor".

| # | Purpose | Operations in the inner transaction | Inner source (signs) | Fee account (pays) | Hash (full, 64 hex characters) | Explorer | Horizon | Ledger | Time (UTC) |
|---|---|---|---|---|---|---|---|---|---|
| 1 | Cleanup: cancel `<n>` offers, delete `<n>` data entries | `<list>` | fixture `<G...>` | sponsor `<G...>` | `<hash>` | `<link>` | `<link>` | `<ledger>` | `<time>` |
| 2 | Disposal and trustline removal: `<path payment / return to issuer / send to destination>` then change trust with limit 0 for each trustline | `<list>` | fixture | sponsor | `<hash>` | `<link>` | `<link>` | `<ledger>` | `<time>` |
| 3 | Merge into the destination | `accountMerge` | fixture | sponsor | `<hash>` | `<link>` | `<link>` | `<ledger>` | `<time>` |

> If the close used a different number of transactions, keep one row per transaction; the number itself is not a pass criterion. What matters: every row has the sponsor as fee account, and the last row is the merge.

### 3.4 Fixture construction transactions (supporting evidence for Deliverable 3)

| # | Purpose | Hash | Explorer | Notes |
|---|---|---|---|---|
| F1 | Fund the fixture from friendbot, then move spendable XLM out so exactly the minimum balance remains | `<hash>` | `<link>` | Spendable XLM must read 0 before the close starts |
| F2 | Add trustlines `<CODE1>`, `<CODE2>`, `<CODE3>` and receive dust balances | `<hash>` | `<link>` | |
| F3 | Sponsor adds trustline `<CODE4>` on the fixture inside a begin/end sponsoring sandwich | `<hash>` | `<link>` | `num_sponsored` becomes 1 on the fixture |
| F4 | Create 2 open offers and 1 data entry | `<hash>` | `<link>` | |

### 3.5 Baseline run of the existing tool

| Field | Value |
|---|---|
| Tool | StellarExpert Account Demolisher, `<URL used, testnet variant if available>` |
| Recording | `evidence/baseline/demolisher-<date>.mp4` (`<duration>`), still frame `evidence/screenshots/baseline-stop.png` |
| Fixture state at the time | identical to section 4 "Before" column (recorded before Dustin ran, on the same account or on an identical rebuild, say which) |
| Where it stops | `<the first transaction it tries, the error shown, and the timestamp in the recording>` |
| Transactions it submitted, if any | `<hashes or "none reached the network">` |

## 4. Before and after: the fixture account

> The "Before" column is what the SOW success metric requires (zero spendable XLM, at least 3 trustlines with non-zero balances, at least 1 open offer, at least 1 data entry). The "After" column is the binary pass: the account no longer exists.

| Item | Before | After | Where the XLM went |
|---|---|---|---|
| Account exists on the ledger | yes (`<Horizon link>` returns 200) | no (`<Horizon link>` returns 404) | |
| XLM balance | `<4.0000000>` | account gone | merged into the destination |
| Spendable XLM (balance minus minimum balance) | `0.0000000` | | |
| Minimum balance held as reserve | `<4.0000000>` = (2 + `<7>` subentries + 0 sponsoring - `<1>` sponsored) x 0.5 XLM | | |
| Trustline `<CODE1>` | balance `<amount>` (self-funded, 0.5 XLM reserve) | removed | 0.5 XLM back to the account, then to the destination |
| Trustline `<CODE2>` (illiquid asset) | balance `<amount>` | removed via `<return to issuer / send to destination>` or reported unclosable with reason `<code>` | 0.5 XLM as above |
| Trustline `<CODE3>` | balance `<amount>` | removed | 0.5 XLM as above |
| Trustline `<CODE4>` (sponsored) | balance `<amount>`, reserve held by the sponsor | removed | 0.5 XLM released to the sponsor, not to the account |
| Open offers | 2 | 0 | 1.0 XLM back to the account, then to the destination |
| Data entries | 1 (`<name>`) | 0 | 0.5 XLM back to the account, then to the destination |
| `subentry_count` | `<7>` | account gone | |
| `num_sponsored` | 1 | account gone | |
| XLM locked in reserves at the start | `<4.0000000>` | | |
| XLM recovered to the destination | | `<amount, seven decimals>` (the merge amount, plus the proceeds of any path payment sale) | |
| Reserve released to the sponsor | | `0.5000000` XLM | |
| Fees paid by the fixture account | 0 | 0 | |
| Fees paid by the sponsor | | `<total in XLM, e.g. 0.0001500>` across `<n>` fee-bump transactions | |

> Where the numbers come from: base reserve 0.5 XLM; an account needs two base reserves plus one per subentry; a sponsored subentry is paid by the sponsor. Fill from the Horizon account JSON captured before the close (`evidence/raw/before-account.json`).

## 5. Screenshots and raw captures

> File names are fixed so the reviewer walkthrough can name them. Capture everything within the same hour as the close. Full addresses must be visible in every screenshot; no secret may be visible in any.

| File | Must show | Captured |
|---|---|---|
| `evidence/screenshots/01-before-account-explorer.png` | Fixture account page: XLM balance, the four trustlines with balances, offers count 2, data entries 1 | before the close |
| `evidence/screenshots/02-before-account-horizon.png` | Horizon JSON: `subentry_count`, `num_sponsored`, balances | before |
| `evidence/screenshots/03-plan-terminal.png` | `dustin plan` output: the step table with reasons and fees, the summary block, "nothing signed" | before |
| `evidence/screenshots/04-close-confirmation.png` | The confirmation block naming destination and sponsor | during |
| `evidence/screenshots/05-close-progress.png` | Every transaction line with hash, ledger and explorer link | during |
| `evidence/screenshots/06-report.png` | The final report: verdict, XLM received, fees paid by the account 0, fees paid by the sponsor | after |
| `evidence/screenshots/07-tx1-explorer.png`, `08-tx2-explorer.png`, `09-tx3-explorer.png` | Each transaction page with the fee-bump label and the sponsor as fee account | after |
| `evidence/screenshots/10-after-account-explorer.png` | Fixture account page showing the merge as the last operation | after |
| `evidence/screenshots/11-after-account-horizon-404.png` | Horizon 404 response for the fixture address | after |
| `evidence/screenshots/12-destination-after.png` | Destination page with the incoming merge amount | after |
| `evidence/screenshots/13-test-matrix.png` | Green test run listing the seven edge cases by name | any time at the capture commit |
| `evidence/screenshots/14-baseline-stop.png` | Frame of the Demolisher recording at the moment it stops | before |
| `evidence/screenshots/15-npm-package.png` | The npm package page at the published version | after publish |
| `evidence/raw/before-account.json`, `before-offers.json` | Horizon JSON of the fixture and its offers | before |
| `evidence/raw/tx-1.json`, `tx-2.json`, `tx-3.json` | Horizon JSON of each transaction (contains hash, fee account, inner source, result) | after |
| `evidence/raw/after-account-404.json` | The Horizon error body for the fixture address | after |
| `evidence/close-receipt.json` | Dustin's own receipt: every hash and explorer link | after |

## 6. The 60-second video

| Field | Value |
|---|---|
| Link | `<hosted URL, unlisted is fine>` |
| Copy in the repository | attached to release `v<version>` as `dustin-demo-<date>.mp4` (do not commit large binaries to the default branch) |
| Duration | `<mm:ss>` (60 seconds or less) |
| Captions | burned in, plus `evidence/video/dustin-demo-<date>.srt` |
| SHA-256 of the file | `<checksum>` |
| Script followed | `docs/demo-video-script.md` |
| Fixture address shown in the video | `<G...>` (must equal the address in section 0) |

## 7. Reviewer walkthrough

> Written for someone who has never used a block explorer. Each step names one link and what appears. Ten minutes end to end.

1. Open the repository `<repo URL>`. You will see a README with a video thumbnail near the top and a table called "Evidence" with the same four rows as the SOW.
2. Open `evidence/fixture-plan.txt`. You will see a numbered list of steps. The last step says "accountMerge". Each step has a short reason and a fee. The summary at the end names the destination and the amount of XLM that will reach it. This is Deliverable 1: a plan produced without sending anything to the network.
3. Open `<before account explorer link>` in the video or the screenshot `01-before-account-explorer.png` (the live page has changed since, because the account is gone). You will see four asset lines with non-zero balances, "2 offers", "1 data entry", and 4 XLM of which none is spendable.
4. Open `<tx 1 explorer link>`. You will see a transaction page marked as a fee bump. The "fee account" is the sponsor address from section 0, and the "source account" of the inner transaction is the fixture address. The operations cancel offers and delete a data entry.
5. Open `<tx 2 explorer link>`. Same fee account. The operations move the leftover balances out and remove each trustline.
6. Open `<tx 3 explorer link>`. Same fee account. The single operation is an account merge from the fixture to the destination.
7. Open `<fixture account explorer link>`. You will see the account's history ending with that account merge. The page may label the account as merged or deleted; the wording is the explorer's own.
8. Open `<fixture account Horizon link>`. You will see a short error page whose status is 404. That is the network itself saying the account does not exist. This is the SOW pass condition for Deliverable 2.
9. Open `<destination account explorer link>`. You will see the same merge arriving and the XLM balance higher by the amount in section 4.
10. Open `evidence/screenshots/13-test-matrix.png`. You will see a green test run with the seven edge cases named: illiquid balance, sponsored trustline, sequence number too far, authorization required, clawback enabled, liquidity pool shares, raised thresholds. This is Deliverable 3.
11. Open `<baseline recording link>`. You will see the existing tool used on the same account and the moment it stops; the timestamp is given in section 3.5.
12. Watch `<video link>` (60 seconds). It shows steps 3 to 9 happening live from the terminal. The fixture address in the video matches section 0.
13. Read `docs/ordering-rules-and-known-limits.md`. It lists the ordering rules and what Dustin does not handle, in plain language, with a glossary at the end.
14. Fill in section 2.

## 8. What survives a testnet reset

| Item | Survives a reset | Notes |
|---|---|---|
| Explorer and Horizon links (sections 3.1 to 3.4) | no | They resolve only until the next reset; after it, the addresses and hashes are unknown to the network. |
| Screenshots and raw JSON (section 5) | yes | Committed at the capture commit; the JSON contains the hashes, fee accounts and results. |
| The video (section 6) | yes | |
| Dustin's receipt `evidence/close-receipt.json` | yes | |
| The fixture itself | no, but it is rebuilt with one command: `<fixture builder command>` | A rebuilt fixture has new addresses; a re-run produces a new section 0 and a new set of links. |

> If the review happens after a reset, the builder re-runs the fixture builder and the close, and appends a second capture record; the original screenshots and JSON stay in the package as the record of the first run.

## Assumptions

1. The fixture is built exactly as the SOW budget row for Deliverable 3 states: 3 self-funded trustlines with dust, 1 sponsored trustline, 2 open offers, 1 data entry, zero spendable XLM. With base reserve 0.5 XLM that gives a minimum balance of (2 + 7 - 1) x 0.5 = 4.0 XLM; the numbers in section 4 are expected values to be confirmed from the captured Horizon JSON, not measurements.
2. The close is expected to take three transactions (cleanup, disposal and trustline removal, merge). If the planner groups differently, section 3.3 gains or loses rows; the pass criteria do not change.
3. Explorer wording for a merged account (merged, deleted, removed) is not fixed by any specification; the walkthrough relies on the Horizon 404 as the unambiguous check and treats the explorer page as the readable companion.
4. The Horizon 404 body text is recorded verbatim in `evidence/raw/after-account-404.json` rather than quoted here, because the documentation states the status code and the meaning but the exact title text was not verified.
5. The StellarExpert Demolisher's testnet variant could not be confirmed from the client-rendered site; section 3.5 records whichever URL was used. If the tool offers no testnet switch, the builder records the tool being pointed at the testnet fixture through whatever network selector it does offer and the exact point at which it refuses or fails, and says so in section 3.5; a mainnet attempt is never acceptable.
6. Video hosting is an unlisted link plus a release asset; no hosting service is prescribed by the SOW.

## Sources

1. Accepted Statement of Work, sections 3 (success metric), 6.1, 6.2 and Appendix B: `SUCCESSFUL_SOW.md`.
2. Testnet purpose, reset frequency (2 to 4 times per year at 17:00 UTC, announced at least two weeks ahead, clears all ledger entries, transactions and history), friendbot, Horizon URL and passphrase: https://developers.stellar.org/docs/networks
3. Horizon single account endpoint `GET /accounts/:account_id`: https://developers.stellar.org/docs/data/apis/horizon/api-reference/retrieve-an-account
4. Horizon single transaction endpoint `GET /transactions/:transaction_hash`: https://developers.stellar.org/docs/data/apis/horizon/api-reference/retrieve-a-transaction
5. Horizon 404 "Not Found: The requested resource does not exist": https://developers.stellar.org/docs/data/apis/horizon/api-reference/errors/http-status-codes/standard
6. Account merge transfers the XLM balance and removes the source account; requires no non-signer subentries: https://developers.stellar.org/docs/learn/fundamentals/transactions/list-of-operations#account-merge
7. Fee-bump transactions: the fee account pays; inner operations plus one: https://developers.stellar.org/docs/build/guides/transactions/fee-bump-transactions
8. Minimum balance formula and sponsored reserve accounting: https://developers.stellar.org/docs/build/guides/transactions/sponsored-reserves
9. Base reserve 0.5 XLM, two base reserves per account, subentry types: https://developers.stellar.org/docs/learn/fundamentals/lumens#minimum-balance
10. StellarExpert testnet explorer and URL scheme: https://stellar.expert/explorer/testnet/
11. StellarExpert Account Demolisher: https://stellar.expert/demolisher/public/ and its client source in https://github.com/stellar-expert/stellar-expert-explorer (`business-logic/demolisher/demolisher-tx-builder.js`).
12. Screenshot and file naming conventions: `docs/documentation-plan.md` section 6.
