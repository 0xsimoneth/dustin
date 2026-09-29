// Live evidence through the command line (stories E3-S2, E3-S4 and E3-S7; SOW week 3). Each case
// builds a fresh fixture on the Stellar testnet with `dustin fixture create`, drives the real CLI
// (`node dist/cli/main.js`) through the case and records what a reviewer needs to check it under
// evidence/runs/<UTC stamp>-<label>/ (the layout is in evidence/runs/README.md):
//
//   metric        label e3-cli        E3-S7, SOW Appendix B: a messy fixture closed end to end
//   edge-frozen   label edge-frozen   SOW week 3, canonical decision 3: the frozen, illiquid FRZ of
//                                     the edge fixture's auth-frozen account exits through the
//                                     unclosable path with a stated reason
//   memo-partial  label e3s2-partial  E3-S2: the issuer requires a memo (SEP-29); the partial close
//                                     and its receipt
//   seq-wait      label e3s4-wait     E3-S4: a bumped sequence number; the executor waits, then merges
//   baseline-zero   label b03-base1   matrix row B-03, after the recordings B-01 and B-02: the
//                                     baseline recipe rebuilt (FIX-base-1, zero spendable XLM)
//                                     and closed; its recipe hash is the baseline fixture's
//   baseline-plus1  label b03-base2   matrix row B-03: the same with 1 XLM added by the fee sponsor
//                                     (FIX-base-2); scripts/baseline-b03.mjs runs both
//
// Usage, after `npm run build`:  node scripts/evidence-cli.mjs <case> [label]
//
// Testnet only; every account is a throwaway funded by Friendbot. The fixture's secret keys stay in
// its keys file under .fixture/ (gitignored). They reach `dustin close` only through its
// environment, never its command line; this script signs its own setup transactions in memory.
// Everything is staged in a temporary directory first: each transcript is written there while its
// command runs, and the CLI's --report and --snapshot files are written there. Before anything is
// moved into evidence/runs/, every staged file is scanned for a secret seed with both rules of
// containsSecretSeed (through the exported redact(), which changes a text exactly when it holds
// one) and for each of the fixture's secret keys as StrKey, raw hex and raw base64; one hit refuses
// the whole run. Once anything was submitted, a step that fails still leaves what was gathered,
// with FAILED.md naming the step, so the record of a spent fixture is never lost.
import { Buffer } from "node:buffer";
import { spawnSync } from "node:child_process";
import {
  appendFileSync,
  chmodSync,
  closeSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

// 1. The case and the label, checked before anything else runs. Arguments are never echoed: a
// secret pasted in the wrong place must not reach the terminal.
const DEFAULT_LABELS = {
  metric: "e3-cli",
  "edge-frozen": "edge-frozen",
  "memo-partial": "e3s2-partial",
  "seq-wait": "e3s4-wait",
  "baseline-zero": "b03-base1",
  "baseline-plus1": "b03-base2",
};
const LABEL_RULE = /^[a-z0-9][a-z0-9-]*$/;
const USAGE = [
  "usage: node scripts/evidence-cli.mjs <case> [label]",
  `  <case>   one of ${Object.entries(DEFAULT_LABELS)
    .map(([name, label]) => `${name} (default label ${label})`)
    .join(", ")}`,
  "  [label]  lower-case letters, digits and hyphens; the run is written to",
  "           evidence/runs/<UTC stamp>-<label>/",
].join("\n");

function refuse(problem, exitCode = 2) {
  process.stderr.write(`evidence-cli: ${problem}\n${exitCode === 2 ? `${USAGE}\n` : ""}`);
  process.exit(exitCode);
}

const [caseName, labelArgument, ...surplus] = process.argv.slice(2);
if (caseName === undefined) refuse("name a case");
if (!Object.hasOwn(DEFAULT_LABELS, caseName)) refuse("unknown case (the argument is not shown)");
if (surplus.length > 0) refuse("too many arguments");
const label = labelArgument ?? DEFAULT_LABELS[caseName];
if (!LABEL_RULE.test(label)) {
  refuse(
    "the label must be lower-case letters, digits and hyphens, starting with a letter or a digit",
  );
}

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const CLI = join(ROOT, "dist", "cli", "main.js");
const LIB = join(ROOT, "dist", "index.js");
const RUNS = join(ROOT, "evidence", "runs");
if (!existsSync(CLI) || !existsSync(LIB)) refuse("dist/ is missing: run `npm run build` first", 1);
if (!existsSync(RUNS)) refuse("evidence/runs/ is missing from this checkout", 1);

const NAME = `${new Date()
  .toISOString()
  .replace(/[-:]/g, "")
  .replace(/\.\d+Z$/, "Z")}-${label}`;
const TARGET = join(RUNS, NAME);
const SHOWN = `evidence/runs/${NAME}`;
if (existsSync(TARGET)) refuse(`${SHOWN} exists; a run directory is never overwritten`, 1);

const require = createRequire(join(ROOT, "package.json"));
const { Account, Asset, Keypair, Operation, TransactionBuilder } = require("@stellar/stellar-sdk");
// The rules and the network constants of the build whose CLI runs here.
const lib = await import(pathToFileURL(LIB).href);
const { redact, verifyHorizonIsTestnet } = lib;
const HORIZON = lib.DEFAULT_HORIZON_URL;
const EXPLORER = lib.DEFAULT_EXPLORER_BASE;
const PASSPHRASE = lib.TESTNET_PASSPHRASE;

const COMMAND_TIMEOUT_MS = 20 * 60_000;
const log = (line) => process.stderr.write(`evidence-cli: ${line}\n`);
const flat = (text) => text.replace(/\s+/g, " ");
const errorText = (error) =>
  (error instanceof Error ? error.message : String(error)).replace(/\.$/, "");

/** A step that did not go as the case expects; `step` names it on the console and in FAILED.md. */
class StepFailure extends Error {
  constructor(step, detail) {
    super(detail);
    this.step = step;
  }
}

/** Runs one step; any error it throws becomes a StepFailure that names the step. */
async function step(name, action) {
  try {
    return await action();
  } catch (error) {
    if (error instanceof StepFailure) throw error;
    throw new StepFailure(name, errorText(error));
  }
}

// Everything one run knows. Secrets live in `keys` and `secrets` only, in memory; neither is ever
// written anywhere.
const run = {
  staging: "",
  commands: [],
  /** What may have reached the ledger, in order; empty means nothing was submitted. */
  changed: [],
  /** The step that stopped the run before its end, as { step, detail }; null when none did. */
  stop: null,
  /** What could not be recorded although the run went on (a Horizon read after the close). */
  failures: [],
  checks: [],
  forbidden: [],
  setup: [],
  records: new Map(),
  people: [],
  roles: [],
  manifest: null,
  keys: null,
  secrets: null,
  verification: null,
  plan: null,
  report: null,
  account: null,
  destination: null,
  sponsor: null,
  accountBefore: null,
  accountAfter: null,
  before: null,
  after: null,
  ledgerBefore: null,
  ledgerAfter: null,
  refusal: null,
  bump: null,
  topUp: null,
  gathered: false,
};

// 2. The staging directory.
const stagePath = (name) => join(run.staging, name);
const staged = (name) => existsSync(stagePath(name));
const readStaged = (name) => (staged(name) ? readFileSync(stagePath(name), "utf8") : "");
const stageText = (name, text) => writeFileSync(stagePath(name), text);
const stageJson = (name, value) => stageText(name, `${JSON.stringify(value, null, 2)}\n`);

function readStagedJson(name, stepName) {
  try {
    return JSON.parse(readFileSync(stagePath(name), "utf8"));
  } catch (error) {
    throw new StepFailure(
      stepName,
      `${name} is missing or not JSON (${error.code ?? errorText(error)})`,
    );
  }
}

// 3. Secrets: what must never be written, and how a transcript is shown on the console.

/** Every form a leaked secret key could take: StrKey, and the raw 32-byte seed as hex and base64. */
function secretForms(secret) {
  const raw = Buffer.from(Keypair.fromSecret(secret).rawSecretKey());
  const hex = raw.toString("hex");
  return [
    secret,
    hex,
    hex.toUpperCase(),
    raw.toString("base64").replace(/=+$/, ""),
    raw.toString("base64url"),
  ];
}

/** What a text would leak: a secret seed by either rule of containsSecretSeed, or a fixture key. */
function leaks(text) {
  const found = [];
  if (redact(text) !== text) found.push("a secret seed");
  if (run.forbidden.some((form) => text.includes(form))) found.push("a secret key of the fixture");
  return found;
}

function scrub(text) {
  let out = redact(text);
  for (const form of run.forbidden) out = out.split(form).join("[secret removed]");
  return out;
}

/** Prints a staged transcript on the console, scanned: seeds and fixture keys are removed first. */
function showScrubbed(name) {
  if (!staged(name)) return;
  const text = readStaged(name);
  const found = leaks(text);
  const note = found.length > 0 ? ` (it held ${found.join(" and ")}; shown redacted)` : "";
  process.stderr.write(
    `\n----- ${name}${note} -----\n${scrub(text)}----- end of ${name} -----\n\n`,
  );
}

// 4. Amounts, as BigInt stroops.
function toStroops(amount) {
  const match = /^(-?)(\d+)(?:\.(\d{1,7}))?$/.exec(String(amount));
  if (!match) throw new Error(`${JSON.stringify(amount)} is not an amount`);
  const value = BigInt(match[2]) * 10_000_000n + BigInt((match[3] ?? "").padEnd(7, "0"));
  return match[1] === "-" ? -value : value;
}

function formatXlm(stroops) {
  const abs = stroops < 0n ? -stroops : stroops;
  const text = `${abs / 10_000_000n}.${(abs % 10_000_000n).toString().padStart(7, "0")}`;
  return stroops < 0n ? `-${text}` : text;
}

const signedXlm = (stroops) => (stroops >= 0n ? `+${formatXlm(stroops)}` : formatXlm(stroops));

// 5. Horizon: reads retried with pauses, and this script's own setup transactions.

/** GET with up to five tries, pausing 0.5, 1, 2 and 4 s; 404 and other 4xx answers are returned. */
async function horizonGet(path, tries = 5) {
  let problem = "no answer";
  for (let attempt = 1; attempt <= tries; attempt += 1) {
    if (attempt > 1) await sleep(500 * 2 ** (attempt - 2));
    let response;
    try {
      response = await globalThis.fetch(`${HORIZON}${path}`, {
        headers: { accept: "application/json" },
        signal: globalThis.AbortSignal.timeout(30_000),
      });
    } catch (error) {
      problem = `no answer (${error?.cause?.code ?? error?.name ?? "network error"})`;
      continue;
    }
    if (response.status === 429 || response.status >= 500) {
      problem = `HTTP ${response.status}`;
      await response.body?.cancel().catch(() => undefined);
      continue;
    }
    try {
      return { status: response.status, body: await response.json() };
    } catch {
      problem = `HTTP ${response.status} with a body that is not JSON`;
    }
  }
  throw new Error(`Horizon GET ${path} failed ${tries} times; the last time: ${problem}`);
}

async function accountOf(id) {
  const answer = await horizonGet(`/accounts/${id}`);
  if (answer.status === 404) return null;
  if (answer.status !== 200) throw new Error(`Horizon answered HTTP ${answer.status} for ${id}`);
  return answer.body;
}

async function latestLedger() {
  const answer = await horizonGet("/ledgers?order=desc&limit=1");
  const record = answer.status === 200 ? answer.body?._embedded?.records?.[0] : undefined;
  if (!record) throw new Error(`Horizon answered HTTP ${answer.status} with no latest ledger`);
  return record;
}

/** The planner's bid rule (src/config/fees.ts): the ledger base fee or fee_charged p80, capped. */
async function feeBid() {
  const stats = (await horizonGet("/fee_stats")).body;
  const parse = (value) => {
    const n = Number.parseInt(value ?? "", 10);
    return Number.isFinite(n) ? n : 0;
  };
  const bid = Math.max(100, parse(stats?.last_ledger_base_fee), parse(stats?.fee_charged?.p80));
  return Math.min(bid, 1_000_000);
}

/**
 * Horizon's record of a transaction, or null. One that just reached the ledger can take a moment
 * to reach every Horizon behind the address, so a 404 is asked again for up to 10 s.
 */
async function transactionRecord(hash, onLedger) {
  for (let attempt = 1; ; attempt += 1) {
    const answer = await horizonGet(`/transactions/${hash}`);
    if (answer.status === 200) return answer.body;
    if (answer.status !== 404)
      throw new Error(`Horizon answered HTTP ${answer.status} for ${hash}`);
    if (!onLedger || attempt >= 10) return null;
    await sleep(1000);
  }
}

/** Posts a signed envelope; without an answer, looks its hash up until its time bound passed. */
async function submitEnvelope(tx) {
  const xdr = tx.toXDR();
  const hash = Buffer.from(tx.hash()).toString("hex");
  const maxTime = Number((tx.innerTransaction ?? tx).timeBounds.maxTime);
  let answer = null;
  try {
    const response = await globalThis.fetch(`${HORIZON}/transactions`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: `tx=${encodeURIComponent(xdr)}`,
      signal: globalThis.AbortSignal.timeout(60_000),
    });
    answer = { status: response.status, body: await response.json().catch(() => null) };
  } catch {
    // No answer at all: the outcome is looked up by hash below.
  }
  if (answer?.status === 200) {
    return { hash, xdr, result: "applied", ledger: answer.body?.ledger ?? null };
  }
  const codes = answer?.body?.extras?.result_codes;
  if (answer?.status === 400 && codes) {
    const onLedger = ["tx_failed", "tx_fee_bump_inner_failed"].includes(codes.transaction);
    return { hash, xdr, result: onLedger ? "failed" : "refused", ledger: null, codes };
  }
  for (;;) {
    const record = await transactionRecord(hash, false);
    if (record) {
      return { hash, xdr, result: record.successful ? "applied" : "failed", ledger: record.ledger };
    }
    const ledger = await latestLedger();
    if (Date.parse(ledger.closed_at) / 1000 > maxTime) {
      return { hash, xdr, result: "not included", ledger: null };
    }
    await sleep(2000);
  }
}

