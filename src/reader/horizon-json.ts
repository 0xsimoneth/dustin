import { DustinError } from "../errors/dustin-error.js";
import type { HorizonOffer } from "../inspect/horizon-types.js";

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/**
 * A read-only client for Horizon's JSON resources. It exposes GET only; submission lives in the
 * write zone. Transient failures (network errors, 429, 5xx) are retried with backoff
 * (docs/adr/ADR-0004-horizon-over-rpc.md); 404 is returned as `null`.
 */
export interface HorizonJsonClient {
  readonly horizonUrl: string;
  get<T>(path: string): Promise<T | null>;
}

export interface HorizonJsonOptions {
  fetch?: FetchLike;
  retries?: number;
  backoffMs?: number;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function horizonJson(
  horizonUrl: string,
  options: HorizonJsonOptions = {},
): HorizonJsonClient {
  const doFetch: FetchLike = options.fetch ?? ((url, init) => fetch(url, init));
  const retries = options.retries ?? 3;
  const backoffMs = options.backoffMs ?? 1000;

  async function get<T>(path: string): Promise<T | null> {
    const url = `${horizonUrl}${path}`;
    let lastProblem = "";
    let lastCause: unknown;
    for (let attempt = 0; attempt <= retries; attempt++) {
      if (attempt > 0) await sleep(backoffMs * 2 ** (attempt - 1));
      let response: Response;
      try {
        response = await doFetch(url, { headers: { accept: "application/json" } });
      } catch (cause) {
        lastProblem = "is unreachable";
        lastCause = cause;
        continue;
      }
      if (response.status === 404) return null;
      if (response.ok) return (await response.json()) as T;
      lastProblem = `answered HTTP ${response.status} for ${path}`;
      if (response.status !== 429 && response.status < 500) break;
    }
    throw new DustinError("HORIZON_UNAVAILABLE", `Horizon at ${horizonUrl} ${lastProblem}.`, {
      stage: "inspect",
      retryable: true,
      verdict: "retry-same",
      remedy: "Check the network connection or the Horizon URL, then try again.",
      cause: lastCause,
    });
  }

  return { horizonUrl, get };
}

interface Page<T> {
  _embedded: { records: (T & { paging_token: string })[] };
}

/** Every open offer of an account, following Horizon's 200-record pages to the end. */
export async function accountOffers(
  client: HorizonJsonClient,
  accountId: string,
): Promise<HorizonOffer[]> {
  const offers: HorizonOffer[] = [];
  let cursor = "";
  for (;;) {
    const page = await client.get<Page<HorizonOffer>>(
      `/accounts/${accountId}/offers?limit=200&order=asc${cursor ? `&cursor=${cursor}` : ""}`,
    );
    const records = page?._embedded.records ?? [];
    offers.push(...records);
    if (records.length < 200) return offers;
    cursor = records[records.length - 1]!.paging_token;
  }
}

export interface LedgerSummary {
  sequence: number;
  closed_at: string;
  base_fee_in_stroops: number;
  base_reserve_in_stroops: number;
  protocol_version: number;
}

export async function latestLedger(client: HorizonJsonClient): Promise<LedgerSummary> {
  const page = await client.get<Page<LedgerSummary>>("/ledgers?order=desc&limit=1");
  const ledger = page?._embedded.records[0];
  if (!ledger) {
    throw new DustinError("HORIZON_UNAVAILABLE", "Horizon returned no ledger.", {
      stage: "inspect",
      retryable: true,
      verdict: "retry-same",
    });
  }
  return ledger;
}
