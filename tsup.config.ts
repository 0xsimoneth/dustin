import { defineConfig } from "tsup";

export default defineConfig([
  {
    // SDK: ESM and CommonJS with declarations for both.
    entry: { index: "src/index.ts" },
    format: ["esm", "cjs"],
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
