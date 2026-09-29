import {
  Asset,
  LiquidityPoolAsset,
  LiquidityPoolFeeV18,
  Operation,
  getLiquidityPoolId,
  type xdr,
} from "@stellar/stellar-sdk";
import { DustinError } from "../errors/dustin-error.js";
import type { AssetRef } from "../inspect/snapshot.js";
import type { OperationDescriptor, PoolShareAssetRef } from "../plan/model.js";

export function toSdkAsset(asset: AssetRef): Asset {
  return asset.type === "native" ? Asset.native() : new Asset(asset.code, asset.issuer);
}

function horizonAsset(label: string): Asset {
  if (label === "native") return Asset.native();
  const [code, issuer] = label.split(":");
  return new Asset(code ?? "", issuer);
}

/**
 * ChangeTrustOp takes a pool share's full representation: both assets in lexicographic order and
 * the fee, 30 bps (https://developers.stellar.org/docs/learn/fundamentals/liquidity-on-stellar-sdex-liquidity-pools#liquidity-pool-participation).
 * The assets come from Horizon, so they must hash to the pool id the account holds.
 */
function poolShareAsset(ref: PoolShareAssetRef): LiquidityPoolAsset {
  const [assetA, assetB] = ref.assets.map(horizonAsset).sort((a, b) => Asset.compare(a, b)) as [
    Asset,
    Asset,
  ];
  const id = Buffer.from(
    getLiquidityPoolId("constant_product", { assetA, assetB, fee: LiquidityPoolFeeV18 }),
  ).toString("hex");
  if (id !== ref.poolId) {
    // Epic 4 review AC-12: a DustinError, as every error of the SDK is.
    throw new DustinError(
      "LEDGER_DATA_INVALID",
      `The assets ${ref.assets.join(" / ")} do not match liquidity pool ${ref.poolId}.`,
      { stage: "build" },
    );
  }
  return new LiquidityPoolAsset(assetA, assetB, LiquidityPoolFeeV18);
}

/**
 * Maps a plan's operation descriptor onto the SDK operation, with the protocol's deletion idioms:
 * an offer is deleted with amount 0 and its id (any origin, day-1 experiment 2), a trustline with
 * limit "0" (a numeric 0 would become the maximum limit in SDK 17.1.0), a data entry with a null
 * value (https://developers.stellar.org/docs/learn/fundamentals/transactions/list-of-operations).
 * A descriptor the SDK refuses (an asset code or an address it cannot encode) is refused with
 * LEDGER_DATA_INVALID, its error the cause (Epic 4 review AC-12): the values come from Horizon,
 * or from a plan built from what Horizon answered.
 */
export function toOperation(d: OperationDescriptor): xdr.Operation {
  try {
    return sdkOperation(d);
  } catch (error) {
    if (error instanceof DustinError) throw error;
    throw new DustinError(
      "LEDGER_DATA_INVALID",
      `The ${d.type} operation of the plan cannot be encoded: ${error instanceof Error ? error.message : String(error)}.`,
      { stage: "build", cause: error },
    );
  }
}

function sdkOperation(d: OperationDescriptor): xdr.Operation {
  switch (d.type) {
    case "manageSellOffer":
      return Operation.manageSellOffer({
        selling: toSdkAsset(d.selling),
        buying: toSdkAsset(d.buying),
        amount: "0",
        price: d.price,
        offerId: d.offerId,
      });
    case "pathPaymentStrictSend":
      return Operation.pathPaymentStrictSend({
        sendAsset: toSdkAsset(d.sendAsset),
        sendAmount: d.sendAmount,
        destination: d.destination,
        destAsset: Asset.native(),
        destMin: d.destMin,
        path: d.path.map(toSdkAsset),
      });
    case "payment":
      return Operation.payment({
        destination: d.destination,
        asset: toSdkAsset(d.asset),
        amount: d.amount,
      });
    case "changeTrust":
      return Operation.changeTrust({
        asset:
          d.asset.type === "liquidity_pool_shares" ? poolShareAsset(d.asset) : toSdkAsset(d.asset),
        limit: "0",
      });
    case "manageData":
      return Operation.manageData({ name: d.name, value: null });
    case "accountMerge":
      return Operation.accountMerge({ destination: d.destination });
  }
}
