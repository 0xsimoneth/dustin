// Checks every link of the evidence package and every transaction hash it lists (story E4-S7,
// AC-E4-S7-3; Epic 4 review EP-5 to EP-16, BH-7, BH-8, BH-16, AC-11):
//
// - A relative link must name a file committed to the repository (`git ls-files`, exact case);
//   outside a git checkout it is checked on the disk instead, and the report says so. A link that
//   starts with `/` is resolved from the repository root, as GitHub renders it. An anchor, alone or
//   after a Markdown file, must be one of that file's headings (GitHub's slugs) or explicit ids.
// - Every transaction hash, linked on Horizon or StellarExpert or listed in a code span or a table
//   cell, must exist on testnet Horizon (GET /transactions/<hash> answers 200); each listed hash is
//   reported once. A labelled plan, snapshot, recipe or pool hash is not a transaction.
// - An account linked on Horizon or StellarExpert is asked on testnet Horizon. A 404 with history
//   that ends in the account's own account_merge is "gone (merged)", which is what the evidence
//   shows for a closed account; a 404 with no history at all is a failure (the account never
//   existed on this network, or a reset removed it).
// - Every other https link must resolve (a status below 400), following at most five redirects,
//   none of them to a refused URL.
// - Any Horizon, RPC or explorer network other than the testnet is refused without a request: a
//   host that names the mainnet, every Horizon host but horizon-testnet.stellar.org (unknown Horizon
//   providers are refused, not probed), StellarExpert networks other than testnet, the mainnet
//   explorers stellarchain.io, steexp.com, lumenscan.io and blockchair.com/stellar, and Stellar
//   Lab links that name the mainnet.
// - With the default files, the stored transaction records too (the final audit of 2026-09-30):
//   every committed evidence/tests/transactions/<hash>.json must be Horizon's record of that
//   transaction, and while the testnet keeps it, equal to Horizon's answer in its ledger, time,
//   result and envelopes; every transaction the documents of STORED_TX_SOURCES cite (listed or
//   linked) must have a stored record there or in a run directory, unless its line says the
//   envelope was never on the ledger. These records outlive the testnet reset.
//
// Outcomes: OK, GONE (a merged account), SKIP (mailto), FAIL (the link or hash is wrong) and
// UNCHECKED (no answer could be had: a network error, a timeout, HTTP 429 or 5xx after the
// retries, or a bot protection's 403; a Retry-After of up to 60 seconds is honoured). Exit code 0
// when every link is OK, GONE or SKIP; 1 when one FAILED; 3 when none failed but one is UNCHECKED;
// 2 for a usage error.
//
// Usage: npm run evidence:check [-- <file.md> ...]
// Default files: every Markdown file under evidence/, README.md and docs/write-up.md.
//
// Only GET requests, to public endpoints. Testnet resets delete every account, transaction and
// explorer link (docs/README.md canonical decision 12), so after the next reset this check fails by
// design; the JSON and XDR files in the run directories remain the durable record.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, normalize, relative, resolve, sep } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";
/* global fetch, AbortSignal -- Node 22 globals (package.json engines) */

export const TESTNET_HORIZON = "https://horizon-testnet.stellar.org";
const TESTNET_HOST = "horizon-testnet.stellar.org";
const CONCURRENCY = 4;
const RETRIES = 3;
const TIMEOUT_MS = 20_000;
/** The longest Retry-After that is waited for; a longer one leaves the link UNCHECKED. */
export const RETRY_AFTER_MAX_MS = 60_000;
const MAX_REDIRECTS = 5;
/** Horizon's largest page: the operations searched for an account's merge. */
const LATEST_OPERATIONS = 200;

/** The stored Horizon records of the transactions that the documents cite as text only. */
export const STORED_TX_DIR = "evidence/tests/transactions";
/** The documents whose cited transactions must each have a stored record. */
export const STORED_TX_SOURCES = [
  "docs/test-matrix.md",
  "docs/write-up.md",
  "evidence/baseline/README.md",
  "docs/stories/3-1-ladder-path-payment.md",
  "docs/stories/3-2-ladder-issuer-destination-unclosable.md",
  "docs/stories/3-3-sponsored-trustline-unwind.md",
  "docs/stories/3-4-seqnum-too-far-guard.md",
];
/** The fields of a stored record that Horizon's answer must repeat while the testnet keeps it. */
const STORED_FIELDS = ["ledger", "created_at", "successful", "envelope_xdr", "result_xdr"];

export const EXIT = { OK: 0, FAILED: 1, USAGE: 2, UNCHECKED: 3 };

export const USAGE = `Usage: npm run evidence:check [-- <file.md> ...]

Checks every link and every listed transaction hash of the given Markdown files; by default every
Markdown file under evidence/, README.md and docs/write-up.md, and then the stored transaction
records of ${STORED_TX_DIR}/ as well: each must be Horizon's record of its transaction and equal to
Horizon's answer, and every transaction the documents cite as text must have one. Only the testnet
Horizon is asked (DUSTIN_HORIZON_URL may name it, nothing else).

Exit codes: 0 every link checked and fine (a merged account counts as fine), 1 a link or hash
failed, 3 none failed but some could not be checked (network error, timeout, HTTP 429 or 5xx after
the retries, a bot protection's 403), 2 usage error.
`;

/** The Horizon this script asks, from DUSTIN_HORIZON_URL; empty counts as unset (EP-16). */
export function horizonFromEnv(env) {
  return env.DUSTIN_HORIZON_URL || TESTNET_HORIZON;
}

/** The Horizon this script asks; anything but the testnet one is refused. */
export function assertTestnetHorizon(url) {
  if (url.replace(/\/+$/, "") !== TESTNET_HORIZON) {
    throw new Error(
      `Refusing ${url}: evidence:check only asks the testnet Horizon ${TESTNET_HORIZON}.`,
    );
  }
}

// ---------------------------------------------------------------------------------------------
// Markdown

