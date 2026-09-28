import { StrKey } from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";
import { TESTNET_PASSPHRASE } from "../../../src/config/network.js";
import { DustinError } from "../../../src/errors/dustin-error.js";
import { fixtureId } from "../../../src/fixture/builder.js";
import { buildEdgeFixture } from "../../../src/fixture/edge-builder.js";
import { EDGE_KEY_ROLES } from "../../../src/fixture/edge.js";
import type { EdgeFixtureKeys } from "../../../src/fixture/manifest.js";
import { noSleep } from "../../helpers/no-sleep.js";

const HORIZON = "https://horizon-testnet.stellar.org";
const FRIENDBOT = "https://friendbot.test";

describe("edge fixture ids", () => {
  it("carry the profile, the UTC second and a random suffix; messy stays the default", () => {
    const at = new Date("2026-09-28T09:52:36.123Z");
    expect(fixtureId(at, "432c80", "edge")).toBe("edge-20260928T095236Z-432c80");
    expect(fixtureId(at, "a1b2c3")).toBe("messy-20260928T095236Z-a1b2c3");
  });
});

describe("buildEdgeFixture key handover", () => {
  it("hands every key over before any account is funded, so a failed build loses nothing", async () => {
    const seen: string[] = [];
    const fakeFetch = (url: string) => {
      seen.push(url);
      if (url === `${HORIZON}/`) {
        return Promise.resolve(
          new Response(JSON.stringify({ network_passphrase: TESTNET_PASSPHRASE })),
        );
      }
      return Promise.resolve(new Response("{}", { status: 500 }));
    };
    const received: EdgeFixtureKeys[] = [];
    const logs: string[] = [];
    const error = await buildEdgeFixture({
      fetch: fakeFetch,
      friendbotUrl: FRIENDBOT,
      sleep: noSleep,
      now: () => new Date("2026-09-28T09:52:36Z"),
      log: (line) => logs.push(line),
      onKeys: (keys) => {
        expect(seen.some((u) => u.startsWith(FRIENDBOT))).toBe(false);
        received.push(keys);
      },
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(DustinError);
    expect((error as DustinError).code).toBe("FRIENDBOT_FAILED");
    // Three tries, the pauses injected, nothing else posted.
    expect(seen.filter((u) => u.startsWith(FRIENDBOT))).toHaveLength(3);
    expect(received).toHaveLength(1);
    const keys = received[0]!;
    expect(keys.id).toMatch(/^edge-20260928T095236Z-[0-9a-f]{6}$/);
    expect(Object.keys(keys.secrets).sort()).toEqual([...EDGE_KEY_ROLES].sort());
    expect(Object.values(keys.secrets).every((s) => StrKey.isValidEd25519SecretSeed(s))).toBe(true);
    for (const secret of Object.values(keys.secrets)) {
      expect(logs.join("\n")).not.toContain(secret);
    }
  });

  it("refuses a Horizon that does not serve the testnet before creating any key", async () => {
    const received: EdgeFixtureKeys[] = [];
    const fakeFetch = () =>
      Promise.resolve(
        new Response(
          JSON.stringify({ network_passphrase: "Public Global Stellar Network ; September 2015" }),
        ),
      );
    await expect(
      buildEdgeFixture({ fetch: fakeFetch, sleep: noSleep, onKeys: (k) => received.push(k) }),
    ).rejects.toBeInstanceOf(DustinError);
    expect(received).toEqual([]);
  });
});
