import { StrKey } from "@stellar/stellar-sdk";
import { DustinError } from "../errors/dustin-error.js";

/** Classic G accounts only (SOW out of scope: contract C accounts). */
export function assertAccountAddress(address: string): void {
  if (StrKey.isValidEd25519PublicKey(address)) return;
  if (StrKey.isValidContract(address)) {
    throw new DustinError(
      "CONTRACT_ACCOUNT",
      "Contract (C...) accounts are out of scope; Dustin closes classic G... accounts only.",
      { stage: "inspect", remedy: "Pass the G... address of a classic account." },
    );
  }
  if (StrKey.isValidMed25519PublicKey(address)) {
    throw new DustinError("INVALID_ADDRESS", "The account to close must be a G... address.", {
      stage: "inspect",
      remedy: "Pass the underlying G... account of the muxed address.",
    });
  }
  throw new DustinError("INVALID_ADDRESS", "The account to close is not a valid G... address.", {
    stage: "inspect",
    remedy: "Check the address: a classic account is 56 characters starting with G.",
  });
}

/**
 * The merge destination may be a G... account or a muxed M... address
 * (https://developers.stellar.org/docs/build/guides/transactions/pooled-accounts-muxed-accounts-memos).
 * Returns the G... account that holds the balance.
 */
export function destinationBaseAccount(address: string): string {
  if (StrKey.isValidEd25519PublicKey(address)) return address;
  if (StrKey.isValidMed25519PublicKey(address)) {
    // The first 32 bytes are the ed25519 key, the last 8 the muxed id (SEP-23); the SDK takes and
    // returns Uint8Array, so no Buffer is needed (story E5-S1).
    const raw = StrKey.decodeMed25519PublicKey(address);
    return StrKey.encodeEd25519PublicKey(raw.subarray(0, 32));
  }
  if (StrKey.isValidContract(address)) {
    throw new DustinError("CONTRACT_ACCOUNT", "A contract (C...) destination is out of scope.", {
      stage: "inspect",
      remedy: "Choose a G... or M... destination with --to.",
    });
  }
  throw new DustinError("INVALID_ADDRESS", "The destination is not a valid G... or M... address.", {
    stage: "inspect",
    remedy:
      "Check the destination passed with --to: 56 characters starting with G, or a muxed M... address.",
  });
}
