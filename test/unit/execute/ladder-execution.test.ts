import { describe, expect, it, vi } from "vitest";
import { executeClose, type ExecuteOptions } from "../../../src/execute/executor.js";
import type { CloseReport } from "../../../src/execute/report.js";
import { horizonSubmitter } from "../../../src/execute/submit.js";
import type { ClosePlan, CloseStep, PlanOptions } from "../../../src/plan/model.js";
import { planClose } from "../../../src/plan/plan-close.js";
import { horizonJson } from "../../../src/reader/horizon-json.js";
import { horizonReader } from "../../../src/reader/ledger-reader.js";
import { FakeLedger } from "../../helpers/fake-ledger.js";
import { noSleep } from "../../helpers/no-sleep.js";
import { TESTNET_HORIZON } from "../../helpers/recorded-horizon.js";
import { messy } from "../../helpers/snapshots.js";
import { recordIncludedFaults } from "./harness.js";
import { beforeFirstSale } from "./submit-hooks.js";

/**
 * Stories E3-S1 and E3-S2 on the fake ledger (test/helpers/fake-ledger.ts): the executor runs each
 * rung of the disposal ladder and falls down it when the ledger answers a failure, and the matrix
 * rows of docs/edge-cases-and-test-matrix.md section 4 that the ladder covers (S-01, X-06, X-10,
 * X-11). The live counterparts are in test/testnet/ladder.test.ts.
 */

const countingSigners = () => ({
  account: { publicKey: () => messy.fixture, sign: vi.fn(() => undefined) },
  feeSponsor: { publicKey: () => messy.sponsor, sign: vi.fn(() => undefined) },
});

function setup(mutate: (ledger: FakeLedger) => void = () => {}) {
  const ledger = FakeLedger.messy();
  mutate(ledger);
  const fetch = recordIncludedFaults(ledger, ledger.fetch);
  const reader = horizonReader(horizonJson(TESTNET_HORIZON, { fetch, retries: 0 }));
  const submitter = horizonSubmitter(TESTNET_HORIZON, { fetch });
  const deps = { reader, submitter, sleep: noSleep } satisfies Partial<ExecuteOptions>;
  const plan = (extra: Partial<PlanOptions> = {}) =>
    planClose(
      {
        account: messy.fixture,
        destination: messy.destination,
        feeSponsor: messy.sponsor,
        ...extra,
      },
      { reader },
    );
  return { ledger, deps, plan };
}

const asset = (code: string) => `${code}:${messy.issuer}`;
const disposalOf = (plan: ClosePlan, code: string): CloseStep =>
  plan.steps.find(
    (s) =>
      s.kind === "dispose_balance" &&
      s.subject.type === "trustline" &&
      s.subject.asset.code === code,
  )!;
const outcomeOf = (report: CloseReport, plan: ClosePlan, code: string) =>
  report.steps.find((s) => s.stepId === disposalOf(plan, code).id)!;
const lineOf = (ledger: FakeLedger, account: string, code: string) =>
  ledger.accounts.get(account)?.balances.find((b) => b.asset_code === code);
const memoRequiredIssuer = (ledger: FakeLedger) => {
  const issuer = ledger.accounts.get(messy.issuer)!;
  issuer.data = { ...issuer.data, "config.memo_required": "MQ==" };
  issuer.subentry_count += 1;
};

