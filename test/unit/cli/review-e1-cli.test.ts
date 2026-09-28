import { Keypair, StrKey } from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";
import { run } from "../../../src/cli/run.js";
import { inspectAccount } from "../../../src/inspect/inspect.js";
import { horizonJson } from "../../../src/reader/horizon-json.js";
import { horizonReader } from "../../../src/reader/ledger-reader.js";
import {
  MESSY_DIR,
  TESTNET_HORIZON,
  loadRecorded,
  recordedFetch,
} from "../../helpers/recorded-horizon.js";
import { messy } from "../../helpers/snapshots.js";

const recorded = loadRecorded(MESSY_DIR);

async function cli(
  args: string[],
  env: Record<string, string | undefined> = {},
  overrides: Record<string, unknown> = {},
) {
  const out: string[] = [];
  const err: string[] = [];
  const code = await run(
    ["node", "dustin", ...args],
    { stdout: (s) => void out.push(s), stderr: (s) => void err.push(s) },
    "0.0.0",
    { env, fetch: recordedFetch(recorded, overrides).fetch, horizon: { retries: 0 } },
  );
  return { code, out: out.join(""), err: err.join("") };
}

const planArgs = ["plan", messy.fixture, "--to", messy.destination];

describe("CLI review fixes", () => {
  it("refuses a malformed --base-fee with exit 2", async () => {
    for (const bad of ["1e6", "0x10", "12.9", "-5", "abc", "50", "2000000"]) {
      const r = await cli([...planArgs, "--base-fee", bad]);
      expect(r.code, bad).toBe(2);
      expect(r.err).toContain("CONFIG_INVALID");
    }
    expect((await cli([...planArgs, "--base-fee", "250"])).code).toBe(0);
  });

  it("refuses a memo longer than 28 bytes", async () => {
    const r = await cli([...planArgs, "--memo", "x".repeat(29)]);
    expect(r.code).toBe(2);
  });

  it("suggests --partial for a partial plan and carries --memo into the next command", async () => {
    const acc = structuredClone(recorded.get(`/accounts/${messy.fixture}`)) as {
      balances: Record<string, unknown>[];
    };
    Object.assign(
      acc.balances.find((b) => b.asset_code === "DUSTB")!,
      { is_authorized: false, is_authorized_to_maintain_liabilities: false },
    );
    const partial = await cli(planArgs, {}, { [`/accounts/${messy.fixture}`]: acc });
    expect(partial.out).toContain("--execute --partial");
    const withMemo = await cli([...planArgs, "--memo", "42"]);
    expect(withMemo.out).toContain('--memo "42" --execute');
  });

  it("never reads a secret variable while planning", async () => {
    const env = new Proxy<Record<string, string | undefined>>(
      {},
      {
        get(_target, key) {
          if (typeof key === "string" && /SECRET/.test(key)) throw new Error(`plan read ${key}`);
          return undefined;
        },
      },
    );
    const r = await cli(planArgs, env);
    expect(r.err).toBe("");
    expect(r.code).toBe(0);
  });

  it("prints the same plan for close without --execute", async () => {
    const plan = await cli(planArgs);
    const close = await cli(["close", messy.fixture, "--to", messy.destination]);
    const body = (text: string) => text.split("\nNext:")[0];
    expect(body(close.out)).toBe(body(plan.out));
  });

  it("keeps fixture verify within 120 columns", async () => {
    const r = await cli(["fixture", "verify", `${MESSY_DIR}/manifest.json`]);
    expect(r.code).toBe(0);
    for (const line of r.out.split("\n")) expect(line.length, line).toBeLessThanOrEqual(120);
  });
});

describe("muxed destinations", () => {
  it("are exempt from SEP-29, like the SDK's own check", async () => {
    const dest = structuredClone(recorded.get(`/accounts/${messy.destination}`)) as {
      data: Record<string, string>;
    };
    dest.data["config.memo_required"] = "MQ==";
    const reader = horizonReader(
      horizonJson(TESTNET_HORIZON, {
        fetch: recordedFetch(recorded, { [`/accounts/${messy.destination}`]: dest }).fetch,
        retries: 0,
      }),
    );
    const muxed = StrKey.encodeMed25519PublicKey(
      Buffer.concat([
        Buffer.from(StrKey.decodeEd25519PublicKey(messy.destination)),
        Buffer.alloc(8, 9),
      ]),
    );
    const s = await inspectAccount(messy.fixture, { destination: muxed, reader });
    expect(s.destination?.memoRequired).toBe(false);
    const g = await inspectAccount(messy.fixture, { destination: messy.destination, reader });
    expect(g.destination?.memoRequired).toBe(true);
    void Keypair;
  });
});
