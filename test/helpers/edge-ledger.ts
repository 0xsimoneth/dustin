import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { EdgeRoles, EdgeVariantRole } from "../../src/fixture/edge.js";
import type { EdgeFixtureManifest } from "../../src/fixture/manifest.js";
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
