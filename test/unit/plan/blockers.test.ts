import { Keypair } from "@stellar/stellar-sdk";
import { beforeAll, describe, expect, it } from "vitest";
import type { ExistingAccountSnapshot } from "../../../src/inspect/snapshot.js";
import { mergeBlockers } from "../../../src/plan/blockers.js";
import type { Blocker, BlockerCode, ClosePlan } from "../../../src/plan/model.js";
import { planFromSnapshot } from "../../../src/plan/plan.js";
import { copy, messy, messySnapshot } from "../../helpers/snapshots.js";

// E3-S5, detection-only blockers (docs/epics-and-stories.md Story 3.5), on copies of the recorded
// messy fixture. The planner reports these conditions with a reason and a remedy and never plans an
// operation for them (canonical decision 11; PRD rule R8).

let base: ExistingAccountSnapshot;
beforeAll(async () => {
  base = await messySnapshot();
});

const opts = () => ({ destination: messy.destination });
const K2 = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 77)).publicKey();
const POOL_A = "ab".repeat(32);
const POOL_B = "cd".repeat(32);

function blocker(plan: ClosePlan | { blockers: Blocker[] }, code: BlockerCode): Blocker {
  const found = plan.blockers.find((b) => b.code === code);
  if (!found) throw new Error(`no ${code} blocker in ${plan.blockers.map((b) => b.code).join()}`);
  return found;
}

/** The messy fixture with a second signer of weight 1, as `SetOptions` leaves it. */
function withSecondSigner(
  s: ExistingAccountSnapshot,
  thresholds: ExistingAccountSnapshot["thresholds"],
) {
  s.thresholds = thresholds;
  s.masterWeight = 1;
  s.signers = [
    { key: s.account, weight: 1, type: "ed25519_public_key", sponsor: null },
    { key: K2, weight: 1, type: "ed25519_public_key", sponsor: null },
  ];
  return s;
}

describe("E3-S5 AC-1: liquidity pool shares", () => {
  it("S-08: the remedy names the pool: withdraw from pool <id> first (LiquidityPoolWithdraw); Dustin does not withdraw", () => {
    const s = copy(base);
    s.poolShares.push({
      poolId: POOL_A,
      balance: "1.0000000",
      sponsor: null,
      assets: ["native", `DUSTC:${messy.issuer}`],
    });
    const plan = planFromSnapshot(s, opts());
    const b = blocker(plan, "LIQUIDITY_POOL_SHARES");
    expect(b.remedy).toContain(
      `Withdraw from pool ${POOL_A} first (LiquidityPoolWithdraw); Dustin does not withdraw.`,
    );
    expect(b.reason).toContain(`1.0000000 shares of pool ${POOL_A}`);
    expect(b.reason).toMatch(/two base reserves/);
    expect(b.permanent).toBe(false);
    expect(plan.status).toBe("blocked");
  });

  it("S-08: plans no changeTrust for held shares or for the pool's asset trustlines, and no merge", () => {
    const s = copy(base);
    s.poolShares.push({
      poolId: POOL_A,
      balance: "1.0000000",
      sponsor: null,
      assets: ["native", `DUSTC:${messy.issuer}`],
    });
    const plan = planFromSnapshot(s, opts());
    const trustChanges = plan.steps.filter((st) => st.operation.type === "changeTrust");
    expect(trustChanges.filter((st) => st.subject.type === "pool_share")).toEqual([]);
    expect(
      trustChanges.filter(
        (st) => st.subject.type === "trustline" && st.subject.asset.code === "DUSTC",
      ),
    ).toEqual([]);
    expect(plan.steps.map((st) => st.kind)).not.toContain("merge");
    // The pool's asset trustline is reported, not touched (CHANGE_TRUST_CANNOT_DELETE).
    expect(plan.unclosable.map((u) => u.code)).toEqual(["POOL_ASSET_TRUSTLINE"]);
  });

  it("names every pool whose shares are held, and not an empty share trustline the plan removes", () => {
    const s = copy(base);
    s.poolShares.push(
      {
        poolId: POOL_A,
        balance: "2.5000000",
        sponsor: null,
        assets: ["native", `DUSTC:${messy.issuer}`],
      },
      {
        poolId: POOL_B,
        balance: "0.0000001",
        sponsor: null,
        assets: ["native", `DUSTB:${messy.issuer}`],
      },
      {
        poolId: "ef".repeat(32),
        balance: "0.0000000",
        sponsor: null,
        assets: ["native", `DUSTA:${messy.issuer}`],
      },
    );
    const b = blocker({ blockers: mergeBlockers(s, null) }, "LIQUIDITY_POOL_SHARES");
    expect(b.remedy).toContain(
      `Withdraw from pool ${POOL_A} and from pool ${POOL_B} first (LiquidityPoolWithdraw); Dustin does not withdraw.`,
    );
    expect(b.remedy).not.toContain("ef".repeat(32));
    expect(b.reason).toContain("2 liquidity pools");
  });
});

