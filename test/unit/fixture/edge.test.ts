import {
  Account,
  AuthImmutableFlag,
  Keypair,
  LiquidityPoolAsset,
  Networks,
  TransactionBuilder,
} from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";
import { toStroops } from "../../../src/amounts.js";
import {
  EDGE,
  EDGE_KEY_ROLES,
  edgePool,
  edgeStartingBalance,
  edgeSteps,
  type EdgeKeyRole,
  type EdgeRoles,
  type EdgeVariant,
} from "../../../src/fixture/edge.js";
import { FakeLedger } from "../../helpers/fake-ledger.js";

// The edge recipe (docs/edge-cases-and-test-matrix.md sections 4 and 5.3), offline.

const roles = Object.fromEntries(
  EDGE_KEY_ROLES.map((r, i) => [
    r,
    Keypair.fromRawEd25519Seed(Buffer.alloc(32, 90 + i)).publicKey(),
  ]),
) as EdgeRoles;
const BASE_RESERVE = 5_000_000n;
const variants: readonly EdgeVariant[] = EDGE.variants;
const steps = edgeSteps(roles, BASE_RESERVE);
const roleOf = new Map(Object.entries(roles).map(([role, key]) => [key, role as EdgeKeyRole]));

/** Every step's operations decoded with their effective source (the transaction's by default). */
function decoded() {
  return steps.map((step) => {
    const builder = new TransactionBuilder(new Account(roles[step.source], "1"), {
      fee: "0",
      networkPassphrase: Networks.TESTNET,
    }).setTimeout(0);
    for (const op of step.operations) builder.addOperation(op);
    const tx = builder.build();
    return {
      step,
      ops: tx.operations.map((op) => ({ op, source: roleOf.get(op.source ?? tx.source)! })),
    };
  });
}

