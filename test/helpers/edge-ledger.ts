import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { FeeBumpTransaction, Keypair, TransactionBuilder } from "@stellar/stellar-sdk";
import { TESTNET_PASSPHRASE } from "../../src/config/network.js";
import { edgePool, type EdgeRoles, type EdgeVariantRole } from "../../src/fixture/edge.js";
import type { EdgeFixtureKeys, EdgeFixtureManifest } from "../../src/fixture/manifest.js";
import type { HorizonAccount, HorizonOffer } from "../../src/inspect/horizon-types.js";
import { horizonJson } from "../../src/reader/horizon-json.js";
import { horizonReader, type LedgerReader } from "../../src/reader/ledger-reader.js";
import { FakeLedger, type FakeLiquidityPool } from "./fake-ledger.js";
import { TESTNET_HORIZON, loadRecorded, recordedFetch } from "./recorded-horizon.js";

/**
 * The `edge` fixture recorded on testnet right after a live build (`dustin fixture create
 * --profile edge`, 2026-09-28), before any account was touched: public Horizon JSON only.
 */
export const EDGE_DIR = "test/fixtures/horizon/edge";

export function edgeManifest(): EdgeFixtureManifest {
  return JSON.parse(readFileSync(join(EDGE_DIR, "manifest.json"), "utf8")) as EdgeFixtureManifest;
}

/** The fixture's public keys by role, as the recipe functions take them. */
export function edgeRoles(manifest = edgeManifest()): EdgeRoles {
  return { ...manifest.accounts, multisigSigner: manifest.multisigSigner };
}

/** A read-only reader over the recorded responses (404 for anything not recorded). */
export function edgeRecordedReader(overrides: Record<string, unknown> = {}): {
  reader: LedgerReader;
  requests: Array<{ method: string; path: string }>;
} {
  const { fetch, requests } = recordedFetch(loadRecorded(EDGE_DIR), overrides);
  return { reader: horizonReader(horizonJson(TESTNET_HORIZON, { fetch, retries: 0 })), requests };
}

/**
 * The recorded edge fixture on the fake ledger (test/helpers/fake-ledger.ts): every recorded
 * account, the auth-maintain offer and the LPA/LPB pool, at the recorded ledger. The fee sponsor
 * is the recorded one, with its real balance.
 */
export function edgeLedger(): { ledger: FakeLedger; manifest: EdgeFixtureManifest } {
  const recorded = loadRecorded(EDGE_DIR);
  const manifest = edgeManifest();
  const page = recorded.get("/ledgers?order=desc&limit=1") as {
    _embedded: { records: Array<{ sequence: number }> };
  };
  const ledger = new FakeLedger(page._embedded.records[0]!.sequence);
  for (const [path, body] of recorded) {
    const account = /^\/accounts\/(G[A-Z2-7]{55})$/.exec(path);
    if (account) ledger.accounts.set(account[1]!, structuredClone(body) as HorizonAccount);
    const offers = /^\/accounts\/(G[A-Z2-7]{55})\/offers/.exec(path);
    if (offers) {
      const page = body as { _embedded: { records: HorizonOffer[] } };
      ledger.offers.set(offers[1]!, structuredClone(page._embedded.records));
    }
    const pool = /^\/liquidity_pools\/([0-9a-f]{64})$/.exec(path);
    if (pool) ledger.liquidityPools.set(pool[1]!, structuredClone(body) as FakeLiquidityPool);
  }
  return { ledger, manifest };
}

/** A variant's account on the fake ledger (throws if it is gone). */
export function edgeAccount(
  ledger: FakeLedger,
  manifest: EdgeFixtureManifest,
  role: EdgeVariantRole,
) {
  const account = ledger.accounts.get(manifest.accounts[role]);
  if (!account) throw new Error(`fake ledger: no ${role} account`);
  return account;
}

/** One POST /transactions a build made: its count (from 1) and the inner transaction's source. */
export interface EdgeBuildSubmission {
  n: number;
  source: string;
  sequence: string;
}

const json = (status: number, body: unknown) =>
  Promise.resolve(new Response(JSON.stringify(body), { status }));

/**
 * A fake testnet Horizon and Friendbot for `buildEdgeFixture`: the recorded edge fixture re-keyed
 * to the keys the build creates (every role, the multisig signer and the pool id), so every read
 * is answered as right after the live build and every step settles at once. Every submission is
 * answered as applied, unless `onSubmit` answers it; `onGet` may answer any read first. The keys
 * come from `onKeys` (pass it to the build) or, for a build run through the CLI, from the keys
 * file the CLI writes under `keysDir`. Any URL outside Horizon is Friendbot, which funds.
 */
