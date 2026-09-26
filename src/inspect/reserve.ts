import { toStroops } from "../amounts.js";

/** The fields of a Horizon account record that decide its minimum balance. */
export interface ReserveFields {
  subentry_count: number;
  num_sponsoring: number;
  num_sponsored: number;
  balances: ReadonlyArray<{ asset_type: string; balance: string; selling_liabilities?: string }>;
}

export interface ReserveSummary {
  balance: bigint;
  minimum: bigint;
  sellingLiabilities: bigint;
  spendable: bigint;
}

/**
 * Minimum balance = (2 + numSubEntries + numSponsoring - numSponsored) x baseReserve, and
 * spendable = balance - minimum - native selling liabilities (CAP-33;
 * https://developers.stellar.org/docs/build/guides/transactions/sponsored-reserves).
 */
export function reserveFromHorizon(account: ReserveFields, baseReserve: bigint): ReserveSummary {
  const native = account.balances.find((b) => b.asset_type === "native");
  const balance = native ? toStroops(native.balance) : 0n;
  const sellingLiabilities = native?.selling_liabilities
    ? toStroops(native.selling_liabilities)
    : 0n;
  const units =
    2n +
    BigInt(account.subentry_count) +
    BigInt(account.num_sponsoring) -
    BigInt(account.num_sponsored);
  const minimum = units * baseReserve;
  return {
    balance,
    minimum,
    sellingLiabilities,
    spendable: balance - minimum - sellingLiabilities,
  };
}
