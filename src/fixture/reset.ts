import { DustinError } from "../errors/dustin-error.js";
import type { HorizonJsonClient } from "../reader/horizon-json.js";

/**
 * Testnet reset detection (matrix row X-15). A reset clears every ledger entry, transaction and
 * historical record and restarts the network from the genesis ledger
 * (https://developers.stellar.org/docs/networks#testnet-and-futurenet-data-reset), so after it
 * none of a fixture's accounts exists and Horizon's latest ledger lies far below the one the
 * manifest records. A merged account also answers 404, but Horizon keeps its operations, the
 * account_merge included (day-1 experiment 11, docs/progress-log.md), while an account Horizon has
 * never seen answers 404 for its operations too (observed on 2026-09-28). The judgement is pure;
 * the reads are GET requests only.
 */

/**
 * How many of an account's latest operations are searched for its account_merge: Horizon's page
 * maximum (https://developers.stellar.org/docs/data/apis/horizon/api-reference/structure/pagination/page-arguments),
 * so that operations of other accounts that still name the merged one after its merge (a claimable
 * balance naming it as a claimant, for one) cannot push the merge out of the page (Epic 4 review
 * BH-18).
 */
export const LATEST_OPERATIONS = 200;

/**
 * How far Horizon's latest ledger may trail the ledger a manifest records before the gap counts
 * as a sign of a reset: 120 ledgers, about ten minutes at the network's average ledger close time
 * of about 5 seconds
 * (https://developers.stellar.org/docs/tools/cli/cookbook/extend-contract-instance). A Horizon
 * behind a load balancer is several instances that ingest independently, and one can lag in
 * ingestion (https://developers.stellar.org/docs/data/apis/horizon/admin-guide/scaling#scaling-to-multiple-instances),
 * so `fixture verify` right after `fixture create` may be answered by an instance a few ledgers
 * behind the one that settled the last build transaction. A reset restarts at the genesis ledger,
 * millions of ledgers below any ledger a fixture recorded (4874327 for the baseline fixture), so
 * the tolerance cannot hide one (Epic 4 review EP-1).
 */
export const HORIZON_LAG_TOLERANCE_LEDGERS = 120;

/** The account_merge that removed an account, as Horizon lists it. */
export interface MergeRecord {
  into: string;
  transactionHash: string;
  createdAt: string;
  /** The ledger of the merge transaction, or null when Horizon did not return the transaction. */
  ledger: number | null;
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
  /** Horizon's latest ledger, or null when it was not read (never taken as ledger 0). */
  latestLedger: number | null;
  /** How many of the manifest accounts read answered 200. */
  existing: number;
  /** The manifest's accounts that answered 404, each with what Horizon holds for it. */
  missing: Array<{ role: string; account: string; history: AccountHistory }>;
}

export type ClosedAccount = { role: string; account: string } & MergeRecord;
export type GoneAccount = { role: string; account: string; latestType: string | null };
/** An account that answers 404 while Horizon holds no operation for it (EP-2). */
export type UnseenAccount = { role: string; account: string };

export type ResetFinding =
  | { kind: "reset-suspected"; reason: string }
  | { kind: "no-reset"; closed: ClosedAccount[]; gone: GoneAccount[]; unseen: UnseenAccount[] };

/** Why a manifest account answers 404, for its failing "exists" check (EP-2, EP-20). */
export type MissingAccount =
  | { kind: "closed"; merge: MergeRecord }
  | { kind: "gone"; latestType: string | null }
  | { kind: "unseen"; historyElderLedger: number | null };

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

/**
 * `GET /accounts/{id}/operations`, latest first: whether Horizon holds history, and the merge with
 * the ledger of its transaction (`GET /transactions/{hash}`).
 */
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
  const transaction = merge
    ? await client.get<{ ledger?: number }>(`/transactions/${merge.transaction_hash}`)
    : null;
  return {
    found: true,
    merge: merge
      ? {
          into: merge.into ?? "",
          transactionHash: merge.transaction_hash,
          createdAt: merge.created_at,
          ledger: typeof transaction?.ledger === "number" ? transaction.ledger : null,
        }
      : null,
    latestType: records[0]!.type,
  };
}

/**
 * Pure: whether the observations point to a reset, or which accounts were closed, are gone, or
 * were never seen. A reset deletes every account, so any manifest account that answers 200 rules
 * it out; with none left, a reset is suspected when Horizon's latest ledger lies more than the lag
 * tolerance below the recorded one, or when Horizon holds no operation for any of the accounts
 * (Epic 4 review EP-1). One account without history among others that exist was never funded or
 * lies outside Horizon's history window, and is reported as such (EP-2).
 */