/** Keeps a setup transaction with its envelope and Horizon's record in setup.json. */
async function recordSetup(purpose, tx, outcome, feeAccount, source) {
  const onLedger = outcome.result === "applied" || outcome.result === "failed";
  run.setup.push({
    purpose,
    hash: outcome.hash,
    innerHash: tx.innerTransaction ? Buffer.from(tx.innerTransaction.hash()).toString("hex") : null,
    result: outcome.result,
    ledger: outcome.ledger,
    resultCodes: outcome.codes ?? null,
    feeAccount,
    source,
    envelopeXdr: outcome.xdr,
    horizon: onLedger ? await transactionRecord(outcome.hash, true) : null,
  });
  stageJson("setup.json", run.setup);
}

// 6. The CLI.
const shellWord = (word) =>
  /^[\w./=:@%+,-]+$/.test(word) ? word : `'${word.replaceAll("'", "'\\''")}'`;

/**
 * The CLI's environment: this process's, without any DUSTIN_ variable (so the public testnet
 * defaults apply and no stray secret leaks in), plus the two secrets for `dustin close` only.
 */
function childEnv(secrets) {
  const env = { ...process.env, NO_COLOR: "1" };
  for (const key of Object.keys(env)) if (key.startsWith("DUSTIN_")) delete env[key];
  if (secrets) {
    env.DUSTIN_ACCOUNT_SECRET = secrets.account;
    env.DUSTIN_SPONSOR_SECRET = secrets.sponsor;
  }
  return env;
}

/**
 * Runs `dustin <args>`. Its standard output and standard error go straight into the staged
 * transcript, in the order a terminal shows them (standard output goes to `stdoutFile` instead when
 * it is a document), and the exit code is appended. An exit code this case does not expect stops
 * the run: the transcript is printed, scanned, on the console.
 */
function dustin({ step: stepName, args, transcript, stdoutFile, cwd, secrets, expected }) {
  const command = `dustin ${args.map(shellWord).join(" ")}`;
  const where = stdoutFile
    ? `(standard output is saved as ${stdoutFile}; standard error follows)\n`
    : "";
  stageText(transcript, `$ ${command}\n${where}`);
  const fd = openSync(stagePath(transcript), "a");
  const started = Date.now();
  let result;
  try {
    result = spawnSync(process.execPath, [CLI, ...args], {
      cwd: cwd ?? run.staging,
      env: childEnv(secrets),
      stdio: ["ignore", stdoutFile ? "pipe" : fd, fd],
      encoding: "utf8",
      maxBuffer: 256 * 1024 * 1024,
      timeout: COMMAND_TIMEOUT_MS,
    });
  } finally {
    closeSync(fd);
  }
  const exit = result.status;
  let why = null;
  if (exit === null) {
    why =
      result.error?.code === "ETIMEDOUT"
        ? `timed out after ${COMMAND_TIMEOUT_MS / 60_000} minutes`
        : result.signal
          ? `ended by ${result.signal}`
          : `could not start (${result.error?.code ?? "unknown error"})`;
  }
  const newline = readStaged(transcript).endsWith("\n") ? "" : "\n";
  appendFileSync(stagePath(transcript), `${newline}[exit code ${exit ?? `none: ${why}`}]\n`);
  if (stdoutFile) stageText(stdoutFile, result.stdout ?? "");
  const seconds = Math.round((Date.now() - started) / 1000);
  run.commands.push({ step: stepName, command, transcript, stdoutFile, expected, exit, why });
  log(`${command}: exit ${exit ?? why} (this case expects ${expected}), ${seconds} s`);
  if (exit !== expected) {
    showScrubbed(transcript);
    throw new StepFailure(
      stepName,
      `\`${command}\` ${exit === null ? why : `exited ${exit}`}, where this case expects exit ${expected}; its output is in ${transcript}`,
    );
  }
  return { stdout: result.stdout ?? "" };
}

// 7. The steps the cases share.

/** `dustin fixture create`, then `dustin fixture verify` on the manifest it printed. */
async function buildFixture(profile) {
  const stepName = `build a fresh ${profile} fixture`;
  const created = dustin({
    step: stepName,
    args: ["fixture", "create", "--profile", profile, "--dir", ".fixture", "--json"],
    transcript: "fixture-create.txt",
    stdoutFile: "fixture-manifest.json",
    cwd: ROOT,
    expected: 0,
  });
  let manifest = null;
  try {
    manifest = JSON.parse(created.stdout);
  } catch {
    // Checked below.
  }
  if (
    manifest?.kind !== "dustin-fixture" ||
    manifest.profile !== profile ||
    !/^[A-Za-z0-9][A-Za-z0-9-]*$/.test(manifest.id ?? "")
  ) {
    throw new StepFailure(stepName, "its standard output is not the manifest of a new fixture");
  }
  run.manifest = manifest;
  let keys = null;
  try {
    const read = JSON.parse(readFileSync(join(ROOT, ".fixture", manifest.id, "keys.json"), "utf8"));
    run.forbidden = Object.values(read.secrets).flatMap(secretForms);
    keys = read;
  } catch {
    // Checked below.
  }
  if (keys?.kind !== "dustin-fixture-keys" || keys.id !== manifest.id || !run.forbidden.length) {
    throw new StepFailure(
      stepName,
      `the keys file .fixture/${manifest.id}/keys.json is unreadable`,
    );
  }
  run.keys = keys;
  log(`fixture ${manifest.id}; its keys stay in .fixture/${manifest.id}/ (gitignored)`);
  dustin({
    step: "verify the fixture",
    args: ["fixture", "verify", "fixture-manifest.json", "--snapshot", "fixture-verification.json"],
    transcript: "fixture-verify.txt",
    expected: 0,
  });
  run.verification = readStagedJson("fixture-verification.json", "verify the fixture");
}

