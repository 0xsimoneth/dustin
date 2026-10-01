#!/usr/bin/env node
// The SDK entry must run in a browser bundle (story E5-S1, docs/web-demo.md): this scans
// dist/index.js and dist/index.cjs, with every local chunk they import, and fails on a Node-only
// API: an import or require of a `node:` module, of a bare Node built-in (fs, path, os,
// child_process, readline, crypto, ...) or of an underscore internal (_stream_readable), and a use
// of the Buffer, process, __dirname or __filename globals, which no browser defines, whether bare
// (`Buffer.from(`, `x instanceof Buffer`, `process?.env`, `const B = Buffer`) or through
// globalThis, window, self or global when the property is then called or read into
// (`globalThis.Buffer.from(`). Every file is parsed with the TypeScript compiler (E5-S1 review,
// G-1): a string, a comment, or a property or method named `process` is never mistaken for an API
// use; a `typeof Buffer` feature check, a probe such as `const B = globalThis.Buffer` that reads
// whether it exists, and a name the file declares itself (`function f(process)`, a bundled
// polyfill) are not uses of Node's global. The CLI (dist/cli) and
// stellar-dustin/testing (dist/testing.*) are Node programs and are not scanned. Run after
// `npm run build`; given a path, it checks any bundle the same way (the web demo's own build in CI).
// A unit test covers the scanner (test/unit/scripts/check-browser-safe.test.ts).
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

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

/**
 * True for a module Node provides: `node:x`, a bare built-in (`fs`, `fs/promises`), or one of
 * Node's underscore internals (`_stream_readable`, `_http_agent`), a name no npm package may have.
 */
export function isNodeModule(specifier) {
  return (
    specifier.startsWith("node:") ||
    NODE_BUILTINS.has(specifier.split("/")[0]) ||
    /^_[a-z]/.test(specifier)
  );
}

/** True for a path the file names relative to itself: a chunk of the same build. */
export function isLocal(specifier) {
  return specifier.startsWith("./") || specifier.startsWith("../");
}

const GLOBAL_NAMES = new Set(["Buffer", "process", "__dirname", "__filename"]);
const GLOBAL_OBJECTS = new Set(["globalThis", "window", "self", "global"]);

function describeGlobal(name) {
  return name === "__dirname" || name === "__filename"
    ? "__dirname or __filename"
    : `the ${name} global`;
}

/**
 * True when the identifier names something instead of reading the global: the property of another
 * value (`sdk.Buffer`), the key of an object or class member (`{ process() {} }`), a declaration or
 * a parameter (`function f(process)`), a binding, an import or export name, a label.
 */
function isName(id) {
  const p = id.parent;
  if (!p) return false;
  if (ts.isPropertyAccessExpression(p)) return p.name === id;
  if (
    ts.isPropertyAssignment(p) ||
    ts.isMethodDeclaration(p) ||
    ts.isPropertyDeclaration(p) ||
    ts.isGetAccessorDeclaration(p) ||
    ts.isSetAccessorDeclaration(p) ||
    ts.isVariableDeclaration(p) ||
    ts.isParameter(p) ||
    ts.isFunctionDeclaration(p) ||
    ts.isFunctionExpression(p) ||
    ts.isClassDeclaration(p) ||
    ts.isClassExpression(p)
  ) {
    return p.name === id;
  }
  if (ts.isBindingElement(p)) return p.name === id || p.propertyName === id;
  return (
    ts.isImportSpecifier(p) ||
    ts.isExportSpecifier(p) ||
    ts.isImportClause(p) ||
    ts.isNamespaceImport(p) ||
    ts.isLabeledStatement(p) ||
    ts.isBreakOrContinueStatement(p)
  );
}

/**
 * The names a node declares for what is inside it: a function's parameters and its own name, a
 * catch clause's variable, a loop's variables, and the var, let, const, function, class and import
 * declarations among the statements of a file, a block or a switch. A use of such a name inside is
 * the local, not Node's global.
 */
function declaredNames(node) {
  const names = new Set();
  const add = (binding) => {
    if (!binding) return;
    if (ts.isIdentifier(binding)) names.add(binding.text);
    else if (ts.isObjectBindingPattern(binding) || ts.isArrayBindingPattern(binding)) {
      for (const element of binding.elements) if (ts.isBindingElement(element)) add(element.name);
    }
  };
  if (ts.isFunctionLike(node)) {
    for (const parameter of node.parameters) add(parameter.name);
    if (ts.isFunctionExpression(node) && node.name) add(node.name);
  }
  if (ts.isClassExpression(node) && node.name) add(node.name);
  if (ts.isCatchClause(node)) add(node.variableDeclaration?.name);
  if (
    (ts.isForStatement(node) || ts.isForInStatement(node) || ts.isForOfStatement(node)) &&
    node.initializer &&
    ts.isVariableDeclarationList(node.initializer)
  ) {
    for (const declaration of node.initializer.declarations) add(declaration.name);
  }
  const statements =
    ts.isSourceFile(node) || ts.isBlock(node) || ts.isModuleBlock(node)
      ? node.statements
      : ts.isCaseBlock(node)
        ? node.clauses.flatMap((clause) => [...clause.statements])
        : [];
  for (const statement of statements) {
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) add(declaration.name);
    } else if (
      (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) &&
      statement.name
    ) {
      add(statement.name);
    } else if (ts.isImportDeclaration(statement) && statement.importClause) {
      add(statement.importClause.name);
      const bindings = statement.importClause.namedBindings;
      if (bindings && ts.isNamespaceImport(bindings)) add(bindings.name);
      if (bindings && ts.isNamedImports(bindings)) {
        for (const element of bindings.elements) add(element.name);
      }
    }
  }
  return names;
}

