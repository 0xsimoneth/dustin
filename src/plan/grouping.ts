import type { CloseStep, TransactionPhase } from "./model.js";
import type { PlanUnit } from "./order.js";

export interface GroupedTransaction {
  phase: TransactionPhase;
  steps: CloseStep[];
}

/** Protocol maximum operations per transaction (https://developers.stellar.org/docs/learn/fundamentals/transactions/operations-and-transactions). */
export const MAX_OPERATIONS = 100;

/**
 * Packs units into transactions (docs/README.md canonical decision 6): cleanup units fill
 * transactions up to the operation limit without splitting a unit; each conversion unit gets its
 * own transaction; the merge joins the last cleanup transaction when nothing market-dependent
 * precedes it and there is room, otherwise it runs alone last.
 */
export function groupUnits(
  units: PlanUnit[],
  options: { maxOps: number; separateMerge: boolean },
): GroupedTransaction[] {
  const cleanup: GroupedTransaction[] = [];
  for (const unit of units.filter((u) => u.phase === "cleanup")) {
    const last = cleanup.at(-1);
    if (last && last.steps.length + unit.steps.length <= options.maxOps)
      last.steps.push(...unit.steps);
    else cleanup.push({ phase: "cleanup", steps: [...unit.steps] });
  }
  const convert = units
    .filter((u) => u.phase === "convert")
    .map((u) => ({ phase: "convert" as const, steps: [...u.steps] }));
  const transactions = [...cleanup, ...convert];
  const merge = units.find((u) => u.phase === "merge");
  if (merge) {
    const last = cleanup.at(-1);
    if (
      !options.separateMerge &&
      convert.length === 0 &&
      last &&
      last.steps.length < options.maxOps
    ) {
      last.steps.push(...merge.steps);
    } else {
      transactions.push({ phase: "merge", steps: [...merge.steps] });
    }
  }
  return transactions;
}
