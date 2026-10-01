import { describe, expect, it } from "vitest";
import { base64ToUtf8, toHex, utf8ByteLength } from "../../src/bytes.js";

// Story E5-S1: the SDK zone has no Buffer, so it runs in a browser bundle. Each helper is checked
// against the Buffer call it replaced (the tests run in Node, where Buffer exists).

describe("toHex", () => {
  it('prints every byte as two lower-case hex digits, as Buffer\'s toString("hex") did', () => {
    const bytes = Uint8Array.from([0, 1, 9, 10, 15, 16, 127, 128, 200, 255]);
    expect(toHex(bytes)).toBe(Buffer.from(bytes).toString("hex"));
    expect(toHex(bytes)).toBe("0001090a0f107f80c8ff");
  });

  it("prints a view of a larger buffer, and nothing for no bytes", () => {
    const whole = Uint8Array.from([1, 2, 3, 4, 5, 6]);
    expect(toHex(whole.subarray(2, 4))).toBe("0304");
    expect(toHex(new Uint8Array())).toBe("");
  });
});

describe("utf8ByteLength", () => {
  it('counts bytes as Buffer.byteLength(text, "utf8") does, surrogates included', () => {
    const samples = [
      "",
      "memo",
      "a memo of 28 bytes exactly!!",
      "ünï cödé",
      "日本語",
      "\u{1F600}", // an astral character: 4 bytes
      "a\uD800b", // a lone surrogate: both encoders write U+FFFD, 3 bytes
    ];
    for (const text of samples) {
      expect(utf8ByteLength(text)).toBe(Buffer.byteLength(text, "utf8"));
    }
    expect(utf8ByteLength("\u{1F600}")).toBe(4);
  });
});

describe("base64ToUtf8", () => {
  // Node's decoder (src/base64-inl.h) skips every character outside the base64 alphabets, standard
  // and URL-safe, and stops at the first "=". The SEP-29 check compares the decoded value with "1",
  // so the helper must say "1" for exactly the values Buffer said it for (E5-S1 review, EC-1):
  // a forgiving `atob` threw on a stray character and the flag would have read as unset.
  const samples = [
    "MQ==",
    "MQ",
    "MQ=",
    "MQ===",
    "MQ==x",
    "MQ=x=",
    "!!MQ==",
    "M Q = =",
    "MQ\n==",
    "MQ==\n",
    "MQ==MQ==",
    "M",
    "",
    "A===",
    "====",
    "bWVzc3k=",
    "bWVzc3k",
    "bWVz c3k=",
    "w7xuw68=",
    "QUJD",
    "QUJDRA",
    "QUJDRA==",
    "QUJDRA=x",
    "AB",
    "ABC",
    "ABCD",
    "-_8=",
    "+/8=",
    "Mé==",
    "not base64!",
  ];

  it('decodes every value exactly as Buffer.from(value, "base64").toString("utf8") did', () => {
    for (const value of samples) {
      expect(base64ToUtf8(value), JSON.stringify(value)).toBe(
        Buffer.from(value, "base64").toString("utf8"),
      );
    }
  });

  it("reads SEP-29's flag with or without padding, and after a stray character", () => {
    expect(base64ToUtf8("MQ==")).toBe("1");
    expect(base64ToUtf8("MQ")).toBe("1");
    expect(base64ToUtf8("MQ==x")).toBe("1");
    expect(base64ToUtf8("bWVzc3k=")).toBe("messy");
    expect(base64ToUtf8("M")).toBe("");
    expect(base64ToUtf8("MA==")).toBe("0");
  });
});
