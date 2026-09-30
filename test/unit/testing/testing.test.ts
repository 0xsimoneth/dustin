import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { Keypair, StrKey } from "@stellar/stellar-sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TESTNET_PASSPHRASE } from "../../../src/config/network.js";
import { DustinError } from "../../../src/errors/dustin-error.js";
import { planClose } from "../../../src/plan/plan-close.js";
import * as testing from "../../../src/testing.js";
import type { FixtureKeys, RecordedResponse } from "../../../src/testing.js";
import { MESSY_DIR } from "../../helpers/recorded-horizon.js";
import { messy } from "../../helpers/snapshots.js";

// stellar-dustin/testing (PRD decision D-18, the builder's decision K4 of 2026-09-30): the fixture
// builders with their checks and manifests, and a reader over recorded Horizon responses.

const HORIZON = "https://horizon-testnet.stellar.org";

/** The recorded responses of test/fixtures/horizon/messy, as a built fixture's `recorded` holds them. */
function recordedMessy(): Record<string, RecordedResponse> {
  const recorded: Record<string, RecordedResponse> = {};
  for (const file of readdirSync(MESSY_DIR).filter((f) => f !== "manifest.json")) {
    recorded[file.replace(/\.json$/, "")] = JSON.parse(
      readFileSync(join(MESSY_DIR, file), "utf8"),
    ) as RecordedResponse;
  }
  return recorded;
}

describe("stellar-dustin/testing", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it("exports the fixture builders, their checks, the manifests and the recorded readers", () => {
    for (const name of [
      "buildMessyFixture",
      "buildEdgeFixture",
      "fixtureId",
      "verifyFixture",
      "loadVerifyInput",
      "expectationFromManifest",
      "renderVerify",
      "verifyEdgeFixture",
      "loadEdgeVerifyInput",
      "assertNoReset",
      "readManifest",
      "readAnyManifest",
      "recordedFetch",
      "recordedReader",
      "checkMessyFixture",
      "loadMessyVerifyInput",
    ] as const) {
      expect(typeof testing[name], name).toBe("function");
    }
    expect(testing.MESSY_ROLES).toContain("fixture");
  });

  it("makes every key with Keypair.random(), never from the environment", async () => {
    // Secrets in the environment, as the CLI's close --execute would read them; a builder must
    // ignore them.
    const accountSecret = Keypair.random().secret();
    const sponsorSecret = Keypair.random().secret();
    vi.stubEnv("DUSTIN_ACCOUNT_SECRET", accountSecret);
    vi.stubEnv("DUSTIN_SPONSOR_SECRET", sponsorSecret);
    vi.useFakeTimers();
    // Horizon answers that it serves the testnet; Friendbot fails, so nothing is funded.
    const fetch = (url: string) =>
      Promise.resolve(
        url === `${HORIZON}/`
          ? new Response(JSON.stringify({ network_passphrase: TESTNET_PASSPHRASE }))
          : new Response("{}", { status: 500 }),
      );
    const received: FixtureKeys[] = [];
    const build = () =>
      testing
        .buildMessyFixture({
          fetch,
          friendbotUrl: "https://friendbot.test",
          onKeys: (keys) => void received.push(keys),
        })
        .catch((error: unknown) => error);
    const runs = [build(), build()];
    await vi.runAllTimersAsync();
    for (const error of await Promise.all(runs)) {
      expect(error).toBeInstanceOf(DustinError);
      expect((error as DustinError).code).toBe("FRIENDBOT_FAILED");
    }
    expect(received).toHaveLength(2);
    const secrets = received.flatMap((k) => Object.values(k.secrets));
    expect(secrets).toHaveLength(2 * testing.MESSY_ROLES.length);
    expect(secrets.every((s) => StrKey.isValidEd25519SecretSeed(s))).toBe(true);
    expect(new Set(secrets).size).toBe(secrets.length);
    expect(secrets).not.toContain(accountSecret);
    expect(secrets).not.toContain(sponsorSecret);
  });

  it("checks a messy fixture as `dustin fixture verify` does, against Horizon's answers", async () => {
    const manifest = testing.readManifest(join(MESSY_DIR, "manifest.json"));
    const fetch = testing.recordedFetch(recordedMessy());
    const checked = await testing.checkMessyFixture(manifest, { fetch });
    expect(checked.pass).toBe(true);
    expect(checked.checks.length).toBeGreaterThan(0);
    // A manifest of another network is refused before any request.
    const other = { ...manifest, network: { ...manifest.network, passphrase: "Other network" } };
    await expect(testing.checkMessyFixture(other, { fetch })).rejects.toMatchObject({
      name: "DustinError",
    });
  });

  it("plans offline from a fixture's recorded responses, with no request to the network", async () => {
    const recorded = recordedMessy();
    const plan = await planClose(
      { account: messy.fixture, destination: messy.destination },
      { reader: testing.recordedReader(recorded) },
    );
    expect(plan.status).toBe("closable");
    expect(plan.steps.at(-1)?.kind).toBe("merge");
    // Unknown paths answer 404 as Horizon does; the root names the testnet.
    const fetch = testing.recordedFetch(recorded);
    expect((await fetch(`${HORIZON}/accounts/${Keypair.random().publicKey()}`)).status).toBe(404);
    expect(await (await fetch(`${HORIZON}/`)).json()).toEqual({
      network_passphrase: TESTNET_PASSPHRASE,
    });
  });
});
