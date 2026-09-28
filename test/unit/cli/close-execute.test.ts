import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { Keypair, Networks, TransactionBuilder } from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";
import type { CloseReport } from "../../../src/execute/report.js";
import { hashHex } from "../../../src/sponsor/fee-bump.js";
import { failedOps, recordIncludedFaults } from "../execute/harness.js";
import {
  closeCli,
  emptyDir,
  executeArgs,
  secretForms,
  zeroSpendableWorld,
  type CliRun,
  type Fetch,
  type World,
} from "./close-world.js";

// Story E2-S4: `dustin close --execute`, offline on the fake ledger (test/helpers/fake-ledger.ts).

const hashes = (world: World) => [...world.ledger.transactions.keys()];

/** A fee bump whose inner transaction failed on the ledger with a stop code (ADR-0006). */
const CANNOT_DELETE = failedOps("op_success", "op_cannot_delete");

/** Records every request, and lets a test change the answers after a given number of POSTs. */
function tap(world: World, after?: { posts: number; then: Fetch }) {
  const requests: Array<{ method: string; url: string }> = [];
  let posts = 0;
  const fetch: Fetch = async (url, init) => {
    const method = init?.method ?? "GET";
    requests.push({ method, url });
    if (after && posts >= after.posts) return after.then(url, init);
    const response = await world.ledger.fetch(url, init);
    if (method === "POST") posts += 1;
    return response;
  };
  return { fetch, requests };
}

function expectNoSecret(world: World, ...texts: string[]) {
  for (const text of texts) {
    for (const form of secretForms(world.account, world.sponsor)) expect(text).not.toContain(form);
  }
}

describe("dustin close --execute: the happy path", () => {
  it("closes with --yes, streams each transaction and ends with the 404 verification (exit 0)", async () => {
    const world = zeroSpendableWorld();
    const r = await closeCli(world, executeArgs(world, "--yes"), { answer: "never asked" });
    expect(r.err).toBe("");
    expect(r.code).toBe(0);
    expect(r.prompts).toEqual([]);
    expect(world.ledger.submissions).toHaveLength(1);
    expect(world.ledger.accounts.has(world.id)).toBe(false);
    const [hash] = hashes(world);
    for (const needle of [
      "re-read for execution",
      "Budget       5.0000000 XLM per close for the sponsor; the bid above is within it",
      `You are about to close ${world.id} on testnet.`,
      `  destination  ${world.destination}`,
      "CONFIRMATION SKIPPED",
      "tx 1/1  cleanup",
      `        submitted  ${hash}`,
      `        https://stellar.expert/explorer/testnet/tx/${hash}`,
      "        confirmed  ledger 5,000,001, fee charged to the sponsor 0.0000600 XLM (600 stroops)",
      `Verifying    GET /accounts/${world.id} -> 404: the account no longer exists`,
      "Dustin close receipt   CLOSED",
      `  verified     account ${world.id} no longer exists on Horizon (404)`,
    ]) {
      expect(r.out, needle).toContain(needle);
    }
    for (const line of r.out.split("\n")) expect(line.length, line).toBeLessThanOrEqual(120);
    expectNoSecret(world, r.out, r.err);
  });

  it("asks for the last four characters of the destination and closes on the exact answer", async () => {
    const world = zeroSpendableWorld();
    const r = await closeCli(world, executeArgs(world), {
      answer: `  ${world.destination.slice(-4)}\n`,
    });
    expect(r.code).toBe(0);
    expect(r.prompts).toHaveLength(1);
    expect(r.prompts[0]).toContain(world.destination);
    expect(r.prompts[0]).toMatch(/last 4 characters of the destination/);
    for (const line of r.prompts[0]!.split("\n"))
      expect(line.length, line).toBeLessThanOrEqual(120);
    expect(r.out).not.toContain("CONFIRMATION SKIPPED");
    expect(world.ledger.submissions).toHaveLength(1);
  });

  it("closes an account whose plan needs three transactions, printing every hash", async () => {
    const world = zeroSpendableWorld({ market: true });
    const r = await closeCli(world, executeArgs(world, "--yes"));
    expect(r.code).toBe(0);
    expect(world.ledger.submissions).toHaveLength(3);
    for (const hash of hashes(world)) expect(r.out).toContain(`submitted  ${hash}`);
    expect(r.out).toContain("tx 3/3  merge");
    expect(r.out).toMatch(/merge preflight ok/);
  });
});

