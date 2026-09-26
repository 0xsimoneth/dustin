import { defineConfig } from "vitest/config";

// Two tiers (docs/adr/ADR-0005-testing-strategy.md): `unit` runs offline on every commit;
// `testnet` talks to the public testnet and only runs when DUSTIN_TESTNET=1.
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "unit",
          include: ["test/unit/**/*.test.ts"],
          setupFiles: ["test/setup/no-network.ts"],
        },
      },
      {
        test: {
          name: "testnet",
          include: ["test/testnet/**/*.test.ts"],
          globalSetup: ["test/setup/testnet-gate.ts"],
          testTimeout: 120_000,
          hookTimeout: 120_000,
        },
      },
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: ["src/**/*.ts"],
    },
  },
});
