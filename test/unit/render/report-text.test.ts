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
import { failedOps, recordIncludedFaults } from "../execute/harness.js";
import { noSleep } from "../../helpers/no-sleep.js";

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
  // Faults marked included are recorded on the fake ledger, as Horizon would (edge case E6).
  const fetch = recordIncludedFaults(ledger, ledger.fetch);
  const reader = horizonReader(horizonJson(TESTNET_HORIZON, { fetch, retries: 0 }));
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
      submitter: horizonSubmitter(TESTNET_HORIZON, { fetch }),
      sleep: noSleep,
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
      "0.0000000 XLM in fees paid by the account",
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
        // A failure no re-plan can fix (ADR-0006: op_cannot_delete stops the run); a vanished
        // market is no longer enough, because the executor falls down the ladder (E2-S3).
        if (e.type === "tx:confirmed" && e.index === 0) {
          ledger.faults.push(failedOps("op_success", "op_cannot_delete"));
        }
      },
    });
    expect(report.status).toBe("failed");
    const text = renderReport(report, { plans });
    expect(text.split("\n")[0]).toMatch(/FAILED/);
    expect(text).toContain("op_cannot_delete");
    expect(text).toMatch(/run the same command again/i);
    expect(text).toContain(`account ${messy.fixture} still exists on Horizon (200)`);
    within120(text);
  });

  it("describes each transaction with the plan of its own round after a re-plan", async () => {
    // The market disappears after the cleanup: the sale fails, the executor re-plans and returns
    // the asset to its issuer instead. Step ids restart in the new round, so a receipt that mixed
    // the rounds would describe the round-1 transaction with round-0 steps.
    const { report, plans } = await run(undefined, {
      onEvent: (e, ledger) => {
        if (e.type === "tx:confirmed" && e.index === 0) ledger.quotes.clear();
      },
    });
    expect(report.status).toBe("closed");
    expect(report.replans).toHaveLength(1);
    const text = renderReport(report, { plans });
    expect(text).toMatch(/Re-plans \(1;/);
    const split = text.search(/tx \d {2}\w+ {2}round 1/);
    const round0 = text.slice(0, split);
    const round1 = text.slice(split);
    expect(round0).toMatch(/operations {2}cancel offer/);
    expect(round0).not.toMatch(/DUSTA to issuer/);
    expect(round1).toMatch(/operations {2}return \S+ DUSTA to issuer \S+ \(burn\)/);
    expect(round1).not.toMatch(/operations {2}cancel offer/);
    within120(text);
  });

  it("does not say the run stopped before the close when the merge applied but was not verified", async () => {
    const { report, plans } = await run();
    const unverified = structuredClone(report);
    unverified.status = "failed";
    unverified.recovery.mergedXlm = "4.0000007";
    unverified.verification = null;
    const text = renderReport(unverified, { plans });
    expect(text.split("\n")[0]).toContain(
      "FAILED: the merge applied, but the account was not verified gone",
    );
    expect(text).not.toContain("stopped before the account was closed");
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
    extended.stop = {
      code: "OPERATION_FAILED",
      stage: "submit",
      verdict: "replan",
      detail: "stopped by the operator",
    };
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
    expect(text).toContain("Stop code    OPERATION_FAILED (stage submit, next: replan)");
    expect(text).toContain("stopped by the operator");
    expect(text).toContain("at ledger 5,000,123");
    expect(text).toMatch(/pending/);
    expect(text).not.toContain("somethingNew");
    within120(text);
  });

  it("says an unknown envelope may still apply, and names a copy saved while running", async () => {
    const { report, plans } = await run();
    const copy = structuredClone(report);
    copy.status = "running";
    copy.finishedAt = null;
    Object.assign(copy.transactions[0]!, { result: "unknown", mayStillApply: true, ledger: null });
    const text = renderReport(copy, { plans });
    expect(text.split("\n")[0]).toContain(
      "RUNNING: this copy was saved while the run was in progress",
    );
    expect(text).toContain("it may still apply until its time bound passes");
    expect(text).not.toContain("so it can never apply");
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
