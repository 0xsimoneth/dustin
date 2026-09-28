import { formatStroops, toStroops } from "../amounts.js";
import { canonicalJson, sha256Hex } from "../canonical-json.js";
import { assertTestnetPassphrase, resolveConfig, type DustinConfig } from "../config/network.js";
import { horizonJson } from "../reader/horizon-json.js";
import { horizonReader, type CreditAssetRef, type LedgerReader } from "../reader/ledger-reader.js";
import { assertAccountAddress, destinationBaseAccount } from "./address.js";
import type { HorizonAccount, HorizonAssetRef, HorizonBalance } from "./horizon-types.js";
import { reserveFromHorizon } from "./reserve.js";
import type {
  AccountSnapshot,
  AssetRef,
  DestinationInfo,
  ExistingAccountSnapshot,
  IssuerInfo,
  Quote,
  TrustlineInfo,
} from "./snapshot.js";

export interface InspectOptions {
  /** Merge destination (G... or M...); needed for the destination checks and rung 3. */
  destination?: string;
  config?: DustinConfig;
  /** Custom ledger reader (tests, other Horizon clients). Defaults to Horizon from `config`. */
  reader?: LedgerReader;
}

const ZERO = "0.0000000";
const amount = (value: string | undefined) => formatStroops(toStroops(value ?? ZERO));
const isCredit = (b: HorizonBalance) =>
  b.asset_type === "credit_alphanum4" || b.asset_type === "credit_alphanum12";

function creditAsset(b: {
  asset_type: string;
  asset_code?: string;
  asset_issuer?: string;
}): CreditAssetRef {
  return {
    type: b.asset_type as CreditAssetRef["type"],
    code: b.asset_code ?? "",
    issuer: b.asset_issuer ?? "",
  };
}

function assetRef(a: HorizonAssetRef): AssetRef {
  return a.asset_type === "native" ? { type: "native" } : creditAsset(a);
}

/** SEP-29: data entry `config.memo_required` = "1" (base64 "MQ=="). */
function memoRequired(account: HorizonAccount | null): boolean {
  const value = account?.data["config.memo_required"];
  return value !== undefined && Buffer.from(value, "base64").toString("utf8") === "1";
}

/** Code-point order, the same in every locale, so step ids and plan hashes are stable. */
const byCodePoint = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const byAsset = (a: { asset: CreditAssetRef }, b: { asset: CreditAssetRef }) =>
  a.asset.code === b.asset.code
    ? byCodePoint(a.asset.issuer, b.asset.issuer)
    : byCodePoint(a.asset.code, b.asset.code);

/**
 * Reads everything on an account that affects closing it. GET requests only; no secret, no
 * signing, no submission (docs/architecture.md section 6.3). Ordering is stable: trustlines by
 * asset code then issuer, offers by id, data entries by name (rule R9).
 */
