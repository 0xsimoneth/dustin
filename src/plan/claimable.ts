import { formatStroops, toStroops } from "../amounts.js";
import type { ExistingAccountSnapshot } from "../inspect/snapshot.js";

/** How many ids the warning names before it counts the rest. */
const IDS_NAMED = 5;

/** "XLM", or "CODE issued by G..." for an asset Horizon lists as "CODE:ISSUER". */
function assetLabel(asset: string): { name: string; unit: string } {
  if (asset === "native") return { name: "XLM", unit: "XLM" };
  const [code = asset, issuer = ""] = asset.split(":");
  return { name: `${code} issued by ${issuer}`, unit: code };
}

/**
 * The plan's warning about claimable balances that name the account as a claimant (matrix row
 * X-03), or null when there are none or the reader could not ask. Such a balance is not a subentry
 * of the account and blocks nothing; claimable balance cleanup is out of scope (SUCCESSFUL_SOW.md
 * section 4, "Out of Scope"), so the plan warns and stays as it is. After the merge the balance stays on the ledger: a claim
 * needs the claimant as the operation's source account (and a trustline for an asset other than
 * XLM), which a merged account cannot be until it is created again, while any other claimant its
 * predicate allows can still claim it; nothing else recovers it ("there is no recovery mechanism
 * for a claimable balance in general",
 * https://developers.stellar.org/docs/build/guides/transactions/claimable-balances#claim-claimable-balance
 * and #example).
 */
export function claimableBalanceWarning(s: ExistingAccountSnapshot): string | null {
  const balances = s.claimableBalancesClaimable ?? [];
  if (balances.length === 0) return null;
  // Grouped by asset in the order the snapshot lists them (sorted by id).
  const byAsset = new Map<string, { count: number; total: bigint }>();
  for (const b of balances) {
    const group = byAsset.get(b.asset) ?? { count: 0, total: 0n };
    group.count += 1;
    group.total += toStroops(b.amount);
    byAsset.set(b.asset, group);
  }
  const groups = [...byAsset].map(([asset, { count, total }]) => {
    const { name, unit } = assetLabel(asset);
    return `${count} of ${name} (${formatStroops(total)} ${unit}${count > 1 ? " in total" : ""})`;
  });
  const listed =
    groups.length > 1 ? `${groups.slice(0, -1).join(", ")} and ${groups.at(-1)}` : groups[0];
  const ids = balances.slice(0, IDS_NAMED).map((b) => b.id);
  const more = balances.length - ids.length;
  const n = balances.length;
  return (
    `This account is a claimant of ${n} claimable balance${n === 1 ? "" : "s"}: ${listed}; ` +
    `id${n === 1 ? "" : "s"} ${ids.join(", ")}${more > 0 ? ` and ${more} more` : ""}. ` +
    "The merge does not touch them: they stay on the ledger, and after the merge this account can no longer claim them unless it is created again; any other claimant their predicates allow can still claim them. " +
    "To keep them, claim them before the close (ClaimClaimableBalance, sourced by this account, with a trustline for an asset other than XLM); claimable balance cleanup is out of scope."
  );
}
