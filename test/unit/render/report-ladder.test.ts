import { describe, expect, it } from "vitest";
import { executeClose, type CloseEvent } from "../../../src/execute/executor.js";
import type { CloseReport } from "../../../src/execute/report.js";
import { horizonSubmitter } from "../../../src/execute/submit.js";
import type { ClosePlan, PlanOptions } from "../../../src/plan/model.js";
import { planClose } from "../../../src/plan/plan-close.js";
import { horizonJson } from "../../../src/reader/horizon-json.js";
import { horizonReader } from "../../../src/reader/ledger-reader.js";
import { renderPlan, short } from "../../../src/render/plan-text.js";
import { renderReport } from "../../../src/render/report-text.js";
import type { Signer } from "../../../src/sponsor/signer.js";
import { FakeLedger } from "../../helpers/fake-ledger.js";
import { noSleep } from "../../helpers/no-sleep.js";
import { TESTNET_HORIZON } from "../../helpers/recorded-horizon.js";
import { messy } from "../../helpers/snapshots.js";
import { recordIncludedFaults } from "../execute/harness.js";

/**
 * The receipt of a ladder run (stories E3-S1 and E3-S2): what became of each leftover balance
 * (sold, burned, sent to the destination, with the rung it applied with and why it moved), and each
 * item no rung could dispose of, with its code, the rungs ruled out and the remedy.
 */

const signerFor = (publicKey: string): Signer => ({
  publicKey: () => publicKey,
  sign: () => undefined,
});

