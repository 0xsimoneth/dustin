import { assetKey } from "../inspect/snapshot.js";
import { destinationBaseAccount } from "../inspect/address.js";
import type { CloseStep } from "../plan/model.js";
import { stepAction } from "../render/plan-text.js";
import type { AccountLinks, CloseReport, OperationSummary } from "./report.js";

/**
 * What one operation of an envelope does, for the persisted report (review finding AA-9, story
 * E4-S1): the step, the Stellar operation, its subject and, for a disposal, the rung, the amount and
 * the recipient. `summary` is the receipt's own wording (`stepAction`), so the JSON and the printed
 * receipt say the same thing (docs/ux-design.md principle P5, "one truth, three shapes").
 */
export function operationSummary(step: CloseStep): OperationSummary {
  const s = step.subject;
  const base = { stepId: step.id, kind: step.kind, type: step.operation.type };
  const summary = stepAction(step);
  switch (s.type) {
    case "offer":
      return { ...base, subject: `offer ${s.offerId}`, offerId: s.offerId, summary };
    case "data":
      return { ...base, subject: `data entry ${s.name}`, dataName: s.name, summary };
    case "pool_share":
      return { ...base, subject: `pool share ${s.poolId}`, poolId: s.poolId, summary };
    case "account":
      return { ...base, subject: "account", to: s.destination, summary };
    case "trustline": {
      const asset = assetKey(s.asset);
      const d = step.disposal;
      return {
        ...base,
        subject: `trustline ${asset}`,
        asset,
        ...(d ? { amount: d.amount, rung: d.rung, to: d.to } : {}),
        summary,
      };
    }
  }
}

/** The explorer page and the Horizon resource of an account; a muxed address by its G account. */
export function accountLinks(
  explorerBaseUrl: string,
  horizonUrl: string,
  address: string,
): AccountLinks {
  let account = address;
  try {
    account = destinationBaseAccount(address);
  } catch {
    // Not a G or M address: link it as it is; the planner refused such a destination anyway.
  }
  return {
    explorer: `${explorerBaseUrl}/account/${account}`,
    horizon: `${horizonUrl}/accounts/${account}`,
  };
}

/** The report's `links`: the closing account and the destination (review finding AA-9). */
export function reportLinks(
  explorerBaseUrl: string,
  horizonUrl: string,
  report: Pick<CloseReport, "account" | "destination">,
): NonNullable<CloseReport["links"]> {
  return {
    account: accountLinks(explorerBaseUrl, horizonUrl, report.account),
    destination: accountLinks(explorerBaseUrl, horizonUrl, report.destination),
  };
}
