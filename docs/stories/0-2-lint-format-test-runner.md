# Story 0.2: Lint, format and test runner

Status: ready-for-dev

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

- [ ] Task 1: ESLint flat config with `typescript-eslint` and Prettier (AC: 1)
  - [ ] `eslint.config.js`, `.prettierrc.json`, `.prettierignore`
  - [ ] scripts `lint`, `format`, `format:check`
- [ ] Task 2: vitest projects (AC: 2, 3, 4)
  - [ ] `vitest.config.ts` with projects `unit` and `testnet`
  - [ ] `test/setup/no-network.ts` for the unit project
  - [ ] `test/testnet/_gate.test.ts` that reports the skip reason
  - [ ] scripts `test`, `test:testnet`, `coverage`
- [ ] Task 3: smoke tests (AC: 5)
  - [ ] `test/unit/smoke.test.ts`

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

### Debug Log References

### Completion Notes List

### File List

## Change Log
