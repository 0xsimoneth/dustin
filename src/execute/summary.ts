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
  // Epic 4 review BH-15: the summary is a report-only field, so it never aborts an attempt: a step
  // it cannot describe (a subject or kind this version does not know, a field that cannot be read)
  // gets the fallback instead.
  try {
    return summaryOf(step);
  } catch {
    return fallbackSummary(step);
  }
}

/** What is safe to say of any step: its id, kind and operation type, as far as they can be read. */
function fallbackSummary(step: CloseStep): OperationSummary {
  const read = <T>(get: () => T, otherwise: T): T => {
    try {
      return get() ?? otherwise;
    } catch {
      return otherwise;
    }
  };
  // Never a guess such as "merge" for a kind that cannot be read: the CLI looks for the merge here.
  const kind = read<string>(() => step.kind, "unknown");
  const subject = read(() => String((step.subject as { type?: unknown }).type), "unknown");
  return {
    stepId: read(() => String(step.id), "?"),
    kind: kind as CloseStep["kind"],
    type: read(() => step.operation.type, "accountMerge"),
    subject,
    summary: `${String(kind).replaceAll("_", " ")} (${subject})`,
  };
}

function summaryOf(step: CloseStep): OperationSummary {
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
    default: {
      // Exhaustive (BH-15): a subject added to StepSubject without a case fails to compile here.
      const unknown: never = s;
      void unknown;
      return fallbackSummary(step);
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
