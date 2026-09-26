import { describe, expect, it } from "vitest";
import { executeClose, type CloseEvent } from "../../../src/execute/executor.js";
import type { CloseReport } from "../../../src/execute/report.js";
import { horizonSubmitter } from "../../../src/execute/submit.js";
import type { ClosePlan } from "../../../src/plan/model.js";
import { planClose } from "../../../src/plan/plan-close.js";
import { horizonJson } from "../../../src/reader/horizon-json.js";
import { horizonReader } from "../../../src/reader/ledger-reader.js";
import { renderReport } from "../../../src/render/report-text.js";
import type { Signer } from "../../../src/sponsor/signer.js";
import { FakeLedger } from "../../helpers/fake-ledger.js";
import { TESTNET_HORIZON } from "../../helpers/recorded-horizon.js";
import { messy } from "../../helpers/snapshots.js";

// The fake ledger does not verify signatures, so signers only need the right public keys.
const signerFor = (publicKey: string): Signer => ({
  publicKey: () => publicKey,
  sign: () => undefined,
});

async function run(
  mutate: (ledger: FakeLedger) => void = () => {},
  options: { allowPartial?: boolean; onEvent?: (e: CloseEvent, ledger: FakeLedger) => void } = {},
): Promise<{ report: CloseReport; plans: ClosePlan[] }> {
  const ledger = FakeLedger.messy();
  mutate(ledger);
  const reader = horizonReader(
    horizonJson(TESTNET_HORIZON, { fetch: ledger.fetch, retries: 0, backoffMs: 0 }),
  );
  const plan = await planClose(
    { account: messy.fixture, destination: messy.destination, feeSponsor: messy.sponsor },
    { reader },
  );
  const plans: ClosePlan[] = [];
  const report = await executeClose(
    plan,
    { account: signerFor(messy.fixture), feeSponsor: signerFor(messy.sponsor) },
    {
      confirm: true,
      reader,
      submitter: horizonSubmitter(TESTNET_HORIZON, { fetch: ledger.fetch }),
      pollIntervalMs: 0,
      ...(options.allowPartial ? { allowPartial: true } : {}),
      onEvent: (e) => {
        if (e.type === "plan") plans.push(e.plan);
        options.onEvent?.(e, ledger);
      },
    },
  );
  return { report, plans };
}

const within120 = (text: string) => {
  for (const line of text.split("\n")) expect(line.length, line).toBeLessThanOrEqual(120);
};

describe("renderReport", () => {
  it("prints a closed run as a receipt a reviewer can verify", async () => {
    const { report, plans } = await run();
    expect(report.status).toBe("closed");
    const text = renderReport(report, { plans });
    expect(text.split("\n")[0]).toMatch(/^Dustin close receipt {3}CLOSED/);
    for (const needle of [
      `Account      ${messy.fixture}`,
      `Destination  ${messy.destination}`,
      `Sponsor      ${messy.sponsor}`,
      "Transactions (3 submitted",
      "cancel offer 826680",
      'delete data entry "dustin.fixture"',
      "sell 0.0000007 DUSTA for XLM",
      "merge into",
      "0.5000000 XLM reserve returned to sponsor",
      "0 XLM in fees paid by the account",
      "0.0001500 XLM (1,500 stroops) in fees paid by the sponsor",
      `https://stellar.expert/explorer/testnet/account/${messy.fixture}`,
      `https://stellar.expert/explorer/testnet/account/${messy.destination}`,
      `account ${messy.fixture} no longer exists on Horizon (404)`,
    ]) {
      expect(text, needle).toContain(needle);
    }
    for (const t of report.transactions) {
      expect(text).toContain(`outer hash  ${t.hash}`);
      expect(text).toContain(`inner hash  ${t.innerHash}`);
      expect(text).toContain(t.explorerUrl);
    }
    expect(text.match(/^ {2}tx \d/gm)).toHaveLength(3);
    within120(text);
  });

  it("names the merged amount when the merge result carries it, and says so when it does not", async () => {
    const { report, plans } = await run();
    // The fake ledger returns no result XDR, so the amount is unknown here.
    expect(report.recovery.mergedXlm).toBeNull();
    expect(renderReport(report, { plans })).toMatch(
      /merged amount is not in the transaction result/,
    );
    const withAmount = structuredClone(report);
    withAmount.recovery.mergedXlm = "4.0000007";
    expect(renderReport(withAmount, { plans })).toContain(
      "4.0000007 XLM merged into the destination",
    );
  });

  it("prints a failed run with the result codes and the way to continue", async () => {
    const { report, plans } = await run(undefined, {
      onEvent: (e, ledger) => {
        if (e.type === "tx:confirmed" && e.index === 0) ledger.quotes.clear();
      },
    });
    expect(report.status).toBe("failed");
    const text = renderReport(report, { plans });
    expect(text.split("\n")[0]).toMatch(/FAILED/);
    expect(text).toContain("op_too_few_offers");
    expect(text).toMatch(/run the same command again/i);
    expect(text).toContain(`account ${messy.fixture} still exists on Horizon (200)`);
    within120(text);
  });

  it("prints a partial run with the unclosable items and their remedies", async () => {
    const { report, plans } = await run(
      (ledger) => {
        const dustb = ledger.accounts
          .get(messy.fixture)!
          .balances.find((b) => b.asset_code === "DUSTB")!;
        Object.assign(dustb, {
          is_authorized: false,
          is_authorized_to_maintain_liabilities: false,
        });
      },
      { allowPartial: true },
    );
    expect(report.status).toBe("partial");
    const text = renderReport(report, { plans });
    expect(text.split("\n")[0]).toMatch(/PARTIAL/);
    expect(text).toContain("TRUSTLINE_NOT_AUTHORIZED");
    expect(text).toContain("remedy:");
    expect(text).toMatch(/no merge/i);
    within120(text);
  });

  it("renders fields a later executor may add, and a transaction whose outcome is unknown", async () => {
    const { report, plans } = await run();
    const extended = structuredClone(report) as CloseReport & Record<string, unknown>;
    extended.stopReason = "stopped by the operator";
    extended.status = "failed";
    extended.message = "Transaction 3 (merge) did not finish.";
    Object.assign(extended.verification!, { ledger: 5_000_123, accountExists: true });
    Object.assign(extended.transactions[0]!, { attempt: 2, somethingNew: { nested: true } });
    Object.assign(extended.transactions[2]!, {
      result: "pending",
      ledger: null,
      feeChargedStroops: null,
    });
    const text = renderReport(extended, { plans });
    expect(text).toMatch(/tx 1 {2}cleanup {2}attempt 2/);
    expect(text).toContain("stopped by the operator");
    expect(text).toContain("at ledger 5,000,123");
    expect(text).toMatch(/pending/);
    expect(text).not.toContain("somethingNew");
    within120(text);
  });

  it("works without the plan, naming the steps by id", async () => {
    const { report } = await run();
    const text = renderReport(report);
    expect(text).toContain(report.transactions[0]!.stepIds[0]!);
    within120(text);
  });

  it("prints an aborted run as nothing submitted", async () => {
    const { report, plans } = await run((ledger) => {
      const dustb = ledger.accounts
        .get(messy.fixture)!
        .balances.find((b) => b.asset_code === "DUSTB")!;
      Object.assign(dustb, { is_authorized: false, is_authorized_to_maintain_liabilities: false });
    });
    expect(report.status).toBe("aborted");
    const text = renderReport(report, { plans });
    expect(text.split("\n")[0]).toMatch(/ABORTED: nothing was submitted/);
    expect(text).toContain("Transactions (none submitted)");
    within120(text);
  });
});
