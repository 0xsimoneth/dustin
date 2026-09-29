# Story 0.4: Environment handling, testnet-only guard, redaction and README skeleton

Status: done

## Story

As a sponsor operator,
I want configuration read from environment variables with safe defaults, a hard testnet-only guard and a redaction helper,
so that my sponsor key is never logged and the tool cannot touch a network with real value.

## Acceptance Criteria

1. Given `.env.example`, then it documents `DUSTIN_ACCOUNT_SECRET`, `DUSTIN_SPONSOR_SECRET` (both empty), `DUSTIN_HORIZON_URL` (default `https://horizon-testnet.stellar.org`) and `DUSTIN_EXPLORER_BASE` (default `https://stellar.expert/explorer/testnet`), and `.env`, `.env.*` (except the example) and `.fixture/` are gitignored.
2. Given any network passphrase other than `Test SDF Network ; September 2015`, when `resolveConfig()` runs, then it throws `DustinError` with code `MAINNET_REFUSED` before any network call; `Networks.PUBLIC` is not referenced anywhere under `src/`.
3. Given a Horizon URL, when `verifyHorizonIsTestnet()` runs, then it reads `GET /` and throws `MAINNET_REFUSED` unless `network_passphrase` is the testnet passphrase.
4. Given a string or a JSON-serialisable value containing a Stellar secret seed (`S` followed by 55 base32 characters), when it passes through `redact()`, then every seed is replaced by `S...REDACTED`; `DustinError` messages and details are redacted on construction.
5. Given any CLI argument that looks like a secret seed, when the CLI starts, then it exits with code 2 and code `SECRET_IN_ARGV`, without echoing the value.
6. Then the README skeleton covers what Dustin does, the safety model (dry run by default, the sponsor pays every fee, secrets from the environment only, testnet only), what is not handled, and a status section.

## Tasks / Subtasks

- [x] Task 1: `DustinError` per ADR-0006 (AC: 2, 4)
- [x] Task 2: `redact()` (AC: 4)
- [x] Task 3: network config and testnet guard (AC: 2, 3)
- [x] Task 4: argv secret guard in the CLI (AC: 5)
- [x] Task 5: `.env.example`, `.gitignore`, README skeleton (AC: 1, 6)

## Dev Notes

- Canonical decision 4: secrets come from `DUSTIN_ACCOUNT_SECRET` and `DUSTIN_SPONSOR_SECRET`, a file or a hidden prompt, never from argv; decision 5: a secret on argv and a mainnet request are exit code 2.
- Architecture section 4.1: `assertTestnet()` on every public entry point; the Horizon URL may be overridden with `DUSTIN_HORIZON_URL`, but the passphrase check still applies.
- ADR-0006: `DustinError { code, stage, retryable, verdict, remedy, details }`; never carries secrets.
- The CLI loads `.env` with Node's built-in `process.loadEnvFile()` (no `dotenv` dependency); the SDK never reads the environment.
- The LICENSE file was created in E0-S1 so that the npm publish dry run was representative.

### References

- docs/epics-and-stories.md, Story 0.4
- docs/architecture.md sections 4.1 and 11
- docs/adr/ADR-0006-error-taxonomy.md
- docs/documentation-plan.md section 1

## Dev Agent Record

### Agent Model Used

dev-story workflow (AI developer agent)

### Implementation Plan

- `src/errors/redact.ts`: one seed pattern, `(?<![A-Z2-7])S[A-Z2-7]{55}(?![A-Z2-7])`, used both to redact and to detect. The lookarounds keep public keys, muxed addresses and longer base32 runs intact; seed-shaped strings with a bad checksum are still redacted.
- `src/errors/dustin-error.ts`: the ADR-0006 shape (`code`, `stage`, `retryable`, `verdict`, `remedy`, `details`, `horizon`); message, remedy, details, horizon fields and the cause are redacted in the constructor, and `toJSON()` exposes only public fields.
- `src/config/network.ts`: `resolveConfig()` (no I/O) refuses any passphrase but testnet and validates URLs; `verifyHorizonIsTestnet()` reads `GET /` and refuses a Horizon that serves another network; `configFromEnv()` reads only `DUSTIN_HORIZON_URL` and `DUSTIN_EXPLORER_BASE`.
- `src/cli/run.ts`: a testable CLI core returning the exit code. Secret-looking arguments are refused before parsing; commander usage errors map to exit 2; a global `--network` option refuses anything but `testnet`. `src/cli/exit-codes.ts` holds the decision-5 table.
- `src/cli/env.ts`: `.env` is loaded with `process.loadEnvFile()` by the CLI only.

### Debug Log References