/**
 * True when a `globalThis.Buffer` (or window, self, global) is then used as a value: called,
 * constructed, or a property read from it. Reading it into a variable or comparing it is a probe
 * for whether it exists, which a browser answers with undefined and no error.
 */
function isUsed(node) {
  const p = node.parent;
  if (!p) return false;
  if (ts.isPropertyAccessExpression(p) || ts.isElementAccessExpression(p))
    return p.expression === node;
  if (ts.isCallExpression(p) || ts.isNewExpression(p)) return p.expression === node;
  return false;
}

/**
 * The findings in one built file's source, the local files it imports (`locals`, each once) and
 * where it imports them (`localImports`, with lines). A specifier is a finding when it names a
 * Node module; a package name is not scanned here, since the SDK's dependencies stay external and
 * the web demo's own bundle, which inlines them, is scanned as a whole in CI.
 */
export function scanSource(text, file) {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const findings = [];
  const localImports = [];
  const scopes = [];
  const isDeclared = (name) => scopes.some((scope) => scope.has(name));
  const lineOf = (node) => source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
  const found = (node, what) => findings.push({ file, line: lineOf(node), what });
  const specifier = (node, name) => {
    if (name.startsWith("node:")) found(node, `an import of ${name}`);
    else if (isNodeModule(name)) found(node, `an import of the Node built-in "${name}"`);
    else if (isLocal(name)) localImports.push({ specifier: name, line: lineOf(node) });
  };
  const visit = (node) => {
    scopes.push(declaredNames(node));
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      specifier(node.moduleSpecifier, node.moduleSpecifier.text);
    } else if (
      ts.isCallExpression(node) &&
      node.arguments.length > 0 &&
      ts.isStringLiteralLike(node.arguments[0]) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === "require"))
    ) {
      specifier(node.arguments[0], node.arguments[0].text);
    } else if (
      ts.isIdentifier(node) &&
      GLOBAL_NAMES.has(node.text) &&
      !isName(node) &&
      !ts.isTypeOfExpression(node.parent) &&
      !isDeclared(node.text)
    ) {
      found(node, `a use of ${describeGlobal(node.text)}`);
    } else if (
      (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) &&
      ts.isIdentifier(node.expression) &&
      GLOBAL_OBJECTS.has(node.expression.text) &&
      !isDeclared(node.expression.text) &&
      isUsed(node)
    ) {
      const name = ts.isPropertyAccessExpression(node)
        ? node.name.text
        : ts.isStringLiteralLike(node.argumentExpression)
          ? node.argumentExpression.text
          : "";
      if (GLOBAL_NAMES.has(name)) {
        found(node, `a use of ${describeGlobal(name)} through ${node.expression.text}`);
      }
    }
    ts.forEachChild(node, visit);
    scopes.pop();
  };
  visit(source);
  findings.sort((a, b) => a.line - b.line);
  return { findings, locals: [...new Set(localImports.map((i) => i.specifier))], localImports };
}

/**
 * Scans an entry file and, transitively, the local files it imports. Returns the findings and the
 * files scanned (paths as given, then as resolved from each importer). A local import that is not
 * a file is a finding against its importer, not a crash.
 */
export function scanEntry(entry) {
  const queue = [{ file: resolve(entry), importer: null, specifier: null, line: 0 }];
  const seen = new Set();
  const scanned = [];
  const findings = [];
  while (queue.length > 0) {
    const { file, importer, specifier, line } = queue.shift();
    if (seen.has(file)) continue;
    seen.add(file);
    if (!existsSync(file) || !statSync(file).isFile()) {
      findings.push({
        file: importer ?? file,
        line,
        what: `an import of "${specifier ?? file}" that is not a file`,
      });
      continue;
    }
    scanned.push(file);
    const result = scanSource(readFileSync(file, "utf8"), file);
    findings.push(...result.findings);
    for (const local of result.localImports) {
      queue.push({
        file: resolve(dirname(file), local.specifier),
        importer: file,
        specifier: local.specifier,
        line: local.line,
      });
    }
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
  // The entries are named in every message: the same scan runs over the SDK entry (the default)
  // and over the web demo's bundle (web/package.json, check:bundle).
  const names = entries.map(show).join(", ");
  if (findings.length > 0) {
    stderr(
      `check-browser-safe: ${names}: ${findings.length} Node-only API use${findings.length === 1 ? "" : "s"} reachable:\n`,
    );
    for (const f of findings) stderr(`  ${show(f.file)}:${f.line}: ${f.what}\n`);
    stderr(
      "Code that runs in a browser bundle must reach no Node-only API (docs/web-demo.md); the SDK entry (stellar-dustin) keeps Node's APIs in src/cli and src/fixture.\n",
    );
    return EXIT.FAILED;
  }
  stdout(
    `check-browser-safe: no Node-only API reachable from ${names} (${scanned.length} file${scanned.length === 1 ? "" : "s"}: ${scanned.map(show).join(", ")}).\n`,
  );
  return EXIT.OK;
}

/**
 * True when this file is the program Node was started with, compared by real path, so a symlink
 * to it (or a differently cased path) still runs main(): before the review the comparison was by
 * the path as given, and a symlinked call loaded the module, did nothing and exited 0 (G-1).
 */
function isMain() {
  const started = process.argv[1];
  if (!started) return false;
  try {
    return realpathSync.native(started) === realpathSync.native(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isMain()) {
  process.exit(main(process.argv.slice(2)));
}
