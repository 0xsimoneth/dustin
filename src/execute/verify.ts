import { assertTestnetPassphrase, resolveConfig, type DustinConfig } from "../config/network.js";
import { MIN_PAUSE_MS, assertPause, timerSleep, type Sleep } from "../config/pauses.js";
import { DustinError } from "../errors/dustin-error.js";
import { assertAccountAddress } from "../inspect/address.js";
import { horizonJson } from "../reader/horizon-json.js";
import { horizonReader, type LedgerReader } from "../reader/ledger-reader.js";

export interface VerifyClosedOptions {
  config?: DustinConfig;
  /** Custom ledger reader; defaults to Horizon from `config`, checked to serve the testnet. */
  reader?: LedgerReader;
  /** Keep looking until Horizon answers 404 for at most this long; default 30 s, 0 checks once. */
  timeoutMs?: number;
  /** Pause between looks; default 2 s, at least 200 ms (src/config/pauses.ts). */
  intervalMs?: number;
  /**
   * Clock in milliseconds and the wait between looks, for tests and custom schedulers; tests that
   * must not wait inject a sleep that returns at once.
   */
  now?: () => number;
  sleep?: Sleep;
}

export interface ClosedVerification {
  accountExists: boolean;
  horizonStatus: 200 | 404;
  checkedAt: string;
  /** Horizon had ingested at least this ledger when it answered. */
  ledger: number;
  accountUrl: string;
}

/**
 * The final proof of a close (PRD FR-18, AC-E2-S4-1): `GET /accounts/{id}` answers 404 once the
 * merge has applied. Horizon can lag the ledger by a moment, so it looks again every `intervalMs`
 * until it sees a 404 or `timeoutMs` has passed, and records the latest ledger Horizon reported
 * before each look. Read-only: it signs and submits nothing.
 */
export async function verifyClosed(
  account: string,
  options: VerifyClosedOptions = {},
): Promise<ClosedVerification> {
  assertAccountAddress(account);
  assertPause("intervalMs", options.intervalMs, "config");
  if (
    options.timeoutMs !== undefined &&
    !(Number.isFinite(options.timeoutMs) && options.timeoutMs >= 0)
  ) {
    throw new DustinError(
      "CONFIG_INVALID",
      `Invalid option: timeoutMs must be a finite number of at least 0; got ${String(options.timeoutMs)}.`,
      { stage: "config" },
    );
  }
  const config = resolveConfig(options.config);
  const reader = options.reader ?? horizonReader(horizonJson(config.horizonUrl));
  if (!options.reader) assertTestnetPassphrase(await reader.networkPassphrase());
  const now = options.now ?? (() => Date.now());
  const sleep = options.sleep ?? timerSleep;
  const deadline = now() + (options.timeoutMs ?? 30_000);
  for (;;) {
    const ledger = await reader.latestLedger();
    const record = await reader.account(account);
    const result: ClosedVerification = {
      accountExists: record !== null,
      horizonStatus: record === null ? 404 : 200,
      checkedAt: new Date(now()).toISOString(),
      ledger: ledger.sequence,
      accountUrl: `${config.explorerBaseUrl}/account/${account}`,
    };
    if (!result.accountExists || now() >= deadline) return result;
    // Never past the timeout by a whole pause, never below the 200 ms floor (closing review CX-8).
    await sleep(Math.max(MIN_PAUSE_MS, Math.min(options.intervalMs ?? 2_000, deadline - now())));
  }
}
