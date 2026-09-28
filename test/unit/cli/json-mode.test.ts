import { Keypair } from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";
import type { CloseReport } from "../../../src/execute/report.js";
import type { ClosePlan } from "../../../src/plan/model.js";
import { failedOps, recordIncludedFaults } from "../execute/harness.js";
import {
  closeCli,
  executeArgs,
  secretForms,
  zeroSpendableWorld,
  type CliRun,
  type Fetch,
  type World,
} from "./close-world.js";

// Review finding AA-10 (story E4-S1; docs/ux-design.md section 2.8; PRD FR-19): `--json` is
// machine mode. Standard output carries exactly one JSON document; standard error carries NDJSON
// only, one JSON object per line with a `type`: the executor's CloseEvent types with their fields
// (`plan` in a compact form), and the CLI's `notice` and `error` lines. `close --execute --json`
// never asks anything: without --yes it is refused with CONFIRMATION_REQUIRED (exit 3).

type Line = { type: string } & Record<string, unknown>;

/** Every line of standard error as JSON; fails the test on a line that is not an object with a type. */
function ndjson(r: CliRun): Line[] {
  if (r.err === "") return [];
  expect(r.err.endsWith("\n"), "standard error ends with a line break").toBe(true);
  return r.err
    .slice(0, -1)
    .split("\n")
    .map((text) => {
      const value = JSON.parse(text) as unknown;
      expect(value, text).toBeTypeOf("object");
      expect((value as Line).type, text).toBeTypeOf("string");
      return value as Line;
    });
}

const planArgs = (world: World, ...extra: string[]) => [
  "plan",
  world.id,
  "--to",
  world.destination,
  ...extra,
];

describe("plan --json and the dry-run close --json (AA-10)", () => {
  it("plan --json prints one JSON document and nothing at all on standard error", async () => {
    const world = zeroSpendableWorld();
    const r = await closeCli(world, planArgs(world, "--json"));
    expect(r.code).toBe(0);
    expect((JSON.parse(r.out) as ClosePlan).kind).toBe("dustin-close-plan");
    expect(r.err).toBe("");
  });

  it("the dry-run close --json says the ignored flags in one notice line", async () => {
    const world = zeroSpendableWorld();
    const r = await closeCli(world, [
      "close",
      world.id,
      "--to",
      world.destination,
      "--json",
      "--yes",
    ]);
    expect(r.code).toBe(0);
    expect((JSON.parse(r.out) as ClosePlan).kind).toBe("dustin-close-plan");
    expect(ndjson(r)).toEqual([
      {
        type: "notice",
        message: "note: --yes has no effect without --execute; this is a dry run.",
      },
    ]);
  });

  it("reports an unreachable Horizon as one error line with its exit code (exit 6)", async () => {
    const world = zeroSpendableWorld();
    const r = await closeCli(world, planArgs(world, "--json"), {
      fetch: () => Promise.reject(new Error("ECONNREFUSED")),
    });
    expect(r.code).toBe(6);
    expect(r.out).toBe("");
    expect(ndjson(r)).toEqual([
      {
        type: "error",
        code: "HORIZON_UNAVAILABLE",
        message: expect.stringContaining("is unreachable") as unknown,
        remedy: expect.any(String) as unknown,
        exitCode: 6,
      },
    ]);
  });

  it("reports a usage error as one error line, without commander's help text (exit 2)", async () => {
    const world = zeroSpendableWorld();
    const r = await closeCli(world, ["plan", "--json"]);
    expect(r.code).toBe(2);
    const lines = ndjson(r);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ type: "error", code: "USAGE_ERROR", exitCode: 2 });
    expect(r.err).not.toContain("Usage:");
  });

  it("reports a refused network and a secret on argv as error lines (exit 2)", async () => {
    const world = zeroSpendableWorld();
    const network = await closeCli(world, ["--network", "public", ...planArgs(world, "--json")]);
    expect(network.code).toBe(2);
    expect(ndjson(network)).toEqual([expect.objectContaining({ code: "MAINNET_REFUSED" })]);
    const seed = Keypair.random().secret();
    const secret = await closeCli(world, [...planArgs(world, "--json"), "--memo", seed]);
    expect(secret.code).toBe(2);
    expect(ndjson(secret)).toEqual([
      expect.objectContaining({ type: "error", code: "SECRET_IN_ARGV", exitCode: 2 }),
    ]);
    expect(secret.err).not.toContain(seed);
  });
});

