import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { StrKey } from "@stellar/stellar-sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import { writeFixtureKeys } from "../../../src/cli/commands/fixture.js";
import { TESTNET_PASSPHRASE } from "../../../src/config/network.js";
import { DustinError } from "../../../src/errors/dustin-error.js";
import { buildMessyFixture, fixtureId, stepError } from "../../../src/fixture/builder.js";
import type { FixtureKeys } from "../../../src/fixture/manifest.js";

const HORIZON = "https://horizon-testnet.stellar.org";
const FRIENDBOT = "https://friendbot.test";

describe("fixture ids", () => {
  it("carry the UTC second and a random suffix, so two builds in one second differ", () => {
    const at = new Date("2026-09-26T03:59:42.123Z");
    expect(fixtureId(at, "a1b2c3")).toBe("messy-20260926T035942Z-a1b2c3");
    expect(fixtureId(at)).toMatch(/^messy-20260926T035942Z-[0-9a-f]{6}$/);
    expect(fixtureId(at)).not.toBe(fixtureId(at));
  });
});

describe("fixture step outcomes", () => {
  it("names the step and the Horizon codes of a failed or rejected transaction", () => {
    const failed = stepError("add-trustlines", {
      kind: "failed",
      hash: "ab".repeat(32),
      status: 400,
      codes: {
        transaction: "tx_fee_bump_inner_failed",
        innerTransaction: "tx_failed",
        operations: ["op_success", "op_low_reserve"],
      },
    });
    expect(failed.code).toBe("FIXTURE_STEP_FAILED");
    expect(failed.message).toBe(
      'Fixture step "add-trustlines" failed: tx_fee_bump_inner_failed / tx_failed [op_success, op_low_reserve].',
    );
    expect(failed.horizon).toMatchObject({
      status: 400,
      transaction: "tx_fee_bump_inner_failed",
      innerTransaction: "tx_failed",
      hash: "ab".repeat(32),
    });

    const rejected = stepError("fund-sponsor", {
      kind: "rejected",
      hash: "cd".repeat(32),
      status: 400,
      codes: { transaction: "tx_bad_seq" },
    });
    expect(rejected.code).toBe("FIXTURE_STEP_FAILED");
    expect(rejected.message).toContain("tx_bad_seq");
  });

  it("reports a transaction that never appeared as retryable, not as a failed step", () => {
    const unknown = stepError("drain-to-minimum", { kind: "unknown", hash: "ef".repeat(32) });
    expect(unknown.code).toBe("HORIZON_UNAVAILABLE");
    expect(unknown.retryable).toBe(true);
    expect(unknown.stage).toBe("submit");
    expect(unknown.message).toContain("drain-to-minimum");
  });
});

describe("buildMessyFixture key handover", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("hands the keys over before any account is funded, so a failed build loses nothing", async () => {
    vi.useFakeTimers();
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
    const received: FixtureKeys[] = [];
    const logs: string[] = [];
    const build = buildMessyFixture({
      fetch: fakeFetch,
      friendbotUrl: FRIENDBOT,
      now: () => new Date("2026-09-26T03:59:42Z"),
      log: (line) => logs.push(line),
      onKeys: (keys) => {
        // Nothing has touched Friendbot yet.
        expect(seen.some((u) => u.startsWith(FRIENDBOT))).toBe(false);
        received.push(keys);
      },
    }).catch((error: unknown) => error);
    await vi.runAllTimersAsync();
    const error = await build;

    expect(error).toBeInstanceOf(DustinError);
    expect((error as DustinError).code).toBe("FRIENDBOT_FAILED");
    expect(received).toHaveLength(1);
    const keys = received[0]!;
    expect(keys.id).toMatch(/^messy-20260926T035942Z-[0-9a-f]{6}$/);
    expect(Object.values(keys.secrets).every((s) => StrKey.isValidEd25519SecretSeed(s))).toBe(true);
    // Progress lines never carry a secret.
    for (const secret of Object.values(keys.secrets)) {
      expect(logs.join("\n")).not.toContain(secret);
    }
  });
});

describe("writeFixtureKeys", () => {
  const keys: FixtureKeys = {
    schemaVersion: 1,
    kind: "dustin-fixture-keys",
    id: "messy-20260926T035942Z-a1b2c3",
    note: "Testnet secret keys for this fixture. Never commit this file.",
    secrets: {
      sponsor: "S1",
      reserveSponsor: "S2",
      issuer: "S3",
      marketMaker: "S4",
      destination: "S5",
      fixture: "S6",
    },
  };

  it("writes owner-only keys into the fixture's own directory", () => {
    const base = mkdtempSync(join(tmpdir(), "dustin-"));
    const path = writeFixtureKeys(base, keys);
    expect(path).toBe(join(base, keys.id, "keys.json"));
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(statSync(join(base, keys.id)).mode & 0o777).toBe(0o700);
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual(keys);
  });

  it("never overwrites an existing keys file", () => {
    const base = mkdtempSync(join(tmpdir(), "dustin-"));
    const path = writeFixtureKeys(base, keys);
    writeFileSync(path, "{}", { mode: 0o600 });
    expect(() => writeFixtureKeys(base, keys)).toThrow();
    expect(readFileSync(path, "utf8")).toBe("{}");
  });
});