describe("edge recipe", () => {
  it("has one account per variant, covering the D3 rows it was built for", () => {
    expect(variants.map((v) => v.name)).toEqual([
      "auth-frozen",
      "auth-maintain",
      "auth-authorized",
      "auth-revoke",
      "clawback",
      "clawback-drift",
      "pool-share",
      "multisig",
      "claimable",
      "immutable",
    ]);
    const rows = new Set(variants.flatMap((v) => v.rows));
    for (const row of ["S-01", "S-02", "S-05", "S-06", "S-07", "S-08", "S-09", "X-01", "X-04"])
      expect(rows.has(row)).toBe(true);
    expect(new Set(variants.map((v) => v.role)).size).toBe(variants.length);
  });

  it("builds in order: accounts, issuer flags before any trustline, then the restrictions last", () => {
    expect(steps.map((s) => s.name)).toEqual([
      "create-accounts",
      "issuer-flags",
      "trustlines",
      "authorize",
      "dust-payments",
      "holder-state",
      "restrict",
    ]);
  });

  it("fee-bumps every transaction not sourced by the sponsor, and the sponsor signs no inner one", () => {
    for (const step of steps) {
      expect(step.feeBumped).toBe(step.source !== "sponsor");
      if (step.feeBumped) expect(step.signers).not.toContain("sponsor");
    }
  });

  it("signs each transaction with exactly its sources (no tx_bad_auth, no tx_bad_auth_extra)", () => {
    for (const { step, ops } of decoded()) {
      const sources = new Set<EdgeKeyRole>([step.source, ...ops.map((o) => o.source)]);
      expect(new Set(step.signers), step.name).toEqual(sources);
    }
  });

  it("starts each variant at the minimum balance it has once built, so it ends at zero spendable", () => {
    const starting = (name: string) =>
      edgeStartingBalance(
        variants.find((v) => v.name === name)!,
        BASE_RESERVE,
      );
    expect(starting("auth-frozen")).toBe("2.5000000");
    expect(starting("pool-share")).toBe("3.5000000");
    expect(starting("claimable")).toBe("1.5000001");
    expect(starting("immutable")).toBe("1.0000000");
    const create = decoded()[0]!.ops;
    for (const v of variants) {
      const op = create.find(
        (o) => o.op.type === "createAccount" && o.op.destination === roles[v.role],
      );
      expect(op?.op.type === "createAccount" && op.op.startingBalance).toBe(
        edgeStartingBalance(v, BASE_RESERVE),
      );
    }
  });

  it("counts every subentry a variant opens: trustlines (two for a pool share), offers, data, signers", () => {
    const opened = new Map<string, number>();
    const sponsoring = new Map<string, number>();
    const bump = (m: Map<string, number>, role: string, n = 1) =>
      m.set(role, (m.get(role) ?? 0) + n);
    for (const { ops } of decoded()) {
      for (const { op, source } of ops) {
        if (op.type === "changeTrust")
          bump(opened, source, op.line instanceof LiquidityPoolAsset ? 2 : 1);
        if (op.type === "manageSellOffer" || op.type === "manageData") bump(opened, source);
        if (op.type === "setOptions" && op.signer) bump(opened, source);
        if (op.type === "createClaimableBalance") bump(sponsoring, source);
      }
    }
    for (const v of variants) {
      expect(opened.get(v.role) ?? 0, v.name).toBe(v.subentries);
      expect(sponsoring.get(v.role) ?? 0, v.name).toBe(v.numSponsoring);
    }
  });

  it("sets AUTH_IMMUTABLE, creates a claimable balance and deposits into a pool only on the variant built for it", () => {
    const all = decoded().flatMap((d) => d.ops);
    const immutable = all.filter(
      ({ op }) => op.type === "setOptions" && ((op.setFlags ?? 0) & AuthImmutableFlag) !== 0,
    );
    expect(immutable.map((o) => o.source)).toEqual(["immutable"]);
    expect(
      all.filter(({ op }) => op.type === "createClaimableBalance").map((o) => o.source),
    ).toEqual(["claimable"]);
    expect(all.filter(({ op }) => op.type === "liquidityPoolDeposit").map((o) => o.source)).toEqual(
      ["poolShare"],
    );
    // Nothing touches the fee sponsor's own flags or signers.
    expect(
      all.filter(({ op, source }) => source === "sponsor" && op.type !== "createAccount"),
    ).toEqual([]);
  });

  it("freezes FRZ, reduces MNT to maintain-liabilities and raises the multisig threshold in the last step", () => {
    const restrict = decoded().at(-1)!.ops;
    const flags = restrict.filter(({ op }) => op.type === "setTrustLineFlags");
    expect(
      flags.map(({ op }) =>
        op.type === "setTrustLineFlags" ? [op.asset.getCode(), op.flags] : null,
      ),
    ).toEqual([
      ["FRZ", { authorized: false }],
      ["MNT", { authorized: false, authorizedToMaintainLiabilities: true }],
    ]);
    const multisig = restrict.find(({ source }) => source === "multisig")!.op;
    expect(multisig).toMatchObject({
      type: "setOptions",
      masterWeight: 1,
      highThreshold: 2,
      signer: { ed25519PublicKey: roles.multisigSigner, weight: 1 },
    });
  });

  it("uses the SDK's pool id for LPA/LPB, the same the fake ledger computes", () => {
    const pool = edgePool(roles);
    expect(pool.id).toBe(FakeLedger.poolId(`LPA:${roles.plainIssuer}`, `LPB:${roles.plainIssuer}`));
    const deposit = decoded()
      .flatMap((d) => d.ops)
      .find(({ op }) => op.type === "liquidityPoolDeposit")!.op;
    expect(deposit).toMatchObject({ type: "liquidityPoolDeposit", liquidityPoolId: pool.id });
  });

  it("pays dust below 1e-6 as 7-decimal strings (never JavaScript numbers)", () => {
    for (const v of variants) {
      for (const d of v.dust) {
        expect(typeof d.amount).toBe("string");
        expect(toStroops(d.amount)).toBeGreaterThan(0n);
      }
    }
    const payments = decoded()
      .flatMap((d) => d.ops)
      .filter(({ op }) => op.type === "payment");
    expect(
      payments.map(({ op }) => (op.type === "payment" ? `${op.asset.getCode()} ${op.amount}` : "")),
    ).toEqual([
      "FRZ 0.0000005",
      "ILQX 0.0000003",
      "MNT 0.0000005",
      "AUTH 0.0000003",
      "RVK 0.0000004",
      "CLAW 0.0000004",
      "CLAW 0.0000004",
      "LPA 1.0000000",
      "LPB 1.0000000",
    ]);
  });

  it("funds every account from the fee sponsor alone (one Friendbot call per build)", () => {
    const creates = decoded()
      .flatMap((d) => d.ops)
      .filter(({ op }) => op.type === "createAccount");
    expect(new Set(creates.map((o) => o.source))).toEqual(new Set(["sponsor"]));
    expect(creates).toHaveLength(4 + variants.length);
  });
});
