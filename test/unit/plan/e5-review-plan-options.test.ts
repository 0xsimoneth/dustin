import { describe, expect, it } from "vitest";
import { validatePlanOptions } from "../../../src/plan/plan.js";

// E5-S1 review, S2 (EC-2 of the first pass): `Buffer.byteLength(memo, "utf8")` threw a TypeError
// for a memo that was not a string; the `TextEncoder` that replaced it coerces one (123 becomes
// "123"), so a JavaScript caller's number or object would have passed validation and reached the
// transaction. The option is checked by type first.

const validate = (memo: unknown) => () =>
  validatePlanOptions({ destination: "", memo: memo as string });

describe("validatePlanOptions, the memo's type (E5-S1 review, S2)", () => {
  it("refuses a memo that is not a string with CONFIG_INVALID", () => {
    for (const memo of [123, true, {}, [], null, Symbol("m")]) {
      expect(validate(memo)).toThrow(expect.objectContaining({ code: "CONFIG_INVALID" }));
      expect(validate(memo)).toThrow(/memo must be a string/);
    }
  });

  it("keeps accepting a string memo of at most 28 bytes, and refusing a longer one", () => {
    expect(validate("a memo of 28 bytes exactly!!")).not.toThrow();
    expect(validate("")).not.toThrow();
    expect(() => validatePlanOptions({ destination: "" })).not.toThrow();
    expect(validate("a memo of 29 bytes exactly!!!")).toThrow(
      expect.objectContaining({ code: "CONFIG_INVALID" }),
    );
    expect(validate("a memo of 29 bytes exactly!!!")).toThrow(/memo must be at most 28 bytes/);
  });
});
