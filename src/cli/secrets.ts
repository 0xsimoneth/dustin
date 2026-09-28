import { Keypair, StrKey } from "@stellar/stellar-sdk";
import { DustinError, type DustinErrorCode } from "../errors/dustin-error.js";
import { keypairSigner, type Signer } from "../sponsor/signer.js";
import { readDotEnvSecrets, type SecretName } from "./env.js";

export interface CloseSigners {
  /** Signs the inner transactions: the key of the account being closed. */
  account: Signer;
  /** Signs only the fee-bump envelopes and pays every fee. */
  feeSponsor: Signer;
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

interface Found {
  value: string;
  /** Where it came from, for messages: never the value itself. */
  origin: string;
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
  const sponsorKeypair = sponsorSigner(
    account,
    stored("DUSTIN_SPONSOR_SECRET") ?? missing("DUSTIN_SPONSOR_SECRET"),
  );
  return { account: keypairSigner(accountKeypair), feeSponsor: keypairSigner(sponsorKeypair) };
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
  const sponsorKeypair = sponsorSigner(
    account,
    stored("DUSTIN_SPONSOR_SECRET") ?? (await asked("DUSTIN_SPONSOR_SECRET", prompt)),
  );
  return { account: keypairSigner(accountKeypair), feeSponsor: keypairSigner(sponsorKeypair) };
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
  const value = answer?.trim();
  if (!value) {
    return missing(
      name,
      "no secret was typed at the hidden prompt (the input ended, or Ctrl-C was pressed)",
    );
  }
  return { value, origin: "the hidden prompt" };
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

function keypairOf(name: SecretName, found: Found): Keypair {
  if (!StrKey.isValidEd25519SecretSeed(found.value)) {
    throw new DustinError(
      "CONFIG_INVALID",
      `${name} from ${found.origin} is not a valid Stellar secret key; the value is not shown.`,
      {
        stage: "config",
        remedy: `A secret key is 56 characters starting with S. Check ${name}.`,
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
      `The secret in DUSTIN_ACCOUNT_SECRET belongs to ${owner}, not to the account ${account}.`,
      {
        stage: "config",
        remedy: "Set DUSTIN_ACCOUNT_SECRET to the secret key of the account being closed.",
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
      "DUSTIN_SPONSOR_SECRET belongs to the account being closed; the fee sponsor must be a different account.",
      {
        stage: "config",
        remedy: "Use a separate, funded testnet account as the fee sponsor.",
      },
    );
  }
  return keypair;
}
