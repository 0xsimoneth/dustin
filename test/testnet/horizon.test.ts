import { Networks } from "@stellar/stellar-sdk";
import { expect, it } from "vitest";
import { describeTestnet } from "./gate.js";

describeTestnet("public testnet Horizon", () => {
  it("answers with the testnet network passphrase", async () => {
    const res = await fetch("https://horizon-testnet.stellar.org/");
    const root = (await res.json()) as { network_passphrase: string };
    expect(root.network_passphrase).toBe(Networks.TESTNET);
    expect(Networks.TESTNET).toBe("Test SDF Network ; September 2015");
  });
});
