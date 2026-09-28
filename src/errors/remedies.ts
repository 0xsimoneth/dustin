import type { DustinError, DustinErrorCode } from "./dustin-error.js";

/**
 * What to do about each error code when the error itself names no remedy (AC-E4-S2-1, story
 * E4-S2): the remedies of docs/errors.md. An error raised with a remedy keeps its own, which is
 * more specific; `remedyOf` falls back to these, and the CLI prints the result under every error.
 * The table is partial on purpose: a code added to DustinErrorCode without an entry gets the pointer
 * to docs/errors.md instead of a compile error, and test/unit/errors/remedies.test.ts asks for one.
 */
export const DEFAULT_REMEDIES: Partial<Readonly<Record<DustinErrorCode, string>>> = {
  MISSING_ACCOUNT_SECRET:
    "Set DUSTIN_ACCOUNT_SECRET in the environment or in .env, or run close --execute in a terminal without --json to type it at a hidden prompt; never pass a secret on the command line.",
  MISSING_SPONSOR_SECRET:
    "Set DUSTIN_SPONSOR_SECRET in the environment or in .env, or run close --execute in a terminal without --json to type it at a hidden prompt; never pass a secret on the command line.",
  CONFIRMATION_DECLINED:
    "Run the command in a terminal and type the last 4 characters of the destination, or add --yes for a non-interactive run (it works only with --execute).",
  CONFIRMATION_REQUIRED:
    "Show the plan to the account holder first; then add --yes (CLI) or pass confirm: true (SDK).",
  EXECUTION_INTERRUPTED:
    "Look up the hashes in the report, then run the close again: it reads the account again and plans only what is left.",
  NOT_IMPLEMENTED: "This is not built in this release; docs/prd.md section 6 lists what is.",
  CONFIG_INVALID: "Fix the option, setting or file the message names, then run again.",
  MAINNET_REFUSED:
    "Use the Stellar testnet: leave --network out (or pass --network testnet) and point DUSTIN_HORIZON_URL at a testnet Horizon.",
  SECRET_IN_ARGV:
    "Put secrets in DUSTIN_ACCOUNT_SECRET and DUSTIN_SPONSOR_SECRET instead, never on the command line.",
  HORIZON_UNAVAILABLE: "Check the network connection or the Horizon URL, then try again.",
  FRIENDBOT_FAILED:
    "Friendbot may be rate-limited or down: wait a minute, then run the fixture command again.",
  FIXTURE_STEP_FAILED:
    "Look the step's transaction up on the explorer, then build a fresh fixture with dustin fixture create.",
  FIXTURE_INVALID: "Build a fresh fixture with dustin fixture create.",
  MANIFEST_INVALID: "Pass the manifest.json that dustin fixture create wrote, unchanged.",
  INVALID_ADDRESS:
    "Check the address: a classic account is 56 characters starting with G; a destination may also be a muxed M... address.",
  CONTRACT_ACCOUNT:
    "Pass a classic G... account; contract (C...) accounts are out of scope in this release.",
  TOO_MANY_OPERATIONS:
    "The planner never groups more than 100 operations, so this is a bug; report it with the plan.",
  SPONSOR_REFUSED:
    "The sponsor signs only fee bumps of the closing account's own transactions; through executeClose this is a bug, so report it with the report.",
  SPONSOR_BUDGET_EXCEEDED:
    "Raise the close budget or wait for network fees to fall (with the CLI, lower the bid with --base-fee), then run the close again.",
  SPONSOR_UNDERFUNDED: "Fund the fee sponsor (on testnet, from Friendbot) and run the close again.",
  WRONG_SIGNER:
    "Use the secret key of the account being closed for DUSTIN_ACCOUNT_SECRET, and the fee sponsor's for DUSTIN_SPONSOR_SECRET.",
  ACCOUNT_NOT_FOUND:
    "Check the address; if an earlier close merged the account, there is nothing left to close.",
  RESET_SUSPECTED:
    "A testnet reset deletes every account a fixture had: build a new one with dustin fixture create (new keys, new manifest).",
};

/** The fallback for a code without an entry. */
export const REMEDY_POINTER = "See docs/errors.md for what this code means and what to do.";

/** The error's own remedy, else the default one for its code (docs/errors.md). */
export function remedyOf(error: Pick<DustinError, "code" | "remedy">): string {
  return error.remedy ?? DEFAULT_REMEDIES[error.code] ?? REMEDY_POINTER;
}
