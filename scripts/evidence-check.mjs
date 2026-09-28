// Checks every link of the evidence package (story E4-S7, AC-E4-S7-3): relative links point to
// files that exist, every transaction hash linked on Horizon or StellarExpert exists on testnet
// Horizon (GET /transactions/<hash> answers 200), and every other https link resolves (a status
// below 400). A Horizon /accounts/<id> that answers 404 is listed as "account gone" (a closed
// account, which is what the evidence shows), not as a failure. Any Horizon or explorer network
// other than the testnet is refused without a request. Every failure is listed; the exit code is 1
// when there is one, 2 for a usage error, and 0 otherwise.
//
// Usage: npm run evidence:check [-- <file.md> ...]
// Default files: evidence/README.md and every evidence/runs/*/summary.md.
//
// Only GET requests, to public endpoints. Testnet resets delete every account, transaction and
// explorer link (docs/README.md canonical decision 12), so after the next reset this check fails by
// design; the JSON and XDR files in the run directories remain the durable record.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, normalize } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";
/* global fetch, AbortSignal -- Node 22 globals (package.json engines) */

export const TESTNET_HORIZON = "https://horizon-testnet.stellar.org";
const TESTNET_HOST = "horizon-testnet.stellar.org";
const CONCURRENCY = 4;
const RETRIES = 3;
const TIMEOUT_MS = 20_000;

/** The Horizon this script asks; anything but the testnet one is refused. */
export function assertTestnetHorizon(url) {
  if (url.replace(/\/+$/, "") !== TESTNET_HORIZON) {
    throw new Error(
      `Refusing ${url}: evidence:check only asks the testnet Horizon ${TESTNET_HORIZON}.`,
    );
  }
}

/** The text with every character but line breaks replaced by spaces, so offsets and lines hold. */
const blank = (text) => text.replace(/[^\n]/g, " ");

/**
 * Every link target of a Markdown text with its line number, in reading order: inline links and
 * images `[text](target "title")`, autolinks `<https://...>`, bare `https://` URLs and reference
 * definitions `[ref]: target`. Code spans and fenced blocks are left out: they hold commands and
 * URL templates, not links.
 */
