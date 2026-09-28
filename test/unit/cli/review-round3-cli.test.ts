import { chmodSync, existsSync, linkSync, readdirSync, readFileSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Prompt } from "../../../src/cli/commands/close.js";
import { run } from "../../../src/cli/run.js";
import type { CloseReport } from "../../../src/execute/report.js";
import { noSleep } from "../../helpers/no-sleep.js";
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
    // The summary is read from standard output and the figures from the --report file (since
    // E4-S1 --json prints no human text, review AA-10).
    const path = join(emptyDir(), "close.json");
    const r = await closeCli(
      world,
      executeArgs(world, "--yes", "--base-fee", "100", "--report", path),
      { fetch },
    );
    expect(r.code).toBe(0);
    const report = JSON.parse(readFileSync(path, "utf8")) as CloseReport;
    expect(report.replans).toHaveLength(1);
    const paid = BigInt(report.recovery.feesPaidBySponsorStroops);
    // The plan's own bid is shown, and so is the ceiling: the close budget, 5 XLM.
    expect(r.out).toMatch(/pays {9}every fee; the plan bids 0\.0000800 XLM/);
    const ceiling = summaryStroops(r.out, "at most");
    expect(ceiling).toBe(50_000_000n);
    expect(paid).toBeGreaterThan(800n);
    expect(ceiling).toBeGreaterThanOrEqual(paid);
    expect(r.out).not.toMatch(/may bid up to|every fee, at most 0\.0000800/);
  });
});

describe("R3-32: the memo line names the merge only when a merge is planned", () => {
  it("leaves the merge out of a partial close's memo line", async () => {
    const world = zeroSpendableWorld({ unauthorized: true });
    const r = await closeCli(
      world,
      executeArgs(world, "--partial", "--yes", "--memo", "HELLOMEMO42"),
    );
    expect(r.code).toBe(4);
    expect(r.out).toContain("PARTIAL close");
    expect(r.out).toContain('  memo         "HELLOMEMO42" (on every transaction)\n');
    expect(r.out).not.toContain("the merge included");
  });
});

describe("R3-27: with --json, every refusal before signing prints the refused plan", () => {
  it("prints the plan when the bids exceed the close budget (exit 3)", async () => {
    const world = zeroSpendableWorld({ dataEntries: 60 });
    const r = await closeCli(world, executeArgs(world, "--yes", "--json", "--base-fee", "1000000"));
    expect(r.code).toBe(3);
    expect(r.err).toContain("SPONSOR_BUDGET_EXCEEDED");
    const printed = JSON.parse(r.out) as { kind: string; fees: { withinBudget: boolean } };
    expect(printed).toMatchObject({ kind: "dustin-close-plan", fees: { withinBudget: false } });
    expect(world.ledger.submissions).toHaveLength(0);
  });

  it("prints the plan when the sponsor cannot cover the budget (exit 3)", async () => {
    const world = zeroSpendableWorld();
    world.ledger.accounts.get(world.sponsor.publicKey())!.balances[0]!.balance = "3.0000000";
    const r = await closeCli(world, executeArgs(world, "--yes", "--json"));
    expect(r.code).toBe(3);
    expect(r.err).toContain("SPONSOR_UNDERFUNDED");
    expect(JSON.parse(r.out)).toMatchObject({ kind: "dustin-close-plan" });
    expect(world.ledger.submissions).toHaveLength(0);
  });
});

