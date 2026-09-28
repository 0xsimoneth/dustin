import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  assertTestnetPassphrase,
  verifyHorizonIsTestnet,
  type ResolvedConfig,
} from "../../config/network.js";
import type { Sleep } from "../../config/pauses.js";
import { DustinError } from "../../errors/dustin-error.js";
import { buildMessyFixture } from "../../fixture/builder.js";
import { buildEdgeFixture } from "../../fixture/edge-builder.js";
import { loadEdgeVerifyInput, verifyEdgeFixture } from "../../fixture/edge-verify.js";
import {
  readAnyManifest,
  type EdgeFixtureKeys,
  type EdgeFixtureManifest,
  type FixtureKeys,
} from "../../fixture/manifest.js";
import {
  expectationFromManifest,
  loadVerifyInput,
  renderVerify,
  verifyFixture,
} from "../../fixture/verify.js";
import { horizonJson, type FetchLike } from "../../reader/horizon-json.js";
import { ExitCode } from "../exit-codes.js";
import type { CliIo } from "../program.js";

export interface CommandContext {
  io: CliIo;
  config: () => ResolvedConfig;
  fetch?: FetchLike;
  /** Horizon retry tuning (tests); defaults apply otherwise. */
  horizon?: { retries?: number; backoffMs?: number; sleep?: Sleep };
}

const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

/** Secrets: owner-only permissions, never overwritten, never printed. Returns the file path. */
export function writeFixtureKeys(baseDir: string, keys: FixtureKeys | EdgeFixtureKeys): string {
  const dir = join(baseDir, keys.id);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const path = join(dir, "keys.json");
  writeFileSync(path, json(keys), { mode: 0o600, flag: "wx" });
  return path;
}

export async function fixtureCreate(
  options: { profile: string; dir: string; out?: string; json?: boolean },
  ctx: CommandContext,
): Promise<ExitCode> {
  if (options.profile === "edge") return fixtureCreateEdge(options, ctx);
  if (options.profile !== "messy") {
    throw new DustinError(
      "CONFIG_INVALID",
      `Unknown fixture profile "${options.profile}". Available: messy, edge.`,
      { stage: "config" },
    );
  }
  const { manifest, recorded } = await buildMessyFixture({
    config: ctx.config(),
    ...(ctx.fetch ? { fetch: ctx.fetch } : {}),
    log: (line) => ctx.io.stderr(`${line}\n`),
    // Stored before any account is funded, so a build that stops halfway keeps its keys.
    onKeys: (keys) => {
      const path = writeFixtureKeys(options.dir, keys);
      ctx.io.stderr(`Secret keys saved to ${path} (mode 600, testnet only, never commit)\n`);
    },
  });

  const dir = join(options.dir, manifest.id);
  mkdirSync(join(dir, "horizon"), { recursive: true, mode: 0o700 });
  writeFileSync(join(dir, "manifest.json"), json(manifest));
  for (const [key, response] of Object.entries(recorded)) {
    writeFileSync(join(dir, "horizon", `${key}.json`), json(response));
  }
  if (options.out) writeFileSync(options.out, json(manifest));

  if (options.json) {
    ctx.io.stdout(json(manifest));
  } else {
    const f = manifest.accounts.fixture;
    ctx.io.stdout(
      [
        `Fixture ${manifest.id} (profile messy) on testnet`,
        `  account      ${f}`,
        `  destination  ${manifest.accounts.destination}`,
        `  fee sponsor  ${manifest.accounts.sponsor}`,
        `  explorer     ${manifest.network.explorerBaseUrl}/account/${f}`,
        `  balance ${manifest.expected.balance} XLM = minimum ${manifest.expected.minimumBalance}, spendable ${manifest.expected.spendable}`,
        `  manifest     ${join(dir, "manifest.json")}`,
        `  secret keys  ${join(dir, "keys.json")} (mode 600, testnet only, never commit)`,
        "",
        renderVerify(manifest.verification),
      ].join("\n"),
    );
  }
  return manifest.verification.pass ? ExitCode.OK : ExitCode.UNEXPECTED;
}

/**
 * Profile `edge` (docs/README.md canonical decision 3): one throwaway account per D3 matrix variant,
 * written like the messy profile: the keys file first, then the public manifest and the recorded
 * Horizon JSON under `<dir>/<id>/`.
 */
