import { describe, expect, it } from "vitest";
import { DustinError } from "../../../src/errors/dustin-error.js";
import type { executeClose } from "../../../src/execute/executor.js";
import type { CloseReport, SubmittedTransaction } from "../../../src/execute/report.js";
import type { ClosePlan } from "../../../src/plan/model.js";
import {
  closeCli,
  executeArgs,
  secretForms,
  zeroSpendableWorld,
  type World,
} from "./close-world.js";

// The exit-code contract of `close --execute` (canonical decision 5) with a stub executor, so it
// holds whatever the executor does inside: these cases depend only on what it returns or throws.

type Execute = typeof executeClose;

function report(plan: ClosePlan, patch: Partial<CloseReport>): CloseReport {
  return {
    schemaVersion: 1,
    kind: "dustin-close-report",
    network: plan.network,
    account: plan.account,
    destination: plan.destination,
    feeSponsor: plan.feeSponsor ?? "",
    planHash: plan.planHash,
    status: "aborted",
    message: null,
    startedAt: "2026-09-26T00:00:00.000Z",
    finishedAt: null,
    transactions: [],
    steps: [],
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
    ...patch,
  };
}

const submitted = (plan: ClosePlan): SubmittedTransaction => ({
  index: 0,
  phase: "cleanup",
  stepIds: plan.transactions[0]!.stepIds,
  attempts: 1,
  hash: "a".repeat(64),
  innerHash: "b".repeat(64),
  result: "pending",
  ledger: null,
  feeChargedStroops: null,
  feeAccount: plan.feeSponsor ?? "",
  innerEnvelopeXdr: "AAAA",
  feeBumpEnvelopeXdr: "AAAA",
  explorerUrl: `https://stellar.expert/explorer/testnet/tx/${"a".repeat(64)}`,
});

async function withStub(world: World, stub: Execute, ...extra: string[]) {
  return closeCli(world, executeArgs(world, "--yes", ...extra), { executeClose: stub });
}

describe("close --execute exit codes, whatever the executor does inside", () => {
  it("exits 5 with a message when a merge is reported but the account is not verified gone", async () => {
    const world = zeroSpendableWorld();
    const stub: Execute = (plan) =>
      Promise.resolve(
        report(plan, {
          status: "closed",
          transactions: [{ ...submitted(plan), result: "applied", ledger: 5_000_001 }],
          verification: {
            accountExists: true,
            horizonStatus: 200,
            checkedAt: "2026-09-26T00:00:01.000Z",
            accountUrl: "",
          },
        }),
      );
    const r = await withStub(world, stub);
    expect(r.code).toBe(5);
    expect(r.err).toMatch(/not verified gone/);
    expect(r.out).toContain(`account ${world.id} still exists on Horizon (200)`);
  });

  it("exits 5 and prints the attached report when the executor throws after a submission", async () => {
    const world = zeroSpendableWorld();
    const stub: Execute = (plan, _signers, options) => {
      const partial = report(plan, { status: "failed", transactions: [submitted(plan)] });
      options.onReport?.(partial);
      return Promise.reject(
        new DustinError("HORIZON_UNAVAILABLE", "Horizon at x is unreachable.", {
          stage: "inspect",
          report: partial,
        }),
      );
    };
    const human = await withStub(world, stub);
    expect(human.code).toBe(5);
    expect(human.err).toContain("HORIZON_UNAVAILABLE");
    expect(human.out).toContain("a".repeat(64));
    expect(human.out).toMatch(/pending/);
    const json = await withStub(world, stub, "--json");
    expect(json.code).toBe(5);
    expect((JSON.parse(json.out) as CloseReport).transactions[0]!.hash).toBe("a".repeat(64));
  });

  it("maps an error thrown before any submission by its code, printing an attached report with --json", async () => {
    const world = zeroSpendableWorld();
    const cases: Array<[DustinError["code"], DustinError["stage"], number]> = [
      ["HORIZON_UNAVAILABLE", "inspect", 6],
      ["SPONSOR_UNDERFUNDED", "sponsor", 2],
      ["SPONSOR_BUDGET_EXCEEDED", "sponsor", 2],
      ["EXECUTION_INTERRUPTED", "submit", 5],
      ["TOO_MANY_OPERATIONS", "build", 1],
    ];
    for (const [code, stage, exit] of cases) {
      const stub: Execute = (plan) =>
        Promise.reject(new DustinError(code, "stopped", { stage, report: report(plan, {}) }));
      const r = await withStub(world, stub, "--json");
      expect(r.code, code).toBe(exit);
      expect(r.err).toContain(code);
      expect((JSON.parse(r.out) as CloseReport).transactions).toEqual([]);
    }
  });

  it("exits 5 on an unexpected error after a submission, keeping the hashes", async () => {
    const world = zeroSpendableWorld();
    const stub: Execute = (plan, _signers, options) => {
      options.onEvent?.({
        type: "tx:submitted",
        index: 0,
        hash: "c".repeat(64),
        explorerUrl: "https://stellar.expert/explorer/testnet/tx/c",
      });
      options.onReport?.(
        report(plan, { transactions: [{ ...submitted(plan), hash: "c".repeat(64) }] }),
      );
      return Promise.reject(new TypeError(`boom ${world.account.secret()}`));
    };
    const r = await withStub(world, stub);
    expect(r.code).toBe(5);
    expect(r.out).toContain("c".repeat(64));
    expect(r.err).toMatch(/unexpected error/);
    for (const form of secretForms(world.account, world.sponsor)) {
      expect(r.out + r.err).not.toContain(form);
    }
  });

  it("passes confirm: true, the chosen options and signers for the right keys", async () => {
    const world = zeroSpendableWorld();
    let seen: Parameters<Execute> | undefined;
    const stub: Execute = (...args) => {
      seen = args;
      return Promise.resolve(report(args[0], { status: "aborted", message: "stub" }));
    };
    const r = await closeCli(
      world,
      executeArgs(world, "--yes", "--partial", "--base-fee", "250", "--memo", "42"),
      { executeClose: stub },
    );
    expect(r.code).toBe(3);
    const [plan, signers, options] = seen!;
    expect(plan.memo).toBe("42");
    expect(plan.feeSponsor).toBe(world.sponsor.publicKey());
    expect(signers.account.publicKey()).toBe(world.id);
    expect(signers.feeSponsor.publicKey()).toBe(world.sponsor.publicKey());
    expect(options).toMatchObject({ confirm: true, allowPartial: true, maxBaseFeeStroops: 250 });
    expect(options.reader).toBeDefined();
    expect(options.submitter).toBeDefined();
    expect(JSON.stringify(options)).not.toContain(world.account.secret());
  });
});
