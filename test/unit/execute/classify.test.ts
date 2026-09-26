import { describe, expect, it } from "vitest";
import { explainCodes, operationFailure, rejectionAction } from "../../../src/execute/classify.js";

const failed = (...operations: string[]) => ({
  transaction: "tx_fee_bump_inner_failed",
  innerTransaction: "tx_failed",
  operations,
});

describe("operationFailure (docs/adr/ADR-0006-error-taxonomy.md, operation result code mapping)", () => {
  // Each row of the ADR's table, with Horizon's real spellings (stellar-horizon codes/main.go).
  const table: Array<[code: string, verdict: "replan" | "stop", demoteRung1: boolean]> = [
    ["op_offer_not_found", "replan", false],
    ["op_underfunded", "replan", false],
    ["op_src_not_authorized", "replan", false],
    ["op_src_no_trust", "replan", false],
    ["op_no_destination", "replan", false],
    ["op_no_trust", "replan", false],
    ["op_not_authorized", "replan", false],
    ["op_line_full", "replan", false],
    ["op_too_few_offers", "replan", true],
    ["op_under_dest_min", "replan", true],
    ["op_cross_self", "replan", true],
    ["op_invalid_limit", "replan", false],
    ["op_not_aut_maintain_liabilities", "replan", false],
    ["op_has_sub_entries", "replan", false],
    ["op_data_name_not_found", "replan", false],
    ["op_cannot_delete", "stop", false],
    ["op_seq_num_too_far", "stop", false],
    ["op_is_sponsor", "stop", false],
    ["op_immutable_set", "stop", false],
    ["op_no_account", "stop", false],
    ["op_dest_full", "stop", false],
    ["op_malformed", "stop", false],
    ["op_low_reserve", "stop", false],
    ["op_bad_auth", "stop", false],
  ];

  it.each(table)("%s -> %s", (code, verdict, demoteRung1) => {
    const f = operationFailure(failed(code));
    expect(f).toMatchObject({ index: 0, code, verdict, demoteRung1 });
    expect(f!.explanation.length).toBeGreaterThan(20);
  });

  it("names the first operation that did not succeed", () => {
    expect(
      operationFailure(failed("op_success", "op_success", "op_underfunded", "op_success")),
    ).toMatchObject({ index: 2, code: "op_underfunded", verdict: "replan" });
  });

  it("stops on a code it does not know, keeping the raw string", () => {
    expect(operationFailure(failed("op_success", "op_brand_new"))).toMatchObject({
      index: 1,
      code: "op_brand_new",
      verdict: "stop",
      demoteRung1: false,
    });
  });

  it("returns null when no operation failed", () => {
    expect(operationFailure(failed("op_success"))).toBeNull();
    expect(operationFailure({ transaction: "tx_failed" })).toBeNull();
  });
});

describe("rejectionAction (architecture section 7.1)", () => {
  const rejected = (codes: object, status = 400) => rejectionAction({ status, codes });

  it("rebuilds with fresh time bounds after tx_too_late", () => {
    expect(
      rejected({ transaction: "tx_fee_bump_inner_failed", innerTransaction: "tx_too_late" }).action,
    ).toBe("rebuild");
    expect(rejected({ transaction: "tx_too_late" }).action).toBe("rebuild");
  });

  it("raises the bid after tx_insufficient_fee", () => {
    expect(rejected({ transaction: "tx_insufficient_fee" }).action).toBe("raise-fee");
  });

  it("re-reads the sequence after tx_bad_seq", () => {
    expect(
      rejected({ transaction: "tx_fee_bump_inner_failed", innerTransaction: "tx_bad_seq" }).action,
    ).toBe("resequence");
  });

  it("backs off after a 429", () => {
    expect(rejected({}, 429).action).toBe("backoff");
  });

  it("stops on everything else, including a 400 without result codes", () => {
    for (const codes of [
      { transaction: "tx_bad_auth" },
      { transaction: "tx_fee_bump_inner_failed", innerTransaction: "tx_bad_auth_extra" },
      { transaction: "tx_insufficient_balance" },
      { transaction: "tx_no_source_account" },
      { transaction: "tx_malformed" },
      {},
    ]) {
      expect(rejected(codes).action).toBe("stop");
    }
  });
});

describe("explainCodes", () => {
  it("joins the codes and says what the failing one means", () => {
    const text = explainCodes(failed("op_success", "op_too_few_offers"));
    expect(text).toMatch(
      /^tx_fee_bump_inner_failed \/ tx_failed \/ op_success, op_too_few_offers: /,
    );
    expect(text).toMatch(/no path of offers/i);
  });

  it("explains a refusal and a response without codes", () => {
    expect(explainCodes({ transaction: "tx_insufficient_fee" })).toMatch(/surge/);
    expect(explainCodes({}, 429)).toMatch(/rate limit/i);
    expect(explainCodes({}, 400)).toMatch(/without result codes/);
  });
});