describe("dustin close --execute: the typed confirmation", () => {
  const cases: Array<[string, string | null | undefined]> = [
    ["a wrong answer", "WXYZ"],
    ["an empty answer", ""],
    ["the end of input (Ctrl-D)", null],
    ["a non-interactive standard input", undefined],
  ];
  for (const [name, answer] of cases) {
    it(`declines on ${name}: exit 3, nothing submitted`, async () => {
      const world = zeroSpendableWorld();
      // A wrong answer differs from the destination's tail in its first character.
      const tail = world.destination.slice(-4);
      const typed =
        answer === "WXYZ" ? `${tail.startsWith("W") ? "Q" : "W"}${tail.slice(1)}` : answer;
      const r = await closeCli(world, executeArgs(world), { answer: typed });
      expect(r.code).toBe(3);
      expect(r.err).toContain("CONFIRMATION_DECLINED");
      expect(r.err).toContain("Nothing was executed");
      expect(r.err).toContain("--yes");
      expect(world.ledger.submissions).toHaveLength(0);
      if (typed) expect(r.err).not.toContain(typed);
    });
  }

  it("with --json still asks, on standard error, and prints only the refused plan on standard output when declined", async () => {
    const world = zeroSpendableWorld();
    const r = await closeCli(world, executeArgs(world, "--json"), { answer: "nope" });
    expect(r.code).toBe(3);
    expect(r.prompts).toHaveLength(1);
    // Closing review CC-2: standard output carries one JSON document, the refused plan; the human
    // text stays on standard error.
    expect(JSON.parse(r.out)).toMatchObject({ kind: "dustin-close-plan", account: world.id });
    expect(r.out).not.toContain("You are about to close");
    expect(r.err).toContain("You are about to close");
  });
});

describe("dustin close --execute: refusals before anything is signed", () => {
  it("refuses an unclosable plan without --partial and names the item and its remedy (exit 3)", async () => {
    const world = zeroSpendableWorld({ unauthorized: true });
    const r = await closeCli(world, executeArgs(world, "--yes"));
    expect(r.code).toBe(3);
    expect(world.ledger.submissions).toHaveLength(0);
    expect(r.out).toContain("TRUSTLINE_NOT_AUTHORIZED");
    expect(r.out).toMatch(/Not executed: the plan cannot end in a merge/);
    expect(r.out).toContain("remedy:");
    expect(r.out).toContain("--partial");
  });

  it("prints the refused plan as the one JSON document with --json (exit 3)", async () => {
    const world = zeroSpendableWorld({ unauthorized: true });
    const r = await closeCli(world, executeArgs(world, "--yes", "--json"));
    expect(r.code).toBe(3);
    const printed = JSON.parse(r.out) as { kind: string; status: string };
    expect(printed.kind).toBe("dustin-close-plan");
    expect(printed.status).not.toBe("closable");
    expect(r.err).toMatch(/Not executed: the plan cannot end in a merge/);
  });

  it("runs everything else with --partial and exits 4", async () => {
    const world = zeroSpendableWorld({ unauthorized: true });
    const r = await closeCli(world, executeArgs(world, "--partial", "--yes"));
    expect(r.code).toBe(4);
    expect(world.ledger.submissions).toHaveLength(1);
    expect(world.ledger.accounts.has(world.id)).toBe(true);
    expect(r.out).toContain("Dustin close receipt   PARTIAL");
    expect(r.out).toContain("TRUSTLINE_NOT_AUTHORIZED");
  });

  it("has nothing to execute for an account that no longer exists (exit 3)", async () => {
    const world = zeroSpendableWorld();
    world.ledger.accounts.delete(world.id);
    const r = await closeCli(world, executeArgs(world, "--yes"));
    expect(r.code).toBe(3);
    expect(r.out).toContain("ACCOUNT_MISSING");
    expect(r.out).toMatch(/Nothing to execute/);
    expect(world.ledger.submissions).toHaveLength(0);
  });

  it("refuses a bid over the sponsor's budget before asking (exit 3)", async () => {
    const world = zeroSpendableWorld({ dataEntries: 60 });
    const r = await closeCli(world, executeArgs(world, "--base-fee", "1000000"), {
      answer: world.destination.slice(-4),
    });
    expect(r.code).toBe(3);
    expect(r.err).toContain("SPONSOR_BUDGET_EXCEEDED");
    expect(r.prompts).toEqual([]);
    expect(world.ledger.submissions).toHaveLength(0);
  });

  it("refuses a sponsor that cannot cover the budget before asking (exit 3)", async () => {
    const world = zeroSpendableWorld();
    world.ledger.accounts.get(world.sponsor.publicKey())!.balances[0]!.balance = "3.0000000";
    const r = await closeCli(world, executeArgs(world), { answer: world.destination.slice(-4) });
    expect(r.code).toBe(3);
    expect(r.err).toContain("SPONSOR_UNDERFUNDED");
    expect(r.prompts).toEqual([]);
    expect(world.ledger.submissions).toHaveLength(0);
  });

  it("stops without submitting when the account changes after the plan was shown (exit 3)", async () => {
    const world = zeroSpendableWorld();
    const r = await closeCli(world, executeArgs(world), {
      answer: () => {
        const acc = world.ledger.accounts.get(world.id)!;
        acc.data = { ...acc.data, late: "MQ==" };
        acc.subentry_count += 1;
        return world.destination.slice(-4);
      },
    });
    expect(r.code).toBe(3);
    expect(world.ledger.submissions).toHaveLength(0);
    expect(r.out).toContain("Dustin close receipt   ABORTED: nothing was submitted");
    expect(r.out).toMatch(/changed since the plan/);
  });
});

