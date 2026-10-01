# Story 5.1: Plan-only web demo (post-sprint, outside the SOW)

Status: done

## Story

As the builder,
I want a simple one-page web demo that plans the close of a testnet account in the browser with the SDK's read-only planner, to be improved later,
so that someone without a terminal can see what `planClose()` says about an account, without the page ever touching a secret.

Post-sprint addition on 2026-10-01, outside the Instaward scope (`docs/README.md`, canonical decision 1; ADR-0007; `docs/web-demo.md`). It changes no deliverable and no evidence. The builder's scope change of the same day, received before any deployment work: local only, nothing hosted, GitHub Pages a possible later step.

## Acceptance Criteria

1. AC-E5-S1-1: **Then** the SDK entry (`stellar-dustin`) runs in a browser bundle: no `node:` import and no `Buffer` reachable from `dist/index.js` or `dist/index.cjs`; `sha256Hex` uses the Stellar SDK's `hash()`; every plan hash and snapshot hash is unchanged; a guard script fails CI when the built entry or a chunk it imports reaches a Node-only API.
   - **Met.** `src/bytes.ts` (`toHex`, `utf8ByteLength`, `base64ToUtf8`) replaces the seven `Buffer` uses of the SDK zone; `src/canonical-json.ts` takes its digest from `hash()` (js-stellar-sdk 17.1.0 `src/base/hashing.ts`: sha256 from `@noble/hashes`, a `Uint8Array`). `base64ToUtf8` reads a value as `Buffer.from(value, "base64")` did (review S1), so the SEP-29 `config.memo_required` check reads a malformed value as every Node client does. The SDK's own ESM build has no `node:` import and no `Buffer` outside its CLI folder, so no polyfill is needed. `scripts/check-browser-safe.mjs` parses each built file with the TypeScript compiler, follows the local imports of both entries (4 files on the current build) and fails on a `node:` module, a bare built-in, an underscore internal, or a use of the `Buffer`, `process`, `__dirname` and `__filename` globals, bare or through `globalThis`, `window`, `self` or `global`; a string, a comment, a declared local or a `typeof` guard is never a finding (review S3); exit 2 before a build. The CLI and `stellar-dustin/testing` keep Node's APIs. `test/unit/canonical-json.test.ts` pins the recorded fixture's `snapshotHash` and `planHash` of the committed dry-run snapshot.
2. AC-E5-S1-2: **Then** `web/` is a separate Vite + TypeScript project with no UI framework and small modules, depending on the SDK through a Vite alias to the repository's built entry, with the choice documented and `npm ci` working in CI.
   - **Met.** `web/vite.config.ts` aliases `stellar-dustin` to `../dist/index.js` and refuses to start without it, naming the root build to run first (review W6); `web/tsconfig.json` maps the types to `../dist/index.d.ts`; why not a `file:` dependency is in `docs/web-demo.md` ("Architecture") and ADR-0007. `web/package-lock.json` is committed; the CI job runs `npm ci` in `web/`.
3. AC-E5-S1-3: **Then** the page has the testnet banner; the sentence "This page only plans. It never asks for a secret key; closing happens in your terminal or your own code."; the inputs (account; destination optional, with what happens without it; sponsor optional, with what it is for; `--partial` and `--prefer-destination` as checkboxes mapped to `allowPartial` and `preferDestination`); a "Load the example account" button with the baseline fixture's public addresses; and a "Plan" button that calls the SDK planner against Horizon from the browser and renders the status in words, balance, minimum and spendable, the recovered XLM and the reserves returned to sponsors, the fee bid and budget, the ordered steps (transaction, action, why) mirroring the CLI, blockers and unclosable items with reasons and remedies, explorer links for the account, the destination and the issuers, a plan JSON toggle, and errors in plain words.
   - **Met.** `web/index.html`, `web/src/*`. The steps use the CLI's own words through the new exports `stepAction()` and `subjectLabel()`; the status sentences are the CLI's. Without a destination the page inspects the account and plans from the snapshot (`inspectAccount()` and `planFromSnapshot()`): BLOCKED with `DESTINATION_MISSING`, the cleanup listed, and the note under the status says that the CLI needs `--to` and nothing runs until a destination is given; for any other blocker the note promises no step, since `--partial` clears no blocker (review W1). A second toggle shows the plan as the CLI prints it (`renderPlan()`). The sponsor and the explorer links also cover the fee sponsor; a link is built only for a G... or M... address with a valid checksum, and a muxed destination links the base account it wraps (review W3). A changed input marks the plan stale until the next one (review W4); a slow Horizon is named in plain words after three seconds (review W10). The "Recovered" row says that nothing arrives when the plan does not merge (review W5).
