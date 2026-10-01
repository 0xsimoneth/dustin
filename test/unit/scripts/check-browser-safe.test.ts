import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

// scripts/check-browser-safe.mjs guards the SDK entry against Node-only APIs (story E5-S1): the
// scanner on made-up built files, and main() on throwaway directories. The real dist is checked
// in CI after the build; this tier needs no build.

interface Finding {
  file: string;
  line: number;
  what: string;
}
interface Guard {
  EXIT: { OK: 0; FAILED: 1; USAGE: 2 };
  NODE_BUILTINS: Set<string>;
  isLocal(specifier: string): boolean;
  scanSource(text: string, file: string): { findings: Finding[]; locals: string[] };
  scanEntry(entry: string): { findings: Finding[]; scanned: string[] };
  main(
    argv: string[],
    deps?: { cwd?: string; stdout?: (s: string) => void; stderr?: (s: string) => void },
  ): number;
}

let m: Guard;
beforeAll(async () => {
  const path = "../../../scripts/check-browser-safe.mjs";
  m = (await import(path)) as Guard;
});

const whats = (text: string) => m.scanSource(text, "f.js").findings.map((f) => f.what);

describe("scanSource", () => {
  it("finds node: imports in ESM and CommonJS, with their lines", () => {
    const esm =
      'import { StrKey } from "@stellar/stellar-sdk";\nimport { createHash } from "node:crypto";\n';
    expect(m.scanSource(esm, "f.js").findings).toEqual([
      { file: "f.js", line: 2, what: "an import of node:crypto" },
    ]);
    const cjs = "var _sdk = require('@stellar/stellar-sdk');\nvar _fs = require('node:fs');\n";
    expect(m.scanSource(cjs, "f.cjs").findings).toEqual([
      { file: "f.cjs", line: 2, what: "an import of node:fs" },
    ]);
  });

  it("finds bare Node built-ins, a subpath included, in every import form", () => {
    expect(whats('import { createHash } from "crypto";')).toEqual([
      'an import of the Node built-in "crypto"',
    ]);
    expect(whats("var _fs = require('fs/promises');")).toEqual([
      'an import of the Node built-in "fs/promises"',
    ]);
    expect(whats('const os = await import("os");')).toEqual([
      'an import of the Node built-in "os"',
    ]);
    expect(whats('import "readline";')).toEqual(['an import of the Node built-in "readline"']);
    for (const name of ["fs", "path", "os", "child_process", "readline"]) {
      expect(m.NODE_BUILTINS.has(name)).toBe(true);
    }
  });

  it("reads a static import that spans several lines", () => {
    const text = 'import {\n  readFileSync,\n  writeFileSync\n} from "node:fs";\n';
    expect(m.scanSource(text, "f.js").findings).toEqual([
      { file: "f.js", line: 4, what: "an import of node:fs" },
    ]);
  });

  it("finds the Buffer and process globals used as values, and __dirname", () => {
    expect(whats('const id = Buffer.from(bytes).toString("hex");')).toEqual([
      "a use of the Buffer global",
    ]);
    expect(whats("const b = new Buffer(4);")).toEqual(["a use of the Buffer global"]);
    expect(whats("if (process.env.CI) run();")).toEqual(["a use of the process global"]);
    expect(whats("const here = __dirname;")).toEqual(["a use of __dirname or __filename"]);
  });

  it("ignores a property or identifier that only contains the name, and prose", () => {
    expect(whats("const x = sdk.Buffer.from(a); const myBuffer = 1; myBuffer.x;")).toEqual([]);
    expect(whats('const text = "the process was killed or crashed";')).toEqual([]);
    expect(whats("obj.process.run(); const subprocess = 1;")).toEqual([]);
  });

  it("lists local chunks to follow, and leaves package imports alone", () => {
    const text =
      'import { a } from "./chunk-ABC.js";\nimport { b } from "@stellar/stellar-sdk";\n' +
      "var _c = require('./chunk-DEF.cjs');\nexport { x } from \"./chunk-ABC.js\";\n";
    const result = m.scanSource(text, "f.js");
    expect(result.findings).toEqual([]);
    expect(result.locals).toEqual(["./chunk-ABC.js", "./chunk-DEF.cjs"]);
    expect(m.isLocal("./x.js")).toBe(true);
    expect(m.isLocal("../x.js")).toBe(true);
    expect(m.isLocal("@stellar/stellar-sdk")).toBe(false);
  });
});

describe("main", () => {
  function build(files: Record<string, string>): string {
    const dir = mkdtempSync(join(tmpdir(), "dustin-browser-safe-"));
    mkdirSync(join(dir, "dist"));
    for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, "dist", name), text);
    return dir;
  }
  const run = (cwd: string, argv: string[] = []) => {
    let out = "";
    let err = "";
    const code = m.main(argv, { cwd, stdout: (s) => (out += s), stderr: (s) => (err += s) });
    return { code, out, err };
  };

  it("passes a clean entry graph and names the files it scanned", () => {
    const cwd = build({
      "index.js":
        'import { a } from "./chunk-A.js";\nimport { StrKey } from "@stellar/stellar-sdk";\nexport { a };\n',
      "chunk-A.js": "export const a = 1;\n",
      "index.cjs": "var _chunkA = require('./chunk-A.cjs');\nexports.a = _chunkA.a;\n",
      "chunk-A.cjs": "exports.a = 1;\n",
    });
    const { code, out, err } = run(cwd);
    expect(err).toBe("");
    expect(code).toBe(m.EXIT.OK);
    expect(out).toContain("no Node-only API in the SDK entry (4 files");
    expect(out).toContain("dist/chunk-A.js");
  });

  it("fails when a chunk the entry imports reaches a Node API, naming the chunk and line", () => {
    const cwd = build({
      "index.js": 'import { h } from "./chunk-B.js";\nexport { h };\n',
      "chunk-B.js":
        'import { createHash } from "node:crypto";\nexport const h = (t) => Buffer.from(createHash("sha256").update(t).digest());\n',
      "index.cjs": "exports.h = 1;\n",
    });
    const { code, err } = run(cwd);
    expect(code).toBe(m.EXIT.FAILED);
    expect(err).toContain("2 Node-only API uses");
    expect(err).toContain("dist/chunk-B.js:1: an import of node:crypto");
    expect(err).toContain("dist/chunk-B.js:2: a use of the Buffer global");
  });

  it("scans the entries given on the command line instead of the defaults", () => {
    const cwd = build({ "only.js": "var _fs = require('fs');\n" });
    expect(run(cwd, ["dist/only.js"]).code).toBe(m.EXIT.FAILED);
  });

  it("exits 2 when an entry is missing, so a run before the build is not a pass", () => {
    const cwd = build({ "index.js": "export const a = 1;\n" });
    const { code, err } = run(cwd);
    expect(code).toBe(m.EXIT.USAGE);
    expect(err).toContain("not found: dist/index.cjs");
    expect(err).toContain("npm run build");
  });
});
