/**
 * A Stellar secret seed is "S" followed by 55 base32 characters (StrKey, 56 characters in all).
 * The lookarounds keep the match to a standalone 56-character token, so public keys, muxed
 * addresses and other base32 runs are left alone. Seed-shaped strings are redacted even when
 * their checksum is invalid: a near-miss is still sensitive.
 */
const SECRET_SEED_PATTERN = "(?<![A-Z2-7])S[A-Z2-7]{55}(?![A-Z2-7])";

export const REDACTED_SEED = "S...REDACTED";

export function containsSecretSeed(text: string): boolean {
  return new RegExp(SECRET_SEED_PATTERN).test(text);
}

export function redact(text: string): string {
  return text.replace(new RegExp(SECRET_SEED_PATTERN, "g"), REDACTED_SEED);
}

/** Returns a copy of a JSON-like value with every secret seed replaced, in keys and values. */
export function redactValue<T>(value: T): T {
  if (typeof value === "string") return redact(value) as T;
  if (Array.isArray(value)) return value.map((item: unknown) => redactValue(item)) as T;
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [redact(key), redactValue(item as unknown)]),
    ) as T;
  }
  return value;
}
