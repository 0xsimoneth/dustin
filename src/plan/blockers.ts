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
 * operation's threshold, the transaction source must meet the low threshold: "Combined weight of
 * the signatures for the source account of the transaction meets the low threshold for the source
 * account" (https://developers.stellar.org/docs/learn/fundamentals/transactions/operations-and-transactions#list-of-signatures).
 */
export function signingCapability(s: ExistingAccountSnapshot): SigningCapability {
  const w = s.masterWeight;
  const { low, medium, high } = s.thresholds;
  return { cleanup: w > 0 && w >= Math.max(low, medium), merge: w > 0 && w >= Math.max(low, high) };
}

/**
 * The account holds entries the close removes before the merge: trustlines (pool shares
 * included), offers and data entries, all removed by medium-threshold operations. Signers need no
 * step, the merge removes them. Without such an entry there is no cleanup, and the medium
 * threshold does not matter (closing review CP-1).
 */
export function hasCleanup(s: ExistingAccountSnapshot): boolean {
  return s.trustlines.length + s.poolShares.length + s.offers.length + s.data.length > 0;
}

/** The master key cannot sign a cleanup the account needs, so nothing can run before the merge. */
export function cleanupBlocked(s: ExistingAccountSnapshot): boolean {
  return hasCleanup(s) && !signingCapability(s).cleanup;
}

/** The account's signers other than the master key, as "G... (weight n)"; empty when none. */
function otherSigners(s: ExistingAccountSnapshot): string[] {
  return s.signers
    .filter((signer) => signer.key !== s.account && signer.weight > 0)
    .map((signer) => `${signer.key} (weight ${signer.weight})`);
}

const signersSentence = (s: ExistingAccountSnapshot): string => {
  const others = otherSigners(s);
  return others.length > 0
    ? ` The account's other signers: ${others.join(", ")}.`
    : " The account has no other signer.";
};

/**
 * Which threshold each step needs, from the list of operations
 * (https://developers.stellar.org/docs/learn/fundamentals/transactions/list-of-operations):
 * AccountMerge is high; ChangeTrust, ManageData, Payment, PathPaymentStrictSend and ManageSellOffer
 * are medium; BumpSequence is low. Every transaction also needs the low threshold for its source
 * account (operations and transactions, "List of signatures"). Dustin signs with the master key
 * only, so the blocker says which of these the master key's weight cannot reach (E3-S5 AC-2).
 */
function thresholdReason(s: ExistingAccountSnapshot): string {
  const w = s.masterWeight;
  const { low, medium, high } = s.thresholds;
  const cleanupNeed = Math.max(low, medium);
  const mergeNeed = Math.max(low, high);
  const rules =
    `Thresholds: low ${low}, medium ${medium}, high ${high}; ` +
    "the merge (accountMerge) needs the high threshold, changeTrust, manageData, payments and offers need the medium threshold, bumpSequence needs the low threshold, and every transaction needs the low threshold for its source account.";
  let blocked: string;
  if (!hasCleanup(s)) {
    // Only the merge's own transaction matters: max(low, high) (closing review CP-1).
    blocked =
      w < low
        ? `Blocked: every transaction needs weight ${low} for its source account (low threshold), so the merge, which needs weight ${mergeNeed}, cannot be signed. The account has nothing to clean up.`
        : `Blocked: the merge needs weight ${mergeNeed}. The account has nothing to clean up.`;
  } else if (w < low) {
    blocked = `Blocked: every transaction needs weight ${low} for its source account (low threshold), so nothing can be signed: the cleanup needs weight ${cleanupNeed} and the merge needs weight ${mergeNeed}.`;
  } else if (w < cleanupNeed) {
    blocked =
      w < mergeNeed
        ? `Blocked: the cleanup needs weight ${cleanupNeed} and the merge needs weight ${mergeNeed}, so nothing can be signed.`
        : `Blocked: the cleanup needs weight ${cleanupNeed}, so nothing can be signed, and the merge cannot run without the cleanup.`;
  } else {
    blocked = `Blocked: the merge needs weight ${mergeNeed}. The cleanup needs weight ${cleanupNeed}, which the master key meets.`;
  }
  return `The master key has weight ${w} and is the only key Dustin signs with. ${rules} ${blocked}${signersSentence(s)}`;
}

