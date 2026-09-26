import { describe, expect, it } from "vitest";
import { executeClose } from "../../../src/execute/executor.js";
import { messy } from "../../helpers/snapshots.js";
import { harness, signers } from "./harness.js";

// Findings of the independent review of the E2-S3 executor (2026-09-26). Every test here runs on
// an injected clock: no fake global Date, no real waiting.

describe("review finding 8: the fake ledger names a missing source as Horizon does", () => {
  it("answers tx_no_source_account, stellar-horizon's string for TxNoAccount", async () => {
    const { ledger, deps, plan } = harness();
    const report = await executeClose(await plan(), signers(), {
      confirm: true,
      ...deps,
      onEvent: (e) => {
        // The account is merged elsewhere while the first envelope is on its way.
        if (e.type === "tx:submitted" && e.index === 0) ledger.accounts.delete(messy.fixture);
      },
    });
    expect(report.transactions[0]!.resultCodes).toEqual({
      transaction: "tx_fee_bump_inner_failed",
      innerTransaction: "tx_no_source_account",
    });
  });
});
