import { DustinError } from "../errors/dustin-error.js";
import type { HorizonJsonClient } from "../reader/horizon-json.js";

/**
 * Testnet reset detection (matrix row X-15). A reset clears every ledger entry and restarts the
 * network from the genesis ledger (https://developers.stellar.org/docs/networks#testnet-and-futurenet-data-reset),
 * so after it a fixture manifest names accounts that no longer exist and records ledgers the
 * network has not reached again. A merged account also answers 404, but Horizon keeps its
 * operations, the account_merge included (day-1 experiment 11, docs/progress-log.md), while an
 * account Horizon has never seen answers 404 for its operations too (observed on 2026-09-28). The
 * judgement is pure; the reads are GET requests only.
 */

/** How many of an account's latest operations are searched for its account_merge. */
const LATEST_OPERATIONS = 10;

/** The account_merge that removed an account, as Horizon lists it. */
export interface MergeRecord {
  into: string;
  transactionHash: string;
  createdAt: string;
}

/** What Horizon still holds for an account that answers 404. */
export interface AccountHistory {
  /** False when Horizon holds no operation for the account (it answered 404 or an empty page). */
  found: boolean;
  /** The account_merge the account itself sourced, among its latest operations. */
  merge: MergeRecord | null;
  /** The type of its latest operation, or null without history. */
  latestType: string | null;
}

export interface ResetInput {
  manifestId: string;
  /** The highest ledger the manifest records (`recordedLedger`). */
  recordedLedger: number;
  /** Horizon's latest ledger. */
  latestLedger: number;
  /** The manifest's accounts that answered 404, each with what Horizon holds for it. */
  missing: Array<{ role: string; account: string; history: AccountHistory }>;
}

export type ClosedAccount = { role: string; account: string } & MergeRecord;
export type GoneAccount = { role: string; account: string; latestType: string | null };

export type ResetFinding =
  | { kind: "reset-suspected"; reason: string }
  | { kind: "no-reset"; closed: ClosedAccount[]; gone: GoneAccount[] };

interface HorizonOperation {
  type: string;
  source_account: string;
  into?: string;
  transaction_hash: string;
  created_at: string;
}

/** The highest ledger a manifest records: its creation ledger or any build transaction's. */
export function recordedLedger(manifest: {
  createdAtLedger: number;
  transactions: ReadonlyArray<{ ledger: number }>;
}): number {
  return Math.max(manifest.createdAtLedger, ...manifest.transactions.map((t) => t.ledger));
}

/** `GET /accounts/{id}/operations`, latest first: whether Horizon holds history, and the merge. */
export async function accountHistory(
  client: HorizonJsonClient,
  account: string,
): Promise<AccountHistory> {
  const page = await client.get<{ _embedded: { records: HorizonOperation[] } }>(
    `/accounts/${account}/operations?order=desc&limit=${LATEST_OPERATIONS}`,
  );
  const records = page?._embedded.records ?? [];
  if (records.length === 0) return { found: false, merge: null, latestType: null };
  const merge = records.find((r) => r.type === "account_merge" && r.source_account === account);
  return {
    found: true,
    merge: merge
      ? {
          into: merge.into ?? "",
          transactionHash: merge.transaction_hash,
          createdAt: merge.created_at,
        }
      : null,
    latestType: records[0]!.type,
  };
}

/** Pure: whether the observations point to a reset, or which accounts were closed or are gone. */
export function judgeReset(input: ResetInput): ResetFinding {
  if (input.recordedLedger > input.latestLedger) {
    return {
      kind: "reset-suspected",
      reason: `the manifest records ledger ${input.recordedLedger}, but Horizon's latest ledger is ${input.latestLedger}: the network restarted from an earlier ledger, as a testnet reset does`,
    };
  }
  const unknown = input.missing.find((m) => !m.history.found);
  if (unknown) {
    return {
      kind: "reset-suspected",
      reason: `the ${unknown.role} account ${unknown.account} answers 404 and Horizon holds no operation for it, so it was not merged: a testnet reset removes accounts together with their history`,
    };
  }
  const closed: ClosedAccount[] = [];
  const gone: GoneAccount[] = [];
  for (const m of input.missing) {
    if (m.history.merge) closed.push({ role: m.role, account: m.account, ...m.history.merge });
    else gone.push({ role: m.role, account: m.account, latestType: m.history.latestType });
  }
  return { kind: "no-reset", closed, gone };
}

/** "the account was merged into G... in transaction ... (time); not a testnet reset". */
export function describeClosed(closed: MergeRecord): string {
  return `the account was merged into ${closed.into} in transaction ${closed.transactionHash} (${closed.createdAt}); not a testnet reset`;
}

export interface ResetCheck {
  manifestId: string;
  profile: "messy" | "edge";
  recordedLedger: number;
  latestLedger: number;
  /** Every manifest account the caller read, and whether Horizon returned it. */
  accounts: Array<{ role: string; account: string; found: boolean }>;
}

/**
 * Reads the history of every account that answered 404 and throws RESET_SUSPECTED when the
 * observations point to a testnet reset (exit code 3 in the CLI: nothing was verified or changed).
 * Otherwise returns the accounts that were merged or are gone, so the caller reports them as such.
 */
export async function assertNoReset(
  client: HorizonJsonClient,
  check: ResetCheck,
): Promise<{ closed: ClosedAccount[]; gone: GoneAccount[] }> {
  const missing = check.accounts.filter((a) => !a.found);
  // The ledger alone can prove a reset; the histories are read only when it does not.
  const histories =
    check.recordedLedger > check.latestLedger
      ? missing.map(() => ({ found: false, merge: null, latestType: null }))
      : await Promise.all(missing.map((a) => accountHistory(client, a.account)));
  const finding = judgeReset({
    manifestId: check.manifestId,
    recordedLedger: check.recordedLedger,
    latestLedger: check.latestLedger,
    missing: missing.map((a, i) => ({ role: a.role, account: a.account, history: histories[i]! })),
  });
  if (finding.kind === "no-reset") return { closed: finding.closed, gone: finding.gone };
  throw new DustinError(
    "RESET_SUSPECTED",
    `Testnet reset suspected for fixture ${check.manifestId}: ${finding.reason}.`,
    {
      stage: "inspect",
      remedy: `A reset deletes every account the fixture had, so it cannot be verified or closed. Build a new one with \`dustin fixture create --profile ${check.profile}\` (new keys, new manifest).`,
      details: { recordedLedger: check.recordedLedger, latestLedger: check.latestLedger },
    },
  );
}
