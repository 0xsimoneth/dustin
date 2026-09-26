import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Keypair } from "@stellar/stellar-sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readDotEnvSecrets } from "../../../src/cli/env.js";
import { ExitCode, exitCodeFor } from "../../../src/cli/exit-codes.js";
import { run } from "../../../src/cli/run.js";
import { loadCloseSigners } from "../../../src/cli/secrets.js";
import { DustinError } from "../../../src/errors/dustin-error.js";
import { MESSY_DIR, loadRecorded, recordedFetch } from "../../helpers/recorded-horizon.js";
import { messy } from "../../helpers/snapshots.js";

// Review R7: only `close --execute` reads `.env`, with util.parseEnv, and only the two secrets.

const recorded = loadRecorded(MESSY_DIR);
const SECRET_KEYS = ["DUSTIN_ACCOUNT_SECRET", "DUSTIN_SPONSOR_SECRET"];

function tempDir(dotEnv?: string): string {
  const dir = mkdtempSync(join(tmpdir(), "dustin-env-"));
  if (dotEnv !== undefined) writeFileSync(join(dir, ".env"), dotEnv, { mode: 0o600 });
  return dir;
}

/** The same key with its last character changed, so its checksum can never be valid. */
const lastCharacterChanged = (secret: string) =>
  `${secret.slice(0, -1)}${secret.endsWith("A") ? "B" : "A"}`;

const accountKeys = Keypair.random();
const sponsorKeys = Keypair.random();

afterEach(() => {
  vi.restoreAllMocks();
});