/** The text with every character but line breaks replaced by spaces, so offsets and lines hold. */
const blank = (text) => text.replace(/[^\n]/g, " ");
const HASH = /(?<![0-9A-Fa-f])[0-9A-Fa-f]{64}(?![0-9A-Fa-f])/g;

/** Width of a line's leading whitespace, a tab counting to the next multiple of four. */
function indentOf(line) {
  let width = 0;
  for (const ch of line) {
    if (ch === " ") width += 1;
    else if (ch === "\t") width += 4 - (width % 4);
    else break;
  }
  return width;
}

/**
 * Blanks fenced code blocks (any indentation, so fences inside list items too; three or more
 * backticks or tildes, closed by a fence of the same character at least as long, or unclosed to
 * the end of the text) and indented code blocks (four spaces beyond the enclosing list item's
 * content, after a blank line), which hold commands and URL templates rather than links (EP-13).
 */
export function blankCodeBlocks(markdown) {
  const lines = markdown.split("\n");
  let fence = null;
  let prevBlank = true;
  let inIndentedCode = false;
  let listIndent = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (fence) {
      const close = /^\s*(`{3,}|~{3,})\s*$/.exec(line);
      lines[i] = blank(line);
      if (close && close[1][0] === fence.char && close[1].length >= fence.length) fence = null;
      prevBlank = false;
      continue;
    }
    const isBlank = /^\s*$/.test(line);
    if (isBlank) {
      prevBlank = true;
      continue;
    }
    const indent = indentOf(line);
    if ((prevBlank || inIndentedCode) && indent >= listIndent + 4) {
      lines[i] = blank(line);
      inIndentedCode = true;
      prevBlank = false;
      continue;
    }
    inIndentedCode = false;
    const open = /^\s*(`{3,}|~{3,})(.*)$/.exec(line);
    if (open && !(open[1][0] === "`" && open[2].includes("`"))) {
      fence = { char: open[1][0], length: open[1].length };
      lines[i] = blank(line);
      prevBlank = false;
      continue;
    }
    const item = /^(\s*)([-*+]|\d{1,9}[.)])([ \t]+)(?=\S)/.exec(line);
    // The item's content column: its indentation, the marker, and the spaces after it (one when
    // there are more than four, which then start an indented code block inside the item).
    if (item) {
      listIndent = indentOf(item[1]) + item[2].length + (item[3].length > 4 ? 1 : item[3].length);
    } else if (prevBlank && indent < listIndent) listIndent = 0;
    prevBlank = false;
  }
  return lines.join("\n");
}

