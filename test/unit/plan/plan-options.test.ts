import { beforeAll, describe, expect, it } from "vitest";
import type { ExistingAccountSnapshot } from "../../../src/inspect/snapshot.js";
import { planFromSnapshot } from "../../../src/plan/plan.js";
import { messy, messySnapshot } from "../../helpers/snapshots.js";

let base: ExistingAccountSnapshot;
beforeAll(async () => {
  base = await messySnapshot();
});
const opts = () => ({ destination: messy.destination, feeSponsor: messy.sponsor });
const dustaDestMin = (plan: ReturnType<typeof planFromSnapshot>) => {
  const op = plan.steps.find((s) => s.operation.type === "pathPaymentStrictSend")!.operation;
  return op.type === "pathPaymentStrictSend" ? op.destMin : null;
};

// Review finding R12: the executor's re-plan must reproduce the user's plan, so the plan records
// the options that shape it without showing in its steps.
describe("plan options", () => {
  it("records the effective options, defaults included", () => {
    expect(planFromSnapshot(base, opts()).options).toEqual({
      slippageBps: 100,
      maxOpsPerTransaction: 100,
      maxWaitLedgers: 120,
    });
    expect(
      planFromSnapshot(base, {
        ...opts(),
        slippageBps: 250,
        maxOpsPerTransaction: 150,
        maxWaitLedgers: 7,
      }).options,
    ).toEqual({ slippageBps: 250, maxOpsPerTransaction: 100, maxWaitLedgers: 7 });
  });

  it("records the options on a plan for a missing account too", () => {
    const plan = planFromSnapshot(
      {
        schemaVersion: 1,
        account: base.account,
        exists: false,
        destination: base.destination,
        observed: base.observed,
        feeStats: base.feeStats,
        snapshotHash: "0".repeat(64),
      },
      { ...opts(), slippageBps: 30 },
    );
    expect(plan.options).toEqual({
      slippageBps: 30,
      maxOpsPerTransaction: 100,
      maxWaitLedgers: 120,
    });
  });

  it("hashes a slippage other than the default, so a changed bound can never pass silently", () => {
    const standard = planFromSnapshot(base, opts());
    const explicit = planFromSnapshot(base, { ...opts(), slippageBps: 100 });
    const wide = planFromSnapshot(base, { ...opts(), slippageBps: 5000 });
    // Defaults are left out of the hash, so plans made before the options were recorded keep theirs.
    expect(explicit.planHash).toBe(standard.planHash);
    expect(wide.planHash).not.toBe(standard.planHash);
    expect(dustaDestMin(wide)).not.toBe(dustaDestMin(standard));
  });

  it("keeps fees out of the hash and reflects the grouping options in the structure", () => {
    const standard = planFromSnapshot(base, opts());
    expect(
      planFromSnapshot(base, { ...opts(), baseFeeStroops: 300, budgetStroops: 1_000_000 }).planHash,
    ).toBe(standard.planHash);
    const small = planFromSnapshot(base, { ...opts(), maxOpsPerTransaction: 4 });
    expect(small.transactions.map((t) => t.opCount)).toEqual([4, 4, 1, 2, 1]);
    expect(small.planHash).not.toBe(standard.planHash);
  });
});
