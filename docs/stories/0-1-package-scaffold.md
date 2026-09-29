# Story 0.1: TypeScript package scaffold with typed API and CLI entry point

Status: done

## Story

As an integrator,
I want a buildable TypeScript package with a typed public API and a `dustin` CLI entry point,
so that I can install Dustin in my project and call it from code or from the terminal.

## Acceptance Criteria

1. Given a fresh clone on Node.js >= 22.12, when `npm ci && npm run build` runs, then `dist/` contains ESM (`.js`), CommonJS (`.cjs`) and declaration (`.d.ts`, `.d.cts`) outputs, and both `import { planClose, executeClose } from "stellar-dustin"` and `require("stellar-dustin")` resolve. Stubs that throw a `DustinError` with code `NOT_IMPLEMENTED` are acceptable in this story.
2. Given the build, when `npx dustin --help` runs, then usage for the `plan` and `close` subcommands is printed and the exit code is 0; `dustin --version` prints the package version.
3. Given `tsconfig.json`, then `strict` is true, `module` and `moduleResolution` are `NodeNext`, `target` is `ES2022`, and `npm run typecheck` passes.
4. Given `package.json`, then `name` is `stellar-dustin`, `bin` maps `dustin`, `type` is `module`, `engines.node` is `>=22.12.0`, `license` is `MIT`, `@stellar/stellar-sdk` is pinned to exactly `17.1.0`, there are no install scripts, and `files` is a whitelist that excludes tests, evidence, fixtures and any secret material.
5. Given the build, when `npm pack --dry-run` runs, then the tarball lists only `package.json`, `README.md`, `LICENSE` and files under `dist/`; `npm publish --dry-run` succeeds so the builder can reserve the npm name.

## Tasks / Subtasks

- [x] Task 1: package manifest and toolchain (AC: 3, 4)
  - [x] `package.json` with name, bin, exports map (ESM + CJS + types), engines, license, files whitelist, scripts (`build`, `typecheck`, `prepublishOnly`)
  - [x] pinned dependencies: `@stellar/stellar-sdk` 17.1.0, `commander` ^14.0.3; dev: `typescript` 5.9.3, `tsup` 8.5.1, `@types/node` 24
  - [x] `tsconfig.json` (strict, NodeNext, ES2022) and `tsup.config.ts` (library: esm + cjs + dts; CLI: esm with shebang)
- [x] Task 2: public API stubs (AC: 1)
  - [x] `src/errors/dustin-error.ts` minimal `DustinError` with `code`
  - [x] `src/index.ts` exporting `planClose`, `executeClose` stubs that throw `NOT_IMPLEMENTED`, and `DustinError`
- [x] Task 3: CLI entry point (AC: 2)
  - [x] `src/cli/program.ts` builds the commander program with `plan` and `close` (option surface from canonical decision 4; actions are stubs)
  - [x] `src/cli/main.ts` runs the program; version read from `package.json`
- [x] Task 4: packaging checks (AC: 1, 2, 5)
  - [x] `LICENSE` (MIT, `Copyright (c) 2026 0xsimoneth`) so the publish dry run is representative (moved forward from E0-S4)
  - [x] `scripts/check-package.mjs`: imports the ESM entry, requires the CJS entry, runs `dustin --help` and `--version`, and asserts the `npm pack --dry-run` file list against the whitelist
  - [x] `npm run check:package` script; `npm publish --dry-run` verified

## Dev Notes

- Canonical decisions (docs/README.md): package `stellar-dustin`, bin `dustin` (decision 2); CLI surface `dustin plan <G> --to <G>` and `dustin close <G> --to <G> --execute [--yes] [--partial] [--json] [--memo <m>]`, `--destination` alias of `--to`, `--prefer-destination` (decisions 4 and 8). Exit codes (decision 5) are wired in later stories; this story only registers the commands.
- Toolchain (docs/architecture.md section 9, docs/technical-spike.md section 8.1, npm registry 2026-09-26): TypeScript 5.9.3 (7.x not adopted), tsup 8.5.1, `@stellar/stellar-sdk` 17.1.0 with `engines.node >= 22.12.0`. `commander` ^14.0.3 matches the SDK's own dependency range so it dedupes.
- Layout (docs/architecture.md section 10): `src/index.ts`, `src/cli/`, `src/errors/`; other directories are created by the stories that fill them.
- The npm name `stellar-dustin` returned 404 on the registry on 2026-09-26, so it is free; the builder reserves it.