4. AC-E5-S1-4: **Then** a "Run it yourself" box gives the exact `npx stellar-dustin plan ...` and `close --execute` commands, the secrets named by their environment variables and never valued, with a copy button and links to the README and the integration notes.
   - **Met.** `web/src/commands.ts`; only a valid Stellar address (StrKey checksum included, review W2) is written into a command, anything else becomes a placeholder, and `--partial` appears only in the close command, where it belongs. The two copy buttons are named "Copy the plan command" and "Copy the close command" for assistive technology (review W5). `web/test/parity.test.ts` checks every flag the box prints against the CLI's `--help` (review W10).
5. AC-E5-S1-5: **Then** the page is accessible (labels, keyboard, status as text), works at phone width, loads no external script or font, has no analytics, and ends with the footer "Post-sprint demo, outside the Instaward scope; testnet only; MIT" with the repository link.
   - **Met.** Every input has a `<label>`; the status region is `role="status"` with `aria-live="polite"`, an error `role="alert"`; the form submits with Enter and focus moves to the plan's heading; the phone project of the Playwright suite asserts no horizontal overflow (under 40rem the steps table stacks its cells, and reasons that carry whole addresses break with `overflow-wrap: anywhere`); system fonts only; no script but the page's own. A Content-Security-Policy meta tag restricts scripts, styles and images to the page's origin and connections to it and the testnet Horizon (review W9; `docs/web-demo.md`, "Security stance").
