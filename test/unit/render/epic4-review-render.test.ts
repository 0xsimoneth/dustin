import { describe, expect, it } from "vitest";
import { executeClose } from "../../../src/execute/executor.js";
import { renderPlan } from "../../../src/render/plan-text.js";
import { nextStep, renderReport } from "../../../src/render/report-text.js";
import { messy } from "../../helpers/snapshots.js";
import { harness, reply, signers } from "../execute/harness.js";

// Epic 4 closing review, the receipt. Each test is named after its finding ID and fails on the
// code before the fix. Reports come from the real executor on the fake ledger.

describe("EX-5: the Next line of a stop with an open envelope names its time bound", () => {
  it("EX-5: OUTCOME_UNKNOWN says to wait until a ledger has closed past maxTime", async () => {
    // A 504 on the POST, then every lookup by hash fails: whether it applied is not known.
    const { ledger, deps, plan } = harness(
      (_l, fetch) => (url, init) =>
        url.includes("/transactions/") ? reply(503) : fetch(url, init),
    );
    ledger.faults.push("504-applied");
    const report = await executeClose(await plan(), signers(), { confirm: true, ...deps });
    expect(report.stop).toMatchObject({ code: "OUTCOME_UNKNOWN" });
    const maxTime = report.stop!.maxTime!;
    expect(maxTime).toBeTypeOf("number");
    const next = nextStep(report)!;
    const bound = new Date(maxTime * 1000).toISOString();
    // Before the fix: "Run the same command again to continue: ...", with no wait.
    expect(next).toContain(`only after a ledger has closed after ${bound} (maxTime ${maxTime})`);
    expect(next).toContain(report.stop!.hash!);
    expect(renderReport(report).replace(/\s+/g, " ")).toContain(
      `Run the same command again only after a ledger has closed after ${bound}`,
    );
  });

  it("EX-5: INTERRUPTED with an open envelope says the same", async () => {
    const controller = new AbortController();
    let posts = 0;
    const { ledger, deps, plan } = harness((_l, fetch) => (url, init) => {
      // The signal comes as the first envelope reaches Horizon, which loses it behind a 504.
      if ((init?.method ?? "GET") === "POST" && ++posts === 1) controller.abort("SIGINT");
      return fetch(url, init);
    });
    ledger.faults.push("504-not-applied");
    const report = await executeClose(await plan(), signers(), {
      confirm: true,
      ...deps,
      signal: controller.signal,
    });
    expect(report.stop).toMatchObject({ code: "INTERRUPTED" });
    const maxTime = report.stop!.maxTime!;
    expect(maxTime).toBeTypeOf("number");
    expect(nextStep(report)).toContain(
      `only after a ledger has closed after ${new Date(maxTime * 1000).toISOString()}`,
    );
  });

  it("EX-5: a stop without an open envelope keeps its Next line", async () => {
    const controller = new AbortController();
    const { deps, plan } = harness();
    controller.abort("SIGINT");
    const report = await executeClose(await plan(), signers(), {
      confirm: true,
      ...deps,
      signal: controller.signal,
    });
    expect(report.stop).toMatchObject({ code: "INTERRUPTED" });
    expect(report.stop!.maxTime).toBeUndefined();
    expect(nextStep(report)).toBe(
      "Nothing was submitted. Review the plan and run the command again.",
    );
  });
});

describe("D-8: a missing account's plan and receipt print only what is known", () => {
  /** The recorded fixture merged away: Horizon answers 404 for it. */
  async function missing() {
    const h = harness();
    h.ledger.accounts.delete(messy.fixture);
    const plan = await h.plan();
    const report = await executeClose(plan, signers(), { confirm: true, ...h.deps });
    return { plan, report };
  }

  it("D-8: the plan has no invented balance, reserve, bid or amounts", async () => {
    const { plan } = await missing();
    expect(plan.blockers.map((b) => b.code)).toContain("ACCOUNT_MISSING");
    const text = renderPlan(plan);
    // Before the fix: "Balance 0.0000000 XLM, ... (base reserve 0.0000000)", "bid up to 0.0000000
    // XLM ... paid by the sponsor", "0.0000000 XLM arrives at ...".
    expect(text).not.toContain("0.0000000");
    expect(text).not.toContain("base reserve");
    expect(text).not.toContain("paid by the sponsor");
    expect(text).toContain(
      "Balance      not known: the account does not exist on the ledger (Horizon answered 404)",
    );
    expect(text).toContain("Fees         none: the plan has no transaction to submit");
    expect(text).toContain(
      "  nothing: the account does not exist, so no XLM moves and no fee is paid",
    );
    expect(text).toContain(`plan hash ${plan.planHash}`);
  });

  it("D-8: the receipt has no fee sentence when nothing was submitted", async () => {
    const { report } = await missing();
    expect(report.transactions).toEqual([]);
    const text = renderReport(report);
    // Before the fix: "Sponsor ... paid every fee" and two lines of 0.0000000 XLM in fees.
    expect(text).not.toContain("paid every fee");
    expect(text).not.toMatch(/in fees paid by the (account|sponsor)/);
    expect(text).toContain(`Sponsor      ${report.feeSponsor}\n`);
    expect(text).toContain("  No fees: nothing was submitted.");
  });

  it("D-8: a receipt with a submission keeps its fee sentences", async () => {
    const { deps, plan } = harness();
    const report = await executeClose(await plan(), signers(), { confirm: true, ...deps });
    expect(report.status).toBe("closed");
    const text = renderReport(report);
    expect(text).toContain("paid every fee");
    expect(text).toContain("in fees paid by the sponsor");
    expect(text).not.toContain("No fees: nothing was submitted.");
  });
});
