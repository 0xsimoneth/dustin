# Dustin

![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg) ![Network: testnet only](https://img.shields.io/badge/network-testnet%20only-orange.svg)

Dustin closes messy Stellar testnet accounts: it cancels offers, disposes of leftover balances, removes trustlines and data entries, and merges the account into a destination you choose. Every transaction is fee-bumped by a sponsor, so an account holding zero spendable XLM, which cannot pay for its own teardown, can still be closed. `planClose()` shows the whole ordered plan before anything is signed, so a wallet can offer account closure without sending its users to a web form.

The existing StellarExpert Account Demolisher builds every transaction with the account being closed as both source and fee payer, and has no fee-bump or sponsored-reserve handling ([client source](https://github.com/stellar-expert/stellar-expert-explorer/blob/master/business-logic/demolisher/demolisher-tx-builder.js)). An account sitting at its minimum reserve therefore cannot even start. That is the gap Dustin fills.

> **Status: pre-release.** Dustin is being built during a 30-day Stellar Instaward sprint (2026-09-22 to 2026-10-22). The package and CLI skeleton exist; `planClose()` and `executeClose()` are not implemented yet. See [Status](#status).

## Demo

The 60-second demo of a full close from the CLI is recorded in week 4 and linked here.

## Quick start: CLI

Requires Node.js 22.12 or newer.

```bash
npm install -g stellar-dustin

# Read-only: prints the ordered close plan. Needs no secret.
dustin plan G<ACCOUNT> --to G<DESTINATION>

# Executes the plan. Secrets come from the environment (or a .env file), never from the command line.
export DUSTIN_ACCOUNT_SECRET=S...   # the account being closed
export DUSTIN_SPONSOR_SECRET=S...   # a funded testnet account that pays every fee
dustin close G<ACCOUNT> --to G<DESTINATION> --execute
```

- `dustin close` without `--execute` prints the same plan as `dustin plan` and changes nothing.
- With `--execute`, Dustin re-reads the account, prints the plan and asks you to type the last four characters of the destination. `--yes` skips that prompt and is only honoured together with `--execute`.
- If any balance cannot be disposed of, nothing is signed unless you pass `--partial`.
- `--json` prints one JSON document; `--memo` sets a memo for destinations that require one (SEP-29).

Exit codes:

| Code | Meaning |
|---|---|
| 0 | Plan printed, or account closed and verified gone |
| 1 | Unexpected error |
| 2 | Usage or validation error: bad address, secret on the command line, wrong key, a network other than testnet, missing secrets |
| 3 | Nothing executed: confirmation missing or declined, or unclosable items without `--partial` |
| 4 | Partial: everything possible was done and the account still exists |
| 5 | Stopped or failed during execution; run the same command again to continue |
| 6 | Horizon unreachable before anything was submitted |

## Quick start: SDK

The SDK example is added when `planClose()` lands (week 1). The flow is: `planClose()` reads the account from Horizon and returns a plan; your wallet shows it; after the user confirms, `executeClose()` signs each inner transaction with the account's signer and wraps it in a fee bump signed by your sponsor.

## Safety model

1. Dry run by default. `planClose()` only reads from Horizon; it cannot sign or submit anything.
2. The merge is always the last operation and is submitted only after every pre-merge check passes: no subentries left, the sequence-number guard, the account sponsors nothing, the destination exists.
3. The account being closed signs the inner transactions; the sponsor signs only the fee-bump envelopes and never any operation, so it cannot move the account's assets.
4. Secrets come from environment variables only. They never appear in output, reports or `--json`, and a secret passed on the command line is refused.
5. Testnet only. Any other network passphrase, and any Horizon that does not serve the testnet, is refused.

## What is not handled

Out of scope for this release:

- Mainnet. Testnet only, no real value.
- Contract accounts (C addresses). Classic G accounts only.
- Liquidity pool share withdrawal: detected and reported, not automated.
- Multisig accounts with raised thresholds: detected and reported, not automated.
- Claimable balance cleanup.
- Production key management. The sponsor uses an environment key.
- Wallet UI and third-party wallet integration.

Limits set by the protocol:

- A balance on a trustline its issuer has deauthorized (or authorized to maintain liabilities only) cannot be moved by the holder. Dustin reports it as unclosable; only the issuer can re-authorize it or claw it back.
- An account that sponsors reserves for other accounts (including claimable balances it created), an account with the `AUTH_IMMUTABLE` flag, and an account whose sequence number is ahead of the ledger cannot be merged. Dustin detects each case and says what to do.

## Evidence

The evidence package (committed plan output, transaction chain with explorer links, test results, baseline recording and demo) is assembled in `docs/evidence/` as each deliverable is produced.

## Development

```bash
npm ci
npm run build          # ESM + CommonJS + type declarations in dist/
npm test               # offline unit tests (no network)
npm run lint
npm run format:check
DUSTIN_TESTNET=1 npm run test:testnet   # live tests against the public testnet
```

## Status

| Sprint week | Dates | Expected output | State |
|---|---|---|---|
| Week 1 | 2026-09-22 to 2026-09-28 | Fixture built, Demolisher baseline recorded, `planClose()` dry run printed | in progress |
| Week 2 | 2026-09-29 to 2026-10-05 | Zero-XLM account closed end to end with sponsored fees | not started |
| Week 3 | 2026-10-06 to 2026-10-12 | Disposal ladder, sponsored unwind, sequence guard, test matrix, messy fixture closed | not started |
| Week 4 | 2026-10-13 to 2026-10-19 | npm publish, 60-second demo, evidence package, write-up | not started |

## License

[MIT](LICENSE)