export function extractLinks(markdown) {
  let text = markdown.replace(/^(```|~~~)[^\n]*\n[\s\S]*?^\1[^\n]*$/gm, (block) => blank(block));
  text = text.replace(/`+[^`\n]*`+/g, (span) => blank(span));
  const found = [];
  const lineOf = (index) => text.slice(0, index).split("\n").length;
  const take = (regex, group) => {
    text = text.replace(regex, (match, ...rest) => {
      const index = rest.at(-2);
      found.push({ target: group === 0 ? match : rest[group - 1], index, line: lineOf(index) });
      return blank(match);
    });
  };
  take(/^[ \t]*\[[^\]\n]+\]:[ \t]*<?([^\s>]+)>?.*$/gm, 1);
  take(/\[[^\]\n]*\]\(\s*<?([^()\s<>]+)>?(?:\s+"[^"\n]*")?\s*\)/g, 1);
  take(/<(https?:\/\/[^\s<>]+)>/g, 1);
  take(/https?:\/\/[^\s<>()[\]"'`]+/g, 0);
  return found
    .map((l) => ({ ...l, target: l.target.replace(/[.,;:!?]+$/, "") }))
    .sort((a, b) => a.index - b.index)
    .map(({ target, line }) => ({ target, line }));
}

/** What a link target is, and so how it is checked. Pure. */
export function classifyLink(target) {
  if (target.startsWith("#")) return { kind: "anchor" };
  if (target.startsWith("mailto:")) return { kind: "mailto" };
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(target);
  if (!scheme) {
    const path = decodeURI(target.replace(/[?#].*$/, ""));
    return { kind: "relative", path };
  }
  if (!/^https?$/i.test(scheme[1])) {
    return { kind: "refused", reason: `unsupported link scheme ${scheme[1]}:` };
  }
  let url;
  try {
    url = new URL(target);
  } catch {
    return { kind: "refused", reason: "not a valid URL" };
  }
  if (url.hostname === TESTNET_HOST) {
    const tx = /^\/transactions\/([0-9a-f]{64})\/?$/.exec(url.pathname);
    if (tx) return { kind: "tx", hash: tx[1], via: "horizon" };
    const account = /^\/accounts\/(G[A-Z2-7]{55})\/?$/.exec(url.pathname);
    if (account) return { kind: "horizon-account", account: account[1] };
    return { kind: "https", url: target };
  }
  if (/(^|\.)horizon[^.]*\./.test(url.hostname) || url.hostname.startsWith("horizon")) {
    return {
      kind: "refused",
      reason: `${url.hostname} is not the testnet Horizon ${TESTNET_HOST}`,
    };
  }
  if (url.hostname === "stellar.expert") {
    const network = /^\/explorer\/([^/]+)/.exec(url.pathname)?.[1];
    if (network && network !== "testnet") {
      return { kind: "refused", reason: `StellarExpert network ${network} is not the testnet` };
    }
    const tx = /^\/explorer\/testnet\/tx\/([0-9a-f]{64})\/?$/.exec(url.pathname);
    if (tx) return { kind: "tx", hash: tx[1], via: "stellar.expert" };
  }
  return { kind: "https", url: target };
}

/** The verdict on one network answer (`status` null when there was none). Pure. */
export function judgeResponse(c, status, error) {
  const what =
    c.kind === "tx"
      ? `transaction ${c.hash}`
      : c.kind === "horizon-account"
        ? `account ${c.account}`
        : c.url;
  if (status === null)
    return { verdict: "failed", detail: `${what} did not answer: ${error ?? "no response"}` };
  if (c.kind === "tx") {
    return status === 200
      ? { verdict: "ok", detail: `transaction on testnet Horizon (HTTP 200)` }
      : { verdict: "failed", detail: `${what} not found on testnet Horizon (HTTP ${status})` };
  }
  if (c.kind === "horizon-account") {
    if (status === 200) return { verdict: "ok", detail: "account exists (HTTP 200)" };
    if (status === 404) return { verdict: "gone", detail: `${what} gone (Horizon 404)` };
    return { verdict: "failed", detail: `${what}: Horizon answered HTTP ${status}` };
  }
  return status < 400
    ? { verdict: "ok", detail: `HTTP ${status}` }
    : { verdict: "failed", detail: `${what} answered HTTP ${status}` };
}

/** evidence/README.md and every evidence/runs/<run>/summary.md under `root`, sorted. */
export function defaultFiles(root) {
  const files = [join("evidence", "README.md")];
  const runs = join(root, "evidence", "runs");
  if (existsSync(runs)) {
    for (const run of readdirSync(runs, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort()) {
      if (existsSync(join(runs, run, "summary.md")))
        files.push(join("evidence", "runs", run, "summary.md"));
    }
  }
  return files;
}

const LABEL = { ok: "OK", gone: "GONE", skipped: "SKIP", failed: "FAIL" };

/** The report: every failure and every gone account, then the counts. */
export function render(results) {
  const lines = results
    .filter((r) => r.verdict === "failed" || r.verdict === "gone")
    .map((r) => `${LABEL[r.verdict].padEnd(6)}  ${r.file}:${r.line}  ${r.target}  ${r.detail}`);
  const count = (v) => results.filter((r) => r.verdict === v).length;
  lines.push(
    `${results.length} links: ${count("ok")} ok, ${count("gone")} account gone, ${count("skipped")} skipped, ${count("failed")} failed.`,
  );
  return `${lines.join("\n")}\n`;
}

export const exitCodeOf = (results) => (results.some((r) => r.verdict === "failed") ? 1 : 0);

/** GET with a timeout and retries on network errors, 429 and 5xx; the last status or error. */
async function get(url) {
  let error = "";
  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    if (attempt > 0) await delay(1000 * 2 ** (attempt - 1));
    try {
      const response = await fetch(url, {
        headers: { accept: "application/json, text/html;q=0.9, */*;q=0.8" },
        redirect: "follow",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      await response.body?.cancel();
      if (response.status !== 429 && response.status < 500) return { status: response.status };
      error = `HTTP ${response.status}`;
      if (attempt === RETRIES) return { status: response.status };
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    }
  }
  return { status: null, error };
}

async function main(argv) {
  const horizon = process.env.DUSTIN_HORIZON_URL ?? TESTNET_HORIZON;
  try {
    assertTestnetHorizon(horizon);
  } catch (error) {
    console.error(`evidence:check: ${error.message}`);
    return 2;
  }
  const files = argv.length > 0 ? argv : defaultFiles(process.cwd());
  const missing = files.filter((f) => !existsSync(f));
  if (missing.length > 0) {
    console.error(`evidence:check: no such file: ${missing.join(", ")}`);
    return 2;
  }
  const results = [];
  const pending = new Map();
  for (const file of files) {
    for (const link of extractLinks(readFileSync(file, "utf8"))) {
      const c = classifyLink(link.target);
      const row = { file, line: link.line, target: link.target };
      if (c.kind === "anchor" || c.kind === "mailto") {
        results.push({ ...row, verdict: "skipped", detail: c.kind });
      } else if (c.kind === "refused") {
        results.push({ ...row, verdict: "failed", detail: `refused: ${c.reason}` });
      } else if (c.kind === "relative") {
        const path = normalize(join(dirname(file), c.path));
        results.push(
          existsSync(path)
            ? { ...row, verdict: "ok", detail: "exists" }
            : { ...row, verdict: "failed", detail: `${path} does not exist` },
        );
      } else {
        const url =
          c.kind === "tx"
            ? `${TESTNET_HORIZON}/transactions/${c.hash}`
            : c.kind === "horizon-account"
              ? `${TESTNET_HORIZON}/accounts/${c.account}`
              : c.url;
        const entry = { ...row, verdict: "failed", detail: "not checked" };
        results.push(entry);
        if (!pending.has(url)) pending.set(url, { c, rows: [] });
        pending.get(url).rows.push(entry);
      }
    }
  }
  const queue = [...pending.entries()];
  console.error(
    `evidence:check: ${files.length} file(s), ${results.length} links, ${queue.length} distinct URLs to ask (testnet Horizon ${TESTNET_HORIZON})`,
  );
  const worker = async () => {
    for (let next = queue.shift(); next; next = queue.shift()) {
      const [url, { c, rows }] = next;
      const answer = await get(url);
      const judged = judgeResponse(c, answer.status, answer.error);
      for (const r of rows) Object.assign(r, judged);
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  process.stdout.write(render(results));
  return exitCodeOf(results);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main(process.argv.slice(2));
}
