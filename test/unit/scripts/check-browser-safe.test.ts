import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// scripts/check-browser-safe.mjs guards the SDK entry against Node-only APIs (story E5-S1): the
// scanner on made-up built files, and main() on throwaway directories. The real dist is checked
// in CI after the build; this tier needs no build. The scanner parses each file with the
// TypeScript compiler (E5-S1 review, G-1), so a string, a comment or a property named `process`
// is never mistaken for an API use, and a bare value (`x instanceof Buffer`) is never missed.

interface Finding {
  file: string;
  line: number;
  what: string;
}
interface Guard {
  EXIT: { OK: 0; FAILED: 1; USAGE: 2 };
  NODE_BUILTINS: Set<string>;
  isLocal(specifier: string): boolean;
  isNodeModule(specifier: string): boolean;
  scanSource(text: string, file: string): { findings: Finding[]; locals: string[] };
  scanEntry(entry: string): { findings: Finding[]; scanned: string[] };
  main(
    argv: string[],
    deps?: { cwd?: string; stdout?: (s: string) => void; stderr?: (s: string) => void },
  ): number;
}

const SCRIPT = fileURLToPath(new URL("../../../scripts/check-browser-safe.mjs", import.meta.url));

let m: Guard;
beforeAll(async () => {
  m = (await import(SCRIPT)) as Guard;
});