describe("E3-S5 AC-2: raised thresholds (code THRESHOLD_UNMET)", () => {
  it("S-09: names the weight the merge needs and the master key's weight, and which threshold blocks which step", () => {
    const s = withSecondSigner(copy(base), { low: 0, medium: 0, high: 2 });
    const plan = planFromSnapshot(s, opts());
    expect(plan.status).toBe("blocked");
    expect(plan.blockers.map((b) => b.code)).toEqual(["THRESHOLD_UNMET"]);
    const { reason, remedy, permanent } = blocker(plan, "THRESHOLD_UNMET");
    expect(reason).toContain("The master key has weight 1");
    expect(reason).toContain("Blocked: the merge needs weight 2");
    // Which threshold each step needs (list of operations; operations and transactions).
    expect(reason).toContain("the merge (accountMerge) needs the high threshold");
    expect(reason).toContain(
      "changeTrust, manageData, payments and offers need the medium threshold",
    );
    expect(reason).toContain("bumpSequence needs the low threshold");
    expect(reason).toContain("every transaction needs the low threshold for its source account");
    expect(reason).toContain("low 0, medium 0, high 2");
    // The other signer that could add the missing weight.
    expect(reason).toContain(`${K2} (weight 1)`);
    expect(remedy).toMatch(/out of scope/);
    expect(remedy).toContain("--partial");
    expect(permanent).toBe(true);
  });

  it("S-09: keeps the cleanup (medium) in the plan and leaves the merge (high) out", () => {
    const s = withSecondSigner(copy(base), { low: 0, medium: 0, high: 2 });
    const plan = planFromSnapshot(s, opts());
    const kinds = plan.steps.map((st) => st.kind);
    expect(kinds).not.toContain("merge");
    expect(kinds).toContain("cancel_offer");
    expect(kinds).toContain("remove_data");
    expect(plan.steps.every((st) => st.threshold === "medium")).toBe(true);
  });

  it("names the medium threshold when it blocks the cleanup, so nothing can be signed", () => {
    const s = withSecondSigner(copy(base), { low: 0, medium: 2, high: 2 });
    const plan = planFromSnapshot(s, opts());
    expect(plan.steps).toEqual([]);
    const { reason, remedy } = blocker(plan, "THRESHOLD_UNMET");
    expect(reason).toContain("Blocked: the cleanup needs weight 2 and the merge needs weight 2");
    expect(reason).toContain("nothing can be signed");
    expect(remedy).not.toContain("--partial");
  });

  it("names the low threshold when the source account alone cannot sign any transaction", () => {
    const s = copy(base);
    s.thresholds = { low: 5, medium: 1, high: 1 };
    const plan = planFromSnapshot(s, opts());
    expect(plan.steps).toEqual([]);
    const { reason } = blocker(plan, "THRESHOLD_UNMET");
    expect(reason).toContain(
      "Blocked: every transaction needs weight 5 for its source account (low threshold)",
    );
    expect(reason).toContain("the cleanup needs weight 5 and the merge needs weight 5");
  });

  it("keeps naming the cleanup when only the medium threshold is out of reach", () => {
    // Weight 1 meets high 1 but not medium 2: no cleanup can be signed, so no merge either.
    const s = copy(base);
    s.thresholds = { low: 0, medium: 2, high: 1 };
    const { reason } = blocker(planFromSnapshot(s, opts()), "THRESHOLD_UNMET");
    expect(reason).toContain("Blocked: the cleanup needs weight 2");
    expect(reason).toContain("the merge cannot run without the cleanup");
  });

  it("explains a master key of weight 0 and names the signers that could sign", () => {
    const s = withSecondSigner(copy(base), { low: 1, medium: 1, high: 1 });
    s.masterWeight = 0;
    s.signers[0]!.weight = 0;
    const plan = planFromSnapshot(s, opts());
    expect(plan.blockers.map((b) => b.code)).toEqual(["MASTER_KEY_DISABLED"]);
    const { reason, remedy } = blocker(plan, "MASTER_KEY_DISABLED");
    expect(reason).toContain("weight 0");
    expect(reason).toContain(`${K2} (weight 1)`);
    expect(remedy).toMatch(/out of scope/);
    expect(plan.steps).toEqual([]);
  });
});

