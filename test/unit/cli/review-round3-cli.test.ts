import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { CloseReport } from "../../../src/execute/report.js";
import {
  closeCli,
  emptyDir,
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

describe("R3-3, auditor 5: the --report file follows the run while it goes", () => {
  it("holds the envelope in flight, posted once, while its POST is on its way", async () => {
    const world = zeroSpendableWorld({ market: true });
    const path = join(emptyDir(), "close.json");
    const seen: Array<{ status: string; hashes: number; attempts: number } | null> = [];
    const fetch = (url: string, init?: RequestInit) => {
      if ((init?.method ?? "GET") === "POST") {
        const copy = existsSync(path)
          ? (JSON.parse(readFileSync(path, "utf8")) as CloseReport)
          : null;
        seen.push(
          copy && {
            status: copy.status,
            hashes: copy.transactions.length,
            attempts: copy.transactions.at(-1)?.attempts ?? 0,
          },
        );
      }
      return world.ledger.fetch(url, init);
    };
    const r = await closeCli(world, executeArgs(world, "--yes", "--report", path), { fetch });
    expect(r.code).toBe(0);
    expect(seen).toEqual([
      { status: "running", hashes: 1, attempts: 1 },
      { status: "running", hashes: 2, attempts: 1 },
      { status: "running", hashes: 3, attempts: 1 },
    ]);
  });
});
