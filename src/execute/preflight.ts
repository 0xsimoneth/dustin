import { destinationBaseAccount } from "../inspect/address.js";
import type { HorizonAccount } from "../inspect/horizon-types.js";
import { sequenceGuard } from "../plan/guard.js";
import type { ClosePlan } from "../plan/model.js";
import type { LedgerReader } from "../reader/ledger-reader.js";

export interface PreflightResult {
  ok: boolean;
  detail: string;
  /** Set when the sequence guard blocks the merge: the first ledger it can land in. */
  unblocksAtLedger?: number;
}

/**
 * SEP-29: a data entry `config.memo_required` with the value "1" (base64 "MQ==") asks senders of
 * payments and merges for a memo; it does not apply to a muxed (M...) destination
 * (https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0029.md; the JS SDK's
 * `checkMemoRequired` skips M addresses the same way, `lib/esm/horizon/server.js`).
 */
function memoRequired(account: HorizonAccount): boolean {
  const value = account.data["config.memo_required"];
  return value !== undefined && Buffer.from(value, "base64").toString("utf8") === "1";
}

/**
 * Fresh facts before a merge that follows earlier transactions of the run (architecture rule R7):
 * the account exists and sponsors nothing, the destination's base account exists (a muxed
 * destination included, review finding R9), a G destination that turned memo-required gets a memo
 * (review finding R10; the raw POST bypasses the SDK's own SEP-29 check), and the sequence guard
 * holds. Leftover subentries are checked only when the merge runs alone (`mergeOnly`): when it
 * shares a transaction with removals, those run first and clear them, and anything else left makes
 * the whole transaction fail atomically with op_has_sub_entries.
 */
export async function mergePreflight(
  reader: LedgerReader,
  plan: ClosePlan,
  options: {
    mergeOnly: boolean;
    /** Reads the account; the executor waits out a Horizon behind its own transactions (E4). */
    readAccount?: () => Promise<HorizonAccount | null>;
  },
): Promise<PreflightResult> {
  const [account, destination, ledger] = await Promise.all([
    options.readAccount ? options.readAccount() : reader.account(plan.account),
    reader.account(destinationBaseAccount(plan.destination)),
    reader.latestLedger(),
  ]);
  if (!account) return { ok: false, detail: "the account no longer exists" };
  if (options.mergeOnly) {
    const left = leftovers(account);
    if (left.length > 0) return { ok: false, detail: `the account still holds ${left.join(", ")}` };
  }
  if (account.num_sponsoring > 0)
    return { ok: false, detail: `the account sponsors ${account.num_sponsoring} reserve(s)` };
  if (!destination) return { ok: false, detail: "the destination no longer exists" };
  const muxed = plan.destination !== destinationBaseAccount(plan.destination);
  if (!muxed && memoRequired(destination) && !plan.memo) {
    return {
      ok: false,
      detail:
        "the destination now requires a memo (SEP-29 config.memo_required) and the plan has none; plan again with --memo",
    };
  }
  const guard = sequenceGuard({
    sequence: account.sequence,
    observedLedger: ledger.sequence,
    mergeTxIndex: 0,
  });
  // Blind review BH11: any guard that is not ok blocks the merge, whether or not it names the
  // ledger that unblocks it.
  if (!guard.ok) {
    return guard.unblocksAtLedger === null
      ? { ok: false, detail: "the sequence guard blocks the merge" }
      : {
          ok: false,
          detail: `the sequence guard blocks the merge until ledger ${guard.unblocksAtLedger}`,
          unblocksAtLedger: guard.unblocksAtLedger,
        };
  }
  return {
    ok: true,
    detail: options.mergeOnly
      ? "no subentries left, nothing sponsored, destination exists, sequence guard ok"
      : "nothing sponsored, destination exists, sequence guard ok",
  };
}

/** Subentries still on the account, as a readable list; signers do not count. */
export function leftovers(account: HorizonAccount): string[] {
  const lines = account.balances.filter((b) => b.asset_type !== "native");
  const trustlines = lines.length;
  // A pool-share trustline counts as two subentries.
  const trustlineSubentries = lines.reduce(
    (n, b) => n + (b.asset_type === "liquidity_pool_shares" ? 2 : 1),
    0,
  );
  const data = Object.keys(account.data).length;
  const nonSignerSubentries =
    account.subentry_count - account.signers.filter((s) => s.key !== account.account_id).length;
  const offers = Math.max(0, nonSignerSubentries - trustlineSubentries - data);
  return [
    ...(trustlines ? [`${trustlines} trustline(s)`] : []),
    ...(offers ? [`${offers} offer(s)`] : []),
    ...(data ? [`${data} data entr${data === 1 ? "y" : "ies"}`] : []),
  ];
}
