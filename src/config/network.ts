import { Networks } from "@stellar/stellar-sdk";
import { DustinError } from "../errors/dustin-error.js";

// Testnet endpoints and passphrase: https://developers.stellar.org/docs/networks
export const TESTNET_PASSPHRASE: string = Networks.TESTNET;
export const DEFAULT_HORIZON_URL = "https://horizon-testnet.stellar.org";
export const DEFAULT_EXPLORER_BASE = "https://stellar.expert/explorer/testnet";

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
  return url.toString().replace(/\/+$/, "");
}

/** Applies defaults and refuses anything but testnet. Makes no network call. */
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

/**
 * Asks Horizon which network it serves (`GET /` returns `network_passphrase`) and refuses
 * anything but testnet, so an overridden Horizon URL cannot point at a network with real value.
 */
export async function verifyHorizonIsTestnet(
  horizonUrl: string,
  fetchImpl: (url: string) => Promise<Response> = fetch,
): Promise<void> {
  const unavailable = (detail: string, cause?: unknown) =>
    new DustinError("HORIZON_UNAVAILABLE", `Horizon at ${horizonUrl} ${detail}.`, {
      stage: "config",
      retryable: true,
      verdict: "retry-same",
      remedy: "Check the network connection or the Horizon URL, then try again.",
      cause,
    });
  let response: Response;
  try {
    response = await fetchImpl(`${horizonUrl}/`);
  } catch (cause) {
    throw unavailable("is unreachable", cause);
  }
  if (!response.ok) throw unavailable(`answered HTTP ${response.status}`);
  const root = (await response.json()) as { network_passphrase?: unknown };
  if (root.network_passphrase !== TESTNET_PASSPHRASE) {
    throw new DustinError(
      "MAINNET_REFUSED",
      `Horizon at ${horizonUrl} does not serve the testnet; Dustin is testnet-only in this release.`,
      { stage: "config", remedy: TESTNET_ONLY_REMEDY },
    );
  }
}
