// Produces the 60-second demo video of story E4-S6 from the rehearsal script
// (docs/demo-video-script.md), end to end, on a fresh `messy` fixture on the Stellar testnet:
//
//   1. the terminal takes, recorded with asciinema while scripts/demo/take.exp types the commands:
//      `dustin fixture create --profile messy`, `dustin plan ...`, `dustin close ... --execute`
//      with the typed confirmation of the destination's last four characters;
//   2. the browser pages before and after the close, captured with Playwright;
//   3. the cut: each terminal shot rendered from its recording with agg, the pages, a title card
//      and an end card, joined with ffmpeg into a 1920x1080 MP4 of at most 60 seconds with
//      burned-in captions, plus the captions as an .srt sidecar and a short GIF of the close.
//
// Usage, from the repository root:
//   node scripts/demo/make-demo.mjs --playwright <directory where `npm install playwright` ran>
//   [--keep-work]
//
// It needs asciinema (3.x), agg (1.9 or newer), expect, ffmpeg with libass and ffprobe on the
// PATH, and Playwright's Chromium. Testnet only; every account is a throwaway funded by Friendbot.
// The fixture's secret keys stay in its keys file; they reach `dustin close` only through a .env
// file (mode 600) in the take's working directory, written right before the close and removed
// right after it, never through a command line. Every file is scanned for secrets and local paths
// before it is written under evidence/demo/. The MP4 is ignored by git (.gitignore); everything
// else is committed: the recordings (.cast), the captions, the GIF, the key frames, and the
// record of the take with its accounts and transactions.
/* global document, window, NodeFilter */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { homedir, tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

// 1. Arguments, tools and the build.
const USAGE =
  "usage: node scripts/demo/make-demo.mjs --playwright <directory with node_modules/playwright> [--keep-work]";
const args = process.argv.slice(2);
const log = (line) => process.stderr.write(`make-demo: ${line}\n`);
function refuse(problem, code = 2) {
  process.stderr.write(`make-demo: ${problem}\n${code === 2 ? `${USAGE}\n` : ""}`);
  process.exit(code);
}
const pwIndex = args.indexOf("--playwright");
if (pwIndex === -1 || !args[pwIndex + 1]) refuse("name the Playwright directory");
const PLAYWRIGHT_DIR = args[pwIndex + 1];
const KEEP_WORK = args.includes("--keep-work");
const known = new Set(["--playwright", "--keep-work", PLAYWRIGHT_DIR]);
if (args.some((a) => !known.has(a))) refuse("unknown argument (it is not shown)");

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const TAKE_EXP = join(ROOT, "scripts", "demo", "take.exp");
const OUT = join(ROOT, "evidence", "demo");
const HORIZON = "https://horizon-testnet.stellar.org";
const STEEXP = "https://testnet.steexp.com";
const REPOSITORY = "https://github.com/0xsimoneth/dustin";

for (const tool of ["asciinema", "agg", "expect", "ffmpeg", "ffprobe"]) {
  if (spawnSync("which", [tool]).status !== 0) refuse(`${tool} is not on the PATH`, 1);
}
let chromium;
try {
  ({ chromium } = createRequire(join(PLAYWRIGHT_DIR, "package.json"))("playwright"));
} catch {
  refuse("playwright cannot be loaded from the given directory", 1);
}

// The terminal: 120 columns (docs/demo-video-script.md, "Terminal"), 60 rows so that a whole
// receipt stays on the recorded screen; each shot shows a 1080p window of it. Geometry of agg's
// frames at font size 26 and line height 1.25, measured: 1910 x 1983 pixels, rows 32.5 pixels
// apart from 16.5 pixels down, background #ECEFF4 (theme github-light).
const COLS = 120;
const ROWS = 60;
const FONT = 26;
const LINE = 1.25;
const FRAME_W = 1910;
const FRAME_H = 1983;
const PITCH = 32.5;
const PAD_Y = 16.5;
const TERM_BG = "0xECEFF4";
// The video: 1920 x 1080, a 120-pixel caption band on top, the picture below it.
const W = 1920;
const H = 1080;
const BAND = 120;
const PIC_H = H - BAND;
const FPS = 30;

function run(command, commandArgs, options = {}) {
  const result = spawnSync(command, commandArgs, {
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
    ...options,
  });
  if (result.status !== 0 && !options.allowFailure) {
    throw new Error(
      `${command} ${commandArgs[0] ?? ""} exited ${result.status}: ${(result.stderr ?? "").slice(-800)}`,
    );
  }
  return result;
}

log("building the CLI");
run("npm", ["run", "build"], { cwd: ROOT });
const WORK = mkdtempSync(join(tmpdir(), "dustin-demo-"));
const PREFIX = join(WORK, "prefix");
const TAKE = join(WORK, "take");
const STAGE = join(WORK, "stage");
for (const dir of [TAKE, STAGE, join(STAGE, "frames"), join(WORK, "cut")]) {
  mkdirSync(dir, { recursive: true });
}
run("npm", ["link"], { cwd: ROOT, env: { ...process.env, npm_config_prefix: PREFIX } });
const lib = await import(pathToFileURL(join(ROOT, "dist", "index.js")).href);
const VERSION = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).version;

/** The environment of every on-camera command: no DUSTIN_ variable, `dustin` on the PATH. */
function takeEnv(extra = {}) {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) if (!k.startsWith("DUSTIN_")) env[k] = v;
  return { ...env, PATH: `${join(PREFIX, "bin")}:${process.env.PATH}`, ...extra };
}