describe("E3-S1: the path-payment sale", () => {
  it("AC-E3-S1-2 (offline): the market vanishes between the fresh plan and the sale: op_too_few_offers, a re-plan to the burn, and the close completes", async () => {
    const { ledger, deps, plan } = setup();
    const approved = await plan();
    expect(disposalOf(approved, "DUSTA").disposal!.rung).toBe("path_payment");
    // The market maker cancels its bid right before the sale is posted, after the fresh plan.
    const submitter = beforeFirstSale(deps.submitter, () => {
      ledger.quotes.clear();
      return Promise.resolve();
    });
    const plans: ClosePlan[] = [];
    const report = await executeClose(approved, countingSigners(), {
      confirm: true,
      ...deps,
      submitter,
      onEvent: (e) => {
        if (e.type === "plan") plans.push(e.plan);
      },
    });

    expect(submitter.fired()).toBe(true);
    expect(report.status).toBe("closed");
    expect(ledger.accounts.has(messy.fixture)).toBe(false);
    // Both attempts at DUSTA: the failed sale (sequence number and fee spent) and the burn.
    expect(report.transactions.map((t) => [t.round, t.phase, t.result])).toEqual([
      [0, "cleanup", "applied"],
      [0, "convert", "failed"],
      [1, "cleanup", "applied"],
    ]);
    const sale = report.transactions[1]!;
    expect(sale.resultCodes?.operations?.[0]).toBe("op_too_few_offers");
    expect(sale.feeChargedStroops).toBeGreaterThan(0);
    expect(report.transactions[2]!.sequence).toBe((BigInt(sale.sequence) + 1n).toString());
    expect(report.replans).toHaveLength(1);
    expect(report.replans[0]).toMatchObject({
      round: 1,
      demoted: [asset("DUSTA")],
      drift: [],
      trigger: { round: 0, txIndex: 1, hash: sale.hash, stepId: disposalOf(approved, "DUSTA").id },
    });
    expect(report.replans[0]!.trigger.resultCodes.operations?.[0]).toBe("op_too_few_offers");
    expect(disposalOf(plans[1]!, "DUSTA").disposal!.rung).toBe("return_to_issuer");
    expect(outcomeOf(report, approved, "DUSTA")).toMatchObject({
      status: "applied",
      rung: "return_to_issuer",
      round: 1,
      failures: 1,
    });
  });

  it("X-10 (offline): a sale that would pay less than 1 stroop at execution fails and the dust is burned", async () => {
    const { ledger, deps, plan } = setup();
    // At planning the market pays 1 stroop for the dust, so the sale is planned with destMin 1.
    ledger.quotes.set(asset("DUSTA"), "0.0000001");
    const approved = await plan();
    expect(disposalOf(approved, "DUSTA").disposal).toMatchObject({
      rung: "path_payment",
      destMinXlm: "0.0000001",
    });
    const submitter = beforeFirstSale(deps.submitter, () => {
      // By the time the sale lands the price rounds the dust to 0 XLM (docs edge case B-01).
      ledger.quotes.set(asset("DUSTA"), "0.0000000");
      return Promise.resolve();
    });
    const report = await executeClose(approved, countingSigners(), {
      confirm: true,
      ...deps,
      submitter,
    });

    expect(report.status).toBe("closed");
    // The fake ledger answers op_under_dest_min here; the live run records what testnet answers.
    expect(["op_too_few_offers", "op_under_dest_min"]).toContain(
      report.transactions[1]!.resultCodes?.operations?.[0],
    );
    expect(outcomeOf(report, approved, "DUSTA")).toMatchObject({
      status: "applied",
      rung: "return_to_issuer",
    });
  });

  it("X-11 (offline): the account's own offers are the only liquidity: DUSTA is burned, never sold", async () => {
    const { ledger, deps, plan } = setup((l) => {
      // An own offer that sells XLM for DUSTA is the only liquidity for a DUSTA -> XLM sale.
      const account = l.accounts.get(messy.fixture)!;
      l.offers.get(messy.fixture)!.push({
        id: "999",
        seller: messy.fixture,
        selling: { asset_type: "native" },
        buying: {
          asset_type: "credit_alphanum12",
          asset_code: "DUSTA",
          asset_issuer: messy.issuer,
        },
        amount: "0.0000007",
        price: "1.0000000",
        price_r: { n: 1, d: 1 },
      });
      account.subentry_count += 1;
    });
    const approved = await plan();
    const dusta = disposalOf(approved, "DUSTA");
    expect(dusta.disposal!.rung).toBe("return_to_issuer");
    expect(dusta.disposal!.ruledOut.find((r) => r.rung === "path_payment")?.reason).toMatch(
      /own offer 999/,
    );
    const report = await executeClose(approved, countingSigners(), { confirm: true, ...deps });

    expect(report.status).toBe("closed");
    expect(report.transactions.map((t) => t.phase)).toEqual(["cleanup"]);
    expect(ledger.accounts.has(messy.fixture)).toBe(false);
  });
});

