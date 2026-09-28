import { describe, expect, it } from "vitest";
import { run } from "../../../src/cli/run.js";
import { recordName } from "../../../src/fixture/edge-builder.js";
import type { EdgeAccountRole } from "../../../src/fixture/edge.js";
import { verifyEdgeFixture, type EdgeVerifyInput } from "../../../src/fixture/edge-verify.js";
import type { HorizonAccount, HorizonOffer } from "../../../src/inspect/horizon-types.js";
import { EDGE_DIR, edgeManifest, edgeRoles } from "../../helpers/edge-ledger.js";
import { loadRecorded, recordedFetch } from "../../helpers/recorded-horizon.js";

// The edge fixture's own checks (src/fixture/edge-verify.ts) on the Horizon JSON recorded right
// after its live build, and `dustin fixture verify` on the edge manifest.

const manifest = edgeManifest();
const roles = edgeRoles(manifest);
const recorded = loadRecorded(EDGE_DIR);
const MANIFEST = `${EDGE_DIR}/manifest.json`;

function recordedInput(): EdgeVerifyInput {
  const accountRoles = Object.keys(manifest.accounts).filter(
    (r) => r !== "sponsor",
  ) as EdgeAccountRole[];
  const accounts = Object.fromEntries(
    accountRoles.map((role) => [
      role,
      structuredClone((recorded.get(`/accounts/${roles[role]}`) as HorizonAccount) ?? null),
    ]),
  );
  const offers = recorded.get(`/accounts/${roles.authMaintain}/offers?limit=200&order=asc`) as {
    _embedded: { records: HorizonOffer[] };
  };
  const claimable = recorded.get(`/claimable_balances?sponsor=${roles.claimable}&limit=200`) as {
    _embedded: { records: unknown[] };
  };
  const ledger = recorded.get("/ledgers?order=desc&limit=1") as {
    _embedded: { records: Array<{ base_reserve_in_stroops: number }> };
  };
  return {
    roles,
    poolId: manifest.pool.id,
    baseReserve: BigInt(ledger._embedded.records[0]!.base_reserve_in_stroops),
    accounts,
    offers: { authMaintain: structuredClone(offers._embedded.records) },
    claimableSponsored: { claimable: claimable._embedded.records.length },
  };
}

const failing = (input: EdgeVerifyInput) =>
  verifyEdgeFixture(input)
    .checks.filter((c) => !c.pass)
    .map((c) => c.id);
const line = (input: EdgeVerifyInput, role: EdgeAccountRole, code: string) =>
  input.accounts[role]!.balances.find((b) => b.asset_code === code)!;

describe("verifyEdgeFixture", () => {
  it("passes every check on the recorded edge fixture, as the build did", () => {
    const result = verifyEdgeFixture(recordedInput());
    expect(result.checks.filter((c) => !c.pass)).toEqual([]);
    expect(result.checks.map((c) => c.id)).toEqual(manifest.verification.checks.map((c) => c.id));
  });

  it("names the variant whose state drifted from its recipe", () => {
    const thawed = recordedInput();
    Object.assign(line(thawed, "authFrozen", "FRZ"), { is_authorized: true });
    expect(failing(thawed)).toEqual(["authFrozen/frz-frozen"]);

    const noOffer = recordedInput();
    noOffer.offers.authMaintain = [];
    expect(failing(noOffer)).toEqual(["authMaintain/offer"]);

    const spendable = recordedInput();
    spendable.accounts.poolShare!.balances.find((b) => b.asset_type === "native")!.balance =
      "3.5000001";
    expect(failing(spendable)).toEqual(["poolShare/zero-spendable"]);

    const mutable = recordedInput();
    mutable.accounts.immutable!.flags.auth_immutable = false;
    expect(failing(mutable)).toEqual(["immutable/flag"]);

    const noClawback = recordedInput();
    delete line(noClawback, "clawback", "CLAW").is_clawback_enabled;
    expect(failing(noClawback)).toEqual(["clawback/claw-clawback-enabled"]);

    const trusting = recordedInput();
    trusting.accounts.destination!.balances.unshift({
      ...line(trusting, "authFrozen", "ILQX"),
      balance: "0.0000000",
    });
    expect(failing(trusting)).toEqual(["destination/no-edge-trustlines"]);
  });

  it("reports a missing variant account once and skips its per-account checks", () => {
    const input = recordedInput();
    input.accounts.multisig = null;
    expect(failing(input)).toEqual(["multisig/exists", "multisig/thresholds"]);
  });
});

