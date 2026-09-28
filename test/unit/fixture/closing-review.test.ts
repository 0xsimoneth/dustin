import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { run } from "../../../src/cli/run.js";
import { TESTNET_PASSPHRASE } from "../../../src/config/network.js";
import { DustinError } from "../../../src/errors/dustin-error.js";
import { buildMessyFixture, friendbot } from "../../../src/fixture/builder.js";
import { buildEdgeFixture, openSettleChecks } from "../../../src/fixture/edge-builder.js";
import { edgeSteps, type EdgeAccountRole } from "../../../src/fixture/edge.js";
import { verifyEdgeFixture, type EdgeVerifyInput } from "../../../src/fixture/edge-verify.js";
import { readAnyManifest } from "../../../src/fixture/manifest.js";
import type { HorizonAccount, HorizonOffer } from "../../../src/inspect/horizon-types.js";
import {
  EDGE_DIR,
  badSequenceAnswer,
  edgeManifest,
  edgeRoles,
  rekeyedEdgeHorizon,
} from "../../helpers/edge-ledger.js";
import { noSleep } from "../../helpers/no-sleep.js";
import { MESSY_DIR, loadRecorded } from "../../helpers/recorded-horizon.js";

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

/** The verification input of the recorded edge fixture, every account present. */
function recordedVerifyInput(): EdgeVerifyInput {
  const manifest = edgeManifest();
  const roles = edgeRoles(manifest);
  const recorded = loadRecorded(EDGE_DIR);
  const accountRoles = Object.keys(manifest.accounts).filter(
    (r) => r !== "sponsor",
  ) as EdgeAccountRole[];
  const offers = recorded.get(`/accounts/${roles.authMaintain}/offers?limit=200&order=asc`) as {
    _embedded: { records: HorizonOffer[] };
  };
  return {
    roles,
    poolId: manifest.pool.id,
    baseReserve: 5_000_000n,
    accounts: Object.fromEntries(
      accountRoles.map((role) => [
        role,
        structuredClone(recorded.get(`/accounts/${roles[role]}`) as HorizonAccount),
      ]),
    ),
    offers: { authMaintain: offers._embedded.records },
    claimableSponsored: { claimable: 1 },
  };
}

describe("CP-11: a step settles only on checks that ran and passed", () => {
  it("every id a build step waits for is a check the verification runs", () => {
    const input = recordedVerifyInput();
    const ids = new Set(verifyEdgeFixture(input).checks.map((c) => c.id));
    for (const step of edgeSteps(input.roles, input.baseReserve)) {
      for (const id of step.settles) expect(ids.has(id), `${step.name}: ${id}`).toBe(true);
    }
  });

  it("a settle id whose check was skipped (its account is missing) counts as open", () => {
    const input = recordedVerifyInput();
    input.accounts.clawback = null;
    input.accounts.authAuthorized = null;
    const result = verifyEdgeFixture(input);
    const step = edgeSteps(input.roles, input.baseReserve).find((s) => s.name === "dust-payments")!;
    expect(step.settles).toEqual(["clawback/claw-dust", "authAuthorized/auth-dust"]);
    expect(result.checks.some((c) => step.settles.includes(c.id))).toBe(false);
    expect(openSettleChecks(result, step.settles)).toEqual([
      "clawback/claw-dust: not checked (Horizon did not return its account)",
      "authAuthorized/auth-dust: not checked (Horizon did not return its account)",
    ]);
  });

  it("a check that ran and failed is open with what Horizon shows; one that passed is settled", () => {
    const input = recordedVerifyInput();
    const result = verifyEdgeFixture(input);
    expect(openSettleChecks(result, ["clawback/claw-dust"])).toEqual([]);
    const claw = input.accounts.clawback!.balances.find((b) => b.asset_code === "CLAW")!;
    claw.balance = "0.0000000";
    expect(openSettleChecks(verifyEdgeFixture(input), ["clawback/claw-dust"])).toEqual([
      "clawback holds 0.0000004 CLAW: balance 0.0000000, is_authorized true, is_authorized_to_maintain_liabilities true, is_clawback_enabled true",
    ]);
  });
});

