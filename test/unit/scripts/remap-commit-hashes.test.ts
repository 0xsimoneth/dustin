import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

// scripts/remap-commit-hashes.mjs rewrites the commit hashes the documents cite after a history
// rewrite (docs/runbooks/history-rewrite.md). Its pure helpers, and one dry run and one --apply
// run on a throwaway repository with a made-up commit-map; no history is rewritten here.

interface Pair {
  oldHash: string;
  newHash: string;
}
type Resolved =
  | { kind: "replace"; to: string }
  | { kind: "ambiguous"; count: number }
  | { kind: "removed"; oldHash: string }
  | { kind: "unchanged" }
  | null;
interface Change {
  line: number;
  from: string;
  kind: string;
  to?: string;
}
interface Remap {
  EXIT: { OK: 0; FAILED: 1; USAGE: 2 };
  parseCommitMap(text: string): Pair[];
  resolveToken(token: string, pairs: Pair[]): Resolved;
  remapText(text: string, pairs: Pair[]): { text: string; changes: Change[] };
  looksBinary(buffer: Buffer): boolean;
  main(
    argv: string[],
    deps?: { cwd?: string; stdout?: (s: string) => void; stderr?: (s: string) => void },
  ): number;
}

let m: Remap;
beforeAll(async () => {
  const path = "../../../scripts/remap-commit-hashes.mjs";
  m = (await import(path)) as Remap;
});

const OLD_A = "9475995aaaa0000000000000000000000000000a";
const NEW_A = "1111111bbbb0000000000000000000000000000b";
const OLD_B = "ca7bf53d7b9cb6d77fe20745b7b51c7ecd7831fb";
const NEW_B = "2222222cccc0000000000000000000000000000c";
const OLD_C = "ca7bf5399990000000000000000000000000000d"; // shares 7 characters with OLD_B
const NEW_C = "3333333dddd0000000000000000000000000000e";
const OLD_GONE = "abcdef0123456789abcdef0123456789abcdef01";
const MAP = [
  "old                                      new",
  `${OLD_A} ${NEW_A}`,
  `${OLD_B} ${NEW_B}`,
  `${OLD_C} ${NEW_C}`,
  `${OLD_GONE} ${"0".repeat(40)}`,
  "",
].join("\n");

describe("parseCommitMap", () => {
  it("reads filter-repo's header and pairs", () => {
    const pairs = m.parseCommitMap(MAP);
    expect(pairs).toHaveLength(4);
    expect(pairs[0]).toEqual({ oldHash: OLD_A, newHash: NEW_A });
  });

  it("refuses a line that is not a pair of full hashes, and an empty map", () => {
    expect(() => m.parseCommitMap(`old new\n${OLD_A} 1234\n`)).toThrow(/line 2/);
    expect(() => m.parseCommitMap("old new\n")).toThrow(/no commit/);
  });
});

describe("resolveToken", () => {
  const pairs = () => m.parseCommitMap(MAP);

  it("maps a unique prefix to the new hash at the same length, and a full hash in full", () => {
    expect(m.resolveToken("9475995", pairs())).toEqual({ kind: "replace", to: "1111111" });
    expect(m.resolveToken(OLD_A, pairs())).toEqual({ kind: "replace", to: NEW_A });
  });

  it("leaves a prefix of two old commits, a removed commit, and a token that cites nothing", () => {
    expect(m.resolveToken("ca7bf53", pairs())).toEqual({ kind: "ambiguous", count: 2 });
    expect(m.resolveToken("ca7bf53d", pairs())).toEqual({ kind: "replace", to: "2222222c" });
    expect(m.resolveToken("abcdef0", pairs())).toEqual({ kind: "removed", oldHash: OLD_GONE });
    expect(m.resolveToken("4931386", pairs())).toBeNull();
    expect(m.resolveToken("947599", pairs())).toBeNull(); // shorter than 7
  });

  it("lengthens a new citation that would be ambiguous among the new hashes", () => {
    const clash = [
      { oldHash: OLD_A, newHash: "1234567aaaa0000000000000000000000000000a" },
      { oldHash: OLD_B, newHash: "1234567bbbb0000000000000000000000000000b" },
    ];
    expect(m.resolveToken("9475995", clash)).toEqual({ kind: "replace", to: "1234567a" });
  });
});

