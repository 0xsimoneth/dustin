import { describe, expect, it } from "vitest";
import type { CloseReport } from "../../../src/execute/report.js";
import { closeCli, executeArgs, zeroSpendableWorld, type Fetch } from "./close-world.js";

/**
 * Review finding BH-7 through the CLI: `dustin close --execute` shows a fresh plan, asks, and the
 * executor plans again after the answer. A quote that falls in that window lowers the XLM the
 * destination receives without changing the plan hash; the executor must stop before anything is
 * signed, and the CLI exits 3, "nothing executed" (docs/README.md canonical decision 5).
 */
describe("dustin close --execute: the amount shown before the confirmation is enforced (BH-7)", () => {
  it("exits 3 with nothing signed when a quote falls after the confirmation", async () => {
    const world = zeroSpendableWorld({ market: true });
    const dust = `DUST:${world.issuer}`;
    const r = await closeCli(world, executeArgs(world), {
      answer: () => {
        // While the user types the answer, the market pays less for the dust.
        world.ledger.quotes.set(dust, "0.0000002");
        return world.destination.slice(-4);
      },
    });

    expect(r.code).toBe(3);
    expect(world.ledger.submissions).toHaveLength(0);
    // The confirmation showed the amount the user agreed to.
    expect(r.out).toMatch(/receives {5}2\.5000004 XLM through the merge/);
    expect(r.out).toMatch(/fell from 2\.5000004 XLM to 2\.5000002 XLM/);
    expect(r.out).toContain("Dustin close receipt   ABORTED: nothing was submitted");
    expect(r.out).toContain("XLM_TO_DESTINATION_FELL");
    // The drift line does not claim a changed plan hash when only the amount moved.
    expect(r.out).not.toMatch(/plan hash \w+ is now/);
  });

  it("puts the stop code and both amounts in the --json report (exit 3)", async () => {
    const world = zeroSpendableWorld({ market: true });
    const dust = `DUST:${world.issuer}`;
    // With --yes there is no question: the quote falls between the CLI's plan and the executor's.
    let pathQueries = 0;
    const fetch: Fetch = (url, init) => {
      if (url.includes("/paths/strict-send") && ++pathQueries === 2) {
        world.ledger.quotes.set(dust, "0.0000001");
      }
      return world.ledger.fetch(url, init);
    };
    const r = await closeCli(world, executeArgs(world, "--yes", "--json"), { fetch });

    expect(r.code).toBe(3);
    expect(world.ledger.submissions).toHaveLength(0);
    const report = JSON.parse(r.out) as CloseReport;
    expect(report.status).toBe("aborted");
    expect(report.stop).toMatchObject({
      code: "XLM_TO_DESTINATION_FELL",
      xlmToDestination: { approved: "2.5000004", fresh: "2.5000001" },
    });
  });

  it("closes as before when the quote rises after the confirmation (exit 0)", async () => {
    const world = zeroSpendableWorld({ market: true });
    const dust = `DUST:${world.issuer}`;
    const r = await closeCli(world, executeArgs(world), {
      answer: () => {
        world.ledger.quotes.set(dust, "0.0000005");
        return world.destination.slice(-4);
      },
    });

    expect(r.code).toBe(0);
    expect(world.ledger.accounts.has(world.id)).toBe(false);
    expect(r.out).not.toMatch(/fell from/);
  });
});