// 2. Recording a take, and reading a recording.

/** Records one take with asciinema; returns the parsed recording. */
function record(name, extra) {
  const file = join(WORK, `${name}.cast`);
  log(`recording the ${name} take`);
  run(
    "asciinema",
    [
      "rec",
      "-q",
      "--headless",
      "--window-size",
      `${COLS}x${ROWS}`,
      "-f",
      "asciicast-v2",
      "--overwrite",
      "-c",
      `expect ${TAKE_EXP}`,
      file,
    ],
    { cwd: TAKE, env: takeEnv({ DEMO_COLS: String(COLS), DEMO_ROWS: String(ROWS), ...extra }) },
  );
  const cast = readCast(file);
  const exit = cast.exits.at(-1);
  if (exit !== "0") throw new Error(`the ${name} take ended with ${exit ?? "no exit code"}`);
  return cast;
}

/** An asciicast v2 file: its output events and the exit codes it records. */
function readCast(file) {
  const [head, ...rest] = readFileSync(file, "utf8").split("\n").filter(Boolean);
  const header = JSON.parse(head);
  const events = [];
  const exits = [];
  for (const line of rest) {
    const [t, kind, data] = JSON.parse(line);
    if (kind === "o") events.push([t, data]);
    if (kind === "x") exits.push(data);
  }
  return { header, events, exits, text: events.map((e) => e[1]).join("") };
}

/** The time of the event after which the output since `after` first contains `pattern`. */
function timeOf(cast, pattern, after = 0) {
  let seen = "";
  for (const [t, data] of cast.events) {
    if (t < after) continue;
    seen += data;
    if (seen.includes(pattern)) return t;
  }
  throw new Error(`the recording never shows "${pattern}"`);
}

/** A minimal terminal: the screen (ROWS lines) after every event up to time `t`. */
function screenAt(cast, t) {
  const lines = [[]];
  let row = 0;
  let col = 0;
  let wrap = false;
  const put = (ch) => {
    if (wrap) {
      row += 1;
      col = 0;
      wrap = false;
    }
    while (lines.length <= row) lines.push([]);
    const line = lines[row];
    while (line.length < col) line.push(" ");
    line[col] = ch;
    if (col === COLS - 1) wrap = true;
    else col += 1;
  };
  for (const [time, data] of cast.events) {
    if (time > t) break;
    for (let i = 0; i < data.length; i += 1) {
      const ch = data[i];
      if (ch === "\u001b") {
        const next = data[i + 1];
        if (next === "[") {
          i += 2;
          while (i < data.length && !/[@-~]/.test(data[i])) i += 1;
        } else if (next === "]") {
          while (i < data.length && data[i] !== "\u0007") i += 1;
        } else i += 1;
      } else if (ch === "\r") {
        col = 0;
        wrap = false;
      } else if (ch === "\n") {
        row += 1;
        wrap = false;
        while (lines.length <= row) lines.push([]);
      } else if (ch === "\b") {
        col = Math.max(0, col - 1);
        wrap = false;
      } else if (ch >= " ") put(ch);
    }
  }
  const top = Math.max(0, row - ROWS + 1);
  return lines.slice(top, top + ROWS).map((l) => l.join(""));
}

/** The row of the first screen line at time `t` that matches `pattern`, or `fallback`. */
function rowOf(cast, t, pattern, fallback = 0) {
  const index = screenAt(cast, t).findIndex((line) => pattern.test(line));
  return index === -1 ? fallback : index;
}

/** The time `t` of a recording on a shot's clock that starts at `from` with pauses capped. */
function localTime(cast, from, t, maxGap = Infinity) {
  let last = from;
  let clock = 0.001;
  for (const [time] of cast.events) {
    if (time <= from) continue;
    if (time > t) break;
    clock += Math.min(time - last, maxGap);
    last = time;
  }
  return clock + Math.min(Math.max(0, t - last), maxGap);
}

/** The crop offset that puts screen row `row` at the top of the picture, within the frame. */
function yForRow(row) {
  return Math.round(Math.min(FRAME_H - PIC_H, Math.max(0, PAD_Y + row * PITCH - 10)));
}
const Y_BOTTOM = FRAME_H - PIC_H;

// 3. Checks and scans.

/** Refuses a text that holds a secret seed or a local path. */
function scanned(name, text, forbidden) {
  if (lib.redact(text) !== text) throw new Error(`${name} holds a secret seed; nothing written`);
  for (const secret of forbidden) {
    if (text.includes(secret)) throw new Error(`${name} holds a fixture secret; nothing written`);
  }
  for (const path of [WORK, ROOT, homedir()]) {
    if (text.includes(path)) throw new Error(`${name} holds a local path; nothing written`);
  }
  return text;
}

async function horizonGet(path, tries = 5) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      const response = await globalThis.fetch(`${HORIZON}${path}`);
      const body = await response.json().catch(() => null);
      if (response.status < 500 && response.status !== 429)
        return { status: response.status, body };
    } catch {
      // Retried below.
    }
    if (attempt >= tries) throw new Error(`Horizon did not answer GET ${path}`);
    await sleep(2000 * attempt);
  }
}

// 4. The browser pages.

/**
 * Captures a page as the picture of a shot: the page at 1920 x 910 (a 1536 x 728 viewport at
 * 1.25x), under a 50-pixel strip that names its URL. Each candidate is tried in order until one
 * shows `waitFor`; `zoom` enlarges a JSON page and `scrollTo` scrolls to a piece of its text.
 */
