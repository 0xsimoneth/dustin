import { describe, expect, it } from "vitest";
import { executeClose } from "../../../src/execute/executor.js";
import type { CloseReport, SponsorObservation } from "../../../src/execute/report.js";
import type { ClosePlan } from "../../../src/plan/model.js";
import { renderPlan, short } from "../../../src/render/plan-text.js";
import { renderReport } from "../../../src/render/report-text.js";
import { messy } from "../../helpers/snapshots.js";
import { harness, signers } from "../execute/harness.js";

// Story E3-S3, AC-E3-S3-2 and AC-E3-S3-4 (UX-DR2): the plan's summary and the receipt show
// "Reserves released to sponsors" on a line of its own; the receipt puts next to each sponsor's
// planned figure what Horizon showed before and after the run.

/** The lines of the Result section of a receipt. */
function result(text: string): string[] {
  const lines = text.split("\n");
  const start = lines.indexOf("Result");
  const end = lines.findIndex((l, i) => i > start && l === "");
  return lines.slice(start + 1, end);
}

async function closed(): Promise<{ report: CloseReport; plans: ClosePlan[] }> {
  const { deps, plan } = harness();
  const plans: ClosePlan[] = [];
  const report = await executeClose(await plan(), signers(), {
    confirm: true,
    ...deps,
    onEvent: (e) => {
      if (e.type === "plan") plans.push(e.plan);
    },
  });
  return { report, plans };
}

const within120 = (text: string) => {
  for (const line of text.split("\n")) expect(line.length, line).toBeLessThanOrEqual(120);
};

describe("renderReport: Reserves released to sponsors (E3-S3)", () => {
  it("AC-E3-S3-4: shows the planned reserve and, next to it, the observed num_sponsoring, minimum balance and XLM balance", async () => {
    const { report, plans } = await closed();
    const text = renderReport(report, { plans });
    const sponsor = short(messy.reserveSponsor);
    expect(result(text)).toEqual([
      "  The merge was applied, but the merged amount is not in the transaction result; the explorer shows it on the merge",
      "    transaction.",
      "  Reserves released to sponsors: 0.5000000 XLM, never this account's",
      `    0.5000000 XLM reserve returned to sponsor ${sponsor}, never this account's (trustline SPTA)`,
      "      observed on Horizon: num_sponsoring 1 -> 0, minimum balance 1.5000000 -> 1.0000000 XLM (0.5000000 XLM released),",
      "      XLM balance 10.0000000 -> 10.0000000 (unchanged)",
      "  0.0000000 XLM in fees paid by the account",
      "  0.0001500 XLM (1,500 stroops) in fees paid by the sponsor",
    ]);
    within120(text);
  });

  it("says what was not read, when a read failed", async () => {
    const { report, plans } = await closed();
    const failed = structuredClone(report);
    const observed = failed.recovery.sponsorsObserved![0]!;
    const onlyBefore: SponsorObservation = { ...observed, after: null };
    const flatResult = () => result(renderReport(failed, { plans })).join(" ").replace(/\s+/g, " ");
    failed.recovery.sponsorsObserved = [onlyBefore];
    expect(flatResult()).toMatch(
      /observed on Horizon before the first submission: num_sponsoring 1, minimum balance 1\.5000000 XLM, XLM balance 10\.0000000; not read after the run/,
    );
    failed.recovery.sponsorsObserved = [{ ...observed, before: null }];
    expect(flatResult()).toMatch(
      /observed on Horizon after the run: num_sponsoring 0, minimum balance 1\.0000000 XLM, XLM balance 10\.0000000; not read before the first submission/,
    );
    failed.recovery.sponsorsObserved = [{ ...observed, before: null, after: null }];
    expect(flatResult()).toMatch(/not observed: Horizon could not be read \(see the warnings\)/);
  });

  it("shows an observed sponsor that this run released nothing to", async () => {
    const { report, plans } = await closed();
    const stopped = structuredClone(report);
    stopped.recovery.reservesReturnedToSponsors = [];
    stopped.recovery.sponsorsObserved = [
      {
        sponsor: messy.reserveSponsor,
        before: { numSponsoring: 1, balance: "10.0000000", minimumBalance: "1.5000000", ledger: 1 },
        after: { numSponsoring: 1, balance: "10.0000000", minimumBalance: "1.5000000", ledger: 2 },
      },
    ];
    const lines = result(renderReport(stopped, { plans })).join("\n");
    expect(lines).toContain("  Reserves released to sponsors: none");
    expect(lines).toContain(
      `    nothing returned to sponsor ${short(messy.reserveSponsor)} by this run`,
    );
    expect(lines).toMatch(
      /num_sponsoring 1 -> 1, minimum balance 1\.5000000 -> 1\.5000000 XLM \(unchanged\)/,
    );
  });

  it("says none when no entry was sponsored, and keeps reports without observations readable", async () => {
    const { report, plans } = await closed();
    const bare = structuredClone(report);
    bare.recovery.reservesReturnedToSponsors = [];
    bare.recovery.sponsorsObserved = [];
    expect(result(renderReport(bare, { plans }))).toContain(
      "  Reserves released to sponsors: none",
    );
    // A report written before E3-S3 has no sponsorsObserved: the planned line stands alone.
    const older = structuredClone(report);
    delete older.recovery.sponsorsObserved;
    const lines = result(renderReport(older, { plans }));
    expect(lines).toContain("  Reserves released to sponsors: 0.5000000 XLM, never this account's");
    expect(lines.join(" ")).not.toMatch(/observed on Horizon/);
  });
});

describe("renderPlan: Reserves released to sponsors (UX-DR2, AC-E3-S3-2)", () => {
  it("shows the planned reserves on their own line, sponsor by sponsor", async () => {
    const { plan } = harness();
    const text = renderPlan(await plan());
    const lines = text.split("\n");
    const at = lines.indexOf(
      "  Reserves released to sponsors: 0.5000000 XLM, never this account's",
    );
    expect(at).toBeGreaterThan(0);
    expect(lines[at + 1]).toBe(
      `    0.5000000 XLM reserve unlocked for sponsor ${short(messy.reserveSponsor)} (trustline SPTA)`,
    );
    // Right after what the destination receives, which excludes the sponsored reserve.
    expect(lines[at - 1]).toMatch(/^ {2}4\.0000007 XLM arrives at/);
    within120(text);
  });

  it("says none when the plan releases no sponsored reserve", async () => {
    const { ledger, plan } = harness();
    const spta = ledger.accounts.get(messy.fixture)!.balances.find((b) => b.asset_code === "SPTA")!;
    delete spta.sponsor;
    ledger.accounts.get(messy.fixture)!.num_sponsored = 0;
    ledger.accounts.get(messy.reserveSponsor)!.num_sponsoring = 0;
    expect(renderPlan(await plan()).split("\n")).toContain("  Reserves released to sponsors: none");
  });
});
