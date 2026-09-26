import { describe, expect, it } from "vitest";
import { reserveFromHorizon } from "../../../src/inspect/reserve.js";

const BASE_RESERVE = 5_000_000n; // 0.5 XLM, testnet ledger 2026-09-26

function account(balance: string, extra: Partial<Record<string, unknown>> = {}) {
  return {
    subentry_count: 7,
    num_sponsoring: 0,
    num_sponsored: 1,
    balances: [
      {
        asset_type: "native",
        balance,
        buying_liabilities: "0.0000000",
        selling_liabilities: "0.0000000",
      },
    ],
    ...extra,
  };
}

describe("reserveFromHorizon", () => {
  it("computes (2 + subentries + sponsoring - sponsored) x base reserve", () => {
    const r = reserveFromHorizon(account("4.0000000"), BASE_RESERVE);
    expect(r.minimum).toBe(40_000_000n);
    expect(r.balance).toBe(40_000_000n);
    expect(r.spendable).toBe(0n);
  });

  it("subtracts native selling liabilities from spendable", () => {
    const acc = account("5.0000000");
    acc.balances[0]!.selling_liabilities = "0.2500000";
    expect(reserveFromHorizon(acc, BASE_RESERVE).spendable).toBe(7_500_000n);
  });

  it("counts sponsoring and a sponsored account entry", () => {
    const r = reserveFromHorizon(
      account("0.0000000", { subentry_count: 1, num_sponsoring: 0, num_sponsored: 3 }),
      BASE_RESERVE,
    );
    expect(r.minimum).toBe(0n);
    expect(
      reserveFromHorizon(
        account("9", { subentry_count: 0, num_sponsoring: 2, num_sponsored: 0 }),
        BASE_RESERVE,
      ).minimum,
    ).toBe(20_000_000n);
  });
});