### References

- docs/epics-and-stories.md, Story 0.1
- docs/architecture.md sections 9 and 10
- docs/README.md canonical decisions 2, 4, 5, 8

## Dev Agent Record

### Agent Model Used

dev-story workflow (AI developer agent)

### Implementation Plan

- Two tsup configurations: the library (`src/index.ts`) as ESM + CJS with `.d.ts` and `.d.cts`, and the CLI (`src/cli/main.ts`) as ESM only. `npm run build` deletes `dist/` once before tsup instead of using tsup's `clean`, because the two configurations build in parallel and a per-config clean can delete the other's output.
- The build runs in `prepack`, so `npm pack` and `npm publish` from a clean checkout always include a fresh `dist/`; `prepublishOnly` runs the typecheck.
- `bin` is `dist/cli/main.js` without a leading `./`: with `./dist/cli/main.js`, npm 11 printed "bin[dustin] script name dist/cli/main.js was invalid and removed" during `npm publish --dry-run`, which would have shipped a package without the `dustin` command.
- `scripts/check-package.mjs` checks the package as a consumer sees it: self-referenced ESM `import` and CJS `require` of `stellar-dustin`, `dustin --help` and `--version`, the `npm pack --dry-run --ignore-scripts` file list against a whitelist, and no secret-looking string in any shipped file.

### Debug Log References

- `npm publish --dry-run` warning about the `./` bin path, fixed as above.
- `npm pack` from a clean tree produced a tarball without `dist/` while the build ran in `prepublishOnly`; moved to `prepack`.

### Completion Notes List

- AC1: `dist/` contains `index.js`, `index.cjs`, `index.d.ts`, `index.d.cts`, `cli/main.js`; a fresh consumer project that installed the packed tarball resolved both `require("stellar-dustin")` and `import ... from "stellar-dustin"`, and `planClose()` rejected with `DustinError` `NOT_IMPLEMENTED` in both module systems.
- AC2: `npx dustin --help` lists `plan` and `close`, exit 0; `npx dustin --version` prints `0.0.1`.
- AC3: `tsconfig.json` strict, NodeNext, ES2022; `npm run typecheck` passes.
- AC4: manifest fields as specified; `@stellar/stellar-sdk` pinned to `17.1.0`; no install scripts; `files` is `["dist"]`.
- AC5: `npm run check:package` passes with 11 files (LICENSE, README.md, package.json, dist/**); `npm publish --dry-run` prints `+ stellar-dustin@0.0.1` with no warnings.
- `npm audit --omit=dev` reports 0 vulnerabilities; the full audit reports one low-severity advisory in the dev-only `esbuild` (Windows dev server), not shipped.
- Version `0.0.1` is the name-reservation version; the delivery version is `0.1.0`.

### File List

- `package.json` (new)
- `package-lock.json` (new)
- `tsconfig.json` (new)
- `tsup.config.ts` (new)
- `LICENSE` (new)
- `src/index.ts` (new)
- `src/errors/dustin-error.ts` (new)
- `src/cli/program.ts` (new)
- `src/cli/main.ts` (new)
- `scripts/check-package.mjs` (new)
- `.gitignore` (modified: `*.tgz`)
- `docs/stories/0-1-package-scaffold.md` (new)
- `docs/stories/sprint-status.yaml` (modified)

## Senior Developer Review (AI)

- Date: 2026-09-26
- Scope: commits aacd0d9..97bc569, adversarial review plus an edge-case walk by an independent review agent (read-only).
- Outcome: changes requested, all resolved in the follow-up commit.

### Action Items

- [x] Low: `scripts/check-package.mjs` resolved the binary with `URL.pathname`, which breaks on paths with spaces or non-ASCII characters; now `fileURLToPath`.
- [x] Low: the tarball secret scan used `\bS...\b`; it now flags any 56-character window with a valid StrKey seed checksum.
- [x] Low: `prepublishOnly` ran only the typecheck; it now runs lint, typecheck and tests, and `postpack` runs the package check.

## Change Log

- 2026-09-26: Package scaffold, public API stubs, CLI entry point, LICENSE (moved forward from E0-S4) and package check. Status: done.
- 2026-09-26: Review findings resolved. Status: done.