6. AC-E5-S1-6: **Then** Vitest unit tests cover the page's plan-to-view mapping; a Playwright smoke test serves the built page, intercepts Horizon with the recorded fixtures of `test/fixtures/horizon/messy`, fills the example and asserts the rendered status, the step count, and that no element is `type="password"` or asks for a secret; the live manual check against the real baseline account was made once from the builder's machine (planning only); the web build reaches no `node:` module.
   - **Met.** `web/test/` (4 files, 33 tests: the view, the commands, the plan call and the error words, and the parity with the CLI: the page's plan for the recorded fixture equals `dustin plan --json`'s, hash `25be835c...8c85` and document, review W10). `web/e2e/plan.spec.ts` (9 tests on a desktop project and a phone project, 18 runs): the example's plan (CLOSABLE, 12 steps, 3 transactions, the figures, the four explorer links, both toggles, the two commands and their named copy buttons, the policy's meta tag and no console message naming it); no password field and no control whose type, name, id, placeholder, label or autocomplete says secret, seed, private, mnemonic, passphrase or password; no asset from another origin; every Horizon request a GET and no request to any other host; a malformed address answered without a request; a missing account (BLOCKED, the 404 explained); no destination (11 steps, no merge, `DESTINATION_MISSING`); an unreachable Horizon (the slow-Horizon words, then the error after the SDK's retries); no horizontal overflow; keyboard submission with focus on the result; the stale mark when an input changes. The web build reaches no `node:` module and no Node global: `npm run check:bundle` in `web/` runs `scripts/check-browser-safe.mjs` over `dist/assets/*.js` in the CI web job right after the build (review S4); on the current build, 193.8 kB (55.9 kB gzipped), it finds nothing. A dated manual observation, not reproduced by any test or CI job: the live check of 2026-10-01 through the built page with no interception gave CLOSABLE, 12 steps, 3 transactions, 12 GET requests to Horizon and none elsewhere, 1.9 s, ledger 4,967,599, plan hash `25be835c...8c85`, the recorded fixture's own; the Vite dev server was driven the same way with the fixtures (no console error).
7. AC-E5-S1-7: **Then** the documents name it a post-sprint addition outside the SOW: `docs/web-demo.md`, ADR-0007, a README section, a CHANGELOG `[Unreleased]` entry, a note under canonical decision 1, this story, `sprint-status.yaml` (Epic 5), the progress log; root CI builds and tests `web/` in a new job, the existing jobs unchanged.
   - **Met.** The File List names each; the `web` job runs beside the unchanged `offline` matrix, builds the page once, scans its bundle, runs the unit tests and the Playwright suite, and keeps the Playwright report and traces of a failed run as an artifact; its browser install step is bounded to ten minutes (review W7).
8. AC-E5-S1-8: **Then** nothing is deployed: no Pages workflow, no hosting, no live URL; the documents describe a local demo and list GitHub Pages only as a possible later step.
   - **Met.** The scope change arrived before any workflow was written, so there was nothing to remove: `.github/workflows/` holds the CI workflow and the testnet job only, neither deploys or publishes anything, and `docs/web-demo.md` ("Deployment") lists GitHub Pages as possible, not planned.

| AC | Tests |
|---|---|
| 1 | `test/unit/bytes.test.ts`, `test/unit/canonical-json.test.ts`, `test/unit/plan/e5-review-plan-options.test.ts`, `test/unit/scripts/check-browser-safe.test.ts`; `node scripts/check-browser-safe.mjs` in the CI `web` job |
| 2 | the CI `web` job: `npm ci`, `npm run lint`, `npm run typecheck`, `npm run build` in `web/` |
| 3, 4, 5 | `web/test/view.test.ts`, `web/test/commands.test.ts`, `web/test/plan.test.ts`, `web/test/parity.test.ts`; `web/e2e/plan.spec.ts` |
| 6 | the same, `npm run check:bundle` in the CI `web` job, and the dated live check recorded above |
| 7, 8 | a reading of the documents; the two workflows under `.github/workflows/` |

## Tasks / Subtasks

- [x] Task 1: the SDK entry browser-safe: `src/bytes.ts`, `src/canonical-json.ts`, the seven `Buffer` sites, the guard script with its test, the two render exports
- [x] Task 2: the `web/` project: the Vite, TypeScript, ESLint and Playwright configuration, the alias to the root build, the page and its modules, the root ignores
- [x] Task 3: the unit tests, the Playwright smoke test, the dev-server check and the live check
- [x] Task 4: the CI job
- [x] Task 5: the documents, the tracker and the progress log
- [x] Task 6: the quality gate: the review of the diff by the code-review layers, the fixes with a failing test first, the record in `docs/reviews/2026-10-01-e5-web-demo-review.md` and the Review section below

## Dev Notes

- `planClose()` validates the sponsor; `planFromSnapshot()` does not, so the no-destination path of `web/src/plan.ts` applies the same two rules (a G address with a valid StrKey checksum, not the account) before reading anything (`web/src/address.ts`).
- `--partial` is an execute-time option (`allowPartial`), so the checkbox changes only the note under the status (what the close would do, with the exit code of canonical decision 5) and the close command. The note never promises a step while a blocker holds, and says that the CLI needs `--to` when the destination is missing (review W1).
- `web/package.json` names exact versions for the toolchain (Vite 8.3.2, Vitest 5.0.3, Playwright 1.63.0, and the root's TypeScript 5.9.3, ESLint 10.11.0, typescript-eslint 8.70.1 and `@eslint/js` 10.0.1) and a caret range for `@types/node`; `web/package-lock.json` pins the tree `npm ci` installs. The web project's ESLint forbids the `Buffer` and `process` globals in `src/**/*.ts`, and `innerHTML`, `outerHTML` and `insertAdjacentHTML` in every TypeScript file of the project, tests included.
- The Content-Security-Policy is a meta tag in `web/index.html`, strict for the built page; `web/vite.config.ts` adds `'unsafe-inline'` to `style-src` for the dev server alone, which injects styles inline (review W9).
- Horizon's CORS answer of 2026-10-01 is in `docs/web-demo.md` as a dated manual observation; the Horizon source paths of `stellar/go` the docs once pointed at have moved, so the dated probe is the evidence.
- Traps: Playwright's `toHaveText` with a regular expression keeps the line breaks the HTML wraps across (`toContainText` with a string normalises them); `getByLabel("Destination")` also matched the `--prefer-destination` checkbox; a table sizes its columns to the longest unbreakable word, so whole 56-character addresses in the reasons widened the page by 193 px at phone width until the cells got `overflow-wrap: anywhere` and the table stacked; a synchronous `spawnSync` of the CLI inside a Vitest worker blocks the replay server that lives in the same process, so the parity test runs the CLI asynchronously.

### References

- `docs/README.md` canonical decisions 1, 4, 5, 7, 8, 14 and 15; `docs/ux-design.md` section 5 (the stretch idea this replaces) and principle P6; `docs/architecture.md` section 12; ADR-0001, ADR-0002, ADR-0003, ADR-0007; `docs/web-demo.md`; `docs/reviews/2026-10-01-e5-web-demo-review.md`.
- js-stellar-sdk 17.1.0 `src/base/hashing.ts`: https://github.com/stellar/js-stellar-sdk/blob/v17.1.0/src/base/hashing.ts
- Node's base64 decoder, which `base64ToUtf8` mirrors: https://github.com/nodejs/node/blob/v24.x/src/base64-inl.h
- Horizon rate limiting: https://developers.stellar.org/docs/data/apis/horizon/api-reference/structure/rate-limiting
- Content-Security-Policy: https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Content-Security-Policy

## Review

The quality gate of 2026-10-01, recorded in full in `docs/reviews/2026-10-01-e5-web-demo-review.md` (the triage of the first pass's partial work, the findings, the parity result, the Content-Security-Policy, the gates). Every finding is fixed; none is deferred.

| Id | Severity | Finding and resolution | Where |
|---|---|---|---|
| S1 (EC-1) | High | `base64ToUtf8` threw on a stray character (`atob`), so a malformed SEP-29 `config.memo_required` value read as "not required"; it now reads a value as `Buffer.from(value, "base64")` did, 30 shapes compared with Buffer. | `src/bytes.ts:31-59`, `test/unit/bytes.test.ts` |
| S2 (EC-2) | Medium | A non-string memo was coerced by `TextEncoder`; `CONFIG_INVALID` "memo must be a string". | `src/plan/plan.ts:346`, `test/unit/plan/e5-review-plan-options.test.ts` |
| S3 (G-1, BH-5) | High | The guard script threw on a missing chunk, scanned prose, missed bare `Buffer`/`process` values and `globalThis` forms, ignored `_` internals, misreported lines, failed through a symlink, and its tests left temp directories; it now parses with the TypeScript compiler, reports a non-file import, covers the built-ins and internals, compares real paths, and the tests clean up. | `scripts/check-browser-safe.mjs:74,101,137,205,271,284,354-358`, `test/unit/scripts/check-browser-safe.test.ts:42,273` |
| S4 | Medium | The page's bundle was not scanned in CI; `npm run check:bundle` after the web build. | `web/package.json:19`, `.github/workflows/ci.yml:98-102` |
| W1 | Medium | The BLOCKED note promised that `--partial` runs the steps; it now says the CLI needs `--to` for `DESTINATION_MISSING` and promises no step while a blocker holds. | `web/src/view.ts:145-171`, `web/test/view.test.ts` |
| W2 (EC-3) | Medium | The no-destination sponsor check was a shape check; now the StrKey checksum, as `planClose()`. | `web/src/plan.ts:37`, `web/src/address.ts:13` |
| W3 (I-2) | Medium | `NaN`/`Infinity` printed; a link for any string; a muxed destination linked wrongly. "unknown"; links only for checksummed G/M addresses, URL-encoded; the base account linked and the M address as text. | `web/src/view.ts:121,131,181`, `web/src/address.ts:23`, `web/src/render.ts` |
| W4 | Low | The previous plan stayed as if current; "1 steps". The stale mark and note; the plural. | `web/src/main.ts:55`, `web/index.html:126`, `web/e2e/plan.spec.ts:290` |
| W5 | Low | The "Copied." timer, two buttons named "Copy", "0 XLM arrives ... (nothing arrives)". One timer per note; the `aria-label`s; the row branches on `merges`. | `web/src/render.ts:140,268,281` |
| W6 | Low | A missing `../dist/index.js` failed opaquely; a clear error now, `vite preview` exempt. | `web/vite.config.ts:33` |
| W7 (EC-8, BH-4) | Medium | A reused stale preview, a second build in CI, no report of a failed run. `reuseExistingServer: false`, preview-only, `npx playwright test` in CI, the artifact upload on failure, the browser install bounded to ten minutes. | `web/playwright.config.ts:21-23`, `.github/workflows/ci.yml:105-126` |
| W8 (EC-9) | Low | A POST `Request` logged as a GET in the test helper; the method is read from the `Request`. | `web/test/helpers/recorded.ts:87` |
| W9 | Medium | No Content-Security-Policy; the meta tag, strict for the build, `'unsafe-inline'` for styles in `vite dev` only. | `web/index.html:9`, `web/vite.config.ts:23` |
| W10 | Medium | No parity with the CLI, no words for a slow Horizon; `parity.test.ts` and the two timed messages. | `web/test/parity.test.ts`, `web/src/main.ts:36-41` |
| D1 | Low | This section, Task 6, AC-E5-S1-8's sentence, the dated labels, the Dev Notes, the CI run id. | this file |
| D2 | Low | "Six epics."; `--sponsor` and `--prefer-destination` in canonical decision 4. | `docs/epics-and-stories.md`, `docs/README.md` |
| D3 | Low | The review file, the tracker, the progress log, the CHANGELOG. | `docs/reviews/`, `docs/stories/sprint-status.yaml`, `docs/progress-log.md`, `CHANGELOG.md` |

Parity: the page's `planHash` for the recorded fixture equals the CLI's `--json` `planHash`, `25be835c88e84af36e96e17fa00fcbf465f6f39a7c6075deab940106eff38c85`, and the documents are equal but for `network.horizon`. Content-Security-Policy: strict on the built page, no violation in 18 Playwright runs. CI: the first CI run on the code commits (d53c13f, c460737), 36888570340, was green in the three offline jobs and was cancelled in the web job by its twenty-minute limit after nineteen minutes inside `npx playwright install --with-deps chromium`, waiting on the runner's Ubuntu apt mirror; every step before it, the 33 unit tests included, had passed. The step was bounded to ten minutes (26fffc2), and run 36891502802 on that commit is green on Node 22.12.0, 22 and 24 and in the web job.

## Dev Agent Record

### Completion Notes List

- Root gates on the final code: lint, format, typecheck, the offline tier (129 files, 1262 tests), build, `node scripts/check-browser-safe.mjs` (4 files), `check:package` and `npm pack --dry-run` (26 files, the same list as before).
- `web/`: lint, typecheck, 33 unit tests in 4 files, build (193.8 kB, 55.9 kB gzipped), `check:bundle`, 18 Playwright runs; the Vite dev server probed under the Content-Security-Policy; the live check above, dated.
- Nothing was submitted to the testnet; the live check made GET requests only and the baseline fixture was not touched.

### File List

- `src/bytes.ts`, `scripts/check-browser-safe.mjs`, `test/unit/bytes.test.ts`, `test/unit/canonical-json.test.ts`, `test/unit/scripts/check-browser-safe.test.ts`, `test/unit/plan/e5-review-plan-options.test.ts` (new)
- `src/canonical-json.ts`, `src/inspect/address.ts`, `src/inspect/inspect.ts`, `src/execute/preflight.ts`, `src/plan/plan.ts`, `src/plan/order.ts`, `src/tx/operations.ts`, `src/sponsor/fee-bump.ts`, `src/index.ts` (modified)
- `web/package.json`, `web/package-lock.json`, `web/tsconfig.json`, `web/vite.config.ts`, `web/playwright.config.ts`, `web/eslint.config.js`, `web/index.html`, `web/src/main.ts`, `web/src/inputs.ts`, `web/src/plan.ts`, `web/src/view.ts`, `web/src/commands.ts`, `web/src/address.ts`, `web/src/render.ts`, `web/src/dom.ts`, `web/src/example.ts`, `web/src/styles.css`, `web/test/helpers/recorded.ts`, `web/test/view.test.ts`, `web/test/commands.test.ts`, `web/test/plan.test.ts`, `web/test/parity.test.ts`, `web/e2e/plan.spec.ts` (new)
- `.github/workflows/ci.yml` (the `web` job), `.gitignore`, `.prettierignore`, `eslint.config.js` (modified)
- `docs/web-demo.md`, `docs/adr/ADR-0007-web-demo-plan-only.md`, `docs/stories/5-1-web-demo-plan-only.md`, `docs/reviews/2026-10-01-e5-web-demo-review.md` (new); `README.md`, `CHANGELOG.md`, `docs/README.md`, `docs/architecture.md`, `docs/epics-and-stories.md`, `docs/progress-log.md`, `docs/stories/sprint-status.yaml` (modified)

## Change Log

- 2026-10-01: the browser-safe SDK entry, the web demo, its tests, the CI job and the documents. Status: review. The builder's scope change of the day applied: local only, not hosted.
- 2026-10-01, later: the quality gate (`docs/reviews/2026-10-01-e5-web-demo-review.md`): 17 findings, all fixed; the Buffer-faithful base64 decoder, the memo's type, the guard script over the TypeScript parser and over the web bundle, the page's notes, links, stale mark, slow-Horizon words, Content-Security-Policy and parity test, the CI job's single build and failure artifact, the documents. Status: done.
