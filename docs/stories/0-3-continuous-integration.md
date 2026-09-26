# Story 0.3: Continuous integration with a gated testnet job

Status: ready-for-dev

## Story

As a reviewer,
I want CI to prove that lint, typecheck, build and unit tests pass on every push, and to let the builder run the testnet suite on demand,
so that the repository state I am asked to trust is checked by a machine.

## Acceptance Criteria

1. Given `.github/workflows/ci.yml`, when a push or pull request lands, then install, lint, format check, typecheck, build, unit tests and the package check run on Node 22 and Node 24, and any failure fails the job.
2. Given `.github/workflows/testnet.yml`, when dispatched manually, then it runs `npm run test:testnet` with `DUSTIN_TESTNET=1`; it never runs on push, and it needs no repository secret because the testnet tier funds its own throwaway accounts from Friendbot.
3. Then the README shows the CI status badge.
4. Then no workflow references a secret, and the workflows request read-only repository permissions.

## Tasks / Subtasks

- [ ] Task 1: `ci.yml` (AC: 1, 4)
- [ ] Task 2: `testnet.yml` (AC: 2, 4)
- [ ] Task 3: README badge (AC: 3)

## Dev Notes

- The testnet tier creates a fresh sponsor from Friendbot per run (ADR-0005, "Fresh fixture per run"), so there is no sponsor key to protect in CI. This supersedes the repository-secret wording in docs/epics-and-stories.md AC-E0-S3-2.
- Action versions are checked against the GitHub releases API when the workflow is written.

### References

- docs/epics-and-stories.md, Story 0.3
- docs/adr/ADR-0005-testing-strategy.md

## Dev Agent Record

### Agent Model Used

dev-story workflow (AI developer agent)

### Implementation Plan

### Debug Log References

### Completion Notes List

### File List

## Change Log
