// Matrix row B-03 in one command (docs/edge-cases-and-test-matrix.md, section 4): after the
// builder's recordings of the existing tool (B-01 on the baseline fixture messy-20260926T035942Z,
// B-02 on the same recipe plus 1 XLM), Dustin closes the same recipe rebuilt twice, and the
// comparison table is written.
//
//   node scripts/baseline-b03.mjs                 B-03: build, then run scripts/evidence-cli.mjs
//                                                 baseline-zero (FIX-base-1) and baseline-plus1
//                                                 (FIX-base-2), each recorded under evidence/runs/,
//                                                 then write evidence/baseline/b03-comparison.md
//   node scripts/baseline-b03.mjs --prepare-b02   before the B-02 recording: build a fresh messy
//                                                 fixture, check it, add 1 XLM from its fee sponsor,
//                                                 and print the account for the existing tool; its
//                                                 keys stay in .fixture/<id>/keys.json
//
// B-03 refuses to start before the B-01 recording is done, which its protocol ends by writing
// evidence/baseline/verify-after.json (evidence/baseline/README.md, step 6); --before-recordings
// overrides that for a rehearsal. Testnet only; every account is a throwaway funded by Friendbot.
// The baseline fixture itself is never read with its keys, never changed and never closed here.
// Exit codes: 0 done, 1 a step failed, 2 usage error, 3 the recordings are not there yet.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const HORIZON = "https://horizon-testnet.stellar.org";
const PASSPHRASE = "Test SDF Network ; September 2015";
const BASELINE_ID = "messy-20260926T035942Z";
const USAGE = "usage: node scripts/baseline-b03.mjs [--prepare-b02 | --before-recordings]";
const log = (line) => process.stderr.write(`baseline-b03: ${line}\n`);

const args = process.argv.slice(2);
const PREPARE = args.includes("--prepare-b02");
const REHEARSAL = args.includes("--before-recordings");
if (
  args.some((a) => a !== "--prepare-b02" && a !== "--before-recordings") ||
  (PREPARE && REHEARSAL)
) {
  process.stderr.write(
    `baseline-b03: unknown or conflicting arguments (they are not shown)\n${USAGE}\n`,
  );
  process.exit(2);
}

function run(command, commandArgs, options = {}) {
  const result = spawnSync(command, commandArgs, {
    cwd: ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
    maxBuffer: 64 * 1024 * 1024,
    ...options,
  });
  if (result.status !== 0)
    throw new Error(`${command} ${commandArgs.join(" ")} exited ${result.status}`);
  return result.stdout;
}

/** The environment of the CLI: no DUSTIN_ variable, so the public testnet defaults apply. */
function cleanEnv() {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith("DUSTIN_")) delete env[key];
  return env;
}

async function horizonGet(path) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      const response = await globalThis.fetch(`${HORIZON}${path}`, {
        headers: { accept: "application/json" },
      });
      if (response.status < 500 && response.status !== 429)
        return { status: response.status, body: await response.json() };
    } catch {
      // Retried below.
    }
    if (attempt === 5) throw new Error(`Horizon did not answer GET ${path}`);
    await sleep(1000 * attempt);
  }
}

/** --prepare-b02: the fixture of the B-02 recording, the baseline recipe plus 1 XLM. */
async function prepareB02() {
  log("building the CLI");
  run("npm", ["run", "build"], { stdio: ["ignore", "ignore", "inherit"] });
  const cli = join(ROOT, "dist", "cli", "main.js");
  log("building a fresh messy fixture from Friendbot (about a minute)");
  const manifest = JSON.parse(
    run(process.execPath, [cli, "fixture", "create", "--profile", "messy", "--json"], {
      env: cleanEnv(),
    }),
  );
  const dir = join(".fixture", manifest.id);
  const snapshot = join("evidence", "baseline", "b02-verify-before-the-1-xlm.json");
  run(
    process.execPath,
    [cli, "fixture", "verify", join(dir, "manifest.json"), "--snapshot", snapshot],
    {
      env: cleanEnv(),
      stdio: ["ignore", "ignore", "inherit"],
    },
  );
  const keys = JSON.parse(readFileSync(join(ROOT, dir, "keys.json"), "utf8"));
  const sdk = createRequire(join(ROOT, "package.json"))("@stellar/stellar-sdk");
  const sponsor = sdk.Keypair.fromSecret(keys.secrets.sponsor);
  const source = await horizonGet(`/accounts/${sponsor.publicKey()}`);
  const stats = (await horizonGet("/fee_stats")).body;
  const fee = Math.min(1_000_000, Math.max(100, Number(stats?.fee_charged?.p80 ?? 100)));
  const tx = new sdk.TransactionBuilder(
    new sdk.Account(sponsor.publicKey(), source.body.sequence),
    {
      fee: String(fee),
      networkPassphrase: PASSPHRASE,
    },
  )
    .addOperation(
      sdk.Operation.payment({
        destination: manifest.accounts.fixture,
        asset: sdk.Asset.native(),
        amount: "1",
      }),
    )
    .setTimeout(120)
    .build();
  tx.sign(sponsor);
  const posted = await globalThis.fetch(`${HORIZON}/transactions`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: `tx=${encodeURIComponent(tx.toXDR())}`,
  });
  const answer = await posted.json().catch(() => null);
  if (posted.status !== 200) {
    throw new Error(
      `the 1 XLM payment was not applied: ${JSON.stringify(answer?.extras?.result_codes ?? posted.status)}`,
    );
  }
  const after = await horizonGet(`/accounts/${manifest.accounts.fixture}`);
  const xlm = after.body.balances.find((b) => b.asset_type === "native").balance;
  process.stdout.write(
    [
      `Fixture ${manifest.id} for the B-02 recording (the baseline recipe, recipe hash ${manifest.recipeHash}), plus 1 XLM:`,
      `  account      ${manifest.accounts.fixture}  (balance ${xlm} XLM, 1 XLM of it spendable)`,
      `  destination  ${manifest.accounts.destination}`,
      `  the 1 XLM    ${answer.hash} (ledger ${answer.ledger}), paid and signed by the fee sponsor ${sponsor.publicKey()}`,
      `  secret key   the "fixture" entry of ${dir}/keys.json (never shown here)`,
      `  checks       ${snapshot}, taken before the 1 XLM`,
      "Record the existing tool on this account following evidence/baseline/README.md (B-02), then run",
      "node scripts/baseline-b03.mjs once both recordings are done.",
      "",
    ].join("\n"),
  );
}

