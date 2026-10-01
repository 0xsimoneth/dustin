# ADR-0007: A plan-only web demo, local, outside the SOW

- Status: Accepted
- Date: 2026-10-01
- Deciders: the builder
- Related: ADR-0001, ADR-0002, ADR-0003; `docs/web-demo.md`; `docs/README.md` canonical decision 1; story E5-S1

## Context

The 30-day SOW delivered an SDK and a CLI and placed the wallet UI with the integrator: no frontend, no backend, no contract (`docs/architecture.md` section 12; canonical decision 1). The sprint's deliverables are complete and recorded. After them, the builder wants a simple page so that someone without a terminal can see what `planClose()` says about an account, to be improved later. `docs/ux-design.md` section 5 had sketched a stretch page that would also close, with the account's secret pasted into a field and a tiny hosted signer that fee-bumps with a testnet key; that half collides with the reasons the SOW gives against the existing tool (secrets pasted into a browser, a server-side co-signing step that cannot be inspected; canonical decision 14) and with ADR-0002's decision against a backend.

## Decision

1. **The page plans and nothing else.** It imports the read-only planner and the renderers; it has no signer, no field for a secret, no storage, no analytics and no external script or font. Closing stays in the CLI and the SDK, with the secrets where canonical decision 4 puts them: the environment, `.env` or a hidden prompt, never a browser.
2. **A static page calling the testnet Horizon directly** from the browser, GET requests only: no backend, no relay, no new key anywhere. The public testnet Horizon answers cross-origin requests (the probe of 2026-10-01 is in `docs/web-demo.md`).
3. **A separate project under `web/`**, Vite and TypeScript, no UI framework, small modules so a framework can be adopted later. It consumes the repository's built SDK entry through a Vite alias, so it tests the artifact an integrator installs, and it is covered by its own unit tests, a Playwright smoke test on the recorded Horizon fixtures with every other host refused, and a CI job beside the unchanged offline matrix.
4. **The SDK entry is browser-safe**, which the page needs and a wallet integrator gains: no `node:` import and no `Buffer` reachable from `stellar-dustin`; `sha256Hex` takes its digest from the Stellar SDK's `hash()`, which is the same bytes, so every plan hash is unchanged; `scripts/check-browser-safe.mjs` enforces it on the built entry and its chunks. The CLI and `stellar-dustin/testing` keep Node's APIs.
5. **Local only, not hosted.** The builder's scope decision of 2026-10-01: nothing is deployed, there is no live URL. GitHub Pages or another static host is a possible later step, listed as such, not planned.
6. **Labelled everywhere** as a post-sprint addition outside the Instaward scope: on the page, in the README, the CHANGELOG, the planning index and the tracker. It changes no deliverable and no evidence.

## Consequences

- A reviewer or an integrator sees a plan with Node and a browser, nothing else installed; the SOW's safety model (dry run by default, secrets never in a user interface) is unchanged.
- The SDK gains two small exports, `stepAction()` and `subjectLabel()`, so a user interface keeps the CLI's wording; its Node code paths are unchanged in behaviour, and the package's file list is the same 26 files.
- The repository gains a second lockfile (`web/package-lock.json`), a Playwright browser download in CI, and a rule: build the root before the page.
- Any later phase that signs or sponsors needs its own ADR. Wallet signing (the roadmap's phase 2) keeps the page free of secrets through the fee-bump split of ADR-0003: the wallet signs the inner transactions, the integrator's own process signs the fee bumps. A hosted relay (phase 3) revisits ADR-0002 with its abuse controls.

## Alternatives considered

- **The stretch page of `docs/ux-design.md` section 5, with a close button, a secret field and a hosted signer.** Rejected: it would ask for a secret in a browser, and a hosted key means abuse controls to design, hosting to answer for and a cost; none of it is needed to show the planner.
- **A `file:` dependency on the root package instead of the alias.** Rejected: `npm ci` in `web/` would install the root's devDependencies into `web/node_modules`, the lockfile would tie to the package's version, and the page would still need the root build.
- **Hosting on GitHub Pages now.** Deferred by the builder: the demo stays local; the relative build (`base: "./"`) keeps the option open.
- **Keeping `node:crypto` and shimming it in the bundle.** Rejected: the Stellar SDK already ships a sha256 over `Uint8Array`, so the SDK zone needs no Node API at all, and a guard is simpler and stricter than a shim.
- **A framework (React, Svelte) from the start.** Rejected for now: one page with a form and a table does not need one, and the module split (a pure view model, a small renderer) lets one in later without touching the planner calls.

## Sources

- `SUCCESSFUL_SOW.md` (Out of Scope: wallet UI, production key management); `docs/README.md` canonical decisions 1, 4, 7, 14 and 15.
- js-stellar-sdk 17.1.0 `src/base/hashing.ts`: https://github.com/stellar/js-stellar-sdk/blob/v17.1.0/src/base/hashing.ts
- Forgiving base64 decoding (`atob`): https://infra.spec.whatwg.org/#forgiving-base64-decode
- Horizon rate limiting: https://developers.stellar.org/docs/data/apis/horizon/api-reference/structure/rate-limiting
- The CORS probe of the testnet Horizon on 2026-10-01: `docs/web-demo.md`, "Architecture".
