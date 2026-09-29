# Contributing to Dustin

Thank you for helping. Dustin closes accounts, which cannot be undone, so the rules below are hard constraints, not preferences.

## Ground rules

- **Testnet only.** Never add mainnet configuration, a mainnet passphrase or a mainnet Horizon URL. The SDK refuses any network but `Test SDF Network ; September 2015`, and a change that weakens that check is not accepted.
- **The safety model is fixed** ([README](README.md#safety-model)): dry run by default; the merge is last and only after every pre-merge check; the account signs the inner transactions and the sponsor signs only the fee-bump envelopes; secrets never reach output, reports or `--json`; testnet only.
- **Never commit a secret.** `.env` and `.fixture/` are gitignored; `.env.example` is the template. `.env` holds secret keys, so make it readable only by you (`chmod 600 .env` after copying the template). Never pass a secret on the command line, and never paste an `S...` key into an issue, a test or a document. CI scans every file for seed-shaped strings.
- **English only**, in code, comments, commit messages and documents.
- **Evidence is history.** Files under `evidence/runs/` are records of live runs: add a new run directory, never edit an existing one.

## Set up and test

Node.js 22.12 or newer.

```bash
npm ci
npm run lint && npm run typecheck && npm run format:check
npm test                                  # offline tier: recorded Horizon JSON and a fake ledger, no network
DUSTIN_TESTNET=1 npm run test:testnet     # live tier: needs internet access, no secret
```

The live tier needs no key: every test file funds its own throwaway accounts from Friendbot. Every row of the D3 matrix and its tests are in [docs/test-matrix.md](docs/test-matrix.md); a change to the planner or the executor keeps that file current.

## Changes

- One pull request per story or review finding, with the tests that prove it. A bug fix starts with a test that fails.
- Commit subjects name the area and the change, as in the history: `Docs: ...`, `Evidence: ...`, or the story or review finding it closes.
- Amounts are BigInt stroops, never JavaScript numbers; the `changeTrust` limit is the string `"0"` ([canonical decision 9](docs/README.md)).
- Protocol claims in documents link to https://developers.stellar.org; other projects are cited by project name and URL, with no user or organisation handle in the prose ([canonical decision 15](docs/README.md)).
- Every planning document in `docs/` ends with `## Assumptions` and `## Sources` ([documentation plan](docs/documentation-plan.md), section 6); the README, the changelog, `docs/errors.md`, the story records and the evidence files follow their own formats.

## Reporting a problem

A security problem (a secret that leaks, a path to another network, a signature the sponsor should not make) is reported privately, never in a public issue: see [SECURITY.md](SECURITY.md).

For anything else, open an issue with the command you ran, the exit code, and the report (`--report <file>` or `--json`). Reports hold public keys, hashes and envelopes only; check once more that nothing in them looks like a secret key before you attach one.
