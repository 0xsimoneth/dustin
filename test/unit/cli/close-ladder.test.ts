import { describe, expect, it } from "vitest";
import { toStroops } from "../../../src/amounts.js";
import {
  closeCli,
  executeArgs,
  zeroSpendableWorld,
  type Fetch,
  type World,
} from "./close-world.js";

/**
 * Stories E3-S1 and E3-S2 through `dustin close --execute`, offline on the fake ledger: the ladder
 * order flag of canonical decision 8, the exit code of a partial close (canonical decision 5), and
 * what the receipt says about each leftover balance.
 */

const flat = (text: string) => text.replace(/\s+/g, " ");
const dust = (world: World) => `DUST:${world.issuer}`;
const balanceOf = (world: World, account: string, asset: string) =>
  world.ledger.accounts
    .get(account)
    ?.balances.find((b) => `${b.asset_code}:${b.asset_issuer}` === asset)?.balance;
/** The world's issuer turned SEP-29 memo-required (config.memo_required = "1"). */
const memoRequired = (world: World) => {
  const issuer = world.ledger.accounts.get(world.issuer)!;
  issuer.data = { ...issuer.data, "config.memo_required": "MQ==" };
  issuer.subentry_count += 1;
};

describe("dustin close --execute --prefer-destination (canonical decision 8, AC-E3-S2-2)", () => {
  it("AC-E3-S2-2: sends the dust to a destination that trusts it, instead of burning it (exit 0)", async () => {
    const world = zeroSpendableWorld();
    world.ledger.addTrustline(world.destination, dust(world));
    const r = await closeCli(world, executeArgs(world, "--prefer-destination", "--yes"));

    expect(r.code).toBe(0);
    expect(world.ledger.accounts.has(world.id)).toBe(false);
    // The destination's DUST balance rose by exactly the dust.
    expect(balanceOf(world, world.destination, dust(world))).toBe("0.0000005");
    const out = flat(r.out);
    expect(out).toMatch(/send 0\.0000005 DUST to destination/);
    expect(out).toContain("(--prefer-destination)");
    expect(out).toMatch(/DUST 0\.0000005 sent to the destination \S+ in tx 1/);
  });

  it("AC-E3-S2-2: keeps the SOW order without the flag: the same dust is burned (exit 0)", async () => {
    const world = zeroSpendableWorld();
    world.ledger.addTrustline(world.destination, dust(world));
    const r = await closeCli(world, executeArgs(world, "--yes"));

    expect(r.code).toBe(0);
    expect(toStroops(balanceOf(world, world.destination, dust(world)) ?? "0")).toBe(0n);
    expect(flat(r.out)).toMatch(/DUST 0\.0000005 burned: returned to its issuer \S+ in tx 1/);
  });

  it("AC-E3-S2-2: dustin plan --prefer-destination shows the order and the transfer (exit 0)", async () => {
    const world = zeroSpendableWorld();
    world.ledger.addTrustline(world.destination, dust(world));
    const r = await closeCli(world, [
      "plan",
      world.id,
      "--to",
      world.destination,
      "--prefer-destination",
      "--json",
    ]);

    expect(r.code).toBe(0);
    const plan = JSON.parse(r.out) as {
      ladderOrder: string;
      steps: Array<{ kind: string; disposal?: { rung: string; to: string } }>;
    };
    expect(plan.ladderOrder).toBe("prefer-destination");
    expect(plan.steps.find((s) => s.kind === "dispose_balance")?.disposal).toMatchObject({
      rung: "send_to_destination",
      to: world.destination,
    });
  });
});

describe("dustin close --execute with an item no route can dispose of (AC-E3-S2-3)", () => {
  it("AC-E3-S2-3: refuses without --partial (exit 3), naming the item, its three rungs and the remedy", async () => {
    const world = zeroSpendableWorld();
    memoRequired(world);
    const r = await closeCli(world, executeArgs(world, "--yes"));

    expect(r.code).toBe(3);
    expect(world.ledger.submissions).toHaveLength(0);
    const out = flat(r.out);
    expect(out).toContain("Not executed: the plan cannot end in a merge");
    expect(out).toContain("NO_DISPOSAL_ROUTE 0.0000005 DUST");
    expect(out).toContain(
      "- path payment: Horizon found no strict-send path to XLM for the full balance",
    );
    expect(out).toContain(
      `- return to issuer: issuer ${world.issuer} requires a memo (SEP-29) and none was given`,
    );
    expect(out).toContain("- send to destination: the destination holds no DUST trustline");
    expect(out).toContain(`pass the memo that issuer ${world.issuer} requires (--memo; SEP-29)`);
  });

  it("AC-E3-S2-3: with --partial runs everything else, attempts no merge and exits 4, not 2 (canonical decision 5)", async () => {
    const world = zeroSpendableWorld();
    memoRequired(world);
    const r = await closeCli(world, executeArgs(world, "--partial", "--yes"));

    expect(r.code).toBe(4);
    // One transaction: the offer cancellation and the data entry; no merge was attempted.
    expect(world.ledger.submissions).toHaveLength(1);
    const account = world.ledger.accounts.get(world.id)!;
    expect(account.balances.filter((b) => b.asset_type !== "native").map((b) => b.balance)).toEqual(
      ["0.0000005"],
    );
    expect(Object.keys(account.data)).toEqual([]);
    const out = flat(r.out);
    expect(out).toContain("Dustin close receipt PARTIAL");
    expect(out).not.toMatch(/merge into/);
    expect(out).toContain(
      "No route disposes of 0.0000005 DUST; every rung of the ladder is ruled out:",
    );
    expect(out).toMatch(/remedy: Make one route possible, then run the plan again: /);
  });

  it("AC-E3-S2-3: with the memo the issuer asks for, the dust is returned and the account closes (exit 0)", async () => {
    const world = zeroSpendableWorld();
    memoRequired(world);
    const r = await closeCli(world, executeArgs(world, "--memo", "dust-return", "--yes"));

    expect(r.code).toBe(0);
    expect(world.ledger.accounts.has(world.id)).toBe(false);
    expect(flat(r.out)).toMatch(/DUST 0\.0000005 burned: returned to its issuer/);
  });
});

describe("the receipt of dustin close --execute names what became of the dust (AC-E3-S2-1, AC-E3-S1-2)", () => {
  it("AC-E3-S1-2: after the market vanished, shows the failed sale, the re-plan and the burn (exit 0)", async () => {
    const world = zeroSpendableWorld({ market: true });
    let posts = 0;
    const fetch: Fetch = (url, init) => {
      // The market is gone by the time the sale is posted (after the cleanup transaction).
      if ((init?.method ?? "GET") === "POST" && ++posts === 2) world.ledger.quotes.clear();
      return world.ledger.fetch(url, init);
    };
    const r = await closeCli(world, executeArgs(world, "--yes"), { fetch });

    expect(r.code).toBe(0);
    const out = flat(r.out);
    expect(out).toContain("tx 2 convert failed on the ledger");
    expect(out).toContain("op_too_few_offers");
    expect(out).toMatch(/Re-plans \(1;/);
    expect(out).toMatch(
      /DUST 0\.0000005 burned: returned to its issuer \S+ in tx 1 of round 1, after the sale by path payment failed with op_too_few_offers/,
    );
  });
});
