import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { Keypair, Networks } from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";
import type { SignalSource } from "../../../src/cli/commands/close.js";
import { run } from "../../../src/cli/run.js";
import { packageVersion } from "../../../src/cli/version.js";
import type { executeClose } from "../../../src/execute/executor.js";
import type { CloseReport } from "../../../src/execute/report.js";
import { failedOps, recordIncludedFaults } from "../execute/harness.js";
import {
  LEDGER,
  closeCli,
  emptyDir,
  executeArgs,
  zeroSpendableWorld,
  type CliRun,
  type Fetch,
  type World,
} from "./close-world.js";

// The whole exit-code table of docs/README.md canonical decision 5 through `run()` (story E4-S1,
// AC-E4-S1-3; story E4-S2): every code from 0 to 6, and every cause of 3, each with a case that
// reaches it the way a user would, offline on the fake ledger.
//
// 0 plan printed, or account closed and verified gone; 1 unexpected error; 2 usage or validation
// error (bad address, secret on argv, wrong key, mainnet requested, missing secrets); 3 nothing
// executed (no confirmation, missing or declined; blockers without --partial; a sponsor or budget
// precondition failed; and every other refusal before anything is signed: nothing to execute, a
// changed plan, less XLM for the destination); 4 partial, account still exists; 5 stopped or
// failed during execution; 6 Horizon unreachable before any submission.

class FakeSignals extends EventEmitter implements SignalSource {}

/** A fetch that runs `before` ahead of the POST numbered `post` (1-based), then forwards it. */
function beforePost(world: World, post: number, before: () => void, base?: Fetch): Fetch {
  let posts = 0;
  const next = base ?? world.ledger.fetch;
  return (url, init) => {
    if ((init?.method ?? "GET") === "POST" && ++posts === post) before();
    return next(url, init);
  };
}

const planArgs = (w: World) => ["plan", w.id, "--to", w.destination];

interface Case {
  code: number;
  meaning: string;
  /** What must be true of the run besides its exit code. */
  check?: (r: CliRun, world: World) => void;
  run: (world: World) => Promise<CliRun>;
  world?: () => World;
}

const nothingSubmitted = (_r: CliRun, world: World) =>
  expect(world.ledger.submissions).toHaveLength(0);