describe("E3-S2: the return to issuer, the destination transfer and unclosable items", () => {
  it("S-01 (offline): the illiquid DUSTB (no market, live issuer) is burned and its trustline removed", async () => {
    const { ledger, deps, plan } = setup();
    const approved = await plan();
    const dustb = disposalOf(approved, "DUSTB");
    expect(dustb.disposal).toMatchObject({ rung: "return_to_issuer", to: messy.issuer });
    expect(dustb.reason).toMatch(/no strict-send path/);
    expect(dustb.operation).toMatchObject({
      type: "payment",
      destination: messy.issuer,
      amount: "0.0000003",
    });
    const report = await executeClose(approved, countingSigners(), { confirm: true, ...deps });

    expect(report.status).toBe("closed");
    expect(outcomeOf(report, approved, "DUSTB")).toMatchObject({
      status: "applied",
      rung: "return_to_issuer",
    });
    expect(ledger.accounts.has(messy.fixture)).toBe(false);
  });

  it("AC-E3-S2-2 (offline): with preferDestination DUSTC goes to the destination, DUSTB and SPTA still burn", async () => {
    const { ledger, deps, plan } = setup();
    const before = lineOf(ledger, messy.destination, "DUSTC")!.balance;
    const approved = await plan({ preferDestination: true });
    expect(approved.ladderOrder).toBe("prefer-destination");
    const rungs = Object.fromEntries(
      ["DUSTA", "DUSTB", "DUSTC", "SPTA"].map((c) => [c, disposalOf(approved, c).disposal!.rung]),
    );
    expect(rungs).toEqual({
      DUSTA: "path_payment",
      DUSTB: "return_to_issuer",
      DUSTC: "send_to_destination",
      SPTA: "return_to_issuer",
    });
    const report = await executeClose(approved, countingSigners(), { confirm: true, ...deps });

    expect(report.status).toBe("closed");
    for (const [code, rung] of Object.entries(rungs)) {
      expect(outcomeOf(report, approved, code)).toMatchObject({ status: "applied", rung });
    }
    // The destination's DUSTC balance rose by exactly the dust.
    expect(before).toBe("0.0000000");
    expect(lineOf(ledger, messy.destination, "DUSTC")!.balance).toBe("0.0000005");
  });

  it("AC-E3-S2-3 (offline): a memo-required issuer without a memo: nothing is signed without allowPartial; with it everything else runs and the account keeps exactly DUSTB and SPTA", async () => {
    const refused = setup(memoRequiredIssuer);
    const approved = await refused.plan();
    expect(approved.status).toBe("partial");
    expect(approved.unclosable.map((u) => u.code)).toEqual([
      "NO_DISPOSAL_ROUTE",
      "NO_DISPOSAL_ROUTE",
    ]);
    const signers = countingSigners();
    const aborted = await executeClose(approved, signers, { confirm: true, ...refused.deps });
    expect(aborted.status).toBe("aborted");
    expect(aborted.stop).toMatchObject({ code: "PLAN_NOT_CLOSABLE", verdict: "stop" });
    expect(refused.ledger.submissions).toHaveLength(0);
    expect(signers.account.sign).not.toHaveBeenCalled();

    const { ledger, deps, plan } = setup(memoRequiredIssuer);
    const partialPlan = await plan();
    const report = await executeClose(partialPlan, countingSigners(), {
      confirm: true,
      allowPartial: true,
      ...deps,
    });
    expect(report.status).toBe("partial");
    expect(report.stop).toBeNull();
    expect(report.transactions.map((t) => [t.phase, t.result])).toEqual([
      ["cleanup", "applied"],
      ["convert", "applied"],
    ]);
    // No merge was planned, so none was attempted.
    expect(partialPlan.steps.some((s) => s.kind === "merge")).toBe(false);
    const left = ledger.accounts.get(messy.fixture)!;
    expect(left.balances.filter((b) => b.asset_type !== "native").map((b) => b.asset_code)).toEqual(
      ["DUSTB", "SPTA"],
    );
    expect(left.subentry_count).toBe(2);
    expect(lineOf(ledger, messy.destination, "DUSTC")!.balance).toBe("0.0000005");
    expect(report.unclosable.map((u) => u.rungsRuledOut?.length)).toEqual([3, 3]);
    expect(report.verification).toMatchObject({ accountExists: true });
  });

  it("AC-E3-S2-4 (offline): a destination payment that fails with op_line_full falls back to the burn", async () => {
    const { ledger, deps, plan } = setup();
    const approved = await plan({ preferDestination: true });
    expect(disposalOf(approved, "DUSTC").disposal!.rung).toBe("send_to_destination");
    const report = await executeClose(approved, countingSigners(), {
      confirm: true,
      ...deps,
      onEvent: (e) => {
        // The destination's DUSTC trustline fills up after the fresh plan, before the payment.
        if (e.type === "tx:building" && e.index === 0 && (e.round ?? 0) === 0) {
          const line = lineOf(ledger, messy.destination, "DUSTC")!;
          line.limit = line.balance;
        }
      },
    });

    expect(report.status).toBe("closed");
    expect(report.transactions[0]).toMatchObject({ round: 0, phase: "cleanup", result: "failed" });
    expect(report.transactions[0]!.resultCodes?.operations).toContain("op_line_full");
    expect(report.replans[0]!.demoted).toEqual([]);
    expect(outcomeOf(report, approved, "DUSTC")).toMatchObject({
      status: "applied",
      rung: "return_to_issuer",
      failures: 1,
    });
  });

  it("AC-E3-S2-4 (offline): after op_line_full with no rung left, DUSTC is unclosable and the remedy names the limit to raise", async () => {
    const { ledger, deps, plan } = setup((l) => {
      memoRequiredIssuer(l);
      // The destination trusts every asset, so the SOW order sends each to it (rung 2 is ruled out).
      for (const code of ["DUSTB", "SPTA"]) l.addTrustline(messy.destination, asset(code));
    });
    const approved = await plan();
    expect(approved.status).toBe("closable");
    expect(disposalOf(approved, "DUSTC").disposal!.rung).toBe("send_to_destination");
    const report = await executeClose(approved, countingSigners(), {
      confirm: true,
      ...deps,
      onEvent: (e) => {
        if (e.type === "tx:building" && e.index === 0 && (e.round ?? 0) === 0) {
          const line = lineOf(ledger, messy.destination, "DUSTC")!;
          line.limit = line.balance;
        }
      },
    });

    expect(report.status).toBe("failed");
    expect(report.stop).toMatchObject({ code: "PLAN_NOT_CLOSABLE", verdict: "stop" });
    expect(report.transactions[0]!.resultCodes?.operations).toContain("op_line_full");
    const dustc = report.unclosable.find(
      (u) => u.subject.type === "trustline" && u.subject.asset.code === "DUSTC",
    )!;
    expect(dustc.code).toBe("NO_DISPOSAL_ROUTE");
    expect(dustc.remedy).toContain("raise the destination's trustline limit for DUSTC");
    expect(ledger.accounts.has(messy.fixture)).toBe(true);
  });
});