/** Code spans: a run of backticks up to the next run of the same length (EP-13). */
function codeSpans(text) {
  const spans = [];
  const runs = [...text.matchAll(/`+/g)];
  for (let i = 0; i < runs.length; i++) {
    const open = runs[i];
    const close = runs.slice(i + 1).find((r) => r[0].length === open[0].length);
    if (!close) continue;
    const start = open.index;
    const end = close.index + close[0].length;
    // A span does not cross a blank line (it ends the paragraph).
    if (/\n[ \t]*\n/.test(text.slice(start, end))) continue;
    const contentStart = start + open[0].length;
    spans.push({ start, end, contentStart, content: text.slice(contentStart, close.index) });
    i = runs.indexOf(close);
  }
  return spans;
}

const lineAt = (text) => {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === "\n") starts.push(i + 1);
  return (index) => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= index) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };
};

/** The index of the `]` that closes the `[` at `open`, or -1 (nested brackets; no blank line). */
function closingBracket(text, open) {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const ch = text[i];
    if (ch === "\\") {
      i++;
      continue;
    }
    if (ch === "\n" && /^\n[ \t]*\n/.test(text.slice(i, i + 3 + 16))) return -1;
    if (ch === "[") depth++;
    else if (ch === "]" && --depth === 0) return i;
  }
  return -1;
}

/**
 * The destination and title of an inline link from the `(` at `open`: `<...>` (spaces allowed),
 * or a run without spaces and with balanced parentheses; then an optional title in "", '' or ()
 * (EP-5). Returns { target, end } with `end` just past the `)`, or null.
 */
function inlineDestination(text, open) {
  let i = open + 1;
  const skip = () => {
    let newlines = 0;
    while (i < text.length && /[ \t\n]/.test(text[i])) {
      if (text[i] === "\n" && ++newlines > 1) return false;
      i++;
    }
    return true;
  };
  if (!skip()) return null;
  let target;
  if (text[i] === "<") {
    const close = text.indexOf(">", i);
    if (close < 0) return null;
    target = text.slice(i + 1, close);
    if (/[\n<]/.test(target)) return null;
    i = close + 1;
  } else {
    let depth = 0;
    const start = i;
    for (; i < text.length; i++) {
      const ch = text[i];
      if (ch === "\\") {
        i++;
        continue;
      }
      if (/\s/.test(ch)) break;
      if (ch === "(") depth++;
      else if (ch === ")") {
        if (depth === 0) break;
        depth--;
      }
    }
    target = text.slice(start, i).replace(/\\(.)/g, "$1");
  }
  const beforeTitle = i;
  if (!skip()) return null;
  const quote = text[i];
  if (i > beforeTitle && (quote === '"' || quote === "'" || quote === "(")) {
    const closing = quote === "(" ? ")" : quote;
    let j = i + 1;
    for (; j < text.length && text[j] !== closing; j++) {
      if (text[j] === "\\") j++;
      if (text[j] === "\n" && /^\n[ \t]*\n/.test(text.slice(j, j + 3 + 16))) return null;
    }
    if (j >= text.length) return null;
    i = j + 1;
    if (!skip()) return null;
  }
  if (text[i] !== ")") return null;
  return { target, end: i + 1 };
}

/** GFM's autolink trimming: trailing punctuation and emphasis markers, an unbalanced `)` (EP-12). */
function trimBareUrl(url) {
  let out = url;
  for (;;) {
    const before = out;
    out = out.replace(/[.,:;!?*_~'"]+$/, "");
    if (out.endsWith(")")) {
      const opened = (out.match(/\(/g) ?? []).length;
      const closed = (out.match(/\)/g) ?? []).length;
      if (closed > opened) out = out.slice(0, -1);
    }
    if (out === before) return out;
  }
}

/** Text before a hash on its line that labels it as something other than a transaction. */
const NOT_A_TRANSACTION =
  /\b(?:plan|snapshot|recipe|file|content|commit)[ _-]?hash\b|\b(?:planHash|snapshotHash|recipeHash)\b|\bsha-?256\b|\bpool(?: id)?\b|\bbalance id\b/i;

/** The context a hash is judged by: its table row's first cell, and the text since the last hash. */
function hashContext(line, column) {
  const before = line.slice(0, column);
  const lastHash = [...before.matchAll(HASH)].at(-1);
  const since = before.slice(lastHash ? lastHash.index + lastHash[0].length : 0);
  const segment = since.split("|").at(-1) ?? since;
  const firstCell = /^\s*\|/.test(line) ? (line.split("|")[1] ?? "") : "";
  return `${firstCell} ${segment}`;
}

/**
 * Scans a Markdown text once: its links (inline links and images, reference definitions,
 * autolinks, bare URLs) and the transaction hashes it lists in code spans and table cells outside
 * links. Code blocks are left out. Pure.
 */
function scan(markdown) {
  const withoutBlocks = blankCodeBlocks(markdown);
  const spans = codeSpans(withoutBlocks);
  let text = withoutBlocks;
  for (const s of spans)
    text = text.slice(0, s.start) + blank(text.slice(s.start, s.end)) + text.slice(s.end);
  const lineOf = lineAt(markdown);
  const links = [];
  const blankRange = (start, end) => {
    text = text.slice(0, start) + blank(text.slice(start, end)) + text.slice(end);
  };

  // Reference definitions `[label]: target`, not footnotes `[^1]: text` (EP-11).
  for (const m of text.matchAll(/^ {0,3}\[([^\]\n]+)\]:[ \t]*(?:<([^>\n]*)>|(\S+))/gm)) {
    if (m[1].startsWith("^")) continue;
    links.push({ target: m[2] ?? m[3], index: m.index });
    blankRange(m.index, m.index + m[0].length);
  }

  // Inline links and images, with link text over several lines and nested brackets (EP-5).
  const inline = (from, to) => {
    for (let i = from; i < to; i++) {
      if (text[i] !== "[" || text[i - 1] === "\\") continue;
      const close = closingBracket(text, i);
      if (close < 0 || close >= to || text[close + 1] !== "(") continue;
      const dest = inlineDestination(text, close + 1);
      if (!dest) continue;
      inline(i + 1, close);
      links.push({ target: dest.target, index: i });
      blankRange(i, dest.end);
      i = dest.end - 1;
    }
  };
  inline(0, text.length);

  for (const m of text.matchAll(/<(https?:\/\/[^\s<>]+)>/g)) {
    links.push({ target: m[1], index: m.index });
    blankRange(m.index, m.index + m[0].length);
  }
  for (const m of text.matchAll(/https?:\/\/[^\s<>[\]"'`]+/g)) {
    links.push({ target: trimBareUrl(m[0]), index: m.index });
    blankRange(m.index, m.index + m[0].length);
  }

  // Transaction hashes in code spans and in table cells, outside links (EP-9).
  const lines = markdown.split("\n");
  const starts = [];
  lines.reduce((offset, l) => (starts.push(offset), offset + l.length + 1), 0);
  const hashes = [];
  const take = (hash, index) => {
    const line = lineOf(index);
    if (NOT_A_TRANSACTION.test(hashContext(lines[line - 1], index - starts[line - 1]))) return;
    hashes.push({ hash: hash.toLowerCase(), line, index });
  };
  for (const span of spans) {
    for (const m of span.content.matchAll(HASH)) take(m[0], span.contentStart + m.index);
  }
  text.split("\n").forEach((line, n) => {
    if (!/^\s*\|/.test(line)) return;
    for (const m of line.matchAll(HASH)) take(m[0], starts[n] + m.index);
  });

  return {
    links: links
      .sort((a, b) => a.index - b.index)
      .map(({ target, index }) => ({ target, line: lineOf(index) })),
    hashes: hashes.sort((a, b) => a.index - b.index).map(({ hash, line }) => ({ hash, line })),
  };
}

/** Every link target of a Markdown text with its line number, in reading order. Pure. */
export function extractLinks(markdown) {
  return scan(markdown).links;
}

/**
 * Every 64-hex transaction hash a Markdown text lists in a code span or a table cell, outside
 * links, lowercase, with its line; hashes labelled as plan, snapshot, recipe, file or pool hashes
 * are left out. Pure.
 */
export function extractHashes(markdown) {
  return scan(markdown).hashes;
}

/** GitHub's heading slug (github-slugger): lowercase, punctuation removed, spaces to hyphens. */
export function githubSlug(text) {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, "")
    .replace(/ /g, "-");
}

