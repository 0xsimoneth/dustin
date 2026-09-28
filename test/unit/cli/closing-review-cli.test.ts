import { describe, expect, it } from "vitest";
import { LEDGER, closeCli, executeArgs, zeroSpendableWorld } from "./close-world.js";

// Closing review of E3 (2026-09-28), CLI half: `dustin close --execute` offline on the fake
// ledger. Every test here failed on the code before its fix.

describe("CX-2 through the CLI: a worse quote in a partial close is drift, in its own words", () => {
  it("exits 3 with nothing signed and says what the account would keep, not the destination", async () => {
    const world = zeroSpendableWorld({ market: true });
    // The guard is beyond the bound: the plan cannot merge, and --partial runs the rest.
    world.ledger.accounts.get(world.id)!.sequence = (BigInt(LEDGER + 720) << 32n).toString();
    const r = await closeCli(world, executeArgs(world, "--partial"), {
      answer: () => {
        // While the user types the answer, the market pays less for the dust.
        world.ledger.quotes.set(`DUST:${world.issuer}`, "0.0000002");
        return world.destination.slice(-4);
      },
    });
    expect(r.code).toBe(3);
    expect(world.ledger.submissions).toHaveLength(0);
    expect(r.out).toContain("XLM_TO_DESTINATION_FELL");
    expect(r.out).toContain(
      "The XLM the account would keep (its balance plus the quoted sales; the plan does not merge) fell from 2.5000004 XLM to 2.5000002 XLM since the plan was shown",
    );
    expect(r.out).not.toMatch(/destination receives fell/);
  });
});
