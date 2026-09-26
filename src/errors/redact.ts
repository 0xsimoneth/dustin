import { StrKey } from "@stellar/stellar-sdk";

/**
 * A Stellar secret seed is "S" followed by 55 base32 characters (StrKey, 56 characters in all).
 * Two rules find one:
 * - a standalone 56-character token of that shape, redacted even if its checksum is wrong,
 *   because a near-miss is still sensitive;
 * - any 56-character window inside a longer run (a seed glued to other characters, or inside a
 *   URL-encoded string such as "%3DS...") whose StrKey checksum is valid.
 * Public keys, muxed addresses and hashes are not seed-shaped and are left alone.
 */
const BASE32 = /[A-Z2-7]/;
const WINDOW = /(?=(S[A-Z2-7]{55}))/g;

export const REDACTED_SEED = "S...REDACTED";

function seedRanges(text: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  WINDOW.lastIndex = 0;
  for (let match = WINDOW.exec(text); match; match = WINDOW.exec(text)) {
    const start = match.index;
    const window = match[1] ?? "";
    const end = start + window.length;
    const standalone =
      (start === 0 || !BASE32.test(text[start - 1] ?? "")) &&
      (end === text.length || !BASE32.test(text[end] ?? ""));
    if (standalone || StrKey.isValidEd25519SecretSeed(window)) ranges.push([start, end]);
    WINDOW.lastIndex = start + 1;
  }
  return ranges;
}

export function containsSecretSeed(text: string): boolean {
  return seedRanges(text).length > 0;
}

export function redact(text: string): string {
  const ranges = seedRanges(text);
  if (ranges.length === 0) return text;
  let out = "";
  let cursor = 0;
  for (const [start, end] of ranges) {
    if (end <= cursor) continue;
    out += text.slice(cursor, Math.max(start, cursor)) + (start >= cursor ? REDACTED_SEED : "");
    cursor = end;
  }
  return out + text.slice(cursor);
}

/**
 * Returns a copy of a JSON-like value with every secret seed replaced, in keys and values.
 * A reference back to an enclosing object becomes "[Circular]".
 */
export function redactValue<T>(value: T, ancestors: WeakSet<object> = new WeakSet()): T {
  if (typeof value === "string") return redact(value) as T;
  if (value === null || typeof value !== "object") return value;
  if (ancestors.has(value)) return "[Circular]" as T;
  ancestors.add(value);
  const copy: unknown = Array.isArray(value)
    ? value.map((item: unknown) => redactValue(item, ancestors))
    : Object.fromEntries(
        Object.entries(value).map(([key, item]) => [
          redact(key),
          redactValue(item as unknown, ancestors),
        ]),
      );
  ancestors.delete(value);
  return copy as T;
}
