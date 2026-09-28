import { readFileSync } from "node:fs";
import { StrKey } from "@stellar/stellar-sdk";
import { DustinError } from "../errors/dustin-error.js";
import {
  EDGE,
  EDGE_HELPER_ROLES,
  type EdgeAccountRole,
  type EdgeExpectation,
  type EdgeIssuerRole,
  type EdgeKeyRole,
  type EdgeVariantName,
  type EdgeVariantRole,
} from "./edge.js";
import type { VerifyResult } from "./verify.js";
import { MESSY_ROLES, type ExpectedRung, type MessyRole } from "./messy.js";

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
  /**
   * The account's XLM position when the build finished; absent when Horizon could not be read
   * after the last build transaction (the manifest's verification then says why; closing review
   * CP-9).
   */
  balance?: string;
  minimumBalance?: string;
  spendable?: string;
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
  /**
   * The helpers and the variants in `variants`; a manifest written before a variant was added to
   * the recipe (E4-S3) has no key for it.
   */
  accounts: Record<EdgeAccountRole, string>;
  /** The multisig variant's second signer: a key only, never funded. */
  multisigSigner: string;
  issuerFlags: Record<EdgeIssuerRole, string[]>;
  assets: Array<{ code: string; issuer: string; issuerRole: EdgeIssuerRole }>;
  /** `shares` (held by the pool-share variant) is absent when Horizon could not be read (CP-9). */
  pool: { id: string; assets: [string, string]; shares?: string };
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

const isPublicKey = (value: unknown): boolean =>
  typeof value === "string" && StrKey.isValidEd25519PublicKey(value);

/** Every role holds a G... public key, so no read goes to `/accounts/undefined`. */
function allPublicKeys(accounts: unknown, roles: readonly string[]): boolean {
  const record = (accounts ?? {}) as Record<string, unknown>;
  return typeof accounts === "object" && roles.every((role) => isPublicKey(record[role]));
}

/** The network the manifest was built on; `fixture verify` checks it is the testnet. */
const hasPassphrase = (network: { passphrase?: unknown } | undefined): boolean =>
  typeof network?.passphrase === "string" && network.passphrase.length > 0;

/**
 * A manifest that is truncated or edited by hand is refused here with MANIFEST_INVALID, before
 * anything reads Horizon: a missing role would become a read of `/accounts/undefined`, answered
 * with HTTP 400 and reported as HORIZON_UNAVAILABLE, and a missing network a TypeError (closing
 * review CP-14).
 */
export function readManifest(path: string): FixtureManifest {
  const m = parseManifest(path) as Partial<FixtureManifest>;
  if (
    m.kind !== "dustin-fixture" ||
    m.schemaVersion !== 1 ||
    !allPublicKeys(m.accounts, MESSY_ROLES) ||
    !hasPassphrase(m.network)
  ) {
    throw notAManifest(path);
  }
  return m as FixtureManifest;
}

/** A manifest of either profile: `messy` (the metric account) or `edge` (the matrix variants). */
export function readAnyManifest(path: string): FixtureManifest | EdgeFixtureManifest {
  const m = parseManifest(path) as Partial<EdgeFixtureManifest>;
  if (m.kind === "dustin-fixture" && m.schemaVersion === 1 && m.profile === "edge") {
    // Every account role and the multisig signer are public keys, the network is named and the
    // pool id is Horizon's 64 lowercase hex digits (closing review CP-14). The variant roles are
    // those the manifest lists: a fixture built before a variant was added has no account for it
    // (E4-S3), and every listed variant must be one the recipe knows.
    const listed = Array.isArray(m.variants) ? m.variants.map((v) => v?.role) : null;
    if (
      !listed ||
      !listed.every((role) => EDGE.variants.some((v) => v.role === role)) ||
      !allPublicKeys(m.accounts, [...EDGE_HELPER_ROLES, ...listed]) ||
      !isPublicKey(m.multisigSigner) ||
      !hasPassphrase(m.network) ||
      typeof m.pool?.id !== "string" ||
      !/^[0-9a-f]{64}$/.test(m.pool.id) ||
      !Array.isArray(m.variants)
    ) {
      throw notAManifest(path);
    }
    return m as EdgeFixtureManifest;
  }
  return readManifest(path);
}