async function capturePage(browser, name, candidates) {
  for (const c of candidates) {
    const page = await browser.newPage({
      viewport: { width: 1536, height: 728 },
      deviceScaleFactor: 1.25,
    });
    try {
      await page.goto(c.url, { waitUntil: "domcontentloaded", timeout: 60_000 });
      await page.getByText(c.waitFor, { exact: false }).first().waitFor({ timeout: 60_000 });
      await page.waitForTimeout(c.settleMs ?? 1500);
      if (c.zoom) await page.evaluate((z) => (document.body.style.zoom = String(z)), c.zoom);
      if (c.scrollTo) {
        await page.evaluate((text) => {
          const pre = document.querySelector("pre") ?? document.body;
          const walker = document.createTreeWalker(pre, NodeFilter.SHOW_TEXT);
          for (let node = walker.nextNode(); node; node = walker.nextNode()) {
            const at = node.textContent.indexOf(text);
            if (at === -1) continue;
            const range = document.createRange();
            range.setStart(node, at);
            range.setEnd(node, at + text.length);
            window.scrollBy(0, range.getBoundingClientRect().top - 24);
            return;
          }
        }, c.scrollTo);
      }
      const shot = join(WORK, "cut", `${name}-page.png`);
      await page.screenshot({ path: shot });
      await page.close();
      const still = join(WORK, "cut", `${name}.png`);
      const label = join(WORK, "cut", `${name}-url.txt`);
      writeFileSync(label, c.url);
      run("ffmpeg", [
        "-v",
        "error",
        "-y",
        "-i",
        shot,
        "-vf",
        `scale=${W}:910,pad=${W}:${PIC_H}:0:50:color=0x2B2F36,` +
          `drawtext=font=Menlo:textfile=${label}:fontcolor=0xE6E6E6:fontsize=24:x=24:y=14`,
        still,
      ]);
      return { still, url: c.url };
    } catch (error) {
      await page.close();
      log(`${name}: ${c.url} did not show "${c.waitFor}" (${String(error).slice(0, 120)})`);
    }
  }
  throw new Error(`no page could be captured for ${name}`);
}

// 5. The cut: every shot is an MP4 of the picture (1920 x 960) with an exact duration.

let shotNumber = 0;
const shots = [];

/** A still picture held for `duration` seconds. */
function stillShot(label, still, duration, caption) {
  const file = join(WORK, "cut", `shot-${String((shotNumber += 1)).padStart(2, "0")}.mp4`);
  run("ffmpeg", [
    ...["-v", "error", "-y", "-loop", "1", "-framerate", String(FPS), "-t", String(duration)],
    ...["-i", still, "-vf", `scale=${W}:${PIC_H},format=yuv420p`, "-r", String(FPS)],
    ...["-c:v", "libx264", "-crf", "16", "-preset", "medium", file],
  ]);
  shots.push({ label, file, duration, caption });
}

/** A card: centred lines of text on a dark background. */
function cardShot(label, lines, duration, caption) {
  const filters = [];
  const height = lines.reduce((sum, l, i) => sum + l.size + (i > 0 ? (l.gap ?? 24) : 0), 0);
  let y = Math.round((PIC_H - height) / 2);
  lines.forEach((l, i) => {
    if (i > 0) y += l.gap ?? 24;
    const textFile = join(WORK, "cut", `${label}-${i}.txt`);
    writeFileSync(textFile, l.text);
    filters.push(
      `drawtext=font='${l.font}':textfile=${textFile}:fontsize=${l.size}:fontcolor=${l.color}:x=(w-text_w)/2:y=${y}`,
    );
    y += l.size;
  });
  const still = join(WORK, "cut", `${label}.png`);
  run("ffmpeg", [
    ...["-v", "error", "-y", "-f", "lavfi", "-i", `color=c=0x10161D:s=${W}x${PIC_H}`],
    ...["-vf", filters.join(","), "-frames:v", "1", still],
  ]);
  stillShot(label, still, duration, caption);
}

/**
 * A terminal shot rendered from a recording: the events from `from` to `to`, every pause longer
 * than `maxGap` shortened to it (the waits for a ledger; typing is never sped up), shown through
 * a window that moves between the crop offsets of `crop` ([time, y] pairs, linear in between),
 * then the last picture held until `duration`. The state before `from` is replayed at once.
 */
