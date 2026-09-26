import { describe, expect, it } from "vitest";
import { toStroops } from "../../../src/amounts.js";
import {
  assetKey,
  type AssetRef,
  type ExistingAccountSnapshot,
} from "../../../src/inspect/snapshot.js";
import type {
  BlockerCode,
  ClosePlan,
  CloseStep,
  OperationDescriptor,
  PlanOptions,
} from "../../../src/plan/model.js";
import { planFromSnapshot } from "../../../src/plan/plan.js";
import { randomSnapshot } from "../../helpers/generate.js";

const SEEDS = 600;

type PathPayment = Extract<OperationDescriptor, { type: "pathPaymentStrictSend" }>;
const subjectKey = (st: CloseStep) =>
  st.subject.type === "trustline" ? assetKey(st.subject.asset) : null;

function optionsFor(seed: number, s: ExistingAccountSnapshot): PlanOptions {
  return {
    destination: s.destination!.account,
    ...(seed % 3 === 0 ? { memo: "m" } : {}),
    ...(seed % 2 === 0 ? { preferDestination: true } : {}),
  };
}

/**
 * The merge blockers that follow from the snapshot alone, restated from the protocol rules
 * (AccountMerge result codes, SEP-29); the sequence guard depends on grouping and is checked apart.
 */
function expectedBlockers(s: ExistingAccountSnapshot, memo: string | undefined): BlockerCode[] {
  const codes: BlockerCode[] = [];
  const { low, medium, high } = s.thresholds;
  if (s.masterWeight === 0) codes.push("MASTER_KEY_DISABLED");
  else if (s.masterWeight < Math.max(low, medium, high)) codes.push("THRESHOLD_UNMET");
  if (s.flags.authImmutable) codes.push("AUTH_IMMUTABLE_SET");
  if (s.poolShares.length > 0) codes.push("LIQUIDITY_POOL_SHARES");
  if (s.numSponsoring > 0) codes.push("IS_SPONSOR");
  const d = s.destination!;
  if (!d.exists) codes.push("DESTINATION_MISSING");
  else {
    if (d.baseAccount === s.account) codes.push("DESTINATION_IS_SELF");
    if (d.memoRequired && !memo) codes.push("DESTINATION_REQUIRES_MEMO");
  }
  return codes.sort();
}

