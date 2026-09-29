# Dustin

[![CI](https://github.com/0xsimoneth/dustin/actions/workflows/ci.yml/badge.svg)](https://github.com/0xsimoneth/dustin/actions/workflows/ci.yml) ![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg) ![Network: testnet only](https://img.shields.io/badge/network-testnet%20only-orange.svg)

Dustin closes messy Stellar testnet accounts: it cancels offers, disposes of leftover balances, removes trustlines and data entries, and merges the account into a destination you choose. Every transaction is fee-bumped by a sponsor, so an account holding zero spendable XLM, which cannot pay for its own teardown, can still be closed. `planClose()` shows the whole ordered plan before anything is signed, so a wallet can offer account closure without sending its users to a web form.

The gap: the existing StellarExpert Account Demolisher sources and pays every transaction from the account being closed and has no fee-bump or sponsored-reserve handling ([client source](https://github.com/stellar-expert/stellar-expert-explorer/blob/master/business-logic/demolisher/demolisher-tx-builder.js)), so an account at its minimum reserve cannot even start. Other tools, and how Dustin differs from each, are in the [write-up](docs/write-up.md) (section 9, prior art).

> **Status: 0.1.0 prepared, not yet on npm.** The package is `stellar-dustin` (command `dustin`), version 0.1.0. Publishing it to npm is the builder's action and is still pending; until then, install from source (below). Built during a 30-day Stellar Instaward sprint (2026-09-22 to 2026-10-22). The SOW's success metric was met on 2026-09-28: a zero-spendable messy account closed on testnet with every fee paid by a sponsor ([evidence package](evidence/README.md)). Testnet only.

## Demo

The 60-second video of a full close from the CLI: `<pending: builder records the 60-second video (E4-S6); its link goes here>`. The script it follows is [docs/demo-video-script.md](docs/demo-video-script.md).

Until then, the recorded CLI close of 2026-09-28 can be checked in a browser (the links stop resolving at the testnet reset of 2026-12-16):

- the closed account: [explorer](https://stellar.expert/explorer/testnet/account/GCPPFHGLKA7GCBWJXBH4EXFXS3OXAMXFLOBAZLU2K3KKMO6JKZORNFW7), and [Horizon](https://horizon-testnet.stellar.org/accounts/GCPPFHGLKA7GCBWJXBH4EXFXS3OXAMXFLOBAZLU2K3KKMO6JKZORNFW7), which answers 404;
- its three fee-bump transactions, each paid by the sponsor: [cleanup](https://stellar.expert/explorer/testnet/tx/0ee9fb5e4bb683519af3190e45c6e0350a0819aa509d65fddb34a247e65dcaac), [sale](https://stellar.expert/explorer/testnet/tx/f7161ce4667cc9b3457aa6daa948f8b39df847b0576ab73849ac7325ad81f700), [merge](https://stellar.expert/explorer/testnet/tx/36e53646514a36c673830955b661b91de297842481295f458de8c5911e5c989c);
- the destination, which received 4.0000007 XLM: [explorer](https://stellar.expert/explorer/testnet/account/GDPZI3OAYYEAXTYY2OHFDZAEEG4PXNBN7AHNLQTEH22O5HTBGBSVB2TS).

The command's own output, with the receipt, is [`transcript.txt`](evidence/runs/20260928T112252Z-e3-cli/transcript.txt).

## Install

Requires Node.js 22.12 or newer.

From source (works today):

```bash
git clone https://github.com/0xsimoneth/dustin.git
cd dustin
npm ci
npm run build
node dist/cli/main.js --help   # the CLI; `npm link` puts it on your PATH as `dustin`
```

From npm, once 0.1.0 is published (pending, the builder's action):

```bash
npm install -g stellar-dustin   # puts `dustin` on your PATH
npx stellar-dustin --help       # or run it without installing
```

The package name is `stellar-dustin`; the bare npm name `dustin` belongs to an unrelated package, so do not run `npx dustin` unless `stellar-dustin` is installed in that project.

## Quick start: CLI

```bash
# Read-only: prints the ordered close plan. Needs no secret.
dustin plan G<ACCOUNT> --to G<DESTINATION> --sponsor G<SPONSOR>

# Executes the plan after you type the last four characters of the destination.
dustin close G<ACCOUNT> --to G<DESTINATION> --execute
```

`dustin close --execute` needs two secret keys: the account being closed (`DUSTIN_ACCOUNT_SECRET`) and a funded testnet account that pays every fee (`DUSTIN_SPONSOR_SECRET`). It reads them from the environment, else from a `.env` file in the working directory (copy [`.env.example`](.env.example); `.env` is gitignored), else it asks for a missing one with a hidden prompt, but only when standard input and standard error are terminals and `--json` is not given (Ctrl-C or the end of input counts as missing: exit 2). A secret on the command line is refused.

- `dustin plan`, and `dustin close` without `--execute`, only read from Horizon; nothing is signed or submitted.
- `dustin close --execute` reads the account again, prints the fresh plan and a summary (the destination and what it receives, the sponsor and the most it can pay, the transactions), then asks for the last four characters of the destination. `--yes` skips the question for scripts. If the plan changed, or a quote got worse so the close would recover less than the summary said, it stops with exit code 3 and signs nothing.
- Each transaction prints its hash and explorer link as it is submitted, then its ledger and the fee charged to the sponsor. A merge held back by the sequence-number guard prints the start and the end of its wait.
- The receipt ends with Horizon's 404 for the account, what became of each leftover balance, each unclosable item with its reason and remedy, and the reserves released to reserve sponsors as observed on Horizon.
- Ctrl-C (or SIGTERM) while the transactions run stops the close at the next safe point: nothing is posted after it, the receipt is printed and `--report` written; a second Ctrl-C writes the latest report at once. Running the same command again continues from the ledger, and on an account that is already gone it records Horizon's 404, signs nothing and exits 3.

| Option of `dustin close` | Effect |
|---|---|
| `--to <G...>` | Destination of the merge (`--destination` is an alias). |
| `--execute` | Sign and submit after the typed confirmation; without it, `close` is a dry run. |
| `--yes` | Skip the typed confirmation; only with `--execute`. |
| `--partial` | Run everything that can run when an item cannot be disposed of; no merge (exit 4). |
| `--memo <text>` | Memo for a destination or issuer that requires one (SEP-29), at most 28 bytes. |
| `--prefer-destination` | Try the transfer to the destination before the return to the issuer. |
| `--sponsor <G...>` | The fee sponsor; with `--execute` it must own `DUSTIN_SPONSOR_SECRET`. |
| `--base-fee <stroops>` | Bid per operation instead of the `fee_stats` estimate; with `--execute` also the highest bid. |
| `--json` | Machine mode: exactly one JSON document on standard output (the close report, or the plan when the run was refused before the executor started; [plan-schema.json](docs/plan-schema.json), [receipt-schema.json](docs/receipt-schema.json)), and NDJSON only on standard error: one JSON object per line with a `type`, for the executor's events, `notice` and `error` ([integration notes](docs/integration-notes.md), section 7). It never asks anything: `--execute --json` without `--yes` exits 3 (`CONFIRMATION_REQUIRED`), and a missing secret exits 2. |
| `--report <file>` | With `--execute`, keep the close report (JSON, no secrets) in this file as the run goes. |

`dustin plan` takes `--to`, `--sponsor`, `--prefer-destination`, `--memo`, `--base-fee` and `--json`. The global options are `--network testnet` (the only network accepted), `--verbose` (on an error, its stage, verdict, Horizon result codes, details and cause chain as well, with secrets redacted), `--help` and `--version`. The output is plain ASCII without colour, and human text wraps at 120 columns. Every error prints its code, one sentence and what to do; [docs/errors.md](docs/errors.md) lists every code. `dustin fixture create --profile messy|edge` builds a fixture account on testnet and `dustin fixture verify <manifest>` checks it against Horizon (section [Run the tests yourself](#run-the-tests-yourself)).

## Quick start: SDK

Until the npm release, build a tarball from a clone with `npm pack` and install it in your project ([integration notes](docs/integration-notes.md), section 1); once 0.1.0 is published, `npm install stellar-dustin`.

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
- Errors are `DustinError`s with a stable `code`; `remedyOf(error)` gives what to do, and every code is in [docs/errors.md](docs/errors.md). When a run stops on an error after something was submitted, the error carries the report so far in `error.report`.
- Pass `signal` (an `AbortSignal`) to stop a run at the next safe point; the report then ends with the stop `INTERRUPTED`.
- The SDK never reads environment variables or `.env`; the CLI does, for `dustin close --execute` only.

The [integration notes](docs/integration-notes.md) cover the whole wallet flow: rendering the plan, approval, signers, events, drift, partial closes, continuing a stopped run, errors, and how to fund and protect a sponsor.

## Safety model

1. **Dry run by default.** `planClose()`, `dustin plan` and `dustin close` without `--execute` only read from Horizon; nothing is signed without `--execute` and the typed confirmation (or `--yes`).
2. **The merge is last.** It is always the last operation and is submitted only after every pre-merge check passes: no subentries left, the sequence-number guard, the account sponsors nothing, the destination exists and gets any memo it requires.
3. **Two signers, split duties.** The account being closed signs the inner transactions; the sponsor signs only the fee-bump envelopes and never an operation, within a per-close budget (default 5 XLM), so it cannot move the account's assets.
4. **Secrets stay secret.** They are read only by `dustin close --execute`, from the environment, `.env` or a hidden prompt that echoes nothing; they never appear in output, reports, `--report` files or `--json`, and a secret passed on the command line is refused.
5. **Testnet only.** Any other network passphrase, and any Horizon that does not serve the testnet, is refused before the first read.

## Exit codes

The CLI's exit codes ([canonical decision 5](docs/README.md), `src/cli/exit-codes.ts`):

| Code | Meaning |
|---|---|
| 0 | Plan printed, or account closed and verified gone (Horizon answers 404) |
| 1 | Unexpected error |
| 2 | Usage or validation error: bad address, secret on the command line, missing, malformed or wrong secret, a network other than testnet, a URL that is not a Horizon server |
| 3 | Nothing executed: confirmation declined or impossible (no terminal and no `--yes`, or `--json` without `--yes`), unclosable items without `--partial`, nothing to execute, the account changed after the plan was shown, the account no longer exists (Horizon's 404 is recorded), a fee bid over the sponsor's budget, a sponsor that cannot cover it, or an interruption (SIGINT or SIGTERM) before anything was submitted |
| 4 | Partial: everything possible was done and the account still exists |
| 5 | Stopped or failed during execution, interrupted (SIGINT or SIGTERM) after something was or may have been submitted, a second signal, or a merge that was not verified gone; run the same command again to continue |
| 6 | Horizon unreachable before anything was submitted |

## What is not handled

Out of scope for this release (SOW section 4.1):

- Mainnet. Testnet only, no real value.
- Contract accounts (C addresses). Classic G address accounts only.
- Liquidity pool share withdrawal. Detected and reported, not automated.
- Multisig accounts with raised thresholds. Detected and reported, not automated.
- Claimable balance cleanup.
- Production key management. The sponsor uses an env key for this scope.
- Wallet UI. A CLI demo is the interface for this scope, integration UI is left to the integrator.
- Third-party wallet integration work.

Limits set by the protocol:

- A balance on a trustline its issuer has deauthorized (or authorized to maintain liabilities only) cannot be moved by the holder; Dustin reports it as unclosable, and only the issuer can re-authorize it, or claw it back when the trustline is clawback-enabled.
- A balance with no market whose issuer requires a memo needs `--memo`; without it and without a destination that can take it, it has no route (`NO_DISPOSAL_ROUTE`). A merged-away issuer is no obstacle: paying the balance back still burns it.
- An account that sponsors reserves for other accounts (including claimable balances it created), an account with the `AUTH_IMMUTABLE` flag, and an account whose sequence number is far ahead of the ledger cannot be merged. Dustin detects each case and says what to do.

Every case with its code and remedy is in the [write-up](docs/write-up.md), section 8.

## Run the tests yourself

On a fresh machine with Node.js 22.12 or newer and internet access. No key, no secret and no `.env` is needed: every live test and every fixture funds its own throwaway accounts from Friendbot.

```bash
git clone https://github.com/0xsimoneth/dustin.git
cd dustin
npm ci
npm test                                     # offline tier: no network at all
DUSTIN_TESTNET=1 npm run test:testnet -- --reporter=verbose   # live tier on testnet
```

- **Offline tier** (`npm test`): recorded Horizon JSON and a fake ledger, with the network blocked for the whole tier. The committed green run, on commit `0df4d09` (2026-09-28, the merged code of stories E4-S1 to E4-S3): 113 files, 1057 tests, 15.2 s while the live tier ran at the same time ([`evidence/tests/offline.txt`](evidence/tests/offline.txt)); alone, the tier takes about 7 s.
- **Live tier** (`DUSTIN_TESTNET=1 npm run test:testnet`): every file builds its own fixture accounts with fresh keys, so nothing is shared between runs and the builder's baseline fixture is never touched. The committed green run, on the same commit: 11 files, 58 tests, 301 s ([`evidence/tests/testnet.txt`](evidence/tests/testnet.txt)); the last run in the [testnet CI job](https://github.com/0xsimoneth/dustin/actions/runs/36424696971) passed 10 files and 51 tests in 321 s on `d0d711c`. `--reporter=verbose` shows every transaction hash the tests print.
- **A fixture by hand**, then its check against SOW Appendix B. There is no `fixture:build` script; the fixture commands are part of the CLI:

```bash
npm run build
node dist/cli/main.js fixture create --profile messy   # prints the account, the destination, the sponsor and the manifest path
node dist/cli/main.js fixture verify .fixture/<id>/manifest.json   # exit 0 when every check passes
```

`fixture create` writes the keys to `.fixture/<id>/keys.json` (mode 600, gitignored, testnet only) and the public manifest beside them; the recorded builds took seven transactions in consecutive ledgers. `fixture verify` exits 3 when a check fails, and stops with `RESET_SUSPECTED` (also 3) when the testnet was reset since the fixture was built. `dustin plan` and `dustin close` then run on that account like on any other ([docs/demo-video-script.md](docs/demo-video-script.md) walks through it).

The timings committed for 2026-09-28 are about 6 s for `npm run build`, about 7 s for the offline tier alone and 301 s for the live tier ([story E4-S3](docs/stories/4-3-test-evidence-reproducibility.md), [`evidence/tests/`](evidence/tests/README.md)); `npm ci` on a fresh machine has not been timed. Every row of the D3 matrix, with its tests and its last run, is in [docs/test-matrix.md](docs/test-matrix.md), and [evidence/tests/](evidence/tests/README.md) holds the complete output of both green runs with an image of each summary.

## Evidence

The evidence follows SOW section 6.1; the [evidence package](evidence/README.md) is the page to read first, with SOW 6.1, 6.2, Appendix A and Appendix B row by row. Explorer links stop resolving at the next testnet reset (scheduled for 2026-12-16); the JSON and XDR files committed under `evidence/` are the durable record.

| Deliverable | Evidence type (SOW 6.1) | Where |
|---|---|---|
| D1 `planClose()` | Public repo + CLI output | The committed dry-run plan of the messy fixture ([text](evidence/plan/fixture-plan.txt), [JSON](evidence/plan/fixture-plan.json)); `dustin plan` runs on any testnet account. |
| D2 Live close on testnet | Transaction hashes (links) + 60-second video | The metric close of 2026-09-28 through the [CLI](evidence/runs/20260928T112252Z-e3-cli/summary.md) and the [SDK](evidence/runs/20260928T112239Z-e3/summary.md): zero-spendable messy accounts, every transaction a sponsor-paid fee bump, the account gone (Horizon 404). Pending: the video (`<pending: builder records the 60-second video>`). |
| D3 Edge cases and tests | Test results screenshot + public repo + baseline recording | The [test matrix](docs/test-matrix.md) and the tests under `test/`; the complete output and an image of a green run of each tier in [evidence/tests/](evidence/tests/README.md); the [baseline protocol](evidence/baseline/README.md). Pending: the Demolisher recording (`<pending: builder records the baseline, matrix B-01 and B-02>`). |
| Documentation, demo and evidence | Public repo + write-up + 60-second video | The [write-up](docs/write-up.md), the [integration notes](docs/integration-notes.md) and the [evidence package](evidence/README.md). Pending: the video. |

## Configuration

| Variable | Used by | Read from |
|---|---|---|
| `DUSTIN_ACCOUNT_SECRET` | `dustin close --execute` only: the secret key of the account being closed | the environment, else `.env` in the working directory, else a hidden prompt on a terminal (not with `--json`) |
| `DUSTIN_SPONSOR_SECRET` | `dustin close --execute` only: the secret key of a funded testnet account that pays every fee | the same |
| `DUSTIN_HORIZON_URL` | every command: the Horizon to use (default `https://horizon-testnet.stellar.org`); it must serve the testnet | the environment only |
| `DUSTIN_EXPLORER_BASE` | every command: the base of explorer links (default `https://stellar.expert/explorer/testnet`) | the environment only |

## Status

| Sprint week | Dates | SOW expected output | State |
|---|---|---|---|
| Week 1 | 2026-09-22 to 2026-09-28 | Fixture built, Demolisher baseline recorded, `planClose()` dry run printed | Fixture built and dry run committed (`evidence/plan/`); the Demolisher baseline recording is pending (the builder's) |
| Week 2 | 2026-09-29 to 2026-10-05 | Zero-XLM account closed end to end with sponsored fees | Met early, on 2026-09-26 ([run](evidence/runs/20260926T125350Z/summary.md)) |
| Week 3 | 2026-10-06 to 2026-10-12 | Disposal ladder, sponsored unwind, sequence guard, test matrix, messy fixture closed | Met early, on 2026-09-28 ([test matrix](docs/test-matrix.md), [metric close](evidence/runs/20260928T112252Z-e3-cli/summary.md), [unclosable exit](evidence/runs/20260928T125414Z-edge-frozen/summary.md)); the close of the baseline fixture itself follows its recording |
| Week 4 | 2026-10-13 to 2026-10-19 | npm publish, 60-second demo, evidence package, write-up | Done early on 2026-09-28: the write-up, the integration notes and the evidence package; pending, the builder's: the npm publish and the video |

The deliverable tracker of SOW Appendix A, with its evidence links, is in the [evidence package](evidence/README.md#sow-appendix-a-the-deliverable-tracker).

## More

- [Integration notes](docs/integration-notes.md), for wallet developers.
- [Ordering rules and known limits](docs/write-up.md), the write-up.
- [Evidence package](evidence/README.md), for the chapter lead.
- [CHANGELOG](CHANGELOG.md) and [CONTRIBUTING](CONTRIBUTING.md).
- [Statement of Work](SUCCESSFUL_SOW.md): scope, success metric and evidence plan.
- [Planning documents and canonical decisions](docs/README.md).

## License

[MIT](LICENSE)
