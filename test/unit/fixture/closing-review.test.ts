import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { run } from "../../../src/cli/run.js";
import { TESTNET_PASSPHRASE } from "../../../src/config/network.js";
import { DustinError } from "../../../src/errors/dustin-error.js";
import { buildMessyFixture } from "../../../src/fixture/builder.js";
import { buildEdgeFixture } from "../../../src/fixture/edge-builder.js";
import { readAnyManifest } from "../../../src/fixture/manifest.js";
import { EDGE_DIR } from "../../helpers/edge-ledger.js";
import { noSleep } from "../../helpers/no-sleep.js";
import { MESSY_DIR } from "../../helpers/recorded-horizon.js";

// The closing review of 2026-09-28, fixture half (findings CP-8 to CP-14 of the edge case hunt):
// every test here failed on the code before its fix.

const HORIZON = "https://horizon-testnet.stellar.org";
const FRIENDBOT = "https://friendbot.test";

const passphrase = () =>
  Promise.resolve(new Response(JSON.stringify({ network_passphrase: TESTNET_PASSPHRASE })));
const answer = (status: number, body: unknown = {}) =>
  Promise.resolve(new Response(JSON.stringify(body), { status }));

function capture() {
  const out: string[] = [];
  return {
    io: { stdout: (s: string) => void out.push(s), stderr: (s: string) => void out.push(s) },
    text: () => out.join(""),
  };
}

/** A manifest as loose JSON, so a test can break any part of it. */
type Loose = Record<string, unknown> & {
  accounts: Record<string, unknown>;
  network?: Record<string, unknown>;
  pool?: Record<string, unknown>;
};
const loadManifest = (dir: string) =>
  JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8")) as Loose;
function writeManifest(m: unknown): string {
  const path = join(mkdtempSync(join(tmpdir(), "dustin-")), "manifest.json");
  writeFileSync(path, JSON.stringify(m));
  return path;
}

describe("CP-12: an async onKeys has stored the keys before any account is funded", () => {
  /** Horizon serves the testnet; Friendbot answers `friendbotStatus`; every other read fails with 400. */
  function world(friendbotStatus: number) {
    const seen: string[] = [];
    const fetch = (url: string) => {
      seen.push(url);
      if (url === `${HORIZON}/`) return passphrase();
      if (url.startsWith(FRIENDBOT)) return answer(friendbotStatus);
      return answer(400, { status: 400 });
    };
    const friendbotCalls = () => seen.filter((u) => u.startsWith(FRIENDBOT)).length;
    return { fetch, friendbotCalls };
  }
  const later = () => new Promise((resolve) => setTimeout(resolve, 20));

  it("edge: Friendbot is called only once the store has finished", async () => {
    const w = world(500);
    let callsWhenStored = -1;
    const error = await buildEdgeFixture({
      fetch: w.fetch,
      friendbotUrl: FRIENDBOT,
      sleep: noSleep,
      onKeys: async () => {
        await later();
        callsWhenStored = w.friendbotCalls();
      },
    }).catch((e: unknown) => e);
    expect((error as DustinError).code).toBe("FRIENDBOT_FAILED");
    expect(callsWhenStored).toBe(0);
  });

  it("edge: a store that fails stops the build before Friendbot, with the store's error", async () => {
    const w = world(200);
    const error = await buildEdgeFixture({
      fetch: w.fetch,
      friendbotUrl: FRIENDBOT,
      sleep: noSleep,
      onKeys: async () => {
        await later();
        throw new Error("disk full");
      },
    }).catch((e: unknown) => e);
    expect((error as Error).message).toBe("disk full");
    expect(w.friendbotCalls()).toBe(0);
  });

  it("messy: Friendbot is called only once the store has finished", async () => {
    const w = world(200);
    let callsWhenStored = -1;
    const error = await buildMessyFixture({
      fetch: w.fetch,
      friendbotUrl: FRIENDBOT,
      onKeys: async () => {
        await later();
        callsWhenStored = w.friendbotCalls();
      },
    }).catch((e: unknown) => e);
    // Funded, then stopped by the first Horizon read after Friendbot (HTTP 400).
    expect((error as DustinError).code).toBe("HORIZON_UNAVAILABLE");
    expect(w.friendbotCalls()).toBe(1);
    expect(callsWhenStored).toBe(0);
  });

  it("messy: a store that fails stops the build before Friendbot, with the store's error", async () => {
    const w = world(200);
    const error = await buildMessyFixture({
      fetch: w.fetch,
      friendbotUrl: FRIENDBOT,
      onKeys: () => Promise.reject(new Error("disk full")),
    }).catch((e: unknown) => e);
    expect((error as Error).message).toBe("disk full");
    expect(w.friendbotCalls()).toBe(0);
  });
});