export function rekeyedEdgeHorizon(
  options: {
    keysDir?: string;
    onGet?: (path: string, recorded: (path: string) => unknown) => Promise<Response> | undefined;
    onSubmit?: (submission: EdgeBuildSubmission) => Promise<Response> | undefined;
  } = {},
) {
  const manifest = edgeManifest();
  const oldRoles = edgeRoles(manifest);
  const recorded = loadRecorded(EDGE_DIR);
  let world: Map<string, unknown> | null = null;
  let roles: EdgeRoles | null = null;
  const submissions: EdgeBuildSubmission[] = [];
  const requests: Array<{ method: string; path: string }> = [];

  const onKeys = (keys: EdgeFixtureKeys) => {
    const fresh = Object.fromEntries(
      Object.entries(keys.secrets).map(([role, secret]) => [
        role,
        Keypair.fromSecret(secret).publicKey(),
      ]),
    ) as EdgeRoles;
    const pairs: Array<[string, string]> = Object.entries(oldRoles).map(([role, key]) => [
      key,
      fresh[role as keyof EdgeRoles],
    ]);
    pairs.push([manifest.pool.id, edgePool(fresh).id]);
    const rekey = (text: string) => pairs.reduce((t, [from, to]) => t.replaceAll(from, to), text);
    world = new Map(
      [...recorded].map(([path, body]) => [rekey(path), JSON.parse(rekey(JSON.stringify(body)))]),
    );
    roles = fresh;
  };
  const current = (): Map<string, unknown> => {
    if (!world && options.keysDir) {
      for (const id of readdirSync(options.keysDir)) {
        const file = join(options.keysDir, id, "keys.json");
        if (existsSync(file)) onKeys(JSON.parse(readFileSync(file, "utf8")) as EdgeFixtureKeys);
      }
    }
    if (!world) throw new Error("rekeyed edge Horizon: read before the build handed its keys over");
    return world;
  };

  const fetch = async (url: string, init?: RequestInit): Promise<Response> => {
    const method = init?.method ?? "GET";
    if (!url.startsWith(TESTNET_HORIZON)) return json(200, { hash: "friendbot" });
    const path = url.slice(TESTNET_HORIZON.length);
    requests.push({ method, path });
    if (method === "GET") {
      const answer = options.onGet?.(path, (p) => current().get(p));
      if (answer) return answer;
    }
    if (path === "/") return json(200, { network_passphrase: TESTNET_PASSPHRASE });
    if (method === "POST" && path === "/transactions") {
      const body = typeof init?.body === "string" ? init.body : "";
      const xdr = decodeURIComponent(body.replace(/^tx=/, ""));
      const envelope = TransactionBuilder.fromXDR(xdr, TESTNET_PASSPHRASE);
      const inner = envelope instanceof FeeBumpTransaction ? envelope.innerTransaction : envelope;
      const submission = {
        n: submissions.length + 1,
        source: inner.source,
        sequence: inner.sequence,
      };
      submissions.push(submission);
      const answer = options.onSubmit?.(submission);
      if (answer) return answer;
      return json(200, {
        successful: true,
        ledger: 4_913_200 + submission.n,
        fee_charged: "200",
        result_xdr: "",
      });
    }
    // Every submission is answered above, so none is ever found by hash.
    if (path.startsWith("/transactions/")) return json(404, { status: 404 });
    const body = current().get(path);
    return body === undefined ? json(404, { status: 404 }) : json(200, body);
  };
  return {
    fetch,
    onKeys,
    submissions,
    requests,
    /** The build's public keys by role, once it handed its keys over. */
    roles: (): EdgeRoles => {
      current();
      return roles!;
    },
  };
}

/** An answer of Horizon's that is not a result: a 503, retried by the read client and then given up. */
export function unavailableAnswer(): Promise<Response> {
  return json(503, { status: 503, title: "Service Unavailable" });
}

/** Horizon's answer to a transaction refused for its sequence number (a fee bump's inner one). */
export function badSequenceAnswer(): Promise<Response> {
  return json(400, {
    extras: {
      result_codes: { transaction: "tx_fee_bump_inner_failed", inner_transaction: "tx_bad_seq" },
    },
  });
}
