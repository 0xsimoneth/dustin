# Story 5.1: Plan-only web demo (post-sprint, outside the SOW)

Status: review

## Story

As the builder,
I want a simple one-page web demo that plans the close of a testnet account in the browser with the SDK's read-only planner, to be improved later,
so that someone without a terminal can see what `planClose()` says about an account, without the page ever touching a secret.

Post-sprint addition on 2026-10-01, outside the Instaward scope (`docs/README.md`, canonical decision 1; ADR-0007; `docs/web-demo.md`). It changes no deliverable and no evidence. The builder's scope change of the same day, received before any deployment work: local only, nothing hosted, GitHub Pages a possible later step.

## Acceptance Criteria

1. AC-E5-S1-1: **Then** the SDK entry (`stellar-dustin`) runs in a browser bundle: no `node:` import and no `Buffer` reachable from `dist/index.js` or `dist/index.cjs`; `sha256Hex` uses the Stellar SDK's `hash()`; every plan hash and snapshot hash is unchanged; a guard script fails CI when the built entry or a chunk it imports reaches a Node-only API.
   - **Met.** `src/bytes.ts` (`toHex`, `utf8ByteLength`, `base64ToUtf8`) replaces the seven `Buffer` uses of the SDK zone; `src/canonical-json.ts` takes its digest from `hash()` (js-stellar-sdk 17.1.0 `src/base/hashing.ts`: sha256 from `@noble/hashes`, a `Uint8Array`). The SDK's own ESM build has no `node:` import and no `Buffer` outside its CLI folder, so no polyfill is needed. `scripts/check-browser-safe.mjs` follows the local imports of both entries (4 files on the current build) and fails on a `node:` module, a bare built-in or the `Buffer`, `process`, `__dirname` and `__filename` globals; exit 2 before a build. The CLI and `stellar-dustin/testing` keep Node's APIs. `test/unit/canonical-json.test.ts` pins the recorded fixture's `snapshotHash` and `planHash` of the committed dry-run snapshot.
2. AC-E5-S1-2: **Then** `web/` is a separate Vite + TypeScript project with no UI framework and small modules, depending on the SDK through a Vite alias to the repository's built entry, with the choice documented and `npm ci` working in CI.
   - **Met.** `web/vite.config.ts` aliases `stellar-dustin` to `../dist/index.js`; `web/tsconfig.json` maps the types to `../dist/index.d.ts`; why not a `file:` dependency is in `docs/web-demo.md` ("Architecture") and ADR-0007. `web/package-lock.json` is committed; the CI job runs `npm ci` in `web/`.
3. AC-E5-S1-3: **Then** the page has the testnet banner; the sentence "This page only plans. It never asks for a secret key; closing happens in your terminal or your own code."; the inputs (account; destination optional, with what happens without it; sponsor optional, with what it is for; `--partial` and `--prefer-destination` as checkboxes mapped to `allowPartial` and `preferDestination`); a "Load the example account" button with the baseline fixture's public addresses; and a "Plan" button that calls the SDK planner against Horizon from the browser and renders the status in words, balance, minimum and spendable, the recovered XLM and the reserves returned to sponsors, the fee bid and budget, the ordered steps (transaction, action, why) mirroring the CLI, blockers and unclosable items with reasons and remedies, explorer links for the account, the destination and the issuers, a plan JSON toggle, and errors in plain words.
   - **Met.** `web/index.html`, `web/src/*`. The steps use the CLI's own words through the new exports `stepAction()` and `subjectLabel()`; the status sentences are the CLI's. Without a destination the page inspects the account and plans from the snapshot (`inspectAccount()` and `planFromSnapshot()`): BLOCKED with `DESTINATION_MISSING`, the cleanup listed. A second toggle shows the plan as the CLI prints it (`renderPlan()`). The sponsor and the explorer links also cover the fee sponsor.
4. AC-E5-S1-4: **Then** a "Run it yourself" box gives the exact `npx stellar-dustin plan ...` and `close --execute` commands, the secrets named by their environment variables and never valued, with a copy button and links to the README and the integration notes.
   - **Met.** `web/src/commands.ts`; only an address-shaped value is written into a command, anything else becomes a placeholder, and `--partial` appears only in the close command, where it belongs.
