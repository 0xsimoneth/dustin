import { readFileSync } from "node:fs";
import { DustinError } from "../errors/dustin-error.js";
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

export function readManifest(path: string): FixtureManifest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (cause) {
    throw new DustinError("MANIFEST_INVALID", `Cannot read the fixture manifest ${path}.`, {
      stage: "config",
      cause,
    });
  }
  const m = parsed as Partial<FixtureManifest>;
  if (m.kind !== "dustin-fixture" || m.schemaVersion !== 1 || !m.accounts?.fixture) {
    throw new DustinError("MANIFEST_INVALID", `${path} is not a Dustin fixture manifest.`, {
      stage: "config",
      remedy: "Pass the manifest.json written by `dustin fixture create`.",
    });
  }
  return m as FixtureManifest;
}
