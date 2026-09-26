import { toStroops } from "../amounts.js";
import { assetKey } from "../inspect/snapshot.js";
import { LADDER_ORDERS } from "../plan/ladder.js";
import type { ClosePlan, CloseStep, StepSubject } from "../plan/model.js";
import type { LedgerReader } from "../reader/ledger-reader.js";

/**
 * What a step acts on, the same in every plan of a run: step ids are renumbered by each re-plan and
 * a balance can change, but the offer id, the asset, the data entry name and the pool stay.
 */
export function subjectIdentity(subject: StepSubject): string {
  switch (subject.type) {
    case "offer":
      return `offer:${subject.offerId}`;
    case "trustline":
      return `trustline:${assetKey(subject.asset)}`;
    case "data":
      return `data:${subject.name}`;
    case "pool_share":
      return `pool:${subject.poolId}`;
    case "account":
      return "account";
  }
}

/** A step's kind and subject: how the same step is recognised across re-plans. */
export function stepIdentity(step: CloseStep): string {
  return `${step.kind}|${subjectIdentity(step.subject)}`;
}

function describe(subject: StepSubject): string {
  switch (subject.type) {
    case "offer":
      return `offer ${subject.offerId}`;
    case "trustline":
      return `${subject.asset.code} trustline`;
    case "data":
      return `data entry ${subject.name}`;
    case "pool_share":
      return `pool share ${subject.poolId}`;
    case "account":
      return "account";
  }
}

/** The assets a plan sells with a strict-send path payment (ladder rung 1), as "CODE:ISSUER". */
export function rungOneAssets(plan: ClosePlan): Set<string> {
  const assets = new Set<string>();
  for (const step of plan.steps) {
    if (
      step.kind === "dispose_balance" &&
      step.disposal?.rung === "path_payment" &&
      step.subject.type === "trustline"
    ) {
      assets.add(assetKey(step.subject.asset));
    }
  }
  return assets;
}

/**
 * The reader a mid-run re-plan uses: it offers strict-send paths only to `allowed` assets, so the
 * ladder resolver (read-only for the executor) sees no rung 1 for the others. The executor allows
 * the assets the approved plan sold on rung 1 minus those whose sale failed on the market
 * (op_too_few_offers, op_under_dest_min, op_cross_self): a failed sale falls down the ladder
 * (docs/README.md canonical decision 8, architecture section 7.2) and no asset moves up to rung 1
 * because a market appeared mid-run.
 */
export function withPathsOnlyFor(reader: LedgerReader, allowed: ReadonlySet<string>): LedgerReader {
  return {
    source: reader.source,
    networkPassphrase: () => reader.networkPassphrase(),
    latestLedger: () => reader.latestLedger(),
    feeStats: () => reader.feeStats(),
    account: (id) => reader.account(id),
    offers: (id) => reader.offers(id),
    strictSendPathsToNative: (asset, amount) =>
      allowed.has(assetKey(asset))
        ? reader.strictSendPathsToNative(asset, amount)
        : Promise.resolve([]),
    claimableBalancesSponsoredBy: (id) => reader.claimableBalancesSponsoredBy(id),
    liquidityPoolAssets: (id) => reader.liquidityPoolAssets(id),
  };
}

/**
 * What a mid-run re-plan changed beyond what E2-S3 allows: it may drop the steps that already
 * applied and move an asset down the ladder (to a later rung, or off it into `unclosable`).
 * Anything else is drift and follows `onDrift`: a step the approved plan did not have (a new
 * offer, trustline, data entry or pool share, or a merge it did not include), a balance larger than
 * approved, or an asset moving up the ladder. Returns one sentence per finding; empty means safe.
 */
export function replanDrift(approved: ClosePlan, next: ClosePlan): string[] {
  const approvedSteps = new Map(approved.steps.map((step) => [stepIdentity(step), step]));
  const known = new Set([
    ...approved.steps.map((step) => subjectIdentity(step.subject)),
    ...approved.unclosable.map((item) => subjectIdentity(item.subject)),
  ]);
  const order = LADDER_ORDERS[approved.ladderOrder];
  const drift = new Set<string>();
  for (const step of next.steps) {
    const before = approvedSteps.get(stepIdentity(step));
    if (!before) {
      if (step.kind === "merge") drift.add("a merge that the approved plan did not include");
      else if (known.has(subjectIdentity(step.subject)))
        drift.add(
          `a ${step.kind.replaceAll("_", " ")} step for the ${describe(step.subject)}, which the approved plan left in place`,
        );
      else drift.add(`a new ${describe(step.subject)}`);
      continue;
    }
    if (
      step.subject.type === "trustline" &&
      before.subject.type === "trustline" &&
      toStroops(step.subject.balance) > toStroops(before.subject.balance)
    ) {
      drift.add(
        `the ${step.subject.asset.code} balance grew from ${before.subject.balance} to ${step.subject.balance}`,
      );
    }
    if (
      step.disposal &&
      before.disposal &&
      order.indexOf(step.disposal.rung) < order.indexOf(before.disposal.rung)
    ) {
      const code = step.subject.type === "trustline" ? step.subject.asset.code : "the asset";
      drift.add(
        `${code} moved up the ladder from ${before.disposal.rung} to ${step.disposal.rung}`,
      );
    }
  }
  for (const item of next.unclosable) {
    if (!known.has(subjectIdentity(item.subject))) drift.add(`a new ${describe(item.subject)}`);
  }
  return [...drift];
}
