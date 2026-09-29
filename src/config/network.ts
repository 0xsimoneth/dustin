import { Networks } from "@stellar/stellar-sdk";
import { DustinError } from "../errors/dustin-error.js";
import { MAX_PAUSE_MS, assertPause, timerSleep, type Sleep } from "./pauses.js";

// Testnet endpoints and passphrase: https://developers.stellar.org/docs/networks
export const TESTNET_PASSPHRASE: string = Networks.TESTNET;
export const DEFAULT_HORIZON_URL = "https://horizon-testnet.stellar.org";
export const DEFAULT_EXPLORER_BASE = "https://stellar.expert/explorer/testnet";
export const FRIENDBOT_URL = "https://friendbot.stellar.org";

export interface DustinConfig {
  /** Horizon base URL; it must serve the testnet (checked with `verifyHorizonIsTestnet`). */
  horizonUrl?: string;
  /** Only the testnet passphrase is accepted in this release. */
  networkPassphrase?: string;
  /** Base URL for explorer links in reports. */
  explorerBaseUrl?: string;
}

export interface ResolvedConfig {
  readonly horizonUrl: string;
  readonly networkPassphrase: string;
  readonly explorerBaseUrl: string;
}

const TESTNET_ONLY_REMEDY = `Use the Stellar testnet (network passphrase "${TESTNET_PASSPHRASE}").`;

export function assertTestnetPassphrase(passphrase: string): void {
  if (passphrase !== TESTNET_PASSPHRASE) {
    throw new DustinError(
      "MAINNET_REFUSED",
      "Dustin is testnet-only in this release; any other network is refused.",
      { stage: "config", remedy: TESTNET_ONLY_REMEDY },
    );
  }
}

function normaliseHttpUrl(value: string, field: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new DustinError("CONFIG_INVALID", `${field} is not a valid URL.`, { stage: "config" });
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new DustinError("CONFIG_INVALID", `${field} must be an http or https URL.`, {
      stage: "config",
    });
  }
  // Credentials would be echoed in messages and fetch rejects them; a query or fragment would
  // break every path appended to the base URL.
  if (url.username || url.password || url.search || url.hash) {
    throw new DustinError(
      "CONFIG_INVALID",
      `${field} must not contain credentials, a query string or a fragment.`,
      { stage: "config" },
    );
  }
  return url.toString().replace(/\/+$/, "");
}

/**
 * Applies defaults, refuses any network passphrase but testnet and validates the URLs. Makes no
 * network call. Whether a Horizon URL really serves the testnet is checked by other layers:
 * - `verifyHorizonIsTestnet()` (`GET /`, `network_passphrase`, and a check that the answer comes
 *   from a Horizon server) runs before the first read in the CLI commands (`plan`, `close` with
 *   and without `--execute`, `fixture create`, `fixture verify`), in the fixture builder, and in
 *   the executor for its default submit endpoint;
 * - `inspectAccount()` reads the passphrase through its ledger reader (`GET /`) and refuses
 *   anything but testnet before it reads an account, so `planClose()` and the executor's fresh
 *   re-plan cannot read another network's ledger even through a custom reader;
 * - `executeClose()`, the inner-transaction builder and the fee sponsor refuse a plan or a
 *   passphrase that is not testnet before anything is signed.
 */
export function resolveConfig(config: DustinConfig = {}): ResolvedConfig {
  const networkPassphrase = config.networkPassphrase ?? TESTNET_PASSPHRASE;
  assertTestnetPassphrase(networkPassphrase);
  return {
    horizonUrl: normaliseHttpUrl(config.horizonUrl ?? DEFAULT_HORIZON_URL, "The Horizon URL"),
    networkPassphrase,
    explorerBaseUrl: normaliseHttpUrl(
      config.explorerBaseUrl ?? DEFAULT_EXPLORER_BASE,
      "The explorer base URL",
    ),
  };
}