/** The rendered text of a heading's inline Markdown: link and image text, code, no emphasis. */
function headingText(raw) {
  return raw
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/`+([^`]*)`+/g, "$1")
    .replace(/\*\*|__|\*|(?<![\p{L}\p{N}])_|_(?![\p{L}\p{N}])/gu, "")
    .trim();
}

/** The anchors a Markdown file offers: GitHub's heading slugs, numbered when repeated, and ids. */
export function headingAnchors(markdown) {
  const lines = blankCodeBlocks(markdown).split("\n");
  const raw = markdown.split("\n");
  const anchors = new Set();
  const seen = new Map();
  const add = (text) => {
    const base = githubSlug(headingText(text));
    let slug = base;
    for (let n = seen.get(base) ?? 0; anchors.has(slug); n++) {
      slug = `${base}-${n + 1}`;
      seen.set(base, n + 1);
    }
    if (!seen.has(base)) seen.set(base, 0);
    anchors.add(slug);
  };
  lines.forEach((line, i) => {
    const atx = /^ {0,3}#{1,6}(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/.exec(line);
    if (atx) add(raw[i].replace(/^ {0,3}#{1,6}[ \t]*/, "").replace(/[ \t]+#+[ \t]*$|#+$/, ""));
    else if (/^ {0,3}(=+|-+)[ \t]*$/.test(line) && i > 0) {
      const prev = lines[i - 1];
      if (/\S/.test(prev) && !/^\s*([|#>]|[-*+] |\d+[.)] )/.test(prev)) add(raw[i - 1]);
    }
    for (const m of raw[i].matchAll(/<[a-z][^>]*\s(?:id|name)="([^"]+)"/gi)) anchors.add(m[1]);
  });
  return anchors;
}

// ---------------------------------------------------------------------------------------------
// Classification

const MAINNET_EXPLORERS = new Map([
  ["stellarchain.io", "testnet.stellarchain.io"],
  ["steexp.com", "testnet.steexp.com"],
  ["lumenscan.io", "testnet.lumenscan.io"],
]);

/** Why a URL is refused without a request, or null (EP-14). */
export function refusalOf(url) {
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (host === TESTNET_HOST) return null;
  if (/(^|[.-])(mainnet|pubnet)([.-]|$)/.test(host)) return `${host} names the mainnet`;
  if (host.includes("horizon")) {
    return `${host} is not the testnet Horizon ${TESTNET_HOST} (other Horizon providers are refused, not probed)`;
  }
  if (MAINNET_EXPLORERS.has(host)) {
    return `${host} shows the mainnet (its testnet explorer is ${MAINNET_EXPLORERS.get(host)})`;
  }
  if (host === "blockchair.com" && /^\/stellar(\/|$)/.test(url.pathname)) {
    return "blockchair.com/stellar shows the mainnet only";
  }
  if (host === "stellar.expert") {
    const network = /^\/explorer\/([^/]+)/.exec(url.pathname)?.[1];
    if (network && network !== "testnet")
      return `StellarExpert network ${network} is not the testnet`;
  }
  if (host === "lab.stellar.org" || host === "laboratory.stellar.org") {
    const where = decodeURIComponentSafe(`${url.pathname} ${url.search} ${url.hash}`);
    if (/(^|[^a-z])(mainnet|public|pubnet)([^a-z]|$)/i.test(where)) {
      return `the Stellar Lab link names the mainnet`;
    }
  }
  return null;
}

function decodeURIComponentSafe(text) {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

/** What a link target is, and so how it is checked. Pure. */
export function classifyLink(target) {
  if (target === "") return { kind: "anchor", fragment: "" };
  if (target.startsWith("#")) return { kind: "anchor", fragment: target.slice(1) };
  if (target.startsWith("mailto:")) return { kind: "mailto" };
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(target);
  if (!scheme) {
    const hashAt = target.indexOf("#");
    const fragment = hashAt >= 0 ? target.slice(hashAt + 1) : null;
    const raw = target.replace(/[?#].*$/, "");
    let path;
    try {
      path = decodeURI(raw);
    } catch {
      return { kind: "invalid", reason: `malformed percent escape in ${raw}` };
    }
    const fromRoot = path.startsWith("/");
    return {
      kind: "relative",
      path: fromRoot ? path.replace(/^\/+/, "") : path,
      fromRoot,
      fragment,
    };
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
  const refused = refusalOf(url);
  if (refused) return { kind: "refused", reason: refused };
  if (url.hostname === TESTNET_HOST) {
    const tx = /^\/transactions\/([0-9a-fA-F]{64})\/?$/.exec(url.pathname);
    if (tx) return { kind: "tx", hash: tx[1].toLowerCase(), via: "horizon" };
    const account = /^\/accounts\/(G[A-Z2-7]{55})\/?$/.exec(url.pathname);
    if (account) return { kind: "account", account: account[1], via: "horizon" };
    return { kind: "https", url: target };
  }
  if (url.hostname === "stellar.expert") {
    const tx = /^\/explorer\/testnet\/tx\/([0-9a-fA-F]{64})\/?$/.exec(url.pathname);
    if (tx) return { kind: "tx", hash: tx[1].toLowerCase(), via: "stellar.expert" };
    const account = /^\/explorer\/testnet\/account\/(G[A-Z2-7]{55})\/?$/.exec(url.pathname);
    if (account) return { kind: "account", account: account[1], via: "stellar.expert" };
  }
  return { kind: "https", url: target };
}

// ---------------------------------------------------------------------------------------------
// Verdicts

/** A Retry-After header (seconds or an HTTP date) in milliseconds from `now`, or null. */
export function parseRetryAfter(value, now = Date.now()) {
  if (value === null || value === undefined || value.trim() === "") return null;
  if (/^\d+$/.test(value.trim())) return Number(value.trim()) * 1000;
  const at = Date.parse(value);
  return Number.isNaN(at) ? null : Math.max(0, at - now);
}

const isTransaction = (c) => c.kind === "tx" || c.kind === "hash" || c.kind === "stored";

const describe = (c) =>
  isTransaction(c)
    ? `transaction ${c.hash}`
    : c.kind === "account"
      ? `account ${c.account}`
      : c.url;

/**
 * The verdict on one answer (`get` below): `status` null when no answer came (`error` says why),
 * `tries` how many requests were made, `refusedRedirect` when a redirect pointed to a refused URL,
 * `retryAfterMs` when Horizon asked to wait longer than this script does. Pure.
 */
export function judgeResponse(c, answer) {
  const what = describe(c);
  const tries = answer.tries ?? 1;
  const after = tries > 1 ? ` after ${tries} tries` : "";
  if (answer.refusedRedirect) {
    return {
      verdict: "failed",
      detail: `${what} redirects to ${answer.refusedRedirect.location}, refused: ${answer.refusedRedirect.reason}`,
    };
  }
  if (answer.status === null || answer.status === undefined) {
    return {
      verdict: "unchecked",
      detail: `could not check ${what}: no answer (${answer.error ?? "no response"})${after}`,
    };
  }
  const { status } = answer;
  if (status === 429) {
    const wait =
      answer.retryAfterMs !== undefined
        ? `; it asked to wait ${Math.ceil(answer.retryAfterMs / 1000)} s, more than the ${RETRY_AFTER_MAX_MS / 1000} s this check waits`
        : "";
    return {
      verdict: "unchecked",
      detail: `could not check ${what}: rate limited (HTTP 429)${after}${wait}`,
    };
  }
  if (status >= 500) {
    return { verdict: "unchecked", detail: `could not check ${what}: HTTP ${status}${after}` };
  }
  // Cloudflare's block page ("Attention Required!") answers an automated client with 403: that
  // says nothing about the page, which a browser still opens (observed for medium.com, 2026-09-29).
  if (status === 403 && /cloudflare/i.test(answer.server ?? "")) {
    return {
      verdict: "unchecked",
      detail: `could not check ${what}: its bot protection (Cloudflare) answered HTTP 403 to this automated check; open it in a browser`,
    };
  }
  if (answer.tooManyRedirects) {
    return {
      verdict: "failed",
      detail: `${what} still redirects (HTTP ${status}) after ${MAX_REDIRECTS} redirects`,
    };
  }
  if (isTransaction(c)) {
    return status === 200
      ? { verdict: "ok", detail: "transaction on testnet Horizon (HTTP 200)" }
      : status === 404
        ? { verdict: "failed", detail: `${what} not found on testnet Horizon (HTTP 404)` }
        : { verdict: "failed", detail: `testnet Horizon answered HTTP ${status} for ${what}` };
  }
  if (c.kind === "account") {
    if (status === 200)
      return { verdict: "ok", detail: "account exists on testnet Horizon (HTTP 200)" };
    if (status === 404) return { verdict: "history", detail: `${what} answers 404` };
    return { verdict: "failed", detail: `testnet Horizon answered HTTP ${status} for ${what}` };
  }
  return status < 400
    ? { verdict: "ok", detail: `HTTP ${status}` }
    : { verdict: "failed", detail: `${what} answered HTTP ${status}` };
}

/**
 * The verdict on an account that answers 404, from its operations
 * (`/accounts/<id>/operations?order=desc&limit=200`): its own account_merge means it was closed
 * (GONE); history without the merge among the latest 200 still proves it existed (GONE); no
 * history at all is a failure (EP-10, BH-8, as src/fixture/reset.ts reads it). Pure.
 */
export function judgeAccountHistory(account, answer) {
  const what = `account ${account}`;
  if (answer.status !== 200 && answer.status !== 404) {
    const judged = judgeResponse({ kind: "https", url: `the operations of ${what}` }, answer);
    return judged.verdict === "unchecked" || answer.refusedRedirect
      ? judged
      : {
          verdict: "failed",
          detail: `testnet Horizon answered HTTP ${answer.status} for the operations of ${what}`,
        };
  }
  const records = answer.status === 200 ? (answer.body?._embedded?.records ?? []) : [];
  if (records.length === 0) {
    return {
      verdict: "failed",
      detail: `${what} answers 404 and testnet Horizon holds no operation for it: it never existed on this network, or a reset removed it`,
    };
  }
  const merge = records.find((r) => r.type === "account_merge" && r.source_account === account);
  return merge
    ? {
        verdict: "gone",
        detail: `${what} gone (merged into ${merge.into} by transaction ${merge.transaction_hash})`,
      }
    : {
        verdict: "gone",
        detail: `${what} gone (Horizon 404; it holds the account's history, the latest a ${records[0].type}, but no account_merge among its latest ${LATEST_OPERATIONS} operations)`,
      };
}

