import { expect, it } from "vitest";
import { planClose } from "../../src/plan/plan-close.js";
import { DEFAULT_HORIZON_URL } from "../../src/config/network.js";
import { horizonJson } from "../../src/reader/horizon-json.js";
import { buildMessyFixture } from "../../src/fixture/builder.js";
import { describeTestnet } from "./gate.js";

describeTestnet("planClose on a live fixture (testnet)", () => {
  it("plans a closable close and leaves the account untouched", async () => {
    const { manifest } = await buildMessyFixture();
    const client = horizonJson(DEFAULT_HORIZON_URL);
    const before = await client.get<{ sequence: string; subentry_count: number }>(
      `/accounts/${manifest.accounts.fixture}`,
    );
    const plan = await planClose({
      account: manifest.accounts.fixture,
      destination: manifest.accounts.destination,
      feeSponsor: manifest.accounts.sponsor,
    });
    const after = await client.get<{ sequence: string; subentry_count: number }>(
      `/accounts/${manifest.accounts.fixture}`,
    );
    expect(plan.status).toBe("closable");
    expect(plan.transactions.map((t) => t.phase)).toEqual(["cleanup", "convert", "merge"]);
    expect(after?.sequence).toBe(before?.sequence);
    expect(after?.subentry_count).toBe(before?.subentry_count);
  }, 300_000);
});
