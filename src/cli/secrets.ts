import { Keypair, StrKey } from "@stellar/stellar-sdk";
import { DustinError, type DustinErrorCode } from "../errors/dustin-error.js";
import { keypairSigner, type Signer } from "../sponsor/signer.js";
import { readDotEnvSecrets, type SecretName } from "./env.js";

export interface CloseSigners {
  /** Signs the inner transactions: the key of the account being closed. */
  account: Signer;
  /** Signs only the fee-bump envelopes and pays every fee. */
  feeSponsor: Signer;
  /**
   * The sponsor's secret as a message names it, with where it came from, never its value: "the
   * secret key in DUSTIN_SPONSOR_SECRET (from the environment)" (Epic 4 review EX-10).
   */
  sponsorSource?: string;
}

export interface SecretSources {
  env: Record<string, string | undefined>;
  /** Working directory whose `.env` is the fallback; without it no file is read. */
  cwd?: string;
}

/**
 * Asks for one secret with the input hidden (review finding CA-18, PRD decision D-11). Resolves with
 * what was typed; with null on Ctrl-C or at the end of input, which count as a missing secret; or
 * with `{ unasked }`, naming why it could not be asked (a stream that is not a terminal).
 */
export type SecretPrompt = (question: string) => Promise<string | null | { unasked: string }>;

const MISSING: Record<SecretName, DustinErrorCode> = {
  DUSTIN_ACCOUNT_SECRET: "MISSING_ACCOUNT_SECRET",
  DUSTIN_SPONSOR_SECRET: "MISSING_SPONSOR_SECRET",
};

const ROLE: Record<SecretName, string> = {
  DUSTIN_ACCOUNT_SECRET: "the secret key of the account being closed",
  DUSTIN_SPONSOR_SECRET: "the secret key of a funded testnet account that pays every fee",
};

/** Where a secret came from: the process environment, `.env`, or the hidden prompt. */
type Origin = "the environment" | ".env" | "the hidden prompt";

const PROMPT: Origin = "the hidden prompt";

interface Found {
  value: string;
  /** Where it came from, for messages: never the value itself. */
  origin: Origin;
}

/** The two signers, and how the sponsor's secret is named in a message. */
function closeSigners(accountKeypair: Keypair, sponsorKeypair: Keypair, sponsor: Found) {
  return {
    account: keypairSigner(accountKeypair),
    feeSponsor: keypairSigner(sponsorKeypair),
    sponsorSource: secretSource("DUSTIN_SPONSOR_SECRET", sponsor),
  };
}

/**
 * Reads and checks the two secrets of `dustin close --execute` (docs/README.md canonical decision
 * 4). A non-empty value in the process environment wins; otherwise the value comes from `.env` in
 * the working directory, which is read at most once and only when needed (review R7). Values are
 * never echoed: every error names the variable, never its content. The keypairs live only inside
 * the returned signers' closures. This form never asks; `askCloseSigners` adds the hidden prompt.
 */
export function loadCloseSigners(account: string, sources: SecretSources): CloseSigners {
  const stored = storedSecrets(sources);
  const accountKeypair = accountSigner(
    account,
    stored("DUSTIN_ACCOUNT_SECRET") ?? missing("DUSTIN_ACCOUNT_SECRET"),
  );
  const sponsor = stored("DUSTIN_SPONSOR_SECRET") ?? missing("DUSTIN_SPONSOR_SECRET");
  return closeSigners(accountKeypair, sponsorSigner(account, sponsor), sponsor);
}

/**
 * The same, with the third source of canonical decision 4 (review finding CA-18, PRD decision
 * D-11): a secret that neither the environment nor `.env` holds is asked for with `prompt`, whose
 * input is hidden. The account's secret is asked and checked first, so a wrong one is refused
 * before the sponsor's is asked. Without a prompt it is `loadCloseSigners`.
 */
export async function askCloseSigners(
  account: string,
  sources: SecretSources,
  prompt: SecretPrompt | undefined,
): Promise<CloseSigners> {
  if (!prompt) return loadCloseSigners(account, sources);
  const stored = storedSecrets(sources);
  const accountKeypair = accountSigner(
    account,
    stored("DUSTIN_ACCOUNT_SECRET") ?? (await asked("DUSTIN_ACCOUNT_SECRET", prompt)),
  );
  const sponsor = stored("DUSTIN_SPONSOR_SECRET") ?? (await asked("DUSTIN_SPONSOR_SECRET", prompt));
  return closeSigners(accountKeypair, sponsorSigner(account, sponsor), sponsor);
}