/** The accounts of a `messy` fixture; `roles` are the ones whose balances are recorded. */
function useMessyFixture(roles) {
  const a = run.manifest.accounts;
  run.account = a.fixture;
  run.destination = a.destination;
  run.sponsor = a.sponsor;
  run.secrets = { account: run.keys.secrets.fixture, sponsor: run.keys.secrets.sponsor };
  const ids = {
    Account: a.fixture,
    Destination: a.destination,
    "Reserve sponsor": a.reserveSponsor,
    "Fee sponsor": a.sponsor,
  };
  run.roles = roles.map((role) => [role, ids[role]]);
  run.people = [
    ["Account", a.fixture],
    ["Destination", a.destination],
    ["Fee sponsor (fee account of every transaction of the close)", a.sponsor],
    ["Reserve sponsor (sponsors the SPTA trustline)", a.reserveSponsor],
    ["Issuer of DUSTA, DUSTB, DUSTC and SPTA", a.issuer],
  ];
}

/**
 * Waits, up to 90 s, for Horizon's path finder to see the market maker's DUSTA bid (it can trail
 * the ledger), so the plan sells DUSTA by path payment as the ladder's first rung.
 */
async function waitForDustaPath(required) {
  const dusta = run.manifest.assets.find((asset) => asset.code === "DUSTA");
  const query =
    "/paths/strict-send?source_asset_type=credit_alphanum12&source_asset_code=DUSTA" +
    `&source_asset_issuer=${dusta.issuer}&source_amount=${dusta.dust}&destination_assets=native`;
  const deadline = Date.now() + 90_000;
  for (;;) {
    const answer = await horizonGet(query);
    if (answer.status === 200 && (answer.body?._embedded?.records ?? []).length > 0) return;
    if (Date.now() > deadline) {
      if (required) throw new Error("Horizon found no strict-send path from DUSTA to XLM in 90 s");
      log("Horizon found no strict-send path from DUSTA to XLM in 90 s; the plan will burn DUSTA");
      return;
    }
    await sleep(2000);
  }
}

/** The dry-run plan, as `dustin plan` prints it and as JSON. */
function dryRunPlan() {
  const args = ["plan", run.account, "--to", run.destination, "--sponsor", run.sponsor];
  dustin({ step: "the dry-run plan", args, transcript: "plan.txt", expected: 0 });
  const printed = dustin({
    step: "the dry-run plan as JSON",
    args: [...args, "--json"],
    transcript: "plan-json.txt",
    stdoutFile: "plan.json",
    expected: 0,
  });
  let plan = null;
  try {
    plan = JSON.parse(printed.stdout);
  } catch {
    // Checked below.
  }
  if (plan?.kind !== "dustin-close-plan") {
    throw new StepFailure("the dry-run plan as JSON", "`dustin plan --json` printed no close plan");
  }
  run.plan = plan;
  return plan;
}

/** An account's XLM position and trustlines as Horizon shows it, or null when it answers 404. */
async function stateOf(id) {
  const account = await accountOf(id);
  if (!account) return null;
  return {
    balance: account.balances.find((b) => b.asset_type === "native")?.balance ?? null,
    sequence: account.sequence,
    subentryCount: account.subentry_count,
    numSponsoring: account.num_sponsoring,
    numSponsored: account.num_sponsored,
    trustlines: account.balances
      .filter((b) => b.asset_type !== "native")
      .map((b) => ({
        asset: b.asset_code ? `${b.asset_code}:${b.asset_issuer}` : `pool:${b.liquidity_pool_id}`,
        balance: b.balance,
      })),
  };
}

async function recordBefore() {
  const account = await accountOf(run.account);
  if (!account) throw new Error(`Horizon has no account ${run.account}`);
  run.accountBefore = account;
  stageJson("account-before.json", account);
  run.before = await Promise.all(run.roles.map(([, id]) => stateOf(id)));
  run.ledgerBefore = (await latestLedger()).sequence;
}

/** `dustin close --execute --yes`, the secrets in its environment only. It may submit. */
function closeCommand({ step: stepName, transcript, partial, report, expected }) {
  run.changed.push(`\`dustin close --execute${partial ? " --partial" : ""}\` ran`);
  dustin({
    step: stepName,
    args: [
      "close",
      run.account,
      "--to",
      run.destination,
      "--execute",
      "--yes",
      ...(partial ? ["--partial"] : []),
      ...(report ? ["--report", "report.json"] : []),
    ],
    transcript,
    secrets: run.secrets,
    expected,
  });
}

/** After a refused close: the account's sequence number, which a signed transaction would move. */
async function afterRefusal() {
  const account = await accountOf(run.account);
  run.refusal = { before: run.accountBefore.sequence, after: account?.sequence ?? null };
}

/**
 * What the ledger shows after the close, gathered best effort: every failed read is kept as a
 * failure and the rest is still gathered, so nothing that could be recorded is lost.
 */
async function gatherAfter() {
  if (run.gathered || run.account === null) return;
  run.gathered = true;
  const attempt = async (what, action) => {
    try {
      await action();
    } catch (error) {
      run.failures.push({ step: what, detail: errorText(error) });
    }
  };
  if (staged("report.json")) {
    await attempt("the report the CLI wrote (report.json)", async () => {
      run.report = JSON.parse(readStaged("report.json"));
    });
  }
  for (const [i, t] of (run.report?.transactions ?? []).entries()) {
    await attempt(`the Horizon record of transaction ${i + 1} (${t.hash})`, async () => {
      const record = await transactionRecord(
        t.hash,
        t.result === "applied" || t.result === "failed",
      );
      run.records.set(t.hash, record);
      stageJson(`tx-${i + 1}.json`, { hash: t.hash, horizon: record });
    });
  }
  await attempt("Horizon's answer for the account after the close", async () => {
    const answer = await horizonGet(`/accounts/${run.account}`);
    run.accountAfter = { status: answer.status, body: answer.body };
    stageJson("account-after.json", run.accountAfter);
  });
  await attempt("the balances after the close", async () => {
    run.after = await Promise.all(run.roles.map(([, id]) => stateOf(id)));
  });
  await attempt("the latest ledger after the close", async () => {
    run.ledgerAfter = (await latestLedger()).sequence;
  });
  stageJson("balances.json", {
    ledgers: { before: run.ledgerBefore, after: run.ledgerAfter },
    accounts: run.roles.map(([role, account], i) => ({
      role,
      account,
      before: run.before?.[i] ?? null,
      after: run.after?.[i] ?? null,
    })),
  });
}

// 8. Expectations.

function check(label, evaluate) {
  try {
    const { pass, observed } = evaluate();
    return { label, pass: pass === true, observed: String(observed) };
  } catch (error) {
    return { label, pass: false, observed: `not evaluated: ${errorText(error)}` };
  }
}

/** Checks that must hold before the close runs; one that fails stops the run there. */
function requireChecks(stepName, checks) {
  run.checks.push(...checks);
  const failed = checks.filter((c) => !c.pass);
  if (failed.length > 0) {
    showScrubbed("plan.txt");
    throw new StepFailure(
      stepName,
      `not as this case expects: ${failed.map((c) => `${c.label} (observed: ${c.observed})`).join("; ")}`,
    );
  }
}

const roleState = (states, role) => states?.[run.roles.findIndex(([r]) => r === role)] ?? null;
const lastTx = (plan) => plan?.transactions?.at(-1);
const phasesOf = (plan) =>
  (plan?.transactions ?? [])
    .map((t) => `${t.phase} (${t.opCount} ${t.opCount === 1 ? "op" : "ops"})`)
    .join(", ") || "none";
const disposalOf = (plan, code) =>
  plan?.steps?.find(
    (s) =>
      s.kind === "dispose_balance" &&
      s.subject?.type === "trustline" &&
      s.subject.asset.code === code,
  );
const unclosableCodes = (source) =>
  (source?.unclosable ?? []).map((u) =>
    u.subject?.type === "trustline" ? `${u.code} ${u.subject.asset.code}` : u.code,
  );
const nonNative = (account) => (account?.balances ?? []).filter((b) => b.asset_type !== "native");
const mergeTransactions = () => (run.report?.transactions ?? []).filter((t) => t.phase === "merge");

function feeBumpCheck() {
  return check(
    "Every transaction of the close on the ledger is a fee bump: fee account the sponsor, source the account, inner max_fee 0",
    () => {
      const onLedger = (run.report?.transactions ?? []).filter(
        (t) => t.result === "applied" || t.result === "failed",
      );
      const good = onLedger.filter((t) => {
        const record = run.records.get(t.hash);
        return (
          record?.fee_account === run.sponsor &&
          record?.source_account === run.account &&
          record?.inner_transaction?.max_fee === "0"
        );
      });
      return {
        pass: onLedger.length > 0 && good.length === onLedger.length,
        observed: `${good.length} of ${onLedger.length} transactions on the ledger`,
      };
    },
  );
}

function closedChecks() {
  return [
    check("The report says closed, verified gone, with no stop", () => ({
      pass:
        run.report?.status === "closed" &&
        run.report.verification?.accountExists === false &&
        run.report.stop === null,
      observed: `status ${run.report?.status ?? "none"}; verification HTTP ${run.report?.verification?.horizonStatus ?? "none"}; stop ${run.report?.stop?.code ?? "none"}`,
    })),
    check("Horizon answers HTTP 404 for the account afterwards", () => ({
      pass: run.accountAfter?.status === 404,
      observed: `HTTP ${run.accountAfter?.status ?? "not read"}`,
    })),
    feeBumpCheck(),
    check("The destination's XLM grew by exactly the merged amount", () => {
      const before = roleState(run.before, "Destination");
      const after = roleState(run.after, "Destination");
      const delta = toStroops(after.balance) - toStroops(before.balance);
      return {
        pass: delta === toStroops(run.report.recovery.mergedXlm),
        observed: `${before.balance} -> ${after.balance} XLM (${signedXlm(delta)}); merged ${run.report.recovery.mergedXlm} XLM`,
      };
    }),
  ];
}

function refusalChecks(words) {
  const text = flat(readStaged("transcript-refused.txt"));
  return [
    check("Without --partial, `dustin close --execute` signs nothing and says why", () => {
      const needed = ["Not executed", "nothing was signed or submitted", "remedy:", ...words];
      const missing = needed.filter((word) => !text.includes(word));
      return {
        pass: missing.length === 0,
        observed:
          missing.length === 0
            ? `the output says "Not executed" and names ${words.join(", ")} and the remedy`
            : `missing from the output: ${missing.join(", ")}`,
      };
    }),
    check("The account's sequence number did not move during the refused close", () => ({
      pass: run.refusal !== null && run.refusal.after === run.refusal.before,
      observed: run.refusal
        ? `${run.refusal.before} before, ${run.refusal.after} after`
        : "not read",
    })),
  ];
}