/** Reads the documented non-secret variables. Secrets are never read here. */
export function configFromEnv(env: Record<string, string | undefined>): DustinConfig {
  const config: DustinConfig = {};
  if (env.DUSTIN_HORIZON_URL) config.horizonUrl = env.DUSTIN_HORIZON_URL;
  if (env.DUSTIN_EXPLORER_BASE) config.explorerBaseUrl = env.DUSTIN_EXPLORER_BASE;
  return config;
}

/** How `verifyHorizonIsTestnet` asks: the same bounded retry as the read client. */
export interface VerifyHorizonOptions {
  /** Milliseconds before one request is abandoned; default 15 s. */
  timeoutMs?: number;
  /** Requests after the first one that failed (unreachable, 429, 5xx); default 3. */
  retries?: number;
  /** First pause before a retry, doubled each time; default 1000 ms, at least 200. */
  backoffMs?: number;
  /** Default a timer; tests that must not wait pass one that returns at once. */
  sleep?: Sleep;
}

/**
 * Asks Horizon which network it serves (`GET /` returns `network_passphrase`) and refuses
 * anything but testnet, so an overridden Horizon URL cannot point at a network with real value.
 * A request that fails for a reason that may pass (Horizon unreachable, HTTP 429 or 5xx) is made
 * again after a pause, `retries` more times, with the backoff of the read client
 * (src/reader/horizon-json.ts): one dropped request no longer ends a command with exit 6 (Epic 4
 * review D-3). An answer that is not Horizon's, or another network's, is refused at once. The
 * third argument may be the timeout alone, as before.
 */
export async function verifyHorizonIsTestnet(
  horizonUrl: string,
  fetchImpl: (url: string, init?: RequestInit) => Promise<Response> = (url, init) =>
    fetch(url, init),
  options: number | VerifyHorizonOptions = {},
): Promise<void> {
  const settings = typeof options === "number" ? { timeoutMs: options } : options;
  assertPause("backoffMs", settings.backoffMs, "config");
  const timeoutMs = settings.timeoutMs ?? 15_000;
  const retries = settings.retries ?? 3;
  const backoffMs = settings.backoffMs ?? 1000;
  const sleep = settings.sleep ?? timerSleep;
  const unavailable = (detail: string, cause?: unknown) =>
    new DustinError("HORIZON_UNAVAILABLE", `Horizon at ${horizonUrl} ${detail}.`, {
      stage: "config",
      retryable: true,
      verdict: "retry-same",
      remedy: "Check the network connection or the Horizon URL, then try again.",
      cause,
    });
  const notHorizon = (detail: string) =>
    new DustinError(
      "CONFIG_INVALID",
      `${horizonUrl} does not look like a Horizon server: ${detail}.`,
      {
        stage: "config",
        remedy:
          "Check the Horizon URL (DUSTIN_HORIZON_URL with the CLI, config.horizonUrl with the SDK); the default is https://horizon-testnet.stellar.org.",
      },
    );
  let response: Response | null = null;
  let failure: DustinError | null = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await sleep(Math.min(backoffMs * 2 ** (attempt - 1), MAX_PAUSE_MS));
    try {
      response = await fetchImpl(`${horizonUrl}/`, { signal: AbortSignal.timeout(timeoutMs) });
    } catch (cause) {
      failure = unavailable("is unreachable", cause);
      response = null;
      continue;
    }
    if (response.status === 429 || response.status >= 500) {
      failure = unavailable(`answered HTTP ${response.status}`);
      response = null;
      continue;
    }
    break;
  }
  if (response === null) throw failure ?? unavailable("is unreachable");
  if (!response.ok) throw notHorizon(`HTTP ${response.status}`);
  let root: unknown;
  try {
    root = await response.json();
  } catch {
    throw notHorizon("the response is not JSON");
  }
  if (root === null || typeof root !== "object") throw notHorizon("unexpected response");
  if ((root as { network_passphrase?: unknown }).network_passphrase !== TESTNET_PASSPHRASE) {
    throw new DustinError(
      "MAINNET_REFUSED",
      `Horizon at ${horizonUrl} does not serve the testnet; Dustin is testnet-only in this release.`,
      { stage: "config", remedy: TESTNET_ONLY_REMEDY },
    );
  }
}
