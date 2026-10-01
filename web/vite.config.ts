import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";
import { defineConfig } from "vitest/config";

// The page imports the SDK as `stellar-dustin`, resolved to the repository's built ESM entry
// (../dist/index.js) and its declarations (tsconfig.json `paths`): the demo consumes the artifact
// an integrator installs, so scripts/check-browser-safe.mjs and this page test the same code, and
// the SDK's runtime dependency, @stellar/stellar-sdk, resolves from the root node_modules at the
// version the root lockfile pins; no `file:` dependency, whose install would pull the root's
// devDependencies into this folder (docs/web-demo.md, "Architecture"). Build the root first: the
// config refuses to start without the built entry and says so (E5-S1 review, W6); `vite preview`
// serves a finished build and is exempt.
const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const sdkEntry = fileURLToPath(new URL("../dist/index.js", import.meta.url));

/**
 * The page's Content-Security-Policy is the meta tag of index.html, written for the built page,
 * whose stylesheet is a <link>. The dev server injects CSS as inline <style> elements, which that
 * policy refuses, so `vite dev` alone adds 'unsafe-inline' to style-src; `vite build` and
 * `vite preview` keep the policy as written (E5-S1 review, W9).
 */
const devStyleCsp: Plugin = {
  name: "dustin-dev-csp",
  apply: "serve",
  transformIndexHtml(html) {
    return html.replace("style-src 'self';", "style-src 'self' 'unsafe-inline';");
  },
};

export default defineConfig(({ isPreview }) => {
  if (!isPreview && !existsSync(sdkEntry)) {
    throw new Error(
      'web/: the SDK\'s built entry ../dist/index.js is missing; run npm run build at the repository root first (docs/web-demo.md, "Run it locally").',
    );
  }
  return {
    // Relative asset paths, so the built page works from any directory or path prefix.
    base: "./",
    plugins: [devStyleCsp],
    resolve: { alias: { "stellar-dustin": sdkEntry } },
    server: { fs: { allow: [repoRoot] } },
    build: { target: "es2022", sourcemap: true },
    test: { include: ["test/**/*.test.ts"], environment: "node" },
  };
});
