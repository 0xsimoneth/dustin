import { describe, expect, it } from "vitest";
import { verifyFixture, type VerifyInput } from "../../../src/fixture/verify.js";
import type { HorizonAccount, HorizonOffer } from "../../../src/inspect/horizon-types.js";

const FIX = "GDWLZO3KOVY5VVWHSSBAP63PEF7BTEPO7I7OYZA7KQI2CZDPBF6VLHF6";
const RSV = "GD5K536TEEUQG6EQUDA4ELHGC3WXI6TC2SRQHED4W3GS5EXUTUYACOAT";
const ISS = "GD5QRUVI3WGPPCYRKIBUOI2PNRDSZ33Q5NLZORHR63NH6C7SQSSPD4CT";
const DST = "GD3GTHATVZWSAXEOOB6WUJ26OTYPB7H2SXXZP767JQ7EUG5NYKGFARYN";

function line(code: string, balance: string, extra: object = {}) {
  return {
    asset_type: code.length <= 4 ? "credit_alphanum4" : "credit_alphanum12",
    asset_code: code,
    asset_issuer: ISS,
    balance,
    limit: "922337203685.4775807",
    buying_liabilities: "0.0000000",
    selling_liabilities: "0.0000000",
    is_authorized: true,
    is_authorized_to_maintain_liabilities: true,
    ...extra,
  } as const;
}

function recordedAccount(nativeBalance = "4.0000000"): HorizonAccount {
  return {
    id: FIX,
    account_id: FIX,
    sequence: "20933812334624770",
    subentry_count: 7,
    num_sponsoring: 0,
    num_sponsored: 1,
    thresholds: { low_threshold: 0, med_threshold: 0, high_threshold: 0 },
    flags: {
      auth_required: false,
      auth_revocable: false,
      auth_immutable: false,
      auth_clawback_enabled: false,
    },
    signers: [{ key: FIX, weight: 1, type: "ed25519_public_key" }],
    data: { "dustin.fixture": "bWVzc3k=" },
    balances: [
      line("DUSTA", "0.0000007", { selling_liabilities: "0.0000002" }),
      line("DUSTB", "0.0000003", { buying_liabilities: "0.0000002" }),
      line("DUSTC", "0.0000005", { selling_liabilities: "0.0000002" }),
      line("SPTA", "0.0000001", { sponsor: RSV }),
      {
        asset_type: "native",
        balance: nativeBalance,
        buying_liabilities: "0.0000200",
        selling_liabilities: "0.0000000",
      },
    ],
  };
}

const offers: HorizonOffer[] = [
  {
    id: "1",
    seller: FIX,
    selling: { asset_type: "credit_alphanum12", asset_code: "DUSTA", asset_issuer: ISS },
    buying: { asset_type: "native" },
    amount: "0.0000002",
    price: "100.0000000",
    price_r: { n: 100, d: 1 },
  },
  {
    id: "2",
    seller: FIX,
    selling: { asset_type: "credit_alphanum12", asset_code: "DUSTC", asset_issuer: ISS },
    buying: { asset_type: "credit_alphanum12", asset_code: "DUSTB", asset_issuer: ISS },
    amount: "0.0000002",
    price: "1.0000000",
    price_r: { n: 1, d: 1 },
  },
];

function input(overrides: Partial<VerifyInput> = {}): VerifyInput {
  return {
    account: recordedAccount(),
    offers,
    baseReserve: 5_000_000n,
    destinationExists: true,
    expected: {
      reserveSponsor: RSV,
      sponsoredAsset: { code: "SPTA", issuer: ISS },
      subentryCount: 7,
      numSponsored: 1,
      destination: DST,
    },
    ...overrides,
  };
}

describe("verifyFixture", () => {
  it("passes every Appendix B precondition and invariant on the recorded fixture", () => {
    const result = verifyFixture(input());
    expect(result.checks.filter((c) => !c.pass)).toEqual([]);
    expect(result.pass).toBe(true);
    expect(result.checks.filter((c) => c.appendixB).map((c) => c.id)).toEqual([
      "zero-spendable-xlm",
      "trustlines-with-balance",
      "open-offer",
      "data-entry",
    ]);
  });

  it("fails the spendable check one stroop above or below the minimum", () => {
    for (const balance of ["4.0000001", "3.9999999"]) {
      const result = verifyFixture(input({ account: recordedAccount(balance) }));
      expect(result.pass).toBe(false);
      expect(result.checks.find((c) => c.id === "zero-spendable-xlm")!.pass).toBe(false);
    }
  });

  it("counts only non-zero credit balances as trustlines with balance", () => {
    const account = recordedAccount();
    account.balances = account.balances.map((b) =>
      b.asset_code === "DUSTA" || b.asset_code === "DUSTB" ? { ...b, balance: "0.0000000" } : b,
    );
    const check = verifyFixture(input({ account })).checks.find(
      (c) => c.id === "trustlines-with-balance",
    )!;
    expect(check.pass).toBe(false);
    expect(check.observed).toContain("2");
  });

  it("fails without offers, data or the sponsored trustline", () => {
    const account = recordedAccount();
    account.data = {};
    account.balances = account.balances.map((b) =>
      b.asset_code === "SPTA" ? { ...b, sponsor: undefined } : b,
    );
    const failed = verifyFixture(input({ account, offers: [] }))
      .checks.filter((c) => !c.pass)
      .map((c) => c.id);
    expect(failed).toEqual(
      expect.arrayContaining(["open-offer", "data-entry", "sponsored-trustline"]),
    );
  });

  it("flags merge blockers and a missing destination", () => {
    const account = recordedAccount();
    account.num_sponsoring = 1;
    account.flags.auth_immutable = true;
    account.balances.push({
      asset_type: "liquidity_pool_shares",
      balance: "1.0000000",
      liquidity_pool_id: "ab",
    });
    const failed = verifyFixture(input({ account, destinationExists: false }))
      .checks.filter((c) => !c.pass)
      .map((c) => c.id);
    expect(failed).toEqual(
      expect.arrayContaining([
        "not-sponsoring",
        "not-immutable",
        "no-pool-shares",
        "destination-exists",
      ]),
    );
  });

  it("reports a missing account instead of throwing", () => {
    const result = verifyFixture(input({ account: null }));
    expect(result.pass).toBe(false);
    expect(result.checks[0]).toMatchObject({ id: "account-exists", pass: false });
  });
});