function checkPlan(s: ExistingAccountSnapshot, plan: ClosePlan, options: PlanOptions): void {
  const steps = plan.steps;
  const merge = steps.find((st) => st.kind === "merge");
  const cleanupSignable =
    s.masterWeight > 0 && s.masterWeight >= Math.max(s.thresholds.low, s.thresholds.medium);

  // Status: blockers, then unclosable items; only a closable plan merges.
  expect(plan.status).toBe(
    plan.blockers.length > 0 ? "blocked" : plan.unclosable.length > 0 ? "partial" : "closable",
  );
  expect(merge !== undefined).toBe(plan.status === "closable");
  expect(
    plan.blockers
      .map((b) => b.code)
      .filter((c) => c !== "SEQNUM_TOO_FAR")
      .sort(),
  ).toEqual(expectedBlockers(s, options.memo));
  if (!cleanupSignable) expect(steps).toEqual([]);

  // Every step, transaction, blocker and unclosable item explains itself (1-5 AC5).
  for (const x of [...steps, ...plan.transactions, ...plan.blockers, ...plan.unclosable]) {
    expect(x.reason.trim()).not.toBe("");
  }
  for (const x of [...plan.blockers, ...plan.unclosable]) expect(x.remedy.trim()).not.toBe("");

  // Transactions hold their steps in plan order, within the limit, with the fee arithmetic.
  steps.forEach((st, i) => {
    if (i > 0) expect(st.txIndex).toBeGreaterThanOrEqual(steps[i - 1]!.txIndex);
  });
  plan.transactions.forEach((t, i) => {
    expect(t.index).toBe(i);
    expect(t.stepIds).toEqual(steps.filter((st) => st.txIndex === i).map((st) => st.id));
    expect(t.opCount).toBe(t.stepIds.length);
    expect(t.opCount).toBeGreaterThan(0);
    expect(t.opCount).toBeLessThanOrEqual(100);
    expect(t.innerFeeStroops).toBe(0);
    expect(t.feeBumpFeeStroops).toBe(plan.fees.baseFeeStroops * (t.opCount + 1));
  });
  expect(plan.fees.totalStroops).toBe(plan.fees.perTransactionStroops.reduce((a, b) => a + b, 0));
  const position = new Map(steps.map((st, i) => [st.id, i]));
  for (const st of steps) {
    for (const d of st.dependsOn) expect(position.get(d)!).toBeLessThan(position.get(st.id)!);
  }

  // A disposal and its trustline removal are never split (1-5 AC2); a path payment is isolated.
  for (const d of steps.filter((st) => st.kind === "dispose_balance")) {
    const removal = steps.find(
      (st) => st.kind === "remove_trustline" && subjectKey(st) === subjectKey(d),
    );
    expect(removal).toBeDefined();
    expect(removal!.txIndex).toBe(d.txIndex);
    expect(removal!.dependsOn).toContain(d.id);
    const rung = d.disposal!.rung;
    const line = s.trustlines.find((t) => assetKey(t.asset) === subjectKey(d))!;
    if (rung === "path_payment") {
      expect(plan.transactions[d.txIndex]).toMatchObject({
        phase: "convert",
        stepIds: [d.id, removal!.id],
      });
      // B-24: no hop may be served by one of the account's own offers, which the plan cancels.
      const op = d.operation as PathPayment;
      const hops: AssetRef[] = [op.sendAsset, ...op.path, { type: "native" }];
      for (let i = 0; i + 1 < hops.length; i++) {
        const from = assetKey(hops[i]!);
        const to = assetKey(hops[i + 1]!);
        expect(
          s.offers.some((o) => assetKey(o.selling) === to && assetKey(o.buying) === from),
        ).toBe(false);
      }
      expect(toStroops(op.destMin)).toBeGreaterThanOrEqual(1n);
      expect(toStroops(op.destMin)).toBeLessThanOrEqual(toStroops(d.disposal!.quotedXlm!));
    } else {
      expect(plan.transactions[d.txIndex]!.phase).not.toBe("convert");
    }
    if (rung === "send_to_destination") {
      // Rung 3 only into an authorized destination trustline with room for the whole balance.
      const dest = s.destination!;
      expect(dest.exists && dest.baseAccount !== s.account).toBe(true);
      const target = dest.trustlines.find((t) => assetKey(t.asset) === subjectKey(d));
      expect(target?.authorized).toBe(true);
      const room =
        toStroops(target!.limit) -
        toStroops(target!.balance) -
        toStroops(target!.buyingLiabilities);
      expect(room).toBeGreaterThanOrEqual(toStroops(line.balance));
    }
    if (rung === "return_to_issuer") {
      const issuer = s.issuers.find((i) => i.account === line.asset.issuer);
      if (issuer?.memoRequired) expect(options.memo).toBeDefined();
    }
  }

  if (cleanupSignable) {
    // Every trustline is removed or reported, never both and never silently dropped; a balance is
    // disposed of before its trustline goes.
    for (const t of s.trustlines) {
      const k = assetKey(t.asset);
      const removed = steps.some((st) => st.kind === "remove_trustline" && subjectKey(st) === k);
      const disposed = steps.some((st) => st.kind === "dispose_balance" && subjectKey(st) === k);
      const reported = plan.unclosable.some(
        (u) => u.subject.type === "trustline" && assetKey(u.subject.asset) === k,
      );
      expect(removed !== reported, k).toBe(true);
      expect(disposed).toBe(removed && toStroops(t.balance) > 0n);
    }
    // Every offer is cancelled and every data entry removed.
    expect(steps.filter((st) => st.kind === "cancel_offer").map((st) => st.operation)).toHaveLength(
      s.offers.length,
    );
    expect(steps.filter((st) => st.kind === "remove_data")).toHaveLength(s.data.length);
  }

  if (merge) {
    // The merge is the last operation of the last transaction and depends on everything.
    expect(steps.at(-1)).toBe(merge);
    expect(plan.transactions.at(-1)!.stepIds.at(-1)).toBe(merge.id);
    expect(merge.dependsOn).toHaveLength(steps.length - 1);
    // It joins the cleanup only when no conversion precedes it.
    if (plan.transactions.some((t) => t.phase === "convert")) {
      expect(plan.transactions[merge.txIndex]!.stepIds).toEqual([merge.id]);
    }
    const g = plan.sequenceGuard!;
    expect(BigInt(g.sequenceAtMerge)).toBe(BigInt(s.sequence) + BigInt(merge.txIndex) + 1n);
    expect(g.ok).toBe(BigInt(g.sequenceAtMerge) < BigInt(s.observed.ledger + 1) << 32n);
    if (!g.ok) {
      // A short wait: the cleanup runs first and the merge waits alone.
      expect(plan.transactions[merge.txIndex]).toMatchObject({ phase: "merge", opCount: 1 });
      expect(plan.warnings.join(" ")).toMatch(/merge must wait until ledger/);
    }
  } else {
    expect(plan.sequenceGuard).toBeNull();
  }
  if (plan.blockers.some((b) => b.code === "SEQNUM_TOO_FAR")) {
    expect(Number(BigInt(s.sequence) >> 32n)).toBeGreaterThan(s.observed.ledger + 100);
  }
}

