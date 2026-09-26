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

const MISSING: Record<SecretName, DustinErrorCode> = {
  DUSTIN_ACCOUNT_SECRET: "MISSING_ACCOUNT_SECRET",
  DUSTIN_SPONSOR_SECRET: "MISSING_SPONSOR_SECRET",
};

const ROLE: Record<SecretName, string> = {
  DUSTIN_ACCOUNT_SECRET: "the secret key of the account being closed",
  DUSTIN_SPONSOR_SECRET: "the secret key of a funded testnet account that pays every fee",
};

/**
 * Reads and checks the two secrets of `dustin close --execute` (docs/README.md canonical decision
 * 4). A non-empty value in the process environment wins; otherwise the value comes from `.env` in
 * the working directory, which is read at most once and only when needed (review R7). Values are
 * never echoed: every error names the variable, never its content. The keypairs live only inside
 * the returned signers' closures.
 */
export function loadCloseSigners(account: string, sources: SecretSources): CloseSigners {
  let dotEnv: Partial<Record<SecretName, string>> | undefined;
  const lookup = (name: SecretName): { value: string; origin: string } => {
    const fromEnv = sources.env[name]?.trim();
    if (fromEnv) return { value: fromEnv, origin: "the environment" };
    dotEnv ??= sources.cwd === undefined ? {} : readDotEnvSecrets(sources.cwd);
    const fromFile = dotEnv[name]?.trim();
    if (fromFile) return { value: fromFile, origin: ".env" };
    throw new DustinError(
      MISSING[name],
      `${name} is not set: neither the environment nor .env in the working directory holds it.`,
      {
        stage: "config",
        remedy: `Set ${name} (${ROLE[name]}) in the environment or in .env; never pass a secret on the command line.`,
      },
    );
  };
  const keypair = (name: SecretName): Keypair => {
    const { value, origin } = lookup(name);
    if (!StrKey.isValidEd25519SecretSeed(value)) {
      throw new DustinError(
        "CONFIG_INVALID",
        `${name} from ${origin} is not a valid Stellar secret key; the value is not shown.`,
        {
          stage: "config",
          remedy: `A secret key is 56 characters starting with S. Check ${name}.`,
        },
      );
    }
    return Keypair.fromSecret(value);
  };

  const accountKeypair = keypair("DUSTIN_ACCOUNT_SECRET");
  const owner = accountKeypair.publicKey();
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
  const sponsorKeypair = keypair("DUSTIN_SPONSOR_SECRET");
  if (sponsorKeypair.publicKey() === account) {
    throw new DustinError(
      "INVALID_ADDRESS",
      "DUSTIN_SPONSOR_SECRET belongs to the account being closed; the fee sponsor must be a different account.",
      {
        stage: "config",
        remedy: "Use a separate, funded testnet account as the fee sponsor.",
      },
    );
  }
  return { account: keypairSigner(accountKeypair), feeSponsor: keypairSigner(sponsorKeypair) };
}
