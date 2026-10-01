import { execFile } from "node:child_process";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { closeCommand, planCommand } from "../src/commands";
import { EXAMPLE } from "../src/example";
import type { PlanInputs } from "../src/inputs";
import { planInBrowser } from "../src/plan";
import { answerFor, loadRecorded, recordedFetch } from "./helpers/recorded";

/**
 * The page against the CLI (E5-S1 review, W10): the plan the page computes for the recorded
 * fixture is the plan `dustin plan --json` prints for it, hash for hash and field for field, and
 * every flag the "Run it yourself" box prints is one the CLI's `--help` lists. The CLI is the
 * built one (../dist/cli/main.js, so the root is built first, as the page itself needs), pointed
 * by DUSTIN_HORIZON_URL at a local server that answers from the same recorded fixtures the page's
 * tests use; nothing leaves the machine.
 */

const CLI = fileURLToPath(new URL("../../dist/cli/main.js", import.meta.url));
const recorded = loadRecorded();
const execFileAsync = promisify(execFile);

const inputs: PlanInputs = {
  account: EXAMPLE.account,
  destination: EXAMPLE.destination,
  sponsor: EXAMPLE.sponsor,
  allowPartial: true,
  preferDestination: true,
};

/**
 * The CLI as a child process, run asynchronously: a synchronous spawn would block this worker's
 * event loop, and with it the replay server the CLI is talking to.
 */
async function cli(args: string[], env: Record<string, string> = {}) {
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [CLI, ...args], {
      encoding: "utf8",
      env: { ...process.env, NO_COLOR: "1", ...env },
      timeout: 60_000,
      maxBuffer: 16 * 1024 * 1024,
    });
    return { status: 0, stdout, stderr };
  } catch (error) {
    const failed = error as { code?: unknown; stdout?: string; stderr?: string };
    return {
      status: typeof failed.code === "number" ? failed.code : -1,
      stdout: failed.stdout ?? "",
      stderr: failed.stderr ?? String(error),
    };
  }
}

/** The flags of a command line, in order, each once. */
const flagsOf = (text: string) => [...new Set(text.match(/(?<=\s)--[a-z][a-z-]*/g) ?? [])];

describe("the page and the CLI agree", () => {
  let server: Server;
  let horizonUrl = "";

  beforeAll(async () => {
    server = createServer((request, response) => {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      const answer = answerFor(recorded, url.pathname + url.search);
      response.writeHead(answer.status, { "content-type": "application/hal+json; charset=utf-8" });
      response.end(JSON.stringify(answer.body));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    horizonUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(
    () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  );
  afterEach(() => vi.unstubAllGlobals());

  it("the page's plan is the CLI's --json plan for the recorded fixture, planHash included", async () => {
    vi.stubGlobal("fetch", recordedFetch(recorded).fetch);
    const pagePlan = await planInBrowser({
      ...inputs,
      allowPartial: false,
      preferDestination: false,
    });

    const run = await cli(
      [
        "plan",
        EXAMPLE.account,
        "--to",
        EXAMPLE.destination,
        "--sponsor",
        EXAMPLE.sponsor,
        "--json",
      ],
      { DUSTIN_HORIZON_URL: horizonUrl },
    );
    expect(run.status, run.stderr).toBe(0);
    const cliPlan = JSON.parse(run.stdout) as {
      kind: string;
      planHash: string;
      network: { horizon: string };
    };
    expect(cliPlan.kind).toBe("dustin-close-plan");
    expect(cliPlan.planHash).toMatch(/^[0-9a-f]{64}$/);
    expect(pagePlan.planHash).toBe(cliPlan.planHash);
    // Not only the hash: the whole document, as JSON, but for the Horizon each one asked (the
    // replay server here, the testnet Horizon in the page), which the plan records and the hash
    // leaves out.
    expect(cliPlan.network.horizon).toBe(horizonUrl);
    expect(pagePlan.network.horizon).toBe("https://horizon-testnet.stellar.org");
    const pageDocument = JSON.parse(JSON.stringify(pagePlan)) as { network: { horizon: string } };
    pageDocument.network.horizon = horizonUrl;
    expect(pageDocument).toEqual(cliPlan);
  });

  it("every flag the Run-it-yourself box prints is one the CLI's --help lists", async () => {
    const planFlags = flagsOf(planCommand(inputs));
    const closeFlags = flagsOf(closeCommand(inputs));
    expect(planFlags).toEqual(["--to", "--sponsor", "--prefer-destination"]);
    expect(closeFlags).toEqual([
      "--to",
      "--sponsor",
      "--execute",
      "--partial",
      "--prefer-destination",
    ]);
    const planHelp = await cli(["plan", "--help"]);
    const closeHelp = await cli(["close", "--help"]);
    expect(planHelp.status).toBe(0);
    expect(closeHelp.status).toBe(0);
    // Commander lists each option at the start of its own line: "  --to <destination>  ...".
    const lists = (help: string, flag: string) => new RegExp(`^\\s*${flag}(?=\\s)`, "m").test(help);
    for (const flag of planFlags) expect(lists(planHelp.stdout, flag), `plan ${flag}`).toBe(true);
    for (const flag of closeFlags) {
      expect(lists(closeHelp.stdout, flag), `close ${flag}`).toBe(true);
    }
  });
});