describe("recorded file names", () => {
  it("name accounts and offers by role, paths by asset code, and the rest by resource", () => {
    const roleOf = new Map([
      [roles.authFrozen, "authFrozen"],
      [roles.clawbackIssuer, "clawbackIssuer"],
    ]);
    expect(recordName(`/accounts/${roles.authFrozen}`, roleOf)).toBe("account-auth-frozen");
    expect(recordName(`/accounts/${roles.clawbackIssuer}`, roleOf)).toBe("account-clawback-issuer");
    expect(recordName(`/accounts/${roles.authFrozen}/offers?limit=200&order=asc`, roleOf)).toBe(
      "offers-auth-frozen",
    );
    expect(
      recordName(
        `/paths/strict-send?source_asset_type=credit_alphanum4&source_asset_code=ILQX&source_asset_issuer=${roles.plainIssuer}&source_amount=0.0000003&destination_assets=native`,
        roleOf,
      ),
    ).toBe("paths-strict-send-ILQX");
    // X-03: the page of claimable balances that name the account as a claimant.
    expect(recordName(`/claimable_balances?claimant=${roles.authFrozen}&limit=200`, roleOf)).toBe(
      "claimable-claimant-auth-frozen",
    );
    expect(recordName(`/liquidity_pools/${manifest.pool.id}`, roleOf)).toBe("liquidity-pool");
    expect(recordName("/fee_stats", roleOf)).toBe("fee-stats");
    expect(recordName("/ledgers?order=desc&limit=1", roleOf)).toBe("ledger-latest");
  });
});

function capture() {
  const out: string[] = [];
  return {
    io: { stdout: (s: string) => void out.push(s), stderr: (s: string) => void out.push(s) },
    text: () => out.join(""),
  };
}

describe("dustin fixture verify on the edge manifest (recorded Horizon)", () => {
  it("passes every check (exit 0)", async () => {
    const c = capture();
    const { fetch } = recordedFetch(recorded);
    const code = await run(["node", "dustin", "fixture", "verify", MANIFEST], c.io, "0.0.0", {
      env: {},
      fetch,
    });
    expect(c.text()).toContain(`Verifying edge fixture ${manifest.id}`);
    expect(c.text()).toContain("Fixture verified: every check passed.");
    expect(code).toBe(0);
  });

  it("exits 3 when the frozen trustline was authorized again", async () => {
    const c = capture();
    const path = `/accounts/${roles.authFrozen}`;
    const thawed = structuredClone(recorded.get(path)) as HorizonAccount;
    Object.assign(
      thawed.balances.find((b) => b.asset_code === "FRZ")!,
      { is_authorized: true },
    );
    const { fetch } = recordedFetch(recorded, { [path]: thawed });
    const code = await run(["node", "dustin", "fixture", "verify", MANIFEST], c.io, "0.0.0", {
      env: {},
      fetch,
    });
    expect(code).toBe(3);
    expect(c.text()).toMatch(/FAIL\s+auth-frozen: the FRZ trustline is not authorized/);
  });
});

describe("dustin fixture create --profile", () => {
  it("refuses an unknown profile and names the two it has (exit 2)", async () => {
    const c = capture();
    const code = await run(
      ["node", "dustin", "fixture", "create", "--profile", "simple"],
      c.io,
      "0.0.0",
      { env: {} },
    );
    expect(code).toBe(2);
    expect(c.text()).toContain('Unknown fixture profile "simple". Available: messy, edge.');
  });
});
