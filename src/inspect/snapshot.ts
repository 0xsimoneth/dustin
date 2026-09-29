import type { CreditAssetRef } from "../reader/ledger-reader.js";

export type { CreditAssetRef } from "../reader/ledger-reader.js";

export type AssetRef = { type: "native" } | CreditAssetRef;

/** "native" or "CODE:ISSUER". */
export function assetKey(asset: AssetRef): string {
  return asset.type === "native" ? "native" : `${asset.code}:${asset.issuer}`;
}

/** Amounts are 7-decimal strings, exact to the stroop. */
export interface TrustlineInfo {
  asset: CreditAssetRef;
  balance: string;
  limit: string;
  buyingLiabilities: string;
  sellingLiabilities: string;
  authorized: boolean;
  authorizedToMaintainLiabilities: boolean;
  clawbackEnabled: boolean;
  /** Reserve sponsor of this trustline, or null when the account pays its own reserve. */
  sponsor: string | null;
  lastModifiedLedger: number | null;
}

export interface PoolShareInfo {
  poolId: string;
  balance: string;
  sponsor: string | null;
  /** The pool's two assets ("native" or "CODE:ISSUER"); null if Horizon did not return the pool. */
  assets: string[] | null;
}

export interface OfferInfo {
  id: string;
  selling: AssetRef;
  buying: AssetRef;
  amount: string;
  price: { n: number; d: number };
  sponsor: string | null;
  lastModifiedLedger: number | null;
}

export interface DataEntryInfo {
  name: string;
  valueBase64: string;
}

export interface SignerInfo {
  key: string;
  weight: number;
  type: string;
  sponsor: string | null;
}

export interface IssuerInfo {
  account: string;
  exists: boolean;
  /** SEP-29 `config.memo_required`: the SDK refuses a memo-less payment to it. */
  memoRequired: boolean;
}

export interface DestinationInfo {
  /** As given: G... or M... */
  account: string;
  /** The G... account behind a muxed address (equal to `account` for G...). */
  baseAccount: string;
  exists: boolean;
  memoRequired: boolean;
  trustlines: Array<{
    asset: CreditAssetRef;
    balance: string;
    limit: string;
    buyingLiabilities: string;
    authorized: boolean;
  }>;
}

/** A claimable balance that names the account as a claimant (matrix row X-03). */
export interface ClaimableBalanceInfo {
  /** Horizon's balance id (hex). */
  id: string;
  /** "native" or "CODE:ISSUER", as Horizon lists it. */
  asset: string;
  /** 7-decimal string, exact to the stroop. */
  amount: string;
  /** The account that pays the balance's reserve, or null when Horizon names none. */
  sponsor: string | null;
}

export interface Quote {
  sourceAmount: string;
  destinationAmount: string;
  path: AssetRef[];
}

interface SnapshotBase {
  schemaVersion: 1;
  account: string;
  observed: { ledger: number; closedAt: string; source: string };
  feeStats: { lastLedgerBaseFee: number; feeChargedP80: number };
  destination: DestinationInfo | null;
  /**
   * sha256 of the canonical account-state fields (not quotes, the claimable balances that name the
   * account as a claimant, fees or the observation ledger).
   */
  snapshotHash: string;
}

export interface MissingAccountSnapshot extends SnapshotBase {
  exists: false;
}

export interface ExistingAccountSnapshot extends SnapshotBase {
  exists: true;
  sequence: string;
  sequenceLedger: number | null;
  subentryCount: number;
  numSponsoring: number;
  numSponsored: number;
  /** Sponsor of the account entry itself. */
  sponsor: string | null;
  thresholds: { low: number; medium: number; high: number };
  masterWeight: number;
  signers: SignerInfo[];
  flags: {
    authRequired: boolean;
    authRevocable: boolean;
    authImmutable: boolean;
    authClawbackEnabled: boolean;
  };
  native: { balance: string; buyingLiabilities: string; sellingLiabilities: string };
  reserve: { baseReserve: string; minimum: string; spendable: string };
  trustlines: TrustlineInfo[];
  poolShares: PoolShareInfo[];
  offers: OfferInfo[];
  data: DataEntryInfo[];
  /** Claimable balances this account sponsors; null when `numSponsoring` is 0 and nothing was asked. */
  claimableBalancesSponsored: number | null;
  issuers: IssuerInfo[];
  /**
   * Best strict-send quote to XLM for each trustline's full balance, one below 1 stroop included
   * (the ladder rules it out); null when Horizon found no path or none was asked.
   */
  quotes: Array<{ asset: CreditAssetRef; quote: Quote | null }>;
  /**
   * Claimable balances that name this account as a claimant, sorted by id (matrix row X-03). They
   * are not the account's entries: the merge leaves them on the ledger, so they change no step and
   * are not in `snapshotHash`. Absent when nothing was read (a custom `LedgerReader` without
   * `claimableBalancesClaimableBy`, or a snapshot built by hand); null when the read failed, which
   * only costs the warning, never the inspection. Horizon's reader lists at most
   * `CLAIMANT_READ_LIMIT` (2000, ten pages of 200): a list that long may be incomplete (Epic 4
   * review EP-4, AC-16).
   */
  claimableBalancesClaimable?: ClaimableBalanceInfo[] | null;
}

export type AccountSnapshot = ExistingAccountSnapshot | MissingAccountSnapshot;
