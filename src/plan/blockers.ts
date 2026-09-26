import type { ExistingAccountSnapshot } from "../inspect/snapshot.js";
import type { Blocker } from "./model.js";

export interface SigningCapability {
  /** The master key alone can sign medium-threshold cleanup operations. */
  cleanup: boolean;
  /** The master key alone can sign the high-threshold merge. */
  merge: boolean;
}

/** Only the master key is assumed; raised thresholds are detected, never solved (SOW). */
export function signingCapability(s: ExistingAccountSnapshot): SigningCapability {
  const w = s.masterWeight;
  return { cleanup: w > 0 && w >= s.thresholds.medium, merge: w > 0 && w >= s.thresholds.high };
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
  } else if (!signing.merge) {
    blockers.push({
      code: "THRESHOLD_UNMET",
      reason: signing.cleanup
        ? `The merge needs signature weight ${s.thresholds.high} (high threshold); the master key has weight ${s.masterWeight}.`
        : `The cleanup needs weight ${s.thresholds.medium} (medium threshold) and the merge ${s.thresholds.high} (high threshold); the master key has weight ${s.masterWeight}.`,
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
