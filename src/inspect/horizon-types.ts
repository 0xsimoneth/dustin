/**
 * The subset of Horizon's JSON resources Dustin reads, as returned by `GET /accounts/{id}` and
 * `GET /accounts/{id}/offers` (https://developers.stellar.org/docs/data/apis/horizon/api-reference/resources/accounts/object).
 * Optional boolean fields are omitted by Horizon when false (observed 2026-09-26 for
 * `is_clawback_enabled`); treat absence as false.
 */
export interface HorizonBalance {
  asset_type: "native" | "credit_alphanum4" | "credit_alphanum12" | "liquidity_pool_shares";
  balance: string;
  limit?: string;
  buying_liabilities?: string;
  selling_liabilities?: string;
  asset_code?: string;
  asset_issuer?: string;
  liquidity_pool_id?: string;
  is_authorized?: boolean;
  is_authorized_to_maintain_liabilities?: boolean;
  is_clawback_enabled?: boolean;
  sponsor?: string;
  last_modified_ledger?: number;
}

export interface HorizonSigner {
  key: string;
  weight: number;
  type: string;
  sponsor?: string;
}

export interface HorizonAccount {
  id: string;
  account_id: string;
  sequence: string;
  subentry_count: number;
  num_sponsoring: number;
  num_sponsored: number;
  sponsor?: string;
  last_modified_ledger?: number;
  thresholds: { low_threshold: number; med_threshold: number; high_threshold: number };
  flags: {
    auth_required: boolean;
    auth_revocable: boolean;
    auth_immutable: boolean;
    auth_clawback_enabled: boolean;
  };
  signers: HorizonSigner[];
  /** Data entries; values are base64. */
  data: Record<string, string>;
  balances: HorizonBalance[];
}

export interface HorizonAssetRef {
  asset_type: string;
  asset_code?: string;
  asset_issuer?: string;
}

export interface HorizonOffer {
  id: string;
  seller: string;
  selling: HorizonAssetRef;
  buying: HorizonAssetRef;
  amount: string;
  price: string;
  price_r: { n: number; d: number };
  sponsor?: string;
  last_modified_ledger?: number;
}