async function fixtureCreateEdge(
  options: { dir: string; out?: string; json?: boolean },
  ctx: CommandContext,
): Promise<ExitCode> {
  const { manifest, recorded } = await buildEdgeFixture({
    config: ctx.config(),
    ...(ctx.fetch ? { fetch: ctx.fetch } : {}),
    ...(ctx.horizon?.sleep ? { sleep: ctx.horizon.sleep } : {}),
    log: (line) => ctx.io.stderr(`${line}\n`),
    // Stored before any account is funded, so a build that stops halfway keeps its keys.
    onKeys: (keys) => {
      const path = writeFixtureKeys(options.dir, keys);
      ctx.io.stderr(`Secret keys saved to ${path} (mode 600, testnet only, never commit)\n`);
    },
  });
  const dir = join(options.dir, manifest.id);
  mkdirSync(join(dir, "horizon"), { recursive: true, mode: 0o700 });
  writeFileSync(join(dir, "manifest.json"), json(manifest));
  for (const [key, response] of Object.entries(recorded)) {
    writeFileSync(join(dir, "horizon", `${key}.json`), json(response));
  }
  if (options.out) writeFileSync(options.out, json(manifest));
  if (options.json) {
    ctx.io.stdout(json(manifest));
  } else {
    ctx.io.stdout(
      [
        `Fixture ${manifest.id} (profile edge) on testnet`,
        `  destination  ${manifest.accounts.destination}`,
        `  fee sponsor  ${manifest.accounts.sponsor}`,
        `  pool         ${manifest.pool.id} (${manifest.pool.shares} shares held by pool-share)`,
        ...renderEdgeVariants(manifest),
        `  manifest     ${join(dir, "manifest.json")}`,
        `  secret keys  ${join(dir, "keys.json")} (mode 600, testnet only, never commit)`,
        "",
        renderVerify(manifest.verification),
      ].join("\n"),
    );
  }
  return manifest.verification.pass ? ExitCode.OK : ExitCode.UNEXPECTED;
}

/** One line per variant: name, matrix rows, account, expected plan status and codes. */
export function renderEdgeVariants(manifest: EdgeFixtureManifest): string[] {
  const width = Math.max(...manifest.variants.map((v) => v.name.length));
  return [
    "  variants (matrix rows, account, expected plan):",
    ...manifest.variants.map((v) => {
      const codes = [...v.expected.blockers, ...v.expected.unclosable];
      const expected = `${v.expected.status}${codes.length ? ` (${codes.join(", ")})` : ""}`;
      return `    ${v.name.padEnd(width)}  ${v.rows.join(", ").padEnd(10)} ${v.account}  ${expected}`;
    }),
  ];
}

/** Exit code 3 when a check fails (docs/prd.md section 6). */
export async function fixtureVerify(
  manifestPath: string,
  options: { snapshot?: string; json?: boolean },
  ctx: CommandContext,
): Promise<ExitCode> {
  const any = readAnyManifest(manifestPath);
  if (any.profile === "edge") return fixtureVerifyEdge(any, options, ctx);
  const manifest = any;
  assertTestnetPassphrase(manifest.network.passphrase);
  const config = ctx.config();
  await verifyHorizonIsTestnet(config.horizonUrl, ctx.fetch);
  const client = horizonJson(config.horizonUrl, {
    ...(ctx.fetch ? { fetch: ctx.fetch } : {}),
    ...ctx.horizon,
  });
  const input = await loadVerifyInput(
    client,
    expectationFromManifest(manifest),
    manifest.accounts.fixture,
  );
  const result = verifyFixture(input);
  const snapshot = {
    checkedAt: new Date().toISOString(),
    fixture: manifest.accounts.fixture,
    horizonUrl: config.horizonUrl,
    result,
    baseReserveStroops: input.baseReserve.toString(),
    account: input.account,
    offers: input.offers,
  };
  if (options.snapshot) writeFileSync(options.snapshot, json(snapshot));
  if (options.json) {
    ctx.io.stdout(json(snapshot));
  } else {
    ctx.io.stdout(`Verifying fixture ${manifest.accounts.fixture} against SOW Appendix B\n\n`);
    ctx.io.stdout(renderVerify(result));
  }
  return result.pass ? ExitCode.OK : ExitCode.NOTHING_EXECUTED;
}

/** The edge profile's checks: every variant, the issuers and the destination, read from Horizon. */
async function fixtureVerifyEdge(
  manifest: EdgeFixtureManifest,
  options: { snapshot?: string; json?: boolean },
  ctx: CommandContext,
): Promise<ExitCode> {
  assertTestnetPassphrase(manifest.network.passphrase);
  const config = ctx.config();
  await verifyHorizonIsTestnet(config.horizonUrl, ctx.fetch);
  const client = horizonJson(config.horizonUrl, {
    ...(ctx.fetch ? { fetch: ctx.fetch } : {}),
    ...ctx.horizon,
  });
  const input = await loadEdgeVerifyInput(
    client,
    { ...manifest.accounts, multisigSigner: manifest.multisigSigner },
    manifest.pool.id,
  );
  const result = verifyEdgeFixture(input);
  const snapshot = {
    checkedAt: new Date().toISOString(),
    fixture: manifest.id,
    profile: "edge",
    horizonUrl: config.horizonUrl,
    result,
    baseReserveStroops: input.baseReserve.toString(),
    accounts: input.accounts,
    offers: input.offers,
  };
  if (options.snapshot) writeFileSync(options.snapshot, json(snapshot));
  if (options.json) {
    ctx.io.stdout(json(snapshot));
  } else {
    ctx.io.stdout(`Verifying edge fixture ${manifest.id} against its recipe\n\n`);
    ctx.io.stdout(renderVerify(result));
  }
  return result.pass ? ExitCode.OK : ExitCode.NOTHING_EXECUTED;
}