describe("dustin close --execute: secrets and network", () => {
  it("refuses a missing secret with exit 2 before any request", async () => {
    const world = zeroSpendableWorld();
    const t = tap(world);
    for (const [env, code] of [
      [{ DUSTIN_ACCOUNT_SECRET: world.env.DUSTIN_ACCOUNT_SECRET }, "MISSING_SPONSOR_SECRET"],
      [{ DUSTIN_SPONSOR_SECRET: world.env.DUSTIN_SPONSOR_SECRET }, "MISSING_ACCOUNT_SECRET"],
    ] as const) {
      const r = await closeCli(world, executeArgs(world, "--yes"), { env, fetch: t.fetch });
      expect(r.code).toBe(2);
      expect(r.err).toContain(code);
      expectNoSecret(world, r.out, r.err);
    }
    expect(t.requests).toEqual([]);
  });

  it("refuses the secret of another account with exit 2 and names its public key only", async () => {
    const world = zeroSpendableWorld();
    const other = Keypair.random();
    const r = await closeCli(world, executeArgs(world, "--yes"), {
      env: { ...world.env, DUSTIN_ACCOUNT_SECRET: other.secret() },
    });
    expect(r.code).toBe(2);
    expect(r.err).toContain("WRONG_SIGNER");
    expect(r.err).toContain(other.publicKey());
    for (const form of secretForms(other)) expect(r.err + r.out).not.toContain(form);
    expect(world.ledger.submissions).toHaveLength(0);
  });

  it("refuses a malformed secret with exit 2 without echoing it", async () => {
    const world = zeroSpendableWorld();
    const bad = `${world.sponsor.secret().slice(0, 50)}XXXXXX`;
    const r = await closeCli(world, executeArgs(world, "--yes"), {
      env: { ...world.env, DUSTIN_SPONSOR_SECRET: bad },
    });
    expect(r.code).toBe(2);
    expect(r.err).toContain("CONFIG_INVALID");
    expect(r.err).not.toContain(bad.slice(0, 20));
  });

  it("refuses a secret on the command line with exit 2", async () => {
    const world = zeroSpendableWorld();
    const r = await closeCli(world, [
      ...executeArgs(world, "--yes"),
      "--memo",
      world.account.secret(),
    ]);
    expect(r.code).toBe(2);
    expect(r.err).toContain("SECRET_IN_ARGV");
    expectNoSecret(world, r.out, r.err);
    expect(world.ledger.submissions).toHaveLength(0);
  });

  it("takes the two secrets from .env in the working directory, and nothing else from it", async () => {
    const world = zeroSpendableWorld();
    const cwd = emptyDir(
      [
        `DUSTIN_ACCOUNT_SECRET=${world.account.secret()}`,
        `DUSTIN_SPONSOR_SECRET=${world.sponsor.secret()}`,
        "DUSTIN_HORIZON_URL=https://horizon.example.org",
        "",
      ].join("\n"),
    );
    const before = { ...process.env };
    const r = await closeCli(world, executeArgs(world, "--yes"), { env: {}, cwd });
    expect(r.code).toBe(0);
    expect(r.out).not.toContain("example.org");
    expect(process.env).toEqual(before);
    expectNoSecret(world, r.out, r.err);
  });

  it("refuses a Horizon that does not serve the testnet with exit 2, after one request", async () => {
    const world = zeroSpendableWorld();
    const t = tap(world, {
      posts: 0,
      then: (url, init) =>
        url === "https://horizon-testnet.stellar.org/"
          ? Promise.resolve(new Response(JSON.stringify({ network_passphrase: Networks.PUBLIC })))
          : world.ledger.fetch(url, init),
    });
    const r = await closeCli(world, executeArgs(world, "--yes"), { fetch: t.fetch });
    expect(r.code).toBe(2);
    expect(r.err).toContain("MAINNET_REFUSED");
    expect(t.requests).toEqual([{ method: "GET", url: "https://horizon-testnet.stellar.org/" }]);
    expect(world.ledger.submissions).toHaveLength(0);
  });

  it("exits 6 when Horizon is unreachable before anything is submitted", async () => {
    const world = zeroSpendableWorld();
    const r = await closeCli(world, executeArgs(world, "--yes"), {
      fetch: () => Promise.reject(new Error("ECONNREFUSED")),
    });
    expect(r.code).toBe(6);
    expect(r.err).toContain("HORIZON_UNAVAILABLE");
  });
});