/** The pools whose shares the account holds, named in the order the snapshot lists them. */
function poolSharesBlocker(held: ExistingAccountSnapshot["poolShares"]): Blocker {
  const pools = held.length === 1 ? "1 liquidity pool" : `${held.length} liquidity pools`;
  return {
    code: "LIQUIDITY_POOL_SHARES",
    reason:
      `The account holds shares of ${pools} (${held.map((p) => `${p.balance} shares of pool ${p.poolId}`).join("; ")}). ` +
      "Each share trustline is a subentry of two base reserves that blocks the merge, and the pool's asset trustlines cannot be removed while it exists (CHANGE_TRUST_CANNOT_DELETE). Withdrawing from pools is out of scope, so Dustin plans no operation for them.",
    remedy:
      `Withdraw from ${held.map((p) => `pool ${p.poolId}`).join(" and from ")} first (LiquidityPoolWithdraw); Dustin does not withdraw. ` +
      "Then run the plan again: an emptied share trustline and the pool's asset trustlines are removed like any other trustline.",
    permanent: false,
  };
}

/**
 * Conditions that make the merge impossible today (docs/README.md canonical decision 11;
 * AccountMerge result codes: https://developers.stellar.org/docs/data/apis/horizon/api-reference/errors/result-codes/operation-specific/account-merge).
 * AUTH_IMMUTABLE_SET comes first: nothing can ever lift it (edge case A-06). The sequence guard is
 * added by the planner once the merge's transaction index is known.
 */
export function mergeBlockers(s: ExistingAccountSnapshot, memo: string | null): Blocker[] {
  const blockers: Blocker[] = [];
  const signing = signingCapability(s);
  if (s.flags.authImmutable) {
    // "The issuing account can't be merged" once AUTH_IMMUTABLE is set, and no flag can change after
    // it (https://developers.stellar.org/docs/tokens/control-asset-access#authorization-immutable-0x4).
    blockers.push({
      code: "AUTH_IMMUTABLE_SET",
      reason:
        "The account has the AUTH_IMMUTABLE flag, so it can never be merged: the merge would fail with ACCOUNT_MERGE_IMMUTABLE_SET, and the flag can never be cleared.",
      remedy:
        "None: the flag cannot be cleared, so the account can never be merged. With --partial the cleanup still runs and empties the account, but the account stays on the ledger.",
      permanent: true,
    });
  }
  if (s.masterWeight === 0) {
    // "If the master key's weight is set at 0, it cannot be used to sign transactions, even for
    // operations with a threshold value of 0"
    // (https://developers.stellar.org/docs/learn/fundamentals/transactions/signatures-multisig#thresholds).
    blockers.push({
      code: "MASTER_KEY_DISABLED",
      reason:
        "The master key has weight 0, so it cannot sign anything for this account, not even an operation whose threshold is 0." +
        signersSentence(s),
      remedy:
        "Multisig closing is out of scope: sign with the account's other signers outside Dustin.",
      permanent: true,
    });
  } else if (!signing.merge || cleanupBlocked(s)) {
    // A raised medium or low threshold stops the cleanup too, and with it the merge; without a
    // cleanup only the merge's thresholds count (closing review CP-1).
    blockers.push({
      code: "THRESHOLD_UNMET",
      reason: thresholdReason(s),
      remedy:
        "Multisig closing is out of scope: sign outside Dustin with enough weight, or have the signers lower the thresholds to the master key's weight (SetOptions, which needs the high threshold), then run the plan again." +
        (signing.cleanup ? " The cleanup can run now with --partial." : ""),
      permanent: true,
    });
  }
  // An empty pool-share trustline is removed like any other (architecture section 4.4).
  const held = s.poolShares.filter((p) => toStroops(p.balance) > 0n);
  if (held.length > 0) blockers.push(poolSharesBlocker(held));
  if (s.numSponsoring > 0) {
    const cb = s.claimableBalancesSponsored ?? 0;
    blockers.push({
      code: "IS_SPONSOR",
      reason:
        `The account sponsors ${s.numSponsoring} reserve(s) for other entries` +
        (cb > 0 ? `, including ${cb} claimable balance(s) it created` : "") +
        "; a sponsoring account cannot be merged (ACCOUNT_MERGE_IS_SPONSOR).",
      // RevokeSponsorship removes or transfers a sponsorship; a claimable balance's can only be
      // transferred, and ends when the balance is claimed or clawed back
      // (https://developers.stellar.org/docs/learn/fundamentals/transactions/list-of-operations#revoke-sponsorship;
      // https://developers.stellar.org/docs/build/guides/transactions/sponsored-reserves#effect-on-claimable-balances).
      remedy:
        "Revoke or transfer your sponsorships first (RevokeSponsorship; each sponsored entry's owner must then afford its own reserve, or another account takes the sponsorship over)" +
        (cb > 0
          ? ". A claimable balance's sponsorship can only be transferred (REVOKE_SPONSORSHIP_ONLY_TRANSFERABLE); otherwise it ends when the balance is claimed by its claimant or clawed back by its issuer (ClawbackClaimableBalance). Claimable balance cleanup is out of scope"
          : "") +
        ". Then run the plan again.",
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
