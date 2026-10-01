# Web demo: plan only, in the browser

> **Post-sprint addition, outside the SOW** (2026-10-01). The accepted Statement of Work names the CLI as the interface and places the wallet UI with the integrator (`docs/README.md`, canonical decision 1; `architecture.md` section 12; ADR-0001, ADR-0002). This page changes no deliverable and no evidence; it exists so that someone without a terminal can see what `planClose()` says about an account, and it is meant to be improved later. It runs locally and is not hosted. ADR-0007 records the decision; story E5-S1 (`stories/5-1-web-demo-plan-only.md`) records the work.

## What it is

One static page under `web/`. Paste a testnet account (and, optionally, a destination and a fee sponsor), press Plan, and the SDK's read-only planner runs in your browser against the testnet Horizon, GET requests only, and renders the plan the CLI would print: the status in words (CLOSABLE, PARTIAL or BLOCKED, never a colour alone), balance, minimum and spendable XLM, what reaches the destination and what returns to reserve sponsors, the fee bid and the sponsor's budget, the ordered steps with the CLI's own wording (transaction, action, why), blockers and unclosable items with their remedies, explorer links for the account, the destination, the sponsor and each issuer, the plan JSON, and the plan as the CLI prints it. A "Run it yourself" box gives the exact `dustin plan` and `dustin close --execute` commands for the same inputs, with the two secrets named by their environment variables and never valued, and a copy button.

The sentence on the page is the whole security stance: **This page only plans. It never asks for a secret key; closing happens in your terminal or your own code.**

The example button fills the builder's baseline fixture, `GAZF3X7YYCI7PHZYZDQOGPLVN2RVD37YIQG7YEY6QJW6IK224Y4R3MBK`, with its destination and its sponsor (`test/fixtures/horizon/messy/manifest.json`): a messy account at its minimum balance, four trustlines with dust (one sponsored), two open offers, one data entry, zero spendable XLM. Planning reads it and changes nothing.

## Security stance

- **Plan only.** The page imports the planner (`planClose`, `inspectAccount`, `planFromSnapshot`) and the renderers. It never constructs a signer, never calls `executeClose()`, and never sends anything but GET requests: the Playwright test records every request the page makes and fails on a non-GET to Horizon or on a request to any host but Horizon and the page's own.
- **No secrets.** There is no field for a secret key, no `type="password"`, no storage, no cookie, no analytics, no external script or font. The test checks every form control's type, name, id, placeholder, label and autocomplete for the words secret, seed, private, mnemonic, passphrase and password, and the page's assets for any origin but its own.
- **Why execution stays in the CLI and the SDK.** A close needs the account's secret key and a funded sponsor's key. In the CLI they come from the environment, `.env` or a hidden prompt, never from the command line (canonical decision 4); in the SDK the integrator brings its own `Signer`, and the sponsor signs only the fee-bump envelopes (ADR-0003). A page that took either key would be the pattern the SOW criticises in the existing tool, secrets pasted into a browser and a server-side co-signing step that cannot be inspected (canonical decision 14), and a hosted sponsor would need the abuse controls of ADR-0002 before it may exist. The roadmap below says how a later phase could sign without any of that.
- **Testnet only**, as the SDK: `planClose()` refuses any Horizon that does not serve the testnet passphrase before it reads an account, and the page's links point at the testnet explorer.

## Architecture

Static page plus Horizon direct: no server of its own, no backend, no relay, no new key anywhere.

- `web/` is a separate Vite + TypeScript project with no UI framework: `index.html` and small modules under `src/`. `inputs.ts` reads the form; `plan.ts` calls the SDK and puts an error into plain words (a title, the SDK's sentence, `remedyOf()`); `view.ts` maps a `ClosePlan` to words and rows, a pure function tested without a browser; `commands.ts` writes the two CLI commands; `render.ts` builds the DOM with the element helper of `dom.ts`, so every value from Horizon is written as text and never parsed as HTML (the project's ESLint forbids `innerHTML`); `main.ts` wires them; `example.ts` holds the fixture's public addresses. A framework can be adopted later by replacing `render.ts` and `main.ts`.
- **The SDK is imported as `stellar-dustin`, resolved by a Vite alias to the repository's built ESM entry `dist/index.js`** (and to `dist/index.d.ts` for the types, through `paths` in `web/tsconfig.json`). Why the alias and not a `file:` dependency: the page then consumes the artifact an integrator installs, so the browser-safety guard and the page test the same code; the SDK's one runtime dependency, `@stellar/stellar-sdk`, resolves from the root `node_modules` at the version the root lockfile pins, so there is one copy of it; and `npm ci` in `web/` stays small and independent of the package's version, where a `file:` link would install the root's devDependencies into `web/node_modules` and tie `web/package-lock.json` to the root's version. The cost is one rule: build the root first.
- **The SDK entry is browser-safe since this story.** `sha256Hex` takes its digest from the Stellar SDK's `hash()` (sha256 from `@noble/hashes` over the UTF-8 bytes; `src/base/hashing.ts` of js-stellar-sdk 17.1.0, https://github.com/stellar/js-stellar-sdk/blob/v17.1.0/src/base/hashing.ts), and `src/bytes.ts` replaces every `Buffer` use in the SDK zone with `Uint8Array`, `TextEncoder` and `atob` (forgiving base64, https://infra.spec.whatwg.org/#forgiving-base64-decode). The SDK's own ESM build has no `node:` import and no `Buffer` outside its CLI folder, so no polyfill is bundled. `scripts/check-browser-safe.mjs` fails CI when `dist/index.js`, `dist/index.cjs` or a chunk they import reaches a `node:` module, a bare Node built-in (`fs`, `path`, `os`, `child_process`, `readline`, `crypto`, ...) or the `Buffer`, `process`, `__dirname` or `__filename` globals; the CLI (`dist/cli`) and `stellar-dustin/testing` are Node programs and keep Node's APIs. Every plan hash and snapshot hash is unchanged (`test/unit/canonical-json.test.ts` pins the recorded fixture's).
- **Horizon is called from the browser.** The public testnet Horizon answers cross-origin requests. Checked on 2026-10-01: a GET with `Origin: http://localhost:4173` to `https://horizon-testnet.stellar.org/fee_stats` returned `Access-Control-Allow-Origin: http://localhost:4173` and `Access-Control-Expose-Headers: Date, Latest-Ledger`; the preflight (`OPTIONS` with `Access-Control-Request-Method: GET` and `Access-Control-Request-Headers: accept`) returned 204 with `Access-Control-Allow-Methods: GET` and `Access-Control-Allow-Headers: accept`. Horizon's rate limits apply to the browser as to any other client (https://developers.stellar.org/docs/data/apis/horizon/api-reference/structure/rate-limiting). The SDK's read client retries a failed request three times with a growing pause, so an unreachable Horizon is reported after about seven seconds.
- **Without a destination** the page calls `inspectAccount()` and `planFromSnapshot()` instead of `planClose()`, which requires one: the planner lists the cleanup it can see and marks the plan BLOCKED with `DESTINATION_MISSING`, and the page says so beside the field. The page applies the two sponsor rules `planClose()` would (a G address, not the account) before reading anything. **The sponsor is optional:** the fee bid comes from Horizon's `fee_stats` either way (canonical decision 7), the plan checks it against the per-close budget, and the payer is named `fee_sponsor` when none is given.
- **`--partial` is an option of the close** (`allowPartial`), not of the plan. The checkbox changes the note under the status, which says what the close would do with the exit code of canonical decision 5, and the close command; the plan itself is the same.
- The page is built with relative asset paths (`base: "./"`), so the production build works from any directory or path prefix.