export function judgeReset(input: ResetInput): ResetFinding {
  if (input.existing === 0 && input.missing.length > 0) {
    if (
      input.latestLedger !== null &&
      input.recordedLedger - input.latestLedger > HORIZON_LAG_TOLERANCE_LEDGERS
    ) {
      return {
        kind: "reset-suspected",
        reason: `none of its accounts exists, and the manifest records ledger ${input.recordedLedger} while Horizon's latest ledger is ${input.latestLedger}, more than ${HORIZON_LAG_TOLERANCE_LEDGERS} ledgers earlier: the network restarted from an earlier ledger, as a testnet reset does`,
      };
    }
    if (input.missing.every((m) => !m.history.found)) {
      const names = input.missing.map((m) => `${m.role} ${m.account}`).join(", ");
      return {
        kind: "reset-suspected",
        reason: `none of its accounts exists and Horizon holds no operation for any of them (${names}), so none was merged: a testnet reset removes accounts together with their history`,
      };
    }
  }
  const closed: ClosedAccount[] = [];
  const gone: GoneAccount[] = [];
  const unseen: UnseenAccount[] = [];
  for (const m of input.missing) {
    if (m.history.merge) closed.push({ role: m.role, account: m.account, ...m.history.merge });
    else if (m.history.found)
      gone.push({ role: m.role, account: m.account, latestType: m.history.latestType });
    else unseen.push({ role: m.role, account: m.account });
  }
  return { kind: "no-reset", closed, gone, unseen };
}

/** "the account was closed: merged into G... in ledger N by transaction ... (time); ...". */
export function describeClosed(closed: MergeRecord): string {
  const ledger = closed.ledger === null ? "" : ` in ledger ${closed.ledger}`;
  return `the account was closed: merged into ${closed.into}${ledger} by transaction ${closed.transactionHash} (${closed.createdAt}); not a testnet reset`;
}

/** The evidence of a failing "exists" check for an account that answers 404. */
export function describeMissing(missing: MissingAccount | undefined): string {
  if (!missing) return "Horizon answered 404: the account does not exist";
  switch (missing.kind) {
    case "closed":
      return `Horizon answered 404: ${describeClosed(missing.merge)}`;
    case "gone":
      return `Horizon answered 404 but holds operations for the account (the latest a ${missing.latestType ?? "operation"}), its own account_merge not among the latest ${LATEST_OPERATIONS}; not a testnet reset, which clears the history too`;
    case "unseen": {
      const window =
        missing.historyElderLedger === null
          ? "before the oldest ledger this Horizon keeps history for"
          : `before ledger ${missing.historyElderLedger}, the oldest this Horizon keeps history for (history_elder_ledger)`;
      return `Horizon answered 404 and holds no operation for the account: it was never funded, or it was merged ${window}; not taken for a testnet reset, since other accounts of the fixture exist or keep their history`;
    }
  }
}

export interface ResetCheck {
  manifestId: string;
  profile: "messy" | "edge";
  recordedLedger: number;
  /** Horizon's latest ledger, or null when it was not read (never taken as ledger 0). */
  latestLedger: number | null;
  /** Every manifest account the caller read, and whether Horizon returned it. */
  accounts: Array<{ role: string; account: string; found: boolean }>;
}

export interface ResetChecked {
  closed: ClosedAccount[];
  gone: GoneAccount[];
  unseen: UnseenAccount[];
  /** Why each account that answered 404 is missing, by role, for its "exists" check. */
  missing: Record<string, MissingAccount>;
}

/**
 * Reads the history of every account that answered 404 and throws RESET_SUSPECTED when the
 * observations point to a testnet reset (exit code 3 in the CLI: nothing was verified or changed).
 * Otherwise returns why each missing account is missing: merged (with the ledger and hash of the
 * merge), gone with history but no merge among its latest operations, or never seen by Horizon
 * (with Horizon's `history_elder_ledger`, read from its root), so the caller reports them as such.
 */
export async function assertNoReset(
  client: HorizonJsonClient,
  check: ResetCheck,
): Promise<ResetChecked> {
  const missing = check.accounts.filter((a) => !a.found);
  const existing = check.accounts.length - missing.length;
  // With no account left, the ledger alone can point to a reset; the histories are read otherwise.
  const behind =
    existing === 0 &&
    check.latestLedger !== null &&
    check.recordedLedger - check.latestLedger > HORIZON_LAG_TOLERANCE_LEDGERS;
  const histories = behind
    ? missing.map((): AccountHistory => ({ found: false, merge: null, latestType: null }))
    : await Promise.all(missing.map((a) => accountHistory(client, a.account)));
  const finding = judgeReset({
    manifestId: check.manifestId,
    recordedLedger: check.recordedLedger,
    latestLedger: check.latestLedger,
    existing,
    missing: missing.map((a, i) => ({ role: a.role, account: a.account, history: histories[i]! })),
  });
  if (finding.kind === "no-reset") {
    const root =
      finding.unseen.length > 0 ? await client.get<{ history_elder_ledger?: unknown }>("/") : null;
    const elder = root?.history_elder_ledger;
    const historyElderLedger =
      typeof elder === "number" && Number.isSafeInteger(elder) ? elder : null;
    const byRole: Record<string, MissingAccount> = {};
    for (const c of finding.closed) {
      const merge = { into: c.into, transactionHash: c.transactionHash, createdAt: c.createdAt };
      byRole[c.role] = { kind: "closed", merge: { ...merge, ledger: c.ledger } };
    }
    for (const g of finding.gone) byRole[g.role] = { kind: "gone", latestType: g.latestType };
    for (const u of finding.unseen) byRole[u.role] = { kind: "unseen", historyElderLedger };
    return { closed: finding.closed, gone: finding.gone, unseen: finding.unseen, missing: byRole };
  }
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
