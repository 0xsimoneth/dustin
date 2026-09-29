import type { FeeStatsLike } from "../config/fees.js";
import type {
  HorizonAccount,
  HorizonAssetRef,
  HorizonClaimableBalance,
  HorizonOffer,
} from "../inspect/horizon-types.js";
import {
  PAGE_LIMIT,
  accountOffers,
  latestLedger,
  readPages,
  type HorizonJsonClient,
  type LedgerSummary,
} from "./horizon-json.js";

export interface CreditAssetRef {
  type: "credit_alphanum4" | "credit_alphanum12";
  code: string;
  issuer: string;
}

export interface PathRecord {
  source_amount: string;
  destination_amount: string;
  path: HorizonAssetRef[];
}

export type FeeStats = FeeStatsLike & { fee_charged: Record<string, string> };

/**
 * Everything the inspector and planner may ask the ledger. Reads only: there is no method that
 * signs or submits (docs/architecture.md sections 4.2 and 6.3).
 */
export interface LedgerReader {
  readonly source: string;
  networkPassphrase(): Promise<string>;
  latestLedger(): Promise<LedgerSummary>;
  feeStats(): Promise<FeeStats>;
  account(id: string): Promise<HorizonAccount | null>;
  offers(id: string): Promise<HorizonOffer[]>;
  strictSendPathsToNative(asset: CreditAssetRef, amount: string): Promise<PathRecord[]>;
  claimableBalancesSponsoredBy(id: string): Promise<number>;
  /**
   * The claimable balances that name `id` as a claimant (`GET /claimable_balances?claimant=`, the
   * query js-stellar-sdk's `ClaimableBalanceCallBuilder.claimant()` builds:
   * https://github.com/stellar/js-stellar-sdk/blob/master/src/horizon/claimable_balances_call_builder.ts),
   * following the pages (matrix row X-03). Horizon's reader stops after `CLAIMANT_PAGES` pages of
   * 200: a result of `CLAIMANT_READ_LIMIT` records may be incomplete, and the warning then says
   * "at least" (Epic 4 review EP-4). Optional, so a reader written before it still fits; the
   * snapshot then leaves the field out. A read that fails is not fatal: the inspector records it
   * as `null` and the plan warns that it could not be read.
   */
  claimableBalancesClaimableBy?(id: string): Promise<HorizonClaimableBalance[]>;
  /** Reserve assets of a liquidity pool ("native" or "CODE:ISSUER"), or null if not found. */
  liquidityPoolAssets(id: string): Promise<string[] | null>;
}

/** `GET /paths/strict-send` for selling `amount` of `asset` into XLM. */
export function strictSendToNativePath(asset: CreditAssetRef, amount: string): string {
  return (
    `/paths/strict-send?source_asset_type=${asset.type}&source_asset_code=${asset.code}` +
    `&source_asset_issuer=${asset.issuer}&source_amount=${amount}&destination_assets=native`
  );
}

interface Page<T> {
  _embedded: { records: T[] };
}

/**
 * How many pages of 200 the claimant read follows before it stops: the balances only feed a
 * warning, so a claimant of thousands of spam balances costs at most ten requests (EP-4).
 */
export const CLAIMANT_PAGES = 10;
/** The most claimable balances the claimant read returns: at this count there may be more. */
export const CLAIMANT_READ_LIMIT = CLAIMANT_PAGES * PAGE_LIMIT;

export function horizonReader(client: HorizonJsonClient): LedgerReader {
  return {
    source: client.horizonUrl,
    async networkPassphrase() {
      const root = await client.get<{ network_passphrase?: string }>("/");
      return root?.network_passphrase ?? "";
    },
    latestLedger: () => latestLedger(client),
    async feeStats() {
      const stats = await client.get<FeeStats>("/fee_stats");
      return stats ?? { last_ledger_base_fee: "100", fee_charged: { p80: "100" } };
    },
    account: (id) => client.get<HorizonAccount>(`/accounts/${id}`),
    offers: (id) => accountOffers(client, id),
    async strictSendPathsToNative(asset, amount) {
      const page = await client.get<Page<PathRecord>>(strictSendToNativePath(asset, amount));
      return page?._embedded.records ?? [];
    },
    async liquidityPoolAssets(id) {
      const pool = await client.get<{ reserves: { asset: string }[] }>(`/liquidity_pools/${id}`);
      return pool ? pool.reserves.map((r) => r.asset) : null;
    },
    async claimableBalancesClaimableBy(id) {
      const { records } = await readPages<HorizonClaimableBalance>(
        client,
        (cursor) =>
          `/claimable_balances?claimant=${id}&limit=200${cursor ? `&cursor=${cursor}` : ""}`,
        CLAIMANT_PAGES,
      );
      return records;
    },
    async claimableBalancesSponsoredBy(id) {
      const { records } = await readPages<{ id: string }>(
        client,
        (cursor) =>
          `/claimable_balances?sponsor=${id}&limit=200${cursor ? `&cursor=${cursor}` : ""}`,
      );
      return records.length;
    },
  };
}
