# Dustin

[![CI](https://github.com/0xsimoneth/dustin/actions/workflows/ci.yml/badge.svg)](https://github.com/0xsimoneth/dustin/actions/workflows/ci.yml) ![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg) ![Network: testnet only](https://img.shields.io/badge/network-testnet%20only-orange.svg)

Dustin closes messy Stellar testnet accounts: it cancels offers, disposes of leftover balances, removes trustlines and data entries, and merges the account into a destination you choose. Every transaction is fee-bumped by a sponsor, so an account holding zero spendable XLM, which cannot pay for its own teardown, can still be closed. `planClose()` shows the whole ordered plan before anything is signed, so a wallet can offer account closure without sending its users to a web form.

The existing StellarExpert Account Demolisher builds every transaction with the account being closed as both source and fee payer, and has no fee-bump or sponsored-reserve handling ([client source](https://github.com/stellar-expert/stellar-expert-explorer/blob/master/business-logic/demolisher/demolisher-tx-builder.js)). An account sitting at its minimum reserve therefore cannot even start. That is the gap Dustin fills.

> **Status: pre-release.** Dustin is being built during a 30-day Stellar Instaward sprint (2026-09-22 to 2026-10-22). `planClose()`, `executeClose()`, `dustin plan` and `dustin close --execute` are implemented and covered by the offline test tier, and a zero-spendable messy account was closed on testnet with sponsored fees ([evidence](evidence/runs/20260926T125350Z/summary.md)); the npm release, the demo and the evidence package follow. See [Status](#status).

## Demo

The 60-second demo of a full close from the CLI is recorded in week 4 and linked here.

## Quick start: CLI

Requires Node.js 22.12 or newer.

```bash
npm install -g stellar-dustin

# Read-only: prints the ordered close plan. Needs no secret.
dustin plan G<ACCOUNT> --to G<DESTINATION>

# Executes the plan. Secrets come from a .env file or the environment, never from the command line.
# Put them in .env (gitignored) with an editor, so they never reach your shell history:
#   DUSTIN_ACCOUNT_SECRET=S...   the account being closed
#   DUSTIN_SPONSOR_SECRET=S...   a funded testnet account that pays every fee
dustin close G<ACCOUNT> --to G<DESTINATION> --execute
```

Typing `export DUSTIN_ACCOUNT_SECRET=S...` at a prompt stores the secret in your shell history; if you prefer the environment, read it without echo (`read -rs DUSTIN_ACCOUNT_SECRET && export DUSTIN_ACCOUNT_SECRET`) or load it from a secrets manager.

`dustin close` without `--execute` prints the same plan as `dustin plan` and changes nothing; `--yes`, `--partial` and `--report` have no effect there, and a note on standard error says so.

### What `dustin close --execute` does

1. Checks the addresses, then reads the two secrets (see [Configuration](#configuration)) and checks them: each must be a valid secret key, the account secret must belong to the account being closed, and the sponsor must be a different account. A missing, malformed or wrong secret stops the run with exit code 2; its value is never printed.
2. Asks Horizon which network it serves (`GET /`) and refuses anything but the testnet.
3. Re-reads the account and prints a fresh plan, with the sponsor as fee payer and the sponsor's per-close budget (5 XLM) next to the fee bid.
4. Stops before anything is signed, with exit code 3, when there is nothing to execute, when an item cannot be disposed of and `--partial` is not given (with the reason and the remedy for each item), when the fee bid exceeds the budget, or when the sponsor cannot spend at least the budget.
5. Shows what will happen (the destination, the XLM it receives through the merge, the sponsor and what it can spend, the transactions and operations) and asks you to type the **last four characters of the destination**. Anything else, an empty answer, the end of input, Ctrl-C, or a standard input that is not a terminal leaves everything untouched (exit 3). `--yes` skips the question for scripts and says so loudly; it is honoured only with `--execute`.
6. Runs the plan. Every transaction is signed by the account and fee-bumped by the sponsor. Each one prints its hash and explorer link when it is submitted, then its ledger and the fee charged to the sponsor when it is confirmed, or its result codes when it fails.
7. Checks the account on Horizon (`404` means it no longer exists) and prints a receipt: every transaction with its outer and inner hash, ledger, fee and the operations it carried; the XLM merged into the destination; reserves returned to reserve sponsors; fees paid by the account (0) and by the sponsor; explorer links for the account and the destination. After a partial or failed run it says what is left and how to continue: run the same command again, and Dustin re-reads the account and plans only what is left.

Options of `dustin close`:

| Option | Effect |
|---|---|
| `--to <G...>` | Destination of the merge (`--destination` is an alias). |
| `--execute` | Sign and submit after the typed confirmation. Without it, `close` is a dry run. |
| `--yes` | Skip the typed confirmation. Only honoured with `--execute`. |
| `--partial` | Run everything that can run even when an item cannot be disposed of; the account is not merged (exit 4). |
| `--memo <text>` | Memo for a destination that requires one (SEP-29), at most 28 bytes. |
| `--prefer-destination` | Try the transfer to the destination before the return to the issuer. |
| `--base-fee <stroops>` | Fee bid per operation instead of the `fee_stats` estimate. With `--execute` it is both the bid and the ceiling: every re-plan keeps it, and a retry after `tx_insufficient_fee` cannot bid above it, so the run stops instead. Without it, a retry after a fee surge may raise the bid up to the per-operation cap, never beyond the 5 XLM per-close budget. |
| `--json` | Print one JSON document on standard output: the plan, or with `--execute` the final close report. The plan, the question, the progress and the receipt then go to standard error. |
| `--report <file>` | With `--execute`, keep the close report in this file (JSON with public keys, hashes and envelopes; never a secret), rewritten after every change so that a stopped run still has every hash. |

Exit codes:

| Code | Meaning |
|---|---|
| 0 | Plan printed, or account closed and verified gone (Horizon answers 404) |
| 1 | Unexpected error |
| 2 | Usage or validation error: bad address, secret on the command line, missing, malformed or wrong secret, a network other than testnet, a URL that is not a Horizon server |
| 3 | Nothing executed: confirmation declined or impossible (no terminal and no `--yes`), unclosable items without `--partial`, nothing to execute, the account changed after the plan was shown, a fee bid over the sponsor's budget, or a sponsor that cannot cover it |
| 4 | Partial: everything possible was done and the account still exists |
| 5 | Stopped or failed during execution, or a merge that was not verified gone; run the same command again to continue |
| 6 | Horizon unreachable before anything was submitted |

## Quick start: SDK

```ts
import { Keypair } from "@stellar/stellar-sdk";
import { executeClose, keypairSigner, planClose, renderPlan, renderReport } from "stellar-dustin";

// Your own key handling; here, two testnet secrets from the environment.
const account = Keypair.fromSecret(process.env.DUSTIN_ACCOUNT_SECRET!);
const sponsor = Keypair.fromSecret(process.env.DUSTIN_SPONSOR_SECRET!);

// Read-only: GET requests to Horizon, no secret, nothing signed.
const plan = await planClose({
  account: account.publicKey(),
  destination: "G...", // receives the XLM through the merge
  feeSponsor: sponsor.publicKey(), // pays every fee
});
console.log(renderPlan(plan)); // show it to the account holder and get their approval

const report = await executeClose(
  plan,
  { account: keypairSigner(account), feeSponsor: keypairSigner(sponsor) },
  {
    confirm: true, // required: executing is irreversible
    allowPartial: false, // true: run everything but the merge when an item cannot be disposed of
    onEvent: (event) => console.log(event.type), // tx:submitted, tx:confirmed, verified, ...
    onReport: (copy) => save(copy), // a copy after every change, so no hash is lost
  },
);
console.log(renderReport(report, { plans: [plan] }));
// report.status is "closed", "partial", "aborted" or "failed";
// report.verification.accountExists is false once Horizon answers 404 for the account.
```

- `keypairSigner()` keeps the keypair in a closure. Any object with `publicKey()` and `sign(tx)` is a `Signer`, so a wallet can sign with its own key store or a hardware device. The sponsor signs only the fee-bump envelopes.
- Before signing, `executeClose()` re-reads the account and plans again. If the plan changed, it stops with status `aborted` and submits nothing; pass `onDrift: "replan"` to continue with the fresh plan.
- Errors are `DustinError`s with a stable `code`. When a run stops on an error after something was submitted, the error can carry the report so far in `error.report`.
- The SDK never reads environment variables or `.env`; the CLI does, for `dustin close --execute` only.

## Configuration

| Variable | Used by | Read from |
|---|---|---|
| `DUSTIN_ACCOUNT_SECRET` | `dustin close --execute` only: the secret key of the account being closed | the environment, else `.env` in the working directory |
| `DUSTIN_SPONSOR_SECRET` | `dustin close --execute` only: the secret key of a funded testnet account that pays every fee | the environment, else `.env` in the working directory |
| `DUSTIN_HORIZON_URL` | every command: the Horizon to use (default `https://horizon-testnet.stellar.org`); it must serve the testnet | the environment only |
| `DUSTIN_EXPLORER_BASE` | every command: the base of explorer links (default `https://stellar.expert/explorer/testnet`) | the environment only |

- `.env` supplies only the two secrets, and only to `dustin close --execute`. `plan`, the dry-run `close` and `fixture` never open it; every other line in it is ignored; nothing from it is copied into the process environment. Set `DUSTIN_HORIZON_URL` and `DUSTIN_EXPLORER_BASE` in the environment.
- A non-empty value in the process environment takes precedence over the same variable in `.env`.
- Copy `.env.example` to `.env` to start; `.env` is gitignored. Never pass a secret on the command line: an argument that looks like a secret key is refused (exit 2) without being echoed.

## Safety model

1. Dry run by default. `planClose()`, `dustin plan` and `dustin close` without `--execute` only read from Horizon; nothing is signed without `--execute` and the typed confirmation (or `--yes`).
2. The merge is always the last operation and is submitted only after every pre-merge check passes: no subentries left, the sequence-number guard, the account sponsors nothing, the destination exists.
3. The account being closed signs the inner transactions; the sponsor signs only the fee-bump envelopes and never any operation, so it cannot move the account's assets.
4. Secrets are read only by `dustin close --execute`, from the environment or `.env`. They never appear in output, reports, `--report` files or `--json`, and a secret passed on the command line is refused.
5. Testnet only. Any other network passphrase, and any Horizon that does not serve the testnet, is refused before the first read.

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

Evidence is committed under `evidence/` as each deliverable is produced (the package template is `docs/evidence/evidence-package-template.md`):

- `evidence/plan/`: the dry-run plan of the messy fixture, as text and JSON (Deliverable 1).
- `evidence/runs/20260926T125350Z/`: the first live close of a zero-spendable messy account on testnet, with the close report, both envelopes of every transaction, Horizon's records showing the sponsor as fee account, and Horizon's 404 for the closed account afterwards (Deliverable 2). `evidence/runs/README.md` explains the layout and how to reproduce a run.
- `evidence/baseline/`: the recording protocol for the StellarExpert Demolisher baseline (Deliverable 3); the recording itself is pending.

Explorer links stop resolving at the next testnet reset (scheduled for 2026-12-16); the JSON and XDR files are the durable record.

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
| Week 1 | 2026-09-22 to 2026-09-28 | Fixture built, Demolisher baseline recorded, `planClose()` dry run printed | fixture built and dry run committed (`evidence/plan/`); the Demolisher baseline recording is pending |
| Week 2 | 2026-09-29 to 2026-10-05 | Zero-XLM account closed end to end with sponsored fees | met early on 2026-09-26: [transaction chain and 404](evidence/runs/20260926T125350Z/summary.md) |
| Week 3 | 2026-10-06 to 2026-10-12 | Disposal ladder, sponsored unwind, sequence guard, test matrix, messy fixture closed | in progress: the ladder and the sponsored unwind ran in the live close; the sequence-guard wait, the test matrix and the metric close of the baseline fixture remain |
| Week 4 | 2026-10-13 to 2026-10-19 | npm publish, 60-second demo, evidence package, write-up | not started |

## License

[MIT](LICENSE)
