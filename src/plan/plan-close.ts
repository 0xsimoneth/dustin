import { StrKey } from "@stellar/stellar-sdk";
import type { DustinConfig } from "../config/network.js";
import { DustinError } from "../errors/dustin-error.js";
import { inspectAccount } from "../inspect/inspect.js";
import type { LedgerReader } from "../reader/ledger-reader.js";
import type { ClosePlan, PlanOptions } from "./model.js";
import { planFromSnapshot } from "./plan.js";

export interface PlanCloseInput extends PlanOptions {
  /** The G... account to close. */
  account: string;
}

export interface PlanCloseOptions {
  config?: DustinConfig;
  /** Custom ledger reader; defaults to Horizon from `config`. */
  reader?: LedgerReader;
}

/**
 * The read-only planner (SOW Deliverable 1). It inspects the account with GET requests and returns
 * the ordered close plan. It accepts no secret and cannot sign or submit anything.
 */
export async function planClose(
  input: PlanCloseInput,
  options: PlanCloseOptions = {},
): Promise<ClosePlan> {
  if (!input.destination) {
    throw new DustinError(
      "INVALID_ADDRESS",
      "A destination is required: the account merges into it.",
      {
        stage: "plan",
        remedy: "Pass the destination with --to (SDK: `destination`).",
      },
    );
  }
  if (input.feeSponsor !== undefined) {
    if (!StrKey.isValidEd25519PublicKey(input.feeSponsor)) {
      throw new DustinError("INVALID_ADDRESS", "The fee sponsor is not a valid G... address.", {
        stage: "plan",
      });
    }
    if (input.feeSponsor === input.account) {
      throw new DustinError(
        "INVALID_ADDRESS",
        "The fee sponsor must be a different account from the one being closed.",
        { stage: "plan", remedy: "Use a separate, funded testnet account as the fee sponsor." },
      );
    }
  }
  const snapshot = await inspectAccount(input.account, {
    destination: input.destination,
    ...(options.config ? { config: options.config } : {}),
    ...(options.reader ? { reader: options.reader } : {}),
  });
  return planFromSnapshot(snapshot, input);
}
