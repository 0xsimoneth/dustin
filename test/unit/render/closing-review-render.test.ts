import { describe, expect, it } from "vitest";
import { executeClose, type CloseEvent } from "../../../src/execute/executor.js";
import type { CloseReport } from "../../../src/execute/report.js";
import type { ClosePlan } from "../../../src/plan/model.js";
import { renderReport } from "../../../src/render/report-text.js";
import { messy } from "../../helpers/snapshots.js";
import { failedOps, harness, signers } from "../execute/harness.js";

// Closing review of E3 (2026-09-28), the receipt: the Disposals and sponsor sections. Every test
// here failed on the code before its fix. Reports come from the real executor on the fake ledger.

/** One section of the receipt, from its heading to the next blank line, with every run of spaces as one. */
function section(text: string, heading: string): string {
  const lines = text.split("\n");
  const start = lines.findIndex((l) => l.startsWith(heading));
  expect(start, `no section ${heading}`).toBeGreaterThanOrEqual(0);
  const end = lines.findIndex((l, i) => i > start && l === "");
  return lines
    .slice(start, end < 0 ? undefined : end)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

/** A run of the messy fixture with the plans it executed; `onEvent` sees the harness too. */
async function run(onEvent?: (e: CloseEvent, h: ReturnType<typeof harness>) => void) {
  const h = harness();
  const plans: ClosePlan[] = [];
  const report = await executeClose(await h.plan(), signers(), {
    confirm: true,
    ...h.deps,
    onEvent: (e) => {
      if (e.type === "plan") plans.push(e.plan);
      onEvent?.(e, h);
    },
  });
  return { report, plans, ledger: h.ledger };
}

/** The DUSTA trustline of the fixture, whose balance the plan sells. */
const dusta = (h: ReturnType<typeof harness>) =>
  h.ledger.accounts
    .get(messy.fixture)!
    .balances.find((b) => b.asset_type !== "native" && b.asset_code === "DUSTA")!;

describe("CC-8: Disposals names the rung that actually failed", () => {
  it("names the failed sale and the failed return to the issuer, each with its own code", async () => {
    const { report, plans } = await run((e, h) => {
      // The market is gone after tx 1, so the sale fails with op_too_few_offers; the re-plan
      // returns DUSTA to its issuer, and DUSTA is deauthorized before that transaction runs.
      if (e.type === "tx:confirmed" && e.index === 0) h.ledger.quotes.clear();
      if (e.type === "plan" && e.round === 1) {
        dusta(h).is_authorized = false;
        dusta(h).is_authorized_to_maintain_liabilities = false;
      }
    });
    expect(report.stop).toMatchObject({ code: "STEP_FAILED_TWICE" });
    const text = section(renderReport(report, { plans }), "Disposals");
    // Before the fix: "not disposed of: the sale by path payment failed with op_src_not_authorized".
    expect(text).toContain(
      "DUSTA 0.0000007 not disposed of: the sale by path payment failed with op_too_few_offers, then the return to its issuer failed with op_src_not_authorized",
    );
  });

  it("names no failed sale when the sale never failed and only the return to the issuer did", async () => {
    let burnAt = -1;
    let cleared = false;
    const { report, plans } = await run((e, h) => {
      // Round 0: the cleanup fails on another step (DUSTB, op_underfunded) before the sale runs.
      if (e.type === "tx:building" && e.round === 0 && e.index === 0 && e.attempt === 1) {
        h.ledger.faults.push(
          failedOps(
            "op_success",
            "op_success",
            "op_underfunded",
            ...Array.from({ length: 6 }, () => "op_success"),
          ),
        );
      }
      // The market goes away before the re-plan, which routes DUSTA to its issuer: no sale failed.
      if (e.type === "tx:failed" && !cleared) {
        cleared = true;
        h.ledger.quotes.clear();
      }
      if (e.type === "plan" && e.round === 1) {
        const tx = e.plan.transactions[0]!;
        burnAt = tx.stepIds.findIndex((id) => {
          const step = e.plan.steps.find((s) => s.id === id)!;
          return step.kind === "dispose_balance" && step.disposal?.rung === "return_to_issuer";
        });
      }
      // Round 1: that return fails once (op_underfunded); round 2 applies it.
      if (e.type === "tx:building" && e.round === 1 && e.index === 0 && e.attempt === 1) {
        expect(burnAt).toBeGreaterThanOrEqual(0);
        h.ledger.faults.push(
          failedOps(...Array.from({ length: burnAt }, () => "op_success"), "op_underfunded"),
        );
      }
    });
    expect(report.status).toBe("closed");
    const outcome = report.steps.find((s) => s.rung === "return_to_issuer" && s.failures === 1);
    expect(outcome, "a disposal that failed once and then applied").toBeDefined();
    const text = section(renderReport(report, { plans }), "Disposals");
    expect(text).toMatch(/DUSTA 0\.0000007 burned: returned to its issuer/);
    // Before the fix: ", after the sale by path payment failed with op_underfunded".
    expect(text).not.toMatch(/after the sale by path payment failed/);
  });
});

describe("CC-9: a copy saved while the run is going reads as a run in progress", () => {
  /** The copies a --report file holds during a close of the messy fixture, with its plans. */
  async function copies() {
    const saved: CloseReport[] = [];
    const h = harness();
    const plans: ClosePlan[] = [];
    await executeClose(await h.plan(), signers(), {
      confirm: true,
      ...h.deps,
      onEvent: (e) => {
        if (e.type === "plan") plans.push(e.plan);
      },
      onReport: (copy) => saved.push(copy),
    });
    return { saved, plans };
  }

  it("says not run yet, attributed when the run ends and not read yet (the review's probe)", async () => {
    const { saved, plans } = await copies();
    // After tx 1 applied the sponsored SPTA removal, while tx 2's POST is in flight.
    const copy = saved.find(
      (c) =>
        c.transactions.length === 2 &&
        c.transactions[1]!.result === "pending" &&
        c.transactions[1]!.attempts === 1,
    )!;
    expect(copy.status).toBe("running");
    const text = renderReport(copy, { plans });
    const disposals = section(text, "Disposals");
    // Before the fix: "not disposed of: the run stopped before this step".
    expect(disposals).toContain("DUSTA 0.0000007 not run yet");
    expect(disposals).not.toMatch(/the run stopped before this step/);
    const result = section(text, "Result");
    // Before the fix: "Reserves released to sponsors: none", "nothing returned to sponsor ...",
    // "not read after the run".
    expect(result).toContain("Reserves released to sponsors: attributed when the run ends");
    expect(result).toMatch(/reserve of sponsor \S+: attributed when the run ends/);
    expect(result).toMatch(/observed on Horizon before the first submission: .*; not read yet/);
    expect(result).not.toMatch(
      /Reserves released to sponsors: none|nothing returned|not read after/,
    );
  });

  it("does not say a sale's XLM stays on the account while the run goes on", async () => {
    const { saved, plans } = await copies();
    // Right after the sale (tx 2) applied, before the merge was built.
    const copy = saved.find(
      (c) => c.transactions.length === 2 && c.transactions[1]!.result === "applied",
    )!;
    expect(copy.status).toBe("running");
    const disposals = section(renderReport(copy, { plans }), "Disposals");
    expect(disposals).toMatch(/DUSTA 0\.0000007 sold for XLM by path payment/);
    expect(disposals).not.toMatch(/the XLM stays on the account/);
    expect(disposals).toContain("the XLM is on the account while the run goes on");
  });
});
