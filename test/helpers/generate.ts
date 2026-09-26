import { Keypair } from "@stellar/stellar-sdk";
import { formatStroops } from "../../src/amounts.js";
import {
  assetKey,
  type AssetRef,
  type ExistingAccountSnapshot,
  type TrustlineInfo,
} from "../../src/inspect/snapshot.js";

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

/** Fixed test keys derived from constant seeds, so a seed reproduces the same snapshot anywhere. */
const keys = Array.from({ length: 8 }, (_, i) =>
  Keypair.fromRawEd25519Seed(Buffer.alloc(32, i + 1)).publicKey(),
);

export const LEDGER = 5_000_000;

export interface GenerateOptions {
  offers?: number;
  trustlines?: number;
  /**
   * Also generate what makes a plan partial or blocked: raised thresholds, a disabled master key,
   * AUTH_IMMUTABLE, sponsoring, a missing, self or memo-required destination, a sequence number
   * ahead of the ledger, pool shares, memo-required issuers, offers between two credit assets,
   * quotes through the account's own offers (B-24) and destination trustlines without room.
   */
  variety?: boolean;
}

/** A random but internally consistent snapshot for the planner's invariants. */
export function randomSnapshot(
  seed: number,
  options: GenerateOptions = {},
): ExistingAccountSnapshot {
  const r = rng(seed);
  const v = options.variety === true;
  const chance = (p: number) => v && r() < p;
  const pick = <T>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)]!;
  const account = keys[0]!;
  const issuer = pick(keys.slice(1, 4));
  const destination = keys[4]!;

  const nTrust = options.trustlines ?? Math.floor(r() * 12);
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
  const credit = trustlines.map((t) => t.asset);
  const anyAsset = (): AssetRef => (credit.length && r() > 0.3 ? pick(credit) : { type: "native" });

  const nOffers =
    options.offers ?? (chance(0.05) ? 60 + Math.floor(r() * 100) : Math.floor(r() * 8));
  const offers = Array.from({ length: nOffers }, (_, i) => {
    let selling: AssetRef = credit.length ? pick(credit) : { type: "native" };
    let buying: AssetRef = { type: "native" };
    if (v) {
      // Any pair of distinct assets, including native-for-credit offers that a quote may cross (B-24).
      selling = anyAsset();
      buying = anyAsset();
      if (assetKey(selling) === assetKey(buying))
        buying = selling.type === "native" && credit.length ? pick(credit) : { type: "native" };
    }
    return {
      id: String(1000 + i),
      selling,
      buying,
      amount: "0.0000001",
      price: { n: 1000, d: 1 },
      sponsor: null,
      lastModifiedLedger: 1,
    };
  });
  const data = Array.from({ length: Math.floor(r() * 4) }, (_, i) => ({
    name: `k${i}`,
    valueBase64: "MQ==",
  }));

  // Signing: the master key alone, unless raised thresholds or a zero master weight are drawn.
  const masterWeight = chance(0.08) ? 0 : chance(0.1) ? 2 : 1;
  const raised = chance(0.15);
  const thresholds = raised
    ? { low: Math.floor(r() * 3), medium: Math.floor(r() * 3), high: Math.floor(r() * 4) }
    : { low: 0, medium: 0, high: 0 };

  // The merge guard: a sequence number from the current ledger (passes) up to far ahead (blocks).
  const ahead = v ? pick([0, 0, 0, 0, 0, 0, 1, 2, 500]) : -10;
  const sequence = ((BigInt(LEDGER) + BigInt(ahead)) << 32n) + BigInt(Math.floor(r() * 5));

  const destinationKind = v
    ? pick(["ok", "ok", "ok", "ok", "ok", "ok", "missing", "self", "memo"])
    : "ok";
  const destinationAccount = destinationKind === "self" ? account : destination;
  const destinationExists = destinationKind !== "missing";

  // A pool-share trustline needs trustlines for the pool's non-native assets, so a pool is drawn
  // only when the account holds one: XLM paired with one of its assets.
  const poolShares =
    credit.length > 0 && chance(0.1)
      ? [
          {
            poolId: "ab".repeat(32),
            balance: r() > 0.5 ? "1.0000000" : "0.0000000",
            sponsor: r() > 0.7 ? keys[5]! : null,
            assets: r() > 0.2 ? ["native", assetKey(pick(credit))] : null,
          },
        ]
      : [];
  const numSponsoring = chance(0.05) ? 1 + Math.floor(r() * 3) : 0;
  const subentryCount = trustlines.length + offers.length + data.length + 2 * poolShares.length;

  return {
    schemaVersion: 1,
    account,
    exists: true,
    observed: {
      ledger: LEDGER,
      closedAt: "2026-09-26T00:00:00Z",
      source: "https://horizon-testnet.stellar.org",
    },
    feeStats: { lastLedgerBaseFee: 100, feeChargedP80: Math.floor(r() * 200_000) },
    destination: {
      account: destinationAccount,
      baseAccount: destinationAccount,
      exists: destinationExists,
      memoRequired: destinationKind === "memo",
      trustlines: destinationExists
        ? trustlines
            .filter(() => r() > 0.7)
            .map((t) => ({
              asset: t.asset,
              balance: "0.0000000",
              // Without variety every destination line has room for any generated balance.
              limit: chance(0.3) ? "0.0000001" : "1000.0000000",
              buyingLiabilities: "0.0000000",
              authorized: !chance(0.2),
            }))
        : [],
    },
    snapshotHash: "x".repeat(64),
    sequence: sequence.toString(),
    sequenceLedger: null,
    subentryCount,
    numSponsoring,
    numSponsored: trustlines.filter((t) => t.sponsor).length,
    sponsor: null,
    thresholds,
    masterWeight,
    signers: [{ key: account, weight: masterWeight, type: "ed25519_public_key", sponsor: null }],
    flags: {
      authRequired: false,
      authRevocable: false,
      authImmutable: chance(0.05),
      authClawbackEnabled: false,
    },
    native: {
      balance: "10.0000000",
      buyingLiabilities: "0.0000000",
      sellingLiabilities: "0.0000000",
    },
    reserve: { baseReserve: "0.5000000", minimum: "5.0000000", spendable: "5.0000000" },
    trustlines,
    poolShares,
    offers,
    data,
    claimableBalancesSponsored: numSponsoring > 0 ? Math.floor(r() * 2) : null,
    issuers: [{ account: issuer, exists: r() > 0.2, memoRequired: chance(0.1) }],
    quotes: trustlines.map((t) => ({
      asset: t.asset,
      quote:
        t.authorized && t.balance !== "0.0000000" && r() > 0.4
          ? {
              sourceAmount: t.balance,
              destinationAmount: "0.0000003",
              path: chance(0.3) ? [pick(credit)] : [],
            }
          : null,
    })),
  };
}
