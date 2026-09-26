import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Keypair, Networks } from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";
import type { CloseReport } from "../../../src/execute/report.js";
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

  it("with --json still asks, on standard error, and keeps standard output empty when declined", async () => {
    const world = zeroSpendableWorld();
    const r = await closeCli(world, executeArgs(world, "--json"), { answer: "nope" });
    expect(r.code).toBe(3);
    expect(r.prompts).toHaveLength(1);
    expect(r.out).toBe("");
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

  it("refuses a bid over the sponsor's budget before asking (exit 2)", async () => {
    const world = zeroSpendableWorld({ dataEntries: 60 });
    const r = await closeCli(world, executeArgs(world, "--base-fee", "1000000"), {
      answer: world.destination.slice(-4),
    });
    expect(r.code).toBe(2);
    expect(r.err).toContain("SPONSOR_BUDGET_EXCEEDED");
    expect(r.prompts).toEqual([]);
    expect(world.ledger.submissions).toHaveLength(0);
  });

  it("refuses a sponsor that cannot cover the budget before asking (exit 2)", async () => {
    const world = zeroSpendableWorld();
    world.ledger.accounts.get(world.sponsor.publicKey())!.balances[0]!.balance = "3.0000000";
    const r = await closeCli(world, executeArgs(world), { answer: world.destination.slice(-4) });
    expect(r.code).toBe(2);
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

describe("dustin close --execute: failures after a submission", () => {
  it("exits 5 when a later transaction fails, printing every submitted hash", async () => {
    const world = zeroSpendableWorld({ market: true });
    const t = tap(world, {
      posts: 1,
      then: (url, init) => {
        world.ledger.quotes.clear(); // the market is gone after the first transaction
        return world.ledger.fetch(url, init);
      },
    });
    const r = await closeCli(world, executeArgs(world, "--yes"), { fetch: t.fetch });
    expect(r.code).toBe(5);
    expect(hashes(world)).toHaveLength(2);
    for (const hash of hashes(world)) expect(r.out).toContain(hash);
    expect(r.out).toContain("op_too_few_offers");
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
