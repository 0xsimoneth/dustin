import { describe, expect, it, vi } from "vitest";
import { executeClose, type CloseEvent } from "../../../src/execute/executor.js";
import { horizonSubmitter } from "../../../src/execute/submit.js";
import { planClose } from "../../../src/plan/plan-close.js";
import { horizonJson } from "../../../src/reader/horizon-json.js";
import { horizonReader } from "../../../src/reader/ledger-reader.js";
import { FakeLedger } from "../../helpers/fake-ledger.js";
import { noSleep } from "../../helpers/no-sleep.js";
import { TESTNET_HORIZON } from "../../helpers/recorded-horizon.js";
import { messy } from "../../helpers/snapshots.js";
import { recordIncludedFaults } from "./harness.js";

/**
 * Review finding BH-7 (docs/reviews/2026-09-27-e2-integration-review.md, "Deferred"): the plan hash
 * leaves out quotes and destMin, so a worse quote while the confirmation waits would lower the
 * merged amount without a drift. Builder decision: before anything is signed, the fresh plan's
 * `recovery.xlmToDestination` is compared with the approved plan's; a lower fresh value is drift
 * and follows `onDrift` like a changed plan hash. A higher value is not drift.
 */

// Signers that count their signatures: "nothing signed" is checked on them, not only on the ledger.
const countingSigners = () => ({
  account: { publicKey: () => messy.fixture, sign: vi.fn(() => undefined) },
  feeSponsor: { publicKey: () => messy.sponsor, sign: vi.fn(() => undefined) },
});

function setup() {
  const ledger = FakeLedger.messy();
  const fetch = recordIncludedFaults(ledger, ledger.fetch);
  const reader = horizonReader(horizonJson(TESTNET_HORIZON, { fetch, retries: 0 }));
  const submitter = horizonSubmitter(TESTNET_HORIZON, { fetch });
  const deps = { reader, submitter, sleep: noSleep };
  const plan = () =>
    planClose(
      { account: messy.fixture, destination: messy.destination, feeSponsor: messy.sponsor },
      { reader },
    );
  // The recorded fixture's only market: DUSTA sells for 0.0000007 XLM.
  const dusta = [...ledger.quotes.keys()][0]!;
  return { ledger, deps, plan, dusta };
}

describe("BH-7: the amount the user confirmed is enforced before anything is signed", () => {
  it("aborts with nothing signed when a quote falls between planning and execution", async () => {
    const { ledger, deps, plan, dusta } = setup();
    const approved = await plan();
    expect(approved.recovery.xlmToDestination).toBe("4.0000007");
    // A worse quote while the confirmation waits: the plan's structure (and hash) is unchanged.
    ledger.quotes.set(dusta, "0.0000003");
    const signers = countingSigners();
    const events: CloseEvent[] = [];
    const report = await executeClose(approved, signers, {
      confirm: true,
      ...deps,
      onEvent: (e) => events.push(e),
    });

    expect(report.status).toBe("aborted");
    expect(report.planHash).toBe(approved.planHash);
    expect(report.stop).toMatchObject({
      code: "XLM_TO_DESTINATION_FELL",
      stage: "plan",
      verdict: "replan",
      xlmToDestination: { approved: "4.0000007", fresh: "4.0000003" },
    });
    expect(report.stop!.detail).toContain("4.0000007");
    expect(report.stop!.detail).toContain("4.0000003");
    expect(report.message).toBe(report.stop!.detail);
    expect(events.find((e) => e.type === "drift")).toMatchObject({
      action: "abort",
      previousPlanHash: approved.planHash,
      planHash: approved.planHash,
      xlmToDestination: { approved: "4.0000007", fresh: "4.0000003" },
    });
    expect(report.transactions).toHaveLength(0);
    expect(ledger.submissions).toHaveLength(0);
    expect(signers.account.sign).not.toHaveBeenCalled();
    expect(signers.feeSponsor.sign).not.toHaveBeenCalled();
  });

  it("goes on with the fresh plan and a warning under onDrift replan", async () => {
    const { ledger, deps, plan, dusta } = setup();
    const approved = await plan();
    ledger.quotes.set(dusta, "0.0000003");
    const before = ledger.native(messy.destination);
    const events: CloseEvent[] = [];
    const report = await executeClose(approved, countingSigners(), {
      confirm: true,
      onDrift: "replan",
      ...deps,
      onEvent: (e) => events.push(e),
    });

    expect(report.status).toBe("closed");
    expect(report.stop).toBeNull();
    expect(report.warnings.some((w) => /fell from 4\.0000007 XLM to 4\.0000003 XLM/.test(w))).toBe(
      true,
    );
    expect(events.find((e) => e.type === "drift")).toMatchObject({ action: "replan" });
    // The destination receives what the fresh plan said, not what the approved plan said.
    expect(ledger.native(messy.destination) - before).toBe(40_000_003n);
  });

  it("goes on silently when the quote rises", async () => {
    const { ledger, deps, plan, dusta } = setup();
    const approved = await plan();
    ledger.quotes.set(dusta, "0.0000009");
    const before = ledger.native(messy.destination);
    const events: CloseEvent[] = [];
    const report = await executeClose(approved, countingSigners(), {
      confirm: true,
      ...deps,
      onEvent: (e) => events.push(e),
    });

    expect(report.status).toBe("closed");
    expect(events.some((e) => e.type === "drift")).toBe(false);
    expect(report.warnings.filter((w) => /fell from/.test(w))).toEqual([]);
    expect(ledger.native(messy.destination) - before).toBe(40_000_009n);
  });

  it("names both amounts in the PLAN_CHANGED stop when the plan hash changed as well", async () => {
    const { ledger, deps, plan, dusta } = setup();
    const approved = await plan();
    ledger.quotes.set(dusta, "0.0000003");
    const account = ledger.accounts.get(messy.fixture)!;
    account.data = { ...account.data, late: "MQ==" };
    account.subentry_count += 1;
    const report = await executeClose(approved, countingSigners(), { confirm: true, ...deps });

    expect(report.status).toBe("aborted");
    expect(report.stop).toMatchObject({
      code: "PLAN_CHANGED",
      xlmToDestination: { approved: "4.0000007", fresh: "4.0000003" },
    });
    expect(report.stop!.detail).toMatch(/fell from 4\.0000007 XLM to 4\.0000003 XLM/);
    expect(ledger.submissions).toHaveLength(0);
  });

  it("keeps the rule for mid-run re-plans: a failed sale that moves down the ladder is not drift", async () => {
    const { ledger, deps, plan } = setup();
    const approved = await plan();
    const report = await executeClose(approved, countingSigners(), {
      confirm: true,
      ...deps,
      onEvent: (e) => {
        // The market vanishes after the cleanup: the sale fails and DUSTA is burned instead, which
        // lowers the proceeds by design (canonical decision 8).
        if (e.type === "tx:confirmed" && e.index === 0) ledger.quotes.clear();
      },
    });

    expect(report.status).toBe("closed");
    expect(report.replans).toHaveLength(1);
    expect(report.replans[0]!.drift).toEqual([]);
    expect(report.warnings.filter((w) => /fell from/.test(w))).toEqual([]);
  });
});
