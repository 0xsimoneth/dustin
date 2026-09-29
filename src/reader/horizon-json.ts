import { assertPause, timerSleep, type Sleep } from "../config/pauses.js";
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
  /** First pause before a retry, doubled each time; default 1000 ms, at least 200. */
  backoffMs?: number;
  timeoutMs?: number;
  /** Default a timer; tests that must not wait pass one that returns at once. */
  sleep?: Sleep;
}

export function horizonJson(
  horizonUrl: string,
  options: HorizonJsonOptions = {},
): HorizonJsonClient {
  const doFetch: FetchLike = options.fetch ?? ((url, init) => fetch(url, init));
  // A pause of 0 would retry Horizon in a tight loop (src/config/pauses.ts).
  assertPause("backoffMs", options.backoffMs, "config");
  const retries = options.retries ?? 3;
  const backoffMs = options.backoffMs ?? 1000;
  const sleep = options.sleep ?? timerSleep;
  const timeoutMs = options.timeoutMs ?? 30_000;

  async function get<T>(path: string): Promise<T | null> {
    const url = `${horizonUrl}${path}`;
    let lastProblem = "";
    let lastCause: unknown;
    for (let attempt = 0; attempt <= retries; attempt++) {
      if (attempt > 0) await sleep(backoffMs * 2 ** (attempt - 1));
      let response: Response;
      try {
        response = await doFetch(url, {
          headers: { accept: "application/json" },
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (cause) {
        lastProblem = "is unreachable";
        lastCause = cause;
        continue;
      }
      if (response.status === 404) return null;
      if (response.ok) {
        try {
          return (await response.json()) as T;
        } catch (cause) {
          lastProblem = `answered with a body that is not JSON for ${path}`;
          lastCause = cause;
          continue;
        }
      }
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
  _embedded: { records: (T & { paging_token?: string })[] };
}

/** Horizon's largest page (https://developers.stellar.org/docs/data/apis/horizon/api-reference/structure/pagination/page-arguments). */
export const PAGE_LIMIT = 200;

/**
 * Follows a collection's pages: `path(cursor)` asks for up to 200 records after `cursor` ("" for
 * the first page), and a page with fewer than 200 records is the last. It reads at most `maxPages`
 * pages (default: no bound) and says whether it reached the end. A full page whose last record
 * has no `paging_token`, or repeats the cursor it was asked from, would be asked for again with no
 * end; the read stops there with HORIZON_UNAVAILABLE (Epic 4 review EP-19).
 */
export async function readPages<T>(
  client: HorizonJsonClient,
  path: (cursor: string) => string,
  maxPages = Number.POSITIVE_INFINITY,
): Promise<{ records: T[]; complete: boolean }> {
  const records: T[] = [];
  let cursor = "";
  for (let pages = 0; pages < maxPages; pages++) {
    const asked = path(cursor);
    const page = await client.get<Page<T>>(asked);
    const batch = page?._embedded.records ?? [];
    records.push(...batch);
    if (batch.length < PAGE_LIMIT) return { records, complete: true };
    const next = batch[batch.length - 1]!.paging_token;
    if (typeof next !== "string" || next === "" || next === cursor) {
      const problem =
        typeof next === "string" && next !== ""
          ? "whose last paging_token is the cursor it was asked from"
          : "without a paging_token on its last record";
      throw new DustinError(
        "HORIZON_UNAVAILABLE",
        `Horizon at ${client.horizonUrl} answered a full page for ${asked} ${problem}, so its next page cannot be asked for.`,
        {
          stage: "inspect",
          retryable: true,
          verdict: "retry-same",
          remedy: "Try again, or point DUSTIN_HORIZON_URL at another testnet Horizon.",
        },
      );
    }
    cursor = next;
  }
  return { records, complete: false };
}

/** Every open offer of an account, following Horizon's 200-record pages to the end. */
export async function accountOffers(
  client: HorizonJsonClient,
  accountId: string,
): Promise<HorizonOffer[]> {
  const { records } = await readPages<HorizonOffer>(
    client,
    (cursor) =>
      `/accounts/${accountId}/offers?limit=200&order=asc${cursor ? `&cursor=${cursor}` : ""}`,
  );
  return records;
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