function terminalShot(
  label,
  cast,
  { from, to, maxGap = Infinity, fill = false },
  crop,
  duration,
  caption,
) {
  // With `fill`, the pauses are shortened only as much as the shot needs, so the waits for a
  // ledger keep as much of their real length as fits, instead of a long hold at the end.
  while (fill && maxGap < 30 && localTime(cast, from, to, maxGap + 0.1) <= duration - 0.8) {
    maxGap += 0.1;
  }
  // A take slower than the cut allows (a retry, a slow ledger) shortens its pauses further.
  while (Number.isFinite(maxGap) && maxGap > 0.3 && localTime(cast, from, to, maxGap) > duration) {
    maxGap = Math.max(0.3, maxGap * 0.8);
  }
  const events = [];
  let last = from;
  let clock = 0.001;
  for (const [t, data] of cast.events) {
    if (t <= from) events.push([0, data]);
    else if (t <= to) {
      clock += Math.min(t - last, maxGap);
      last = t;
      events.push([Number(clock.toFixed(6)), data]);
    }
  }
  if (clock > duration)
    throw new Error(`${label}: ${clock.toFixed(2)} s is longer than ${duration} s`);
  const segment = join(WORK, "cut", `${label}.cast`);
  writeFileSync(
    segment,
    [
      JSON.stringify({ version: 2, width: COLS, height: ROWS }),
      ...events.map((e) => JSON.stringify([e[0], "o", e[1]])),
    ].join("\n") + "\n",
  );
  const gif = join(WORK, "cut", `${label}.gif`);
  run("agg", [
    ...[
      "-q",
      "--font-size",
      String(FONT),
      "--line-height",
      String(LINE),
      "--theme",
      "github-light",
    ],
    ...["--fps-cap", String(FPS), "--idle-time-limit", "3600", "--last-frame-duration"],
    ...[String(Math.max(0.5, duration - clock + 0.5)), segment, gif],
  ]);
  const points = crop.map(([t, y]) => [t, y]);
  let expr = String(points.at(-1)[1]);
  for (let i = points.length - 2; i >= 0; i -= 1) {
    const [t0, y0] = points[i];
    const [t1, y1] = points[i + 1];
    const ramp = t1 > t0 ? `${y0}+(${y1 - y0})*(t-${t0})/${t1 - t0}` : String(y1);
    expr = `if(lt(t,${t0}),${y0},if(lt(t,${t1}),${ramp},${expr}))`;
  }
  const file = join(WORK, "cut", `shot-${String((shotNumber += 1)).padStart(2, "0")}.mp4`);
  run("ffmpeg", [
    ...["-v", "error", "-y", "-i", gif, "-vf"],
    `fps=${FPS},crop=${FRAME_W}:${PIC_H}:0:'${expr}',pad=${W}:${PIC_H}:5:0:color=${TERM_BG},` +
      `tpad=stop_mode=clone:stop_duration=${duration},trim=duration=${duration},setpts=PTS-STARTPTS,format=yuv420p`,
    ...["-r", String(FPS), "-c:v", "libx264", "-crf", "16", "-preset", "medium", file],
  ]);
  shots.push({ label, file, duration, caption, from, to, maxGap, rendered: clock });
}

// 6. The take.

const stamp = new Date()
  .toISOString()
  .replace(/[-:]/g, "")
  .replace(/\.\d+Z$/, "Z");
const TAKE_DIR = join(OUT, `take-${stamp}`);
const record_ = { stamp, version: VERSION };
let forbidden = [];