describe("remapText", () => {
  it("rewrites citations in prose, ranges and code spans, never inside a longer token", () => {
    const tx = `9475995${"f".repeat(57)}`; // a 64-character transaction hash that starts alike
    const text = [
      "Fixed in `9475995` (see 9475995..ca7bf53d).",
      `Transaction ${tx} and account G9475995ABC stay; x9475995 and 9475995z too.`,
      "Ledger 4931386 is not a commit.",
    ].join("\n");
    const { text: out, changes } = m.remapText(text, m.parseCommitMap(MAP));
    expect(out.split("\n")).toEqual([
      "Fixed in `1111111` (see 1111111..2222222c).",
      `Transaction ${tx} and account G9475995ABC stay; x9475995 and 9475995z too.`,
      "Ledger 4931386 is not a commit.",
    ]);
    expect(changes).toEqual([
      { line: 1, from: "9475995", kind: "replace", to: "1111111" },
      { line: 1, from: "9475995", kind: "replace", to: "1111111" },
      { line: 1, from: "ca7bf53d", kind: "replace", to: "2222222c" },
    ]);
  });
});

describe("looksBinary", () => {
  it("is true when a NUL byte is in the first 8,000 bytes", () => {
    expect(m.looksBinary(Buffer.from([0x89, 0x50, 0x00, 0x47]))).toBe(true);
    expect(m.looksBinary(Buffer.from("plain text"))).toBe(false);
  });
});

describe("main", () => {
  function repo(): string {
    const dir = mkdtempSync(join(tmpdir(), "remap-"));
    const git = (...args: string[]) => execFileSync("git", args, { cwd: dir, stdio: "ignore" });
    git("init", "-q");
    writeFileSync(join(dir, "notes.md"), "Commit 9475995 and ca7bf53 (two old commits).\n");
    writeFileSync(join(dir, "image.png"), Buffer.from([0x89, 0x00, 0x39, 0x34, 0x37, 0x35]));
    writeFileSync(join(dir, "commit-map"), MAP);
    git("add", "notes.md", "image.png");
    return dir;
  }

  it("lists the changes and writes nothing by default", () => {
    const dir = repo();
    const lines: string[] = [];
    const code = m.main([join(dir, "commit-map")], { cwd: dir, stdout: (s) => lines.push(s) });
    expect(code).toBe(m.EXIT.OK);
    const printed = lines.join("");
    expect(printed).toContain("notes.md:1: 9475995 -> 1111111");
    expect(printed).toContain("notes.md:1: ca7bf53 left as it is (prefix of 2 old commits)");
    expect(printed).toContain("Dry run: nothing was written");
    expect(readFileSync(join(dir, "notes.md"), "utf8")).toContain("9475995");
  });

  it("writes the files with --apply", () => {
    const dir = repo();
    const code = m.main([join(dir, "commit-map"), "--apply"], { cwd: dir, stdout: () => {} });
    expect(code).toBe(m.EXIT.OK);
    expect(readFileSync(join(dir, "notes.md"), "utf8")).toBe(
      "Commit 1111111 and ca7bf53 (two old commits).\n",
    );
  });

  it("refuses a missing or surplus argument and an unknown flag", () => {
    const quiet = { stdout: () => {}, stderr: () => {} };
    expect(m.main([], quiet)).toBe(m.EXIT.USAGE);
    expect(m.main(["a", "b"], quiet)).toBe(m.EXIT.USAGE);
    expect(m.main(["a", "--force"], quiet)).toBe(m.EXIT.USAGE);
  });
});
