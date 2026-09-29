// After a history rewrite (docs/runbooks/history-rewrite.md), every commit hash changes, and the
// documents that cite commits by hash (the reviews, the stories, the progress log, the evidence
// headers) point at commits that no longer exist in the repository. This script reads the
// commit-map that git filter-repo writes (.git/filter-repo/commit-map: a header line, then one
// "<old> <new>" pair of full hashes per line) and rewrites every cited hash in the tracked text
// files to the new commit, keeping the length of each citation.
//
// Usage:  node scripts/remap-commit-hashes.mjs <commit-map> [--apply]
//
// Without --apply it is a dry run: it lists every change as <file>:<line>: <old> -> <new>, writes
// nothing and exits 0. With --apply it writes the files. A citation is a lower-case hexadecimal
// token of 7 to 40 characters that is not part of a longer word (so the 64-character transaction
// hashes of the evidence are never touched) and that is the prefix of exactly one old commit; a
// token that matches several old commits, or a commit the rewrite removed, is listed and left as
// it is. Binary files (a NUL byte in the first 8,000 bytes) are skipped. Exit codes: 0 done, 1 the
// commit-map or the repository could not be read, 2 usage error.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export const EXIT = { OK: 0, FAILED: 1, USAGE: 2 };
export const USAGE = "Usage: node scripts/remap-commit-hashes.mjs <commit-map> [--apply]";
export const MIN_LENGTH = 7;
const FULL = /^[0-9a-f]{40}$/;
const NULL_HASH = "0".repeat(40);
const TOKEN = /(?<![0-9A-Za-z])[0-9a-f]{7,40}(?![0-9A-Za-z])/g;

/** The pairs of a filter-repo commit-map; throws on a line that is not a pair of full hashes. */
export function parseCommitMap(text) {
  const pairs = [];
  const lines = text.split("\n");
  lines.forEach((raw, index) => {
    const line = raw.trim();
    if (line === "") return;
    const [oldHash, newHash, ...rest] = line.split(/\s+/);
    if (index === 0 && oldHash === "old" && newHash === "new") return;
    if (!FULL.test(oldHash ?? "") || !FULL.test(newHash ?? "") || rest.length > 0) {
      throw new Error(`line ${index + 1} of the commit-map is not "<old> <new>" (40 hex each)`);
    }
    pairs.push({ oldHash, newHash });
  });
  if (pairs.length === 0) throw new Error("the commit-map holds no commit");
  return pairs;
}

/** The shortest prefix of `hash`, at least `length` long, that no other new hash shares. */
function uniquePrefix(hash, length, newHashes) {
  for (let n = length; n < 40; n += 1) {
    const prefix = hash.slice(0, n);
    if (newHashes.filter((h) => h.startsWith(prefix)).length === 1) return prefix;
  }
  return hash;
}

/**
 * Resolves a token against the old hashes: `replace` with the new citation, `ambiguous` when it
 * is the prefix of several old commits, `removed` when its commit left the history, `unchanged`
 * when the rewrite kept its hash, or null when it cites no old commit.
 */
export function resolveToken(token, pairs) {
  if (token.length < MIN_LENGTH) return null;
  const matches = pairs.filter((p) => p.oldHash.startsWith(token));
  if (matches.length === 0) return null;
  if (matches.length > 1) return { kind: "ambiguous", count: matches.length };
  const { oldHash, newHash } = matches[0];
  if (newHash === NULL_HASH) return { kind: "removed", oldHash };
  if (newHash === oldHash) return { kind: "unchanged" };
  const newHashes = pairs.map((p) => p.newHash).filter((h) => h !== NULL_HASH);
  return { kind: "replace", to: uniquePrefix(newHash, token.length, newHashes) };
}

/** The text with every citation replaced, and one entry per token that cites an old commit. */
export function remapText(text, pairs) {
  const changes = [];
  const lines = text.split("\n");
  const out = lines.map((line, index) =>
    line.replace(TOKEN, (token) => {
      const resolved = resolveToken(token, pairs);
      if (resolved === null || resolved.kind === "unchanged") return token;
      changes.push({ line: index + 1, from: token, ...resolved });
      return resolved.kind === "replace" ? resolved.to : token;
    }),
  );
  return { text: out.join("\n"), changes };
}

/** True when the first 8,000 bytes hold a NUL byte, as git decides a file is binary. */
export function looksBinary(buffer) {
  return buffer.subarray(0, 8000).includes(0);
}

function describe(file, c) {
  const where = `${file}:${c.line}`;
  if (c.kind === "replace") return `${where}: ${c.from} -> ${c.to}`;
  if (c.kind === "ambiguous")
    return `${where}: ${c.from} left as it is (prefix of ${c.count} old commits)`;
  return `${where}: ${c.from} left as it is (the rewrite removed commit ${c.oldHash})`;
}

export function main(argv, deps = {}) {
  const out = deps.stdout ?? ((s) => process.stdout.write(s));
  const err = deps.stderr ?? ((s) => process.stderr.write(s));
  const cwd = deps.cwd ?? process.cwd();
  const unknown = argv.filter((a) => a.startsWith("-") && a !== "--apply");
  const positional = argv.filter((a) => !a.startsWith("-"));
  if (unknown.length > 0 || positional.length !== 1) {
    err(`remap-commit-hashes: name one commit-map file\n${USAGE}\n`);
    return EXIT.USAGE;
  }
  const apply = argv.includes("--apply");
  let pairs;
  let root;
  let files;
  try {
    pairs = parseCommitMap(readFileSync(positional[0], "utf8"));
    const git = (args) => execFileSync("git", args, { cwd, encoding: "utf8" });
    root = git(["rev-parse", "--show-toplevel"]).trim();
    files = git(["-C", root, "ls-files", "-z"]).split("\0").filter(Boolean);
  } catch (error) {
    err(`remap-commit-hashes: ${error instanceof Error ? error.message : String(error)}\n`);
    return EXIT.FAILED;
  }
  let replaced = 0;
  let left = 0;
  const touched = [];
  for (const file of files) {
    const path = join(root, file);
    let buffer;
    try {
      buffer = readFileSync(path);
    } catch {
      continue; // A tracked file deleted in the working tree.
    }
    if (looksBinary(buffer)) continue;
    const before = buffer.toString("utf8");
    const { text, changes } = remapText(before, pairs);
    if (changes.length === 0) continue;
    for (const c of changes) {
      out(`${describe(file, c)}\n`);
      if (c.kind === "replace") replaced += 1;
      else left += 1;
    }
    if (text !== before) {
      touched.push(file);
      if (apply) writeFileSync(path, text);
    }
  }
  out(
    `${replaced} citation(s) ${apply ? "rewritten" : "to rewrite"} in ${touched.length} file(s); ${left} left as they are.\n`,
  );
  if (!apply) out("Dry run: nothing was written. Run again with --apply to write the files.\n");
  return EXIT.OK;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2));
}