describe("E3-S5 AC-3: AUTH_IMMUTABLE (code AUTH_IMMUTABLE_SET)", () => {
  it("X-04: reports that the merge would fail with ACCOUNT_MERGE_IMMUTABLE_SET, first among the blockers", () => {
    const s = withSecondSigner(copy(base), { low: 0, medium: 0, high: 2 });
    s.flags.authImmutable = true;
    s.numSponsoring = 1;
    s.claimableBalancesSponsored = 0;
    const plan = planFromSnapshot(s, opts());
    expect(plan.blockers.map((b) => b.code)).toEqual([
      "AUTH_IMMUTABLE_SET",
      "THRESHOLD_UNMET",
      "IS_SPONSOR",
    ]);
    const b = blocker(plan, "AUTH_IMMUTABLE_SET");
    expect(b.reason).toContain("ACCOUNT_MERGE_IMMUTABLE_SET");
    expect(b.reason).toMatch(/can never be merged/);
    expect(b.permanent).toBe(true);
    expect(b.remedy).toMatch(/cannot be cleared/);
    expect(plan.steps.map((st) => st.kind)).not.toContain("merge");
  });
});

describe("E3-S5 AC-4: an account that sponsors reserves (IS_SPONSOR)", () => {
  it("X-02: the remedy says to revoke or transfer the sponsorships first", () => {
    const s = copy(base);
    s.numSponsoring = 2;
    s.claimableBalancesSponsored = 0;
    const b = blocker(planFromSnapshot(s, opts()), "IS_SPONSOR");
    expect(b.reason).toContain("sponsors 2 reserve(s)");
    expect(b.reason).toContain("ACCOUNT_MERGE_IS_SPONSOR");
    expect(b.remedy).toContain("Revoke or transfer your sponsorships first");
    expect(b.remedy).not.toMatch(/claimable/);
  });

  it("X-01: names the claimable balances the account created and how their sponsorship ends", () => {
    const s = copy(base);
    s.numSponsoring = 1;
    s.claimableBalancesSponsored = 1;
    const b = blocker(planFromSnapshot(s, opts()), "IS_SPONSOR");
    expect(b.reason).toContain("including 1 claimable balance(s) it created");
    expect(b.remedy).toContain("Revoke or transfer your sponsorships first");
    // A claimable balance's sponsorship can only be transferred (REVOKE_SPONSORSHIP_ONLY_TRANSFERABLE).
    expect(b.remedy).toContain("REVOKE_SPONSORSHIP_ONLY_TRANSFERABLE");
    expect(b.remedy).toContain("ClawbackClaimableBalance");
    expect(b.remedy).toMatch(/claimed by its claimant/);
  });
});

describe("every detection-only blocker", () => {
  it("has a reason and a remedy, and the plan never merges while one holds", () => {
    const s = withSecondSigner(copy(base), { low: 0, medium: 0, high: 2 });
    s.flags.authImmutable = true;
    s.numSponsoring = 1;
    s.claimableBalancesSponsored = 1;
    s.poolShares.push({
      poolId: POOL_A,
      balance: "1.0000000",
      sponsor: null,
      assets: ["native", `DUSTC:${messy.issuer}`],
    });
    const plan = planFromSnapshot(s, opts());
    expect(plan.blockers.map((b) => b.code)).toEqual([
      "AUTH_IMMUTABLE_SET",
      "THRESHOLD_UNMET",
      "LIQUIDITY_POOL_SHARES",
      "IS_SPONSOR",
    ]);
    for (const b of plan.blockers) {
      expect(b.reason.length).toBeGreaterThan(40);
      expect(b.remedy.length).toBeGreaterThan(20);
    }
    expect(plan.status).toBe("blocked");
    expect(plan.steps.map((st) => st.kind)).not.toContain("merge");
  });
});