function partialChecks(words) {
  const receipt = flat(readStaged("transcript.txt"));
  return [
    check(
      "With --partial, everything else ran and no merge was submitted (report status partial)",
      () => {
        const txs = run.report?.transactions ?? [];
        return {
          pass:
            run.report?.status === "partial" &&
            txs.length > 0 &&
            txs.every((t) => t.result === "applied" && t.phase !== "merge"),
          observed: `status ${run.report?.status ?? "none"}; ${txs.map((t) => `${t.phase} ${t.result}`).join(", ") || "no transaction"}`,
        };
      },
    ),
    check("The receipt lists what stays unclosable, with the reason and the remedy", () => {
      const needed = [
        "Not closed (the account is not merged while these remain)",
        "remedy:",
        ...words,
      ];
      const missing = needed.filter((word) => !receipt.includes(word));
      return {
        pass: missing.length === 0,
        observed:
          missing.length === 0 ? `it lists ${words.join(", ")}` : `missing: ${missing.join(", ")}`,
      };
    }),
    feeBumpCheck(),
    check("Horizon still has the account afterwards (HTTP 200)", () => ({
      pass: run.accountAfter?.status === 200,
      observed: `HTTP ${run.accountAfter?.status ?? "not read"}`,
    })),
  ];
}

// 9. The cases.

