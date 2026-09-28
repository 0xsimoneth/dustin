# Dustin

[![CI](https://github.com/0xsimoneth/dustin/actions/workflows/ci.yml/badge.svg)](https://github.com/0xsimoneth/dustin/actions/workflows/ci.yml) ![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg) ![Network: testnet only](https://img.shields.io/badge/network-testnet%20only-orange.svg)

Dustin closes messy Stellar testnet accounts: it cancels offers, disposes of leftover balances, removes trustlines and data entries, and merges the account into a destination you choose. Every transaction is fee-bumped by a sponsor, so an account holding zero spendable XLM, which cannot pay for its own teardown, can still be closed. `planClose()` shows the whole ordered plan before anything is signed, so a wallet can offer account closure without sending its users to a web form.

The existing StellarExpert Account Demolisher builds every transaction with the account being closed as both source and fee payer, and has no fee-bump or sponsored-reserve handling ([client source](https://github.com/stellar-expert/stellar-expert-explorer/blob/master/business-logic/demolisher/demolisher-tx-builder.js)). An account sitting at its minimum reserve therefore cannot even start. That is the gap Dustin fills. Other tools, including the two funded under SCF #44, and how Dustin differs from each are in the [write-up](docs/write-up.md) (section 9, prior art).

> **Status: pre-release.** Dustin is being built during a 30-day Stellar Instaward sprint (2026-09-22 to 2026-10-22). `planClose()`, `executeClose()`, `dustin plan` and `dustin close --execute` are implemented and covered by the offline test tier, and two zero-spendable messy accounts were closed on testnet with sponsored fees ([SDK close](evidence/runs/20260926T125350Z/summary.md), [CLI close](evidence/runs/20260927T200015Z-cli/summary.md)). Not done yet: the npm release, the demo video, the test matrix and the evidence package. See [Status](#status).

## Demo

The 60-second demo of a full close from the CLI is recorded in week 4 and will be linked here (pending, story E4-S6). Until then, a CLI close you can check in a browser (the links stop resolving at the testnet reset of 2026-12-16):

- the closed account: [explorer](https://stellar.expert/explorer/testnet/account/GBBF5QVZJKGOUSK57AUHJ6I2DCT4EDRWIHAN4BJRHOVILN7P3XEMNYA7), and [Horizon](https://horizon-testnet.stellar.org/accounts/GBBF5QVZJKGOUSK57AUHJ6I2DCT4EDRWIHAN4BJRHOVILN7P3XEMNYA7), which answers 404;
- its first fee-bump transaction, paid by the sponsor: [explorer](https://stellar.expert/explorer/testnet/tx/7a995eee92b92a79b67f19bbc35456946fa76566601370c662ce40cdb0159da2);
- the destination, which received 4.0000007 XLM: [explorer](https://stellar.expert/explorer/testnet/account/GAH2NP3B2L4YKKHX5DEDRUC7VLOX5L43IPJRB2LLSYOAMJYGZ4MPUJJY).

## Quick start: CLI

Requires Node.js 22.12 or newer. The npm package `stellar-dustin` is not published yet (0.1.0 is planned for week 4); until then, build it from source:

```bash
git clone https://github.com/0xsimoneth/dustin.git
cd dustin
npm ci
npm run build
npm link   # optional: puts `dustin` on your PATH; without it, use `node dist/cli/main.js` in place of `dustin`
```

```bash
# Read-only: prints the ordered close plan. Needs no secret.
dustin plan G<ACCOUNT> --to G<DESTINATION>

# Executes the plan. Secrets come from a .env file or the environment, never from the command line.
# Put them in .env (gitignored) with an editor, so they never reach your shell history:
#   DUSTIN_ACCOUNT_SECRET=S...   the account being closed
#   DUSTIN_SPONSOR_SECRET=S...   a funded testnet account that pays every fee
dustin close G<ACCOUNT> --to G<DESTINATION> --execute
```

Typing `export DUSTIN_ACCOUNT_SECRET=S...` at a prompt stores the secret in your shell history; read it without echo (`read -rs DUSTIN_ACCOUNT_SECRET && export DUSTIN_ACCOUNT_SECRET`) instead.

- `dustin plan`, and `dustin close` without `--execute`, only read from Horizon; nothing is signed or submitted.
- `dustin close --execute` reads the account again, prints the fresh plan and what the sponsor may pay, and asks you to type the last four characters of the destination (`--yes` skips this for scripts). It prints each transaction's hash and explorer link as it is submitted and ends with a receipt and Horizon's 404 for the account; the full sequence is in the [integration notes](docs/integration-notes.md) (appendix).
- Exit code 0 means the plan was printed, or the account is closed and verified gone.

| Option of `dustin close` | Effect |
|---|---|
| `--to <G...>` | Destination of the merge (`--destination` is an alias). |
| `--execute` | Sign and submit after the typed confirmation; without it, `close` is a dry run. |
| `--yes` | Skip the typed confirmation; only with `--execute`. |
| `--partial` | Run everything that can run when an item cannot be disposed of; no merge (exit 4). |
| `--memo <text>` | Memo for a destination that requires one (SEP-29), at most 28 bytes. |
| `--prefer-destination` | Try the transfer to the destination before the return to the issuer. |
| `--sponsor <G...>` | The fee sponsor; with `--execute` it must own `DUSTIN_SPONSOR_SECRET`. |
| `--base-fee <stroops>` | Bid per operation instead of the `fee_stats` estimate; with `--execute` also the highest bid. |
| `--json` | One JSON document on standard output (the plan, or the close report); the rest on standard error. |
| `--report <file>` | With `--execute`, keep the close report (JSON, no secrets) in this file as the run goes. |

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

Until the npm release, build a tarball from a clone with `npm pack` and install it in your project ([integration notes](docs/integration-notes.md), section 1).

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

The [integration notes](docs/integration-notes.md) cover the whole wallet flow: rendering the plan, approval, signers, events, drift, partial closes, continuing a stopped run, errors and how to fund and protect a sponsor.

## Configuration

| Variable | Used by | Read from |
|---|---|---|
| `DUSTIN_ACCOUNT_SECRET` | `dustin close --execute` only: the secret key of the account being closed | the environment, else `.env` in the working directory |
| `DUSTIN_SPONSOR_SECRET` | `dustin close --execute` only: the secret key of a funded testnet account that pays every fee | the environment, else `.env` in the working directory |
| `DUSTIN_HORIZON_URL` | every command: the Horizon to use (default `https://horizon-testnet.stellar.org`); it must serve the testnet | the environment only |
| `DUSTIN_EXPLORER_BASE` | every command: the base of explorer links (default `https://stellar.expert/explorer/testnet`) | the environment only |

Copy `.env.example` to `.env` (gitignored) to start. `.env` supplies only the two secrets, only to `dustin close --execute`, and the environment takes precedence.

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

- A balance on a trustline its issuer has deauthorized (or authorized to maintain liabilities only) cannot be moved by the holder; Dustin reports it as unclosable, and only the issuer can re-authorize it or claw it back. A balance with no market whose issuer requires a memo needs `--memo`. A merged-away issuer is no obstacle: paying the balance back still burns it.
- An account that sponsors reserves for other accounts (including claimable balances it created), an account with the `AUTH_IMMUTABLE` flag, and an account whose sequence number is ahead of the ledger cannot be merged. Dustin detects each case and says what to do.

Every case with its code and remedy is in the [write-up](docs/write-up.md), section 8.

## Evidence

The evidence follows SOW section 6.1. Explorer links stop resolving at the next testnet reset (scheduled for 2026-12-16); the JSON and XDR files committed under `evidence/` are the durable record.

| Deliverable | Evidence type (SOW 6.1) | Where |
|---|---|---|
| D1 `planClose()` | Public repo + CLI output | The committed dry-run plan of the messy fixture ([text](evidence/plan/fixture-plan.txt), [JSON](evidence/plan/fixture-plan.json)); `dustin plan` runs on any testnet account. |
| D2 Live close on testnet | Transaction hashes (links) + 60-second video | Zero-spendable messy accounts closed with sponsor-paid fee bumps through the [SDK](evidence/runs/20260926T125350Z/summary.md) and the [CLI](evidence/runs/20260927T200015Z-cli/summary.md): reports, envelopes, Horizon records and the 404 ([layout](evidence/runs/README.md)). Pending: the close of the baseline fixture (E3-S7), the video (E4-S6). |
| D3 Edge cases and tests | Test results screenshot + public repo + baseline recording | Tests under `test/` ([Development](#development)); the [baseline protocol](evidence/baseline/README.md). Pending: the test matrix and its screenshot (E3-S6, E4-S3), the Demolisher recording (E1-S2). |
| Documentation, demo and evidence | Public repo + write-up + 60-second video | The [write-up](docs/write-up.md) and the [integration notes](docs/integration-notes.md), first versions. Pending: the video (E4-S6), the evidence index `evidence/README.md` (E4-S7). |

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
| Week 3 | 2026-10-06 to 2026-10-12 | Disposal ladder, sponsored unwind, sequence guard, test matrix, messy fixture closed | in progress: the ladder and the sponsored unwind ran in the live closes; the sequence-guard wait, the `edge` fixture, the test matrix and the close of the baseline fixture remain |
| Week 4 | 2026-10-13 to 2026-10-19 | npm publish, 60-second demo, evidence package, write-up | started early: first versions of the write-up and the integration notes; the npm release, the demo and the evidence package are pending |

## More

- [Integration notes](docs/integration-notes.md), for wallet developers.
- [Ordering rules and known limits](docs/write-up.md), the write-up.
- [Planning documents and canonical decisions](docs/README.md).
- [Statement of Work](SUCCESSFUL_SOW.md): scope, success metric and evidence plan.
- A changelog and contributing notes: pending, with the 0.1.0 release.

## License

[MIT](LICENSE)
