// Captures the public pages of a recorded close as PNG files in its run directory, so that they
// outlive the testnet reset of 2026-12-16 (the final audit of 2026-09-30, item 5): the closed
// account's page on StellarExpert's testnet explorer, the page of each of its transactions with
// every operation shown, and Horizon's answer for the account, its 404. Each picture carries a
// strip that names its URL and the time it was captured.
//
// Usage, from the repository root:
//   node scripts/demo/explorer-shots.mjs --playwright <directory with node_modules/playwright> <run directory>
//
// It reads the run's report.json (the account and its transactions), asks nothing but
// https://stellar.expert/explorer/testnet and testnet Horizon, with GET requests only, and writes
// explorer-account.png, explorer-tx-<n>.png, horizon-account-404.png and screenshots.json into the
// run directory. It needs ffmpeg (with drawtext) on the PATH and Playwright's Chromium, as
// scripts/demo/make-demo.mjs does. A page that does not show what it must (the account's merge,
// a successful transaction, "Resource Missing") is loaded again, up to four times; then the script
// stops with exit code 1 and writes nothing more.
/* global document */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const USAGE =
  "usage: node scripts/demo/explorer-shots.mjs --playwright <directory with node_modules/playwright> <run directory>";
const TESTNET = "Test SDF Network ; September 2015";
const HORIZON = "https://horizon-testnet.stellar.org";
const EXPLORER = "https://stellar.expert/explorer/testnet";
const ATTEMPTS = 4;
const log = (line) => process.stderr.write(`explorer-shots: ${line}\n`);
function refuse(problem, code = 2) {
  process.stderr.write(`explorer-shots: ${problem}\n${code === 2 ? `${USAGE}\n` : ""}`);
  process.exit(code);
}

const args = process.argv.slice(2);
const pw = args.indexOf("--playwright");
if (pw === -1 || !args[pw + 1]) refuse("name the Playwright directory");
const rest = args.filter((_, i) => i !== pw && i !== pw + 1);
if (rest.length !== 1) refuse("name one run directory");
const RUN = resolve(rest[0]);
if (!existsSync(join(RUN, "report.json"))) refuse(`${rest[0]} holds no report.json`);
if (spawnSync("which", ["ffmpeg"]).status !== 0) refuse("ffmpeg is not on the PATH", 1);
let chromium;
try {
  ({ chromium } = createRequire(join(args[pw + 1], "package.json"))("playwright"));
} catch {
  refuse("playwright cannot be loaded from the given directory", 1);
}

const report = JSON.parse(readFileSync(join(RUN, "report.json"), "utf8"));
if (report.network?.passphrase !== TESTNET || report.network?.horizon !== HORIZON) {
  refuse("the run's report does not name the testnet and its Horizon", 1);
}
const account = report.account;
const hashes = (report.transactions ?? []).map((t) => t.hash);
if (!/^G[A-Z2-7]{55}$/.test(account ?? "") || hashes.some((h) => !/^[0-9a-f]{64}$/.test(h))) {
  refuse("the run's report names no account or a malformed transaction hash", 1);
}

const pages = [
  {
    file: "explorer-account.png",
    url: `${EXPLORER}/account/${account}`,
    waitFor: "merged into account",
    shows:
      "the closed account on StellarExpert: Account (deleted), no balances, and its history, the merge first",
  },
  ...hashes.map((hash, i) => ({
    file: `explorer-tx-${i + 1}.png`,
    url: `${EXPLORER}/tx/${hash}`,
    waitFor: "Successful",
    expand: /more operations? in this transaction/,
    shows: `transaction ${i + 1} on StellarExpert: successful, the closed account as its source, the fee sponsor as its fee source, every operation`,
  })),
  {
    file: "horizon-account-404.png",
    url: `${HORIZON}/accounts/${account}`,
    waitFor: "Resource Missing",
    zoom: 1.6,
    shows: "Horizon's answer for the closed account: HTTP 404, Resource Missing",
  },
];

const WORK = mkdtempSync(join(tmpdir(), "dustin-shots-"));
const browser = await chromium.launch();
const taken = [];
try {
  for (const p of pages) {
    let done = false;
    for (let attempt = 1; attempt <= ATTEMPTS && !done; attempt += 1) {
      const page = await browser.newPage({
        viewport: { width: 1536, height: 728 },
        deviceScaleFactor: 1.25,
      });
      try {
        const response = await page.goto(p.url, { waitUntil: "domcontentloaded", timeout: 90_000 });
        if (p.url.startsWith(HORIZON) && response?.status() !== 404) {
          throw new Error(`Horizon answered ${response?.status()}, not 404`);
        }
        await page.getByText(p.waitFor, { exact: false }).first().waitFor({ timeout: 60_000 });
        await page.waitForTimeout(2500);
        if (p.expand) {
          const more = page.getByText(p.expand).first();
          if ((await more.count()) > 0) {
            await more.click();
            await page.waitForTimeout(1500);
          }
        }
        if (p.zoom) await page.evaluate((z) => (document.body.style.zoom = String(z)), p.zoom);
        const capturedAt = new Date().toISOString().replace(/\.\d+Z$/, "Z");
        const raw = join(WORK, p.file);
        await page.screenshot({ path: raw, fullPage: true });
        // A strip of two lines above the page: its URL, then the time it was captured.
        const urlText = join(WORK, `${p.file}.url.txt`);
        const timeText = join(WORK, `${p.file}.time.txt`);
        writeFileSync(urlText, p.url);
        writeFileSync(timeText, `captured ${capturedAt}`);
        const text = (file, y) =>
          `drawtext=font=Menlo:textfile=${file}:fontcolor=0xE6E6E6:fontsize=24:x=24:y=${y}`;
        const result = spawnSync(
          "ffmpeg",
          [
            ...["-v", "error", "-y", "-i", raw, "-vf"],
            `pad=iw:ih+84:0:84:color=0x2B2F36,${text(urlText, 12)},${text(timeText, 46)}`,
            join(RUN, p.file),
          ],
          { encoding: "utf8" },
        );
        if (result.status !== 0) throw new Error(`ffmpeg: ${result.stderr.slice(-300)}`);
        taken.push({ file: p.file, url: p.url, capturedAt, shows: p.shows });
        log(`${p.file}: ${p.url} (attempt ${attempt})`);
        done = true;
      } catch (error) {
        log(`${p.file}: attempt ${attempt} failed: ${String(error).split("\n")[0].slice(0, 160)}`);
      } finally {
        await page.close();
      }
    }
    if (!done) throw new Error(`${p.url} did not show "${p.waitFor}" in ${ATTEMPTS} attempts`);
  }
  writeFileSync(join(RUN, "screenshots.json"), `${JSON.stringify(taken, null, 2)}\n`);
  log(`wrote ${taken.length} pictures and screenshots.json`);
} catch (error) {
  log(`stopped: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  await browser.close();
  rmSync(WORK, { recursive: true, force: true });
}
