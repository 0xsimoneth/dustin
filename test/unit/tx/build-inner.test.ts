import { Keypair, Memo } from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";
import { buildInnerTransaction } from "../../../src/tx/build-inner.js";

const account = Keypair.random().publicKey();
const TESTNET = "Test SDF Network ; September 2015";

describe("buildInnerTransaction", () => {
  it("uses the next sequence number, inner fee 0 and the given time bound", () => {
    const tx = buildInnerTransaction({
      account,
      sequence: "20935049285206020",
      operations: [{ type: "manageData", name: "k", value: null }],
      networkPassphrase: TESTNET,
      maxTime: 1_800_000_000,
    });
    expect(tx.source).toBe(account);
    expect(tx.sequence).toBe("20935049285206021");
    expect(tx.fee).toBe("0");
    expect(tx.timeBounds).toEqual({ minTime: "0", maxTime: "1800000000" });
    expect(tx.operations).toHaveLength(1);
    expect(tx.signatures).toHaveLength(0);
  });

  it("carries a text memo when given", () => {
    const tx = buildInnerTransaction({
      account,
      sequence: "1",
      operations: [{ type: "accountMerge", destination: Keypair.random().publicKey() }],
      networkPassphrase: TESTNET,
      maxTime: 1_800_000_000,
      memo: "42",
    });
    expect(tx.memo.type).toBe(Memo.text("42").type);
    expect(Buffer.from(tx.memo.value as Uint8Array).toString("utf8")).toBe("42");
  });

  it("refuses more than 100 operations and any network but testnet", () => {
    const ops = Array.from({ length: 101 }, () => ({
      type: "manageData" as const,
      name: "k",
      value: null,
    }));
    expect(() =>
      buildInnerTransaction({
        account,
        sequence: "1",
        operations: ops,
        networkPassphrase: TESTNET,
        maxTime: 1,
      }),
    ).toThrow(expect.objectContaining({ code: "TOO_MANY_OPERATIONS" }));
    expect(() =>
      buildInnerTransaction({
        account,
        sequence: "1",
        operations: ops.slice(0, 1),
        networkPassphrase: "Public Global Stellar Network ; September 2015",
        maxTime: 1,
      }),
    ).toThrow(expect.objectContaining({ code: "MAINNET_REFUSED" }));
  });
});
