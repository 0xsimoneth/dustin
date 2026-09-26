import { describe, expect, it } from "vitest";
import {
  DEFAULT_MAX_BASE_FEE,
  MIN_BASE_FEE,
  baseFeeFromFeeStats,
} from "../../../src/config/fees.js";

const stats = (last: string, p80: string) => ({ last_ledger_base_fee: last, fee_charged: { p80 } });

describe("baseFeeFromFeeStats", () => {
  it("bids the larger of the last ledger base fee and fee_charged p80", () => {
    expect(baseFeeFromFeeStats(stats("100", "82746"))).toBe(82_746);
    expect(baseFeeFromFeeStats(stats("250", "100"))).toBe(250);
  });

  it("never bids below the network minimum", () => {
    expect(baseFeeFromFeeStats(stats("0", "0"))).toBe(MIN_BASE_FEE);
  });

  it("caps the bid per operation", () => {
    expect(baseFeeFromFeeStats(stats("100", "10000000"))).toBe(DEFAULT_MAX_BASE_FEE);
    expect(baseFeeFromFeeStats(stats("100", "5000"), 1_000)).toBe(1_000);
  });

  it("treats malformed statistics as the minimum", () => {
    expect(baseFeeFromFeeStats(stats("abc", ""))).toBe(MIN_BASE_FEE);
  });
});
