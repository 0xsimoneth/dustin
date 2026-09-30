// Verifies the built package the way a consumer sees it: ESM import, CommonJS require, the
// stellar-dustin/testing entry (PRD decision D-18), the `dustin` binary, the JSON schemas it
// publishes (PRD decision D-17), and the exact file list `npm pack` would publish. Run after
// `npm run build`.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { StrKey } from "@stellar/stellar-sdk";

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

/**
 * stellar-dustin/testing loads in both formats, and an error its helpers throw is an instance of
 * the DustinError that stellar-dustin exports: the two entries share one copy of each module.
 */
async function checkTesting() {
  const pairs = [
    [await import("stellar-dustin/testing"), await import("stellar-dustin")],
    [require("stellar-dustin/testing"), require("stellar-dustin")],
  ];
  const dir = mkdtempSync(join(tmpdir(), "dustin-package-"));
  try {
    const notAManifest = join(dir, "manifest.json");
    writeFileSync(notAManifest, "{}");
    for (const [testing, main] of pairs) {
      for (const name of [
        "buildMessyFixture",
        "buildEdgeFixture",
        "verifyFixture",
        "loadVerifyInput",
        "readManifest",
        "checkMessyFixture",
        "recordedReader",
      ]) {
        assert.equal(typeof testing[name], "function", `stellar-dustin/testing ${name}`);
      }
      assert.throws(
        () => testing.readManifest(notAManifest),
        (error) => error instanceof main.DustinError && error.code === "MANIFEST_INVALID",
      );
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** The two schemas resolve through the package's exports and are the published documents. */
function checkSchemas() {
  for (const name of ["plan-schema.json", "receipt-schema.json"]) {
    const path = require.resolve(`stellar-dustin/schemas/${name}`);
    const schema = JSON.parse(readFileSync(path, "utf8"));
    assert.equal(schema.$schema, "https://json-schema.org/draft/2020-12/schema", name);
    assert.equal(
      schema.$id,
      `https://github.com/0xsimoneth/dustin/blob/main/schemas/${name}`,
      name,
    );
  }
}

function checkBinary() {
  const bin = fileURLToPath(new URL(`../${pkg.bin.dustin}`, import.meta.url));
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
  const allowed =
    /^(package\.json|README\.md|LICENSE|CHANGELOG\.md|dist\/.+|schemas\/(plan|receipt)-schema\.json)$/;
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
    "dist/testing.js",
    "dist/testing.cjs",
    "dist/testing.d.ts",
    "dist/testing.d.cts",
    "CHANGELOG.md",
    "schemas/plan-schema.json",
    "schemas/receipt-schema.json",
  ]) {
    assert.ok(files.includes(required), `missing from the tarball: ${required}`);
  }
  // No secret seed may ship: any 56-character "S..." window with a valid StrKey checksum.
  const windows = /(?=(S[A-Z2-7]{55}))/g;
  for (const file of files) {
    const text = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    for (const match of text.matchAll(windows)) {
      assert.ok(!StrKey.isValidEd25519SecretSeed(match[1]), `secret seed in ${file}`);
    }
  }
  return files;
}

await checkEntryPoints();
await checkTesting();
checkSchemas();
checkBinary();
const files = checkTarball();
console.log(`package check passed (${files.length} files): ${files.join(", ")}`);