describe("readDotEnvSecrets", () => {
  it("returns only the two secrets and ignores every other key", () => {
    const dir = tempDir(
      [
        "# a comment",
        `DUSTIN_ACCOUNT_SECRET=${accountKeys.secret()}`,
        `DUSTIN_SPONSOR_SECRET="${sponsorKeys.secret()}"`,
        "DUSTIN_HORIZON_URL=https://horizon.example.org",
        "DUSTIN_EXPLORER_BASE=https://explorer.example.org",
        "NODE_OPTIONS=--require ./evil.js",
        "",
      ].join("\n"),
    );
    expect(readDotEnvSecrets(dir)).toEqual({
      DUSTIN_ACCOUNT_SECRET: accountKeys.secret(),
      DUSTIN_SPONSOR_SECRET: sponsorKeys.secret(),
    });
  });

  it("never touches process.env and never calls process.loadEnvFile", () => {
    const before = { ...process.env };
    const load = vi.spyOn(process, "loadEnvFile");
    const dir = tempDir(`DUSTIN_ACCOUNT_SECRET=${accountKeys.secret()}\nDUSTIN_PROBE=1\n`);
    readDotEnvSecrets(dir);
    expect(load).not.toHaveBeenCalled();
    expect(process.env).toEqual(before);
    for (const key of [...SECRET_KEYS, "DUSTIN_PROBE"]) expect(process.env[key]).toBeUndefined();
  });

  it("treats a missing .env as empty and an unreadable one as a configuration error", () => {
    expect(readDotEnvSecrets(tempDir())).toEqual({});
    const dir = tempDir();
    mkdirSync(join(dir, ".env"));
    let error: unknown;
    try {
      readDotEnvSecrets(dir);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(DustinError);
    expect(error).toMatchObject({ code: "CONFIG_INVALID" });
    expect(exitCodeFor(error as DustinError)).toBe(ExitCode.USAGE);
  });
});

describe("loadCloseSigners", () => {
  const account = accountKeys.publicKey();
  const env = (values: Record<string, string>) => values;

  it("takes both secrets from the environment without reading .env", () => {
    const dir = tempDir();
    mkdirSync(join(dir, ".env")); // unreadable: proves the file is not opened
    const signers = loadCloseSigners(account, {
      env: env({
        DUSTIN_ACCOUNT_SECRET: accountKeys.secret(),
        DUSTIN_SPONSOR_SECRET: sponsorKeys.secret(),
      }),
      cwd: dir,
    });
    expect(signers.account.publicKey()).toBe(account);
    expect(signers.feeSponsor.publicKey()).toBe(sponsorKeys.publicKey());
  });

  it("falls back to .env, and a non-empty environment value wins over .env", () => {
    const other = Keypair.random();
    const dir = tempDir(
      `DUSTIN_ACCOUNT_SECRET=${accountKeys.secret()}\nDUSTIN_SPONSOR_SECRET=${other.secret()}\n`,
    );
    const fromFile = loadCloseSigners(account, { env: {}, cwd: dir });
    expect(fromFile.account.publicKey()).toBe(account);
    expect(fromFile.feeSponsor.publicKey()).toBe(other.publicKey());
    const mixed = loadCloseSigners(account, {
      env: env({ DUSTIN_SPONSOR_SECRET: sponsorKeys.secret(), DUSTIN_ACCOUNT_SECRET: "  " }),
      cwd: dir,
    });
    expect(mixed.account.publicKey()).toBe(account);
    expect(mixed.feeSponsor.publicKey()).toBe(sponsorKeys.publicKey());
  });

  it("reads no .env at all when no working directory is given", () => {
    expect(() => loadCloseSigners(account, { env: {} })).toThrow(
      expect.objectContaining({ code: "MISSING_ACCOUNT_SECRET" }),
    );
  });

  const failures: Array<[string, () => void, string, number]> = [
    [
      "missing account secret",
      () =>
        loadCloseSigners(account, { env: env({ DUSTIN_SPONSOR_SECRET: sponsorKeys.secret() }) }),
      "MISSING_ACCOUNT_SECRET",
      ExitCode.USAGE,
    ],
    [
      "missing sponsor secret",
      () =>
        loadCloseSigners(account, { env: env({ DUSTIN_ACCOUNT_SECRET: accountKeys.secret() }) }),
      "MISSING_SPONSOR_SECRET",
      ExitCode.USAGE,
    ],
    [
      "malformed account secret",
      () =>
        loadCloseSigners(account, {
          env: env({
            DUSTIN_ACCOUNT_SECRET: lastCharacterChanged(accountKeys.secret()),
            DUSTIN_SPONSOR_SECRET: sponsorKeys.secret(),
          }),
        }),
      "CONFIG_INVALID",
      ExitCode.USAGE,
    ],
    [
      "malformed sponsor secret",
      () =>
        loadCloseSigners(account, {
          env: env({
            DUSTIN_ACCOUNT_SECRET: accountKeys.secret(),
            DUSTIN_SPONSOR_SECRET: "hunter2",
          }),
        }),
      "CONFIG_INVALID",
      ExitCode.USAGE,
    ],
    [
      "account secret of another account",
      () =>
        loadCloseSigners(account, {
          env: env({
            DUSTIN_ACCOUNT_SECRET: sponsorKeys.secret(),
            DUSTIN_SPONSOR_SECRET: Keypair.random().secret(),
          }),
        }),
      "WRONG_SIGNER",
      ExitCode.USAGE,
    ],
    [
      "sponsor secret equal to the account's",
      () =>
        loadCloseSigners(account, {
          env: env({
            DUSTIN_ACCOUNT_SECRET: accountKeys.secret(),
            DUSTIN_SPONSOR_SECRET: accountKeys.secret(),
          }),
        }),
      "INVALID_ADDRESS",
      ExitCode.USAGE,
    ],
  ];

  for (const [name, attempt, code, exit] of failures) {
    it(`refuses a ${name} with ${code} (exit ${exit}) and never echoes a secret`, () => {
      let error: unknown;
      try {
        attempt();
      } catch (e) {
        error = e;
      }
      expect(error).toBeInstanceOf(DustinError);
      const e = error as DustinError;
      expect(e.code).toBe(code);
      expect(exitCodeFor(e)).toBe(exit);
      const text = JSON.stringify(e.toJSON()) + e.message + (e.remedy ?? "");
      for (const k of [accountKeys, sponsorKeys]) {
        expect(text).not.toContain(k.secret());
        expect(text).not.toContain(k.secret().slice(0, 55));
      }
      expect(text).not.toContain("hunter2");
    });
  }

  it("names the owner of a wrong account secret by its public key", () => {
    expect(() =>
      loadCloseSigners(account, {
        env: env({
          DUSTIN_ACCOUNT_SECRET: sponsorKeys.secret(),
          DUSTIN_SPONSOR_SECRET: Keypair.random().secret(),
        }),
      }),
    ).toThrow(sponsorKeys.publicKey());
  });
});

describe("plan and the dry-run close never read .env", () => {
  async function cli(args: string[], cwd: string) {
    const out: string[] = [];
    const err: string[] = [];
    const code = await run(
      ["node", "dustin", ...args],
      { stdout: (s) => void out.push(s), stderr: (s) => void err.push(s) },
      "0.0.0",
      { env: {}, cwd, fetch: recordedFetch(recorded).fetch, horizon: { retries: 0, backoffMs: 0 } },
    );
    return { code, out: out.join(""), err: err.join("") };
  }

  it("ignores a .env with secrets and a bogus Horizon URL", async () => {
    const dir = tempDir(
      [
        `DUSTIN_ACCOUNT_SECRET=${accountKeys.secret()}`,
        `DUSTIN_SPONSOR_SECRET=${sponsorKeys.secret()}`,
        "DUSTIN_HORIZON_URL=https://mainnet-horizon.example.org",
        "",
      ].join("\n"),
    );
    const before = { ...process.env };
    for (const args of [
      ["plan", messy.fixture, "--to", messy.destination],
      ["close", messy.fixture, "--to", messy.destination],
    ]) {
      const r = await cli(args, dir);
      expect(r.code, args[0]).toBe(0);
      expect(r.out).toContain("CLOSABLE");
      // The plan came from the default testnet Horizon, not from the URL in .env.
      expect(r.out).not.toContain("example.org");
      for (const k of [accountKeys, sponsorKeys]) expect(r.out + r.err).not.toContain(k.secret());
    }
    expect(process.env).toEqual(before);
  });

  it("works even when .env cannot be read, because it is never opened", async () => {
    const dir = tempDir();
    mkdirSync(join(dir, ".env"));
    const r = await cli(["plan", messy.fixture, "--to", messy.destination], dir);
    expect(r.code).toBe(0);
  });
});

describe("no module loads .env into the process environment", () => {
  it("has no process.loadEnvFile call or process.env assignment under src/", () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) walk(path);
        else if (path.endsWith(".ts")) files.push(path);
      }
    };
    walk("src");
    expect(files.length).toBeGreaterThan(10);
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      expect(text, file).not.toMatch(/loadEnvFile/);
      expect(text, file).not.toMatch(/process\.env(\.\w+|\[[^\]]+\])?\s*=[^=]/);
      expect(text, file).not.toMatch(/Object\.assign\(\s*process\.env/);
    }
  });
});
