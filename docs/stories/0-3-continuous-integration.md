# Story 0.3: Continuous integration with a gated testnet job

Status: review

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

- [x] Task 1: `ci.yml` (AC: 1, 4)
- [x] Task 2: `testnet.yml` (AC: 2, 4)
- [x] Task 3: README badge (AC: 3)

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

- `ci.yml`: push and pull request, Node 22 and 24 matrix, `npm ci`, lint, format check, typecheck, build, unit tests, the package check, and `npm audit --omit=dev --audit-level=high` on runtime dependencies. `permissions: contents: read`.
- `testnet.yml`: `workflow_dispatch` only, Node 24, `DUSTIN_TESTNET=1 npm run test:testnet`, one run at a time (`concurrency: testnet`), 30-minute timeout, no secrets.
- Action versions from the GitHub releases API on 2026-09-26: `actions/checkout` v7.0.1, `actions/setup-node` v7.0.0.

### Debug Log References

- The workflow command sequence was run in a fresh `git clone` of the repository (no untracked files): every step passed, and the testnet tier passed with `DUSTIN_TESTNET=1`.

### Completion Notes List

- AC1: the workflow and its command sequence are in place and pass locally from a fresh clone; the first GitHub-hosted run happens on the next push.
- AC2: the testnet job only has a `workflow_dispatch` trigger and references no secret.
- AC3: README shows the CI badge.
- AC4: `grep secrets.` over `.github/` finds nothing; both workflows set `permissions: contents: read`.

### File List

- `.github/workflows/ci.yml` (new)
- `.github/workflows/testnet.yml` (new)
- `README.md` (modified: CI badge)
- `docs/stories/0-3-continuous-integration.md`, `docs/stories/sprint-status.yaml` (modified)

## Change Log

- 2026-09-26: CI workflow for the offline tier and a manual testnet workflow without secrets. Status: review (first GitHub-hosted run pending the next push).
