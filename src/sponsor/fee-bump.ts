import {
  TransactionBuilder,
  type FeeBumpTransaction,
  type Keypair,
  type Transaction,
} from "@stellar/stellar-sdk";

/**
 * Hex hash of a transaction. In @stellar/stellar-sdk 17.1.0 `hash()` returns a Uint8Array, so
 * `.toString("hex")` would print comma-separated decimals.
 */
export function hashHex(tx: Transaction | FeeBumpTransaction): string {
  return Buffer.from(tx.hash()).toString("hex");
}

/**
 * Wraps a signed inner transaction in a fee bump paid and signed by the sponsor. The sponsor signs
 * only the outer envelope; the inner transaction keeps its own source, sequence and signatures
 * (CAP-15, https://github.com/stellar/stellar-protocol/blob/master/core/cap-0015.md). The outer fee
 * is baseFee x (inner operations + 1).
 */
export function wrapInFeeBump(
  inner: Transaction,
  sponsor: Keypair,
  baseFeeStroops: number,
  networkPassphrase: string,
): FeeBumpTransaction {
  const feeBump = TransactionBuilder.buildFeeBumpTransaction(
    sponsor.publicKey(),
    String(baseFeeStroops),
    inner,
    networkPassphrase,
  );
  feeBump.sign(sponsor);
  return feeBump;
}
