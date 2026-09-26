/**
 * Amounts are BigInt stroops everywhere (docs/README.md canonical decision 9). Horizon and the SDK
 * use decimal strings with at most 7 fractional digits; JavaScript numbers would print dust such
 * as 0.0000005 as "5e-7", which the SDK rejects.
 */
export const STROOPS_PER_UNIT = 10_000_000n;
export const MAX_INT64 = 9_223_372_036_854_775_807n;

const AMOUNT = /^(\d+)(?:\.(\d{1,7}))?$/;

export function toStroops(amount: string): bigint {
  const match = AMOUNT.exec(amount);
  if (!match) throw new RangeError(`not a Stellar amount: "${amount}"`);
  const [, whole = "0", fraction = ""] = match;
  const stroops = BigInt(whole) * STROOPS_PER_UNIT + BigInt(fraction.padEnd(7, "0"));
  if (stroops > MAX_INT64) throw new RangeError(`amount exceeds int64: "${amount}"`);
  return stroops;
}

export function formatStroops(stroops: bigint): string {
  const sign = stroops < 0n ? "-" : "";
  const abs = stroops < 0n ? -stroops : stroops;
  const fraction = (abs % STROOPS_PER_UNIT).toString().padStart(7, "0");
  return `${sign}${abs / STROOPS_PER_UNIT}.${fraction}`;
}