async function main() {
  // The fixture, built on camera.
  const create = record("fixture-create", { DEMO_MODE: "create" });
  const ids = readdirSync(join(TAKE, ".fixture"));
  if (ids.length !== 1) throw new Error("the take did not build exactly one fixture");
  const id = ids[0];
  const manifest = JSON.parse(readFileSync(join(TAKE, ".fixture", id, "manifest.json"), "utf8"));
  const keys = JSON.parse(readFileSync(join(TAKE, ".fixture", id, "keys.json"), "utf8"));
  forbidden = Object.values(keys.secrets);
  const { fixture: account, destination, sponsor } = manifest.accounts;
  Object.assign(record_, { id, account, destination, sponsor });
  log(`fixture ${id}: account ${account}`);

  // Off camera: the Appendix B checks, then Horizon's path for DUSTA (it can trail the ledger).
  const verify = run(
    "dustin",
    [
      "fixture",
      "verify",
      `.fixture/${id}/manifest.json`,
      "--snapshot",
      join(STAGE, "fixture-verification.json"),
    ],
    { cwd: TAKE, env: takeEnv() },
  );
  writeFileSync(join(STAGE, "fixture-verify.txt"), verify.stdout);
  copyFileSync(join(TAKE, ".fixture", id, "manifest.json"), join(STAGE, "fixture-manifest.json"));
  const dusta = manifest.assets.find((a) => a.code === "DUSTA");
  const pathQuery =
    `/paths/strict-send?source_asset_type=credit_alphanum12&source_asset_code=DUSTA` +
    `&source_asset_issuer=${dusta.issuer}&source_amount=${dusta.dust}&destination_assets=native`;
  for (let waited = 0; ; waited += 2) {
    const answer = await horizonGet(pathQuery);
    if ((answer.body?._embedded?.records ?? []).length > 0) break;
    if (waited > 90) throw new Error("Horizon found no strict-send path from DUSTA to XLM in 90 s");
    await sleep(2000);
  }

  // The pages before the close.
  const browser = await chromium.launch();
  const before = [
    await capturePage(browser, "before-balances", [
      { url: `${STEEXP}/account/${account}`, waitFor: "SPTA" },
      {
        url: `${HORIZON}/accounts/${account}`,
        waitFor: "balances",
        zoom: 1.4,
        scrollTo: '"balances"',
      },
    ]),
    await capturePage(browser, "before-offers", [
      { url: `${STEEXP}/account/${account}/offers`, waitFor: "Seller", settleMs: 4000 },
      {
        url: `${HORIZON}/accounts/${account}/offers`,
        waitFor: "records",
        zoom: 1.4,
        scrollTo: '"records"',
      },
    ]),
    await capturePage(browser, "before-data", [
      { url: `${HORIZON}/accounts/${account}/data/dustin.fixture`, waitFor: "value", zoom: 2.2 },
    ]),
  ];

  // The plan and the close, on camera. The keys reach the close only through .env.
  const plan = record("plan", {
    DEMO_MODE: "plan",
    DEMO_ACCOUNT: account,
    DEMO_DESTINATION: destination,
    DEMO_SPONSOR: sponsor,
  });
  if (!plan.text.includes("CLOSABLE"))
    throw new Error("the plan is not CLOSABLE; nothing was closed");
  const envFile = join(TAKE, ".env");
  let close;
  try {
    writeFileSync(
      envFile,
      `DUSTIN_ACCOUNT_SECRET=${keys.secrets.fixture}\nDUSTIN_SPONSOR_SECRET=${keys.secrets.sponsor}\n`,
      { mode: 0o600 },
    );
    close = record("close", {
      DEMO_MODE: "close",
      DEMO_ACCOUNT: account,
      DEMO_DESTINATION: destination,
      DEMO_SPONSOR: sponsor,
      DEMO_CONFIRM: destination.slice(-4),
    });
  } finally {
    rmSync(envFile, { force: true });
  }
  const hashes = [...close.text.matchAll(/submitted {2}([0-9a-f]{64})/g)].map((m) => m[1]);
  if (
    !close.text.includes("CLOSED: the account was merged") ||
    !close.text.includes("-> 404") ||
    hashes.length !== 3
  ) {
    throw new Error("the close take does not show three transactions, CLOSED and the 404");
  }
  record_.hashes = hashes;

  // Horizon's records: every transaction a fee bump from the sponsor, the account gone.
  const txs = [];
  for (const [n, hash] of hashes.entries()) {
    const answer = await horizonGet(`/transactions/${hash}`);
    const tx = answer.body;
    if (
      answer.status !== 200 ||
      tx.fee_account !== sponsor ||
      tx.source_account !== account ||
      !tx.successful
    ) {
      throw new Error(`transaction ${hash} is not a successful fee bump by the sponsor`);
    }
    txs.push(tx);
    writeFileSync(join(STAGE, `tx-${n + 1}.json`), `${JSON.stringify(tx, null, 2)}\n`);
  }
  const after = await horizonGet(`/accounts/${account}`);
  if (after.status !== 404)
    throw new Error(`Horizon answers ${after.status} for the closed account`);
  writeFileSync(
    join(STAGE, "account-after.json"),
    `${JSON.stringify({ status: 404, body: after.body }, null, 2)}\n`,
  );
  const ops = await horizonGet(`/accounts/${account}/operations?order=desc&limit=1`);
  const merge = ops.body?._embedded?.records?.[0];
  if (merge?.type !== "account_merge" || merge.transaction_hash !== txs[2].hash) {
    throw new Error("the account's last operation is not the merge of the take");
  }
  writeFileSync(join(STAGE, "operations-after.json"), `${JSON.stringify(ops.body, null, 2)}\n`);
  record_.ledgers = txs.map((t) => t.ledger);
  record_.fees = txs.map((t) => Number(t.fee_charged));

  // The pages after the close.
  const afterPages = [
    await capturePage(browser, "after-horizon-404", [
      { url: `${HORIZON}/accounts/${account}`, waitFor: "Resource Missing", zoom: 2 },
    ]),
    await capturePage(browser, "after-merge", [
      {
        url: `${HORIZON}/accounts/${account}/operations?order=desc&limit=1`,
        waitFor: "account_merge",
        zoom: 1.5,
        scrollTo: '"transaction_successful"',
      },
    ]),
  ];
  await browser.close();

  // The cut (docs/demo-video-script.md, "The 60-second cut").
  cardShot(
    "title",
    [
      { text: "Dustin", font: "Helvetica Neue", size: 120, color: "white" },
      { text: "Stellar testnet", font: "Helvetica Neue", size: 44, color: "0x9CC3DA", gap: 48 },
      { text: account, font: "Menlo", size: 38, color: "white", gap: 28 },
    ],
    5,
    "This Stellar account holds 4 XLM but cannot spend any of it, so it cannot even pay the fee to close itself.",
  );
  stillShot(
    "before-balances",
    before[0].still,
    3,
    "Before: 4 trustlines with balances, 2 open offers, 1 data entry. All 4 XLM are locked as reserve.",
  );
  stillShot("before-offers", before[1].still, 2.5, null);
  stillShot("before-data", before[2].still, 2.5, null);

  const tUnbumped = timeOf(create, "tx_insufficient_balance");
  const unbumpedRow = rowOf(create, tUnbumped, /Unbumped transaction/);
  terminalShot(
    "unsponsored",
    create,
    { from: tUnbumped, to: tUnbumped },
    [[0, yForRow(Math.max(0, unbumpedRow - 20))]],
    3,
    "Without a sponsor, the account cannot pay a fee: the fixture builder's own unsponsored attempt is rejected.",
  );

  const pStart = timeOf(plan, "d") - 0.3;
  const pOut = timeOf(plan, "Dustin plan");
  const pEnd = plan.events.at(-1)[0];
  const pOutLocal = localTime(plan, pStart, pOut, 1.0) + 0.1;
  const stepsY = yForRow(Math.max(0, rowOf(plan, pEnd, /^ {2}S0[3-5] /) - 1));
  terminalShot(
    "plan",
    plan,
    { from: pStart, to: pEnd, maxGap: 1.0 },
    [
      [0, 0],
      [pOutLocal, 0],
      [pOutLocal, stepsY],
      [pOutLocal + 3.4, stepsY],
      [pOutLocal + 4.9, Y_BOTTOM],
    ],
    10,
    "The plan is read-only. Every step has a reason. Nothing is signed yet.",
  );

  const cStart = timeOf(close, "d") - 0.2;
  const cTyped = timeOf(close, "\n", cStart + 0.5);
  const cQuestion = timeOf(close, "to confirm: ");
  const cAnswered = timeOf(close, "\n", cQuestion + 1);
  const cReceipt = timeOf(close, "Dustin close receipt");
  const cEnd = close.events.at(-1)[0];
  // Shot 5 is five seconds: the end of the typed command, then the confirmation block, the
  // four characters typed at their own speed and Enter.
  const confirmGap = 1.2;
  const confirmLength = localTime(close, cQuestion - 0.05, cAnswered + 0.3, confirmGap) + 0.05;
  const commandLength = Math.max(1, Math.min(5 - confirmLength, cTyped + 0.3 - cStart));
  terminalShot(
    "close-command",
    close,
    { from: cTyped + 0.3 - commandLength, to: cTyped + 0.3 },
    [[0, 0]],
    commandLength,
    "To run it, you confirm the destination.",
  );
  terminalShot(
    "confirmation",
    close,
    { from: cQuestion - 0.05, to: cAnswered + 0.3, maxGap: confirmGap },
    [[0, Y_BOTTOM]],
    5 - commandLength,
    null,
  );
  terminalShot(
    "execution",
    close,
    { from: cAnswered + 0.3, to: cReceipt - 0.02, maxGap: 1.5, fill: true },
    [[0, Y_BOTTOM]],
    13,
    "Three transactions. Every fee is paid by the sponsor. The account pays nothing.",
  );
  const headRow = rowOf(close, cEnd, /^Dustin close receipt/, 1);
  const resultRow = rowOf(close, cEnd, /^Result$/, headRow + 30);
  terminalShot(
    "receipt",
    close,
    { from: cReceipt - 0.02, to: cEnd },
    [
      [0, Y_BOTTOM],
      [0.3, yForRow(Math.max(0, headRow - 1))],
      [1.9, yForRow(Math.max(0, headRow - 1))],
      [3.0, yForRow(resultRow - 3)],
    ],
    5,
    "Result: 4 XLM arrived at the destination. Fees paid by the account: zero.",
  );
  stillShot(
    "after-horizon-404",
    afterPages[0].still,
    3.5,
    "After: the account no longer exists. Anyone can check this link.",
  );
  stillShot("after-merge", afterPages[1].still, 3.5, null);
  cardShot(
    "end",
    [
      { text: "Dustin", font: "Helvetica Neue", size: 96, color: "white" },
      {
        text: REPOSITORY.replace("https://", ""),
        font: "Helvetica Neue",
        size: 44,
        color: "0x9CC3DA",
        gap: 40,
      },
      ...hashes.map((h, i) => ({
        text: `tx ${i + 1}  ${h}`,
        font: "Menlo",
        size: 28,
        color: "white",
        gap: i === 0 ? 40 : 16,
      })),
      { text: "testnet only", font: "Helvetica Neue", size: 44, color: "0xF2C14E", gap: 48 },
    ],
    3.8,
    "Dustin. Read the plan, then close the account. Testnet only.",
  );

  // Captions: one per shot group, burned in on the band and as an .srt sidecar.
  let t = 0;
  const cues = [];
  for (const s of shots) {
    if (s.caption) cues.push({ start: t, end: t + s.duration, text: s.caption });
    else cues.at(-1).end = t + s.duration;
    s.start = t;
    t += s.duration;
  }
  const total = t;
  if (total > 60) throw new Error(`the cut is ${total.toFixed(2)} s, over 60 s`);
  const srtTime = (x) => {
    const ms = Math.round(x * 1000);
    const hh = String(Math.floor(ms / 3_600_000)).padStart(2, "0");
    const mm = String(Math.floor(ms / 60_000) % 60).padStart(2, "0");
    const ss = String(Math.floor(ms / 1000) % 60).padStart(2, "0");
    return `${hh}:${mm}:${ss},${String(ms % 1000).padStart(3, "0")}`;
  };
  const assTime = (x) => {
    const cs = Math.round(x * 100);
    return `${Math.floor(cs / 360000)}:${String(Math.floor(cs / 6000) % 60).padStart(2, "0")}:${String(Math.floor(cs / 100) % 60).padStart(2, "0")}.${String(cs % 100).padStart(2, "0")}`;
  };
  const srt = cues
    .map((c, i) => `${i + 1}\n${srtTime(c.start)} --> ${srtTime(c.end)}\n${c.text}\n`)
    .join("\n");
  const ass = [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${W}`,
    `PlayResY: ${H}`,
    "WrapStyle: 0",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    "Style: Band,Helvetica Neue,40,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,8,60,60,36,1",
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ...cues.map((c) => `Dialogue: 0,${assTime(c.start)},${assTime(c.end)},Band,,0,0,0,,${c.text}`),
    "",
  ].join("\n");
  const assFile = join(WORK, "cut", "captions.ass");
  writeFileSync(assFile, ass);
  writeFileSync(join(STAGE, "dustin-demo.srt"), srt);

  // Join the shots, add the band and burn the captions.
  const list = join(WORK, "cut", "shots.txt");
  writeFileSync(list, shots.map((s) => `file '${s.file}'`).join("\n") + "\n");
  const mp4 = join(STAGE, "dustin-demo-60s.mp4");
  run("ffmpeg", [
    ...["-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", list, "-vf"],
    `pad=${W}:${H}:0:${BAND}:color=0x0B0F14,ass=${assFile},format=yuv420p`,
    ...[
      "-r",
      String(FPS),
      "-c:v",
      "libx264",
      "-crf",
      "18",
      "-preset",
      "slow",
      "-movflags",
      "+faststart",
      mp4,
    ],
  ]);
  const probe = JSON.parse(
    run("ffprobe", ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", mp4])
      .stdout,
  );
  const video = probe.streams.find((s) => s.codec_type === "video");
  record_.duration = Number(probe.format.duration);
  record_.size = [video.width, video.height];
  if (record_.duration > 60 || video.width !== W || video.height !== H) {
    throw new Error(`the video is ${video.width}x${video.height}, ${record_.duration} s`);
  }
  record_.sha256 = createHash("sha256").update(readFileSync(mp4)).digest("hex");
  record_.bytes = readFileSync(mp4).length;

  // Key frames, from the finished video.
  const frames = [
    ["01-before-balances", "before-balances"],
    ["02-plan", "plan"],
    ["03-confirmation", "confirmation"],
    ["04-transactions", "execution"],
    ["05-receipt", "receipt"],
    ["06-horizon-404", "after-horizon-404"],
    ["07-merge-operation", "after-merge"],
  ];
  for (const [name, label] of frames) {
    const s = shots.find((x) => x.label === label);
    const at = label === "confirmation" ? s.start + s.duration - 0.2 : s.start + s.duration - 0.3;
    run("ffmpeg", [
      "-v",
      "error",
      "-y",
      "-ss",
      at.toFixed(3),
      "-i",
      mp4,
      "-frames:v",
      "1",
      join(STAGE, "frames", `${name}.png`),
    ]);
  }

  // The GIF: the close from the confirmation to the receipt, waits shortened.
  const gifCast = join(WORK, "cut", "gif.cast");
  const gifEvents = [];
  let last = cQuestion - 1.5;
  let clock = 0.001;
  for (const [time, data] of close.events) {
    if (time <= cQuestion - 1.5) gifEvents.push([0, data]);
    else {
      clock += Math.min(time - last, 0.9);
      last = time;
      gifEvents.push([Number(clock.toFixed(6)), data]);
    }
  }
  writeFileSync(
    gifCast,
    [
      JSON.stringify({ version: 2, width: COLS, height: ROWS }),
      ...gifEvents.map((e) => JSON.stringify([e[0], "o", e[1]])),
    ].join("\n") + "\n",
  );
  run("agg", [
    ...[
      "-q",
      "--font-size",
      "13",
      "--line-height",
      "1.25",
      "--theme",
      "github-light",
      "--rows",
      "44",
    ],
    ...[
      "--fps-cap",
      "12",
      "--idle-time-limit",
      "3600",
      "--last-frame-duration",
      "5",
      gifCast,
      join(STAGE, "dustin-demo.gif"),
    ],
  ]);

  // The recordings, with a header that names nothing local.
  for (const [name, cast] of [
    ["fixture-create", create],
    ["plan", plan],
    ["close", close],
  ]) {
    const header = {
      version: 2,
      width: COLS,
      height: ROWS,
      timestamp: cast.header.timestamp,
      title: `dustin demo take: ${name}`,
    };
    const lines = [
      JSON.stringify(header),
      ...cast.events.map(([time, data]) => JSON.stringify([time, "o", data])),
    ];
    writeFileSync(join(STAGE, `${name}.cast`), `${lines.join("\n")}\n`);
  }
  record_.shots = shots.map((s) => ({
    label: s.label,
    start: s.start,
    duration: s.duration,
    caption: s.caption,
    ...(s.from !== undefined
      ? { recording: { from: s.from, to: s.to, maxGap: s.maxGap, rendered: s.rendered } }
      : {}),
  }));
  record_.pages = [...before, ...afterPages].map((p) => p.url);
  record_.frames = frames.map(([name]) => `${name}.png`);
  record_.buildHashes = (manifest.transactions ?? []).map((x) => [
    x.step ?? x.purpose,
    x.hash,
    x.ledger,
  ]);
  writeFileSync(join(STAGE, "take.json"), `${JSON.stringify(record_, null, 2)}\n`);
  writeFileSync(join(STAGE, "summary.md"), summary(record_));

  // Scan every text file, then publish.
  for (const name of readdirSync(STAGE)) {
    const path = join(STAGE, name);
    if (/\.(cast|json|txt|srt|md)$/.test(name))
      scanned(name, readFileSync(path, "utf8"), forbidden);
  }
  mkdirSync(join(TAKE_DIR, "frames"), { recursive: true });
  for (const name of readdirSync(STAGE)) {
    const from = join(STAGE, name);
    if (name === "frames") {
      for (const f of readdirSync(from)) copyFileSync(join(from, f), join(TAKE_DIR, "frames", f));
    } else if (
      name === "dustin-demo-60s.mp4" ||
      name === "dustin-demo.gif" ||
      name === "dustin-demo.srt"
    ) {
      copyFileSync(from, join(OUT, name));
    } else copyFileSync(from, join(TAKE_DIR, name));
  }
  // The fixture's keys stay with the others, in the repository's ignored .fixture/.
  mkdirSync(join(ROOT, ".fixture"), { recursive: true, mode: 0o700 });
  cpSync(join(TAKE, ".fixture", id), join(ROOT, ".fixture", id), { recursive: true });
  chmodSync(join(ROOT, ".fixture", id, "keys.json"), 0o600);
  log(
    `video: evidence/demo/dustin-demo-60s.mp4, ${record_.duration.toFixed(2)} s, sha256 ${record_.sha256}`,
  );
  log(`take: ${relative(ROOT, TAKE_DIR)}/summary.md`);
}

/** The record of the take, as the evidence package's run summaries are written. */
function summary(r) {
  const ex = (kind, id) => `https://stellar.expert/explorer/testnet/${kind}/${id}`;
  const hz = (kind, id) => `${HORIZON}/${kind}/${id}`;
  const rows = r.shots
    .map((s) => {
      const where = s.recording
        ? `recording seconds ${s.recording.from.toFixed(2)} to ${s.recording.to.toFixed(2)}${Number.isFinite(s.recording.maxGap) ? `, pauses over ${s.recording.maxGap} s shortened` : ""}`
        : "still";
      return `| ${s.start.toFixed(1)} to ${(s.start + s.duration).toFixed(1)} s | ${s.label} | ${where} | ${s.caption ?? "(the caption above continues)"} |`;
    })
    .join("\n");
  return `# Demo take ${r.stamp}

The take behind the 60-second demo video (story E4-S6), produced by \`node scripts/demo/make-demo.mjs\` from the rehearsal script [\`docs/demo-video-script.md\`](../../../docs/demo-video-script.md) on a fresh \`messy\` fixture, on the Stellar testnet, with \`dustin\` ${r.version}. Every terminal shot is cut from the three recordings in this directory; nothing in them was typed or printed by anything but the shell and the CLI.

## Accounts

| Role | Address | Links |
|---|---|---|
| Closed account (fixture \`${r.id}\`) | \`${r.account}\` | [explorer](${ex("account", r.account)}), [Horizon](${hz("accounts", r.account)}) (404 after the close) |
| Destination | \`${r.destination}\` | [explorer](${ex("account", r.destination)}), [Horizon](${hz("accounts", r.destination)}) |
| Fee sponsor (fee account of every transaction) | \`${r.sponsor}\` | [explorer](${ex("account", r.sponsor)}), [Horizon](${hz("accounts", r.sponsor)}) |

## The close shown in the video

| # | Hash (the fee bump's) | Ledger | Fee charged to the sponsor | Links |
|---|---|---|---|---|
${r.hashes.map((h, i) => `| ${i + 1} | \`${h}\` | ${r.ledgers[i]} | ${r.fees[i].toLocaleString("en-US")} stroops | [explorer](${ex("tx", h)}), [Horizon](${hz("transactions", h)}), [record](tx-${i + 1}.json) |`).join("\n")}