// ---------------------------------------------------------------------------------------------
// Stored transaction records

const TX_HASH = /^[0-9a-f]{64}$/;

/**
 * The Horizon transaction record a stored JSON holds: Horizon's answer itself, or the
 * `{ hash, horizon }` wrapper of the run directories' tx-<n>.json files; null when it holds none
 * (a hash, an integer ledger, a close time, a boolean result and an envelope are required). Pure.
 */
export function horizonRecordOf(json) {
  const record = json && typeof json === "object" && json.horizon ? json.horizon : json;
  if (!record || typeof record !== "object") return null;
  const ok =
    typeof record.hash === "string" &&
    TX_HASH.test(record.hash) &&
    Number.isInteger(record.ledger) &&
    typeof record.created_at === "string" &&
    typeof record.successful === "boolean" &&
    typeof record.envelope_xdr === "string" &&
    record.envelope_xdr !== "";
  return ok ? record : null;
}

/**
 * The verdict on one file of STORED_TX_DIR from its name and text: named <hash>.json, JSON, and
 * Horizon's record of that very transaction. Offline, so it holds after a testnet reset. Pure.
 */
export function judgeStoredFile(name, text) {
  const named = /^([0-9a-f]{64})\.json$/.exec(name);
  if (!named) {
    return {
      verdict: "failed",
      detail: `${name} is not named <transaction hash>.json (64 lowercase hex digits)`,
    };
  }
  let json;
  try {
    json = JSON.parse(text);
  } catch (error) {
    return { verdict: "failed", detail: `${name} is not JSON (${error.message})` };
  }
  const record = horizonRecordOf(json);
  if (!record) {
    return {
      verdict: "failed",
      detail: `${name} holds no Horizon transaction record (hash, ledger, created_at, successful, envelope_xdr)`,
    };
  }
  if (record.hash !== named[1]) {
    return { verdict: "failed", detail: `${name} holds the record of transaction ${record.hash}` };
  }
  return { verdict: "ok", detail: "stored Horizon record", hash: named[1], record };
}

/**
 * The verdict on Horizon's answer for a transaction that has a stored record: the answer must be
 * a 200 whose ledger, close time, result and envelopes equal the stored record's. Pure.
 */
