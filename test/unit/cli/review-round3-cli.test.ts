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

/** The amount of the summary line with this label, in stroops. */
function summaryStroops(text: string, label: string): bigint {
  const line = text.split("\n").find((l) => l.startsWith(`  ${label.padEnd(13)}`));
  expect(line, `no "${label}" line`).toBeDefined();
  const amount = /(\d+\.\d{7}) XLM/.exec(line!)?.[1];
  expect(amount, line).toBeDefined();
  const [whole, fraction] = amount!.split(".");
  return BigInt(whole!) * 10_000_000n + BigInt(fraction!);
}

describe("R3-25: the confirmation names the close budget as the most the sponsor can pay", () => {
  it("shows a ceiling the run cannot exceed when a failure makes it re-plan", async () => {
    const world = zeroSpendableWorld({ market: true });
    // The market is gone after the first transaction: the sale fails on the ledger (charged)
    // and the run re-plans, adding a transaction the confirmation did not count.
    const fetch = beforePost(world, 2, () => world.ledger.quotes.clear());
    const r = await closeCli(world, executeArgs(world, "--yes", "--json", "--base-fee", "100"), {
      fetch,
    });
    expect(r.code).toBe(0);
    const report = JSON.parse(r.out) as CloseReport;
    expect(report.replans).toHaveLength(1);
    const paid = BigInt(report.recovery.feesPaidBySponsorStroops);
    // The plan's own bid is shown, and so is the ceiling: the close budget, 5 XLM.
    expect(r.err).toMatch(/pays {9}every fee; the plan bids 0\.0000800 XLM/);
    const ceiling = summaryStroops(r.err, "at most");
    expect(ceiling).toBe(50_000_000n);
    expect(paid).toBeGreaterThan(800n);
    expect(ceiling).toBeGreaterThanOrEqual(paid);
    expect(r.err).not.toMatch(/may bid up to|every fee, at most 0\.0000800/);
  });
});
