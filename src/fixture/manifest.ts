import { readFileSync } from "node:fs";
import { DustinError } from "../errors/dustin-error.js";
import type {
  EdgeAccountRole,
  EdgeExpectation,
  EdgeIssuerRole,
  EdgeKeyRole,
  EdgeVariantName,
  EdgeVariantRole,
} from "./edge.js";
import type { VerifyResult } from "./verify.js";
import type { ExpectedRung, MessyRole } from "./messy.js";

/**
 * The public description of a fixture: public keys, assets, offers, expected values and the
 * construction transactions. It never contains a secret; secrets go to a separate keys file.
 */
export interface FixtureManifest {
  schemaVersion: 1;
  kind: "dustin-fixture";
  profile: "messy";
  id: string;
  createdAt: string;
  network: { passphrase: string; horizonUrl: string; explorerBaseUrl: string };
  createdAtLedger: number;
  recipeHash: string;
  accounts: Record<MessyRole, string>;
  assets: Array<{
    code: string;
    issuer: string;
    dust: string;
    expectedRung: ExpectedRung;
    sponsored: boolean;
    destinationTrusts: boolean;
  }>;
  offers: Array<{ id: string; selling: string; buying: string; amount: string; price: string }>;
  dataEntries: string[];
  expected: {
    subentryCount: number;
    numSponsored: number;
    baseReserve: string;
    balance: string;
    minimumBalance: string;
    spendable: string;
  };
  transactions: Array<{
    step: string;
    hash: string;
    innerHash?: string;
    ledger: number;
    feeBumped: boolean;
    explorerUrl: string;
  }>;
  /** An unbumped transaction from the fixture, rejected because it cannot pay its own fee. */
  zeroSpendableProof: { resultCode: string; sequenceUnchanged: boolean };
  /** The strict-send quote for the liquid asset observed before the build finished. */
  liquidPath: { asset: string; sourceAmount: string; destinationAmount: string; path: string[] };
  verification: VerifyResult;
}

export interface FixtureKeys {
  schemaVersion: 1;
  kind: "dustin-fixture-keys";
  id: string;
  note: string;
  secrets: Record<MessyRole, string>;
}

/** One account of the `edge` profile and what the planner is expected to make of it. */
export interface EdgeManifestVariant {
  name: EdgeVariantName;
  role: EdgeVariantRole;
  account: string;
  /** D3 matrix rows (docs/edge-cases-and-test-matrix.md section 4). */
  rows: string[];
  summary: string;
  expected: EdgeExpectation;
  /** The account's XLM position when the build finished. */
  balance: string;
  minimumBalance: string;
  spendable: string;
}

/**
 * The public description of an `edge` fixture: public keys, assets, the pool, one entry per
 * variant with its expected plan, and the construction transactions. No secret; secrets go to a
 * separate keys file.
 */
export interface EdgeFixtureManifest {
  schemaVersion: 1;
  kind: "dustin-fixture";
  profile: "edge";
  id: string;
  createdAt: string;
  network: { passphrase: string; horizonUrl: string; explorerBaseUrl: string };
  createdAtLedger: number;
  recipeHash: string;
  accounts: Record<EdgeAccountRole, string>;
  /** The multisig variant's second signer: a key only, never funded. */
  multisigSigner: string;
  issuerFlags: Record<EdgeIssuerRole, string[]>;
  assets: Array<{ code: string; issuer: string; issuerRole: EdgeIssuerRole }>;
  pool: { id: string; assets: [string, string]; shares: string };
  variants: EdgeManifestVariant[];
  transactions: FixtureManifest["transactions"];
  verification: VerifyResult;
}

export interface EdgeFixtureKeys {
  schemaVersion: 1;
  kind: "dustin-fixture-keys";
  id: string;
  note: string;
  secrets: Record<EdgeKeyRole, string>;
}

function parseManifest(path: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (cause) {
    throw new DustinError("MANIFEST_INVALID", `Cannot read the fixture manifest ${path}.`, {
      stage: "config",
      cause,
    });
  }
  return (parsed ?? {}) as Record<string, unknown>;
}

function notAManifest(path: string): DustinError {
  return new DustinError("MANIFEST_INVALID", `${path} is not a Dustin fixture manifest.`, {
    stage: "config",
    remedy: "Pass the manifest.json written by `dustin fixture create`.",
  });
}

export function readManifest(path: string): FixtureManifest {
  const m = parseManifest(path) as Partial<FixtureManifest>;
  if (m.kind !== "dustin-fixture" || m.schemaVersion !== 1 || !m.accounts?.fixture) {
    throw notAManifest(path);
  }
  return m as FixtureManifest;
}

/** A manifest of either profile: `messy` (the metric account) or `edge` (the matrix variants). */
export function readAnyManifest(path: string): FixtureManifest | EdgeFixtureManifest {
  const m = parseManifest(path) as Partial<EdgeFixtureManifest>;
  if (m.kind === "dustin-fixture" && m.schemaVersion === 1 && m.profile === "edge") {
    if (!m.accounts?.destination || !Array.isArray(m.variants) || !m.pool?.id) {
      throw notAManifest(path);
    }
    return m as EdgeFixtureManifest;
  }
  return readManifest(path);
}