/** B-03: the two closes, then the comparison table. */
function b03() {
  const after = join(ROOT, "evidence", "baseline", "verify-after.json");
  if (!REHEARSAL && !existsSync(after)) {
    log(
      "the B-01 recording is not done yet: evidence/baseline/verify-after.json is missing (evidence/baseline/README.md, step 6). " +
        "Record the existing tool first, or pass --before-recordings for a rehearsal.",
    );
    return 3;
  }
  log("building the CLI");
  run("npm", ["run", "build"], { stdio: ["ignore", "ignore", "inherit"] });
  const runs = [];
  for (const [caseName, label] of [
    ["baseline-zero", REHEARSAL ? "b03-rehearsal-base1" : "b03-base1"],
    ["baseline-plus1", REHEARSAL ? "b03-rehearsal-base2" : "b03-base2"],
  ]) {
    log(`running scripts/evidence-cli.mjs ${caseName} ${label} (a few minutes)`);
    const out = run(
      process.execPath,
      [join(ROOT, "scripts", "evidence-cli.mjs"), caseName, label],
      {
        env: cleanEnv(),
      },
    );
    const result = JSON.parse(out.slice(out.indexOf("{")));
    if (result.result !== "ok")
      throw new Error(`${caseName} did not meet its expectations: ${result.dir}/FAILED.md`);
    runs.push({ caseName, ...result });
  }
  // A rehearsal never takes the place of the comparison the recordings are compared in.
  const name = REHEARSAL ? "b03-comparison-rehearsal.md" : "b03-comparison.md";
  writeFileSync(join(ROOT, "evidence", "baseline", name), comparison(runs));
  log(`written: evidence/baseline/${name}`);
  return 0;
}

function comparison(runs) {
  const baseline = JSON.parse(
    readFileSync(join(ROOT, "test", "fixtures", "horizon", "messy", "manifest.json"), "utf8"),
  );
  const recorded = readFileSync(join(ROOT, "evidence", "baseline", "README.md"), "utf8");
  const pending = /to be filled/.test(recorded);
  const tool = (what) =>
    pending ? `\`<pending: ${what}, from the recording>\`` : `see [README.md](README.md#result)`;
  const rows = runs.map((r) => {
    const report = JSON.parse(readFileSync(join(ROOT, r.dir, "report.json"), "utf8"));
    const manifest = JSON.parse(readFileSync(join(ROOT, r.dir, "fixture-manifest.json"), "utf8"));
    const txs = report.transactions.filter((t) => t.result === "applied");
    const fixture =
      r.caseName === "baseline-plus1" ? "FIX-base-2 (plus 1 XLM)" : "FIX-base-1 (zero spendable)";
    return {
      manifest,
      line: `| B-03 | Dustin ${JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).version} (\`dustin close --execute\`) | ${fixture}, [\`${manifest.id}\`](../../${r.dir}/summary.md), \`${r.account}\` | ${txs.length}, every one a fee bump paid by the sponsor: ${txs.map((t) => `\`${t.hash.slice(0, 12)}...\``).join(", ")} | nowhere: \`${report.status}\` | gone, Horizon ${report.verification?.horizonStatus} | ${report.recovery?.mergedXlm} XLM |`,
    };
  });
  const same = rows.every((r) => r.manifest.recipeHash === baseline.recipeHash);
  return `# Matrix row B-03: the existing tool and Dustin on the same recipe

The side-by-side table of matrix row B-03 (docs/edge-cases-and-test-matrix.md, section 4), written by \`node scripts/baseline-b03.mjs\`. The existing tool's rows come from the builder's recordings ([README.md](README.md)); Dustin's rows from the two runs linked below, each on a fixture rebuilt from the baseline recipe.

Recipe hash of the baseline fixture \`${BASELINE_ID}\`: \`${baseline.recipeHash}\`. ${same ? "Both rebuilt fixtures carry the same recipe hash." : "**A rebuilt fixture carries a different recipe hash: the comparison does not hold.**"}

| Row | Tool | Fixture | Transactions submitted | Where it stopped | Account afterwards | XLM to the destination |
|---|---|---|---|---|---|---|
| B-01 | StellarExpert Account Demolisher | the baseline fixture \`${BASELINE_ID}\` (zero spendable) | ${tool("transactions")} | ${tool("stop point")} | ${tool("state")} | ${tool("XLM delivered")} |
| B-02 | StellarExpert Account Demolisher | the baseline recipe plus 1 XLM | ${tool("transactions")} | ${tool("stop point")} | ${tool("state")} | ${tool("XLM delivered")} |
${rows.map((r) => r.line).join("\n")}

Dustin's runs: ${runs.map((r) => `[\`${r.dir}\`](../../${r.dir}/summary.md)`).join(", ")}.
`;
}

try {
  process.exitCode = PREPARE ? (await prepareB02(), 0) : b03();
} catch (error) {
  log(`stopped: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