- Red: the four new test files failed on missing modules; green after implementation.
- `@typescript-eslint/unbound-method` flagged the method signatures of `CliIo` passed to commander; changed to function-typed properties.
- Commander settings (`exitOverride`, `configureOutput`) are applied before subcommands are created so that they inherit them.

### Completion Notes List

- AC1: `.env.example` documents the four variables; `git check-ignore` confirms `.env`, `.env.local` and `.fixture/keys.json` are ignored and `.env.example` is tracked.
- AC2: `resolveConfig()` throws `MAINNET_REFUSED` for the public, futurenet and arbitrary passphrases with no `fetch` call; a static test asserts `src/` never mentions the public network constant, passphrase or Horizon host.
- AC3: `verifyHorizonIsTestnet()` passes for the testnet passphrase, throws `MAINNET_REFUSED` for another network and a retryable `HORIZON_UNAVAILABLE` when Horizon is unreachable or answers an error status.
- AC4: `redact()`/`redactValue()` and `DustinError` redaction are covered by unit tests, including a real `Keypair.random().secret()`.
- AC5: `dustin close X --to S...` exits 2 with `SECRET_IN_ARGV` and does not echo the value (also covered for `--memo=S...`); `--network public` exits 2 with `MAINNET_REFUSED`; a missing argument exits 2.
- AC6: README skeleton per docs/documentation-plan.md section 1 (what and why, safety model, what is not handled, exit codes, status). The CI badge is added in E0-S3; the npm badge after the first publish.
- 27 unit tests pass; lint, format check, typecheck and the package check pass.

### File List

- `src/errors/redact.ts` (new)
- `src/errors/dustin-error.ts` (modified)
- `src/config/network.ts` (new)
- `src/cli/exit-codes.ts` (new)
- `src/cli/run.ts` (new)
- `src/cli/env.ts` (new)
- `src/cli/program.ts` (modified)
- `src/cli/main.ts` (modified)
- `src/index.ts` (modified)
- `test/unit/errors/redact.test.ts` (new)
- `test/unit/errors/dustin-error.test.ts` (new)
- `test/unit/config/network.test.ts` (new)
- `test/unit/config/no-mainnet.test.ts` (new)
- `test/unit/cli/run.test.ts` (new)
- `test/unit/smoke.test.ts` (modified)
- `.env.example` (new)
- `.gitignore` (modified: `.fixture/`)
- `README.md` (modified)
- `docs/stories/0-4-env-testnet-guard-license.md`, `docs/stories/sprint-status.yaml` (modified)

## Senior Developer Review (AI)

- Date: 2026-09-26
- Scope: commits aacd0d9..97bc569, adversarial review plus an edge-case walk by an independent review agent (read-only).
- Outcome: changes requested, all resolved in the follow-up commit.

### Action Items

- [x] Medium: a seed glued to a base32 character bypassed the argv guard and commander then echoed it. Detection now also flags any window with a valid StrKey seed checksum, and commander output passes through `redact()`.
- [x] Medium: `redact()` missed seeds in URL-encoded or adjacent contexts; fixed by the same checksum window rule.
- [x] Medium: object and array causes were kept unredacted, cyclic details threw, and a DustinError cause lost its code. Causes now go through `redactValue()` with a cycle guard, and a DustinError cause is kept as is.
- [x] Medium: `verifyHorizonIsTestnet` threw raw errors on a non-JSON or null body, had no timeout and treated 4xx as retryable. It now uses a 15 s timeout, maps 4xx and non-Horizon answers to a non-retryable `CONFIG_INVALID`, and keeps `HORIZON_UNAVAILABLE` for network errors, 429 and 5xx. The Horizon JSON client got a 30 s timeout and non-JSON handling too.
- [x] Low: URLs with credentials, a query or a fragment are now refused; `resolveConfig` documents that the Horizon network itself is checked by `verifyHorizonIsTestnet`, which `fixture verify` now also runs.
- [x] Low: an unreadable `.env` crashed the CLI; it now exits 2 with `CONFIG_INVALID`.
- [x] Low: `HORIZON_UNAVAILABLE` now maps to exit 6 only before submission (stages config, inspect, plan, build) and to 5 afterwards.
- [x] Low: `plan` gained `--memo` (SEP-29 detection needs it while planning) and `--destination` now conflicts with `--to`.
- [x] Low: the static no-mainnet test now rejects any `PUBLIC` identifier in `src/`.

## Change Log

- 2026-09-26: Error taxonomy base, redaction, testnet guard, argv secret guard, exit codes, `.env.example` and README skeleton. LICENSE was delivered in E0-S1. Status: done.
- 2026-09-26: Review findings resolved. Status: done.