const CASES = {
  metric: {
    title: "Live CLI close",
    purpose: "story E3-S7, SOW Appendix B",
    async run() {
      await buildFixture("messy");
      useMessyFixture(["Destination", "Reserve sponsor", "Fee sponsor"]);
      await step("wait for Horizon's DUSTA path", () => waitForDustaPath(false));
      const plan = dryRunPlan();
      requireChecks("the dry-run plan", [
        check("The dry-run plan is closable and ends in the merge", () => ({
          pass: plan.status === "closable" && lastTx(plan)?.phase === "merge",
          observed: `status ${plan.status}; transactions ${phasesOf(plan)}`,
        })),
      ]);
      await step("read the account and the balances before the close", recordBefore);
      closeCommand({ step: "the close", transcript: "transcript.txt", report: true, expected: 0 });
      await gatherAfter();
      run.checks.push(
        ...closedChecks(),
        check(
          "The reserve sponsor's num_sponsoring went from 1 to 0 (the SPTA reserve went back to it)",
          () => {
            const before = roleState(run.before, "Reserve sponsor");
            const after = roleState(run.after, "Reserve sponsor");
            return {
              pass: before.numSponsoring === 1 && after.numSponsoring === 0,
              observed: `${before.numSponsoring} -> ${after.numSponsoring}`,
            };
          },
        ),
      );
    },
    intro: () =>
      "The Epic 3 metric close (story E3-S7; SOW Appendix B) driven end to end through the command line on a fresh `messy` fixture: `dustin fixture create --profile messy`, `dustin fixture verify`, the dry-run `dustin plan`, then `dustin close --execute --yes --report`, with the default ladder order (the SOW order).",
    see: () => {
      const v = run.verification.result;
      const appendixB = v.checks.filter((c) => c.appendixB);
      const merged = run.report?.recovery?.mergedXlm;
      return [
        `${ran("verify the fixture")}: ${passed(v)} right before the close, the four SOW Appendix B preconditions among them (${appendixB.map((c) => `${c.label}: ${c.observed}`).join("; ")}). See \`fixture-verify.txt\` and \`fixture-verification.json\`.`,
        `${ran("the dry-run plan")}: status ${run.plan.status.toUpperCase()}, ${run.plan.transactions.length} transactions (${phasesOf(run.plan)}), every fee paid by the sponsor. See \`plan.txt\` and \`plan.json\`.`,
        `${ran("the close")}: report status \`${run.report?.status}\`; the command itself checked the account gone ("Verifying GET /accounts/... -> 404"). See \`transcript.txt\`, with the receipt, and \`report.json\`.`,
        `On the explorer, each transaction of the close is a fee bump whose fee account is the sponsor and whose source is the account: ${txList(run.report?.transactions ?? [])}. Horizon's records are in \`tx-<n>.json\`.`,
        `Horizon answers HTTP ${run.accountAfter?.status} for the account afterwards (${horizonAccount(run.account)}, \`account-after.json\`); the destination received the merged ${merged} XLM (\`balances.json\`).`,
      ];
    },
  },

  "edge-frozen": {
    title: "Unclosable exit through the CLI",
    purpose: "SOW week 3, canonical decision 3; matrix rows S-02 and S-01",
    async run() {
      await buildFixture("edge");
      const m = run.manifest;
      const variant = (m.variants ?? []).find((v) => v.name === "auth-frozen");
      if (!variant)
        throw new StepFailure("read the edge manifest", "it has no auth-frozen variant");
      run.account = variant.account;
      run.destination = m.accounts.destination;
      run.sponsor = m.accounts.sponsor;
      run.secrets = { account: run.keys.secrets.authFrozen, sponsor: run.keys.secrets.sponsor };
      run.variant = variant;
      run.roles = [
        ["Account", variant.account],
        ["Destination", m.accounts.destination],
        ["Fee sponsor", m.accounts.sponsor],
      ];
      run.people = [
        ["Account (edge variant auth-frozen)", variant.account],
        ["Destination", m.accounts.destination],
        ["Fee sponsor (fee account of every transaction of the close)", m.accounts.sponsor],
        ["Issuer of FRZ (AUTH_REQUIRED, AUTH_REVOCABLE)", m.accounts.authIssuer],
        ["Issuer of ILQX", m.accounts.plainIssuer],
      ];
      const plan = dryRunPlan();
      requireChecks("the dry-run plan", [
        check(
          "The plan is partial: FRZ is unclosable with TRUSTLINE_NOT_AUTHORIZED, the reason names its issuer, no merge",
          () => {
            const [item] = plan.unclosable;
            return {
              pass:
                plan.status === "partial" &&
                plan.unclosable.length === 1 &&
                item.code === "TRUSTLINE_NOT_AUTHORIZED" &&
                item.subject.asset.code === "FRZ" &&
                item.reason.includes(m.accounts.authIssuer) &&
                !plan.steps.some((s) => s.kind === "merge"),
              observed: `status ${plan.status}; unclosable ${unclosableCodes(plan).join(", ") || "none"}; steps ${plan.steps.map((s) => s.kind).join(", ")}`,
            };
          },
        ),
        check("The illiquid ILQX (no market, live issuer) is returned to its issuer", () => {
          const ilqx = disposalOf(plan, "ILQX");
          return {
            pass:
              ilqx?.disposal?.rung === "return_to_issuer" &&
              ilqx.disposal.to === m.accounts.plainIssuer,
            observed: `rung ${ilqx?.disposal?.rung ?? "none"}`,
          };
        }),
      ]);
      await step("read the account and the balances before the close", recordBefore);
      closeCommand({
        step: "the close without --partial",
        transcript: "transcript-refused.txt",
        expected: 3,
      });
      await step("read the account after the refused close", afterRefusal);
      closeCommand({
        step: "the partial close",
        transcript: "transcript.txt",
        partial: true,
        report: true,
        expected: 4,
      });
      await gatherAfter();
      run.checks.push(
        ...refusalChecks(["TRUSTLINE_NOT_AUTHORIZED", m.accounts.authIssuer]),
        ...partialChecks(["TRUSTLINE_NOT_AUTHORIZED", m.accounts.authIssuer]),
        check(
          "Afterwards the account holds only the frozen FRZ trustline, and no data entry",
          () => {
            const body = run.accountAfter?.body;
            const lines = nonNative(body);
            return {
              pass:
                lines.length === 1 &&
                lines[0].asset_code === "FRZ" &&
                lines[0].is_authorized === false &&
                Object.keys(body.data ?? {}).length === 0 &&
                body.subentry_count === 1,
              observed: `${lines.map((l) => `${l.asset_code} ${l.balance} (is_authorized ${l.is_authorized})`).join(", ") || "no trustline"}; ${Object.keys(body?.data ?? {}).length} data entries; subentry_count ${body?.subentry_count}`,
            };
          },
        ),
        check("The account's XLM balance did not change: the sponsor paid every fee", () => {
          const before = roleState(run.before, "Account");
          const after = roleState(run.after, "Account");
          return {
            pass: before.balance === after.balance,
            observed: `${before.balance} -> ${after.balance} XLM`,
          };
        }),
      );
    },
    intro: () =>
      `The SOW's week-3 outcome, "the deliberately illiquid asset exits through the unclosable path with a stated reason", on the \`edge\` fixture (docs/README.md canonical decision 3; matrix rows S-02 and S-01). Its \`auth-frozen\` account, as the manifest describes it: ${run.variant.summary} The close without \`--partial\` refuses before signing anything; with \`--partial\` it runs everything else and leaves the account open with the frozen trustline.`,
    see: () => {
      const m = run.manifest;
      const [item] = run.plan.unclosable;
      const ilqx = disposalOf(run.plan, "ILQX");
      const told = ["zero-spendable", "frz-frozen", "ilqx-dust", "data"].map(
        (id) => `authFrozen/${id}`,
      );
      const own = run.verification.result.checks.filter((c) => told.includes(c.id));
      const body = run.accountAfter?.body;
      const frz = nonNative(body).find((l) => l.asset_code === "FRZ");
      return [
        `${ran("verify the fixture")}: every account of the edge fixture was built as its recipe says, ${passed(run.verification.result)}; the auth-frozen account's: ${own.map((c) => `${c.label}: ${c.observed}`).join("; ")}. See \`fixture-verify.txt\` and \`fixture-verification.json\`.`,
        `${ran("the dry-run plan")}: status PARTIAL, no merge. The unclosable item is \`${item.code}\` for ${item.subject.balance} ${item.subject.asset.code}: "${item.reason}" Remedy: "${item.remedy}" The illiquid ILQX is returned to its issuer ${linkAccount(m.accounts.plainIssuer)} (rung \`${ilqx.disposal.rung}\`, a burn), and its trustline and the data entry are removed. See \`plan.txt\` and \`plan.json\`.`,
        `${ran("the close without --partial")}: "Not executed: the plan cannot end in a merge (status PARTIAL), so nothing was signed or submitted", with \`${item.code}\`, the issuer ${m.accounts.authIssuer} and the remedy; the account's sequence number was ${run.refusal?.before} before and ${run.refusal?.after} after. See \`transcript-refused.txt\`.`,
        `${ran("the partial close")}: report status \`${run.report?.status}\`; ${txList(run.report?.transactions ?? [])}, fee-bumped by the sponsor: ILQX returned to its issuer, its trustline and the data entry removed. No merge was submitted, and the receipt lists FRZ under "Not closed" with its reason and remedy. See \`transcript.txt\` and \`report.json\`; Horizon's records are in \`tx-<n>.json\`.`,
        `Horizon answers HTTP ${run.accountAfter?.status} for the account afterwards (${horizonAccount(run.account)}, \`account-after.json\`): it still exists and holds only the frozen FRZ trustline (${frz?.balance} FRZ, \`is_authorized\` ${frz?.is_authorized}) and ${body?.balances?.find((b) => b.asset_type === "native")?.balance} XLM.`,
      ];
    },
  },

  "memo-partial": {
    title: "Partial close through the CLI",
    purpose: "story E3-S2, AC-E3-S2-3",
    async run() {
      await buildFixture("messy");
      useMessyFixture(["Account", "Destination", "Reserve sponsor", "Fee sponsor"]);
      await step("wait for Horizon's DUSTA path", () => waitForDustaPath(true));
      await step("the issuer's data entry config.memo_required", issuerRequiresMemo);
      const plan = dryRunPlan();
      requireChecks("the dry-run plan", [
        check("The plan is partial, with no merge", () => ({
          pass: plan.status === "partial" && !plan.steps.some((s) => s.kind === "merge"),
          observed: `status ${plan.status}; steps ${plan.steps.map((s) => s.kind).join(", ")}`,
        })),
        check(
          "DUSTC goes to the destination (rung 3): the return to its issuer needs a memo",
          () => {
            const dustc = disposalOf(plan, "DUSTC")?.disposal;
            const burn = dustc?.ruledOut?.find((r) => r.rung === "return_to_issuer");
            return {
              pass:
                dustc?.rung === "send_to_destination" && /requires a memo/.test(burn?.reason ?? ""),
              observed: `rung ${dustc?.rung ?? "none"}; return to issuer ruled out: ${burn?.reason ?? "no"}`,
            };
          },
        ),
        check("DUSTB and SPTA are unclosable with NO_DISPOSAL_ROUTE, every rung ruled out", () => {
          const rungs = ["path_payment", "return_to_issuer", "send_to_destination"].join();
          const items = plan.unclosable;
          return {
            pass:
              items.length === 2 &&
              ["DUSTB", "SPTA"].every((code) =>
                items.some(
                  (u) =>
                    u.code === "NO_DISPOSAL_ROUTE" &&
                    u.subject.asset.code === code &&
                    (u.rungsRuledOut ?? []).map((r) => r.rung).join() === rungs,
                ),
              ),
            observed: unclosableCodes(plan).join(", ") || "none",
          };
        }),
      ]);
      await step("read the account and the balances before the close", recordBefore);
      closeCommand({
        step: "the close without --partial",
        transcript: "transcript-refused.txt",
        expected: 3,
      });
      await step("read the account after the refused close", afterRefusal);
      closeCommand({
        step: "the partial close",
        transcript: "transcript.txt",
        partial: true,
        report: true,
        expected: 4,
      });
      await gatherAfter();
      // The dust amounts of the recipe (src/fixture/messy.ts), as the manifest records them.
      const dust = (code) => run.manifest.assets.find((a) => a.code === code).dust;
      const words = ["DUSTB", "SPTA"].map((code) => `NO_DISPOSAL_ROUTE ${dust(code)} ${code}`);
      const left = `DUSTB ${dust("DUSTB")},SPTA ${dust("SPTA")}`;
      run.checks.push(
        ...refusalChecks(words),
        ...partialChecks([...words, "every rung of the ladder is ruled out"]),
        check(
          `Afterwards the account holds exactly ${left.replace(",", " and ")}, and no data entry`,
          () => {
            const body = run.accountAfter?.body;
            const lines = nonNative(body)
              .map((l) => `${l.asset_code} ${l.balance}`)
              .sort();
            return {
              pass: lines.join() === left && Object.keys(body.data ?? {}).length === 0,
              observed: `${lines.join(", ") || "no trustline"}; ${Object.keys(body?.data ?? {}).length} data entries`,
            };
          },
        ),
        check(`The destination's DUSTC grew by the ${dust("DUSTC")} DUSTC sent to it`, () => {
          const dustc = (state) => {
            const line = state?.trustlines?.find((l) => l.asset.startsWith("DUSTC:"));
            return toStroops(line?.balance ?? "0");
          };
          const delta =
            dustc(roleState(run.after, "Destination")) -
            dustc(roleState(run.before, "Destination"));
          return {
            pass: delta === toStroops(dust("DUSTC")),
            observed: `${signedXlm(delta)} DUSTC`,
          };
        }),
        check("The reserve sponsor still sponsors the SPTA trustline, which stays", () => {
          const before = roleState(run.before, "Reserve sponsor");
          const after = roleState(run.after, "Reserve sponsor");
          return {
            pass: before.numSponsoring === 1 && after.numSponsoring === 1,
            observed: `num_sponsoring ${before.numSponsoring} -> ${after.numSponsoring}`,
          };
        }),
      );
    },
    intro: () =>
      "Story E3-S2 (AC-E3-S2-3), its partial-close receipt, on a fresh `messy` fixture. The issuer of the four dust assets sets the SEP-29 data entry `config.memo_required` = 1, so a payment to it needs a memo, and the close carries none. The plan sells DUSTA by path payment (rung 1), sends DUSTC to the destination, which trusts it (rung 3), and finds no route at all for DUSTB and SPTA (`NO_DISPOSAL_ROUTE`, every rung ruled out). The close without `--partial` refuses before signing anything; with `--partial` it runs the rest, does not merge, and prints the partial-close receipt.",
    see: () => {
      const m = run.manifest;
      const [setup] = run.setup;
      const dustc = disposalOf(run.plan, "DUSTC").disposal;
      const burn = dustc.ruledOut.find((r) => r.rung === "return_to_issuer");
      const items = run.plan.unclosable.map(
        (u) =>
          `\`${u.code}\` ${u.subject.balance} ${u.subject.asset.code} (${(u.rungsRuledOut ?? []).map((r) => `${r.rung}: ${r.reason}`).join("; ")})`,
      );
      const body = run.accountAfter?.body;
      const dustcLine = (state) =>
        state?.trustlines?.find((l) => l.asset.startsWith("DUSTC:"))?.balance ?? "none";
      return [
        `Setup: the issuer ${linkAccount(m.accounts.issuer)} set the data entry \`config.memo_required\` = 1 in its own transaction ${linkTx(setup.hash)} (ledger ${setup.ledger}). See \`setup.json\`.`,
        `${ran("the dry-run plan")}: status PARTIAL, no merge. DUSTC goes to the destination (rung \`${dustc.rung}\`) because the return to its issuer is ruled out: "${burn.reason}". Unclosable: ${items.join("; ")}. See \`plan.txt\` and \`plan.json\`.`,
        `${ran("the close without --partial")}: "Not executed: the plan cannot end in a merge (status PARTIAL), so nothing was signed or submitted", with both \`NO_DISPOSAL_ROUTE\` items, the rungs ruled out and the remedy; the account's sequence number was ${run.refusal?.before} before and ${run.refusal?.after} after. See \`transcript-refused.txt\`.`,
        `${ran("the partial close")}: report status \`${run.report?.status}\`; ${txList(run.report?.transactions ?? [])}, fee-bumped by the sponsor; no merge was submitted. The receipt at the end of \`transcript.txt\` is the partial-close receipt: under "Not closed" it lists each unclosable item with its code, every rung ruled out and the remedy. See also \`report.json\` and \`tx-<n>.json\`.`,
        `Horizon answers HTTP ${run.accountAfter?.status} for the account afterwards (${horizonAccount(run.account)}, \`account-after.json\`): it holds only ${nonNative(
          body,
        )
          .map((l) => `${l.balance} ${l.asset_code}`)
          .join(
            " and ",
          )}, and ${body?.balances?.find((b) => b.asset_type === "native")?.balance} XLM. The destination's DUSTC went from ${dustcLine(roleState(run.before, "Destination"))} to ${dustcLine(roleState(run.after, "Destination"))} (\`balances.json\`).`,
      ];
    },
  },

  "seq-wait": {
    title: "Sequence-guard wait through the CLI",
    purpose: "story E3-S4, AC-E3-S4-2; matrix row S-04",
    async run() {
      await buildFixture("messy");
      useMessyFixture(["Destination", "Reserve sponsor", "Fee sponsor"]);
      await step("wait for Horizon's DUSTA path", () => waitForDustaPath(false));
      await step("the BumpSequence", () => bumpSequence(12));
      const plan = dryRunPlan();
      requireChecks("the dry-run plan", [
        check(
          "The plan is closable, runs the merge alone last, and says the executor waits for the unblocking ledger",
          () => {
            const merge = lastTx(plan);
            const g = plan.sequenceGuard;
            const atMerge = BigInt(run.bump.bumpTo) + BigInt(merge.index) + 1n;
            return {
              pass:
                plan.status === "closable" &&
                merge.phase === "merge" &&
                merge.opCount === 1 &&
                g?.ok === false &&
                g.sequenceAtMerge === atMerge.toString() &&
                g.unblocksAtLedger === run.bump.observed + run.bump.ahead + 1 &&
                plan.warnings.some((w) => w.includes("the executor waits")),
              observed: `status ${plan.status}; transactions ${phasesOf(plan)}; guard ok ${g?.ok}, sequence at merge ${g?.sequenceAtMerge}, unblocks at ledger ${g?.unblocksAtLedger}`,
            };
          },
        ),
      ]);
      await step("read the account and the balances before the close", recordBefore);
      closeCommand({ step: "the close", transcript: "transcript.txt", report: true, expected: 0 });
      await gatherAfter();
      const until = plan.sequenceGuard.unblocksAtLedger;
      const text = readStaged("transcript.txt");
      run.checks.push(
        ...closedChecks(),
        check(
          "The transcript shows the cleanup, then the wait for the sequence guard, then the merge",
          () => {
            const start = text.indexOf("waiting for the sequence guard");
            const end = text.indexOf("waited ", start);
            const merges = mergeTransactions();
            const cleanup = (run.report?.transactions ?? []).filter((t) => t.phase !== "merge");
            const at = (hash) => text.indexOf(`submitted  ${hash}`);
            return {
              pass:
                start >= 0 &&
                end > start &&
                cleanup.length > 0 &&
                cleanup.every((t) => at(t.hash) >= 0 && at(t.hash) < start) &&
                merges.length > 0 &&
                merges.every((t) => at(t.hash) > end),
              observed: start < 0 ? "no wait in the transcript" : waitLines(text).join(" / "),
            };
          },
        ),
        check(
          `The merge applied in or after the unblocking ledger ${until}, and none failed with op_seq_num_too_far`,
          () => {
            const merges = mergeTransactions();
            const applied = merges.find((t) => t.result === "applied");
            return {
              pass:
                merges.length === 1 &&
                applied !== undefined &&
                applied.ledger >= until &&
                !JSON.stringify(run.report.transactions).includes("op_seq_num_too_far"),
              observed: `${merges.length} merge envelope(s); applied in ledger ${applied?.ledger ?? "none"}`,
            };
          },
        ),
      );
    },
    intro: () =>
      "Story E3-S4 (AC-E3-S4-2; matrix row S-04), a live transcript of the sequence-guard wait, on a fresh `messy` fixture. A BumpSequence raises the account's sequence number to (latest ledger + 12) << 32, so a merge fails with ACCOUNT_MERGE_SEQNUM_TOO_FAR in every ledger before (sequence number at the merge >> 32) + 1 (docs/README.md canonical decision 10). The account holds zero spendable XLM, so the sponsor fee-bumps the BumpSequence. The dry-run plan runs the merge alone and says the executor waits; `dustin close --execute` runs the cleanup, waits for the ledger, then merges.",
    see: () => {
      const b = run.bump;
      const [setup] = run.setup;
      const g = run.plan.sequenceGuard;
      const merge = mergeTransactions().find((t) => t.result === "applied");
      const first = (run.report?.transactions ?? []).filter((t) => t.phase !== "merge");
      const where =
        merge?.ledger === g.unblocksAtLedger
          ? "the unblocking ledger itself"
          : `${merge?.ledger - g.unblocksAtLedger} ledgers after the unblocking ledger ${g.unblocksAtLedger}`;
      const wait = waitLines(readStaged("transcript.txt"))
        .map((line) => `"${line}"`)
        .join(", ");
      return [
        `Setup: a BumpSequence from the account to (${b.observed} + ${b.ahead}) << 32 = ${b.bumpTo}, fee-bumped by the sponsor: ${linkTx(setup.hash)} (ledger ${setup.ledger}). See \`setup.json\`.`,
        `${ran("the dry-run plan")}: status CLOSABLE, ${run.plan.transactions.length} transactions (${phasesOf(run.plan)}), the merge alone last, because the sequence guard makes it wait until ledger ${g.unblocksAtLedger} (sequence number at the merge ${g.sequenceAtMerge}); the plan says the executor waits. See \`plan.txt\` and \`plan.json\`.`,
        `${ran("the close")}: the transactions before the merge applied first, ${txList(first)}; then the command printed the wait (${wait}); then the merge ${merge ? linkTx(merge.hash) : "(none applied)"} applied in ledger ${merge?.ledger}, ${where}. No merge was refused with op_seq_num_too_far. See \`transcript.txt\` and \`report.json\`.`,
        `Horizon answers HTTP ${run.accountAfter?.status} for the account afterwards (${horizonAccount(run.account)}, \`account-after.json\`); the destination received the merged ${run.report?.recovery?.mergedXlm} XLM (\`balances.json\`).`,
      ];
    },
  },

  "baseline-zero": {
    title: "Matrix row B-03, the rebuilt baseline fixture (FIX-base-1)",
    purpose: "matrix row B-03 after the recording B-01; SOW 6.1 Deliverable 3",
    run: () => baselineClose(false),
    intro: () =>
      "Matrix row B-03 (docs/edge-cases-and-test-matrix.md, section 4): the recipe of the builder's baseline fixture `messy-20260926T035942Z`, on which the existing tool was recorded (B-01, evidence/baseline/README.md), rebuilt from Friendbot with `dustin fixture create --profile messy` (FIX-base-1: zero spendable XLM) and closed by Dustin through the command line with the default ladder order. The recipe hash in the new manifest is the baseline fixture's, so the account Dustin closes is built identically to the one the existing tool stopped on.",
    see: () => baselineSee(false),
  },

  "baseline-plus1": {
    title: "Matrix row B-03, the rebuilt baseline fixture plus 1 XLM (FIX-base-2)",
    purpose: "matrix row B-03 after the recording B-02; SOW 6.1 Deliverable 3",
    run: () => baselineClose(true),
    intro: () =>
      "Matrix row B-03 (docs/edge-cases-and-test-matrix.md, section 4): the baseline recipe rebuilt as for B-02 (FIX-base-2), a fresh `messy` fixture to which the fee sponsor pays 1 XLM, so the account holds 1 XLM it can spend, then closed by Dustin through the command line with the default ladder order. The recipe hash in the new manifest is the baseline fixture's.",
    see: () => baselineSee(true),
  },
};

