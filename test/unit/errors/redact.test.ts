import { Keypair } from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";
import { REDACTED_SEED, redact, redactValue } from "../../../src/errors/redact.js";

const seed = Keypair.random().secret();
const publicKey = Keypair.random().publicKey();

describe("redact", () => {
  it("replaces a secret seed inside a string", () => {
    const out = redact(`key=${seed} and more`);
    expect(out).toBe(`key=${REDACTED_SEED} and more`);
    expect(out).not.toContain(seed);
  });

  it("replaces every seed, including seed-shaped strings with a bad checksum", () => {
    const fake = `S${"A".repeat(55)}`;
    expect(redact(`${seed},${fake}`)).toBe(`${REDACTED_SEED},${REDACTED_SEED}`);
  });

  it("leaves public keys, muxed addresses and hashes alone", () => {
    const muxed = `M${"A".repeat(10)}S${"B".repeat(57)}`;
    const hash = "7fb410dbc1ac43e902e156ac14757d78fa9376ec0aa1498c5690e587c18e5c56";
    const text = `${publicKey} ${muxed} ${hash}`;
    expect(redact(text)).toBe(text);
  });

  it("does not redact a longer base32 run that merely contains an S", () => {
    const longer = `S${"A".repeat(56)}`;
    expect(redact(longer)).toBe(longer);
  });
});

describe("redactValue", () => {
  it("redacts nested strings in objects and arrays without mutating the input", () => {
    const input = { a: seed, b: [1, `x ${seed}`], c: { d: null, e: true } };
    const out = redactValue(input);
    expect(JSON.stringify(out)).not.toContain(seed);
    expect(out).toEqual({
      a: REDACTED_SEED,
      b: [1, `x ${REDACTED_SEED}`],
      c: { d: null, e: true },
    });
    expect(input.a).toBe(seed);
  });
});

describe("redact (review findings)", () => {
  it("redacts a checksum-valid seed even when base32 characters touch it", () => {
    for (const text of [
      `${seed}X`,
      `Q${seed}`,
      `2${seed}`,
      `${seed}${seed}`,
      encodeURIComponent(`secret=${seed}`),
      `https://h.example/?k=%22${seed}%22`,
    ]) {
      expect(redact(text), text).not.toContain(seed);
    }
  });

  it("detects a checksum-valid seed inside a longer token", async () => {
    const { containsSecretSeed } = await import("../../../src/errors/redact.js");
    expect(containsSecretSeed(`${seed}Q`)).toBe(true);
    expect(containsSecretSeed(`--to=2${seed}`)).toBe(true);
    expect(containsSecretSeed(publicKey)).toBe(false);
  });

  it("survives cycles", () => {
    const cyclic: Record<string, unknown> = { a: seed };
    cyclic.self = cyclic;
    const out = redactValue(cyclic);
    expect(JSON.stringify({ a: out.a })).not.toContain(seed);
    expect(out.self).toBe("[Circular]");
  });
});