// Every throwaway directory is removed at the end (E5-S1 review, BH-5).
const temps: string[] = [];
afterAll(() => {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});
function temp(): string {
  const dir = mkdtempSync(join(tmpdir(), "dustin-browser-safe-"));
  temps.push(dir);
  return dir;
}

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
    expect(whats("const r = require(`fs`);")).toEqual(['an import of the Node built-in "fs"']);
    for (const name of ["fs", "path", "os", "child_process", "readline"]) {
      expect(m.NODE_BUILTINS.has(name)).toBe(true);
    }
  });

  it("treats Node's underscore internals as built-ins, which no npm package name may start with", () => {
    expect(whats("var _r = require('_stream_readable');")).toEqual([
      'an import of the Node built-in "_stream_readable"',
    ]);
    expect(m.isNodeModule("_http_agent")).toBe(true);
    expect(m.isNodeModule("node:fs")).toBe(true);
    expect(m.isNodeModule("fs/promises")).toBe(true);
    expect(m.isNodeModule("@stellar/stellar-sdk")).toBe(false);
    expect(m.isNodeModule("./chunk.js")).toBe(false);
  });

  it("reads a static import that spans several lines, and reports the specifier's line after blank lines", () => {
    const text = 'import {\n  readFileSync,\n  writeFileSync\n} from "node:fs";\n';
    expect(m.scanSource(text, "f.js").findings).toEqual([
      { file: "f.js", line: 4, what: "an import of node:fs" },
    ]);
    // The old `^\s*import` pattern matched from the first blank line and reported line 1.
    expect(m.scanSource('\n\n\nimport "node:fs";\n', "f.js").findings).toEqual([
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
    expect(whats("const me = __filename;")).toEqual(["a use of __dirname or __filename"]);
  });

  it("finds a bare value too: instanceof, optional chaining, element access, an assignment, destructuring", () => {
    expect(whats("const isBuf = (x) => x instanceof Buffer;")).toEqual([
      "a use of the Buffer global",
    ]);
    expect(whats("const f = Buffer?.from(a);")).toEqual(["a use of the Buffer global"]);
    expect(whats('const g = Buffer["from"](a);')).toEqual(["a use of the Buffer global"]);
    expect(whats("const B = Buffer;")).toEqual(["a use of the Buffer global"]);
    expect(whats("const ci = process?.env?.CI;")).toEqual(["a use of the process global"]);
    expect(whats("const { env } = process;")).toEqual(["a use of the process global"]);
    expect(whats("const o = { process };")).toEqual(["a use of the process global"]);
  });

  it("finds the globals reached through globalThis, window, self or global when they are then used", () => {
    expect(whats("const b = globalThis.Buffer.from(a);")).toEqual([
      "a use of the Buffer global through globalThis",
    ]);
    expect(whats("const e = window.process.env;")).toEqual([
      "a use of the process global through window",
    ]);
    expect(whats('const s = self["Buffer"].alloc(1);')).toEqual([
      "a use of the Buffer global through self",
    ]);
    expect(whats("const n = new globalThis.Buffer(4);")).toEqual([
      "a use of the Buffer global through globalThis",
    ]);
    expect(whats("const d = global.process.cwd();")).toEqual([
      "a use of the process global through global",
    ]);
  });

  it("passes a probe for whether the global exists, which a browser answers with undefined", () => {
    // What a bundled dependency does: `Lt = globalThis.Buffer`, then uses it only if defined.
    expect(whats("const B = globalThis.Buffer; if (globalThis.Buffer) use(B);")).toEqual([]);
    expect(whats("const has = globalThis.process !== undefined || !!window.Buffer;")).toEqual([]);
    expect(whats('const g = typeof globalThis.Buffer !== "undefined";')).toEqual([]);
  });

  it("skips a feature check, a property or method name, a declaration, and prose", () => {
    expect(whats('const has = typeof Buffer !== "undefined";')).toEqual([]);
    expect(whats('const node = typeof process === "object";')).toEqual([]);
    expect(whats("const x = sdk.Buffer.from(a); const myBuffer = 1; myBuffer.x;")).toEqual([]);
    expect(whats("obj.process.run(); const subprocess = 1;")).toEqual([]);
    expect(
      whats(
        "class H { process(d) { return d; } get __dirname() { return 1; } }\n" +
          "const o = { Buffer: 1, process() {}, __filename: 2 }; o.Buffer; o.process();",
      ),
    ).toEqual([]);
    // A local of the same name is a declaration, not Node's global: a parameter, a destructured
    // key, a bundled polyfill declared at the top of the file, a catch or loop variable.
    expect(whats("function f(process) { return process; }")).toEqual([]);
    expect(whats("const { Buffer: B } = polyfill; B.from(a);")).toEqual([]);
    expect(whats("var process = { env: {} };\nfunction g() { return process.env.X; }")).toEqual([]);
    expect(
      whats("try { a(); } catch (process) { process.x; } for (const Buffer of xs) Buffer.y;"),
    ).toEqual([]);
    // The same names outside their scope are the globals again.
    expect(whats("function f(process) { return process; }\nconst p = process.env;")).toEqual([
      "a use of the process global",
    ]);
    // Prose in a string or a comment, where a regular expression saw an API.
    expect(
      whats('const text = "the process was killed; process. Then import \\"node:fs\\".";'),
    ).toEqual([]);
    expect(
      whats('// import { x } from "node:fs"\n/* Buffer.from(a); process.exit(1) */\nconst y = 1;'),
    ).toEqual([]);
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
    const dir = temp();
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
    expect(out).toContain("no Node-only API reachable from dist/index.js, dist/index.cjs (4 files");
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
    expect(err).toContain("dist/index.js, dist/index.cjs: 2 Node-only API uses reachable");
    expect(err).toContain("dist/chunk-B.js:1: an import of node:crypto");
    expect(err).toContain("dist/chunk-B.js:2: a use of the Buffer global");
  });

  it("reports a local import that is not a file as a finding instead of throwing", () => {
    const cwd = build({
      "index.js":
        'import { a } from "./missing.js";\nimport { b } from "./folder.js";\nexport { a, b };\n',
      "index.cjs": "exports.a = 1;\n",
    });
    mkdirSync(join(cwd, "dist", "folder.js"));
    const { code, err } = run(cwd);
    expect(code).toBe(m.EXIT.FAILED);
    expect(err).toContain('dist/index.js:1: an import of "./missing.js" that is not a file');
    expect(err).toContain('dist/index.js:2: an import of "./folder.js" that is not a file');
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

  it("runs main() when invoked through its real path and through a symlink, so a skipped scan cannot pass as exit 0", () => {
    const cwd = temp();
    const direct = spawnSync(process.execPath, [SCRIPT], { cwd, encoding: "utf8" });
    expect(direct.status).toBe(m.EXIT.USAGE);
    expect(direct.stderr).toContain("not found: dist/index.js");
    // Before the review (G-1) the `resolve(argv[1]) === fileURLToPath(import.meta.url)` guard was
    // false through a symlink, so the script loaded, did nothing and exited 0.
    const link = join(cwd, "guard-link.mjs");
    symlinkSync(SCRIPT, link);
    const linked = spawnSync(process.execPath, [link], { cwd, encoding: "utf8" });
    expect(linked.status).toBe(m.EXIT.USAGE);
    expect(linked.stderr).toContain("not found: dist/index.js");
  });
});