describe("close --execute --json (AA-10)", () => {
  it("streams NDJSON events with full hashes and addresses, and prints the report on standard output", async () => {
    const world = zeroSpendableWorld({ market: true });
    const r = await closeCli(world, executeArgs(world, "--json", "--yes"));
    expect(r.code).toBe(0);
    const report = JSON.parse(r.out) as CloseReport;
    expect(report.kind).toBe("dustin-close-report");
    const lines = ndjson(r);
    const types = new Set(lines.map((l) => l.type));
    for (const type of [
      "notice",
      "plan",
      "preflight",
      "tx:building",
      "tx:submitted",
      "tx:confirmed",
      "verified",
      "done",
    ]) {
      expect(types.has(type), type).toBe(true);
    }
    for (const line of lines) {
      expect([
        "notice",
        "error",
        "plan",
        "drift",
        "preflight",
        "wait",
        "tx:building",
        "tx:submitted",
        "tx:confirmed",
        "tx:failed",
        "verified",
        "done",
      ]).toContain(line.type);
    }
    // The plan line is compact: the hash, the round, the status and the counts, not the plan.
    const plan = lines.find((l) => l.type === "plan")!;
    expect(plan).toEqual({
      type: "plan",
      round: 0,
      planHash: report.planHash,
      status: "closable",
      counts: { steps: 5, transactions: 3, unclosable: 0, blockers: 0 },
    });
    // Every submitted hash in full, with its explorer URL, one line each.
    const submitted = lines.filter((l) => l.type === "tx:submitted");
    expect(submitted.map((l) => l.hash)).toEqual(report.transactions.map((t) => t.hash));
    for (const l of submitted) {
      expect(l.hash).toMatch(/^[0-9a-f]{64}$/);
      expect(l.explorerUrl).toBe(`https://stellar.expert/explorer/testnet/tx/${String(l.hash)}`);
    }
    expect(lines.at(-1)).toEqual({ type: "done", status: "closed" });
    for (const form of secretForms(world.account, world.sponsor)) {
      expect(r.out + r.err).not.toContain(form);
    }
  });

  it("ends a refused run with an error line and prints the refused plan (exit 3)", async () => {
    const world = zeroSpendableWorld({ unauthorized: true });
    const r = await closeCli(world, executeArgs(world, "--json", "--yes"));
    expect(r.code).toBe(3);
    expect((JSON.parse(r.out) as ClosePlan).kind).toBe("dustin-close-plan");
    expect(ndjson(r)).toEqual([
      expect.objectContaining({ type: "error", code: "PLAN_NOT_CLOSABLE", exitCode: 3 }),
    ]);
  });

  it("prints the refusal for people on standard output only, as before machine mode existed", async () => {
    const world = zeroSpendableWorld({ unauthorized: true });
    const r = await closeCli(world, executeArgs(world, "--yes"));
    expect(r.code).toBe(3);
    expect(r.out).toContain("Not executed: the plan cannot end in a merge");
    expect(r.err).toBe("");
  });

  it("ends a run that stopped with the stop as its last line (exit 5)", async () => {
    const world = zeroSpendableWorld({ market: true });
    const recording = recordIncludedFaults(world.ledger, world.ledger.fetch);
    let posts = 0;
    const fetch: Fetch = (url, init) => {
      if ((init?.method ?? "GET") === "POST" && ++posts === 2) {
        world.ledger.faults.push(failedOps("op_success", "op_cannot_delete"));
      }
      return recording(url, init);
    };
    const r = await closeCli(world, executeArgs(world, "--json", "--yes"), { fetch });
    expect(r.code).toBe(5);
    const lines = ndjson(r);
    expect(lines.some((l) => l.type === "tx:failed")).toBe(true);
    expect(lines.at(-1)).toMatchObject({
      type: "error",
      code: "OPERATION_FAILED",
      exitCode: 5,
      remedy: expect.any(String) as unknown,
    });
    expect((JSON.parse(r.out) as CloseReport).status).toBe("failed");
  });

  it("carries the executor's error, attached report and all, as an error line (exit 5)", async () => {
    const world = zeroSpendableWorld({ market: true });
    // Horizon becomes unreachable after the first POST: every later request fails.
    let posts = 0;
    const fetch: Fetch = async (url, init) => {
      if (posts >= 1) throw new Error("ECONNRESET");
      const response = await world.ledger.fetch(url, init);
      if ((init?.method ?? "GET") === "POST") posts += 1;
      return response;
    };
    const r = await closeCli(world, executeArgs(world, "--json", "--yes"), { fetch });
    expect(r.code).toBe(5);
    const lines = ndjson(r);
    const error = lines.find((l) => l.type === "error");
    expect(error?.exitCode).toBe(5);
    expect((JSON.parse(r.out) as CloseReport).transactions.length).toBeGreaterThan(0);
  });
});
