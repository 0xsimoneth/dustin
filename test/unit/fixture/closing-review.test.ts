import { describe, expect, it } from "vitest";
import { TESTNET_PASSPHRASE } from "../../../src/config/network.js";
import { DustinError } from "../../../src/errors/dustin-error.js";
import { buildMessyFixture } from "../../../src/fixture/builder.js";
import { buildEdgeFixture } from "../../../src/fixture/edge-builder.js";
import { noSleep } from "../../helpers/no-sleep.js";

// The closing review of 2026-09-28, fixture half (findings CP-8 to CP-14 of the edge case hunt):
// every test here failed on the code before its fix.

const HORIZON = "https://horizon-testnet.stellar.org";
const FRIENDBOT = "https://friendbot.test";

const passphrase = () =>
  Promise.resolve(new Response(JSON.stringify({ network_passphrase: TESTNET_PASSPHRASE })));
const answer = (status: number, body: unknown = {}) =>
  Promise.resolve(new Response(JSON.stringify(body), { status }));

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
