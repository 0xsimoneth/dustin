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

/**
 * The UTF-8 text a base64 value encodes, or null when the value is not base64. `atob` applies
 * the forgiving base64 decoding of the WHATWG Infra standard (padding optional, ASCII whitespace
 * skipped) and throws on anything else (https://infra.spec.whatwg.org/#forgiving-base64-decode),
 * where `Buffer.from(value, "base64")` dropped the invalid part without a word. Every caller
 * compares the text with a constant, so a null is as good as a mismatch.
 */
export function base64ToUtf8(value: string): string | null {
  try {
    const binary = atob(value);
    return new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)));
  } catch {
    return null;
  }
}
