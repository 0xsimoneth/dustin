import { Keypair } from "@stellar/stellar-sdk";
import { expect, it } from "vitest";
import { toStroops } from "../../src/amounts.js";
import { DEFAULT_HORIZON_URL } from "../../src/config/network.js";
import { executeClose } from "../../src/execute/executor.js";
import { buildMessyFixture } from "../../src/fixture/builder.js";
import type { HorizonAccount } from "../../src/inspect/horizon-types.js";
import { planClose } from "../../src/plan/plan-close.js";
import { horizonJson } from "../../src/reader/horizon-json.js";
import { keypairSigner } from "../../src/sponsor/signer.js";
import { describeTestnet } from "./gate.js";

describeTestnet("executeClose (live testnet)", () => {
  it("closes a fresh zero-spendable messy fixture with every fee paid by the sponsor", async () => {
    const { manifest, keys } = await buildMessyFixture();
    const a = manifest.accounts;
    const client = horizonJson(DEFAULT_HORIZON_URL);
    const native = async (id: string) =>
      toStroops(
        (await client.get<HorizonAccount>(`/accounts/${id}`))!.balances.find(
          (b) => b.asset_type === "native",
        )!.balance,
      );
    const destinationBefore = await native(a.destination);

    const plan = await planClose({
      account: a.fixture,
      destination: a.destination,
      feeSponsor: a.sponsor,
    });
    expect(plan.status).toBe("closable");
    const report = await executeClose(
      plan,
      {
        account: keypairSigner(Keypair.fromSecret(keys.secrets.fixture)),
        feeSponsor: keypairSigner(Keypair.fromSecret(keys.secrets.sponsor)),
      },
      { confirm: true },
    );
    expect(report.message).toBeNull();
    expect(report.status).toBe("closed");
    expect(report.verification).toMatchObject({ accountExists: false, horizonStatus: 404 });
    expect(await client.get(`/accounts/${a.fixture}`)).toBeNull();

    // Every transaction is a fee bump paid by the sponsor, sourced by the closed account.
    for (const t of report.transactions) {
      const record = await client.get<{
        fee_account: string;
        source_account: string;
        successful: boolean;
      }>(`/transactions/${t.hash}`);
      expect(record).toMatchObject({
        fee_account: a.sponsor,
        source_account: a.fixture,
        successful: true,
      });
    }
    // The destination received exactly the merged amount; the reserve sponsor got its reserve back.
    expect(report.recovery.mergedXlm).not.toBeNull();
    expect((await native(a.destination)) - destinationBefore).toBe(
      toStroops(report.recovery.mergedXlm!),
    );
    const reserveSponsor = await client.get<HorizonAccount>(`/accounts/${a.reserveSponsor}`);
    expect(reserveSponsor!.num_sponsoring).toBe(0);
    expect(JSON.stringify(report)).not.toContain(keys.secrets.fixture);
    expect(JSON.stringify(report)).not.toContain(keys.secrets.sponsor);
  }, 600_000);
});
