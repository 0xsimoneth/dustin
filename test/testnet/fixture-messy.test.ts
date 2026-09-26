import { expect, it } from "vitest";
import { buildMessyFixture } from "../../src/fixture/builder.js";
import {
  expectationFromManifest,
  loadVerifyInput,
  verifyFixture,
} from "../../src/fixture/verify.js";
import { DEFAULT_HORIZON_URL } from "../../src/config/network.js";
import { horizonJson } from "../../src/reader/horizon-json.js";
import { describeTestnet } from "./gate.js";

describeTestnet("messy fixture (live testnet)", () => {
  it("builds a fresh fixture that meets SOW Appendix B and holds zero spendable XLM", async () => {
    const { manifest, keys } = await buildMessyFixture();
    expect(manifest.verification.pass).toBe(true);
    expect(manifest.expected.spendable).toBe("0.0000000");
    expect(manifest.zeroSpendableProof).toEqual({
      resultCode: "tx_insufficient_balance",
      sequenceUnchanged: true,
    });
    expect(
      manifest.transactions.filter((t) => t.step !== "create-accounts").every((t) => t.feeBumped),
    ).toBe(true);
    expect(manifest.accounts.reserveSponsor).not.toBe(manifest.accounts.sponsor);
    expect(JSON.stringify(manifest)).not.toContain(keys.secrets.fixture);

    // Re-verify independently from Horizon.
    const again = verifyFixture(
      await loadVerifyInput(
        horizonJson(DEFAULT_HORIZON_URL),
        expectationFromManifest(manifest),
        manifest.accounts.fixture,
      ),
    );
    expect(again.checks.filter((c) => !c.pass)).toEqual([]);
  }, 300_000);
});
