import { describe, expect, it } from "vitest";
import { executeClose } from "../../../src/execute/executor.js";
import { messy } from "../../helpers/snapshots.js";
import { harness, signers } from "./harness.js";

// Review finding AA-9 (story E4-S1): the persisted report (`--report`, `--json`, the SDK's return
// value) says what each transaction did, operation by operation, and links the account, the
// destination and every transaction on the explorer and on Horizon, as the printed receipt does.

const HORIZON = "https://horizon-testnet.stellar.org";
const EXPLORER = "https://stellar.expert/explorer/testnet";

describe("the close report's operation summaries and links (AA-9)", () => {
  it("summarises every operation of every envelope, in the order of its steps", async () => {
    const { deps, plan } = harness();
    const approved = await plan();
    const report = await executeClose(approved, signers(), { confirm: true, ...deps });
    expect(report.status).toBe("closed");
    const steps = new Map(approved.steps.map((s) => [s.id, s]));
    expect(report.transactions.length).toBeGreaterThan(1);
    for (const tx of report.transactions) {
      expect(tx.operations?.map((o) => o.stepId)).toEqual(tx.stepIds);
      for (const op of tx.operations ?? []) {
        const step = steps.get(op.stepId)!;
        expect(op.kind).toBe(step.kind);
        expect(op.type).toBe(step.operation.type);
        expect(op.summary.length).toBeGreaterThan(0);
      }
    }
    const ops = report.transactions.flatMap((t) => t.operations ?? []);
    // An offer cancellation names the offer, a disposal its asset, amount, rung and recipient, a
    // data removal the entry, the merge its destination.
    const offer = ops.find((o) => o.kind === "cancel_offer")!;
    expect(offer).toMatchObject({
      type: "manageSellOffer",
      offerId: expect.any(String) as unknown,
    });
    expect(offer.subject).toBe(`offer ${offer.offerId}`);
    const sale = ops.find((o) => o.kind === "dispose_balance" && o.rung === "path_payment")!;
    expect(sale).toMatchObject({
      type: "pathPaymentStrictSend",
      asset: `DUSTA:${messy.issuer}`,
      to: messy.fixture,
    });
    expect(sale.amount).toMatch(/^\d+\.\d{7}$/);
    const burn = ops.find((o) => o.kind === "dispose_balance" && o.rung === "return_to_issuer")!;
    expect(burn).toMatchObject({ type: "payment", to: messy.issuer });
    const removal = ops.find((o) => o.kind === "remove_trustline")!;
    expect(removal.type).toBe("changeTrust");
    expect(removal.asset).toMatch(/^[A-Z0-9]+:G[A-Z2-7]{55}$/);
    expect(removal.subject).toBe(`trustline ${removal.asset}`);
    const data = ops.find((o) => o.kind === "remove_data")!;
    expect(data).toMatchObject({ type: "manageData", dataName: expect.any(String) as unknown });
    expect(data.subject).toBe(`data entry ${data.dataName}`);
    const merge = ops.find((o) => o.kind === "merge")!;
    expect(merge).toMatchObject({
      type: "accountMerge",
      to: messy.destination,
      subject: "account",
    });
    expect(merge.summary).toMatch(/cannot be undone/);
  });

  it("links each envelope on Horizon next to the explorer", async () => {
    const { deps, plan } = harness();
    const report = await executeClose(await plan(), signers(), { confirm: true, ...deps });
    for (const tx of report.transactions) {
      expect(tx.explorerUrl).toBe(`${EXPLORER}/tx/${tx.hash}`);
      expect(tx.horizonUrl).toBe(`${HORIZON}/transactions/${tx.hash}`);
    }
  });

  it("links the account and the destination on the explorer and on Horizon", async () => {
    const { deps, plan } = harness();
    const report = await executeClose(await plan(), signers(), { confirm: true, ...deps });
    expect(report.links).toEqual({
      account: {
        explorer: `${EXPLORER}/account/${messy.fixture}`,
        horizon: `${HORIZON}/accounts/${messy.fixture}`,
      },
      destination: {
        explorer: `${EXPLORER}/account/${messy.destination}`,
        horizon: `${HORIZON}/accounts/${messy.destination}`,
      },
    });
  });

  it("has the links in a report that submitted nothing too", async () => {
    const { ledger, deps, plan } = harness();
    const approved = await plan();
    // The account changes before the executor plans again: it aborts before signing.
    const account = ledger.accounts.get(messy.fixture)!;
    account.data = { ...account.data, late: "MQ==" };
    account.subentry_count += 1;
    const report = await executeClose(approved, signers(), { confirm: true, ...deps });
    expect(report.status).toBe("aborted");
    expect(report.links?.account.horizon).toBe(`${HORIZON}/accounts/${messy.fixture}`);
  });

  it("links a muxed destination through its G account", async () => {
    const { deps, plan } = harness();
    const { MuxedAccount, Account } = await import("@stellar/stellar-sdk");
    const muxed = new MuxedAccount(new Account(messy.destination, "0"), "7").accountId();
    const report = await executeClose(await plan({ destination: muxed }), signers(), {
      confirm: true,
      ...deps,
    });
    expect(report.destination).toBe(muxed);
    expect(report.links?.destination).toEqual({
      explorer: `${EXPLORER}/account/${messy.destination}`,
      horizon: `${HORIZON}/accounts/${messy.destination}`,
    });
  });
});
