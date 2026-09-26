import { describe, expect, it } from "vitest";
import { mergeAmountFromResultXdr } from "../../../src/execute/report.js";

// Result of the day-1 testnet transaction d095ceb9... (changeTrust + accountMerge, fee-bumped, ledger 4874044).
const MERGE_RESULT =
  "AAAAAAAAASwAAAABcvugOt2ri2+SadyJqn10hq1DifXsFY37khyOXuW1HZQAAAAAAAAAAAAAAAAAAAACAAAAAAAAAAYAAAAAAAAAAAAAAAgAAAAAAAAAAAHJw4cAAAAAAAAAAA==";

describe("mergeAmountFromResultXdr", () => {
  it("reads the merged balance from a fee-bumped merge result", () => {
    expect(mergeAmountFromResultXdr(MERGE_RESULT)).toBe(30_000_007n);
  });

  it("returns null for anything else", () => {
    expect(mergeAmountFromResultXdr("")).toBeNull();
    expect(mergeAmountFromResultXdr("not xdr")).toBeNull();
  });
});
