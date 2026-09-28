import { describe, expect, it } from "vitest";
import { executeClose } from "../../../src/execute/executor.js";
import type { CloseReport } from "../../../src/execute/report.js";
import { renderReport } from "../../../src/render/report-text.js";
import { messy } from "../../helpers/snapshots.js";
import { harness, signers } from "../execute/harness.js";

// Story E3-S4: the receipt of a run the sequence guard held back says when to run the close again
// (AC-E3-S4-3: "the receipt says when to rerun").

const next = (text: string) => text.slice(text.indexOf("\nNext ")).replace(/\s+/g, " ");

/** The fixture with its sequence number bumped to (ledger + ahead) << 32. */
function bumpedRun(ahead: number, strip = false) {
  const h = harness();
  const account = h.ledger.accounts.get(messy.fixture)!;
  if (strip) {
    account.balances = account.balances.filter((b) => b.asset_type === "native");
    account.data = {};
    account.subentry_count = 0;
    account.num_sponsored = 0;
    h.ledger.accounts.get(messy.reserveSponsor)!.num_sponsoring = 0;
    h.ledger.offers.set(messy.fixture, []);
  }
  account.sequence = (BigInt(h.ledger.ledgerSeq + ahead) << 32n).toString();
  return h;
}

describe("renderReport and the sequence guard (E3-S4)", () => {
  it("names the ledger to come back at when the wait ran out after the cleanup", async () => {
    const { ledger, deps, plan } = bumpedRun(10);
    const L = ledger.ledgerSeq;
    const report: CloseReport = await executeClose(await plan(), signers(), {
      confirm: true,
      ...deps,
    });
    expect(report.status).toBe("failed");
    const text = renderReport(report);
    expect(text).toContain("Stop code    SEQNUM_TOO_FAR (stage merge, next: replan)");
    expect(next(text)).toContain(
      `The sequence guard holds the merge until ledger ${(L + 11).toLocaleString("en-US")} (ACCOUNT_MERGE_SEQNUM_TOO_FAR). Run the same command again at or after that ledger`,
    );
  });

  it("names it too when nothing was submitted: a merge-only plan whose wait ran out", async () => {
    const { ledger, deps, plan } = bumpedRun(5, true);
    const L = ledger.ledgerSeq;
    const report = await executeClose(await plan(), signers(), { confirm: true, ...deps });
    expect(report.status).toBe("aborted");
    expect(report.transactions).toEqual([]);
    const text = renderReport(report);
    expect(text.split("\n")[0]).toBe("Dustin close receipt   ABORTED: nothing was submitted");
    expect(next(text)).toContain(
      `The sequence guard holds the merge until ledger ${(L + 6).toLocaleString("en-US")}`,
    );
  });

  it("says a partial run held back only by the guard can be run again once the ledger has closed", async () => {
    const { deps, plan } = bumpedRun(720);
    const report = await executeClose(await plan(), signers(), {
      confirm: true,
      ...deps,
      allowPartial: true,
    });
    expect(report.status).toBe("partial");
    const text = renderReport(report);
    expect(text).toContain("SEQNUM_TOO_FAR");
    expect(next(text)).toContain(
      "The account still exists: the sequence guard holds the merge (SEQNUM_TOO_FAR above).",
    );
  });

  it("keeps the usual advice for a partial run with other blockers", async () => {
    const { ledger, deps, plan } = bumpedRun(720);
    // DUSTB frozen by its issuer as well: an unclosable item next to the guard.
    const dustb = ledger.accounts
      .get(messy.fixture)!
      .balances.find((b) => b.asset_code === "DUSTB")!;
    Object.assign(dustb, { is_authorized: false, is_authorized_to_maintain_liabilities: false });
    const report = await executeClose(await plan(), signers(), {
      confirm: true,
      ...deps,
      allowPartial: true,
    });
    expect(report.status).toBe("partial");
    expect(next(renderReport(report))).toContain("Resolve the items above");
  });
});
