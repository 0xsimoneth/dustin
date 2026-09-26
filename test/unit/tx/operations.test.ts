import {
  Asset,
  Keypair,
  LiquidityPoolAsset,
  LiquidityPoolFeeV18,
  Operation,
  StrKey,
  getLiquidityPoolId,
  xdr,
} from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";
import type { OperationDescriptor } from "../../../src/plan/model.js";
import { toOperation } from "../../../src/tx/operations.js";

const issuer = Keypair.random().publicKey();
const account = Keypair.random().publicKey();
const DUST = { type: "credit_alphanum12" as const, code: "DUSTA", issuer };
const decode = (d: OperationDescriptor) =>
  Operation.fromXDRObject(toOperation(d)) as unknown as Record<string, unknown>;

describe("toOperation", () => {
  it("cancels an offer with amount 0, its own assets, price and id", () => {
    const op = decode({
      type: "manageSellOffer",
      offerId: "826680",
      selling: DUST,
      buying: { type: "native" },
      amount: "0",
      price: { n: 100, d: 1 },
    });
    expect(op).toMatchObject({
      type: "manageSellOffer",
      amount: "0.0000000",
      offerId: "826680",
      price: "100",
    });
    expect((op.selling as { code: string }).code).toBe("DUSTA");
    expect((op.buying as { isNative(): boolean }).isNative()).toBe(true);
  });

  it("builds a strict-send path payment to XLM with destMin and path", () => {
    const op = decode({
      type: "pathPaymentStrictSend",
      sendAsset: DUST,
      sendAmount: "0.0000007",
      destination: account,
      destAsset: { type: "native" },
      destMin: "0.0000006",
      path: [{ type: "credit_alphanum4", code: "LIQ", issuer }],
    });
    expect(op).toMatchObject({
      type: "pathPaymentStrictSend",
      sendAmount: "0.0000007",
      destMin: "0.0000006",
      destination: account,
    });
    expect((op.path as { code: string }[]).map((a) => a.code)).toEqual(["LIQ"]);
  });

  it("removes a trustline with limit 0, never the maximum", () => {
    const op = decode({ type: "changeTrust", asset: DUST, limit: "0" });
    expect(op).toMatchObject({ type: "changeTrust", limit: "0.0000000" });
  });

  it("removes an empty pool-share trustline with the pool's full asset, whatever the order", () => {
    const dust = new Asset("DUSTA", issuer);
    const poolId = Buffer.from(
      getLiquidityPoolId("constant_product", {
        assetA: Asset.native(),
        assetB: dust,
        fee: LiquidityPoolFeeV18,
      }),
    ).toString("hex");
    for (const assets of [
      ["native", `DUSTA:${issuer}`],
      [`DUSTA:${issuer}`, "native"],
    ] as [string, string][]) {
      const op = decode({
        type: "changeTrust",
        asset: { type: "liquidity_pool_shares", poolId, assets },
        limit: "0",
      });
      expect(op).toMatchObject({ type: "changeTrust", limit: "0.0000000" });
      const line = op.line as LiquidityPoolAsset;
      expect(line).toBeInstanceOf(LiquidityPoolAsset);
      expect(line.assetA.isNative()).toBe(true);
      expect(line.assetB.getCode()).toBe("DUSTA");
      expect(line.fee).toBe(30);
    }
  });

  it("refuses pool assets that do not hash to the pool id", () => {
    expect(() =>
      toOperation({
        type: "changeTrust",
        asset: {
          type: "liquidity_pool_shares",
          poolId: "ab".repeat(32),
          assets: ["native", `DUSTA:${issuer}`],
        },
        limit: "0",
      }),
    ).toThrow(/do not match liquidity pool/);
  });

  it("deletes data with a null value and pays the issuer", () => {
    expect(decode({ type: "manageData", name: "dustin.fixture", value: null })).toMatchObject({
      type: "manageData",
      name: "dustin.fixture",
      value: undefined,
    });
    expect(
      decode({ type: "payment", destination: issuer, asset: DUST, amount: "0.0000003" }),
    ).toMatchObject({ type: "payment", destination: issuer, amount: "0.0000003" });
  });

  it("merges into a G or an M destination", () => {
    expect(decode({ type: "accountMerge", destination: account })).toMatchObject({
      type: "accountMerge",
      destination: account,
    });
    const muxed = StrKey.encodeMed25519PublicKey(
      Buffer.concat([Keypair.random().rawPublicKey(), Buffer.alloc(8, 1)]),
    );
    const raw = toOperation({ type: "accountMerge", destination: muxed });
    expect(raw).toBeInstanceOf(xdr.Operation);
    expect(Operation.fromXDRObject(raw)).toMatchObject({ destination: muxed });
  });
});
