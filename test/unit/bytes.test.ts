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
  it("decodes SEP-29's value, with or without padding, as Buffer did", () => {
    for (const value of ["MQ==", "MQ", "bWVzc3k=", "bWVzc3k", "", "w7xuw68="]) {
      expect(base64ToUtf8(value)).toBe(Buffer.from(value, "base64").toString("utf8"));
    }
    expect(base64ToUtf8("MQ==")).toBe("1");
    expect(base64ToUtf8("bWVzc3k=")).toBe("messy");
  });

  it("answers null for a value that is not base64, which equals no constant", () => {
    expect(base64ToUtf8("M")).toBeNull();
    expect(base64ToUtf8("not base64!")).toBeNull();
    expect(base64ToUtf8("MQ==") === "1").toBe(true);
    expect(base64ToUtf8("M") === "1").toBe(false);
  });
});