const table: Case[] = [
  {
    code: 0,
    meaning: "plan printed",
    run: (w) => closeCli(w, planArgs(w)),
    check: (r) => expect(r.out).toContain("Dustin plan  (dry run"),
  },
  {
    code: 0,
    meaning: "plan printed, whatever its status (a partial plan)",
    world: () => zeroSpendableWorld({ unauthorized: true }),
    run: (w) => closeCli(w, planArgs(w)),
  },
  {
    code: 0,
    meaning: "closed and verified gone",
    run: (w) => closeCli(w, executeArgs(w, "--yes")),
    check: (r, w) => {
      expect(w.ledger.accounts.has(w.id)).toBe(false);
      expect(r.out).toContain("no longer exists on Horizon (404)");
    },
  },
  {
    code: 1,
    meaning: "unexpected error",
    run: (w) =>
      closeCli(w, planArgs(w), { fetch: () => Promise.resolve(null as unknown as Response) }),
    check: (r) => expect(r.err).toContain("unexpected error"),
  },
  {
    code: 2,
    meaning: "usage error: an unknown option",
    run: (w) => closeCli(w, [...planArgs(w), "--frobnicate"]),
  },
  {
    code: 2,
    meaning: "validation error: a bad address",
    run: (w) => closeCli(w, ["plan", "GNOTANADDRESS", "--to", w.destination]),
    check: (r) => expect(r.err).toContain("INVALID_ADDRESS"),
  },
  {
    code: 2,
    meaning: "a secret on argv",
    run: (w) => closeCli(w, [...planArgs(w), "--memo", Keypair.random().secret()]),
    check: (r) => expect(r.err).toContain("SECRET_IN_ARGV"),
  },
  {
    code: 2,
    meaning: "a wrong key",
    run: (w) =>
      closeCli(w, executeArgs(w, "--yes"), {
        env: { ...w.env, DUSTIN_ACCOUNT_SECRET: Keypair.random().secret() },
      }),
    check: (r) => expect(r.err).toContain("WRONG_SIGNER"),
  },
  {
    code: 2,
    meaning: "mainnet requested",
    run: (w) => closeCli(w, ["--network", "public", ...planArgs(w)]),
    check: (r) => expect(r.err).toContain("MAINNET_REFUSED"),
  },
  {
    code: 2,
    meaning: "a Horizon that serves another network",
    run: (w) =>
      closeCli(w, planArgs(w), {
        fetch: (url, init) =>
          url === "https://horizon-testnet.stellar.org/"
            ? Promise.resolve(new Response(JSON.stringify({ network_passphrase: Networks.PUBLIC })))
            : w.ledger.fetch(url, init),
      }),
    check: (r) => expect(r.err).toContain("MAINNET_REFUSED"),
  },
  {
    code: 2,
    meaning: "missing secrets",
    run: (w) => closeCli(w, executeArgs(w, "--yes"), { env: {} }),
    check: (r) => expect(r.err).toContain("MISSING_ACCOUNT_SECRET"),
  },
  {
    code: 3,
    meaning: "nothing executed: the confirmation is missing (no terminal to ask on)",
    run: (w) => closeCli(w, executeArgs(w)),
    check: (r, w) => {
      expect(r.err).toContain("CONFIRMATION_DECLINED");
      nothingSubmitted(r, w);
    },
  },
  {
    code: 3,
    meaning: "nothing executed: the confirmation is declined",
    run: (w) => closeCli(w, executeArgs(w), { answer: "nope" }),
    check: nothingSubmitted,
  },
  {
    code: 3,
    meaning: "nothing executed: --json without --yes (machine mode never asks)",
    run: (w) => closeCli(w, executeArgs(w, "--json")),
    check: (r, w) => {
      expect(r.err).toContain("CONFIRMATION_REQUIRED");
      nothingSubmitted(r, w);
    },
  },
  {
    code: 3,
    meaning: "nothing executed: blockers without --partial",
    world: () => zeroSpendableWorld({ unauthorized: true }),
    run: (w) => closeCli(w, executeArgs(w, "--yes")),
    check: nothingSubmitted,
  },
  {
    code: 3,
    meaning: "nothing executed: the sponsor cannot cover the close budget",
    run: (w) => {
      w.ledger.accounts.get(w.sponsor.publicKey())!.balances[0]!.balance = "3.0000000";
      return closeCli(w, executeArgs(w, "--yes"));
    },
    check: (r, w) => {
      expect(r.err).toContain("SPONSOR_UNDERFUNDED");
      nothingSubmitted(r, w);
    },
  },
  {
    code: 3,
    meaning: "nothing executed: the fee bids exceed the close budget",
    world: () => zeroSpendableWorld({ dataEntries: 60 }),
    run: (w) => closeCli(w, executeArgs(w, "--yes", "--base-fee", "1000000")),
    check: (r, w) => {
      expect(r.err).toContain("SPONSOR_BUDGET_EXCEEDED");
      nothingSubmitted(r, w);
    },
  },
  {
    code: 3,
    meaning: "nothing executed: nothing to execute (the account is gone; its 404 is recorded)",
    run: (w) => {
      w.ledger.accounts.delete(w.id);
      return closeCli(w, executeArgs(w, "--yes"));
    },
    check: (r) => expect(r.out).toContain("no longer exists on Horizon (404)"),
  },
  {
    code: 3,
    meaning: "nothing executed: the plan changed between the plan shown and the fresh plan",
    run: (w) =>
      closeCli(w, executeArgs(w), {
        answer: () => {
          const acc = w.ledger.accounts.get(w.id)!;
          acc.data = { ...acc.data, late: "MQ==" };
          acc.subentry_count += 1;
          return w.destination.slice(-4);
        },
      }),
    check: (r, w) => {
      expect(r.out).toContain("PLAN_CHANGED");
      nothingSubmitted(r, w);
    },
  },
  {
    code: 3,
    meaning: "nothing executed: the destination would receive less XLM",
    world: () => zeroSpendableWorld({ market: true }),
    run: (w) =>
      closeCli(w, executeArgs(w), {
        answer: () => {
          w.ledger.quotes.set(`DUST:${w.issuer}`, "0.0000002");
          return w.destination.slice(-4);
        },
      }),
    check: (r, w) => {
      expect(r.out).toContain("XLM_TO_DESTINATION_FELL");
      nothingSubmitted(r, w);
    },
  },
  {
    code: 3,
    meaning: "nothing executed: interrupted by a signal before anything was submitted",
    run: (w) => {
      const signals = new FakeSignals();
      return closeCli(w, executeArgs(w, "--yes"), {
        signals,
        onStdout: (text) => {
          if (text.includes("Closing ")) signals.emit("SIGINT");
        },
      });
    },
    check: (r, w) => {
      expect(r.out).toContain("INTERRUPTED");
      nothingSubmitted(r, w);
    },
  },
  {
    code: 4,
    meaning: "partial: everything else ran and the account still exists",
    world: () => zeroSpendableWorld({ unauthorized: true }),
    run: (w) => closeCli(w, executeArgs(w, "--yes", "--partial")),
    check: (r, w) => {
      expect(w.ledger.accounts.has(w.id)).toBe(true);
      expect(r.out).toContain("Dustin close receipt   PARTIAL");
    },
  },
  {
    code: 5,
    meaning: "stopped: an operation failed on the ledger after a submission",
    world: () => zeroSpendableWorld({ market: true }),
    run: (w) => {
      const recording = recordIncludedFaults(w.ledger, w.ledger.fetch);
      const fetch = beforePost(
        w,
        2,
        () => void w.ledger.faults.push(failedOps("op_success", "op_cannot_delete")),
        recording,
      );
      return closeCli(w, executeArgs(w, "--yes"), { fetch });
    },
    check: (r) => expect(r.out).toContain("Dustin close receipt   FAILED"),
  },
  {
    code: 5,
    meaning: "stopped: interrupted by a signal after a submission",
    world: () => zeroSpendableWorld({ market: true }),
    run: (w) => {
      const signals = new FakeSignals();
      const fetch = beforePost(w, 1, () => signals.emit("SIGTERM"));
      return closeCli(w, executeArgs(w, "--yes"), { fetch, signals });
    },
    check: (r, w) => {
      expect(r.out).toContain("INTERRUPTED");
      expect(w.ledger.submissions).toHaveLength(1);
    },
  },
  {
    code: 5,
    meaning: "stopped: Horizon became unreachable after the first submission",
    world: () => zeroSpendableWorld({ market: true }),
    run: (w) => {
      let posts = 0;
      const fetch: Fetch = async (url, init) => {
        if (posts >= 1) throw new Error("ECONNRESET");
        const response = await w.ledger.fetch(url, init);
        if ((init?.method ?? "GET") === "POST") posts += 1;
        return response;
      };
      return closeCli(w, executeArgs(w, "--yes"), { fetch });
    },
  },
  {
    code: 5,
    meaning: "stopped: the merge applied but the account was not verified gone",
    run: (w) => {
      const stub: typeof executeClose = (plan) =>
        Promise.resolve({
          schemaVersion: 1,
          kind: "dustin-close-report",
          network: plan.network,
          account: plan.account,
          destination: plan.destination,
          feeSponsor: plan.feeSponsor ?? "",
          planHash: plan.planHash,
          status: "closed",
          message: null,
          stop: null,
          startedAt: "2026-09-28T00:00:00.000Z",
          finishedAt: "2026-09-28T00:00:01.000Z",
          transactions: [],
          steps: [],
          replans: [],
          unclosable: [],
          blockers: [],
          warnings: [],
          recovery: {
            mergedXlm: null,
            reservesReturnedToSponsors: [],
            feesPaidByAccount: "0",
            feesPaidBySponsorStroops: 0,
          },
          verification: null,
        } satisfies CloseReport);
      return closeCli(w, executeArgs(w, "--yes"), { executeClose: stub });
    },
    check: (r) => expect(r.err).toContain("not verified gone"),
  },
  {
    code: 6,
    meaning: "Horizon unreachable before any submission (plan)",
    run: (w) =>
      closeCli(w, planArgs(w), { fetch: () => Promise.reject(new Error("ECONNREFUSED")) }),
  },
  {
    code: 6,
    meaning: "Horizon unreachable before any submission (close --execute)",
    run: (w) =>
      closeCli(w, executeArgs(w, "--yes"), {
        fetch: () => Promise.reject(new Error("ECONNREFUSED")),
      }),
    check: (r) => expect(r.err).toContain("HORIZON_UNAVAILABLE"),
  },
];

