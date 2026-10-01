import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// The page imports the SDK as `stellar-dustin`, resolved to the repository's built ESM entry
// (../dist/index.js) and its declarations (tsconfig.json `paths`): the demo consumes the artifact
// an integrator installs, so scripts/check-browser-safe.mjs and this page test the same code, and
// the SDK's runtime dependency, @stellar/stellar-sdk, resolves from the root node_modules at the
// version the root lockfile pins; no `file:` dependency, whose install would pull the root's
// devDependencies into this folder (docs/web-demo.md, "Architecture"). Build the root first.
const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const sdkEntry = fileURLToPath(new URL("../dist/index.js", import.meta.url));

export default defineConfig({
  // Relative asset paths, so the built page works from any directory or path prefix.
  base: "./",
  resolve: { alias: { "stellar-dustin": sdkEntry } },
  server: { fs: { allow: [repoRoot] } },
  build: { target: "es2022", sourcemap: true },
  test: { include: ["test/**/*.test.ts"], environment: "node" },
});