/** The recipe hash of the builder's baseline fixture, from its public manifest. */
function baselineRecipeHash() {
  const path = join(ROOT, "test", "fixtures", "horizon", "messy", "manifest.json");
  const manifest = JSON.parse(readFileSync(path, "utf8"));
  if (manifest.id !== "messy-20260926T035942Z" || !manifest.recipeHash) {
    throw new StepFailure(
      "read the baseline manifest",
      "it is not the baseline fixture's manifest",
    );
  }
  return manifest.recipeHash;
}

/** B-03: build the baseline recipe again, with 1 XLM added when `plusOne`, and close it. */
async function baselineClose(plusOne) {
  const baselineHash = baselineRecipeHash();
  await buildFixture("messy");
  useMessyFixture(["Account", "Destination", "Reserve sponsor", "Fee sponsor"]);
  requireChecks("the recipe", [
    check(
      "The rebuilt fixture's recipe hash is the baseline fixture's (messy-20260926T035942Z)",
      () => ({
        pass: run.manifest.recipeHash === baselineHash,
        observed: `recipe hash ${run.manifest.recipeHash} (the baseline fixture's recipe hash ${baselineHash})`,
      }),
    ),
  ]);
  await step("wait for Horizon's DUSTA path", () => waitForDustaPath(false));
  if (plusOne) await step("the 1 XLM from the fee sponsor", () => topUp("1"));
  const plan = dryRunPlan();
  requireChecks("the dry-run plan", [
    check("The dry-run plan is closable and ends in the merge", () => ({
      pass: plan.status === "closable" && lastTx(plan)?.phase === "merge",
      observed: `status ${plan.status}; transactions ${phasesOf(plan)}`,
    })),
  ]);
  await step("read the account and the balances before the close", recordBefore);
  closeCommand({ step: "the close", transcript: "transcript.txt", report: true, expected: 0 });
  await gatherAfter();
  run.checks.push(
    ...closedChecks(),
    check("The whole XLM balance of the account reached the destination, plus the sale", () => {
      const before = roleState(run.before, "Account");
      const merged = toStroops(run.report.recovery.mergedXlm);
      const floor = toStroops(before.balance);
      return {
        pass: merged >= floor && merged - floor <= 10n,
        observed: `account ${before.balance} XLM before; merged ${run.report.recovery.mergedXlm} XLM`,
      };
    }),
  );
}

/** A payment of `amount` XLM from the fee sponsor to the account, signed and paid by the sponsor. */
async function topUp(amount) {
  const sponsor = Keypair.fromSecret(run.secrets.sponsor);
  const loaded = await accountOf(sponsor.publicKey());
  const before = await accountOf(run.account);
  const fee = await feeBid();
  const tx = new TransactionBuilder(new Account(sponsor.publicKey(), loaded.sequence), {
    fee: String(fee),
    networkPassphrase: PASSPHRASE,
  })
    .addOperation(Operation.payment({ destination: run.account, asset: Asset.native(), amount }))
    .setTimeout(120)
    .build();
  tx.sign(sponsor);
  run.changed.push(`the payment of ${amount} XLM to the account`);
  const outcome = await submitEnvelope(tx);
  await recordSetup(
    `Payment of ${amount} XLM from the fee sponsor to the account (matrix row B-02's "plus 1 XLM"), signed and paid by the sponsor`,
    tx,
    outcome,
    sponsor.publicKey(),
    sponsor.publicKey(),
  );
  if (outcome.result !== "applied") {
    throw new Error(
      `the transaction ${outcome.hash} ${outcome.result}: ${JSON.stringify(outcome.codes ?? null)}`,
    );
  }
  const native = (a) => a.balances.find((b) => b.asset_type === "native").balance;
  const after = await accountOf(run.account);
  if (toStroops(native(after)) - toStroops(native(before)) !== toStroops(amount)) {
    throw new Error(`the account went from ${native(before)} to ${native(after)} XLM`);
  }
  run.topUp = {
    amount,
    hash: outcome.hash,
    ledger: outcome.ledger,
    before: native(before),
    after: native(after),
  };
}

