import { defineConfig } from "tsup";

export default defineConfig([
  {
    // SDK and stellar-dustin/testing: ESM and CommonJS with declarations for both. Splitting keeps
    // the modules the two entries share in shared chunks, in both formats, so an error the testing
    // helpers throw is an instance of the DustinError that stellar-dustin exports (PRD D-18).
    entry: { index: "src/index.ts", testing: "src/testing.ts" },
    format: ["esm", "cjs"],
    splitting: true,
    dts: true,
    sourcemap: true,
    clean: false,
    target: "node22",
    platform: "node",
  },
  {
    // CLI: ESM only; the shebang in src/cli/main.ts makes the file executable.
    entry: { "cli/main": "src/cli/main.ts" },
    format: ["esm"],
    dts: false,
    sourcemap: true,
    clean: false,
    target: "node22",
    platform: "node",
  },
]);
