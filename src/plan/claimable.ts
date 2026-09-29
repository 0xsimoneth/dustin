import { StrKey } from "@stellar/stellar-sdk";
import { formatStroops, toStroops } from "../amounts.js";
import type { ExistingAccountSnapshot } from "../inspect/snapshot.js";
import { CLAIMANT_READ_LIMIT } from "../reader/ledger-reader.js";

/** How many ids the warning names before it counts the rest. */
const IDS_NAMED = 5;

/**
 * "XLM" for "native", "CODE issued by G..." for a strict "CODE:ISSUER" (a code of 1 to 12
 * letters and digits, a valid G... issuer), and anything else as Horizon gave it, quoted, with no
 * unit (Epic 4 review EP-18).
 */
function assetLabel(asset: string): { name: string; unit: string | null } {
  if (asset === "native") return { name: "XLM", unit: "XLM" };
  const credit = /^([A-Za-z0-9]{1,12}):(G[A-Z2-7]{55})$/.exec(asset);
  if (credit && StrKey.isValidEd25519PublicKey(credit[2]!)) {
    return { name: `${credit[1]} issued by ${credit[2]}`, unit: credit[1]! };
  }
  return { name: `"${asset}"`, unit: null };
}

/**
 * The plan's warning about claimable balances that name the account as a claimant (matrix row
 * X-03), or null when there are none or nothing was read. Such a balance is not a subentry of the
 * account and blocks nothing; claimable balance cleanup is out of scope (SUCCESSFUL_SOW.md
 * section 4, "Out of Scope"), so the plan warns and stays as it is. After the merge the balance
 * stays on the ledger: a claim needs the claimant as the operation's source account (and a
 * trustline for an asset other than XLM) and a predicate that allows it ("There is no claimant
 * that matches the source account, or the claimants predicate is not satisfied",
 * https://developers.stellar.org/docs/learn/fundamentals/transactions/list-of-operations#claim-claimable-balance),
 * which a merged account cannot meet until it is created again, while any other claimant its
 * predicate allows can still claim it; nothing else recovers it ("there is no recovery mechanism
 * for a claimable balance in general",
 * https://developers.stellar.org/docs/build/guides/transactions/claimable-balances#claim-claimable-balance
 * and #example). The snapshot carries no predicate, so the advice holds whatever they say: the
 * account may claim before the close those its predicates still allow (EP-18). A read that failed
 * is said as such, and a list as long as the read's bound counts as "at least" (EP-4).
 */
export function claimableBalanceWarning(s: ExistingAccountSnapshot): string | null {
  if (s.claimableBalancesClaimable === null) {
    return (
      "Dustin could not read the claimable balances that name this account as a claimant (GET /claimable_balances?claimant=), so this plan cannot say whether there are any. " +
      "A merge does not touch such balances: they stay on the ledger, and after the merge this account can no longer claim them unless it is created again. Check them on Horizon before the close; claimable balance cleanup is out of scope."
    );
  }
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
    const value = unit ? `${formatStroops(total)} ${unit}` : formatStroops(total);
    return `${count} of ${name} (${value}${count > 1 ? " in total" : ""})`;
  });
  const listed =
    groups.length > 1 ? `${groups.slice(0, -1).join(", ")} and ${groups.at(-1)}` : groups[0];
  const ids = balances.slice(0, IDS_NAMED).map((b) => b.id);
  const more = balances.length - ids.length;
  const n = balances.length;
  const atLeast = n >= CLAIMANT_READ_LIMIT;
  const count = atLeast
    ? `at least ${n} claimable balances (Dustin reads the first ${CLAIMANT_READ_LIMIT} only)`
    : `${n} claimable balance${n === 1 ? "" : "s"}`;
  return (
    `This account is a claimant of ${count}: ${listed}; ` +
    `id${n === 1 ? "" : "s"} ${ids.join(", ")}${more > 0 ? ` and ${more} more` : ""}. ` +
    "The merge does not touch them: they stay on the ledger, and after the merge this account can no longer claim them unless it is created again; any other claimant their predicates allow can still claim them. " +
    "Before the close, this account can claim those whose predicates still allow it (ClaimClaimableBalance, sourced by this account, with a trustline for an asset other than XLM); claimable balance cleanup is out of scope."
  );
}
