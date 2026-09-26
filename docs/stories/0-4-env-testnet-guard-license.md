# Story 0.4: Environment handling, testnet-only guard, redaction and README skeleton

Status: ready-for-dev

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

- [ ] Task 1: `DustinError` per ADR-0006 (AC: 2, 4)
- [ ] Task 2: `redact()` (AC: 4)
- [ ] Task 3: network config and testnet guard (AC: 2, 3)
- [ ] Task 4: argv secret guard in the CLI (AC: 5)
- [ ] Task 5: `.env.example`, `.gitignore`, README skeleton (AC: 1, 6)

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

### Debug Log References

### Completion Notes List

### File List

## Change Log
