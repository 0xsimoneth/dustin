import { Horizon } from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";
import { buildProgram } from "../../src/cli/program.js";
import { DustinError, executeClose, planClose } from "../../src/index.js";

describe("public API stubs", () => {
  it("planClose rejects with NOT_IMPLEMENTED", async () => {
    await expect(planClose()).rejects.toMatchObject({
      name: "DustinError",
      code: "NOT_IMPLEMENTED",
    });
  });

  it("executeClose rejects with NOT_IMPLEMENTED", async () => {
    await expect(executeClose()).rejects.toBeInstanceOf(DustinError);
  });
});

describe("CLI program", () => {
  it("lists the plan and close commands", () => {
    const help = buildProgram("0.0.0").helpInformation();
    expect(help).toMatch(/\bplan\b/);
    expect(help).toMatch(/\bclose\b/);
  });
});

describe("unit tier isolation", () => {
  it("refuses network access", async () => {
    await expect(fetch("https://horizon-testnet.stellar.org")).rejects.toThrow(/network access/);
  });

  it("refuses Horizon calls made through the SDK", async () => {
    const server = new Horizon.Server("https://horizon-testnet.stellar.org");
    await expect(server.feeStats()).rejects.toThrow(/network access/);
  });
});
