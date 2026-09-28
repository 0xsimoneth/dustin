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
      "offer-types",
      "offer-stale",
      "claimant",
    ]);
    const rows = new Set(variants.flatMap((v) => v.rows));
    for (const row of ["S-01", "S-02", "S-05", "S-06", "S-07", "S-08", "S-09", "X-01", "X-04"])
      expect(rows.has(row)).toBe(true);
    // Added in E4-S3 as new variants, the existing ones unchanged.
    for (const row of ["X-03", "X-07", "X-08", "X-11"]) expect(rows.has(row)).toBe(true);
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
    // Its minimum (2 + 2 trustlines + 3 offers) x 0.5 plus the 0.0000010 XLM its offer sells.
    expect(starting("offer-types")).toBe("3.5000010");
    expect(starting("offer-stale")).toBe("2.0000000");
    expect(starting("claimant")).toBe("1.0000000");
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
        if (
          op.type === "manageSellOffer" ||
          op.type === "manageBuyOffer" ||
          op.type === "createPassiveSellOffer" ||
          op.type === "manageData"
        )
          bump(opened, source);
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
    // The claimant variant's balances are created for it by the plain issuer (X-03).
    expect(
      all.filter(({ op }) => op.type === "createClaimableBalance").map((o) => o.source),
    ).toEqual(["claimable", "plainIssuer", "plainIssuer"]);
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
      "OFA 0.0000003",
      "OFB 0.0000005",
      "OFC 0.0000005",
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

/** An offer operation as "SELLING>BUYING" with its amount and price, from the account's view. */
function offerOf(op: ReturnType<typeof decoded>[number]["ops"][number]["op"]) {
  const code = (a: { isNative(): boolean; getCode(): string }) =>
    a.isNative() ? "XLM" : a.getCode();
  if (op.type === "manageSellOffer" || op.type === "createPassiveSellOffer") {
    return {
      type: op.type,
      pair: `${code(op.selling)}>${code(op.buying)}`,
      amount: op.amount,
      price: op.price,
    };
  }
  if (op.type === "manageBuyOffer") {
    return {
      type: op.type,
      pair: `${code(op.selling)}>${code(op.buying)}`,
      amount: op.buyAmount,
      price: op.price,
    };
  }
  return null;
}

describe("edge recipe, the variants added for X-03, X-07, X-08 and X-11 (E4-S3)", () => {
  const holderState = () => decoded().find((d) => d.step.name === "holder-state")!.ops;

  it("offer-types holds a buy offer, a passive sell offer and an offer that sells XLM, and nothing else", () => {
    const offers = holderState()
      .filter((o) => o.source === "offerTypes")
      .map((o) => offerOf(o.op));
    expect(offers).toEqual([
      // Sells XLM for OFA: the native selling liability, and the only liquidity for OFA -> XLM (X-11).
      { type: "manageSellOffer", pair: "XLM>OFA", amount: "0.0000010", price: "1" },
      // Buys 0.0000002 XLM with OFB at 2 OFB per XLM: Horizon lists it as selling 0.0000004 OFB.
      { type: "manageBuyOffer", pair: "OFB>XLM", amount: "0.0000002", price: "2" },
      { type: "createPassiveSellOffer", pair: "OFA>OFB", amount: "0.0000002", price: "1" },
    ]);
    const v = variants.find((x) => x.name === "offer-types")!;
    expect(v.nativeSellingLiabilities).toBe("0.0000010");
    // Every balance covers what its offers sell: OFA 0.0000003 >= 0.0000002, OFB 0.0000005 >= 0.0000004.
    expect(v.dust).toEqual([
      { code: "OFA", amount: "0.0000003" },
      { code: "OFB", amount: "0.0000005" },
    ]);
  });

  it("offer-stale holds one sell offer of its whole OFC balance, for a counterparty to take (X-08)", () => {
    const offers = holderState()
      .filter((o) => o.source === "offerStale")
      .map((o) => offerOf(o.op));
    expect(offers).toEqual([
      { type: "manageSellOffer", pair: "OFC>XLM", amount: "0.0000005", price: "1" },
    ]);
    expect(variants.find((x) => x.name === "offer-stale")!.dust).toEqual([
      { code: "OFC", amount: "0.0000005" },
    ]);
  });

  it("the plain issuer creates two claimable balances that name the claimant variant (X-03): XLM for it alone, CBA for it and the issuer", () => {
    const balances = holderState()
      .filter(({ op }) => op.type === "createClaimableBalance")
      .flatMap(({ op, source }) =>
        op.type === "createClaimableBalance" && source === "plainIssuer"
          ? [
              {
                asset: op.asset.isNative() ? "XLM" : op.asset.getCode(),
                amount: op.amount,
                claimants: op.claimants.map((c) => roleOf.get(c.destination)),
              },
            ]
          : [],
      );
    expect(balances).toEqual([
      { asset: "XLM", amount: "0.0000001", claimants: ["claimant"] },
      { asset: "CBA", amount: "0.0000002", claimants: ["claimant", "plainIssuer"] },
    ]);
    // One base reserve per claimant, and the XLM the balance holds, come from the plain issuer
    // (list-of-operations#create-claimable-balance): 2 + 3 reserves = 2.5 XLM, within its 3 XLM.
    expect(EDGE.helperBalances.plainIssuer).toBe("3");
  });

  it("no two offers of the build cross: none sells what another buys at the same time", () => {
    const offers = decoded()
      .flatMap((d) => d.ops)
      .map((o) => offerOf(o.op))
      .filter((o) => o !== null);
    const pairs = new Set(offers.map((o) => o.pair));
    for (const o of offers) {
      const [selling, buying] = o.pair.split(">");
      expect(pairs.has(`${buying}>${selling}`), o.pair).toBe(false);
    }
  });
});
