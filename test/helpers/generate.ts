import { Keypair } from "@stellar/stellar-sdk";
import { formatStroops } from "../../src/amounts.js";
import type { ExistingAccountSnapshot, TrustlineInfo } from "../../src/inspect/snapshot.js";

/** Small deterministic PRNG (mulberry32) so property tests are reproducible without a dependency. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const keys = Array.from({ length: 8 }, () => Keypair.random().publicKey());

/** A random but internally consistent snapshot for the planner's invariants. */
export function randomSnapshot(
  seed: number,
  sizes?: { offers?: number; trustlines?: number },
): ExistingAccountSnapshot {
  const r = rng(seed);
  const pick = <T>(xs: T[]) => xs[Math.floor(r() * xs.length)]!;
  const account = keys[0]!;
  const issuer = pick(keys.slice(1, 4));
  const destination = keys[4]!;
  const nTrust = sizes?.trustlines ?? Math.floor(r() * 12);
  const trustlines: TrustlineInfo[] = Array.from({ length: nTrust }, (_, i) => {
    const authorized = r() > 0.1;
    return {
      asset: { type: "credit_alphanum12", code: `A${String(i).padStart(3, "0")}`, issuer },
      balance: r() > 0.3 ? formatStroops(BigInt(1 + Math.floor(r() * 1000))) : "0.0000000",
      limit: "922337203685.4775807",
      buyingLiabilities: "0.0000000",
      sellingLiabilities: "0.0000000",
      authorized,
      authorizedToMaintainLiabilities: authorized || r() > 0.5,
      clawbackEnabled: r() > 0.8,
      sponsor: r() > 0.8 ? keys[5]! : null,
      lastModifiedLedger: 1,
    };
  });
  const nOffers = sizes?.offers ?? Math.floor(r() * 8);
  const offers = Array.from({ length: nOffers }, (_, i) => ({
    id: String(1000 + i),
    selling: trustlines.length ? pick(trustlines).asset : ({ type: "native" } as const),
    buying: { type: "native" as const },
    amount: "0.0000001",
    price: { n: 1000, d: 1 },
    sponsor: null,
    lastModifiedLedger: 1,
  }));
  const data = Array.from({ length: Math.floor(r() * 4) }, (_, i) => ({
    name: `k${i}`,
    valueBase64: "MQ==",
  }));
  const subentryCount = trustlines.length + offers.length + data.length;
  return {
    schemaVersion: 1,
    account,
    exists: true,
    observed: {
      ledger: 5_000_000,
      closedAt: "2026-09-26T00:00:00Z",
      source: "https://horizon-testnet.stellar.org",
    },
    feeStats: { lastLedgerBaseFee: 100, feeChargedP80: Math.floor(r() * 200_000) },
    destination: {
      account: destination,
      baseAccount: destination,
      exists: true,
      memoRequired: false,
      trustlines: trustlines
        .filter(() => r() > 0.7)
        .map((t) => ({
          asset: t.asset,
          balance: "0.0000000",
          limit: "1000.0000000",
          buyingLiabilities: "0.0000000",
          authorized: true,
        })),
    },
    snapshotHash: "x".repeat(64),
    sequence: ((5_000_000n - 10n) << 32n).toString(),
    sequenceLedger: null,
    subentryCount,
    numSponsoring: 0,
    numSponsored: trustlines.filter((t) => t.sponsor).length,
    sponsor: null,
    thresholds: { low: 0, medium: 0, high: 0 },
    masterWeight: 1,
    signers: [{ key: account, weight: 1, type: "ed25519_public_key", sponsor: null }],
    flags: {
      authRequired: false,
      authRevocable: false,
      authImmutable: false,
      authClawbackEnabled: false,
    },
    native: {
      balance: "10.0000000",
      buyingLiabilities: "0.0000000",
      sellingLiabilities: "0.0000000",
    },
    reserve: { baseReserve: "0.5000000", minimum: "5.0000000", spendable: "5.0000000" },
    trustlines,
    poolShares: [],
    offers,
    data,
    claimableBalancesSponsored: null,
    issuers: [{ account: issuer, exists: r() > 0.2, memoRequired: false }],
    quotes: trustlines.map((t) => ({
      asset: t.asset,
      quote:
        t.authorized && t.balance !== "0.0000000" && r() > 0.6
          ? { sourceAmount: t.balance, destinationAmount: "0.0000003", path: [] }
          : null,
    })),
  };
}