describe("CP-8: after a failed Friendbot try, Horizon says whether the account was funded", () => {
  const KEY = "GA6B2IOCNM54LTPBH73RYS35LEJBDO7FEL63UM2P5BTGIPNMERGT4ZQ7";
  const timeout = () =>
    Promise.reject(new DOMException("The operation timed out.", "TimeoutError"));
  /**
   * Friendbot answers each try in turn (`"timeout"` is a try that funded the account but gave up
   * here); Horizon answers each look at the account in turn (the last answer repeats).
   */
  function world(tries: Array<number | "timeout">, looks: number[]) {
    const seen: string[] = [];
    let t = 0;
    let l = 0;
    const fetch = (url: string) => {
      seen.push(url);
      if (url === `${HORIZON}/`) return passphrase();
      if (url.startsWith(FRIENDBOT)) {
        const next = tries[Math.min(t++, tries.length - 1)]!;
        // Friendbot funds with CreateAccount, which fails for an account that exists.
        return next === "timeout"
          ? timeout()
          : answer(next, { detail: "createAccountAlreadyExist" });
      }
      if (/\/accounts\/G[A-Z2-7]{55}$/.test(url)) {
        const status = looks[Math.min(l++, looks.length - 1)]!;
        return answer(status, status === 200 ? { id: url.slice(-56) } : { status });
      }
      return answer(400, { status: 400 });
    };
    const count = (prefix: string) => seen.filter((u) => u.startsWith(prefix)).length;
    return {
      fetch,
      friendbotTries: () => count(FRIENDBOT),
      looks: () => count(`${HORIZON}/accounts/`),
    };
  }
  const opts = { sleep: noSleep, horizonUrl: HORIZON };

  it("a try that timed out after funding the account: Horizon has it, so no second try", async () => {
    const w = world(["timeout", 400], [200]);
    await expect(friendbot(FRIENDBOT, KEY, w.fetch, opts)).resolves.toBeUndefined();
    expect(w.friendbotTries()).toBe(1);
    expect(w.looks()).toBe(1);
  });

  it("an answer that is not OK: Horizon is asked after each try, until it shows the account", async () => {
    const w = world([400], [404, 200]);
    await expect(friendbot(FRIENDBOT, KEY, w.fetch, opts)).resolves.toBeUndefined();
    expect(w.friendbotTries()).toBe(2);
    expect(w.looks()).toBe(2);
  });

  it("an account Horizon never shows still fails, after three tries; a failed look proves nothing", async () => {
    for (const looks of [[404], [500]]) {
      const w = world([500], looks);
      const error = await friendbot(FRIENDBOT, KEY, w.fetch, opts).catch((e: unknown) => e);
      expect((error as DustinError).code).toBe("FRIENDBOT_FAILED");
      expect(w.friendbotTries()).toBe(3);
      expect(w.looks()).toBe(3);
    }
  });

  it("edge and messy builders: a timed-out try that funded the sponsor does not stop the build", async () => {
    const edge = world(["timeout", 400], [200]);
    const e1 = await buildEdgeFixture({
      fetch: edge.fetch,
      friendbotUrl: FRIENDBOT,
      sleep: noSleep,
    }).catch((e: unknown) => e);
    // Past Friendbot: stopped by the next Horizon read (HTTP 400), not FRIENDBOT_FAILED.
    expect((e1 as DustinError).code).toBe("HORIZON_UNAVAILABLE");
    expect(edge.friendbotTries()).toBe(1);

    const messyWorld = world(["timeout", 400], [200]);
    const e2 = await buildMessyFixture({ fetch: messyWorld.fetch, friendbotUrl: FRIENDBOT }).catch(
      (e: unknown) => e,
    );
    expect((e2 as DustinError).code).toBe("HORIZON_UNAVAILABLE");
    expect(messyWorld.friendbotTries()).toBe(1);
  });
});

