import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The recorded Horizon responses of the repository's messy fixture (test/fixtures/horizon/messy),
 * served to the page in place of the network: the unit tests stub `fetch` with them, the Playwright
 * test fulfils the browser's requests from them. The fixture was recorded on 2026-09-26.
 */

export const HORIZON = "https://horizon-testnet.stellar.org";
export const TESTNET_PASSPHRASE = "Test SDF Network ; September 2015";
export const MESSY_DIR = fileURLToPath(
  new URL("../../../test/fixtures/horizon/messy/", import.meta.url),
);

export interface Recorded {
  status: number;
  body: unknown;
}

export interface MessyAccounts {
  sponsor: string;
  reserveSponsor: string;
  issuer: string;
  marketMaker: string;
  destination: string;
  fixture: string;
}

/** Every recorded response of a fixture folder, by request path (query string included). */
export function loadRecorded(dir: string = MESSY_DIR): Map<string, Recorded> {
  const map = new Map<string, Recorded>();
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".json") && f !== "manifest.json")) {
    const r = JSON.parse(readFileSync(join(dir, file), "utf8")) as {
      path: string;
      status: number;
      body: unknown;
    };
    map.set(r.path, { status: r.status, body: r.body });
  }
  return map;
}

export function messyAccounts(): MessyAccounts {
  const manifest = JSON.parse(readFileSync(join(MESSY_DIR, "manifest.json"), "utf8")) as {
    accounts: MessyAccounts;
  };
  return manifest.accounts;
}

/**
 * What Horizon would answer for a path: its root names the testnet, a recorded path answers its
 * record, anything else is 404 as Horizon's "Resource Missing". `overrides` replace a path's
 * answer; `null` forces a 404 (an account that does not exist).
 */
export function answerFor(
  recorded: Map<string, Recorded>,
  path: string,
  overrides: Record<string, Recorded | null> = {},
): Recorded {
  if (path === "/" || path === "") {
    return { status: 200, body: { network_passphrase: TESTNET_PASSPHRASE } };
  }
  if (path in overrides) {
    return overrides[path] ?? { status: 404, body: { status: 404, title: "Resource Missing" } };
  }
  return recorded.get(path) ?? { status: 404, body: { status: 404, title: "Resource Missing" } };
}

export interface RecordedRequest {
  method: string;
  path: string;
}

/** A global `fetch` for the unit tests: recorded answers, every request logged. */
export function recordedFetch(
  recorded: Map<string, Recorded>,
  overrides: Record<string, Recorded | null> = {},
): { fetch: typeof fetch; requests: RecordedRequest[] } {
  const requests: RecordedRequest[] = [];
  const fetchImpl: typeof fetch = (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const path = url.startsWith(HORIZON) ? url.slice(HORIZON.length) : url;
    // A Request object carries its own method; reading `init` alone logged a POST Request as a GET
    // (E5-S1 review, EC-9).
    const method = init?.method ?? (input instanceof Request ? input.method : "GET");
    requests.push({ method, path });
    const answer = answerFor(recorded, path, overrides);
    return Promise.resolve(
      new Response(JSON.stringify(answer.body), {
        status: answer.status,
        headers: { "content-type": "application/hal+json" },
      }),
    );
  };
  return { fetch: fetchImpl, requests };
}
