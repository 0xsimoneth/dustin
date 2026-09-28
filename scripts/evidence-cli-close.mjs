// A live close through the command line, recorded as evidence (story E3-S7): build a fresh messy
// fixture with `dustin fixture create`, verify it, print the dry-run plan, close it with
// `dustin close --execute --yes --report`, then collect Horizon's records into
// evidence/runs/<UTC stamp>-<label>/. Testnet only; every account is a throwaway funded by Friendbot.
// Run from the repository root after `npm run build`:
//   node scripts/evidence-cli-close.mjs e3-cli
// Secrets: read from the fixture's keys file under .fixture/ (gitignored) and passed to the close
// command in its environment only, never on the command line. Every file is scanned for
// seed-shaped strings and for each secret (StrKey, raw hex, raw base64) before anything is written.
import { Buffer } from "node:buffer";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { join } from "node:path";

const require = createRequire(join(process.cwd(), "package.json"));
const { Keypair } = require("@stellar/stellar-sdk");

const HORIZON = "https://horizon-testnet.stellar.org";
const EXPLORER = "https://stellar.expert/explorer/testnet";
const label = process.argv[2] ?? "e3-cli";
const cli = ["dist/cli/main.js"];

const stamp = new Date()
  .toISOString()
  .replace(/[-:]/g, "")
  .replace(/\.\d+Z$/, "Z");
const dir = join("evidence", "runs", `${stamp}-${label}`);
if (existsSync(dir)) throw new Error(`${dir} exists`);