## Run it locally

```bash
npm ci && npm run build            # the root: the page imports dist/index.js
cd web && npm ci
npm run dev                        # http://localhost:5173/, rebuilt on every change
npm run build && npm run preview   # the production build at http://localhost:4173/
```

In `web/`: `npm test` runs the Vitest unit tests (the plan-to-view mapping, the commands, the error words, with the recorded messy fixture served to `fetch`; 28 tests), and `npm run test:e2e` the Playwright smoke test (`npx playwright install chromium` once): it builds and serves the page, answers Horizon from `test/fixtures/horizon/messy`, refuses every other host, and checks the example account's plan on a desktop project and a phone project (8 tests, 16 runs). `npm run lint` and `npm run typecheck` are the static checks. CI runs all of it in the `web` job of `.github/workflows/ci.yml`, after `node scripts/check-browser-safe.mjs` on the root build; the offline matrix is unchanged.

Checked live on 2026-10-01 through the built page with no interception: the baseline fixture planned in 1.9 s, CLOSABLE, 12 steps in 3 transactions, 12 GET requests to Horizon and none to any other host, ledger 4,967,599, plan hash `25be835c88e84af36e96e17fa00fcbf465f6f39a7c6075deab940106eff38c85`, the recorded fixture's own (the account has not changed since 2026-09-26).

## Deployment

None. The demo is local only in this iteration: nothing is hosted, and no workflow deploys it. A later step could publish `web/dist/` to GitHub Pages (a workflow with `pages: write` and `id-token: write` permissions on push to `main`, `base` set to the repository's path) or to any static host; that step is listed here only as possible, not planned, and it needs the builder's decision on the URL and on who answers for the page.

## Roadmap

- **Phase 1, this story:** plan only, no secret, local.
- **Phase 2, wallet signing of the inner transactions.** The page builds the plan's inner transactions and asks a wallet to sign them with the account's key, Freighter (https://docs.freighter.app/) or several wallets through the Stellar Wallets Kit (https://github.com/Creit-Tech/Stellar-Wallets-Kit), while the integrator supplies the sponsor: its own process wraps each signed inner transaction in a fee bump with its own key through the SDK's `Signer` interface, the split of ADR-0003. The page still never sees a secret: the wallet signs for the account, the integrator signs for the fees.
- **Phase 3, a hosted fee-bump sponsor relay.** A service that receives a signed inner transaction, recomputes the plan, accepts the transaction only if it matches, wraps it and submits it, with the abuse controls ADR-0002 lists (content validation, plan binding, budgets, replay protection, SEP-10 authentication, a managed key, observability). This revisits ADR-0002's decision against a backend and needs its own ADR before it exists on any network.

## Sources

- The CORS probe of 2026-10-01 against https://horizon-testnet.stellar.org (above).
- js-stellar-sdk 17.1.0, `src/base/hashing.ts`: https://github.com/stellar/js-stellar-sdk/blob/v17.1.0/src/base/hashing.ts
- Forgiving base64 decoding, the behaviour of `atob`: https://infra.spec.whatwg.org/#forgiving-base64-decode
- Horizon rate limiting: https://developers.stellar.org/docs/data/apis/horizon/api-reference/structure/rate-limiting
- Freighter: https://docs.freighter.app/; Stellar Wallets Kit: https://github.com/Creit-Tech/Stellar-Wallets-Kit
- Vite: https://vite.dev/guide/; Playwright: https://playwright.dev/docs/intro
