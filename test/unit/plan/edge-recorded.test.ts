import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { containsSecretSeed } from "../../../src/errors/redact.js";
import type { EdgeVariantRole } from "../../../src/fixture/edge.js";
import { inspectAccount } from "../../../src/inspect/inspect.js";
import type { ClosePlan } from "../../../src/plan/model.js";
import { planClose } from "../../../src/plan/plan-close.js";
import { EDGE_DIR, edgeManifest, edgeRecordedReader } from "../../helpers/edge-ledger.js";

// The D3 edge rows at the planner, offline (docs/edge-cases-and-test-matrix.md section 4): every
// variant of the edge fixture planned from the Horizon JSON recorded right after its live build.
// The planner reads with GET requests only (PRD FR-07).

const manifest = edgeManifest();
const a = manifest.accounts;

async function plan(role: EdgeVariantRole): Promise<ClosePlan> {
  const { reader } = edgeRecordedReader();
  return planClose(
    { account: a[role], destination: a.destination, feeSponsor: a.sponsor },
    { reader },
  );
}
const kinds = (p: ClosePlan) => p.steps.map((s) => s.kind);
const codeOf = (s: ClosePlan["steps"][number]) =>
  s.subject.type === "trustline" ? s.subject.asset.code : s.subject.type;

describe("the recorded edge fixture at the planner", () => {
  it("plans every variant exactly as the manifest expects, with GET requests only", async () => {
    for (const v of manifest.variants) {
      const { reader, requests } = edgeRecordedReader();
      const p = await planClose(
        { account: v.account, destination: a.destination, feeSponsor: a.sponsor },
        { reader },
      );
      expect(
        {
          status: p.status,
          blockers: p.blockers.map((b) => b.code),
          unclosable: p.unclosable.map((u) => u.code),
          steps: kinds(p),
        },
        v.name,
      ).toEqual(v.expected);
      expect(
        requests.filter((r) => r.method !== "GET"),
        v.name,
      ).toEqual([]);
      for (const x of [...p.blockers, ...p.unclosable, ...p.steps]) {
        expect(x.reason.trim(), v.name).not.toBe("");
      }
    }
  });

  it("holds public data only: no seed in any recorded file, and zero spendable XLM on every variant", () => {
    for (const file of readdirSync(EDGE_DIR)) {
      expect(containsSecretSeed(readFileSync(join(EDGE_DIR, file), "utf8")), file).toBe(false);
    }
    for (const v of manifest.variants) expect(v.spendable, v.name).toBe("0.0000000");
    expect(manifest.verification.pass).toBe(true);
  });

  it("S-01 (recorded): the illiquid ILQX has no strict-send path, so it is returned to its live issuer", async () => {
    const p = await plan("authFrozen");
    const ilqx = p.steps.find((s) => s.kind === "dispose_balance" && codeOf(s) === "ILQX")!;
    expect(ilqx.disposal).toMatchObject({ rung: "return_to_issuer", to: a.plainIssuer });
    expect(ilqx.disposal!.ruledOut.map((r) => r.rung)).toEqual([
      "path_payment",
      "send_to_destination",
    ]);
    expect(ilqx.disposal!.ruledOut[0]!.reason).toBe(
      "Horizon found no strict-send path to XLM for the full balance",
    );
    expect(ilqx.operation).toEqual({
      type: "payment",
      destination: a.plainIssuer,
      asset: { type: "credit_alphanum4", code: "ILQX", issuer: a.plainIssuer },
      amount: "0.0000003",
    });
  });

  it("S-02 (recorded): the frozen FRZ is unclosable before any submission, naming its issuer; nothing touches FRZ and nothing merges", async () => {
    const p = await plan("authFrozen");
    expect(p.status).toBe("partial");
    expect(p.unclosable).toHaveLength(1);
    const frz = p.unclosable[0]!;
    expect(frz).toMatchObject({ code: "TRUSTLINE_NOT_AUTHORIZED", blocksMerge: true });
    expect(frz.reason).toContain(`Issuer ${a.authIssuer} has not authorized the FRZ trustline`);
    // FRZ is not clawback-enabled, so re-authorization is the only remedy (closing review CP-7).
    expect(frz.remedy).toBe(
      `Ask the issuer ${a.authIssuer} to authorize the trustline again (SetTrustLineFlags), then run the plan again.`,
    );
    expect(p.steps.filter((s) => codeOf(s) === "FRZ")).toEqual([]);
    expect(kinds(p)).not.toContain("merge");
  });

  it("S-05 (recorded): the authorized AUTH is returned to its AUTH_REQUIRED issuer and the account closes in one transaction", async () => {
    const p = await plan("authAuthorized");
    expect(p.status).toBe("closable");
    expect(p.transactions).toHaveLength(1);
    expect(p.steps[0]!.disposal).toMatchObject({ rung: "return_to_issuer", to: a.authIssuer });
    expect(p.recovery.xlmToDestination).toBe("1.5000000");
  });

  it("S-06 (recorded): MNT is MAINTAIN_LIABILITIES_ONLY while its open offer is cancelled with amount 0", async () => {
    const p = await plan("authMaintain");
    expect(p.unclosable.map((u) => u.code)).toEqual(["MAINTAIN_LIABILITIES_ONLY"]);
    expect(p.unclosable[0]!.reason).toMatch(/limited the MNT trustline to maintaining liabilities/);
    expect(p.steps).toHaveLength(1);
    expect(p.steps[0]!.operation).toMatchObject({
      type: "manageSellOffer",
      amount: "0",
      selling: { code: "MNT", issuer: a.authIssuer },
      buying: { type: "native" },
    });
  });

  it("S-07 (recorded, AC-E3-S6-4): the inspector surfaces is_clawback_enabled and the plan warns, then returns CLAW to its issuer", async () => {
    const { reader } = edgeRecordedReader();
    const snapshot = await inspectAccount(a.clawback, { destination: a.destination, reader });
    if (!snapshot.exists) throw new Error("recorded clawback account missing");
    expect(snapshot.trustlines.map((t) => [t.asset.code, t.clawbackEnabled, t.authorized])).toEqual(
      [["CLAW", true, true]],
    );
    const p = await plan("clawback");
    expect(p.warnings).toEqual([
      `Trustline CLAW:${a.clawbackIssuer} is clawback-enabled: the issuer can change this balance before execution; the executor re-plans if that happens.`,
    ]);
    expect(p.steps[0]!.disposal).toMatchObject({ rung: "return_to_issuer", to: a.clawbackIssuer });
    expect(kinds(p)).toEqual(["dispose_balance", "remove_trustline", "merge"]);
  });

  it("S-08 (recorded, AC-E3-S5-1): the pool id is in the remedy, both asset trustlines are kept, and no changeTrust is planned", async () => {
    const p = await plan("poolShare");
    const blocker = p.blockers.find((b) => b.code === "LIQUIDITY_POOL_SHARES")!;
    expect(blocker.remedy).toContain(
      `Withdraw from pool ${manifest.pool.id} first (LiquidityPoolWithdraw); Dustin does not withdraw.`,
    );
    expect(blocker.reason).toContain(`1.0000000 shares of pool ${manifest.pool.id}`);
    expect(
      p.unclosable.map((u) => [u.code, u.subject.type === "trustline" && u.subject.asset.code]),
    ).toEqual([
      ["POOL_ASSET_TRUSTLINE", "LPA"],
      ["POOL_ASSET_TRUSTLINE", "LPB"],
    ]);
    expect(p.steps.map((s) => s.operation.type)).toEqual(["manageData"]);
  });

  it("S-09 (recorded, AC-E3-S5-2): THRESHOLD_UNMET names the weights, which threshold blocks which step, and the second signer", async () => {
    const p = await plan("multisig");
    expect(p.blockers.map((b) => b.code)).toEqual(["THRESHOLD_UNMET"]);
    const { reason, remedy } = p.blockers[0]!;
    expect(reason).toContain("The master key has weight 1");
    expect(reason).toContain("Thresholds: low 0, medium 0, high 2");
    expect(reason).toContain("Blocked: the merge needs weight 2");
    expect(reason).toContain(`${manifest.multisigSigner} (weight 1)`);
    expect(remedy).toContain("The cleanup can run now with --partial.");
    expect(kinds(p)).toEqual(["remove_data"]);
  });

  it("X-01 (recorded, AC-E3-S5-4): IS_SPONSOR counts the claimable balance the account created", async () => {
    const p = await plan("claimable");
    expect(p.blockers.map((b) => b.code)).toEqual(["IS_SPONSOR"]);
    expect(p.blockers[0]!.reason).toContain("including 1 claimable balance(s) it created");
    expect(p.blockers[0]!.remedy).toContain("Revoke or transfer your sponsorships first");
  });

  it("X-04 (recorded, AC-E3-S5-3): AUTH_IMMUTABLE_SET, permanent, with no step at all", async () => {
    const p = await plan("immutable");
    expect(p.blockers).toHaveLength(1);
    expect(p.blockers[0]).toMatchObject({ code: "AUTH_IMMUTABLE_SET", permanent: true });
    expect(p.steps).toEqual([]);
    expect(p.transactions).toEqual([]);
  });
});
