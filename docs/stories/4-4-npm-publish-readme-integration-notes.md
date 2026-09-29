# Story 4.4: npm publish, README and integration notes

Status: in-progress

## Story

As a wallet developer,
I want to `npm install` Dustin and follow integration notes,
so that I can offer account closure to my users without sending them to a web form.

## Acceptance Criteria

As written in `docs/epics-and-stories.md` (Story 4.4):

1. AC-E4-S4-1: Then version 0.1.0 is published to the npm registry under the name recorded in the README, and `npm install <package>` in an empty directory followed by the README's 10-line example runs `planClose` against the fixture.
   - **Pending: human action by the builder.** The package is `stellar-dustin` (canonical decision 2), version 0.1.0 prepared; `npm login` and `npm publish` with 2FA are the builder's. Until then the README and the integration notes give the from-source path (clone, `npm ci`, `npm run build`, `node dist/cli/main.js`; for the SDK, a tarball from `npm pack`). The check in an empty directory follows the publish.
2. AC-E4-S4-2: Then the README covers: what it does, install, CLI usage, SDK usage, safety model (dry run by default, sponsor pays, testnet only), status and evidence links, license.
   - **Met.** `README.md` follows `docs/documentation-plan.md` section 1: what and why in three sentences, the gap in one line, a status line (0.1.0 prepared, the npm publish pending), the demo slot (a placeholder until the video) with the recorded CLI close to check in the meantime, install from source and from npm, the CLI and SDK quick starts with the exported names, the safety model, the exit codes of canonical decision 5, what is not handled (the SOW's out-of-scope list verbatim, then the protocol limits), "Run the tests yourself", the evidence table mirroring SOW 6.1, configuration, status, and the footer links (integration notes, write-up, evidence package, CHANGELOG, CONTRIBUTING, SOW, license). `npx dustin` is not offered: the bare npm name belongs to an unrelated package, so the README gives `npx stellar-dustin` and warns about `npx dustin`.
3. AC-E4-S4-3: Then `docs/integration-notes.md` explains the wallet flow: call `planClose`, show the plan, collect the user's signature through the signer callback, call `executeClose` with the wallet's sponsor, and how to fund and protect the sponsor.
   - **Met.** `docs/integration-notes.md` follows the documentation plan's section 2: install and runtime (Node 22.12 or newer, ESM and CommonJS, types); the flow `planClose` → render → confirm → `executeClose` with a Mermaid sequence diagram of the two signers; the options, the plan and the report; the events with their NDJSON form; drift, partial closes and continuing a stopped run; the three classes of errors with the `DustinError` codes and a link to `docs/errors.md`; the `UnclosableCode` and `BlockerCode` lists as exported in `src/plan/model.ts`, each with its meaning and remedy; the sponsor's funding, per-close budget and protection; testnet only; an integration checklist; the CLI as a reference integration.
4. AC-E4-S4-4: Then the package tarball contains no tests, evidence or fixture keys (`npm pack --dry-run` checked).
   - **Pending: checked with the 0.1.0 release.** `package.json` publishes `dist` only (`files`), and the `postpack` step runs `scripts/check-package.mjs`; the dry run on the released version is part of the publish, not of this documentation record.

Also written for this story: `CONTRIBUTING.md` (one screen, `docs/documentation-plan.md` section 5).

## Tasks / Subtasks

- [x] Task 1: README final (AC-2)
- [x] Task 2: integration notes final (AC-3)
- [x] Task 3: CONTRIBUTING.md
- [ ] Task 4: npm publish of 0.1.0 (AC-1) — human action by the builder
- [ ] Task 5: `npm pack --dry-run` on the released version (AC-4) — with the release
- [x] Task 6 (reconcile pass, after the merge of main at `ed0ab62`): check the statements that depend on stories E4-S1 to E4-S3 (the non-interactive `--json` and its NDJSON, the interruption and `ExecuteOptions.signal`, the hidden prompt, `--verbose`, the 404 on a re-run, the report's operation summaries and links, `docs/errors.md` and the two JSON schemas, the claimant warning, `evidence/tests/`) against the merged code

## Dev Notes

- The names in the quick starts and the tables are those exported by `src/index.ts` and defined in `src/plan/model.ts`, `src/execute/report.ts`, `src/execute/events.ts` and `src/errors/dustin-error.ts` (PRD section 7, decision D-2).
- The exit-code table follows `src/cli/exit-codes.ts` and canonical decision 5 as widened by PRD decision D-6.
- "Run the tests yourself" quotes only committed runs and timings: the green runs of `evidence/tests/` on `0df4d09` (offline 113 files and 1057 tests, 15.2 s while the live tier ran, about 7 s alone; live 11 files and 58 tests in 301 s) and `npm run build` at about 6 s (story E4-S3). `npm ci` on a fresh machine is not timed in the repository, so the section claims no total and no "under 15 minutes" (AC-E4-S3-2 is story E4-S3's criterion). It says that no `.env` is needed and that there is no `fixture:build` script.
- Third-party work is cited by project name and URL (canonical decision 15); the SDK package name appears in code and install lines only.

### References

- docs/epics-and-stories.md, Story 4.4; docs/prd.md FR-26, FR-30
- docs/documentation-plan.md sections 1, 2 and 5; docs/README.md canonical decisions 2, 4, 5, 15

## Dev Agent Record

### Completion Notes List

- 2026-09-28: README, integration notes and CONTRIBUTING written. Placeholders left for the builder: the video link, the npm publish.

### File List

- `README.md`, `docs/integration-notes.md` (rewritten)
- `CONTRIBUTING.md`, `docs/stories/4-4-npm-publish-readme-integration-notes.md` (new)

## Change Log

- 2026-09-28: README, integration notes and CONTRIBUTING final for 0.1.0. Status: in-progress (AC-1 waits for the builder's publish, AC-4 for the release).
- 2026-09-28: reconciled with stories E4-S1 to E4-S3 as merged: machine mode and its NDJSON lines, `--verbose` as a global option, no colour, the hidden prompt's conditions, the signals and `INTERRUPTED`, the 404 on a re-run, the report's `horizonUrl`, `operations` and `links`, `remedyOf`, the claimant warning, `RESET_SUSPECTED`, and the committed test runs. Status unchanged.