describe("R3-26: --report can never name the working directory's .env", () => {
  /** A working directory whose .env holds the two secrets, and the run's options for it. */
  function secretsInDotEnv(world: World) {
    const text = [
      `DUSTIN_ACCOUNT_SECRET=${world.account.secret()}`,
      `DUSTIN_SPONSOR_SECRET=${world.sponsor.secret()}`,
      "",
    ].join("\n");
    const cwd = emptyDir(text);
    return { cwd, text, deps: { env: {}, cwd } };
  }

  const cases: Array<[string, (cwd: string) => string]> = [
    // On a case-insensitive filesystem (macOS, Windows) this is the .env file itself.
    ["another case of the name", (cwd) => join(cwd, ".ENV")],
    ["another case of a .env variant", (cwd) => join(cwd, ".Env.local")],
    [
      "a symbolic link to it",
      (cwd) => {
        symlinkSync(join(cwd, ".env"), join(cwd, "receipt.json"));
        return join(cwd, "receipt.json");
      },
    ],
    [
      "a hard link to it",
      (cwd) => {
        linkSync(join(cwd, ".env"), join(cwd, "receipt.json"));
        return join(cwd, "receipt.json");
      },
    ],
  ];

  it.each(cases)("refuses %s before anything is signed (exit 2)", async (_name, target) => {
    const world = zeroSpendableWorld();
    const { cwd, text, deps } = secretsInDotEnv(world);
    const path = target(cwd);
    const r = await closeCli(world, executeArgs(world, "--yes", "--report", path), deps);
    expect(r.code).toBe(2);
    expect(r.err).toMatch(/Cannot write the report file .*\.env/);
    expect(world.ledger.submissions).toHaveLength(0);
    // The secrets file is where it was, as it was.
    expect(readFileSync(join(cwd, ".env"), "utf8")).toBe(text);
    expect(readdirSync(cwd).filter((f) => /^\.env\./i.test(f))).toEqual([]);
  });
});

/** `dustin` with the given prompt, which also sees where the facts it confirms were printed. */
async function closeWithPrompt(world: World, args: string[], prompt: Prompt) {
  const out: string[] = [];
  const err: string[] = [];
  const code = await run(
    ["node", "dustin", ...args],
    { stdout: (s) => void out.push(s), stderr: (s) => void err.push(s) },
    "0.0.0",
    {
      env: world.env,
      cwd: emptyDir(),
      fetch: world.ledger.fetch,
      horizon: { retries: 0 },
      execute: { sleep: noSleep },
      prompt,
    },
  );
  return { code, out: out.join(""), err: err.join("") };
}

describe("R3-28, R3-31: the confirmation is asked only where the facts were shown", () => {
  it("tells the prompt the plan was on stdout, and never asks with --json (AA-10)", async () => {
    const facts: Array<string | undefined> = [];
    const prompt: Prompt = (_question, context) => {
      facts.push(context?.facts);
      return Promise.resolve("nope");
    };
    const world = zeroSpendableWorld();
    await closeWithPrompt(world, executeArgs(world), prompt);
    const json = await closeWithPrompt(world, executeArgs(world, "--json"), prompt);
    // Since E4-S1 --json is machine mode: the question is not asked, the run is refused.
    expect(facts).toEqual(["stdout"]);
    expect(json.code).toBe(3);
    expect(json.err).toContain("CONFIRMATION_REQUIRED");
    expect(world.ledger.submissions).toHaveLength(0);
  });

  it("does not execute, and names the cause, when the question could not be asked", async () => {
    const world = zeroSpendableWorld();
    const cause =
      "standard output is not a terminal (it is redirected or piped), so the plan and the summary to confirm were not on screen";
    const r = await closeWithPrompt(world, executeArgs(world), () =>
      Promise.resolve({ unasked: cause }),
    );
    expect(r.code).toBe(3);
    expect(r.err).toContain("CONFIRMATION_DECLINED");
    expect(r.err).toContain(cause);
    expect(r.err).not.toMatch(/the input is not interactive/);
    expect(r.err).toContain("Nothing was executed");
    expect(r.err).toContain("--yes");
    expect(world.ledger.submissions).toHaveLength(0);
  });
});

describe("R3-30: a report file that holds an earlier copy is not called missing", () => {
  it("says the file holds an earlier copy when only the later writes failed", async () => {
    const world = zeroSpendableWorld({ market: true });
    const dir = emptyDir();
    const path = join(dir, "close.json");
    // The directory turns read-only before the second POST: the copies written until then stay.
    const fetch = beforePost(world, 2, () => chmodSync(dir, 0o500));
    try {
      const r = await closeCli(world, executeArgs(world, "--yes", "--report", path), { fetch });
      expect(r.code).toBe(0);
      const saved = JSON.parse(readFileSync(path, "utf8")) as CloseReport;
      expect(saved.status).toBe("running");
      expect(saved.transactions).toHaveLength(2);
      expect(r.out).not.toContain("the only record");
      expect(r.out).toMatch(/Report NOT fully written to .*the file holds an earlier copy/s);
    } finally {
      chmodSync(dir, 0o700);
    }
  });
});
