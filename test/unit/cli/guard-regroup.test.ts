import { describe, expect, it } from "vitest";
import type { CloseReport } from "../../../src/execute/report.js";
import {
  LEDGER,
  closeCli,
  executeArgs,
  zeroSpendableWorld,
  type Fetch,
  type World,
} from "./close-world.js";

// Review finding CA-11, PRD decision D-10 (story E4-S2), through `dustin close --execute` on the
// fake ledger: the known limitation of story 3-4. A plan shown with a near sequence guard runs the
// merge alone in a second transaction; if the unblocking ledger passes while the typed
// confirmation waits, the executor's fresh plan puts the merge back into the cleanup. Before the
// fix that regrouping changed the plan hash and the run stopped with PLAN_CHANGED (exit 3).

/** The account's sequence number bumped to (LEDGER + ahead) << 32, as BumpSequence would. */
function bumped(ahead: number): World {
  const world = zeroSpendableWorld();
  world.ledger.accounts.get(world.id)!.sequence = (BigInt(LEDGER + ahead) << 32n).toString();
  return world;
}

describe("a near sequence guard that clears while the confirmation waits (CA-11, D-10)", () => {
  it("is not drift: the run goes on with the fresh grouping and closes in one transaction (exit 0)", async () => {
    // The merge is shown as tx 2 of 2, due at ledger LEDGER + 11.
    const world = bumped(10);
    const r = await closeCli(world, executeArgs(world), {
      answer: () => {
        // Twenty ledgers close while the user reads the plan and types the answer.
        world.ledger.ledgerSeq = LEDGER + 20;
        return world.destination.slice(-4);
      },
    });
    expect(r.out).toContain("  tx 2  merge");
    expect(r.out).toContain("sequence guard: the merge waits until ledger 5,000,011");
    expect(r.out).not.toContain("PLAN_CHANGED");
    expect(r.code).toBe(0);
    // The fresh plan's grouping ran: one fee-bumped transaction, the merge in it.
    expect(world.ledger.submissions).toHaveLength(1);
    expect(world.ledger.accounts.has(world.id)).toBe(false);
    expect(r.out).toContain("tx 1/1  cleanup");
    expect(r.out).not.toContain("waiting for the sequence guard");
    expect(r.out).toContain("Dustin close receipt   CLOSED");
    // The receipt says why the grouping differs from the plan shown.
    expect(r.out.replace(/\s+/g, " ")).toMatch(
      /the sequence guard cleared after the plan was approved, so the merge runs in transaction 1 of 1 with the cleanup instead of in transaction 2 of 2, alone/i,
    );
  });

  it("describes the operations of the plan the executor signed, not the plan shown", async () => {
    // A quote that rises while the confirmation waits is no drift (review BH-7); the sale is signed
    // from the fresh plan, so the receipt must name the fresh quote. It shares the plan hash with
    // the plan shown, which the receipt used to describe the transactions with.
    const world = zeroSpendableWorld({ market: true });
    const r = await closeCli(world, executeArgs(world), {
      answer: () => {
        world.ledger.quotes.set(`DUST:${world.issuer}`, "0.0000009");
        return world.destination.slice(-4);
      },
    });
    expect(r.code).toBe(0);
    const [shown, receipt] = r.out.split("Dustin close receipt");
    expect(shown).toContain("quote 0.0000004");
    expect(receipt).toContain("quote 0.0000009");
    expect(receipt).not.toContain("quote 0.0000004");
  });

  it("puts the fresh grouping in the report: one transaction, every step in it", async () => {
    const world = bumped(10);
    let moved = false;
    const fetch: Fetch = (url, init) => {
      // The ledgers close between the plan shown and the executor's fresh plan: at the CLI's read
      // of the sponsor, after the plan was shown and before the executor re-reads the account.
      if (!moved && url.endsWith(`/accounts/${world.sponsor.publicKey()}`)) {
        moved = true;
        world.ledger.ledgerSeq = LEDGER + 20;
      }
      return world.ledger.fetch(url, init);
    };
    const r = await closeCli(world, executeArgs(world, "--json", "--yes"), { fetch });
    expect(r.code).toBe(0);
    const report = JSON.parse(r.out) as CloseReport;
    expect(report.status).toBe("closed");
    expect(report.stop).toBeNull();
    expect(report.transactions.map((t) => t.phase)).toEqual(["cleanup"]);
    expect(report.steps.every((s) => s.txIndex === 0 && s.status === "applied")).toBe(true);
    expect(report.warnings.join(" ")).toMatch(/sequence guard cleared after the plan was approved/);
  });
});