export async function inspectAccount(
  account: string,
  options: InspectOptions = {},
): Promise<AccountSnapshot> {
  assertAccountAddress(account);
  const destinationBase = options.destination ? destinationBaseAccount(options.destination) : null;
  const reader =
    options.reader ?? horizonReader(horizonJson(resolveConfig(options.config).horizonUrl));
  assertTestnetPassphrase(await reader.networkPassphrase());

  const [ledger, feeStats, raw, destinationRaw] = await Promise.all([
    reader.latestLedger(),
    reader.feeStats(),
    reader.account(account),
    destinationBase ? reader.account(destinationBase) : Promise.resolve(null),
  ]);
  const destination: DestinationInfo | null =
    options.destination && destinationBase
      ? {
          account: options.destination,
          baseAccount: destinationBase,
          exists: destinationRaw !== null,
          // SEP-29 does not apply to muxed destinations: the muxed id identifies the recipient.
          memoRequired:
            options.destination === destinationBase ? memoRequired(destinationRaw) : false,
          trustlines: (destinationRaw?.balances ?? [])
            .filter(isCredit)
            .map((b) => ({
              asset: creditAsset(b),
              balance: amount(b.balance),
              limit: amount(b.limit),
              buyingLiabilities: amount(b.buying_liabilities),
              authorized: b.is_authorized === true,
            }))
            .sort(byAsset),
        }
      : null;
  const observed = { ledger: ledger.sequence, closedAt: ledger.closed_at, source: reader.source };
  const fees = {
    lastLedgerBaseFee: Number.parseInt(feeStats.last_ledger_base_fee, 10) || 0,
    feeChargedP80: Number.parseInt(feeStats.fee_charged.p80 ?? "0", 10) || 0,
  };

  if (!raw) {
    const state = { schemaVersion: 1 as const, account, exists: false as const, destination };
    return { ...state, observed, feeStats: fees, snapshotHash: sha256Hex(canonicalJson(state)) };
  }

  const baseReserve = BigInt(ledger.base_reserve_in_stroops);
  const reserve = reserveFromHorizon(raw, baseReserve);
  const native = raw.balances.find((b) => b.asset_type === "native");
  const trustlines: TrustlineInfo[] = raw.balances
    .filter(isCredit)
    .map((b) => ({
      asset: creditAsset(b),
      balance: amount(b.balance),
      limit: amount(b.limit),
      buyingLiabilities: amount(b.buying_liabilities),
      sellingLiabilities: amount(b.selling_liabilities),
      authorized: b.is_authorized === true,
      authorizedToMaintainLiabilities: b.is_authorized_to_maintain_liabilities === true,
      clawbackEnabled: b.is_clawback_enabled === true,
      sponsor: b.sponsor ?? null,
      lastModifiedLedger: b.last_modified_ledger ?? null,
    }))
    .sort(byAsset);
  const withBalance = trustlines.filter((t) => toStroops(t.balance) > 0n);
  const issuerIds = [...new Set(withBalance.map((t) => t.asset.issuer))].sort();

  const poolBalances = raw.balances.filter((b) => b.asset_type === "liquidity_pool_shares");
  const [offers, issuerAccounts, quotes, claimable, poolAssets, claimant] = await Promise.all([
    reader.offers(account),
    Promise.all(issuerIds.map((id) => reader.account(id))),
    Promise.all(
      trustlines.map(async (t) => ({
        asset: t.asset,
        // A trustline that is not authorized cannot send, so it has no route to quote.
        quote: toStroops(t.balance) > 0n && t.authorized ? await bestQuote(reader, t) : null,
      })),
    ),
    raw.num_sponsoring > 0 ? reader.claimableBalancesSponsoredBy(account) : Promise.resolve(null),
    Promise.all(poolBalances.map((b) => reader.liquidityPoolAssets(b.liquidity_pool_id ?? ""))),
    reader.claimableBalancesClaimableBy
      ? reader.claimableBalancesClaimableBy(account)
      : Promise.resolve(null),
  ]);
  const issuers: IssuerInfo[] = issuerIds.map((id, i) => ({
    account: id,
    exists: issuerAccounts[i] !== null,
    memoRequired: memoRequired(issuerAccounts[i] ?? null),
  }));

  const state = {
    schemaVersion: 1 as const,
    account,
    exists: true as const,
    sequence: raw.sequence,
    sequenceLedger: (raw as { sequence_ledger?: number }).sequence_ledger ?? null,
    subentryCount: raw.subentry_count,
    numSponsoring: raw.num_sponsoring,
    numSponsored: raw.num_sponsored,
    sponsor: raw.sponsor ?? null,
    thresholds: {
      low: raw.thresholds.low_threshold,
      medium: raw.thresholds.med_threshold,
      high: raw.thresholds.high_threshold,
    },
    masterWeight: raw.signers.find((s) => s.key === account)?.weight ?? 0,
    signers: raw.signers
      .map((s) => ({ key: s.key, weight: s.weight, type: s.type, sponsor: s.sponsor ?? null }))
      .sort((a, b) => byCodePoint(a.key, b.key)),
    flags: {
      authRequired: raw.flags.auth_required,
      authRevocable: raw.flags.auth_revocable,
      authImmutable: raw.flags.auth_immutable,
      authClawbackEnabled: raw.flags.auth_clawback_enabled,
    },
    native: {
      balance: amount(native?.balance),
      buyingLiabilities: amount(native?.buying_liabilities),
      sellingLiabilities: amount(native?.selling_liabilities),
    },
    reserve: {
      baseReserve: formatStroops(baseReserve),
      minimum: formatStroops(reserve.minimum),
      spendable: formatStroops(reserve.spendable),
    },
    trustlines,
    poolShares: poolBalances
      .map((b, i) => ({
        poolId: b.liquidity_pool_id ?? "",
        balance: amount(b.balance),
        sponsor: b.sponsor ?? null,
        assets: poolAssets[i] ?? null,
      }))
      .sort((a, b) => byCodePoint(a.poolId, b.poolId)),
    offers: offers
      .map((o) => ({
        id: String(o.id),
        selling: assetRef(o.selling),
        buying: assetRef(o.buying),
        amount: amount(o.amount),
        price: { n: o.price_r.n, d: o.price_r.d },
        sponsor: o.sponsor ?? null,
        lastModifiedLedger: o.last_modified_ledger ?? null,
      }))
      .sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : BigInt(a.id) > BigInt(b.id) ? 1 : 0)),
    data: Object.keys(raw.data)
      .sort()
      .map((name) => ({ name, valueBase64: raw.data[name] ?? "" })),
    claimableBalancesSponsored: claimable,
    issuers,
    destination,
  };
  const snapshot: ExistingAccountSnapshot = {
    ...state,
    observed,
    feeStats: fees,
    quotes,
    claimableBalancesClaimable:
      claimant
        ?.map((b) => ({
          id: b.id,
          asset: b.asset,
          amount: amount(b.amount),
          sponsor: b.sponsor ?? null,
        }))
        .sort((a, b) => byCodePoint(a.id, b.id)) ?? null,
    snapshotHash: sha256Hex(canonicalJson(state)),
  };
  return snapshot;
}

/**
 * The strict-send answer that pays the most XLM for the full balance, or null when Horizon found
 * no path. An answer below 1 stroop is kept (it is the best only when every answer is), so the
 * ladder rules the sale out and says why: the path pays less than 1 stroop, not that there is no
 * path (closing review CP-5).
 */
async function bestQuote(reader: LedgerReader, t: TrustlineInfo): Promise<Quote | null> {
  const records = await reader.strictSendPathsToNative(t.asset, t.balance);
  let best: Quote | null = null;
  for (const r of records) {
    if (!best || toStroops(r.destination_amount) > toStroops(best.destinationAmount)) {
      best = {
        sourceAmount: amount(r.source_amount),
        destinationAmount: amount(r.destination_amount),
        path: r.path.map(assetRef),
      };
    }
  }
  return best;
}