export function judgeStoredAnswer(c, answer, record) {
  const judged = judgeResponse(c, answer);
  if (judged.verdict !== "ok") return judged;
  const body = answer.body;
  if (!body || typeof body !== "object") {
    return {
      verdict: "unchecked",
      detail: `could not compare transaction ${c.hash} with its stored record: Horizon's answer was not JSON`,
    };
  }
  const differ = STORED_FIELDS.filter((f) => JSON.stringify(body[f]) !== JSON.stringify(record[f]));
  return differ.length === 0
    ? {
        verdict: "ok",
        detail: "transaction on testnet Horizon (HTTP 200), equal to its stored record",
      }
    : {
        verdict: "failed",
        detail: `transaction ${c.hash} on testnet Horizon differs from its stored record in ${differ.join(", ")}`,
      };
}

/**
 * The transactions a document cites, listed in a code span or a table cell or linked on Horizon
 * or StellarExpert, that `stored` (a Set of hashes) holds no record of; each once, at its first
 * line. A line that says its envelope was never on the ledger is left out: Horizon keeps nothing
 * of such an envelope. Pure.
 */
export function uncoveredCitations(markdown, stored) {
  const { links, hashes } = scan(markdown);
  const lines = markdown.split("\n");
  const cited = [
    ...hashes,
    ...links
      .map((l) => ({ c: classifyLink(l.target), line: l.line }))
      .filter(({ c }) => c.kind === "tx")
      .map(({ c, line }) => ({ hash: c.hash, line })),
  ].sort((a, b) => a.line - b.line);
  const reported = new Set();
  const uncovered = [];
  for (const { hash, line } of cited) {
    if (stored.has(hash) || reported.has(hash)) continue;
    if (/never on the ledger/i.test(lines[line - 1] ?? "")) continue;
    reported.add(hash);
    uncovered.push({ hash, line });
  }
  return uncovered;
}

const LABEL = { ok: "OK", gone: "GONE", skipped: "SKIP", failed: "FAIL", unchecked: "UNCHECKED" };

/** The report: every failure, unchecked link and gone account, then the counts. */
export function render(results, notes = []) {
  const lines = [
    ...notes,
    ...results
      .filter((r) => r.verdict === "failed" || r.verdict === "unchecked" || r.verdict === "gone")
      .map((r) => `${LABEL[r.verdict].padEnd(9)}  ${r.file}:${r.line}  ${r.target}  ${r.detail}`),
  ];
  const count = (v) => results.filter((r) => r.verdict === v).length;
  const of = (source) => results.filter((r) => r.source === source).length;
  const [hashes, stored, cited] = [of("hash"), of("stored"), of("cited")];
  const parts = [
    `${results.length - hashes - stored - cited} links`,
    `${hashes} listed transaction hashes`,
    ...(stored > 0 ? [`${stored} stored transaction records`] : []),
    ...(cited > 0 ? [`${cited} cited transactions without a stored record`] : []),
  ];
  const what = `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
  lines.push(
    `${what}: ${count("ok")} ok, ${count("gone")} account gone, ${count("skipped")} skipped, ${count("failed")} failed, ${count("unchecked")} unchecked.`,
  );
  return `${lines.join("\n")}\n`;
}

/** 1 on any failure; otherwise 3 when something could not be checked; otherwise 0. */
export const exitCodeOf = (results) =>
  results.some((r) => r.verdict === "failed")
    ? EXIT.FAILED
    : results.some((r) => r.verdict === "unchecked")
      ? EXIT.UNCHECKED
      : EXIT.OK;

// ---------------------------------------------------------------------------------------------
// Files

/** Every Markdown file under evidence/, then README.md and docs/write-up.md, under `root` (EP-9). */
export function defaultFiles(root) {
  const found = [];
  const walk = (dir) => {
    const full = join(root, dir);
    if (!existsSync(full)) return;
    for (const entry of readdirSync(full, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile() && entry.name.endsWith(".md")) found.push(path);
    }
  };
  walk("evidence");
  found.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  for (const extra of ["README.md", join("docs", "write-up.md")]) {
    if (existsSync(join(root, extra))) found.push(extra);
  }
  return found;
}

/** The git checkout around `cwd`: its root and the committed paths (`git ls-files`), or null. */
export function gitCheckout(cwd) {
  try {
    const root = execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    const listed = execFileSync("git", ["ls-files", "-z"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      maxBuffer: 64 * 1024 * 1024,
    });
    return { root, files: new Set(listed.split("\0").filter(Boolean)) };
  } catch {
    return null;
  }
}

const toPosix = (path) => path.split(sep).join("/");

/** The committed files under `dir` (paths from the root, `/` separated), or outside git those on the disk. */
export function filesUnder(dir, { git, root }) {
  if (git) return [...git.files].filter((f) => f.startsWith(`${dir}/`)).sort();
  const found = [];
  const walk = (at) => {
    const full = join(root, at);
    if (!existsSync(full)) return;
    for (const entry of readdirSync(full, { withFileTypes: true })) {
      const path = `${at}/${entry.name}`;
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile()) found.push(path);
    }
  };
  walk(dir);
  return found.sort();
}

/**
 * Whether a relative link's target is committed (exact case, a file or a directory holding one),
 * or, outside a git checkout, exists on the disk (EP-8). Paths are relative to the root.
 */
export function judgeRelative(path, { git, root }) {
  const posix = toPosix(path);
  if (posix === ".." || posix.startsWith("../")) {
    return { verdict: "failed", detail: `${posix} is outside the repository` };
  }
  if (git) {
    const committed =
      posix === "" ||
      posix === "." ||
      git.files.has(posix) ||
      [...git.files].some((f) => f.startsWith(`${posix.replace(/\/$/, "")}/`));
    if (committed) return { verdict: "ok", detail: "committed" };
    return existsSync(join(root, path))
      ? {
          verdict: "failed",
          detail: `${posix} is not committed (not in git ls-files with this exact case), though a file answers to it on this disk`,
        }
      : { verdict: "failed", detail: `${posix} does not exist` };
  }
  return existsSync(join(root, path))
    ? {
        verdict: "ok",
        detail: "exists on this disk (not a git checkout: not checked against git ls-files)",
      }
    : { verdict: "failed", detail: `${posix} does not exist` };
}

// ---------------------------------------------------------------------------------------------
// Network

/**
 * GET with a timeout, redirects followed by hand (at most five, none to a refused URL, EP-14),
 * and retries on network errors, 429 and 5xx with exponential pauses or the Retry-After Horizon
 * sends, up to RETRY_AFTER_MAX_MS (EP-7). Returns the last status or error, the tries made, and
 * with `wantBody` the JSON body of a 200.
 */
export async function get(
  url,
  { fetch: doFetch, sleep = delay, now = Date.now } = {},
  wantBody = false,
) {
  let error = "";
  let status = null;
  let pause = 0;
  let tries = 0;
  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    if (attempt > 0) await sleep(pause);
    tries++;
    pause = 1000 * 2 ** attempt;
    let current = url;
    let response;
    let tooManyRedirects = false;
    let body = null;
    try {
      for (let hop = 0; ; hop++) {
        response = await doFetch(current, {
          headers: { accept: "application/json, text/html;q=0.9, */*;q=0.8" },
          redirect: "manual",
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        const location = response.headers.get("location");
        if (response.status < 300 || response.status >= 400 || !location) break;
        await response.body?.cancel();
        if (hop >= MAX_REDIRECTS) {
          tooManyRedirects = true;
          break;
        }
        const next = new URL(location, current);
        const reason = /^https?:$/.test(next.protocol)
          ? refusalOf(next)
          : `unsupported scheme ${next.protocol}`;
        if (reason) {
          return {
            status: response.status,
            tries,
            refusedRedirect: { location: next.href, reason },
          };
        }
        current = next.href;
      }
      if (wantBody && response.status === 200) body = await response.json().catch(() => null);
      else await response.body?.cancel();
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
      status = null;
      continue;
    }
    status = response.status;
    if (tooManyRedirects) return { status, tries, tooManyRedirects };
    if (status !== 429 && status < 500) {
      const server = status === 403 ? response.headers.get("server") : null;
      return { status, tries, ...(wantBody ? { body } : {}), ...(server ? { server } : {}) };
    }
    error = `HTTP ${status}`;
    const retryAfter = parseRetryAfter(response.headers.get("retry-after"), now());
    if (retryAfter !== null) {
      if (retryAfter > RETRY_AFTER_MAX_MS) return { status, tries, retryAfterMs: retryAfter };
      pause = Math.max(pause, retryAfter);
    }
  }
  return status === null ? { status: null, tries, error } : { status, tries };
}

// ---------------------------------------------------------------------------------------------
// Main

/**
 * The check itself. `deps` replaces the network, the clock, the working directory, git and the
 * output streams (tests). Returns the exit code; nothing is thrown (EP-6, BH-7).
 */
export async function main(argv, deps = {}) {
  const out = deps.stdout ?? ((s) => process.stdout.write(s));
  const err = deps.stderr ?? ((s) => process.stderr.write(s));
  const env = deps.env ?? process.env;
  const cwd = deps.cwd ?? process.cwd();
  const net = {
    fetch: deps.fetch ?? ((u, i) => fetch(u, i)),
    sleep: deps.sleep ?? delay,
    now: deps.now ?? Date.now,
  };
  try {
    return await check(argv, { out, err, env, cwd, net, git: deps.git });
  } catch (error) {
    err(
      `evidence:check: unexpected error: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    return EXIT.FAILED;
  }
}