describe("dustin close --execute: recovery after a failure (E2-S3)", () => {
  it("falls down the ladder when the market vanishes after the first transaction, and still closes (exit 0)", async () => {
    const world = zeroSpendableWorld({ market: true });
    const t = tap(world, {
      posts: 1,
      then: (url, init) => {
        world.ledger.quotes.clear(); // the market is gone after the first transaction
        return world.ledger.fetch(url, init);
      },
    });
    const r = await closeCli(world, executeArgs(world, "--yes"), { fetch: t.fetch });
    expect(r.code).toBe(0);
    expect(world.ledger.accounts.has(world.id)).toBe(false);
    expect(r.out).toContain("op_too_few_offers");
    expect(r.out).toMatch(/Re-plans \(1;/);
    expect(r.out).toMatch(/tx \d {2}\w+ {2}round 1/);
    expect(r.out).toContain("no longer exists on Horizon (404)");
    expectNoSecret(world, r.out, r.err);
  });
});

describe("dustin close --execute: drift found after a submission", () => {
  it("does not claim nothing was submitted when a re-plan finds new entries and stops", async () => {
    const world = zeroSpendableWorld({ market: true });
    // After the first transaction, the next one fails with a re-plan code, and meanwhile a new
    // data entry appeared on the account: the re-plan sees drift and stops (onDrift: abort).
    // The failure is recorded on the fake ledger as included (sequence used, record found by
    // hash); an unrecorded tx_failed would read as a refusal at validation (edge case E6).
    const recording = recordIncludedFaults(world.ledger, world.ledger.fetch);
    let injected = false;
    const t = tap(world, {
      posts: 1,
      then: (url, init) => {
        if ((init?.method ?? "GET") === "POST" && !injected) {
          injected = true;
          const account = world.ledger.accounts.get(world.id)!;
          account.data["dustin.late"] = "MQ==";
          account.subentry_count += 1;
          world.ledger.faults.push(failedOps("op_underfunded", "op_success"));
        }
        return recording(url, init);
      },
    });
    const r = await closeCli(world, executeArgs(world, "--yes"), { fetch: t.fetch });
    expect(r.out).toContain("The account changed since the plan was shown");
    expect(r.out).toContain("the transactions above stay on the ledger");
    expect(r.out).not.toMatch(/changed since the plan was shown[^\n]*nothing was submitted/);
    expect(r.code).toBe(5);
  });
});

describe("dustin close --execute: failures after a submission", () => {
  it("exits 5 when a later transaction fails, printing every submitted hash", async () => {
    const world = zeroSpendableWorld({ market: true });
    // The second transaction fails on the ledger with a code no re-plan can fix (ADR-0006:
    // op_cannot_delete stops the run). A vanished market is no longer enough: since E2-S3 the
    // executor falls down the ladder and completes the close.
    const recording = recordIncludedFaults(world.ledger, world.ledger.fetch);
    const t = tap(world, {
      posts: 1,
      then: (url, init) => {
        if ((init?.method ?? "GET") === "POST") world.ledger.faults.push(CANNOT_DELETE);
        return recording(url, init);
      },
    });
    const r = await closeCli(world, executeArgs(world, "--yes"), { fetch: t.fetch });
    expect(r.code).toBe(5);
    const submitted = world.ledger.submissions.map((envelope) =>
      hashHex(TransactionBuilder.fromXDR(envelope, Networks.TESTNET)),
    );
    expect(submitted).toHaveLength(2);
    for (const hash of submitted) expect(r.out).toContain(hash);
    expect(r.out).toContain("op_cannot_delete");
    expect(r.out).toContain("Dustin close receipt   FAILED");
    expect(r.out).toMatch(/run the same command again/i);
    expect(world.ledger.accounts.has(world.id)).toBe(true);
  });

  it("exits 5, not 6, when Horizon becomes unreachable after the first submission", async () => {
    const world = zeroSpendableWorld({ market: true });
    const t = tap(world, { posts: 1, then: () => Promise.reject(new Error("ECONNRESET")) });
    const r = await closeCli(world, executeArgs(world, "--yes"), { fetch: t.fetch });
    expect(r.code).toBe(5);
    const [first] = hashes(world);
    expect(r.out).toContain(`submitted  ${first}`);
    // Whether the executor throws or returns a failed report, the cause is named.
    expect(r.out + r.err).toMatch(/HORIZON_UNAVAILABLE|unreachable/);
    expect(r.out).toContain("Dustin close receipt   FAILED");
    expect(r.out).toMatch(/run the same command again/i);
  });
});

describe("dustin close --execute: the confirmation summary", () => {
  it("names the plan's bid and the close budget as the most the sponsor may pay", async () => {
    const world = zeroSpendableWorld();
    const r = await closeCli(world, executeArgs(world, "--yes"));
    expect(r.code).toBe(0);
    // Review round 3, R3-25: retries and re-plans can bid more than the plan; only the budget is
    // a ceiling.
    expect(r.out).toContain("pays         every fee; the plan bids 0.0000600 XLM\n");
    expect(r.out).toContain("at most      5.0000000 XLM, the close budget;");
    expect(r.out).toMatch(/can spend {4}\d+\.\d{7} XLM/);
  });

  it("names the --base-fee bid, never raised, and still the budget as the ceiling", async () => {
    const world = zeroSpendableWorld();
    const r = await closeCli(world, executeArgs(world, "--yes", "--base-fee", "100"));
    expect(r.code).toBe(0);
    expect(r.out).toContain(
      "pays         every fee; the plan bids 0.0000600 XLM at 100 stroops per operation (--base-fee), never raised",
    );
    expect(r.out).toContain("at most      5.0000000 XLM, the close budget;");
  });
});

describe("dustin close --execute: memo and --sponsor", () => {
  it("shows the memo in the plan and in the facts confirmed before execution", async () => {
    const world = zeroSpendableWorld();
    const r = await closeCli(world, executeArgs(world, "--yes", "--memo", "HELLOMEMO42"));
    expect(r.code).toBe(0);
    expect(r.out).toContain('Memo         "HELLOMEMO42" (on every transaction)');
    expect(r.out).toContain(
      '  memo         "HELLOMEMO42" (on every transaction, the merge included)',
    );
  });

  it("refuses --sponsor naming another account than the sponsor secret's owner (exit 2)", async () => {
    const world = zeroSpendableWorld();
    const other = Keypair.random().publicKey();
    const r = await closeCli(world, executeArgs(world, "--yes", "--sponsor", other));
    expect(r.code).toBe(2);
    expect(r.err).toContain("WRONG_SIGNER");
    expect(world.ledger.submissions).toHaveLength(0);
  });

  it("accepts --sponsor when it names the sponsor secret's owner", async () => {
    const world = zeroSpendableWorld();
    const r = await closeCli(
      world,
      executeArgs(world, "--yes", "--sponsor", world.sponsor.publicKey()),
    );
    expect(r.code).toBe(0);
  });
});

describe("dustin close --execute: --json and --report", () => {
  it("prints only the final CloseReport JSON on standard output with --json", async () => {
    const world = zeroSpendableWorld();
    const r = await closeCli(world, executeArgs(world, "--yes", "--json"));
    expect(r.code).toBe(0);
    const report = JSON.parse(r.out) as CloseReport;
    expect(report).toMatchObject({
      kind: "dustin-close-report",
      status: "closed",
      account: world.id,
      destination: world.destination,
      feeSponsor: world.sponsor.publicKey(),
      verification: { accountExists: false, horizonStatus: 404 },
    });
    expect(report.transactions.map((t) => t.hash)).toEqual(hashes(world));
    // The plan, the progress and the receipt went to standard error.
    expect(r.err).toContain("re-read for execution");
    expect(r.err).toContain("submitted");
    expect(r.err).toContain("Dustin close receipt   CLOSED");
    expectNoSecret(world, r.out, r.err);
  });

  it("writes the report file as the run progresses and at the end", async () => {
    const world = zeroSpendableWorld();
    const path = join(emptyDir(), "receipts", "close.json");
    const r = await closeCli(world, executeArgs(world, "--yes", "--json", "--report", path));
    expect(r.code).toBe(0);
    expect(existsSync(path)).toBe(true);
    const text = readFileSync(path, "utf8");
    const saved = JSON.parse(text) as CloseReport;
    expect(saved).toEqual(JSON.parse(r.out));
    expect(saved.status).toBe("closed");
    expect(r.err).toContain(`Report written to ${path}`);
    expectNoSecret(world, text);
  });

  it("never overwrites an earlier report: a re-run keeps it under a new name", async () => {
    const world = zeroSpendableWorld({ market: true });
    const dir = emptyDir();
    const path = join(dir, "close.json");
    // The first run stops after one submission; its report holds that hash.
    const t = tap(world, { posts: 1, then: () => Promise.reject(new Error("ECONNRESET")) });
    const first = await closeCli(world, executeArgs(world, "--yes", "--report", path), {
      fetch: t.fetch,
    });
    expect(first.code).toBe(5);
    const earlier = readFileSync(path, "utf8");
    const earlierHash = (JSON.parse(earlier) as CloseReport).transactions[0]!.hash;
    // The re-run continues from the ledger and writes its own report to the same path.
    const second = await closeCli(world, executeArgs(world, "--yes", "--report", path));
    expect(second.code).toBe(0);
    const aside = readdirSync(dir).filter(
      (f) => f.startsWith("close.json.") && !f.endsWith(".tmp"),
    );
    expect(aside).toHaveLength(1);
    expect(readFileSync(join(dir, aside[0]!), "utf8")).toBe(earlier);
    expect(second.err).toContain(`was kept as ${join(dir, aside[0]!)}`);
    const latest = JSON.parse(readFileSync(path, "utf8")) as CloseReport;
    expect(latest.status).toBe("closed");
    expect(latest.transactions.map((x) => x.hash)).not.toContain(earlierHash);
  });

  it("refuses a .env file as the report path, so the secrets are never moved or replaced", async () => {
    const world = zeroSpendableWorld();
    const r = await closeCli(
      world,
      executeArgs(world, "--yes", "--report", join(emptyDir(), ".env")),
    );
    expect(r.code).toBe(2);
    expect(r.err).toContain("it is a .env file");
    expect(world.ledger.submissions).toHaveLength(0);
  });

  it("refuses an empty --report path before anything is signed (exit 2)", async () => {
    const world = zeroSpendableWorld();
    const r = await closeCli(world, executeArgs(world, "--yes", "--report", ""));
    expect(r.code).toBe(2);
    expect(r.err).toContain("the path is empty");
    expect(world.ledger.submissions).toHaveLength(0);
  });

  it("says the report was NOT written when every write failed", async () => {
    const world = zeroSpendableWorld();
    const dir = emptyDir();
    const path = join(dir, "close.json");
    // The directory passes the check before the confirmation, then disappears before the run.
    const r = await closeCli(world, executeArgs(world, "--report", path), {
      answer: () => {
        rmSync(dir, { recursive: true, force: true });
        return world.destination.slice(-4);
      },
    });
    expect(r.code).toBe(0);
    expect(existsSync(path)).toBe(false);
    expect(r.out).toContain(`Report NOT written to ${path}`);
    expect(r.out).not.toContain(`Report written to ${path}`);
  });

  it("keeps the submitted hashes in the report file when the run fails", async () => {
    const world = zeroSpendableWorld({ market: true });
    const path = join(emptyDir(), "close.json");
    const t = tap(world, { posts: 1, then: () => Promise.reject(new Error("ECONNRESET")) });
    const r = await closeCli(world, executeArgs(world, "--yes", "--report", path), {
      fetch: t.fetch,
    });
    expect(r.code).toBe(5);
    const saved = JSON.parse(readFileSync(path, "utf8")) as CloseReport;
    expect(saved.transactions.map((x) => x.hash)).toEqual([hashes(world)[0]]);
    expect(saved.status).toBe("failed");
  });

  it("refuses a report path it cannot write before anything is signed (exit 2)", async () => {
    const world = zeroSpendableWorld();
    const dir = emptyDir();
    const r = await closeCli(world, executeArgs(world, "--yes", "--report", dir));
    expect(r.code).toBe(2);
    expect(r.err).toContain("CONFIG_INVALID");
    expect(world.ledger.submissions).toHaveLength(0);
  });
});

describe("dustin close without --execute", () => {
  it("notes that --yes, --partial and --report have no effect and prints the plan (exit 0)", async () => {
    const world = zeroSpendableWorld();
    const r: CliRun = await closeCli(world, [
      "close",
      world.id,
      "--to",
      world.destination,
      "--yes",
      "--partial",
    ]);
    expect(r.code).toBe(0);
    expect(r.err).toMatch(/--yes and --partial have no effect without --execute/);
    expect(r.out).toContain("dry run: nothing is signed, nothing is submitted");
    expect(r.out).toContain("Next: add --execute to run this plan");
    expect(world.ledger.submissions).toHaveLength(0);
  });
});

describe("no secret anywhere (PRD NFR-04, T-20)", () => {
  it("never prints, writes or throws a secret on any path", async () => {
    const texts: string[] = [];
    const collect = (r: CliRun): void => {
      texts.push(r.out, r.err, ...r.prompts);
    };
    const scenarios: Array<(world: World) => Promise<void>> = [
      async (w) => collect(await closeCli(w, executeArgs(w, "--yes"))),
      async (w) => collect(await closeCli(w, executeArgs(w), { answer: "nope" })),
      async (w) => collect(await closeCli(w, executeArgs(w, "--yes", "--json"))),
      async (w) => {
        const path = join(emptyDir(), "r.json");
        collect(await closeCli(w, executeArgs(w, "--yes", "--report", path)));
        texts.push(readFileSync(path, "utf8"));
      },
      async (w) =>
        collect(
          await closeCli(w, executeArgs(w, "--yes"), {
            env: { ...w.env, DUSTIN_ACCOUNT_SECRET: Keypair.random().secret() },
          }),
        ),
      async (w) => {
        const t = tap(w, { posts: 1, then: () => Promise.reject(new Error("ECONNRESET")) });
        collect(await closeCli(w, executeArgs(w, "--yes"), { fetch: t.fetch }));
      },
    ];
    for (const scenario of scenarios) {
      const world = zeroSpendableWorld({ market: true });
      const start = texts.length;
      await scenario(world);
      expect(texts.length).toBeGreaterThan(start);
      expectNoSecret(world, ...texts.slice(start));
    }
  });
});