function run(args, env = {}) {
  const r = spawnSync("node", [...cli, ...args], {
    env: { ...process.env, ...env, NO_COLOR: "1" },
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return { code: r.status, out: r.stdout, err: r.stderr };
}
/** stdout and stderr interleaved as a terminal shows them: run through `sh -c '... 2>&1'`. */
function runMerged(args, env = {}) {
  const quoted = ["node", ...cli, ...args].map((a) => `'${a.replaceAll("'", "'\\''")}'`).join(" ");
  const r = spawnSync("sh", ["-c", `${quoted} 2>&1`], {
    env: { ...process.env, ...env, NO_COLOR: "1" },
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return { code: r.status, text: r.stdout };
}
async function horizon(path) {
  const res = await globalThis.fetch(`${HORIZON}${path}`, {
    headers: { accept: "application/json" },
  });
  return { status: res.status, body: await res.json() };
}
async function state(id) {
  const r = await horizon(`/accounts/${id}`);
  if (r.status !== 200) return null;
  const native = r.body.balances.find((b) => b.asset_type === "native");
  return {
    balance: native.balance,
    numSponsoring: r.body.num_sponsoring,
    numSponsored: r.body.num_sponsored,
  };
}

// 1. Build the fixture with the CLI.
const built = run(["fixture", "create", "--profile", "messy", "--dir", ".fixture", "--json"]);
if (built.code !== 0) throw new Error(`fixture create exited ${built.code}: ${built.err}`);
const manifest = JSON.parse(built.out);
const a = manifest.accounts;
const keysPath = join(".fixture", manifest.id, "keys.json");
const keys = JSON.parse(readFileSync(keysPath, "utf8"));
const secrets = Object.values(keys.secrets);

// 2. Verify it right before the close (SOW Appendix B).
const files = new Map();
const verifyPath = join(mkdtempSync(join(tmpdir(), "dustin-verify-")), "verification.json");
const verified = run([
  "fixture",
  "verify",
  join(".fixture", manifest.id, "manifest.json"),
  "--snapshot",
  verifyPath,
]);
if (verified.code !== 0)
  throw new Error(`fixture verify exited ${verified.code}: ${verified.out}${verified.err}`);
files.set("fixture-verification.json", readFileSync(verifyPath, "utf8"));
files.set("fixture-manifest.json", `${JSON.stringify(manifest, null, 2)}\n`);

// 3. The dry-run plan, as text and JSON (the account is untouched).
const planText = runMerged(["plan", a.fixture, "--to", a.destination, "--sponsor", a.sponsor]);
if (planText.code !== 0) throw new Error(`plan exited ${planText.code}`);
files.set(
  "plan.txt",
  `$ dustin plan ${a.fixture} --to ${a.destination} --sponsor ${a.sponsor}\n${planText.text}`,
);
const planJson = run(["plan", a.fixture, "--to", a.destination, "--sponsor", a.sponsor, "--json"]);
files.set("plan.json", planJson.out);

// 4. State before.
const roles = [
  ["Destination", a.destination],
  ["Reserve sponsor", a.reserveSponsor],
  ["Fee sponsor", a.sponsor],
];
const before = await Promise.all(roles.map(([, id]) => state(id)));
const accountBefore = await horizon(`/accounts/${a.fixture}`);
files.set("account-before.json", `${JSON.stringify(accountBefore.body, null, 2)}\n`);
const ledgerBefore = (await horizon("/ledgers?order=desc&limit=1")).body._embedded.records[0]
  .sequence;

// 5. The close through the CLI.
mkdirSync(dir, { recursive: true });
const reportPath = join(dir, "report.json");
const closeArgs = [
  "close",
  a.fixture,
  "--to",
  a.destination,
  "--execute",
  "--yes",
  "--report",
  reportPath,
];
const closed = runMerged(closeArgs, {
  DUSTIN_ACCOUNT_SECRET: keys.secrets.fixture,
  DUSTIN_SPONSOR_SECRET: keys.secrets.sponsor,
});
files.set("transcript.txt", `$ dustin ${closeArgs.join(" ")}\n${closed.text}`);
const report = JSON.parse(readFileSync(reportPath, "utf8"));

// 6. Horizon's records after.
const txs = [];
for (const [i, t] of report.transactions.entries()) {
  const r = await horizon(`/transactions/${t.hash}`);
  txs.push({
    n: i + 1,
    hash: t.hash,
    status: r.status,
    body: r.body,
    phase: t.phase,
    result: t.result,
    ledger: t.ledger,
  });
  files.set(
    `tx-${i + 1}.json`,
    `${JSON.stringify({ hash: t.hash, horizon: r.status === 200 ? r.body : null }, null, 2)}\n`,
  );
}
const after = await Promise.all(roles.map(([, id]) => state(id)));
const accountAfter = await horizon(`/accounts/${a.fixture}`);
files.set(
  "account-after.json",
  `${JSON.stringify({ status: accountAfter.status, body: accountAfter.body }, null, 2)}\n`,
);
const ledgerAfter = (await horizon("/ledgers?order=desc&limit=1")).body._embedded.records[0]
  .sequence;
files.set(
  "balances.json",
  `${JSON.stringify({ ledgers: { before: ledgerBefore, after: ledgerAfter }, accounts: roles.map(([role, account], i) => ({ role, account, before: before[i], after: after[i] })) }, null, 2)}\n`,
);

// 7. Summary.
const link = (id) => `[${id}](${EXPLORER}/account/${id})`;
const rows = txs.map((t) => {
  const rec = t.body ?? {};
  return `| ${t.n} | ${t.phase} | \`${t.hash}\` | ${t.result} | ${t.ledger ?? "-"} | ${rec.fee_account === a.sponsor ? "yes (sponsor)" : `no (${rec.fee_account ?? "-"})`} | ${rec.source_account === a.fixture ? "yes" : `no (${rec.source_account ?? "-"})`} | ${rec.inner_transaction?.max_fee ?? "-"} | [explorer](${EXPLORER}/tx/${t.hash}) |`;
});
const moved = (s, i) =>
  before[i] && after[i]
    ? `${before[i].balance} -> ${after[i].balance} XLM, num_sponsoring ${before[i].numSponsoring} -> ${after[i].numSponsoring}`
    : `${before[i]?.balance ?? "missing"} -> ${after[i]?.balance ?? "missing"}`;
const summary = [
  `# Live CLI close ${stamp}-${label}`,
  "",
  "The Epic 3 metric close (story E3-S7) driven end to end through the command line: `dustin fixture create --profile messy`, `dustin fixture verify`, the dry-run `dustin plan`, then `dustin close --execute --yes --report`, all with the default ladder order (the SOW order). Public data only: public keys, hashes, envelopes and Horizon JSON; the secrets were passed to the close command in its environment and appear in no file.",
  "",
  "| Field | Value |",
  "|---|---|",
  `| Captured (UTC) | ${new Date().toISOString()} |`,
  `| Fixture | ${manifest.id} (profile ${manifest.profile}) |`,
  `| Closed account | ${link(a.fixture)} |`,
  `| Destination | ${link(a.destination)} |`,
  `| Fee sponsor (fee account of every transaction) | ${link(a.sponsor)} |`,
  `| Reserve sponsor | ${link(a.reserveSponsor)} |`,
  `| CLI exit code | ${closed.code} |`,
  `| Report status | ${report.status} |`,
  `| Merged XLM (from the merge result) | ${report.recovery.mergedXlm ?? "-"} |`,
  `| Fees paid by the closed account / by the sponsor | ${report.recovery.feesPaidByAccount} / ${report.recovery.feesPaidBySponsorStroops} stroops |`,
  `| Horizon for the account afterwards | HTTP ${accountAfter.status} |`,
  `| Ledgers | before ${ledgerBefore}; after ${ledgerAfter} |`,
  "",
  "| # | Phase | Hash | Result | Ledger | Fee account is the sponsor | Source is the closed account | Inner max_fee | Explorer |",
  "|---|---|---|---|---|---|---|---|---|",
  ...rows,
  "",
  "Balances:",
  "",
  ...roles.map(([role, id], i) => `- ${role} ${id}: ${moved(role, i)}.`),
  "",
  "Files: `transcript.txt` (the close command's output), `plan.txt` and `plan.json` (the dry-run plan before the close), `report.json` (the close report written by `--report`), `fixture-manifest.json`, `fixture-verification.json` (SOW Appendix B checks before the close), `account-before.json`, `tx-<n>.json` (Horizon's record of each hash), `account-after.json` (Horizon's answer for the closed account), `balances.json`. Explorer links stop resolving at the next testnet reset (scheduled for 2026-12-16); the JSON and XDR are the durable record.",
  "",
].join("\n");
files.set("summary.md", summary);

// 8. Secret scan, then write.
const seed = /(?<![A-Z2-7])S[A-Z2-7]{55}(?![A-Z2-7])/;
// Every form a leak could take: StrKey, and the raw 32-byte seed as hex and base64.
const forms = secrets.flatMap((s) => {
  const raw = Buffer.from(Keypair.fromSecret(s).rawSecretKey());
  return [s, raw.toString("hex"), raw.toString("base64")];
});
for (const [name, content] of files) {
  if (seed.test(content)) throw new Error(`refusing to write: ${name} holds a seed-shaped string`);
  for (const s of forms)
    if (content.includes(s)) throw new Error(`refusing to write: ${name} holds a secret`);
}
const reportText = readFileSync(reportPath, "utf8");
if (seed.test(reportText) || forms.some((s) => reportText.includes(s)))
  throw new Error("report.json holds a secret");
for (const [name, content] of files) writeFileSync(join(dir, name), content);
console.log(
  JSON.stringify(
    {
      dir,
      exit: closed.code,
      status: report.status,
      accountAfter: accountAfter.status,
      fixture: manifest.id,
      txs: txs.map((t) => [t.phase, t.hash, t.result, t.ledger]),
    },
    null,
    2,
  ),
);
