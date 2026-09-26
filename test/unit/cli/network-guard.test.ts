import { Keypair, Networks } from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";
import { run } from "../../../src/cli/run.js";
import { MESSY_DIR, loadRecorded, recordedFetch } from "../../helpers/recorded-horizon.js";
import { messy } from "../../helpers/snapshots.js";

// Review R6 (CLI part): every command asks Horizon which network it serves before its first read.

const recorded = loadRecorded(MESSY_DIR);

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

async function cli(args: string[], fetch: Fetch) {
  const out: string[] = [];
  const err: string[] = [];
  const code = await run(
    ["node", "dustin", ...args],
    { stdout: (s) => void out.push(s), stderr: (s) => void err.push(s) },
    "0.0.0",
    { env: {}, fetch, horizon: { retries: 0, backoffMs: 0 } },
  );
  return { code, out: out.join(""), err: err.join("") };
}

/** Serves the recorded fixture, but answers `GET /` with another network's passphrase. */
function publicNetworkHorizon() {
  const requests: string[] = [];
  const { fetch } = recordedFetch(recorded);
  const serve: Fetch = (url, init) => {
    requests.push(url);
    if (url === "https://horizon-testnet.stellar.org/") {
      return Promise.resolve(
        new Response(JSON.stringify({ network_passphrase: Networks.PUBLIC }), { status: 200 }),
      );
    }
    return fetch(url, init);
  };
  return { serve, requests };
}

/** A URL that answers, but is not a Horizon server: a web page at the root, or a 404. */
function notHorizon(root: Response) {
  const requests: string[] = [];
  const serve: Fetch = (url) => {
    requests.push(url);
    return Promise.resolve(root.clone());
  };
  return { serve, requests };
}

function unreachableHorizon() {
  const requests: string[] = [];
  const serve: Fetch = (url) => {
    requests.push(url);
    return Promise.reject(new Error("ECONNREFUSED"));
  };
  return { serve, requests };
}

const planArgs = ["plan", messy.fixture, "--to", messy.destination];
const closeArgs = ["close", messy.fixture, "--to", messy.destination];

describe("network guard before the first read (review R6)", () => {
  for (const [name, args] of [
    ["plan", planArgs],
    ["close without --execute", closeArgs],
  ] as const) {
    it(`${name} refuses a Horizon that does not serve the testnet with exit 2, before reading the account`, async () => {
      const horizon = publicNetworkHorizon();
      const r = await cli([...args], horizon.serve);
      expect(r.code).toBe(2);
      expect(r.err).toContain("MAINNET_REFUSED");
      expect(r.out).toBe("");
      // Only the network question was asked: no account, ledger or fee read happened.
      expect(horizon.requests).toEqual(["https://horizon-testnet.stellar.org/"]);
    });

    it(`${name} calls a URL that is not a Horizon server a configuration error (exit 2), not an outage`, async () => {
      for (const root of [
        new Response("<html>portal</html>", { status: 200 }),
        new Response(JSON.stringify({ status: 404 }), { status: 404 }),
      ]) {
        const horizon = notHorizon(root);
        const r = await cli([...args], horizon.serve);
        expect(r.code).toBe(2);
        expect(r.err).toContain("CONFIG_INVALID");
        expect(r.err).toContain("does not look like a Horizon server");
        expect(horizon.requests).toEqual(["https://horizon-testnet.stellar.org/"]);
      }
    });

    it(`${name} exits 6 when Horizon is unreachable, after one request`, async () => {
      const horizon = unreachableHorizon();
      const r = await cli([...args], horizon.serve);
      expect(r.code).toBe(6);
      expect(r.err).toContain("HORIZON_UNAVAILABLE");
      expect(horizon.requests).toEqual(["https://horizon-testnet.stellar.org/"]);
    });
  }

  it("checks the addresses before any request, so a typo is exit 2 even when offline", async () => {
    const cases: string[][] = [
      ["plan", "GABC", "--to", messy.destination],
      ["plan", messy.fixture],
      ["plan", messy.fixture, "--to", "GXYZ"],
      ["plan", messy.fixture, "--to", messy.destination, "--sponsor", "GNOPE"],
      ["close", "GABC", "--to", messy.destination],
    ];
    for (const args of cases) {
      const horizon = unreachableHorizon();
      const r = await cli(args, horizon.serve);
      expect(r.code, args.join(" ")).toBe(2);
      expect(r.err).toMatch(/INVALID_ADDRESS/);
      expect(horizon.requests, args.join(" ")).toEqual([]);
    }
  });

  it("still plans normally on a testnet Horizon", async () => {
    const r = await cli(
      ["plan", messy.fixture, "--to", messy.destination, "--sponsor", Keypair.random().publicKey()],
      recordedFetch(recorded).fetch,
    );
    expect(r.code).toBe(0);
    expect(r.out).toContain("CLOSABLE");
  });
});
