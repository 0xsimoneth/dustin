import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { executeClose } from "../../../src/execute/executor.js";
import type { ClosePlan } from "../../../src/plan/model.js";
import { planFromSnapshot } from "../../../src/plan/plan.js";
import { renderPlan } from "../../../src/render/plan-text.js";
import { renderReport } from "../../../src/render/report-text.js";
import type { ExistingAccountSnapshot } from "../../../src/inspect/snapshot.js";
import { messy, messySnapshot } from "../../helpers/snapshots.js";
import { harness, signers } from "../execute/harness.js";
import { closeCli, executeArgs, zeroSpendableWorld, type CliRun } from "./close-world.js";

// AC-E4-S1-1 (story E4-S1). Output never uses colour: status is a word (docs/ux-design.md
// principle P6, "words, not colors"), so NO_COLOR and --no-color have nothing to switch off, and no
// ANSI escape is ever printed, whatever NO_COLOR or FORCE_COLOR say (commander's help styles are
// plain unless configured). Amounts print with 7 decimals. Lines stay within 120 columns, the demo
// terminal's width (docs/ux-design.md section 4; section 2.10), hashes and URLs whole on their own
// lines (sections 2.5, 2.11 rule 6): the 80-column wrap of AC-E4-S1-1 is a documented deviation
// (docs/stories/4-1-cli-output-polish.md).

const ESC = "\u001b";

const savedColorEnv = { NO_COLOR: process.env.NO_COLOR, FORCE_COLOR: process.env.FORCE_COLOR };
afterEach(() => {
  for (const [key, value] of Object.entries(savedColorEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

/** Runs that cover every kind of output: plans, the execution transcript, receipts, errors, help. */
async function everyOutput(): Promise<CliRun[]> {
  const runs: CliRun[] = [];
  const add = async (p: Promise<CliRun>) => void runs.push(await p);
  const simple = zeroSpendableWorld();
  await add(closeCli(simple, ["plan", simple.id, "--to", simple.destination]));
  await add(closeCli(simple, ["plan", simple.id, "--to", simple.destination, "--json"]));
  await add(closeCli(simple, ["close", simple.id, "--to", simple.destination, "--yes"]));
  await add(closeCli(simple, executeArgs(simple), { answer: "nope" }));
  await add(closeCli(simple, executeArgs(simple, "--yes")));
  const market = zeroSpendableWorld({ market: true });
  await add(closeCli(market, executeArgs(market, "--yes")));
  const frozen = zeroSpendableWorld({ unauthorized: true });
  await add(closeCli(frozen, executeArgs(frozen, "--yes")));
  await add(closeCli(frozen, executeArgs(frozen, "--yes", "--partial")));
  await add(closeCli(simple, ["plan", "--frobnicate"]));
  await add(closeCli(simple, ["--help"]));
  await add(closeCli(simple, ["close", "--help"]));
  await add(closeCli(simple, executeArgs(simple, "--yes", "--verbose"), { env: {} }));
  return runs;
}

describe("plain output (AC-E4-S1-1)", () => {
  it("never prints an ANSI escape, with NO_COLOR, with FORCE_COLOR, or with neither", async () => {
    for (const env of [{}, { NO_COLOR: "1" }, { FORCE_COLOR: "1" }] as const) {
      delete process.env.NO_COLOR;
      delete process.env.FORCE_COLOR;
      Object.assign(process.env, env);
      const runs = await everyOutput();
      expect(runs.length).toBeGreaterThan(10);
      for (const r of runs) {
        expect(r.out.includes(ESC), `${JSON.stringify(env)} stdout`).toBe(false);
        expect(r.err.includes(ESC), `${JSON.stringify(env)} stderr`).toBe(false);
        for (const p of r.prompts) expect(p.includes(ESC)).toBe(false);
      }
    }
  });

  it("keeps every line of text within 120 columns (JSON documents and NDJSON lines are not wrapped)", async () => {
    const isJson = (text: string) => {
      try {
        JSON.parse(text);
        return true;
      } catch {
        return false;
      }
    };
    for (const r of await everyOutput()) {
      const text = [isJson(r.out) ? "" : r.out, ...r.err.split("\n").filter((l) => !isJson(l))];
      for (const line of text.join("\n").split("\n")) {
        expect(line.length, line).toBeLessThanOrEqual(120);
      }
    }
  });
});

let base: ExistingAccountSnapshot;
beforeAll(async () => {
  base = await messySnapshot();
});

/**
 * The plan with every sentence the planner wrote replaced, so only what the renderers format
 * themselves is scanned. The planner's reasons are its own prose (src/plan/order.ts): its removal
 * reasons name the reserve as "0.5 XLM" (reported to the planner's owner, see the story record).
 */
function withoutPlannerProse(plan: ClosePlan): ClosePlan {
  const copy = structuredClone(plan);
  for (const s of copy.steps) {
    s.reason = "(prose)";
    if (s.disposal)
      s.disposal.ruledOut = s.disposal.ruledOut.map((r) => ({ ...r, reason: "(prose)" }));
  }
  for (const t of copy.transactions) t.reason = "(prose)";
  for (const b of copy.blockers) Object.assign(b, { reason: "(prose)", remedy: "(prose)" });
  for (const u of copy.unclosable) Object.assign(u, { reason: "(prose)", remedy: "(prose)" });
  copy.warnings = copy.warnings.map(() => "(prose)");
  return copy;
}

/** Every amount the text gives in XLM: "<number> XLM". */
function xlmAmounts(text: string): string[] {
  return [...text.matchAll(/(?<![\w.])(\d[\d,]*(?:\.\d+)?) XLM\b/g)].map((m) => m[1]!);
}

describe("amounts with 7 decimals (AC-E4-S1-1)", () => {
  it("prints every XLM amount of the plan with 7 decimals", () => {
    const plan = withoutPlannerProse(
      planFromSnapshot(base, {
        destination: messy.destination,
        feeSponsor: messy.sponsor,
        baseFeeStroops: 100,
      }),
    );
    const amounts = xlmAmounts(renderPlan(plan));
    expect(amounts.length).toBeGreaterThan(5);
    for (const a of amounts) expect(a).toMatch(/^\d+\.\d{7}$/);
  });

  it("prints every XLM amount of the receipt with 7 decimals", async () => {
    const { deps, plan } = harness();
    const approved = await plan();
    const report = await executeClose(approved, signers(), { confirm: true, ...deps });
    const text = renderReport(
      { ...report, message: null, warnings: [], stop: null },
      { plans: [withoutPlannerProse(approved)] },
    );
    const amounts = xlmAmounts(text);
    expect(amounts.length).toBeGreaterThan(3);
    for (const a of amounts) expect(a).toMatch(/^\d+\.\d{7}$/);
  });
});
