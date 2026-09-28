import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { CloseReport } from "../../../src/execute/report.js";
import { LEDGER, closeCli, emptyDir, executeArgs, zeroSpendableWorld } from "./close-world.js";

// Review finding AA-13 (story E4-S2): `dustin close --execute` run again after a completed close.
// Horizon answers 404 for the account (the plan's ACCOUNT_MISSING blocker); the CLI records the 404
// as the SDK does (PRD FR-17: `verification.accountExists === false`, the status, the ledger and the
// account link), prints the receipt, keeps `--report` and prints the report with `--json`. Nothing is
// signed, and the exit code stays 3, "nothing executed" (canonical decision 5).

/** A world whose account a first run already merged away. */
function closedWorld() {
  const world = zeroSpendableWorld();
  world.ledger.accounts.delete(world.id);
  return world;
}

const flat = (text: string) => text.replace(/\s+/g, " ");

describe("dustin close --execute after a completed close (AA-13)", () => {
  it("records Horizon's 404 in the receipt and the --report file and exits 3, signing nothing", async () => {
    const world = closedWorld();
    const path = join(emptyDir(), "close.json");
    const r = await closeCli(world, executeArgs(world, "--yes", "--report", path));
    expect(r.code).toBe(3);
    expect(world.ledger.submissions).toHaveLength(0);
    const out = flat(r.out);
    expect(out).toContain("ACCOUNT_MISSING");
    expect(out).toContain("Dustin close receipt ABORTED: nothing was submitted");
    expect(out).toContain(
      `The account ${world.id} does not exist on the testnet ledger (Horizon answered 404); if an earlier run merged it, the close is complete.`,
    );
    expect(out).toContain(`verified account ${world.id} no longer exists on Horizon (404)`);
    expect(out).toMatch(/Next If an earlier run merged the account, the close is complete/);
    const saved = JSON.parse(readFileSync(path, "utf8")) as CloseReport;
    expect(saved).toMatchObject({
      status: "aborted",
      transactions: [],
      stop: { code: "ACCOUNT_MISSING", stage: "inspect", verdict: "stop" },
      verification: {
        accountExists: false,
        horizonStatus: 404,
        ledger: LEDGER,
        accountUrl: `https://stellar.expert/explorer/testnet/account/${world.id}`,
      },
    });
    expect(r.out).toContain(`Report written to ${path}`);
  });

  it("prints that report, not the plan, as the one JSON document with --json (exit 3)", async () => {
    const world = closedWorld();
    const r = await closeCli(world, executeArgs(world, "--yes", "--json"));
    expect(r.code).toBe(3);
    const printed = JSON.parse(r.out) as CloseReport;
    expect(printed.kind).toBe("dustin-close-report");
    expect(printed.verification).toMatchObject({ accountExists: false, horizonStatus: 404 });
    expect(printed.stop?.code).toBe("ACCOUNT_MISSING");
  });

  it("asks for no confirmation, since nothing can be signed", async () => {
    const world = closedWorld();
    const r = await closeCli(world, executeArgs(world), { answer: "never asked" });
    expect(r.prompts).toEqual([]);
    expect(r.code).toBe(3);
    expect(flat(r.out)).toContain("no longer exists on Horizon (404)");
  });
});
