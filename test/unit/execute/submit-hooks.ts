import { FeeBumpTransaction, Networks, TransactionBuilder } from "@stellar/stellar-sdk";
import type { Submitter } from "../../../src/execute/submit.js";

/** True when the envelope (a fee bump or a plain transaction) carries a strict-send path payment. */
export function carriesSale(envelopeXdr: string, networkPassphrase = Networks.TESTNET): boolean {
  const tx = TransactionBuilder.fromXDR(envelopeXdr, networkPassphrase);
  const inner = tx instanceof FeeBumpTransaction ? tx.innerTransaction : tx;
  return inner.operations.some((op) => op.type === "pathPaymentStrictSend");
}

/**
 * A submitter that runs `hook` once, right before it posts the first envelope carrying a
 * strict-send sale, and waits for it to finish before posting. It lets a test change the market
 * after the executor's fresh plan and before the sale reaches the ledger (AC-E3-S1-2); every other
 * call goes to `base` unchanged. Used offline on the fake ledger and live on testnet.
 */
export function beforeFirstSale(
  base: Submitter,
  hook: () => Promise<void>,
): Submitter & { fired: () => boolean } {
  let fired = false;
  return {
    ...base,
    async submit(envelopeXdr) {
      if (!fired && carriesSale(envelopeXdr)) {
        fired = true;
        await hook();
      }
      return base.submit(envelopeXdr);
    },
    fired: () => fired,
  };
}