5. AC-E5-S1-5: **Then** the page is accessible (labels, keyboard, status as text), works at phone width, loads no external script or font, has no analytics, and ends with the footer "Post-sprint demo, outside the Instaward scope; testnet only; MIT" with the repository link.
   - **Met.** Every input has a `<label>`; the status region is `role="status"` with `aria-live="polite"`, an error `role="alert"`; the form submits with Enter and focus moves to the plan's heading; the phone project of the Playwright suite asserts no horizontal overflow (under 40rem the steps table stacks its cells, and reasons that carry whole addresses break with `overflow-wrap: anywhere`); system fonts only; no script but the page's own.
6. AC-E5-S1-6: **Then** Vitest unit tests cover the page's plan-to-view mapping; a Playwright smoke test serves the built page, intercepts Horizon with the recorded fixtures of `test/fixtures/horizon/messy`, fills the example and asserts the rendered status, the step count, and that no element is `type="password"` or asks for a secret; the live manual check against the real baseline account was made once from the builder's machine (planning only); the web build reaches no `node:` module.
   - **Met.** `web/test/` (3 files, 28 tests: the view, the commands, the plan call and the error words). `web/e2e/plan.spec.ts` (8 tests on a desktop project and a phone project, 16 runs): the example's plan (CLOSABLE, 12 steps, 3 transactions, the figures, the four explorer links, both toggles, the two commands and their copy buttons); no password field and no control whose type, name, id, placeholder, label or autocomplete says secret, seed, private, mnemonic, passphrase or password; no asset from another origin; every Horizon request a GET and no request to any other host; a malformed address answered without a request; a missing account (BLOCKED, the 404 explained); no destination (11 steps, no merge, `DESTINATION_MISSING`); an unreachable Horizon (after the SDK's retries); no horizontal overflow; keyboard submission with focus on the result. Live check of 2026-10-01 through the built page with no interception: CLOSABLE, 12 steps, 3 transactions, 12 GET requests to Horizon and none elsewhere, 1.9 s, ledger 4,967,599, plan hash `25be835c...8c85`, the recorded fixture's own. The Vite dev server was driven the same way with the fixtures (no console error). The built bundle (191 kB, 55 kB gzipped) has no `node:` specifier and no `Buffer` global (its one `Buffer.` text is `ArrayBuffer.isView`).
7. AC-E5-S1-7: **Then** the documents name it a post-sprint addition outside the SOW: `docs/web-demo.md`, ADR-0007, a README section, a CHANGELOG `[Unreleased]` entry, a note under canonical decision 1, this story, `sprint-status.yaml` (Epic 5), the progress log; root CI builds and tests `web/` in a new job, the existing jobs unchanged.
   - **Met.** The File List names each; the `web` job runs beside the unchanged `offline` matrix.
8. AC-E5-S1-8: **Then** nothing is deployed: no Pages workflow, no hosting, no live URL; the documents describe a local demo and list GitHub Pages only as a possible later step.
   - **Met.** The scope change arrived before any workflow was written, so there was nothing to remove; `git grep pages.yml` finds nothing.

| AC | Tests |
|---|---|
| 1 | `test/unit/bytes.test.ts`, `test/unit/canonical-json.test.ts`, `test/unit/scripts/check-browser-safe.test.ts`; `node scripts/check-browser-safe.mjs` in the CI `web` job |
| 2 | the CI `web` job: `npm ci`, `npm run lint`, `npm run typecheck`, `npm run build` in `web/` |
| 3, 4, 5 | `web/test/view.test.ts`, `web/test/commands.test.ts`, `web/test/plan.test.ts`; `web/e2e/plan.spec.ts` |
| 6 | the same, and the live check recorded above |
| 7, 8 | a reading of the documents; no `pages.yml` in the repository |

## Tasks / Subtasks

- [x] Task 1: the SDK entry browser-safe: `src/bytes.ts`, `src/canonical-json.ts`, the seven `Buffer` sites, the guard script with its test, the two render exports
- [x] Task 2: the `web/` project: the Vite, TypeScript, ESLint and Playwright configuration, the alias to the root build, the page and its modules, the root ignores
- [x] Task 3: the unit tests, the Playwright smoke test, the dev-server check and the live check
- [x] Task 4: the CI job
- [x] Task 5: the documents, the tracker and the progress log
- [x] Task 6: the quality gate: `code-review` and `review-edge-case-hunter` on the diff, the fixes, the record below

## Dev Notes

