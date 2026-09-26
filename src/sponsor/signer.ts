import type { FeeBumpTransaction, Keypair, Transaction } from "@stellar/stellar-sdk";

/**
 * Anything that can add its signature to a transaction: a keypair, a wallet, a hardware device.
 * The engine never needs a secret, only this interface.
 */
export interface Signer {
  publicKey(): string;
  sign(tx: Transaction | FeeBumpTransaction): void | Promise<void>;
}

/** A signer backed by a keypair held in a closure; serialising it reveals nothing. */
export function keypairSigner(keypair: Keypair): Signer {
  const publicKey = keypair.publicKey();
  return {
    publicKey: () => publicKey,
    sign: (tx) => {
      tx.sign(keypair);
    },
  };
}
