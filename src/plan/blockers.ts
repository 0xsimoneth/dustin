import { toStroops } from "../amounts.js";
import type { ExistingAccountSnapshot } from "../inspect/snapshot.js";
import type { Blocker } from "./model.js";

export interface SigningCapability {
  /** The master key alone can sign medium-threshold cleanup operations. */
  cleanup: boolean;
  /** The master key alone can sign the high-threshold merge. */
  merge: boolean;
}

/**
 * Only the master key is assumed; raised thresholds are detected, never solved (SOW). Besides each
 * operation's threshold, the transaction source must meet the low threshold
 * (https://developers.stellar.org/docs/learn/fundamentals/transactions/signatures-multisig).
 */
export function signingCapability(s: ExistingAccountSnapshot): SigningCapability {
  const w = s.masterWeight;
  const { low, medium, high } = s.thresholds;
  return { cleanup: w > 0 && w >= Math.max(low, medium), merge: w > 0 && w >= Math.max(low, high) };
}

/**
 * Conditions that make the merge impossible today (docs/README.md canonical decision 11;
 * AccountMerge result codes: https://developers.stellar.org/docs/data/apis/horizon/api-reference/errors/result-codes/operation-specific/account-merge).
 * The sequence guard is added by the planner once the merge's transaction index is known.
 */
export function mergeBlockers(s: ExistingAccountSnapshot, memo: string | null): Blocker[] {
  const blockers: Blocker[] = [];
  const signing = signingCapability(s);
  if (s.masterWeight === 0) {
    blockers.push({
      code: "MASTER_KEY_DISABLED",
      reason: "The master key has weight 0, so it cannot sign anything for this account.",
      remedy:
        "Collect signatures from the account's other signers outside Dustin; multisig closing is out of scope.",
      permanent: true,
    });
  } else if (!signing.merge || !signing.cleanup) {
    // A raised medium threshold alone still stops everything: no cleanup, so no merge either.
    blockers.push({
      code: "THRESHOLD_UNMET",
      reason: signing.cleanup
        ? `The merge needs signature weight ${Math.max(s.thresholds.low, s.thresholds.high)} (high threshold, and low for the transaction); the master key has weight ${s.masterWeight}.`
        : `The cleanup needs weight ${Math.max(s.thresholds.low, s.thresholds.medium)} and the merge ${Math.max(s.thresholds.low, s.thresholds.high)} (thresholds low ${s.thresholds.low}, medium ${s.thresholds.medium}, high ${s.thresholds.high}); the master key has weight ${s.masterWeight}.`,
      remedy: "Collect the extra signatures outside Dustin; multisig closing is out of scope.",
      permanent: true,
    });
  }
  if (s.flags.authImmutable) {
    blockers.push({
      code: "AUTH_IMMUTABLE_SET",
      reason:
        "The account has the AUTH_IMMUTABLE flag, so it can never be merged (ACCOUNT_MERGE_IMMUTABLE_SET).",
      remedy: "None: the flag cannot be cleared. The account can only be emptied with --partial.",
      permanent: true,
    });
  }
  // An empty pool-share trustline is removed like any other (architecture section 4.4).
  const held = s.poolShares.filter((p) => toStroops(p.balance) > 0n);
  if (held.length > 0) {
    blockers.push({
      code: "LIQUIDITY_POOL_SHARES",
      reason: `The account holds shares of ${held.length} liquidity pool(s) (${held.map((p) => `${p.balance} shares of pool ${p.poolId}`).join("; ")}); each share trustline is a subentry of two base reserves that blocks the merge, and withdrawing from pools is out of scope.`,
      remedy:
        "Withdraw from the pool (LiquidityPoolWithdraw) and remove the pool-share trustline outside Dustin, then run the plan again.",
      permanent: false,
    });
  }
  if (s.numSponsoring > 0) {
    const cb = s.claimableBalancesSponsored ?? 0;
    blockers.push({
      code: "IS_SPONSOR",
      reason:
        `The account sponsors ${s.numSponsoring} reserve(s) for other entries` +
        (cb > 0 ? `, including ${cb} claimable balance(s) it created` : "") +
        "; a sponsoring account cannot be merged (ACCOUNT_MERGE_IS_SPONSOR).",
      remedy:
        "End those sponsorships first: revoke or transfer them, and have claimable balances claimed or clawed back. Claimable balance cleanup is out of scope.",
      permanent: false,
    });
  }
  const d = s.destination;
  if (!d || !d.exists) {
    blockers.push({
      code: "DESTINATION_MISSING",
      reason: `The destination ${d?.account ?? "(none)"} does not exist, so the merge would fail (ACCOUNT_MERGE_NO_ACCOUNT).`,
      remedy:
        "Fund the destination account first, or choose another destination with --to. Dustin never creates it.",
      permanent: false,
    });
  } else {
    if (d.baseAccount === s.account) {
      blockers.push({
        code: "DESTINATION_IS_SELF",
        reason: "The destination is the account being closed (ACCOUNT_MERGE_MALFORMED).",
        remedy: "Choose a different destination with --to.",
        permanent: false,
      });
    }
    if (d.memoRequired && !memo) {
      blockers.push({
        code: "DESTINATION_REQUIRES_MEMO",
        reason: `The destination ${d.account} requires a memo (SEP-29 config.memo_required); a merge without one would be refused.`,
        remedy: "Pass the memo the destination expects with --memo.",
        permanent: false,
      });
    }
  }
  return blockers;
}
