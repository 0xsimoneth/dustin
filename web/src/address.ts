import { StrKey } from "@stellar/stellar-sdk";

/**
 * Address checks with the Stellar SDK's StrKey (version byte and CRC16 checksum), the same checks
 * the SDK's planner applies, so the page never builds an explorer URL or a command from a string
 * that merely looks like an address, and the sponsor of the no-destination path is checked as
 * `planClose()` checks it (E5-S1 review, I-2 and EC-3). `@stellar/stellar-sdk` resolves from the
 * repository's root node_modules, as the built SDK entry's own import does, so the bundle holds
 * one copy of it (docs/web-demo.md, "Architecture").
 */

/** A classic account: G and 55 base32 characters with a valid checksum. */
export function isAccountAddress(value: string): boolean {
  return StrKey.isValidEd25519PublicKey(value);
}

/** A destination: a classic account, or a muxed account (M..., SEP-23). */
export function isDestinationAddress(value: string): boolean {
  return isAccountAddress(value) || StrKey.isValidMed25519PublicKey(value);
}

/** The classic account a muxed address wraps (its first 32 bytes); a G address is its own. */
export function baseAccount(value: string): string {
  if (StrKey.isValidMed25519PublicKey(value)) {
    return StrKey.encodeEd25519PublicKey(StrKey.decodeMed25519PublicKey(value).subarray(0, 32));
  }
  return value;
}
