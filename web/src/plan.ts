import {
  DustinError,
  inspectAccount,
  planClose,
  planFromSnapshot,
  remedyOf,
  type ClosePlan,
} from "stellar-dustin";
import { isAccountAddress } from "./address";
import type { PlanInputs } from "./inputs";

/**
 * Plans in the browser with the SDK's read-only planner: GET requests to the testnet Horizon,
 * nothing signed, nothing submitted, no secret anywhere. With a destination this is `planClose()`.
 * Without one, `planClose()` would refuse (a destination is required), so the page inspects the
 * account and plans from the snapshot: the planner then lists the cleanup it can see and marks the
 * plan BLOCKED with DESTINATION_MISSING, which is what the page promises for that case.
 */
export async function planInBrowser(inputs: PlanInputs): Promise<ClosePlan> {
  const options = {
    ...(inputs.sponsor ? { feeSponsor: inputs.sponsor } : {}),
    preferDestination: inputs.preferDestination,
  };
  if (inputs.destination) {
    return planClose({ account: inputs.account, destination: inputs.destination, ...options });
  }
  // planClose() validates the sponsor; planFromSnapshot() does not, so the same two rules are
  // applied here before anything is read, with the same StrKey check (checksum included; a shape
  // check let a mistyped address through to the plan and its explorer link, E5-S1 review EC-3).
  assertSponsor(inputs);
  const snapshot = await inspectAccount(inputs.account);
  return planFromSnapshot(snapshot, { destination: "", ...options });
}

function assertSponsor(inputs: PlanInputs): void {
  if (!inputs.sponsor) return;
  if (!isAccountAddress(inputs.sponsor)) {
    throw new DustinError("INVALID_ADDRESS", "The fee sponsor is not a valid G... address.", {
      stage: "plan",
      remedy: "Check the sponsor: a classic account is 56 characters starting with G.",
    });
  }
  if (inputs.sponsor === inputs.account) {
    throw new DustinError(
      "INVALID_ADDRESS",
      "The fee sponsor must be a different account from the one being closed.",
      { stage: "plan", remedy: "Use a separate, funded testnet account as the fee sponsor." },
    );
  }
}

/** An error in plain words: a title, the SDK's sentence, and what to do. */
export interface PlainError {
  code: string | null;
  title: string;
  message: string;
  remedy: string | null;
}

const TITLES: Readonly<Record<string, string>> = {
  INVALID_ADDRESS: "That address is not valid",
  CONTRACT_ACCOUNT: "Contract accounts are out of scope",
  HORIZON_UNAVAILABLE: "Horizon could not be reached",
  MAINNET_REFUSED: "Not the testnet",
  CONFIG_INVALID: "An option is not valid",
  LEDGER_DATA_INVALID: "Horizon answered something the planner cannot use",
};

/** A DustinError by its shape, so a second copy of the class (tests, bundling) is recognised too. */
export function isDustinError(error: unknown): error is DustinError {
  return (
    error instanceof Error &&
    error.name === "DustinError" &&
    typeof (error as { code?: unknown }).code === "string"
  );
}

export function describeError(error: unknown): PlainError {
  if (isDustinError(error)) {
    return {
      code: error.code,
      title: TITLES[error.code] ?? `Error ${error.code}`,
      message: error.message,
      remedy: remedyOf(error),
    };
  }
  return {
    code: null,
    title: "Unexpected error",
    message: error instanceof Error ? error.message : String(error),
    remedy:
      "Reload the page and try again; if it happens again, open an issue with the message above.",
  };
}