async function check(argv, { out, err, env, cwd, net, git: gitOverride }) {
  if (argv.includes("-h") || argv.includes("--help")) {
    out(USAGE);
    return EXIT.OK;
  }
  argv = argv.filter((a) => a !== "--");
  const options = argv.filter((a) => a.startsWith("-") && a !== "-");
  if (options.length > 0) {
    err(`evidence:check: unknown option ${options.join(", ")}\n\n${USAGE}`);
    return EXIT.USAGE;
  }
  const horizon = horizonFromEnv(env);
  try {
    assertTestnetHorizon(horizon);
  } catch (error) {
    err(`evidence:check: ${error.message}\n`);
    return EXIT.USAGE;
  }
  const git = gitOverride === undefined ? gitCheckout(cwd) : gitOverride;
  const root = git?.root ?? cwd;
  const notes = git
    ? []
    : [
        "NOTE      not a git checkout: relative links are checked on this disk, not against git ls-files",
      ];
  const files = argv.length > 0 ? argv : defaultFiles(root).map((f) => join(root, f));
  const texts = new Map();
  for (const file of files) {
    const path = resolve(cwd, file);
    let stat;
    try {
      stat = statSync(path);
    } catch {
      err(`evidence:check: no such file: ${file}\n\n${USAGE}`);
      return EXIT.USAGE;
    }
    if (!stat.isFile()) {
      err(`evidence:check: ${file} is not a file (pass Markdown files)\n\n${USAGE}`);
      return EXIT.USAGE;
    }
    try {
      texts.set(path, readFileSync(path, "utf8"));
    } catch (error) {
      err(`evidence:check: cannot read ${file}: ${error.message}\n`);
      return EXIT.USAGE;
    }
  }
  const shown = (path) => toPosix(relative(root, path)) || path;
  const anchorsOf = new Map();
  const anchors = (path) => {
    if (!anchorsOf.has(path)) {
      let text = texts.get(path);
      if (text === undefined) {
        try {
          text = readFileSync(path, "utf8");
        } catch {
          text = "";
        }
      }
      anchorsOf.set(path, headingAnchors(text));
    }
    return anchorsOf.get(path);
  };
  const judgeAnchor = (path, fragment) => {
    if (fragment === null || fragment === "") return null;
    const wanted = decodeURIComponentSafe(fragment).toLowerCase();
    return anchors(path).has(wanted) || anchors(path).has(decodeURIComponentSafe(fragment))
      ? null
      : { verdict: "failed", detail: `no heading or id #${fragment} in ${shown(path)}` };
  };

  const results = [];
  const pending = new Map();
  const ask = (url, c, row) => {
    const entry = { ...row, verdict: "unchecked", detail: "not asked" };
    results.push(entry);
    if (!pending.has(url)) pending.set(url, { c, rows: [] });
    pending.get(url).rows.push(entry);
  };

  // The stored transaction records, with the default files only: each file of STORED_TX_DIR is
  // judged offline and asked on Horizon to be compared; every transaction a document of
  // STORED_TX_SOURCES cites must have a record there or in a run directory.
  const stored = new Map();
  if (argv.length === 0) {
    const kept = new Set();
    for (const path of filesUnder("evidence", { git, root })) {
      if (!path.endsWith(".json") || path.startsWith(`${STORED_TX_DIR}/`)) continue;
      try {
        const record = horizonRecordOf(JSON.parse(readFileSync(join(root, path), "utf8")));
        if (record) kept.add(record.hash);
      } catch {
        // Not a record: other evidence JSON is not this check's business.
      }
    }
    for (const path of filesUnder(STORED_TX_DIR, { git, root })) {
      const name = path.slice(STORED_TX_DIR.length + 1);
      if (name === "README.md") continue;
      const row = { file: path, line: 1, target: name, source: "stored" };
      let judged;
      try {
        judged = judgeStoredFile(name, readFileSync(join(root, path), "utf8"));
      } catch (error) {
        judged = { verdict: "failed", detail: `cannot read ${path}: ${error.message}` };
      }
      if (judged.verdict !== "ok") {
        results.push({ ...row, verdict: judged.verdict, detail: judged.detail });
        continue;
      }
      stored.set(judged.hash, judged.record);
      kept.add(judged.hash);
      ask(
        `${TESTNET_HORIZON}/transactions/${judged.hash}`,
        { kind: "stored", hash: judged.hash },
        { ...row, target: judged.hash },
      );
    }
    for (const source of STORED_TX_SOURCES) {
      const committed = git ? git.files.has(source) : existsSync(join(root, source));
      if (!committed) continue;
      for (const { hash, line } of uncoveredCitations(
        readFileSync(join(root, source), "utf8"),
        kept,
      )) {
        results.push({
          file: source,
          line,
          target: hash,
          source: "cited",
          verdict: "failed",
          detail: `transaction cited with no stored Horizon record: save ${TESTNET_HORIZON}/transactions/${hash} as ${STORED_TX_DIR}/${hash}.json`,
        });
      }
    }
  }

  const linkedHashes = new Set();
  const scanned = [...texts].map(([path, text]) => ({ path, ...scan(text) }));
  for (const { links } of scanned) {
    for (const l of links) {
      const c = classifyLink(l.target);
      if (c.kind === "tx") linkedHashes.add(c.hash);
    }
  }
  const listed = new Set();
  for (const { path, links, hashes } of scanned) {
    const file = shown(path);
    for (const link of links) {
      const c = classifyLink(link.target);
      const row = { file, line: link.line, target: link.target, source: "link" };
      if (c.kind === "mailto") {
        results.push({ ...row, verdict: "skipped", detail: "mailto" });
      } else if (c.kind === "refused") {
        results.push({ ...row, verdict: "failed", detail: `refused: ${c.reason}` });
      } else if (c.kind === "invalid") {
        results.push({ ...row, verdict: "failed", detail: c.reason });
      } else if (c.kind === "anchor") {
        results.push({
          ...row,
          ...(judgeAnchor(path, c.fragment) ?? { verdict: "ok", detail: "heading in this file" }),
        });
      } else if (c.kind === "relative") {
        const target = c.fromRoot ? join(root, c.path) : join(dirname(path), c.path);
        const judged = judgeRelative(normalize(relative(root, target)), { git, root });
        const anchor =
          judged.verdict === "ok" && /\.(md|markdown)$/i.test(target)
            ? judgeAnchor(target, c.fragment)
            : null;
        results.push({ ...row, ...(anchor ?? judged) });
      } else {
        const url =
          c.kind === "tx"
            ? `${TESTNET_HORIZON}/transactions/${c.hash}`
            : c.kind === "account"
              ? `${TESTNET_HORIZON}/accounts/${c.account}`
              : c.url;
        ask(url, c, row);
      }
    }
    for (const h of hashes) {
      if (linkedHashes.has(h.hash) || listed.has(h.hash)) continue;
      listed.add(h.hash);
      ask(
        `${TESTNET_HORIZON}/transactions/${h.hash}`,
        { kind: "hash", hash: h.hash },
        {
          file,
          line: h.line,
          target: h.hash,
          source: "hash",
        },
      );
    }
  }
  const queue = [...pending.entries()];
  err(
    `evidence:check: ${files.length} file(s), ${results.length} links and listed hashes, ${queue.length} distinct URLs to ask (testnet Horizon ${TESTNET_HORIZON})\n`,
  );
  const worker = async () => {
    for (let next = queue.shift(); next; next = queue.shift()) {
      const [url, { c, rows }] = next;
      const record = isTransaction(c) ? stored.get(c.hash) : undefined;
      const answer = await get(url, net, record !== undefined);
      let judged = record ? judgeStoredAnswer(c, answer, record) : judgeResponse(c, answer);
      if (judged.verdict === "history") {
        const opsUrl = `${TESTNET_HORIZON}/accounts/${c.account}/operations?order=desc&limit=${LATEST_OPERATIONS}`;
        judged = judgeAccountHistory(c.account, await get(opsUrl, net, true));
      }
      for (const r of rows) Object.assign(r, judged);
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  out(render(results, notes));
  return exitCodeOf(results);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main(process.argv.slice(2));
}
