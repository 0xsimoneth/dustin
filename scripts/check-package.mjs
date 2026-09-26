// Verifies the built package the way a consumer sees it: ESM import, CommonJS require,
// the `dustin` binary, and the exact file list `npm pack` would publish.
// Run after `npm run build`.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

async function checkEntryPoints() {
  const esm = await import("stellar-dustin");
  const cjs = require("stellar-dustin");
  for (const mod of [esm, cjs]) {
    assert.equal(typeof mod.planClose, "function");
    assert.equal(typeof mod.executeClose, "function");
    assert.equal(typeof mod.DustinError, "function");
  }
}

function checkBinary() {
  const bin = new URL(`../${pkg.bin.dustin}`, import.meta.url).pathname;
  const help = spawnSync(process.execPath, [bin, "--help"], { encoding: "utf8" });
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /\bplan\b/);
  assert.match(help.stdout, /\bclose\b/);
  const version = spawnSync(process.execPath, [bin, "--version"], { encoding: "utf8" });
  assert.equal(version.status, 0, version.stderr);
  assert.equal(version.stdout.trim(), pkg.version);
}

function checkTarball() {
  const [report] = JSON.parse(
    execFileSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], { encoding: "utf8" }),
  );
  const files = report.files.map((f) => f.path).sort();
  const allowed = /^(package\.json|README\.md|LICENSE|CHANGELOG\.md|dist\/.+)$/;
  const unexpected = files.filter((f) => !allowed.test(f));
  assert.deepEqual(unexpected, [], `unexpected files in the tarball: ${unexpected.join(", ")}`);
  for (const required of [
    "LICENSE",
    "README.md",
    "package.json",
    "dist/index.js",
    "dist/index.cjs",
    "dist/index.d.ts",
    "dist/index.d.cts",
    "dist/cli/main.js",
  ]) {
    assert.ok(files.includes(required), `missing from the tarball: ${required}`);
  }
  // A Stellar secret seed is "S" followed by 55 base32 characters; none may ship.
  const seed = /\bS[A-Z2-7]{55}\b/;
  for (const file of files) {
    const text = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    assert.ok(!seed.test(text), `secret-looking string in ${file}`);
  }
  return files;
}

await checkEntryPoints();
checkBinary();
const files = checkTarball();
console.log(`package check passed (${files.length} files): ${files.join(", ")}`);
