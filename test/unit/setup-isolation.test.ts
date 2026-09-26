import { describe, expect, it, vi } from "vitest";

describe("unit tier stays offline after tests restore globals", () => {
  it("unstubbing globals in one test does not re-enable the network in the next", () => {
    vi.stubGlobal("fetch", vi.fn());
    vi.unstubAllGlobals();
  });

  it("fetch is still blocked", async () => {
    await expect(fetch("https://horizon-testnet.stellar.org")).rejects.toThrow(/network access/);
  });
});
