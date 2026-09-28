import { beforeAll, describe, expect, it } from "vitest";
import { executeClose } from "../../../src/execute/executor.js";
import type { ExistingAccountSnapshot } from "../../../src/inspect/snapshot.js";
import type { ClosePlan } from "../../../src/plan/model.js";
import { planFromSnapshot } from "../../../src/plan/plan.js";
import { renderPlan } from "../../../src/render/plan-text.js";
import { renderReport } from "../../../src/render/report-text.js";
import { messy, messySnapshot } from "../../helpers/snapshots.js";
import { closeCli, executeArgs, zeroSpendableWorld } from "../cli/close-world.js";
import { harness, signers } from "../execute/harness.js";

// AC-E4-S1-4 (story E4-S1): the CLI's output is snapshot-tested for the fixture plan and a
// receipt, so any change to what a reviewer reads shows up in review as a diff of the committed
// snapshot (test/unit/render/__snapshots__/). The plan of the recorded messy fixture is fully
// deterministic; runs on the fake ledger sign with fresh keys and real time bounds, so their
// hashes, addresses and timestamps are replaced by numbered placeholders first.

let base: ExistingAccountSnapshot;
beforeAll(async () => {
  base = await messySnapshot();
});

/** The text with every run-specific value replaced by a placeholder, numbered by first use. */
function stable(text: string): string {
  const numbered = (pattern: RegExp, label: string) => {
    const seen = new Map<string, number>();
    return (input: string) =>
      input.replace(pattern, (match) => {
        if (!seen.has(match)) seen.set(match, seen.size + 1);
        return `<${label}${seen.get(match)!}>`;
      });
  };
  let out = numbered(/\b[0-9a-f]{64}\b/g, "hash")(text);
  out = numbered(/\bG[A-Z2-7]{55}\b/g, "G")(out);
  out = out.replace(/\bG[A-Z2-7]{3}\.\.\.[A-Z2-7]{4}\b/g, "<G...>");
  out = out.replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z/g, "<time>");
  out = out.replace(/\(its time bound, \d+\)/g, "(its time bound, <maxTime>)");
  return out;
}

describe("snapshots of what the CLI prints (AC-E4-S1-4)", () => {
  it("the plan of the recorded messy fixture", () => {
    const plan = planFromSnapshot(base, {
      destination: messy.destination,
      feeSponsor: messy.sponsor,
      baseFeeStroops: 100,
    });
    expect(renderPlan(plan)).toMatchSnapshot();
  });

  it("the receipt of the recorded messy fixture's close on the fake ledger", async () => {
    const { deps, plan } = harness();
    const approved = await plan({ baseFeeStroops: 100 });
    const plans: ClosePlan[] = [];
    const report = await executeClose(approved, signers(), {
      confirm: true,
      ...deps,
      onEvent: (e) => {
        if (e.type === "plan") plans.push(e.plan);
      },
    });
    expect(report.status).toBe("closed");
    expect(stable(renderReport(report, { plans }))).toMatchSnapshot();
  });

  it("the whole transcript of dustin close --execute --yes: plan, summary, progress, receipt", async () => {
    const world = zeroSpendableWorld({ market: true });
    const r = await closeCli(world, executeArgs(world, "--yes", "--base-fee", "100"));
    expect(r.code).toBe(0);
    expect(r.err).toBe("");
    expect(stable(r.out)).toMatchSnapshot();
  });

  it("the transcript of a refusal: an item no rung can dispose of, without --partial", async () => {
    const world = zeroSpendableWorld({ unauthorized: true });
    const r = await closeCli(world, executeArgs(world, "--yes", "--base-fee", "100"));
    expect(r.code).toBe(3);
    expect(stable(r.out)).toMatchSnapshot();
  });
});