describe("the re-keyed recorded edge fixture (the harness of the tests below)", () => {
  it("builds offline: 7 transactions, every check passes, every variant recorded", async () => {
    const horizon = rekeyedEdgeHorizon();
    const { manifest, recorded } = await buildEdgeFixture({
      fetch: horizon.fetch,
      sleep: noSleep,
      onKeys: horizon.onKeys,
    });
    expect(manifest.transactions.map((t) => t.step)).toEqual([
      "create-accounts",
      "issuer-flags",
      "trustlines",
      "authorize",
      "dust-payments",
      "holder-state",
      "restrict",
    ]);
    expect(manifest.verification.pass).toBe(true);
    expect(manifest.verification.checks).toHaveLength(62);
    expect(manifest.accounts.claimable).toBe(horizon.roles().claimable);
    expect(Object.keys(recorded)).toContain("account-auth-frozen");
  });
});

describe("CP-10: the build reads through a Horizon that lags the ledger", () => {
  it("polls the sponsor after Friendbot until Horizon shows it, then builds", async () => {
    let sponsorReads = 0;
    const horizon = rekeyedEdgeHorizon({
      onGet: (path) => {
        if (path !== `/accounts/${horizon.roles().sponsor}`) return undefined;
        // The instance that answers has not ingested Friendbot's funding yet, twice.
        return ++sponsorReads <= 2
          ? Promise.resolve(new Response(JSON.stringify({ status: 404 }), { status: 404 }))
          : undefined;
      },
    });
    const { manifest } = await buildEdgeFixture({
      fetch: horizon.fetch,
      sleep: noSleep,
      onKeys: horizon.onKeys,
    });
    expect(sponsorReads).toBeGreaterThanOrEqual(3);
    expect(manifest.transactions).toHaveLength(7);
  });

  it("tx_bad_seq from a stale sequence number: re-reads the source until it moves, and retries once", async () => {
    let stale = true;
    const horizon = rekeyedEdgeHorizon({
      // The second step is sourced by the auth issuer. Horizon first shows its recorded sequence
      // number; once the ledger refused it, a newer one (the instance caught up).
      onGet: (path, recorded) => {
        if (stale || path !== `/accounts/${horizon.roles().authIssuer}`) return undefined;
        const account = structuredClone(recorded(path)) as HorizonAccount;
        account.sequence = (BigInt(account.sequence) + 1n).toString();
        return Promise.resolve(new Response(JSON.stringify(account)));
      },
      onSubmit: (s) => {
        if (s.n !== 2) return undefined;
        stale = false;
        return badSequenceAnswer();
      },
    });
    const { manifest } = await buildEdgeFixture({
      fetch: horizon.fetch,
      sleep: noSleep,
      onKeys: horizon.onKeys,
    });
    expect(manifest.transactions).toHaveLength(7);
    const [refused, retried] = horizon.submissions.slice(1, 3);
    expect(refused!.source).toBe(horizon.roles().authIssuer);
    expect(retried!.source).toBe(horizon.roles().authIssuer);
    expect(BigInt(retried!.sequence)).toBe(BigInt(refused!.sequence) + 1n);
    expect(horizon.submissions).toHaveLength(8);
  });

  it("a second tx_bad_seq for the same step stops the build: one retry only", async () => {
    let refusals = 0;
    const horizon = rekeyedEdgeHorizon({
      onGet: (path, recorded) => {
        if (refusals === 0 || path !== `/accounts/${horizon.roles().authIssuer}`) return undefined;
        const account = structuredClone(recorded(path)) as HorizonAccount;
        account.sequence = (BigInt(account.sequence) + BigInt(refusals)).toString();
        return Promise.resolve(new Response(JSON.stringify(account)));
      },
      onSubmit: (s) => {
        if (s.n !== 2 && s.n !== 3) return undefined;
        refusals++;
        return badSequenceAnswer();
      },
    });
    const error = await buildEdgeFixture({
      fetch: horizon.fetch,
      sleep: noSleep,
      onKeys: horizon.onKeys,
    }).catch((e: unknown) => e);
    expect((error as DustinError).code).toBe("FIXTURE_STEP_FAILED");
    expect((error as DustinError).message).toContain('"issuer-flags"');
    expect((error as DustinError).message).toContain("tx_bad_seq");
    expect(horizon.submissions).toHaveLength(3);
  });
});
