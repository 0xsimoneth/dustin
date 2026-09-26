import { formatStroops, toStroops } from "../amounts.js";
import type { ExistingAccountSnapshot } from "../inspect/snapshot.js";
import { assetKey } from "../inspect/snapshot.js";
import type { CloseStep, RecoverySummary } from "./model.js";

/**
 * Where the XLM goes (architecture section 6.2). Reserves are not paid out: removing an entry
 * lowers the minimum balance, and the merge then moves the whole balance. A sponsored entry's
 * reserve was never the account's, so removing it credits nothing here and unlocks the reserve on
 * its sponsor (CAP-33; day-1 experiment 3).
 */
export function recoverySummary(s: ExistingAccountSnapshot, steps: CloseStep[]): RecoverySummary {
  const merges = steps.some((step) => step.kind === "merge");
  const proceeds = steps
    .filter((step) => step.disposal?.rung === "path_payment")
    .reduce((sum, step) => sum + toStroops(step.disposal?.quotedXlm ?? "0"), 0n);
  const native = toStroops(s.native.balance);
  const reserve = toStroops(s.reserve.baseReserve);

  const bySponsor = new Map<string, { units: bigint; entries: string[] }>();
  const add = (sponsor: string | null, units: bigint, entry: string) => {
    if (!sponsor) return;
    const current = bySponsor.get(sponsor) ?? { units: 0n, entries: [] };
    current.units += units;
    current.entries.push(entry);
    bySponsor.set(sponsor, current);
  };
  for (const step of steps) {
    if (step.kind === "remove_trustline" && step.subject.type === "trustline") {
      add(step.subject.sponsor, 1n, `trustline ${assetKey(step.subject.asset)}`);
    }
  }
  for (const offer of s.offers) add(offer.sponsor, 1n, `offer ${offer.id}`);
  if (merges) {
    // Signers and the account entry itself are removed by the merge.
    for (const signer of s.signers) add(signer.sponsor, 1n, `signer ${signer.key}`);
    add(s.sponsor, 2n, "account entry");
  }

  return {
    xlmToDestination: formatStroops(merges ? native + proceeds : 0n),
    nativeBalance: formatStroops(native),
    quotedProceedsXlm: formatStroops(proceeds),
    reservesReturnedToSponsors: [...bySponsor.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([sponsor, v]) => ({
        sponsor,
        xlm: formatStroops(v.units * reserve),
        entries: v.entries,
      })),
    feesPaidByAccount: "0",
  };
}
