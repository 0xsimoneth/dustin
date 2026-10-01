#!/usr/bin/env node
// The SDK entry must run in a browser bundle (story E5-S1, docs/web-demo.md): this scans
// dist/index.js and dist/index.cjs, with every local chunk they import, and fails on a Node-only
// API: an import or require of a `node:` module or of a bare Node built-in (fs, path, os,
// child_process, readline, crypto, ...), and a use of the Buffer, process, __dirname or __filename
// globals, which no browser defines. The CLI (dist/cli) and stellar-dustin/testing (dist/testing.*)
// are Node programs and are not scanned. Run after `npm run build`; a unit test covers the scanner
// (test/unit/scripts/check-browser-safe.test.ts).
import { existsSync, readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const EXIT = Object.freeze({ OK: 0, FAILED: 1, USAGE: 2 });

/** The modules Node provides without the `node:` prefix (https://nodejs.org/api/modules.html#built-in-modules). */
export const NODE_BUILTINS = new Set([
  "assert",
  "async_hooks",
  "buffer",
  "child_process",
  "cluster",
  "console",
  "constants",
  "crypto",
  "dgram",
  "diagnostics_channel",
  "dns",
  "domain",
  "events",
  "fs",
  "http",
  "http2",
  "https",
  "inspector",
  "module",
  "net",
  "os",
  "path",
  "perf_hooks",
  "process",
  "punycode",
  "querystring",
  "readline",
  "repl",
  "stream",
  "string_decoder",
  "sys",
  "timers",
  "tls",
  "trace_events",
  "tty",
  "url",
  "util",
  "v8",
  "vm",
  "wasi",
  "worker_threads",
  "zlib",
]);

// Every way the built files name a module: `from "x"` (static import and re-export, over several
// lines), `import("x")`, `require("x")` and a side-effect `import "x"`. Both quote styles, since
// tsup writes ESM with double quotes and CommonJS with single quotes.
const SPECIFIERS = [
  /\bfrom\s*(["'])([^"'\n]+)\1/g,
  /\brequire\s*\(\s*(["'])([^"'\n]+)\1\s*\)/g,
  /\bimport\s*\(\s*(["'])([^"'\n]+)\1\s*\)/g,
  /^\s*import\s*(["'])([^"'\n]+)\1/gm,
];

// A Node global used as a value: `Buffer.from(`, `new Buffer(`, `process.env`, `__dirname`. The
// lookbehind skips a property of that name (`sdk.Buffer`) and longer identifiers (`myBuffer`);
// words in prose, such as "the process was killed", have no dot or parenthesis after them.
const GLOBALS = [
  { pattern: /(?<![\w$.])Buffer\s*[.(]/g, what: "the Buffer global" },
  { pattern: /(?<![\w$.])process\s*\./g, what: "the process global" },
  { pattern: /(?<![\w$.])__(?:dirname|filename)\b/g, what: "__dirname or __filename" },
];

function lineOf(text, index) {
  let line = 1;
  for (let i = 0; i < index; i++) if (text.charCodeAt(i) === 10) line++;
  return line;
}

/** True for a path the file names relative to itself: a chunk of the same build. */
export function isLocal(specifier) {
  return specifier.startsWith("./") || specifier.startsWith("../");
}

/**
 * The findings in one built file's source, and the local files it imports. A specifier is a
 * finding when it names a `node:` module or a bare built-in (`fs`, `fs/promises`); a package name
 * is not scanned here, since the SDK's dependencies stay external and are checked by the web
 * demo's build.
 */
export function scanSource(text, file) {
  const findings = [];
  const locals = [];
  const seen = new Set();
  for (const re of SPECIFIERS) {
    re.lastIndex = 0;
    for (const match of text.matchAll(re)) {
      const specifier = match[2];
      const key = `${match.index}:${specifier}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const line = lineOf(text, match.index);
      if (specifier.startsWith("node:")) {
        findings.push({ file, line, what: `an import of ${specifier}` });
      } else if (NODE_BUILTINS.has(specifier.split("/")[0])) {
        findings.push({ file, line, what: `an import of the Node built-in "${specifier}"` });
      } else if (isLocal(specifier)) {
        locals.push(specifier);
      }
    }
  }
  for (const { pattern, what } of GLOBALS) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      findings.push({ file, line: lineOf(text, match.index), what: `a use of ${what}` });
    }
  }
  findings.sort((a, b) => a.line - b.line);
  return { findings, locals: [...new Set(locals)] };
}

/**
 * Scans an entry file and, transitively, the local files it imports. Returns the findings and the
 * files scanned (paths as given, then as resolved from each importer).
 */
export function scanEntry(entry) {
  const queue = [resolve(entry)];
  const scanned = [];
  const findings = [];
  while (queue.length > 0) {
    const file = queue.shift();
    if (scanned.includes(file)) continue;
    scanned.push(file);
    const result = scanSource(readFileSync(file, "utf8"), file);
    findings.push(...result.findings);
    for (const local of result.locals) queue.push(resolve(dirname(file), local));
  }
  return { findings, scanned };
}

/**
 * `node scripts/check-browser-safe.mjs [entry...]`: the entries default to dist/index.js and
 * dist/index.cjs under `deps.cwd`. Exit 0 when nothing Node-only is reached, 1 with the findings
 * listed, 2 when an entry does not exist (build first).
 */
export function main(argv, deps = {}) {
  const cwd = deps.cwd ?? process.cwd();
  const stdout = deps.stdout ?? ((s) => process.stdout.write(s));
  const stderr = deps.stderr ?? ((s) => process.stderr.write(s));
  const entries = (argv.length > 0 ? argv : ["dist/index.js", "dist/index.cjs"]).map((e) =>
    resolve(cwd, e),
  );
  const missing = entries.filter((e) => !existsSync(e));
  if (missing.length > 0) {
    stderr(
      `check-browser-safe: not found: ${missing.map((m) => relative(cwd, m)).join(", ")}. Run npm run build first.\n`,
    );
    return EXIT.USAGE;
  }
  const findings = [];
  const scanned = [];
  for (const entry of entries) {
    const result = scanEntry(entry);
    findings.push(...result.findings);
    scanned.push(...result.scanned.filter((f) => !scanned.includes(f)));
  }
  const show = (f) => relative(cwd, f);
  if (findings.length > 0) {
    stderr(
      `check-browser-safe: the SDK entry reaches ${findings.length} Node-only API use${findings.length === 1 ? "" : "s"}:\n`,
    );
    for (const f of findings) stderr(`  ${show(f.file)}:${f.line}: ${f.what}\n`);
    stderr(
      "The SDK entry (stellar-dustin) must run in a browser bundle (docs/web-demo.md); keep Node APIs in src/cli and src/fixture.\n",
    );
    return EXIT.FAILED;
  }
  stdout(
    `check-browser-safe: no Node-only API in the SDK entry (${scanned.length} files: ${scanned.map(show).join(", ")}).\n`,
  );
  return EXIT.OK;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}
