import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

export const TESTNET_HORIZON = "https://horizon-testnet.stellar.org";
const TESTNET_PASSPHRASE = "Test SDF Network ; September 2015";

export interface RecordedRequest {
  method: string;
  path: string;
}

/** Recorded Horizon responses keyed by request path, loaded from a test/fixtures/horizon folder. */
export function loadRecorded(dir: string): Map<string, unknown> {
  const map = new Map<string, unknown>();
  for (const file of readdirSync(dir).filter((f) => f !== "manifest.json")) {
    const r = JSON.parse(readFileSync(join(dir, file), "utf8")) as {
      path: string;
      status: number;
      body: unknown;
    };
    if (r.status === 200) map.set(r.path, r.body);
  }
  return map;
}

/**
 * A fetch that serves recorded Horizon JSON (404 for anything unknown) and logs every request.
 * `overrides` replace or add responses by path; `undefined` forces a 404.
 */
export function recordedFetch(
  recorded: Map<string, unknown>,
  overrides: Record<string, unknown> = {},
): { fetch: (url: string, init?: RequestInit) => Promise<Response>; requests: RecordedRequest[] } {
  const requests: RecordedRequest[] = [];
  const fetch = (url: string, init?: RequestInit) => {
    const path = url.startsWith(TESTNET_HORIZON) ? url.slice(TESTNET_HORIZON.length) : url;
    requests.push({ method: init?.method ?? "GET", path });
    if (path === "/") {
      return Promise.resolve(
        new Response(JSON.stringify({ network_passphrase: TESTNET_PASSPHRASE })),
      );
    }
    const body = path in overrides ? overrides[path] : recorded.get(path);
    return Promise.resolve(
      body === undefined
        ? new Response(JSON.stringify({ status: 404 }), { status: 404 })
        : new Response(JSON.stringify(body)),
    );
  };
  return { fetch, requests };
}

export const MESSY_DIR = "test/fixtures/horizon/messy";

export interface MessyManifest {
  accounts: Record<
    "sponsor" | "reserveSponsor" | "issuer" | "marketMaker" | "destination" | "fixture",
    string
  >;
}

export function messyManifest(): MessyManifest {
  return JSON.parse(readFileSync(join(MESSY_DIR, "manifest.json"), "utf8")) as MessyManifest;
}
