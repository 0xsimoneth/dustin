# Story 0.2: Lint, format and test runner

Status: done

## Story

As a contributor,
I want lint, formatting and a test runner wired to npm scripts,
so that every change is checked the same way locally and in CI.

## Acceptance Criteria

1. Given the repository, when `npm run lint` and `npm run format:check` run, then both pass on a clean tree, and an intentionally unused variable fails `npm run lint`.
2. Given the `vitest` configuration, when `npm test` runs, then only the offline `unit` project (`test/unit/**`) executes, and any attempt to use the network (`fetch`) inside a unit test throws.
3. Given `DUSTIN_TESTNET=1`, when `npm run test:testnet` runs, then `test/testnet/**` executes with a 120 s test timeout; without the variable those files are skipped and the reason is printed.
4. When `npm run coverage` runs, then a text and an lcov report are produced.
5. A unit smoke test covers the CLI program (help text lists `plan` and `close`) and the SDK stubs (`NOT_IMPLEMENTED`).

## Tasks / Subtasks

- [x] Task 1: ESLint flat config with `typescript-eslint` and Prettier (AC: 1)
  - [x] `eslint.config.js`, `.prettierrc.json`, `.prettierignore`
  - [x] scripts `lint`, `format`, `format:check`
- [x] Task 2: vitest projects (AC: 2, 3, 4)
  - [x] `vitest.config.ts` with projects `unit` and `testnet`
  - [x] `test/setup/no-network.ts` for the unit project
  - [x] `test/testnet/gate.ts` (`describeTestnet`) and `test/setup/testnet-gate.ts` (global setup that prints the skip reason); first live test `test/testnet/horizon.test.ts`
  - [x] scripts `test`, `test:testnet`, `coverage`
- [x] Task 3: smoke tests (AC: 5)
  - [x] `test/unit/smoke.test.ts`

## Dev Notes

- ADR-0005: offline unit tests on recorded Horizon JSON run on every commit; the testnet tier is gated by `DUSTIN_TESTNET=1` and builds a fresh fixture per run.
- Versions from the npm registry on 2026-09-26: `vitest` 5.0.2 and `@vitest/coverage-v8` 5.0.2 (engines `^22.12.0 || ^24.0.0 || >=26.0.0`), `eslint` 10.11.0 with `@eslint/js` 10.0.1, `typescript-eslint` 8.70.1 (peer range excludes TypeScript 6+, one reason TypeScript stays on 5.9), `prettier` 3.9.9.
- The module-boundary lint rule for the read-only zone (architecture section 6.3) is added in E1-S6 when the planner exists.

### References

- docs/epics-and-stories.md, Story 0.2
- docs/adr/ADR-0005-testing-strategy.md

## Dev Agent Record

### Agent Model Used

dev-story workflow (AI developer agent)

### Implementation Plan

- ESLint 10 flat config with `typescript-eslint` `recommendedTypeChecked` (type-aware rules such as `no-floating-promises` matter for the executor) and `disableTypeChecked` for plain JavaScript files. Tooling folders that are gitignored (`stellar-build/`, `.stellar-build/`) and the recorded spike script are ignored.
- Prettier with `printWidth` 100; Markdown and `docs/` are excluded so planning documents are never reformatted.
- vitest projects `unit` (offline, `test/setup/no-network.ts` replaces the global `fetch`, which the SDK's Horizon client uses: `lib/esm/http-client/fetch-client.js`) and `testnet` (120 s timeouts, runs only with `DUSTIN_TESTNET=1`).

### Debug Log References

- Red: the two isolation tests failed before `no-network.ts` existed (the real `fetch` and a real `Horizon.Server.feeStats()` call succeeded); green after the stub.
- A module-level log in a skipped test file is not printed by vitest; the skip reason moved to a `globalSetup` that runs in the main process.
- `declaration: true` in `tsconfig.json` made `tsc --noEmit` demand nameable types for test helpers (TS4023); removed, since tsup generates the declarations.

### Completion Notes List

- AC1: `npm run lint` and `npm run format:check` pass; a probe file with an unused `const` failed `eslint` with exit code 1 (probe deleted).
- AC2: `npm test` runs only `test/unit/**`; `fetch(...)` and `Horizon.Server#feeStats()` reject with "network access is not allowed in unit tests".
- AC3: `npm run test:testnet` without the variable prints "testnet tier skipped: set DUSTIN_TESTNET=1 ..." and skips; with `DUSTIN_TESTNET=1` the live Horizon passphrase test passes.
- AC4: `npm run coverage` writes the text summary and `coverage/lcov.info`.
- AC5: smoke tests cover the CLI help and both SDK stubs.

### File List

- `eslint.config.js` (new)
- `.prettierrc.json` (new)
- `.prettierignore` (new)
- `vitest.config.ts` (new)
- `test/setup/no-network.ts` (new)
- `test/setup/testnet-gate.ts` (new)
- `test/testnet/gate.ts` (new)
- `test/testnet/horizon.test.ts` (new)
- `test/unit/smoke.test.ts` (new)
- `package.json` (modified: scripts, dev dependencies)
- `package-lock.json` (modified)
- `tsconfig.json` (modified: `declaration` removed, Prettier formatting)
- `scripts/check-package.mjs`, `src/cli/program.ts` (modified: Prettier formatting only)
- `docs/stories/0-2-lint-format-test-runner.md`, `docs/stories/sprint-status.yaml` (modified)

## Senior Developer Review (AI)

- Date: 2026-09-26
- Scope: commits aacd0d9..97bc569, adversarial review plus an edge-case walk by an independent review agent (read-only).
- Outcome: changes requested, all resolved in the follow-up commit.

### Action Items

- [x] Medium: `vi.unstubAllGlobals()` in one test restored the real `fetch` for the rest of the file (a probe test reached the network). The no-network stub is now re-applied before every test, `network.test.ts` uses `vi.spyOn(...).mockRestore()`, and `test/unit/setup-isolation.test.ts` guards the regression.

## Change Log

- 2026-09-26: ESLint, Prettier and the two vitest tiers with network isolation and a visible testnet skip reason. Status: done.
- 2026-09-26: Review findings resolved. Status: done.