function baselineSee(plusOne) {
  const v = run.verification.result;
  const merged = run.report?.recovery?.mergedXlm;
  const lines = [
    `The recipe: the rebuilt fixture \`${run.manifest.id}\` has the recipe hash \`${run.manifest.recipeHash}\`, the baseline fixture's (\`test/fixtures/horizon/messy/manifest.json\`). See \`fixture-manifest.json\`.`,
    `${ran("verify the fixture")}: ${passed(v)} right after the build, zero spendable XLM among them. See \`fixture-verify.txt\` and \`fixture-verification.json\`.`,
  ];
  if (plusOne && run.topUp) {
    lines.push(
      `Then the fee sponsor paid the account ${run.topUp.amount} XLM: ${linkTx(run.topUp.hash)} (ledger ${run.topUp.ledger}); its balance went from ${run.topUp.before} to ${run.topUp.after} XLM, so it can spend 1 XLM. See \`setup.json\`.`,
    );
  }
  lines.push(
    `${ran("the dry-run plan")}: status ${run.plan.status.toUpperCase()}, ${run.plan.transactions.length} transactions (${phasesOf(run.plan)}). See \`plan.txt\` and \`plan.json\`.`,
    `${ran("the close")}: report status \`${run.report?.status}\`; ${txList(run.report?.transactions ?? [])}, each a fee bump paid by the sponsor. See \`transcript.txt\` and \`report.json\`.`,
    `Horizon answers HTTP ${run.accountAfter?.status} for the account afterwards (${horizonAccount(run.account)}, \`account-after.json\`); the destination received the merged ${merged} XLM (\`balances.json\`). The side-by-side table with the existing tool's recordings is \`evidence/baseline/${label.includes("rehearsal") ? "b03-comparison-rehearsal.md" : "b03-comparison.md"}\`.`,
  );
  return lines;
}

/** The issuer sets SEP-29's config.memo_required = 1, in its own transaction (it holds XLM). */
async function issuerRequiresMemo() {
  const issuer = Keypair.fromSecret(run.keys.secrets.issuer);
  const loaded = await accountOf(issuer.publicKey());
  const tx = new TransactionBuilder(new Account(issuer.publicKey(), loaded.sequence), {
    fee: String(await feeBid()),
    networkPassphrase: PASSPHRASE,
  })
    .addOperation(Operation.manageData({ name: "config.memo_required", value: "1" }))
    .setTimeout(120)
    .build();
  tx.sign(issuer);
  run.changed.push("the issuer's data entry config.memo_required");
  const outcome = await submitEnvelope(tx);
  await recordSetup(
    "the issuer sets config.memo_required = 1 (SEP-29)",
    tx,
    outcome,
    issuer.publicKey(),
    issuer.publicKey(),
  );
  if (outcome.result !== "applied") {
    throw new Error(
      `the transaction ${outcome.hash} ${outcome.result}: ${JSON.stringify(outcome.codes ?? null)}`,
    );
  }
  const after = await accountOf(issuer.publicKey());
  if (after?.data?.["config.memo_required"] !== Buffer.from("1").toString("base64")) {
    throw new Error("Horizon does not show config.memo_required = 1 on the issuer");
  }
}

/**
 * BumpSequence from the account to (latest ledger + ahead) << 32 (test/testnet/sequence-guard.test.ts),
 * fee-bumped by the sponsor, since the account holds zero spendable XLM.
 */
async function bumpSequence(ahead) {
  const account = Keypair.fromSecret(run.secrets.account);
  const sponsor = Keypair.fromSecret(run.secrets.sponsor);
  const loaded = await accountOf(account.publicKey());
  const fee = await feeBid();
  const observed = (await latestLedger()).sequence;
  const bumpTo = (BigInt(observed + ahead) << 32n).toString();
  const inner = new TransactionBuilder(new Account(account.publicKey(), loaded.sequence), {
    fee: "0",
    networkPassphrase: PASSPHRASE,
  })
    .addOperation(Operation.bumpSequence({ bumpTo }))
    .setTimeout(120)
    .build();
  inner.sign(account);
  const bump = TransactionBuilder.buildFeeBumpTransaction(
    sponsor.publicKey(),
    String(fee),
    inner,
    PASSPHRASE,
  );
  bump.sign(sponsor);
  run.changed.push("the BumpSequence of the account");
  const outcome = await submitEnvelope(bump);
  await recordSetup(
    `BumpSequence to (${observed} + ${ahead}) << 32, fee-bumped by the sponsor`,
    bump,
    outcome,
    sponsor.publicKey(),
    account.publicKey(),
  );
  if (outcome.result !== "applied") {
    throw new Error(
      `the transaction ${outcome.hash} ${outcome.result}: ${JSON.stringify(outcome.codes ?? null)}`,
    );
  }
  const after = await accountOf(account.publicKey());
  if (after?.sequence !== bumpTo) {
    throw new Error(`the account's sequence number is ${after?.sequence}, not ${bumpTo}`);
  }
  run.bump = { observed, ahead, bumpTo, hash: outcome.hash, ledger: outcome.ledger };
}

// 10. The summary and FAILED.md: public data only, no local path.

const cell = (text) => String(text).replaceAll("|", "\\|").replaceAll("\n", " ");
const linkAccount = (id) => `[${id}](${EXPLORER}/account/${id})`;
const linkTx = (hash) => `[${hash}](${EXPLORER}/tx/${hash})`;
const horizonAccount = (id) => `[Horizon](${HORIZON}/accounts/${id})`;
const passed = (result) =>
  `${result.checks.filter((c) => c.pass).length} of ${result.checks.length} checks passed`;

function ran(stepName) {
  const c = run.commands.find((x) => x.step === stepName);
  if (!c) return `${stepName}: did not run`;
  const mismatch = c.exit === c.expected ? "" : ` (this case expects ${c.expected})`;
  return `\`${c.command}\` exited ${c.exit ?? c.why}${mismatch}`;
}

function txList(transactions) {
  const all = run.report?.transactions ?? [];
  return (
    transactions
      .map((t) => {
        const n = all.indexOf(t) + 1;
        return `tx ${n} (${t.phase}, ${t.result}${t.ledger ? ` in ledger ${t.ledger}` : ""}) ${linkTx(t.hash)}`;
      })
      .join("; ") || "no transaction"
  );
}

/** The two lines the CLI prints around the wait (src/cli/commands/close.ts, event "wait"). */
function waitLines(text) {
  return text
    .split("\n")
    .filter((line) => /waiting for the sequence guard|the latest ledger is|^\s+waited\s/.test(line))
    .map((line) => line.trim());
}

function balanceLine(role, id, before, after) {
  const show = (s) => (s ? `${s.balance} XLM` : "missing (404)");
  let text = `${show(before)} -> ${show(after)}`;
  if (before?.balance && after?.balance) {
    text += ` (${signedXlm(toStroops(after.balance) - toStroops(before.balance))})`;
    text += `, num_sponsoring ${before.numSponsoring} -> ${after.numSponsoring}`;
  }
  const lines = new Map();
  for (const l of before?.trustlines ?? []) lines.set(l.asset, [l.balance, "none"]);
  for (const l of after?.trustlines ?? [])
    lines.set(l.asset, [lines.get(l.asset)?.[0] ?? "none", l.balance]);
  const moved = [...lines].filter(([, [a, b]]) => a !== b);
  if (moved.length > 0) {
    text += `; trustlines ${moved.map(([asset, [a, b]]) => `${asset.split(":")[0]} ${a} -> ${b}`).join(", ")}`;
  }
  return `- ${role} \`${id}\`: ${text}.`;
}

const FILES = [
  ["summary.md", "this page"],
  ["FAILED.md", "why the run did not meet its expectations, and at which step"],
  [
    "fixture-create.txt",
    "`dustin fixture create`: the command and its build log (public keys and hashes)",
  ],
  [
    "fixture-manifest.json",
    "the fixture's public manifest, as `dustin fixture create --json` printed it",
  ],
  ["fixture-verify.txt", "`dustin fixture verify` on that manifest, right after the build"],
  [
    "fixture-verification.json",
    'what it checked (`--snapshot`); for a messy fixture the checks with `"appendixB": true` are the SOW Appendix B preconditions',
  ],
  [
    "setup.json",
    "the transactions this script submitted before the plan, with envelopes and Horizon's records",
  ],
  ["plan.txt", "the dry-run `dustin plan`"],
  ["plan-json.txt", "the same command with `--json`: its standard error and exit code"],
  ["plan.json", "its standard output: the plan as JSON"],
  ["account-before.json", "Horizon's view of the account before the close"],
  ["transcript-refused.txt", "`dustin close --execute --yes` without `--partial`: the refusal"],
  ["transcript.txt", "the close that ran (`--report report.json`), with its receipt"],
  [
    "report.json",
    "the close report written by `--report`, with both envelopes of every transaction as XDR",
  ],
  ["account-after.json", "Horizon's answer for the account after the close: status and body"],
  [
    "balances.json",
    "XLM, num_sponsoring and trustlines of each role before and after, and the ledgers",
  ],
];

const runFailed = () =>
  run.stop !== null || run.failures.length > 0 || run.checks.some((c) => !c.pass);

