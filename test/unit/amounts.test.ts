import { describe, expect, it } from "vitest";
import { MAX_INT64, formatStroops, toStroops } from "../../src/amounts.js";

describe("toStroops", () => {
  it("parses Horizon amounts exactly", () => {
    expect(toStroops("4.0000000")).toBe(40_000_000n);
    expect(toStroops("0.0000001")).toBe(1n);
    expect(toStroops("0.0000007")).toBe(7n);
    expect(toStroops("10")).toBe(100_000_000n);
    expect(toStroops("0.5")).toBe(5_000_000n);
    expect(toStroops("922337203685.4775807")).toBe(MAX_INT64);
  });

  it("rejects anything that is not a plain non-negative decimal with at most 7 digits", () => {
    for (const bad of ["", "-1", "5e-7", "1.12345678", "1,5", " 1", "0x10", ".5", "1."]) {
      expect(() => toStroops(bad), bad).toThrow();
    }
  });
});

describe("formatStroops", () => {
  it("always prints seven decimals and never scientific notation", () => {
    expect(formatStroops(7n)).toBe("0.0000007");
    expect(formatStroops(40_000_000n)).toBe("4.0000000");
    expect(formatStroops(0n)).toBe("0.0000000");
    expect(formatStroops(-1n)).toBe("-0.0000001");
    expect(formatStroops(MAX_INT64)).toBe("922337203685.4775807");
  });

  it("round-trips", () => {
    for (const s of ["0.0000001", "1.2345678", "100.0000000", "922337203685.4775807"]) {
      expect(formatStroops(toStroops(s))).toBe(s);
    }
  });
});