describe("the exit codes of canonical decision 5, end to end", () => {
  it("has a case for every code from 0 to 6", () => {
    expect([...new Set(table.map((c) => c.code))].sort()).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it.each(table.map((c) => [c.code, c.meaning, c] as const))("%i: %s", async (code, _m, c) => {
    const world = (c.world ?? (() => zeroSpendableWorld()))();
    const r = await c.run(world);
    expect(r.code, `${r.out}\n${r.err}`).toBe(code);
    c.check?.(r, world);
  });

  it("5: a second signal exits at once with code 5", async () => {
    const world = zeroSpendableWorld({ market: true });
    const signals = new FakeSignals();
    const exits: number[] = [];
    const fetch = beforePost(world, 1, () => {
      signals.emit("SIGINT");
      signals.emit("SIGINT");
    });
    await closeCli(world, executeArgs(world, "--yes", "--report", `${emptyDir()}/r.json`), {
      fetch,
      signals,
      exit: (code) => void exits.push(code),
    });
    expect(exits).toEqual([5]);
  });

  it("the ledger the fake world starts at is the one the cases above assume", () => {
    expect(zeroSpendableWorld().ledger.ledgerSeq).toBe(LEDGER);
  });
});

describe("dustin --version (AC-E4-S1-3)", () => {
  it("prints the version of package.json", async () => {
    const pkg = JSON.parse(
      readFileSync(new URL("../../../package.json", import.meta.url), "utf8"),
    ) as { version: string };
    expect(packageVersion()).toBe(pkg.version);
    const out: string[] = [];
    const code = await run(
      ["node", "dustin", "--version"],
      { stdout: (s) => void out.push(s), stderr: () => undefined },
      packageVersion(),
    );
    expect(code).toBe(0);
    expect(out.join("").trim()).toBe(pkg.version);
  });
});
