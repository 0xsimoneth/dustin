import { describe, expect, it } from "vitest";
import type { Sleep } from "../../../src/config/pauses.js";
import { executeClose } from "../../../src/execute/executor.js";
import type { FakeLedger } from "../../helpers/fake-ledger.js";
import { testClock } from "../execute/harness.js";
import { LEDGER, closeCli, executeArgs, zeroSpendableWorld, type World } from "./close-world.js";

// Story E3-S4 through `dustin close --execute`, offline on the fake ledger: the progress lines of
// the wait for the sequence guard, the refusal of a guard beyond the bound, and the receipt of a
// run that the guard stopped (exit codes of docs/README.md canonical decision 5).

/** The account's sequence number bumped to (LEDGER + ahead) << 32, as BumpSequence would. */
function bumped(ahead: number): World {
  const world = zeroSpendableWorld();
  world.ledger.accounts.get(world.id)!.sequence = (BigInt(LEDGER + ahead) << 32n).toString();
  return world;
}

/** A pause that lets a fake ledger close every 5 s of the time it would have waited. */
function ticking(ledger: FakeLedger, msPerLedger = 5000): Sleep {
  let carry = 0;
  return (ms) => {
    carry += ms;
    while (carry >= msPerLedger) {
      ledger.ledgerSeq += 1;
      carry -= msPerLedger;
    }
    return Promise.resolve();
  };
}

/** The executor with its pause (and clock) replaced, as the CLI would call it. */
const executeWith =
  (sleep: Sleep, now?: () => number): typeof executeClose =>
  (plan, signers, options) =>
    executeClose(plan, signers, { ...options, sleep, ...(now ? { now } : {}) });

const within120 = (text: string) => {
  for (const line of text.split("\n")) expect(line.length, line).toBeLessThanOrEqual(120);
};

describe("dustin close --execute and the sequence guard (E3-S4)", () => {
  it("prints the wait for the sequence guard, then merges (exit 0)", async () => {
    // The merge is the second transaction: sequence at merge ((LEDGER + 10) << 32) + 2, so it can
    // land from ledger LEDGER + 11; the cleanup lands in LEDGER + 1.
    const world = bumped(10);
    const r = await closeCli(world, executeArgs(world, "--yes"), {
      executeClose: executeWith(ticking(world.ledger)),
    });
    expect(r.err).toBe("");
    expect(r.code).toBe(0);
    for (const needle of [
      "sequence guard: the merge waits until ledger 5,000,011",
      "tx 2/2  waiting for the sequence guard: the merge can land from ledger 5,000,011\n" +
        "        the latest ledger is 5,000,001, about 50 s to go\n",
      "        waited     ledger 5,000,010 has closed; the merge can land from ledger 5,000,011",
      "tx 2/2  merge preflight ok",
      "Dustin close receipt   CLOSED",
    ]) {
      expect(r.out, needle).toContain(needle);
    }
    const merge = [...world.ledger.transactions.values()].at(-1)!;
    expect(merge.ledger).toBe(LEDGER + 11);
    expect(world.ledger.accounts.has(world.id)).toBe(false);
    within120(r.out);
  });

  it("refuses a guard beyond the bound without --partial, naming the ledger (exit 3)", async () => {
    // About an hour ahead: sequence at merge ((LEDGER + 720) << 32) + 1, due at LEDGER + 721.
    const world = bumped(720);
    const r = await closeCli(world, executeArgs(world, "--yes"));
    expect(r.code).toBe(3);
    expect(world.ledger.submissions).toHaveLength(0);
    expect(r.out).toMatch(/Not executed: the plan cannot end in a merge \(status BLOCKED\)/);
    expect(r.out).toContain("SEQNUM_TOO_FAR");
    expect(r.out).toMatch(/until\s+ledger 5000721, about 61 minutes from now/);
    expect(r.out).toContain("--partial");
  });

  it("runs the cleanup with --partial, submits no merge and says when to run again (exit 4)", async () => {
    const world = bumped(720);
    const r = await closeCli(world, executeArgs(world, "--partial", "--yes"));
    expect(r.code).toBe(4);
    expect(world.ledger.submissions).toHaveLength(1);
    expect(world.ledger.accounts.has(world.id)).toBe(true);
    expect(world.ledger.accounts.get(world.id)!.subentry_count).toBe(0);
    expect(r.out).toContain("Dustin close receipt   PARTIAL");
    expect(r.out).toContain("SEQNUM_TOO_FAR");
    expect(r.out).toMatch(
      /Next {9}The account still exists: the sequence guard holds the merge \(SEQNUM_TOO_FAR above\)/,
    );
    within120(r.out);
  });

  it("stops before the merge when the wait runs out, and the receipt names the ledger (exit 5)", async () => {
    const world = bumped(10);
    // The local clock moves while the executor waits, but no ledger closes.
    const clock = testClock();
    const r = await closeCli(world, executeArgs(world, "--yes"), {
      executeClose: executeWith(clock.sleep, clock.now),
    });
    expect(r.code).toBe(5);
    expect(world.ledger.submissions).toHaveLength(1);
    expect(world.ledger.accounts.has(world.id)).toBe(true);
    expect(r.out).toContain("tx 2/2  waiting for the sequence guard");
    expect(r.out).toContain("Stop code    SEQNUM_TOO_FAR (stage merge, next: replan)");
    expect(r.out).toMatch(
      /Next {9}The sequence guard holds the merge until ledger 5,000,011 \(ACCOUNT_MERGE_SEQNUM_TOO_FAR\)\. Run the same/,
    );
    expect(r.out).toContain("at or after ledger 5000011");
    within120(r.out);
  });
});