describe("X-06 (offline): the destination's trustline state decides rung 3 at execution", () => {
  const cases: Array<
    [string, (ledger: FakeLedger) => void, "send_to_destination" | "return_to_issuer"]
  > = [
    ["authorized, ample limit", () => undefined, "send_to_destination"],
    [
      "limit equal to its balance",
      (l) => Object.assign(lineOf(l, messy.destination, "DUSTC")!, { balance: "1000.0000000" }),
      "return_to_issuer",
    ],
    [
      "not authorized",
      (l) =>
        Object.assign(lineOf(l, messy.destination, "DUSTC")!, {
          is_authorized: false,
          is_authorized_to_maintain_liabilities: false,
        }),
      "return_to_issuer",
    ],
  ];
  for (const [name, change, rung] of cases) {
    it(`X-06: a destination DUSTC trustline ${name}: DUSTC is disposed of by ${rung}`, async () => {
      const { deps, plan } = setup(change);
      const approved = await plan({ preferDestination: true });
      expect(disposalOf(approved, "DUSTC").disposal!.rung).toBe(rung);
      const report = await executeClose(approved, countingSigners(), { confirm: true, ...deps });
      expect(report.status).toBe("closed");
      expect(outcomeOf(report, approved, "DUSTC")).toMatchObject({ status: "applied", rung });
    });
  }
});