function summary() {
  const c = CASES[caseName];
  const r = run.report;
  const failed = runFailed();
  let intro;
  let see;
  try {
    intro = c.intro();
  } catch {
    intro = `Case \`${caseName}\` (${c.purpose}).`;
  }
  try {
    see = c.see().map((line, i) => `${i + 1}. ${line}`);
  } catch (error) {
    see = [`Not available, since the run stopped early: ${errorText(error)}.`];
  }
  const onLedger = r?.transactions ?? [];
  const txRows = onLedger.map((t, i) => {
    const record = run.records.get(t.hash);
    const links = `[explorer](${EXPLORER}/tx/${t.hash}), [Horizon](${HORIZON}/transactions/${t.hash})`;
    if (!record) {
      const why =
        t.result === "applied" || t.result === "failed"
          ? "Horizon had no record when this run asked"
          : `not on the ledger (${t.result})`;
      return `| ${i + 1} | ${t.phase} | \`${t.hash}\` | ${t.result} | - | - | ${why} | - | - | ${links} |`;
    }
    return [
      "",
      i + 1,
      t.phase,
      `\`${t.hash}\``,
      t.result,
      record.ledger,
      record.fee_charged,
      record.fee_account === run.sponsor ? "yes (sponsor)" : `no (${record.fee_account})`,
      record.source_account === run.account ? "yes" : `no (${record.source_account})`,
      record.inner_transaction?.max_fee ?? "-",
      links,
      "",
    ]
      .join(" | ")
      .trim();
  });
  const setupRows = run.setup.map(
    (s) =>
      `| ${cell(s.purpose)} | \`${s.hash}\` | ${s.result} | ${s.ledger ?? "-"} | \`${s.feeAccount}\` | \`${s.source}\` | [explorer](${EXPLORER}/tx/${s.hash}), [Horizon](${HORIZON}/transactions/${s.hash}) |`,
  );
  const files = [
    ...FILES.filter(
      ([name]) => name === "summary.md" || staged(name) || (name === "FAILED.md" && failed),
    ),
    ...onLedger
      .map((t, i) => [`tx-${i + 1}.json`, `Horizon's record of transaction ${i + 1}, ${t.hash}`])
      .filter(([name]) => staged(name)),
  ];
  return [
    `# ${c.title} ${NAME}`,
    "",
    intro,
    "",
    `Written by \`node scripts/evidence-cli.mjs ${caseName}\`. Public data only: public keys, hashes, envelopes and Horizon JSON. The secret keys reached \`dustin close\` through its environment only; every file here was scanned for secret seeds and for the fixture's secret keys before it was written.`,
    "",
    ...(failed
      ? [
          "**This run did not meet its expectations: see `FAILED.md`. It is not evidence of the case.**",
          "",
        ]
      : []),
    "## What the reviewer should see",
    "",
    ...see,
    "",
    "## Run",
    "",
    "| Field | Value |",
    "|---|---|",
    `| Captured (UTC) | ${new Date().toISOString()} |`,
    `| Case | \`${caseName}\` (${c.purpose}) |`,
    `| Network passphrase | \`${PASSPHRASE}\` |`,
    `| Horizon | ${HORIZON} |`,
    `| Fixture | ${run.manifest?.id ?? "-"} (profile ${run.manifest?.profile ?? "-"}) |`,
    ...run.people.map(
      ([role, id]) => `| ${role} | ${linkAccount(id)} ([Horizon](${HORIZON}/accounts/${id})) |`,
    ),
    `| Ledgers | latest before the close ${run.ledgerBefore ?? "-"}; after it ${run.ledgerAfter ?? "-"} |`,
    `| Report status | ${r ? `${r.status}${r.message ? ` (${cell(r.message)})` : ""}` : "no report"} |`,
    `| Plan hash of the run | ${r ? `\`${r.planHash}\`` : "-"} |`,
    `| Merged XLM (from the merge result) | ${r?.recovery?.mergedXlm ?? "none: no merge applied"} |`,
    `| Fees paid by the account / by the sponsor | ${r ? `${r.recovery.feesPaidByAccount} / ${r.recovery.feesPaidBySponsorStroops} stroops` : "-"} |`,
    `| Horizon for the account afterwards | ${run.accountAfter ? `HTTP ${run.accountAfter.status}` : "not read"} |`,
    "",
    "## Commands",
    "",
    "Each ran as `node dist/cli/main.js` from this repository's build, shown here as `dustin`.",
    "",
    "| # | Command | Expected exit | Exit | Output |",
    "|---|---|---|---|---|",
    ...run.commands.map(
      (x, i) =>
        `| ${i + 1} | \`${cell(x.command)}\` | ${x.expected} | ${x.exit ?? cell(x.why)} | \`${x.transcript}\`${x.stdoutFile ? `, \`${x.stdoutFile}\`` : ""} |`,
    ),
    "",
    ...(setupRows.length > 0
      ? [
          "## Setup transactions",
          "",
          "Submitted by this script before the plan, to give the fixture the state this case needs.",
          "",
          "| Purpose | Hash | Result | Ledger | Fee account | Source | Links |",
          "|---|---|---|---|---|---|---|",
          ...setupRows,
          "",
        ]
      : []),
    "## Transactions of the close",
    "",
    ...(txRows.length > 0
      ? [
          "| # | Phase | Hash | Result | Ledger | Fee charged (stroops) | Fee account is the sponsor | Source is the account | Inner max_fee | Links |",
          "|---|---|---|---|---|---|---|---|---|---|",
          ...txRows,
        ]
      : [r ? "None: the close submitted nothing." : "No report: see the transcripts."]),
    "",
    "## Checks",
    "",
    ...(run.checks.length > 0
      ? [
          "| Result | Check | Observed |",
          "|---|---|---|",
          ...run.checks.map(
            (x) => `| ${x.pass ? "PASS" : "FAIL"} | ${cell(x.label)} | ${cell(x.observed)} |`,
          ),
        ]
      : ["None evaluated."]),
    "",
    "## Balances",
    "",
    `Latest ledger before the close ${run.ledgerBefore ?? "-"}, after it ${run.ledgerAfter ?? "-"}.`,
    "",
    ...run.roles.map(([role, id], i) => balanceLine(role, id, run.before?.[i], run.after?.[i])),
    "",
    "## Files",
    "",
    ...files.map(([name, what]) => `- \`${name}\`: ${what}.`),
    "",
    "Explorer and Horizon links resolve only until the next testnet reset (scheduled for 2026-12-16), which deletes every account and transaction; the JSON, the XDR and the transcripts in this directory are the durable record.",
    "",
  ].join("\n");
}

function failedNote() {
  const unmet = run.checks.filter((c) => !c.pass);
  return [
    `# FAILED: ${NAME}`,
    "",
    run.stop
      ? `The run stopped at the step "${run.stop.step}": ${run.stop.detail}.`
      : "Every command ran with the exit code this case expects, but the run is not complete.",
    "",
    ...(run.failures.length > 0
      ? [
          "What could not be recorded:",
          "",
          ...run.failures.map((f) => `- ${f.step}: ${f.detail}`),
          "",
        ]
      : []),
    ...(unmet.length > 0
      ? [
          "Expectations not met:",
          "",
          ...unmet.map((c) => `- ${c.label} (observed: ${c.observed})`),
          "",
        ]
      : []),
    `Something in this run may have reached the ledger (${run.changed.join("; ")}), so the fixture ${run.manifest?.id} is not used again. Everything gathered is in this directory, the transcripts included. It is not evidence of the case: run \`node scripts/evidence-cli.mjs ${caseName}\` again, which builds a fresh fixture.`,
    "",
  ].join("\n");
}

// 11. Scan, then move the staged run into evidence/runs/.

/** Null when the run was moved in; otherwise the files that hold a secret (nothing was moved). */
function publish() {
  for (const entry of readdirSync(run.staging)) {
    const path = stagePath(entry);
    if (!lstatSync(path).isFile()) throw new Error(`the staged run holds ${entry}, not a file`);
    // Left only when one of the CLI's atomic --report writes failed half way; the report is whole.
    if (entry.endsWith(".tmp")) rmSync(path);
  }
  const hits = [];
  for (const entry of readdirSync(run.staging)) {
    const found = leaks(readFileSync(stagePath(entry), "utf8"));
    if (found.length > 0) hits.push(`${entry} holds ${found.join(" and ")}`);
  }
  if (hits.length > 0) return hits;
  if (existsSync(TARGET)) throw new Error(`${SHOWN} appeared meanwhile; it is never overwritten`);
  try {
    renameSync(run.staging, TARGET);
  } catch (error) {
    if (error.code !== "EXDEV") throw error;
    // The temporary directory is on another file system: copy it next to the target, then rename.
    const partial = join(RUNS, `.${NAME}.partial`);
    try {
      cpSync(run.staging, partial, { recursive: true, errorOnExist: true, force: false });
      renameSync(partial, TARGET);
    } finally {
      rmSync(partial, { recursive: true, force: true });
    }
  }
  chmodSync(TARGET, 0o755);
  return null;
}

async function finish() {
  if (run.stop) log(scrub(`stopped at "${run.stop.step}": ${run.stop.detail}`));
  if (run.changed.length === 0) {
    log("nothing was submitted, so nothing is written");
    return 1;
  }
  await gatherAfter();
  try {
    stageText("summary.md", summary());
  } catch (error) {
    run.failures.push({ step: "write summary.md", detail: errorText(error) });
    stageText(
      "summary.md",
      `# ${NAME}\n\nThe summary could not be written: ${errorText(error)}.\n`,
    );
  }
  const failed = runFailed();
  if (failed) stageText("FAILED.md", failedNote());
  const refused = publish();
  if (refused) {
    log(`refusing to write ${SHOWN}: ${refused.join("; ")}. Nothing was written.`);
    for (const name of ["transcript-refused.txt", "transcript.txt"]) showScrubbed(name);
    return 1;
  }
  for (const f of run.failures) log(scrub(`could not record ${f.step}: ${f.detail}`));
  for (const c of run.checks.filter((x) => !x.pass)) {
    log(scrub(`expectation not met: ${c.label} (${c.observed})`));
  }
  console.log(
    JSON.stringify(
      {
        dir: SHOWN,
        case: caseName,
        result: failed ? "FAILED (see FAILED.md)" : "ok",
        fixture: run.manifest?.id ?? null,
        account: run.account,
        commands: run.commands.map((c) => [c.command, c.expected, c.exit ?? c.why]),
        setup: run.setup.map((s) => [s.purpose, s.hash, s.result, s.ledger]),
        transactions: (run.report?.transactions ?? []).map((t) => [
          t.phase,
          t.hash,
          t.result,
          t.ledger,
        ]),
        accountAfter: run.accountAfter?.status ?? null,
      },
      null,
      2,
    ),
  );
  return failed ? 1 : 0;
}

let exitCode = 1;
try {
  run.staging = mkdtempSync(join(tmpdir(), "dustin-evidence-"));
  log(`case ${caseName}, run ${SHOWN}; staged in ${run.staging} until it is complete`);
  try {
    await step("check that Horizon serves the testnet", () => verifyHorizonIsTestnet(HORIZON));
    await CASES[caseName].run();
  } catch (error) {
    run.stop =
      error instanceof StepFailure
        ? { step: error.step, detail: error.message }
        : { step: "an unexpected error", detail: error?.stack ?? String(error) };
  }
  exitCode = await finish();
} catch (error) {
  log(`unexpected error: ${scrub(error?.stack ?? String(error))}`);
} finally {
  if (run.staging) rmSync(run.staging, { recursive: true, force: true });
}
process.exitCode = exitCode;
