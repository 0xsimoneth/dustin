import { Asset, Operation, type xdr } from "@stellar/stellar-sdk";
import type { AssetRef } from "../inspect/snapshot.js";
import type { OperationDescriptor } from "../plan/model.js";

export function toSdkAsset(asset: AssetRef): Asset {
  return asset.type === "native" ? Asset.native() : new Asset(asset.code, asset.issuer);
}

/**
 * Maps a plan's operation descriptor onto the SDK operation, with the protocol's deletion idioms:
 * an offer is deleted with amount 0 and its id (any origin, day-1 experiment 2), a trustline with
 * limit "0" (a numeric 0 would become the maximum limit in SDK 17.1.0), a data entry with a null
 * value (https://developers.stellar.org/docs/learn/fundamentals/transactions/list-of-operations).
 */
export function toOperation(d: OperationDescriptor): xdr.Operation {
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
      return Operation.changeTrust({ asset: toSdkAsset(d.asset), limit: "0" });
    case "manageData":
      return Operation.manageData({ name: d.name, value: null });
    case "accountMerge":
      return Operation.accountMerge({ destination: d.destination });
  }
}