async function run(
  options: {
    mutate?: (ledger: FakeLedger) => void;
    plan?: Partial<PlanOptions>;
    allowPartial?: boolean;
    onEvent?: (e: CloseEvent, ledger: FakeLedger) => void;
  } = {},
): Promise<{ report: CloseReport; plans: ClosePlan[]; ledger: FakeLedger }> {
  const ledger = FakeLedger.messy();
  options.mutate?.(ledger);
  const fetch = recordIncludedFaults(ledger, ledger.fetch);
  const reader = horizonReader(horizonJson(TESTNET_HORIZON, { fetch, retries: 0 }));
  const plan = await planClose(
    {
      account: messy.fixture,
      destination: messy.destination,
      feeSponsor: messy.sponsor,
      ...options.plan,
    },
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
  return { report, plans, ledger };
}

const memoRequiredIssuer = (ledger: FakeLedger) => {
  const issuer = ledger.accounts.get(messy.issuer)!;
  issuer.data = { ...issuer.data, "config.memo_required": "MQ==" };
  issuer.subentry_count += 1;
};

const within120 = (text: string) => {
  for (const line of text.split("\n")) expect(line.length, line).toBeLessThanOrEqual(120);
};

/**
 * One section of the receipt, from its heading to the next blank line, with every run of
 * whitespace (indents and the wraps at 120 columns) turned into one space.
 */
const section = (text: string, heading: string): string => {
  const start = text.indexOf(`\n${heading}`);
  if (start < 0) return "";
  const end = text.indexOf("\n\n", start + 1);
  return text
    .slice(start + 1, end < 0 ? undefined : end)
    .replace(/\s+/g, " ")
    .trim();
};

describe("the receipt of a ladder run", () => {
  it("AC-E3-S2-1: says that each balance returned to its issuer was burned, and what was sold", async () => {
    const { report, plans } = await run();
    expect(report.status).toBe("closed");
    const text = renderReport(report, { plans });
    const disposals = section(text, "Disposals");
    const issuer = short(messy.issuer);
    expect(disposals).toMatch(/^Disposals \(what became of each leftover balance\)/);
    expect(disposals).toContain(
      "DUSTA 0.0000007 sold for XLM by path payment to the account itself in tx 2; the XLM left with the merge",
    );
    for (const [code, amount] of [
      ["DUSTB", "0.0000003"],
      ["DUSTC", "0.0000005"],
      ["SPTA", "0.0000001"],
    ]) {
      expect(disposals).toContain(
        `${code} ${amount} burned: returned to its issuer ${issuer} in tx 1`,
      );
    }
    within120(text);
  });

  it("AC-E3-S1-2: shows the sale that failed, the re-plan with its codes, and the burn that followed", async () => {
    const { report, plans } = await run({
      onEvent: (e, ledger) => {
        if (e.type === "tx:confirmed" && e.index === 0) ledger.quotes.clear();
      },
    });
    expect(report.status).toBe("closed");
    const text = renderReport(report, { plans });
    // Both attempts at DUSTA: the failed sale in round 0 and the burn in round 1.
    const flat = text.replace(/\s+/g, " ");
    expect(flat).toContain("tx 2 convert failed on the ledger");
    expect(flat).toContain("result tx_fee_bump_inner_failed, tx_failed, op_too_few_offers");
    expect(flat).toContain("tx 1 cleanup round 1 applied");
    expect(section(text, "Re-plans")).toMatch(
      /round 1 after tx 2 of round 0 failed \(tx_fee_bump_inner_failed, tx_failed, op_too_few_offers\)/,
    );
    expect(section(text, "Disposals")).toContain(
      `DUSTA 0.0000007 burned: returned to its issuer ${short(messy.issuer)} in tx 1 of round 1, after the sale by path payment failed with op_too_few_offers`,
    );
    within120(text);
  });

  it("AC-E3-S2-2: names a transfer to the destination", async () => {
    const { report, plans } = await run({ plan: { preferDestination: true } });
    expect(report.status).toBe("closed");
    const disposals = section(renderReport(report, { plans }), "Disposals");
    expect(disposals).toContain(
      `DUSTC 0.0000005 sent to the destination ${short(messy.destination)} in tx 1`,
    );
    expect(disposals).toContain(`DUSTB 0.0000003 burned: returned to its issuer`);
  });

  it("AC-E3-S2-3: lists each unclosable item with its code, the rungs ruled out and the remedy", async () => {
    const { report, plans } = await run({ mutate: memoRequiredIssuer, allowPartial: true });
    expect(report.status).toBe("partial");
    const text = renderReport(report, { plans });
    const notClosed = section(text, "Not closed");
    for (const [code, amount] of [
      ["DUSTB", "0.0000003"],
      ["SPTA", "0.0000001"],
    ]) {
      expect(notClosed).toContain(
        `NO_DISPOSAL_ROUTE ${amount} ${code} (issuer ${short(messy.issuer)})`,
      );
      expect(notClosed).toContain(
        `No route disposes of ${amount} ${code}; every rung of the ladder is ruled out:`,
      );
      expect(notClosed).toContain(
        `- send to destination: the destination holds no ${code} trustline`,
      );
    }
    expect(notClosed).toContain(
      "- path payment: Horizon found no strict-send path to XLM for the full balance",
    );
    expect(notClosed).toContain(
      `- return to issuer: issuer ${messy.issuer} requires a memo (SEP-29) and none was given`,
    );
    expect(notClosed).toContain("remedy: Make one route possible, then run the plan again: ");
    // The same items in the plan printed before the run.
    const planText = renderPlan(plans[0]!);
    const cannot = section(planText, "Cannot be disposed of");
    expect(cannot).toContain("every rung of the ladder is ruled out:");
    expect(cannot).toContain(`- send to destination: the destination holds no DUSTB trustline`);
    within120(text);
    within120(planText);
  });

  it("AC-E3-S2-4: names the limit to raise when a destination payment failed with op_line_full and no rung is left", async () => {
    const { report, plans } = await run({
      mutate: (ledger) => {
        memoRequiredIssuer(ledger);
        for (const code of ["DUSTB", "SPTA"]) {
          ledger.addTrustline(messy.destination, `${code}:${messy.issuer}`);
        }
      },
      onEvent: (e, ledger) => {
        // The destination's DUSTC trustline fills up between the fresh plan and the payment.
        if (e.type === "tx:building" && e.index === 0 && (e.round ?? 0) === 0) {
          const line = ledger.accounts
            .get(messy.destination)!
            .balances.find((b) => b.asset_code === "DUSTC")!;
          line.limit = line.balance;
        }
      },
    });
    expect(report.status).toBe("failed");
    const text = renderReport(report, { plans });
    expect(text).toContain("op_line_full");
    const notClosed = section(text, "Not closed");
    expect(notClosed).toContain("NO_DISPOSAL_ROUTE 0.0000005 DUSTC");
    expect(notClosed).toContain(
      "raise the destination's trustline limit for DUSTC (it has room for 0.0000000 of the 0.0000005 to send)",
    );
    within120(text);
  });
});