describe("CP-13: settleTimeoutMs is a finite number of milliseconds, at least 0", () => {
  it("refuses NaN, Infinity and a negative bound before any request", async () => {
    // With NaN, `Date.now() > deadline` is never true, so a check that never passes would poll
    // Horizon forever.
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, -1]) {
      const seen: string[] = [];
      const error = await buildEdgeFixture({
        fetch: (url) => {
          seen.push(url);
          return passphrase();
        },
        settleTimeoutMs: bad,
        sleep: noSleep,
      }).catch((e: unknown) => e);
      expect((error as DustinError).code, String(bad)).toBe("CONFIG_INVALID");
      expect((error as DustinError).message).toContain("settleTimeoutMs");
      expect(seen, String(bad)).toEqual([]);
    }
  });

  it("accepts 0, a bound rather than a pause: the build goes on to the testnet check", async () => {
    const seen: string[] = [];
    await buildEdgeFixture({
      fetch: (url) => {
        seen.push(url);
        return answer(400, { status: 400 });
      },
      settleTimeoutMs: 0,
      sleep: noSleep,
    }).catch((e: unknown) => e);
    expect(seen[0]).toBe(`${HORIZON}/`);
  });
});

describe("CP-14: a fixture manifest is checked before anything reads Horizon", () => {
  const code = (path: string) => {
    try {
      readAnyManifest(path);
      return "valid";
    } catch (error) {
      return (error as DustinError).code;
    }
  };

  it("edge: every role, the multisig signer, the passphrase and the pool id", () => {
    const broken: Array<[string, (m: Loose) => void]> = [
      ["a missing role", (m) => delete m.accounts.authMaintain],
      ["a role that is not a public key", (m) => (m.accounts.claimable = "GABC")],
      ["a missing multisig signer", (m) => delete m.multisigSigner],
      ["a multisig signer that is not a public key", (m) => (m.multisigSigner = "signer")],
      ["a missing network", (m) => delete m.network],
      ["a network without a passphrase", (m) => delete m.network!.passphrase],
      ["a pool id that is not 64 hex digits", (m) => (m.pool!.id = "8755c9")],
    ];
    for (const [name, change] of broken) {
      const m = loadManifest(EDGE_DIR);
      change(m);
      expect(code(writeManifest(m)), name).toBe("MANIFEST_INVALID");
    }
    expect(code(join(EDGE_DIR, "manifest.json"))).toBe("valid");
  });

  it("messy: every role and the passphrase", () => {
    const broken: Array<[string, (m: Loose) => void]> = [
      ["a missing role", (m) => delete m.accounts.issuer],
      ["a role that is not a public key", (m) => (m.accounts.destination = 42)],
      ["a missing network", (m) => delete m.network],
    ];
    for (const [name, change] of broken) {
      const m = loadManifest(MESSY_DIR);
      change(m);
      expect(code(writeManifest(m)), name).toBe("MANIFEST_INVALID");
    }
    expect(code(join(MESSY_DIR, "manifest.json"))).toBe("valid");
  });

  it("through the CLI: MANIFEST_INVALID, not HORIZON_UNAVAILABLE (exit 6) or a TypeError, and no request", async () => {
    for (const change of [
      (m: Loose) => delete m.accounts.authMaintain,
      (m: Loose) => delete m.network,
    ]) {
      const m = loadManifest(EDGE_DIR);
      change(m);
      const requests: string[] = [];
      const c = capture();
      const exit = await run(
        ["node", "dustin", "fixture", "verify", writeManifest(m)],
        c.io,
        "0.0.0",
        {
          env: {},
          fetch: (url: string) => {
            requests.push(url);
            return passphrase();
          },
        },
      );
      expect(c.text()).toContain("MANIFEST_INVALID");
      expect(c.text()).not.toContain("unexpected error");
      expect(exit).toBe(1);
      expect(requests).toEqual([]);
    }
  });
});
