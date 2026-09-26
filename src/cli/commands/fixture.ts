import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  assertTestnetPassphrase,
  verifyHorizonIsTestnet,
  type ResolvedConfig,
} from "../../config/network.js";
import { DustinError } from "../../errors/dustin-error.js";
import { buildMessyFixture } from "../../fixture/builder.js";
import { readManifest } from "../../fixture/manifest.js";
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
}

const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

export async function fixtureCreate(
  options: { profile: string; dir: string; out?: string; json?: boolean },
  ctx: CommandContext,
): Promise<ExitCode> {
  if (options.profile !== "messy") {
    throw new DustinError(
      "CONFIG_INVALID",
      `Unknown fixture profile "${options.profile}". Available now: messy.`,
      { stage: "config" },
    );
  }
  const { manifest, keys, recorded } = await buildMessyFixture({
    config: ctx.config(),
    log: (line) => ctx.io.stderr(`${line}\n`),
  });

  const dir = join(options.dir, manifest.id);
  mkdirSync(join(dir, "horizon"), { recursive: true, mode: 0o700 });
  writeFileSync(join(dir, "manifest.json"), json(manifest));
  // Secrets: owner-only permissions, never overwritten, never printed.
  writeFileSync(join(dir, "keys.json"), json(keys), { mode: 0o600, flag: "wx" });
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

/** Exit code 3 when a check fails (docs/prd.md section 6). */
export async function fixtureVerify(
  manifestPath: string,
  options: { snapshot?: string; json?: boolean },
  ctx: CommandContext,
): Promise<ExitCode> {
  const manifest = readManifest(manifestPath);
  assertTestnetPassphrase(manifest.network.passphrase);
  const config = ctx.config();
  await verifyHorizonIsTestnet(config.horizonUrl, ctx.fetch);
  const client = horizonJson(config.horizonUrl, ctx.fetch ? { fetch: ctx.fetch } : {});
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