describe("planner invariants over generated snapshots", () => {
  it(`hold for ${SEEDS} seeded accounts, including partial and blocked ones`, () => {
    const seen = new Set<string>();
    for (let seed = 1; seed <= SEEDS; seed++) {
      const s = randomSnapshot(seed, { variety: true });
      const options = optionsFor(seed, s);
      const plan = planFromSnapshot(s, options);
      try {
        checkPlan(s, plan, options);
        // The hash is deterministic and ignores the fee bid.
        expect(planFromSnapshot(s, options).planHash).toBe(plan.planHash);
        expect(planFromSnapshot(s, { ...options, baseFeeStroops: 12_345 }).planHash).toBe(
          plan.planHash,
        );
      } catch (error) {
        throw new Error(`seed ${seed}: ${(error as Error).message}`, { cause: error });
      }

      seen.add(`status:${plan.status}`);
      for (const b of plan.blockers) seen.add(`blocker:${b.code}`);
      for (const u of plan.unclosable) seen.add(`unclosable:${u.code}`);
      for (const st of plan.steps) if (st.disposal) seen.add(`rung:${st.disposal.rung}`);
      const ruledOut = [
        ...plan.steps.flatMap((st) => st.disposal?.ruledOut ?? []),
        ...plan.unclosable.flatMap((u) => u.rungsRuledOut ?? []),
      ].map((r) => r.reason);
      if (ruledOut.some((r) => r.includes("own offer"))) seen.add("B-24");
      if (ruledOut.some((r) => r.includes("has no room"))) seen.add("rung 3 without room");
      if (plan.sequenceGuard && !plan.sequenceGuard.ok) seen.add("guard wait");
      if (plan.transactions.filter((t) => t.phase === "cleanup").length > 1) {
        seen.add("split cleanup");
      }
    }
    // The generator must reach every branch it is meant to exercise.
    expect([...seen].sort()).toEqual(
      [
        "B-24",
        "blocker:AUTH_IMMUTABLE_SET",
        "blocker:DESTINATION_IS_SELF",
        "blocker:DESTINATION_MISSING",
        "blocker:DESTINATION_REQUIRES_MEMO",
        "blocker:IS_SPONSOR",
        "blocker:LIQUIDITY_POOL_SHARES",
        "blocker:MASTER_KEY_DISABLED",
        "blocker:SEQNUM_TOO_FAR",
        "blocker:THRESHOLD_UNMET",
        "guard wait",
        "rung 3 without room",
        "rung:path_payment",
        "rung:return_to_issuer",
        "rung:send_to_destination",
        "split cleanup",
        "status:blocked",
        "status:closable",
        "status:partial",
        "unclosable:MAINTAIN_LIABILITIES_ONLY",
        "unclosable:NO_DISPOSAL_ROUTE",
        "unclosable:POOL_ASSET_TRUSTLINE",
        "unclosable:TRUSTLINE_NOT_AUTHORIZED",
      ].sort(),
    );
  });
});
