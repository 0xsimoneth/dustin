# Dustin

[![CI](https://github.com/0xsimoneth/dustin/actions/workflows/ci.yml/badge.svg)](https://github.com/0xsimoneth/dustin/actions/workflows/ci.yml) ![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg) ![Network: testnet only](https://img.shields.io/badge/network-testnet%20only-orange.svg)

Dustin closes messy Stellar testnet accounts: it cancels offers, disposes of leftover balances, removes trustlines and data entries, and merges the account into a destination you choose. Every transaction is fee-bumped by a sponsor, so an account holding zero spendable XLM, which cannot pay for its own teardown, can still be closed. `planClose()` shows the whole ordered plan before anything is signed, so a wallet can offer account closure without sending its users to a web form.

The existing StellarExpert Account Demolisher builds every transaction with the account being closed as both source and fee payer, and has no fee-bump or sponsored-reserve handling ([client source](https://github.com/stellar-expert/stellar-expert-explorer/blob/master/business-logic/demolisher/demolisher-tx-builder.js)). An account sitting at its minimum reserve therefore cannot even start. That is the gap Dustin fills. Other tools, including the two funded under SCF #44, and how Dustin differs from each are in the [write-up](docs/write-up.md) (section 9, prior art).

> **Status: pre-release.** Dustin is being built during a 30-day Stellar Instaward sprint (2026-09-22 to 2026-10-22). `planClose()`, `executeClose()`, `dustin plan` and `dustin close --execute` are implemented, with the disposal ladder, the sponsored unwind and the sequence-guard wait. On 2026-09-28 zero-spendable messy accounts were closed on testnet with sponsored fees through the SDK and the CLI ([evidence index](evidence/README.md)), and the edge cases have a [test matrix](docs/test-matrix.md). Not done yet: the npm release, the demo video, the Demolisher baseline recording and the complete evidence package. See [Status](#status).

## Demo

The 60-second demo of a full close from the CLI is recorded in week 4 and will be linked here (pending, story E4-S6). Until then, a CLI close you can check in a browser (the links stop resolving at the testnet reset of 2026-12-16):

- the closed account: [explorer](https://stellar.expert/explorer/testnet/account/GCPPFHGLKA7GCBWJXBH4EXFXS3OXAMXFLOBAZLU2K3KKMO6JKZORNFW7), and [Horizon](https://horizon-testnet.stellar.org/accounts/GCPPFHGLKA7GCBWJXBH4EXFXS3OXAMXFLOBAZLU2K3KKMO6JKZORNFW7), which answers 404;
- its first fee-bump transaction, paid by the sponsor: [explorer](https://stellar.expert/explorer/testnet/tx/0ee9fb5e4bb683519af3190e45c6e0350a0819aa509d65fddb34a247e65dcaac);
- the destination, which received 4.0000007 XLM: [explorer](https://stellar.expert/explorer/testnet/account/GDPZI3OAYYEAXTYY2OHFDZAEEG4PXNBN7AHNLQTEH22O5HTBGBSVB2TS).

The command's own output, with the receipt, is [`transcript.txt`](evidence/runs/20260928T112252Z-e3-cli/transcript.txt).

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
- `dustin close --execute` reads the account again and prints the fresh plan and a summary. Its "at most" line names the close budget, the most the sponsor can pay whatever retries and re-plans bid. It then asks you to type the last four characters of the destination; `--yes` skips this for scripts. The question is asked only when standard input, standard error and the stream that carried the plan (standard output, or standard error with `--json`) are terminals. Otherwise the run ends with exit code 3 and says which stream is not a terminal.
- If a quote gets worse after the confirmation, so that the close would recover less than the summary said (the destination would receive less or, without a merge, the account would keep less), the run stops with exit code 3 and signs nothing.
- Each transaction prints its hash and explorer link as it is submitted. A merge held back by the sequence guard prints the start and the end of its wait.
- The receipt lists what became of each leftover balance (Disposals, with each rung that failed and its own code after a fall down the ladder), each unclosable item with the rungs ruled out, and "Reserves released to sponsors" with the figures observed on Horizon. While a merge envelope's outcome is not known, it says so instead of claiming the XLM stayed on the account. It ends with Horizon's 404 for the account. Rendered from a copy saved while a run was going, it says what has not happened yet ("not run yet", "attributed when the run ends", "not read yet"). The full sequence is in the [integration notes](docs/integration-notes.md) (appendix).
- If standard output is closed early (`dustin close ... | head`), the rest of the output goes to standard error after a one-line notice, starting with the part that hit the closed pipe, so no hash or receipt is lost.
- Exit code 0 means the plan was printed, or the account is closed and verified gone. A sequence-guard stop exits 3 when the run was refused before signing, 4 for a partial run with `--partial`, and 5 when it stopped part-way; the receipt names the ledger at which to run the same command again.

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
| `--json` | Exactly one JSON document on standard output: the close report once the executor has one, otherwise the plan (also when the run is refused, or fails before the executor's first report); the rest on standard error. |
| `--report <file>` | With `--execute`, keep the close report (JSON, no secrets) in this file as the run goes. An existing file is kept under a timestamped name; a `.env` name in any letter case, or a link to the working directory's `.env`, is refused. |

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
- The numeric options are checked before anything is read or signed, and a value out of range throws `CONFIG_INVALID`: for example `timeoutSeconds` from 1 to 3600, `graceSeconds` and `ledgerWaitSeconds` from 0 to 3600, `verifyTimeoutMs` at most one hour, and every pause (`pollIntervalMs`, `backoffMs`) at least 200 ms. The [integration notes](docs/integration-notes.md) list every option (section 6.3).
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

- A balance on a trustline its issuer has deauthorized (or authorized to maintain liabilities only) cannot be moved by the holder; Dustin reports it as unclosable, and only the issuer can re-authorize it, or claw it back when the trustline is clawback-enabled. A balance with no market whose issuer requires a memo needs `--memo`. A merged-away issuer is no obstacle: paying the balance back still burns it.
- An account that sponsors reserves for other accounts (including claimable balances it created), an account with the `AUTH_IMMUTABLE` flag, and an account whose sequence number is ahead of the ledger cannot be merged. Dustin detects each case and says what to do.

Every case with its code and remedy is in the [write-up](docs/write-up.md), section 8.

## Evidence

The evidence follows SOW section 6.1; the [evidence index](evidence/README.md) maps SOW Appendix B row by row to the files. Explorer links stop resolving at the next testnet reset (scheduled for 2026-12-16); the JSON and XDR files committed under `evidence/` are the durable record.

| Deliverable | Evidence type (SOW 6.1) | Where |
|---|---|---|
| D1 `planClose()` | Public repo + CLI output | The committed dry-run plan of the messy fixture ([text](evidence/plan/fixture-plan.txt), [JSON](evidence/plan/fixture-plan.json)); `dustin plan` runs on any testnet account. |
| D2 Live close on testnet | Transaction hashes (links) + 60-second video | The metric close of 2026-09-28, with the complete Epic 3 code, through the [SDK](evidence/runs/20260928T112239Z-e3/summary.md) and the [CLI](evidence/runs/20260928T112252Z-e3-cli/summary.md): zero-spendable messy accounts, every transaction a sponsor-paid fee bump, the reports, envelopes, Horizon records and the 404 ([layout](evidence/runs/README.md)). The first closes of week 2: [SDK](evidence/runs/20260926T125350Z/summary.md), [CLI](evidence/runs/20260927T200015Z-cli/summary.md). Pending: the video (E4-S6), and the close of the baseline fixture itself after its recording (matrix row B-03). |
| D3 Edge cases and tests | Test results screenshot + public repo + baseline recording | The [test matrix](docs/test-matrix.md): every row with its offline and live tests; the tests under `test/` ([Development](#development)); the [baseline protocol](evidence/baseline/README.md). Pending: the test results screenshot (E4-S3), the Demolisher recording (E1-S2). |
| Documentation, demo and evidence | Public repo + write-up + 60-second video | The [write-up](docs/write-up.md), the [integration notes](docs/integration-notes.md) and the [evidence index](evidence/README.md). Pending: the video (E4-S6) and the complete evidence package (E4-S7). |

Three more live runs through the CLI on 2026-09-28, each with its transcript, report and Horizon records:

- [Sequence-guard wait](evidence/runs/20260928T125223Z-e3s4-wait/summary.md): a sequence number bumped 12 ledgers ahead; the cleanup and the sale ran, the CLI printed the wait, and the merge applied in the unblocking ledger 4915293 (story E3-S4).
- [Unclosable exit on the `edge` fixture](evidence/runs/20260928T125414Z-edge-frozen/summary.md): 62 of 62 fixture checks; a trustline frozen by its issuer; exit 3 without `--partial`, nothing signed; exit 4 with it, the rest cleaned up and the frozen FRZ trustline left, with its reason and remedy on the receipt (SOW week 3).
- [Partial close with no route](evidence/runs/20260928T125528Z-e3s2-partial/summary.md): an issuer that requires a memo; DUSTC sent to the destination, DUSTB and SPTA `NO_DISPOSAL_ROUTE`, exit 3, then exit 4 with the partial-close receipt (story E3-S2).

## Development

```bash
npm ci
npm run build          # ESM + CommonJS + type declarations in dist/
npm test               # offline tier: recorded Horizon JSON and a fake ledger, no network
npm run lint
npm run format:check
DUSTIN_TESTNET=1 npm run test:testnet -- --reporter=verbose   # live tier: builds its own throwaway accounts
```

The live tests print every transaction hash with its purpose; `--reporter=verbose` shows that output even for passing tests. Every row of the D3 matrix, its tests and how to run each tier are in [docs/test-matrix.md](docs/test-matrix.md).

Fixtures can also be built by hand on testnet: `dustin fixture create --profile messy` builds the metric account of SOW Appendix B, `dustin fixture create --profile edge` builds one throwaway account per edge variant (among them a frozen balance, a clawback-enabled trustline, pool shares, raised thresholds, a claimable balance and `AUTH_IMMUTABLE`), and `dustin fixture verify <manifest>` checks either against Horizon. The keys go to `.fixture/<id>/keys.json` (gitignored, testnet only).

## Status

| Sprint week | Dates | Expected output | State |
|---|---|---|---|
| Week 1 | 2026-09-22 to 2026-09-28 | Fixture built, Demolisher baseline recorded, `planClose()` dry run printed | fixture built and dry run committed (`evidence/plan/`); the Demolisher baseline recording is pending |
| Week 2 | 2026-09-29 to 2026-10-05 | Zero-XLM account closed end to end with sponsored fees | met early on 2026-09-26: [transaction chain and 404](evidence/runs/20260926T125350Z/summary.md) |
| Week 3 | 2026-10-06 to 2026-10-12 | Disposal ladder, sponsored unwind, sequence guard, test matrix, messy fixture closed | met early on 2026-09-28: the ladder, the sponsored unwind, the sequence-guard wait and the edge cases proven live ([test matrix](docs/test-matrix.md); through the CLI: [the wait](evidence/runs/20260928T125223Z-e3s4-wait/summary.md), [the unclosable exit](evidence/runs/20260928T125414Z-edge-frozen/summary.md)), and the messy fixture closed through the [SDK](evidence/runs/20260928T112239Z-e3/summary.md) and the [CLI](evidence/runs/20260928T112252Z-e3-cli/summary.md) ([evidence index](evidence/README.md)); the close of the baseline fixture itself follows its Demolisher recording |
| Week 4 | 2026-10-13 to 2026-10-19 | npm publish, 60-second demo, evidence package, write-up | started early: first versions of the write-up and the integration notes; the npm release, the demo and the evidence package are pending |

## More

- [Integration notes](docs/integration-notes.md), for wallet developers.
- [Ordering rules and known limits](docs/write-up.md), the write-up.
- [Planning documents and canonical decisions](docs/README.md).
- [Statement of Work](SUCCESSFUL_SOW.md): scope, success metric and evidence plan.
- A changelog and contributing notes: pending, with the 0.1.0 release.

## License

[MIT](LICENSE)
