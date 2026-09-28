import { beforeAll, describe, expect, it } from "vitest";
import type { ExistingAccountSnapshot } from "../../../src/inspect/snapshot.js";
import type { Blocker, BlockerCode, ClosePlan } from "../../../src/plan/model.js";
import { planFromSnapshot } from "../../../src/plan/plan.js";
import { copy, messy, messySnapshot } from "../../helpers/snapshots.js";

// The closing review of 2026-09-28, planner half (findings CP-1 to CP-7 and CP-15 to CP-17 of the
// edge case hunt): every test here failed on the code before its fix.

let base: ExistingAccountSnapshot;
beforeAll(async () => {
  base = await messySnapshot();
});
const opts = () => ({ destination: messy.destination, feeSponsor: messy.sponsor });

/** The recorded messy fixture with nothing left to clean up: native XLM only. */
function bare(s: ExistingAccountSnapshot): ExistingAccountSnapshot {
  const b = copy(s);
  b.trustlines = [];
  b.poolShares = [];
  b.offers = [];
  b.data = [];
  b.quotes = [];
  b.subentryCount = 0;
  b.numSponsored = 0;
  return b;
}

/** The master key as the account's only signer, with the given weight. */
function onlySigner(s: ExistingAccountSnapshot, weight: number): ExistingAccountSnapshot {
  s.masterWeight = weight;
  s.signers = [{ key: s.account, weight, type: "ed25519_public_key", sponsor: null }];
  return s;
}

function blocker(plan: ClosePlan, code: BlockerCode): Blocker {
  const found = plan.blockers.find((b) => b.code === code);
  if (!found) throw new Error(`no ${code} blocker in ${plan.blockers.map((b) => b.code).join()}`);
  return found;
}

describe("CP-1: the cleanup's threshold counts only when there is a cleanup", () => {
  it("medium 2 above a master weight of 1 that meets low 0 and high 1: an account with nothing to clean up plans its merge", () => {
    // Unordered thresholds are valid (low <= medium <= high is only recommended:
    // https://developers.stellar.org/docs/learn/fundamentals/transactions/signatures-multisig#thresholds).
    // The merge's transaction needs low 0 for its source and high 1 for AccountMerge.
    const s = onlySigner(bare(base), 1);
    s.thresholds = { low: 0, medium: 2, high: 1 };
    const plan = planFromSnapshot(s, opts());
    expect(plan.blockers).toEqual([]);
    expect(plan.status).toBe("closable");
    expect(plan.steps.map((st) => st.kind)).toEqual(["merge"]);
  });

  it("still blocks, with nothing signed, when there is a cleanup the master key cannot sign", () => {
    const s = onlySigner(copy(base), 1);
    s.thresholds = { low: 0, medium: 2, high: 1 };
    const plan = planFromSnapshot(s, opts());
    expect(plan.blockers.map((b) => b.code)).toEqual(["THRESHOLD_UNMET"]);
    expect(blocker(plan, "THRESHOLD_UNMET").reason).toContain(
      "Blocked: the cleanup needs weight 2, so nothing can be signed, and the merge cannot run without the cleanup.",
    );
    expect(plan.steps).toEqual([]);
  });

  it("a data entry alone is a cleanup: it needs the medium threshold", () => {
    const s = onlySigner(bare(base), 1);
    s.data = [{ name: "k", valueBase64: "MQ==" }];
    s.subentryCount = 1;
    s.thresholds = { low: 0, medium: 2, high: 1 };
    const plan = planFromSnapshot(s, opts());
    expect(plan.blockers.map((b) => b.code)).toEqual(["THRESHOLD_UNMET"]);
    expect(plan.steps).toEqual([]);
  });

  it("names no cleanup in the reason when the merge alone is out of reach", () => {
    const high = onlySigner(bare(base), 1);
    high.thresholds = { low: 0, medium: 0, high: 2 };
    const r1 = blocker(planFromSnapshot(high, opts()), "THRESHOLD_UNMET").reason;
    expect(r1).toContain("Blocked: the merge needs weight 2. The account has nothing to clean up.");
    expect(r1).not.toMatch(/cleanup needs weight/i);

    const low = onlySigner(bare(base), 1);
    low.thresholds = { low: 2, medium: 0, high: 0 };
    const r2 = blocker(planFromSnapshot(low, opts()), "THRESHOLD_UNMET").reason;
    expect(r2).toContain(
      "Blocked: every transaction needs weight 2 for its source account (low threshold), so the merge, which needs weight 2, cannot be signed. The account has nothing to clean up.",
    );
    expect(r2).not.toMatch(/cleanup needs weight/i);
  });
});
