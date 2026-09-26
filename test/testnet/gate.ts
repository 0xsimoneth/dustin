import { describe } from "vitest";

/** The testnet tier runs only when DUSTIN_TESTNET=1 (docs/adr/ADR-0005-testing-strategy.md). */
export const testnetEnabled = process.env.DUSTIN_TESTNET === "1";

export const describeTestnet = testnetEnabled ? describe : describe.skip;
