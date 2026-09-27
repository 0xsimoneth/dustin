import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseEnv } from "node:util";
import { DustinError } from "../errors/dustin-error.js";

/** The only variables a `.env` file may supply; every other key in it is ignored (review R7). */
export const DOTENV_SECRET_NAMES = ["DUSTIN_ACCOUNT_SECRET", "DUSTIN_SPONSOR_SECRET"] as const;
export type SecretName = (typeof DOTENV_SECRET_NAMES)[number];

/**
 * Reads the two secrets from the `.env` file in `dir`, if there is one. The file is parsed with
 * Node's `util.parseEnv` (https://nodejs.org/api/util.html#utilparseenvcontent, added in v20.12.0
 * and v21.7.0), which returns an object and changes nothing: `process.env` never gains a key, and
 * settings such as `DUSTIN_HORIZON_URL` or `NODE_OPTIONS` in the file have no effect. Only
 * `dustin close --execute` calls this; `plan`, the dry-run `close` and `fixture` never open `.env`.
 */
export function readDotEnvSecrets(dir: string): Partial<Record<SecretName, string>> {
  let text: string;
  try {
    text = readFileSync(join(dir, ".env"), "utf8");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code ?? "unknown error";
    if (code === "ENOENT") return {};
    throw new DustinError(
      "CONFIG_INVALID",
      `Cannot read .env in the working directory (${code}).`,
      {
        stage: "config",
        remedy: "Fix or remove .env, or set the secrets in the environment instead.",
      },
    );
  }
  let parsed: NodeJS.Dict<string>;
  try {
    // A byte-order mark (some editors on Windows add one) would become part of the first key.
    parsed = parseEnv(text.replace(/^\uFEFF/, ""));
  } catch {
    // The parser's message could quote the file; it is not passed on.
    throw new DustinError("CONFIG_INVALID", "Cannot parse .env in the working directory.", {
      stage: "config",
      remedy: "Fix or remove .env, or set the secrets in the environment instead.",
    });
  }
  const secrets: Partial<Record<SecretName, string>> = {};
  for (const name of DOTENV_SECRET_NAMES) {
    const value = Object.hasOwn(parsed, name) ? parsed[name] : undefined;
    if (value !== undefined) secrets[name] = value;
  }
  return secrets;
}
