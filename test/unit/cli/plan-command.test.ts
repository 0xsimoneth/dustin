import { StrKey } from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";
import { run } from "../../../src/cli/run.js";
import { MESSY_DIR, loadRecorded, recordedFetch } from "../../helpers/recorded-horizon.js";
import { messy } from "../../helpers/snapshots.js";

const recorded = loadRecorded(MESSY_DIR);

async function cli(
  args: string[],
  deps: {
    fetch?: (url: string, init?: RequestInit) => Promise<Response>;
    env?: Record<string, string>;
  } = {},
) {
  const out: string[] = [];
  const err: string[] = [];
  const code = await run(
    ["node", "dustin", ...args],
    { stdout: (s) => void out.push(s), stderr: (s) => void err.push(s) },
    "0.0.0",
    {
      env: deps.env ?? {},
      fetch: deps.fetch ?? recordedFetch(recorded).fetch,
      horizon: { retries: 0, backoffMs: 0 },
    },
  );
  return { code, out: out.join(""), err: err.join("") };
}

describe("dustin plan", () => {
  it("prints the fixture plan and exits 0", async () => {
    const r = await cli([
      "plan",
      messy.fixture,
      "--to",
      messy.destination,
      "--sponsor",
      messy.sponsor,
      "--base-fee",
      "100",
    ]);
    expect(r.err).toBe("");
    expect(r.code).toBe(0);
    for (const needle of [
      "dry run: nothing is signed, nothing is submitted",
      "CLOSABLE",
      "spendable 0.0000000 XLM",
      "cancel offer 826680",
      "return 0.0000003 DUSTB to issuer",
      "sell 0.0000007 DUSTA for XLM",
      "remove trustline SPTA (reserve sponsored by",
      'delete data entry "dustin.fixture"',
      "merge into",
      "4.0000007 XLM arrives at",
      "0.5000000 XLM reserve unlocked for sponsor",
      "Next: dustin close",
    ]) {
      expect(r.out, needle).toContain(needle);
    }
    for (const line of r.out.split("\n")) expect(line.length, line).toBeLessThanOrEqual(120);
    expect(r.out.includes(String.fromCharCode(27))).toBe(false); // no ANSI colour codes
  });

  it("prints exactly the plan JSON with --json", async () => {
    const r = await cli(["plan", messy.fixture, "--to", messy.destination, "--json"]);
    expect(r.code).toBe(0);
    const plan = JSON.parse(r.out) as { kind: string; status: string; steps: unknown[] };
    expect(plan).toMatchObject({ kind: "dustin-close-plan", status: "closable" });
    expect(plan.steps).toHaveLength(12);
  });

  it("accepts --destination as the alias of --to", async () => {
    const r = await cli(["plan", messy.fixture, "--destination", messy.destination, "--json"]);
    expect(r.code).toBe(0);
  });

  it("exits 0 for a partial plan too, and shows the unclosable item", async () => {
    const acc = structuredClone(recorded.get(`/accounts/${messy.fixture}`)) as {
      balances: Record<string, unknown>[];
    };
    const dustb = acc.balances.find((b) => b.asset_code === "DUSTB")!;
    Object.assign(dustb, { is_authorized: false, is_authorized_to_maintain_liabilities: false });
    const r = await cli(["plan", messy.fixture, "--to", messy.destination], {
      fetch: recordedFetch(recorded, { [`/accounts/${messy.fixture}`]: acc }).fetch,
    });
    expect(r.code).toBe(0);
    expect(r.out).toContain("PARTIAL");
    expect(r.out).toContain("TRUSTLINE_NOT_AUTHORIZED");
    expect(r.out).toContain("remedy:");
  });

  it("refuses bad input with exit 2", async () => {
    expect((await cli(["plan", messy.fixture])).code).toBe(2);
    expect((await cli(["plan", "GABC", "--to", messy.destination])).code).toBe(2);
    const contract = StrKey.encodeContract(Buffer.alloc(32, 3));
    const c = await cli(["plan", contract, "--to", messy.destination]);
    expect(c.code).toBe(2);
    expect(c.err).toContain("CONTRACT_ACCOUNT");
    expect(
      (await cli(["--network", "public", "plan", messy.fixture, "--to", messy.destination])).code,
    ).toBe(2);
  });

  it("exits 6 when Horizon is unreachable", async () => {
    const down = () => Promise.reject(new Error("ECONNREFUSED"));
    const r = await cli(["plan", messy.fixture, "--to", messy.destination], { fetch: down });
    expect(r.code).toBe(6);
    expect(r.err).toContain("HORIZON_UNAVAILABLE");
  });

  it("never reads a secret from the environment", async () => {
    const seed = "S" + "A".repeat(55);
    const r = await cli(["plan", messy.fixture, "--to", messy.destination], {
      env: { DUSTIN_ACCOUNT_SECRET: seed, DUSTIN_SPONSOR_SECRET: seed },
    });
    expect(r.code).toBe(0);
    expect(r.out + r.err).not.toContain(seed);
  });
});

describe("dustin close without --execute", () => {
  it("prints the same plan and the next step, and executes nothing", async () => {
    const plan = await cli(["plan", messy.fixture, "--to", messy.destination]);
    const close = await cli(["close", messy.fixture, "--to", messy.destination]);
    expect(close.code).toBe(0);
    expect(close.out).toContain(plan.out.split("Next:")[0]!.trim().split("\n")[0]!);
    expect(close.out).toContain("Next: add --execute to run this plan");
  });
});
