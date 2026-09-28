import { describe, expect, it } from "vitest";
import {
  closeCli,
  executeArgs,
  zeroSpendableWorld,
  type Fetch,
  type World,
} from "./close-world.js";

// Third review round of E2-S4 (2026-09-28): `dustin close --execute`, offline on the fake ledger.
// Every test here failed on the code before its fix.

/** A fetch that runs `before` ahead of the POST numbered `post` (1-based), then forwards it. */
function beforePost(world: World, post: number, before: () => void): Fetch {
  let posts = 0;
  return (url, init) => {
    if ((init?.method ?? "GET") === "POST" && ++posts === post) before();
    return world.ledger.fetch(url, init);
  };
}

describe("R3-1: a merge this run knows did not apply is no close", () => {
  it("exits 5, not 0, when another party removes the account while the merge is refused", async () => {
    const world = zeroSpendableWorld({ market: true });
    // Another client merges the account away just before this run's merge (the third POST).
    const fetch = beforePost(world, 3, () => world.ledger.accounts.delete(world.id));
    const r = await closeCli(world, executeArgs(world, "--yes"), { fetch });
    expect(world.ledger.submissions).toHaveLength(3);
    expect(r.code).toBe(5);
    expect(r.out).not.toContain("Dustin close receipt   CLOSED");
    expect(r.out).not.toMatch(/The merge was applied/);
    expect(r.out).toContain("ACCOUNT_MISSING");
  });
});
