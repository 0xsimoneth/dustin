/**
 * Byte helpers without Node's `Buffer`, so the SDK entry (`stellar-dustin`) runs in a browser
 * bundle as it does in Node (story E5-S1, docs/web-demo.md). The Stellar SDK works on Uint8Array
 * since its version 16 (its `hash()`, `StrKey` and `getLiquidityPoolId` take and return one), so
 * these three conversions are all the SDK zone needs; the CLI (src/cli) and the fixture builders
 * (src/fixture, shipped as stellar-dustin/testing) are Node programs and keep Node's APIs.
 */

/** Lower-case hex of the bytes, as Buffer's `toString("hex")` prints them. */
export function toHex(bytes: Uint8Array): string {
  let out = "";
  for (const byte of bytes) out += byte.toString(16).padStart(2, "0");
  return out;
}

/** The UTF-8 size of a string in bytes, as `Buffer.byteLength(text, "utf8")` counts it. */
export function utf8ByteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

const BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/**
 * The bytes a base64 value encodes, decoded as Node's Buffer decodes it (src/base64-inl.h of Node
 * 24): every character outside the standard and the URL-safe alphabets is skipped, whitespace
 * included, decoding stops at the first "=", and a last group that is short of a byte is dropped.
 * The forgiving decoding of `atob` differs in the wrong direction for the one caller that matters,
 * the SEP-29 check of a destination's `config.memo_required` data entry: it throws on a stray
 * character, and the flag would have read as unset where Buffer read "1" (E5-S1 review, EC-1).
 */
function base64ToBytes(value: string): Uint8Array {
  const sextets: number[] = [];
  for (const char of value) {
    if (char === "=") break;
    const index = char === "-" ? 62 : char === "_" ? 63 : BASE64_ALPHABET.indexOf(char);
    if (index >= 0) sextets.push(index);
  }
  const bytes = new Uint8Array(Math.floor((sextets.length * 6) / 8));
  let acc = 0;
  let bits = 0;
  let at = 0;
  for (const sextet of sextets) {
    acc = ((acc << 6) | sextet) & 0xffff;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes[at++] = (acc >> bits) & 0xff;
    }
  }
  return bytes;
}

/**
 * The UTF-8 text a base64 value encodes, exactly as `Buffer.from(value, "base64").toString("utf8")`
 * gave it (test/unit/bytes.test.ts compares the two on every shape of input); invalid UTF-8 becomes
 * U+FFFD in both.
 */
export function base64ToUtf8(value: string): string {
  return new TextDecoder().decode(base64ToBytes(value));
}
