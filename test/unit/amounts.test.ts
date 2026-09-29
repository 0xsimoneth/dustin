import { describe, expect, it } from "vitest";
import { MAX_INT64, formatStroops, toStroops } from "../../src/amounts.js";
import { DustinError } from "../../src/errors/dustin-error.js";
import { inspectAccount } from "../../src/inspect/inspect.js";
import { planFromSnapshot } from "../../src/plan/plan.js";
import { horizonJson } from "../../src/reader/horizon-json.js";
import { horizonReader } from "../../src/reader/ledger-reader.js";
import { FakeLedger } from "../helpers/fake-ledger.js";
import { TESTNET_HORIZON } from "../helpers/recorded-horizon.js";
import { copy, messy, messySnapshot } from "../helpers/snapshots.js";

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

/** The error `run` throws, or a failure of the test when it throws none. */
async function thrown(run: () => unknown): Promise<unknown> {
  try {
    await run();
  } catch (error) {
    return error;
  }
  throw new Error("nothing was thrown");
}

describe("AC-12: a malformed amount is a DustinError, wherever it is read", () => {
  it("AC-12: toStroops refuses with LEDGER_DATA_INVALID, not a RangeError", async () => {
    for (const bad of ["5e-7", "1.12345678", "922337203685.4775808"]) {
      const error = await thrown(() => toStroops(bad));
      // Before the fix: RangeError, which the CLI reports as a bug in Dustin.
      expect(error, bad).toBeInstanceOf(DustinError);
      expect(error).toMatchObject({ code: "LEDGER_DATA_INVALID", stage: "inspect" });
    }
  });

  it("AC-12: planFromSnapshot on a malformed balance or claimable amount throws a DustinError", async () => {
    const base = await messySnapshot();
    const options = { destination: messy.destination, feeSponsor: messy.sponsor };
    const balance = copy(base);
    balance.native.balance = "1e-7";
    expect(await thrown(() => planFromSnapshot(balance, options))).toBeInstanceOf(DustinError);
    const claimable = copy(base);
    claimable.claimableBalancesClaimable = [
      { id: "00".repeat(36), asset: "native", amount: "0.00000001", sponsor: null },
    ];
    expect(await thrown(() => planFromSnapshot(claimable, options))).toMatchObject({
      code: "LEDGER_DATA_INVALID",
    });
  });

  it("AC-12: inspectAccount on a Horizon balance that is not an amount throws a DustinError", async () => {
    const ledger = FakeLedger.messy();
    const account = ledger.accounts.get(messy.fixture)!;
    account.balances[0]!.balance = "12,5";
    const reader = horizonReader(horizonJson(TESTNET_HORIZON, { fetch: ledger.fetch, retries: 0 }));
    const error = await thrown(() =>
      inspectAccount(messy.fixture, { destination: messy.destination, reader }),
    );
    expect(error).toBeInstanceOf(DustinError);
    expect(error).toMatchObject({ code: "LEDGER_DATA_INVALID" });
  });
});
