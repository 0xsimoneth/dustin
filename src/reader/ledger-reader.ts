import type { FeeStatsLike } from "../config/fees.js";
import type { HorizonAccount, HorizonAssetRef, HorizonOffer } from "../inspect/horizon-types.js";
import {
  accountOffers,
  latestLedger,
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
}

/** `GET /paths/strict-send` for selling `amount` of `asset` into XLM. */
export function strictSendToNativePath(asset: CreditAssetRef, amount: string): string {
  return (
    `/paths/strict-send?source_asset_type=${asset.type}&source_asset_code=${asset.code}` +
    `&source_asset_issuer=${asset.issuer}&source_amount=${amount}&destination_assets=native`
  );
}

interface Page<T> {
  _embedded: { records: (T & { paging_token: string })[] };
}

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
    async claimableBalancesSponsoredBy(id) {
      let count = 0;
      let cursor = "";
      for (;;) {
        const page = await client.get<Page<{ id: string }>>(
          `/claimable_balances?sponsor=${id}&limit=200${cursor ? `&cursor=${cursor}` : ""}`,
        );
        const records = page?._embedded.records ?? [];
        count += records.length;
        if (records.length < 200) return count;
        cursor = records[records.length - 1]!.paging_token;
      }
    },
  };
}