Checked by the script before it wrote anything: each transaction succeeded with \`fee_account\` the sponsor and \`source_account\` the closed account ([\`tx-1.json\`](tx-1.json) to [\`tx-3.json\`](tx-3.json)); Horizon answers 404 for the account ([\`account-after.json\`](account-after.json)); its last operation is the merge of transaction 3 ([\`operations-after.json\`](operations-after.json)). The fixture met SOW Appendix B right before the take: [\`fixture-verify.txt\`](fixture-verify.txt), [\`fixture-verification.json\`](fixture-verification.json); its build is in [\`fixture-manifest.json\`](fixture-manifest.json) and on camera in [\`fixture-create.cast\`](fixture-create.cast).

## The fixture's build, on camera

| Step | Ledger | Hash |
|---|---|---|
${r.buildHashes.map(([step, hash, ledger]) => `| ${step} | ${ledger} | [\`${hash}\`](${ex("tx", hash)}) |`).join("\n")}

## The video

| Field | Value |
|---|---|
| File | \`evidence/demo/dustin-demo-60s.mp4\` (not in git; hosted as a release asset once the builder uploads it) |
| Duration | ${r.duration.toFixed(2)} s |
| Size | ${r.size.join(" x ")}, H.264, ${FPS} frames per second, no sound |
| SHA-256 | \`${r.sha256}\` |
| Captions | burned in on a band at the top, and [\`dustin-demo.srt\`](../dustin-demo.srt) |

## The cut

| Time | Shot | Source | Caption |
|---|---|---|---|
${rows}

The browser pages, each captured with Playwright (Chromium) when the cut above shows it, under a strip that names its URL (they are not links here: after the close the account's pages on Horizon answer 404):

\`\`\`text
${r.pages.join("\n")}
\`\`\`

The key frames, taken from the finished video: ${r.frames.map((f) => `[\`${f}\`](frames/${f})`).join(", ")}.

## Recordings

[\`fixture-create.cast\`](fixture-create.cast), [\`plan.cast\`](plan.cast) and [\`close.cast\`](close.cast) are asciicast v2 files (https://docs.asciinema.org/manual/asciicast/v2/): every byte the terminal showed, with its time. \`asciinema play close.cast\` replays the close as it ran, the typed confirmation included; the commands' secrets came from a \`.env\` file written right before the close and removed right after it, and appear nowhere.
`;
}

try {
  await main();
  if (!KEEP_WORK) rmSync(WORK, { recursive: true, force: true });
} catch (error) {
  log(`stopped: ${error instanceof Error ? error.message : String(error)}`);
  log(`the work directory is kept for inspection (it holds the fixture's keys): ${WORK}`);
  process.exitCode = 1;
}