/** A lookup in the environment, then in `.env`, which is read at most once. */
function storedSecrets(sources: SecretSources): (name: SecretName) => Found | null {
  let dotEnv: Partial<Record<SecretName, string>> | undefined;
  return (name) => {
    const fromEnv = sources.env[name]?.trim();
    if (fromEnv) return { value: fromEnv, origin: "the environment" };
    dotEnv ??= sources.cwd === undefined ? {} : readDotEnvSecrets(sources.cwd);
    const fromFile = dotEnv[name]?.trim();
    if (fromFile) return { value: fromFile, origin: ".env" };
    return null;
  };
}

/** The secret typed at the hidden prompt, or the MISSING error when none was. */
async function asked(name: SecretName, prompt: SecretPrompt): Promise<Found> {
  let answer: string | null | { unasked: string };
  try {
    answer = await prompt(
      `${name} is not set in the environment or in .env. Type ${ROLE[name]} (the input is hidden): `,
    );
  } catch {
    answer = null;
  }
  if (answer !== null && typeof answer === "object") {
    return missing(name, `the hidden prompt was not asked: ${answer.unasked}`);
  }
  if (answer === null) {
    return missing(
      name,
      "no secret was typed at the hidden prompt (the input ended, or Ctrl-C was pressed)",
    );
  }
  const value = answer.trim();
  if (!value) {
    // Epic 4 review BH-21: Enter on an empty line is neither the end of input nor Ctrl-C.
    return missing(name, "no secret was typed at the hidden prompt (the line entered was empty)");
  }
  return { value, origin: PROMPT };
}

function missing(name: SecretName, why?: string): never {
  throw new DustinError(
    MISSING[name],
    `${name} is not set: neither the environment nor .env in the working directory holds it${why ? `, and ${why}` : ""}.`,
    {
      stage: "config",
      remedy: `Set ${name} (${ROLE[name]}) in the environment or in .env, or run close --execute in a terminal without --json to type it at a hidden prompt; never pass a secret on the command line.`,
    },
  );
}

/**
 * The secret as a message names it, with where it came from (Epic 4 review EX-10): the
 * environment, `.env` or the hidden prompt. Never the value.
 */
export function secretSource(name: SecretName, found: Pick<Found, "origin">): string {
  return found.origin === PROMPT
    ? `the secret key typed at the hidden prompt for ${name}`
    : `the secret key in ${name} (from ${found.origin === ".env" ? ".env in the working directory" : found.origin})`;
}

/** What to do about a wrong secret, where it came from (Epic 4 review EX-10). */
function fixAt(name: SecretName, found: Found, what: string): string {
  if (found.origin === PROMPT) {
    return `Run the command again and type ${what} at the hidden prompt, or set ${name} in the environment or in .env.`;
  }
  if (found.origin === ".env") {
    return `Set ${name} in .env to ${what}; a value in the environment would take precedence over it.`;
  }
  return `Set ${name} in the environment to ${what}.`;
}

const capital = (text: string) => `${text.charAt(0).toUpperCase()}${text.slice(1)}`;

function keypairOf(name: SecretName, found: Found): Keypair {
  if (!StrKey.isValidEd25519SecretSeed(found.value)) {
    throw new DustinError(
      "CONFIG_INVALID",
      `${capital(secretSource(name, found))} is not a valid Stellar secret key; the value is not shown.`,
      {
        stage: "config",
        remedy: `A secret key is 56 characters starting with S. ${fixAt(name, found, ROLE[name])}`,
      },
    );
  }
  return Keypair.fromSecret(found.value);
}

function accountSigner(account: string, found: Found): Keypair {
  const keypair = keypairOf("DUSTIN_ACCOUNT_SECRET", found);
  const owner = keypair.publicKey();
  if (owner !== account) {
    throw new DustinError(
      "WRONG_SIGNER",
      `${capital(secretSource("DUSTIN_ACCOUNT_SECRET", found))} belongs to ${owner}, not to the account ${account}.`,
      {
        stage: "config",
        remedy: fixAt("DUSTIN_ACCOUNT_SECRET", found, ROLE.DUSTIN_ACCOUNT_SECRET),
      },
    );
  }
  return keypair;
}

function sponsorSigner(account: string, found: Found): Keypair {
  const keypair = keypairOf("DUSTIN_SPONSOR_SECRET", found);
  if (keypair.publicKey() === account) {
    throw new DustinError(
      "INVALID_ADDRESS",
      `${capital(secretSource("DUSTIN_SPONSOR_SECRET", found))} belongs to the account being closed; the fee sponsor must be a different account.`,
      {
        stage: "config",
        remedy: `Use a separate, funded testnet account as the fee sponsor. ${fixAt("DUSTIN_SPONSOR_SECRET", found, "its secret key")}`,
      },
    );
  }
  return keypair;
}
