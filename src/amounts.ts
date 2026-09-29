// The only import: the error type, whose module imports nothing of Dustin's at run time but the
// redaction (src/errors/redact.ts), so no import cycle can reach this module (Epic 4 review AC-12).
import { DustinError } from "./errors/dustin-error.js";

/**
 * Amounts are BigInt stroops everywhere (docs/README.md canonical decision 9). Horizon and the SDK
 * use decimal strings with at most 7 fractional digits; JavaScript numbers would print dust such
 * as 0.0000005 as "5e-7", which the SDK rejects.
 */
export const STROOPS_PER_UNIT = 10_000_000n;
export const MAX_INT64 = 9_223_372_036_854_775_807n;

const AMOUNT = /^(\d+)(?:\.(\d{1,7}))?$/;

/**
 * An amount as BigInt stroops. A value that is not a Stellar amount is refused with the DustinError
 * LEDGER_DATA_INVALID (Epic 4 review AC-12; it was a RangeError): the amounts parsed here come from
 * Horizon, or from a snapshot or plan built from what Horizon answered.
 */
export function toStroops(amount: string): bigint {
  const match = AMOUNT.exec(amount);
  if (!match) {
    throw invalidAmount(
      `"${String(amount)}" is not a Stellar amount: a non-negative decimal with at most 7 fractional digits was expected.`,
    );
  }
  const [, whole = "0", fraction = ""] = match;
  const stroops = BigInt(whole) * STROOPS_PER_UNIT + BigInt(fraction.padEnd(7, "0"));
  if (stroops > MAX_INT64) {
    throw invalidAmount(
      `The amount "${amount}" exceeds the int64 limit of Stellar amounts (922337203685.4775807).`,
    );
  }
  return stroops;
}

function invalidAmount(message: string): DustinError {
  return new DustinError("LEDGER_DATA_INVALID", message, { stage: "inspect" });
}

export function formatStroops(stroops: bigint): string {
  const sign = stroops < 0n ? "-" : "";
  const abs = stroops < 0n ? -stroops : stroops;
  const fraction = (abs % STROOPS_PER_UNIT).toString().padStart(7, "0");
  return `${sign}${abs / STROOPS_PER_UNIT}.${fraction}`;
}