- `planClose()` validates the sponsor; `planFromSnapshot()` does not, so the no-destination path of `web/src/plan.ts` applies the same two rules (a G address, not the account) before reading anything.
- `--partial` is an execute-time option (`allowPartial`), so the checkbox changes only the note under the status (what the close would do, with the exit code of canonical decision 5) and the close command.
- The toolchain is pinned in `web/package.json`: Vite 8.3.2, Vitest 5.0.3, Playwright 1.63.0, and the root's TypeScript 5.9.3, ESLint 10.11.0, typescript-eslint 8.70.1 and `@eslint/js` 10.0.1. The web project's ESLint forbids `Buffer` and `process` in `src/` and `innerHTML`, `outerHTML` and `insertAdjacentHTML` anywhere in it.
- Horizon's CORS answer of 2026-10-01 is in `docs/web-demo.md`; the Horizon source paths of `stellar/go` the docs once pointed at have moved, so the dated probe is the evidence.
- Traps: Playwright's `toHaveText` with a regular expression keeps the line breaks the HTML wraps across (`toContainText` with a string normalises them); `getByLabel("Destination")` also matched the `--prefer-destination` checkbox; a table sizes its columns to the longest unbreakable word, so whole 56-character addresses in the reasons widened the page by 193 px at phone width until the cells got `overflow-wrap: anywhere` and the table stacked.

### References

- `docs/README.md` canonical decisions 1, 4, 5, 7, 8, 14 and 15; `docs/ux-design.md` section 5 (the stretch idea this replaces) and principle P6; `docs/architecture.md` section 12; ADR-0001, ADR-0002, ADR-0003, ADR-0007; `docs/web-demo.md`.
- js-stellar-sdk 17.1.0 `src/base/hashing.ts`: https://github.com/stellar/js-stellar-sdk/blob/v17.1.0/src/base/hashing.ts
- Forgiving base64 (`atob`): https://infra.spec.whatwg.org/#forgiving-base64-decode
- Horizon rate limiting: https://developers.stellar.org/docs/data/apis/horizon/api-reference/structure/rate-limiting

## Dev Agent Record

### Completion Notes List

- Root gates on the final code: lint, format, typecheck, the offline tier (128 files, 1254 tests), build, `node scripts/check-browser-safe.mjs` (4 files), `check:package` (26 files, the same list as before).
- `web/`: lint, typecheck, 28 unit tests, build (191 kB, 55 kB gzipped), 16 Playwright runs; the Vite dev server driven with the fixtures; the live check above.
- Nothing was submitted to the testnet; the live check made GET requests only and the baseline fixture was not touched.

### File List

- `src/bytes.ts`, `scripts/check-browser-safe.mjs`, `test/unit/bytes.test.ts`, `test/unit/canonical-json.test.ts`, `test/unit/scripts/check-browser-safe.test.ts` (new)
- `src/canonical-json.ts`, `src/inspect/address.ts`, `src/inspect/inspect.ts`, `src/execute/preflight.ts`, `src/plan/plan.ts`, `src/plan/order.ts`, `src/tx/operations.ts`, `src/sponsor/fee-bump.ts`, `src/index.ts` (modified)
- `web/package.json`, `web/package-lock.json`, `web/tsconfig.json`, `web/vite.config.ts`, `web/playwright.config.ts`, `web/eslint.config.js`, `web/index.html`, `web/src/main.ts`, `web/src/inputs.ts`, `web/src/plan.ts`, `web/src/view.ts`, `web/src/commands.ts`, `web/src/render.ts`, `web/src/dom.ts`, `web/src/example.ts`, `web/src/styles.css`, `web/test/helpers/recorded.ts`, `web/test/view.test.ts`, `web/test/commands.test.ts`, `web/test/plan.test.ts`, `web/e2e/plan.spec.ts` (new)
- `.github/workflows/ci.yml` (the `web` job), `.gitignore`, `.prettierignore`, `eslint.config.js` (modified)
- `docs/web-demo.md`, `docs/adr/ADR-0007-web-demo-plan-only.md`, `docs/stories/5-1-web-demo-plan-only.md` (new); `README.md`, `CHANGELOG.md`, `docs/README.md`, `docs/architecture.md`, `docs/epics-and-stories.md`, `docs/progress-log.md`, `docs/stories/sprint-status.yaml` (modified)

## Change Log

- 2026-10-01: the browser-safe SDK entry, the web demo, its tests, the CI job and the documents. Status: review. The builder's scope change of the day applied: local only, not hosted.
