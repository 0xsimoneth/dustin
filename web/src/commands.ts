import { isAccountAddress, isDestinationAddress } from "./address";
import type { PlanInputs } from "./inputs";

/**
 * The CLI commands for the plan on the form, as the README documents them. Only a valid Stellar
 * address (StrKey checksum included, E5-S1 review I-2) is written into a command; anything else is
 * shown as a placeholder, so the box never echoes arbitrary text as a command. Secrets are named
 * by their environment variables and never appear.
 */

export const ACCOUNT_SECRET_VAR = "DUSTIN_ACCOUNT_SECRET";
export const SPONSOR_SECRET_VAR = "DUSTIN_SPONSOR_SECRET";

function address(value: string, placeholder: string, muxedAllowed = false): string {
  if (isAccountAddress(value)) return value;
  if (muxedAllowed && isDestinationAddress(value)) return value;
  return placeholder;
}

/** `dustin plan`: read-only, no secret. */
export function planCommand(i: PlanInputs): string {
  const parts = [
    "npx stellar-dustin plan",
    address(i.account, "G<ACCOUNT>"),
    "--to",
    address(i.destination, "G<DESTINATION>", true),
  ];
  if (i.sponsor) parts.push("--sponsor", address(i.sponsor, "G<SPONSOR>"));
  if (i.preferDestination) parts.push("--prefer-destination");
  return parts.join(" ");
}

/** `dustin close --execute`: the secrets come from the environment, named here, never valued. */
export function closeCommand(i: PlanInputs): string {
  const parts = [
    "npx stellar-dustin close",
    address(i.account, "G<ACCOUNT>"),
    "--to",
    address(i.destination, "G<DESTINATION>", true),
  ];
  if (i.sponsor) parts.push("--sponsor", address(i.sponsor, "G<SPONSOR>"));
  parts.push("--execute");
  if (i.allowPartial) parts.push("--partial");
  if (i.preferDestination) parts.push("--prefer-destination");
  return [
    "# The two secret keys are read from the environment or .env, never from the command line:",
    `#   ${ACCOUNT_SECRET_VAR}   the account being closed`,
    `#   ${SPONSOR_SECRET_VAR}   the funded testnet sponsor that pays every fee`,
    parts.join(" "),
  ].join("\n");
}
