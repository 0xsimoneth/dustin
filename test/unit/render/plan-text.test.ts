import { describe, expect, it } from "vitest";
import { planFromSnapshot } from "../../../src/plan/plan.js";
import { renderPlan } from "../../../src/render/plan-text.js";
import { randomSnapshot } from "../../helpers/generate.js";

function plan(budgetStroops?: number) {
  const s = randomSnapshot(3, { offers: 2, trustlines: 2 });
  return planFromSnapshot(s, {
    destination: s.destination!.account,
    baseFeeStroops: 100,
    ...(budgetStroops !== undefined ? { budgetStroops } : {}),
  });
}

describe("renderPlan: the sponsor's budget (review R2)", () => {
  it("shows the per-close budget and that the bid is within it", () => {
    const p = plan();
    expect(p.fees.withinBudget).toBe(true);
    const text = renderPlan(p);
    expect(text).toMatch(
      /^Budget {7}5\.0000000 XLM per close for the sponsor; the bid above is within it$/m,
    );
  });

  it("says loudly when the bid exceeds the budget", () => {
    const p = plan(150);
    expect(p.fees.withinBudget).toBe(false);
    const text = renderPlan(p);
    expect(text).toContain("0.0000150 XLM per close for the sponsor; the bid above EXCEEDS it");
    for (const line of text.split("\n")) expect(line.length, line).toBeLessThanOrEqual(120);
  });

  it("keeps the dry-run heading by default and accepts another one", () => {
    expect(renderPlan(plan()).split("\n")[0]).toBe(
      "Dustin plan  (dry run: nothing is signed, nothing is submitted)",
    );
    expect(renderPlan(plan(), { heading: "Dustin plan  (x)" }).split("\n")[0]).toBe(
      "Dustin plan  (x)",
    );
  });
});
