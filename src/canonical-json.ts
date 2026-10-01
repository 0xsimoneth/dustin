import { hash } from "@stellar/stellar-sdk";
import { toHex } from "./bytes.js";

/** JSON with object keys sorted recursively, so equal values always serialise identically. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, sortKeys((value as Record<string, unknown>)[key])]),
    );
  }
  return value;
}

/**
 * SHA-256 of the UTF-8 text as 64 lower-case hex digits. The digest is the Stellar SDK's `hash`
 * (sha256 from @noble/hashes over the UTF-8 bytes, `src/base/hashing.ts` of js-stellar-sdk
 * 17.1.0), byte for byte what Node's `createHash("sha256")` gave, so every plan hash and snapshot
 * hash recorded before this change holds (test/unit/canonical-json.test.ts), and the SDK entry
 * needs no `node:crypto`, which a browser bundle cannot provide (story E5-S1).
 */
export function sha256Hex(text: string): string {
  return toHex(hash(text));
}
