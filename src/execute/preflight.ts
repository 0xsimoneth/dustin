import { base64ToUtf8 } from "../bytes.js";
import { assertPause, clipPause, type Sleep } from "../config/pauses.js";
import { DustinError } from "../errors/dustin-error.js";
import { destinationBaseAccount } from "../inspect/address.js";
import type { HorizonAccount } from "../inspect/horizon-types.js";
import { SECONDS_PER_LEDGER, sequenceGuard } from "../plan/guard.js";
import type { ClosePlan } from "../plan/model.js";
import type { LedgerReader } from "../reader/ledger-reader.js";

export interface PreflightResult {
  ok: boolean;
  detail: string;
  /** Set when the sequence guard blocks the merge: the first ledger it can land in. */
  unblocksAtLedger?: number;
  /**
   * Set with `unblocksAtLedger`: the latest ledger the check went by (story E3-S4). Every other
   * check passed then, so waiting for the ledger is all the merge needs.
   */
  currentLedger?: number;
}

/**
 * SEP-29: a data entry `config.memo_required` with the value "1" (base64 "MQ==") asks senders of
 * payments and merges for a memo; it does not apply to a muxed (M...) destination
 * (https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0029.md; the JS SDK's
 * `checkMemoRequired` skips M addresses the same way, `lib/esm/horizon/server.js`).
 */
function memoRequired(account: HorizonAccount): boolean {
  const value = account.data["config.memo_required"];
  return value !== undefined && base64ToUtf8(value) === "1";
}

/**
 * Fresh facts before a merge that follows earlier transactions of the run (architecture rule R7):
 * the account exists and sponsors nothing, the destination's base account exists (a muxed
 * destination included, review finding R9), a G destination that turned memo-required gets a memo
 * (review finding R10; the raw POST bypasses the SDK's own SEP-29 check), and the sequence guard
 * holds. Leftover subentries are checked only when the merge runs alone (`mergeOnly`): when it
 * shares a transaction with removals, those run first and clear them, and anything else left makes
 * the whole transaction fail atomically with op_has_sub_entries.
 *
 * The sequence guard is checked last, so a result that names `unblocksAtLedger` means every other
 * check passed and only the ledger has to move on (story E3-S4).
 */
export async function mergePreflight(
  reader: LedgerReader,
  plan: ClosePlan,
  options: {
    mergeOnly: boolean;
    /** Reads the account; the executor waits out a Horizon behind its own transactions (E4). */
    readAccount?: () => Promise<HorizonAccount | null>;
    /**
     * A ledger already seen closed, for instance at the end of a wait for the sequence guard.
     * Ledgers only grow, so the guard goes by the later of this and Horizon's answer: a Horizon
     * behind the one that answered the wait cannot hold the merge back again.
     */
    knownLedger?: number;
  },
): Promise<PreflightResult> {
  const [account, destination, latest] = await Promise.all([
    options.readAccount ? options.readAccount() : reader.account(plan.account),
    reader.account(destinationBaseAccount(plan.destination)),
    reader.latestLedger(),
  ]);
  const ledger = Math.max(latest.sequence, options.knownLedger ?? 0);
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
    observedLedger: ledger,
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
          currentLedger: ledger,
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

/** Slack beyond the ledgers to wait for, in ledgers, before a wait for the sequence guard gives up. */
const WAIT_SLACK_LEDGERS = 2;

/**
 * The local-clock limit of a wait for `ledgers` more ledgers to close (story E3-S4): twice their
 * time at the observed pace of about 5 s per ledger (`SECONDS_PER_LEDGER`), plus two ledgers. The
 * ledgers decide when the wait is over; this limit only ends a wait on a network that closes
 * ledgers far slower than usual, so it can never last without end.
 */
export function ledgerWaitLimitMs(ledgers: number): number {
  return 2 * (Math.max(0, ledgers) + WAIT_SLACK_LEDGERS) * SECONDS_PER_LEDGER * 1000;
}

export interface LedgerWait {
  /** True when Horizon reported `target` or a later ledger before the limit passed. */
  reached: boolean;
  /**
   * The latest ledger Horizon reported at the last poll that it answered; `knownLedger` (or 0)
   * while no poll was answered.
   */
  ledger: number;
  /** How long the wait lasted by the local clock, in milliseconds. */
  waitedMs: number;
  /** Reads of the latest ledger, failed ones included. */
  polls: number;
  /** Set when the last read of the latest ledger failed: why (closing review CX-7). */
  readError?: string;
  /** Set when the wait ended because the run was interrupted (review finding CL-1). */
  interrupted?: true;
}

/**
 * Waits until Horizon reports `target` or a later ledger as its latest one (story E3-S4). It reads
 * `GET /ledgers?order=desc&limit=1` and pauses `pollIntervalMs` between reads with the injected
 * `sleep`, never in a tight loop (pauses are at least 200 ms, src/config/pauses.ts). The ledger
 * decides when the wait is over; the local clock only bounds how long it may last (`limitMs`),
 * and a pause is never longer than the time left before that limit (closing review CX-8).
 * A read that fails (after the read client's own retries) proves nothing about the ledger: it
 * counts as a poll that did not reach the target, and the wait goes on until its limit; a wait
 * that gives up after a failed last read says why in `readError` (closing review CX-7).
 */
export async function waitForLedger(
  reader: Pick<LedgerReader, "latestLedger">,
  target: number,
  options: {
    pollIntervalMs: number;
    limitMs: number;
    sleep: Sleep;
    now: () => number;
    /** The latest ledger known before the wait, reported while no poll was answered. */
    knownLedger?: number;
    /**
     * True once the run is interrupted (review finding CL-1): the wait ends after the read in
     * progress, not reached, with `interrupted`.
     */
    aborted?: () => boolean;
  },
): Promise<LedgerWait> {
  assertPause("pollIntervalMs", options.pollIntervalMs, "config");
  const started = options.now();
  let ledger = options.knownLedger ?? 0;
  for (let polls = 1; ; polls++) {
    let readError: string | null = null;
    try {
      ledger = (await reader.latestLedger()).sequence;
    } catch (error) {
      readError =
        error instanceof DustinError
          ? `${error.code}: ${error.message}`
          : error instanceof Error
            ? error.message
            : String(error);
    }
    const waitedMs = options.now() - started;
    if (ledger >= target) return { reached: true, ledger, waitedMs, polls };
    if (options.aborted?.()) return { reached: false, ledger, waitedMs, polls, interrupted: true };
    if (waitedMs >= options.limitMs) {
      return {
        reached: false,
        ledger,
        waitedMs,
        polls,
        ...(readError !== null ? { readError } : {}),
      };
    }
    // Never past the limit by a whole pause: the pause is clipped to the time left, and never
    // below the 200 ms floor (closing review CX-8).
    await options.sleep(clipPause(options.pollIntervalMs, options.limitMs - waitedMs));
    // An interrupted run ends the pause at once: no read follows it (Epic 4 review BH-2, EX-7).
    if (options.aborted?.()) {
      return {
        reached: false,
        ledger,
        waitedMs: options.now() - started,
        polls,
        interrupted: true,
      };
    }
  }
}
