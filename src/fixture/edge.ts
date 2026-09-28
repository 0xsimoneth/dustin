import {
  Asset,
  AuthClawbackEnabledFlag,
  AuthImmutableFlag,
  AuthRequiredFlag,
  AuthRevocableFlag,
  Claimant,
  LiquidityPoolAsset,
  LiquidityPoolFeeV18,
  Operation,
  getLiquidityPoolId,
  type xdr,
} from "@stellar/stellar-sdk";
import { formatStroops, toStroops } from "../amounts.js";
import type { BlockerCode, CloseStepKind, PlanStatus, UnclosableCode } from "../plan/model.js";

/**
 * The `edge` fixture profile (docs/README.md canonical decision 3; architecture section 4.10;
 * docs/edge-cases-and-test-matrix.md sections 4 and 5.3). One throwaway account per variant,
 * because a frozen balance, a pool share, a raised threshold or a sponsorship makes an account
 * unmergeable; the issuers and the destination are shared helpers. Every account is created by the
 * Friendbot-funded fee sponsor, and every transaction not sourced by the sponsor is fee-bumped by
 * it. Each variant account starts with exactly the minimum balance it has once built, so it ends
 * with zero spendable XLM and never pays a fee.
 *
 * Protocol facts used here (https://developers.stellar.org/docs/tokens/control-asset-access):
 * AUTH_REQUIRED makes a trustline start unauthorized until the issuer authorizes it with
 * SetTrustLineFlags; AUTH_REVOCABLE lets the issuer revoke it (a freeze that also cancels the
 * holder's offers) or reduce it to AUTHORIZED_TO_MAINTAIN_LIABILITIES, which keeps the offers and
 * still lets the holder cancel them; AUTH_CLAWBACK_ENABLED needs AUTH_REVOCABLE and applies to
 * trustlines created after it is set; AUTH_IMMUTABLE means the account can never be merged.
 */

export type EdgeIssuerRole = "authIssuer" | "clawbackIssuer" | "plainIssuer";
export type EdgeVariantRole =
  | "authFrozen"
  | "authMaintain"
  | "authAuthorized"
  | "authRevoke"
  | "clawback"
  | "clawbackDrift"
  | "poolShare"
  | "multisig"
  | "claimable"
  | "immutable";
export type EdgeAccountRole = "sponsor" | "destination" | EdgeIssuerRole | EdgeVariantRole;
/** Every key a build creates: the accounts, plus the multisig variant's second signer (never funded). */
export type EdgeKeyRole = EdgeAccountRole | "multisigSigner";
export type EdgeRoles = Record<EdgeKeyRole, string>;

export type EdgeVariantName =
  | "auth-frozen"
  | "auth-maintain"
  | "auth-authorized"
  | "auth-revoke"
  | "clawback"
  | "clawback-drift"
  | "pool-share"
  | "multisig"
  | "claimable"
  | "immutable";

export type EdgeAssetCode = "FRZ" | "MNT" | "AUTH" | "RVK" | "CLAW" | "ILQX" | "LPA" | "LPB";

/** What the planner is expected to make of a variant right after the build. */
export interface EdgeExpectation {
  status: PlanStatus;
  blockers: BlockerCode[];
  unclosable: UnclosableCode[];
  /** Step kinds in plan order. */
  steps: CloseStepKind[];
}

export interface EdgeVariant {
  name: EdgeVariantName;
  role: EdgeVariantRole;
  /** The D3 matrix rows it serves (docs/edge-cases-and-test-matrix.md section 4). */
  rows: string[];
  summary: string;
  /** Dust paid by each asset's issuer during the build. */
  dust: Array<{ code: EdgeAssetCode; amount: string }>;
  /** Trustlines it opens, in this order (a pool-share trustline is written "LPA/LPB"). */
  trustlines: Array<EdgeAssetCode | "LPA/LPB">;
  dataEntry: boolean;
  /** Subentries and sponsored reserves once built (signers count as subentries). */
  subentries: number;
  numSponsoring: number;
  /** XLM that leaves the account during the build (the claimable balance it creates). */
  nativeOut: string;
  expected: EdgeExpectation;
}

const ISSUER_OF: Record<EdgeAssetCode, EdgeIssuerRole> = {
  FRZ: "authIssuer",
  MNT: "authIssuer",
  AUTH: "authIssuer",
  RVK: "authIssuer",
  CLAW: "clawbackIssuer",
  ILQX: "plainIssuer",
  LPA: "plainIssuer",
  LPB: "plainIssuer",
};

export const EDGE = {
  profile: "edge",
  /** Account flags set on the issuers before any trustline to them exists. */
  issuerFlags: {
    authIssuer: ["AUTH_REQUIRED", "AUTH_REVOCABLE"],
    clawbackIssuer: ["AUTH_REVOCABLE", "AUTH_CLAWBACK_ENABLED"],
    plainIssuer: [],
  } satisfies Record<EdgeIssuerRole, string[]>,
  /** Starting balances of the helpers; the variants start at their final minimum balance. */
  helperBalances: {
    destination: "2",
    authIssuer: "2",
    clawbackIssuer: "2",
    plainIssuer: "2",
  } satisfies Record<"destination" | EdgeIssuerRole, string>,
  dataEntry: { name: "dustin.fixture", value: "edge" },
  /** The auth-maintain variant's open offer: never filled, still cancellable after the downgrade. */
  maintainOffer: { selling: "MNT", amount: "0.0000002", price: "1000" },
  /** The pool-share variant deposits everything it holds into the new LPA/LPB pool. */
  pool: { deposit: "1", minPrice: { n: 1, d: 2 }, maxPrice: { n: 2, d: 1 } },
  multisig: { masterWeight: 1, signerWeight: 1, highThreshold: 2 },
  claimable: { amount: "0.0000001" },
  variants: [
    {
      name: "auth-frozen",
      role: "authFrozen",
      rows: ["S-02", "S-01"],
      summary:
        "FRZ from an AUTH_REQUIRED + AUTH_REVOCABLE issuer: authorized, dust paid, then authorization cleared (frozen). Also illiquid ILQX dust with a live issuer and no market, and a data entry.",
      dust: [
        { code: "FRZ", amount: "0.0000005" },
        { code: "ILQX", amount: "0.0000003" },
      ],
      trustlines: ["FRZ", "ILQX"],
      dataEntry: true,
      subentries: 3,
      numSponsoring: 0,
      nativeOut: "0",
      expected: {
        status: "partial",
        blockers: [],
        unclosable: ["TRUSTLINE_NOT_AUTHORIZED"],
        steps: ["dispose_balance", "remove_trustline", "remove_data"],
      },
    },
    {
      name: "auth-maintain",
      role: "authMaintain",
      rows: ["S-06"],
      summary:
        "MNT authorized, dust paid, an open offer selling MNT, then reduced to AUTHORIZED_TO_MAINTAIN_LIABILITIES: the offer stays and is cancellable, the balance cannot move.",
      dust: [{ code: "MNT", amount: "0.0000005" }],
      trustlines: ["MNT"],
      dataEntry: false,
      subentries: 2,
      numSponsoring: 0,
      nativeOut: "0",
      expected: {
        status: "partial",
        blockers: [],
        unclosable: ["MAINTAIN_LIABILITIES_ONLY"],
        steps: ["cancel_offer"],
      },
    },
    {
      name: "auth-authorized",
      role: "authAuthorized",
      rows: ["S-05"],
      summary:
        "AUTH from the AUTH_REQUIRED issuer, authorized, with dust: the ladder returns it to the issuer and the account closes.",
      dust: [{ code: "AUTH", amount: "0.0000003" }],
      trustlines: ["AUTH"],
      dataEntry: false,
      subentries: 1,
      numSponsoring: 0,
      nativeOut: "0",
      expected: {
        status: "closable",
        blockers: [],
        unclosable: [],
        steps: ["dispose_balance", "remove_trustline", "merge"],
      },
    },
    {
      name: "auth-revoke",
      role: "authRevoke",
      rows: ["S-02"],
      summary:
        "RVK authorized with dust and a data entry, closable when built; the live test revokes the trustline after planning, so the planned return to the issuer fails with op_src_not_authorized (AC-E3-S6-3).",
      dust: [{ code: "RVK", amount: "0.0000004" }],
      trustlines: ["RVK"],
      dataEntry: true,
      subentries: 2,
      numSponsoring: 0,
      nativeOut: "0",
      expected: {
        status: "closable",
        blockers: [],
        unclosable: [],
        steps: ["dispose_balance", "remove_trustline", "remove_data", "merge"],
      },
    },
    {
      name: "clawback",
      role: "clawback",
      rows: ["S-07"],
      summary:
        "CLAW from an AUTH_REVOCABLE + AUTH_CLAWBACK_ENABLED issuer, trusted after the flags were set (is_clawback_enabled), with dust: returned to the issuer, the account closes.",
      dust: [{ code: "CLAW", amount: "0.0000004" }],
      trustlines: ["CLAW"],
      dataEntry: false,
      subentries: 1,
      numSponsoring: 0,
      nativeOut: "0",
      expected: {
        status: "closable",
        blockers: [],
        unclosable: [],
        steps: ["dispose_balance", "remove_trustline", "merge"],
      },
    },
    {
      name: "clawback-drift",
      role: "clawbackDrift",
      rows: ["S-07"],
      summary:
        "A second CLAW holder for S-07b: the live test has the issuer claw the dust back after planning, so the return fails with op_underfunded and the executor re-plans.",
      dust: [{ code: "CLAW", amount: "0.0000004" }],
      trustlines: ["CLAW"],
      dataEntry: false,
      subentries: 1,
      numSponsoring: 0,
      nativeOut: "0",
      expected: {
        status: "closable",
        blockers: [],
        unclosable: [],
        steps: ["dispose_balance", "remove_trustline", "merge"],
      },
    },
    {
      name: "pool-share",
      role: "poolShare",
      rows: ["S-08"],
      summary:
        "Trustlines to LPA and LPB, the LPA/LPB pool-share trustline, a LiquidityPoolDeposit of all it holds, and a data entry.",
      dust: [
        { code: "LPA", amount: "1" },
        { code: "LPB", amount: "1" },
      ],
      trustlines: ["LPA", "LPB", "LPA/LPB"],
      dataEntry: true,
      // Two asset trustlines, a pool-share trustline worth two subentries, the data entry.
      subentries: 5,
      numSponsoring: 0,
      nativeOut: "0",
      expected: {
        status: "blocked",
        blockers: ["LIQUIDITY_POOL_SHARES"],
        unclosable: ["POOL_ASSET_TRUSTLINE", "POOL_ASSET_TRUSTLINE"],
        steps: ["remove_data"],
      },
    },
    {
      name: "multisig",
      role: "multisig",
      rows: ["S-09"],
      summary:
        "A second signer of weight 1 and a high threshold of 2 with master weight 1 (SetOptions), and a data entry.",
      dust: [],
      trustlines: [],
      dataEntry: true,
      subentries: 2,
      numSponsoring: 0,
      nativeOut: "0",
      expected: {
        status: "blocked",
        blockers: ["THRESHOLD_UNMET"],
        unclosable: [],
        steps: ["remove_data"],
      },
    },
    {
      name: "claimable",
      role: "claimable",
      rows: ["X-01"],
      summary:
        "Created a claimable balance of 0.0000001 XLM for the destination, so it sponsors that entry's reserve.",
      dust: [],
      trustlines: [],
      dataEntry: false,
      subentries: 0,
      numSponsoring: 1,
      nativeOut: "0.0000001",
      expected: { status: "blocked", blockers: ["IS_SPONSOR"], unclosable: [], steps: [] },
    },
    {
      name: "immutable",
      role: "immutable",
      rows: ["X-04"],
      summary: "AUTH_IMMUTABLE set with SetOptions: the account can never be merged.",
      dust: [],
      trustlines: [],
      dataEntry: false,
      subentries: 0,
      numSponsoring: 0,
      nativeOut: "0",
      expected: {
        status: "blocked",
        blockers: ["AUTH_IMMUTABLE_SET"],
        unclosable: [],
        steps: [],
      },
    },
  ] satisfies EdgeVariant[],
} as const;

export const EDGE_ACCOUNT_ROLES: readonly EdgeAccountRole[] = [
  "sponsor",
  "destination",
  "authIssuer",
  "clawbackIssuer",
  "plainIssuer",
  ...EDGE.variants.map((v) => v.role),
];

export const EDGE_KEY_ROLES: readonly EdgeKeyRole[] = [...EDGE_ACCOUNT_ROLES, "multisigSigner"];

export function edgeVariant(name: EdgeVariantName): EdgeVariant {
  const variants: readonly EdgeVariant[] = EDGE.variants;
  const found = variants.find((v) => v.name === name);
  if (!found) throw new Error(`unknown edge variant ${name}`);
  return found;
}

export function edgeAsset(code: EdgeAssetCode, roles: EdgeRoles): Asset {
  return new Asset(code, roles[ISSUER_OF[code]]);
}

export function edgeIssuerOf(code: EdgeAssetCode): EdgeIssuerRole {
  return ISSUER_OF[code];
}

/** The LPA/LPB constant-product pool (fee 30 bps, assets in protocol order; CAP-38). */
export function edgePool(roles: EdgeRoles): { asset: LiquidityPoolAsset; id: string } {
  const [a, b] = [edgeAsset("LPA", roles), edgeAsset("LPB", roles)].sort((x, y) =>
    Asset.compare(x, y),
  ) as [Asset, Asset];
  const asset = new LiquidityPoolAsset(a, b, LiquidityPoolFeeV18);
  const id = Buffer.from(
    getLiquidityPoolId("constant_product", asset.getLiquidityPoolParameters()),
  ).toString("hex");
  return { asset, id };
}

/**
 * A variant's starting balance: its minimum balance once built,
 * (2 + subentries + numSponsoring) x base reserve (CAP-33;
 * https://developers.stellar.org/docs/build/guides/transactions/sponsored-reserves), plus the XLM
 * that leaves it during the build. Every transaction it sources is fee-bumped, so it ends at
 * exactly its minimum: zero spendable.
 */
export function edgeStartingBalance(variant: EdgeVariant, baseReserveStroops: bigint): string {
  const units = BigInt(2 + variant.subentries + variant.numSponsoring);
  return formatStroops(units * baseReserveStroops + toStroops(variant.nativeOut));
}

export interface EdgeStep {
  name: string;
  /** Transaction source; every source but the fee sponsor is fee-bumped by it. */
  source: EdgeAccountRole;
  signers: EdgeKeyRole[];
  feeBumped: boolean;
  operations: xdr.Operation[];
  /** Verification check ids (`verifyEdgeFixture`) that must hold once the step applied. */
  settles: string[];
}

const byRole = (role: EdgeVariantRole): EdgeVariant => {
  const variants: readonly EdgeVariant[] = EDGE.variants;
  return variants.find((v) => v.role === role)!;
};

/** The ordered construction steps as a pure function of the public keys and the base reserve. */
export function edgeSteps(roles: EdgeRoles, baseReserveStroops: bigint): EdgeStep[] {
  const variants: readonly EdgeVariant[] = EDGE.variants;
  const asset = (code: EdgeAssetCode) => edgeAsset(code, roles);
  const pool = edgePool(roles);
  const data = (role: EdgeVariantRole) =>
    Operation.manageData({
      name: EDGE.dataEntry.name,
      value: EDGE.dataEntry.value,
      source: roles[role],
    });
  const holders = (filter: (v: EdgeVariant) => boolean) => variants.filter(filter);
  return [
    {
      name: "create-accounts",
      source: "sponsor",
      signers: ["sponsor"],
      feeBumped: false,
      operations: [
        ...(Object.entries(EDGE.helperBalances) as Array<[EdgeAccountRole, string]>).map(
          ([role, startingBalance]) =>
            Operation.createAccount({ destination: roles[role], startingBalance }),
        ),
        ...variants.map((v) =>
          Operation.createAccount({
            destination: roles[v.role],
            startingBalance: edgeStartingBalance(v, baseReserveStroops),
          }),
        ),
      ],
      settles: ["destination/exists"],
    },
    {
      // Before any trustline exists, so the clawback holders' trustlines get clawback enabled.
      name: "issuer-flags",
      source: "authIssuer",
      signers: ["authIssuer", "clawbackIssuer"],
      feeBumped: true,
      operations: [
        Operation.setOptions({ setFlags: AuthRequiredFlag | AuthRevocableFlag }),
        Operation.setOptions({
          setFlags: AuthRevocableFlag | AuthClawbackEnabledFlag,
          source: roles.clawbackIssuer,
        }),
      ],
      settles: ["authIssuer/flags", "clawbackIssuer/flags"],
    },
    {
      name: "trustlines",
      source: "authFrozen",
      signers: holders((v) => v.trustlines.length > 0).map((v) => v.role),
      feeBumped: true,
      operations: holders((v) => v.trustlines.length > 0).flatMap((v) =>
        v.trustlines.map((code) =>
          Operation.changeTrust({
            asset: code === "LPA/LPB" ? pool.asset : asset(code),
            source: roles[v.role],
          }),
        ),
      ),
      settles: ["clawback/claw-clawback-enabled", "clawbackDrift/claw-clawback-enabled"],
    },
    {
      name: "authorize",
      source: "authIssuer",
      signers: ["authIssuer"],
      feeBumped: true,
      operations: (["authFrozen", "authMaintain", "authAuthorized", "authRevoke"] as const).map(
        (role) =>
          Operation.setTrustLineFlags({
            trustor: roles[role],
            asset: asset(byRole(role).trustlines[0] as EdgeAssetCode),
            flags: { authorized: true },
          }),
      ),
      settles: ["authAuthorized/auth-authorized", "authRevoke/rvk-authorized"],
    },
    {
      name: "dust-payments",
      source: "plainIssuer",
      signers: ["authIssuer", "clawbackIssuer", "plainIssuer"],
      feeBumped: true,
      operations: variants.flatMap((v) =>
        v.dust.map((d) =>
          Operation.payment({
            destination: roles[v.role],
            asset: asset(d.code),
            amount: d.amount,
            source: roles[ISSUER_OF[d.code]],
          }),
        ),
      ),
      settles: ["clawback/claw-dust", "authAuthorized/auth-dust"],
    },
    {
      name: "holder-state",
      source: "authMaintain",
      signers: ["authMaintain", "authFrozen", "authRevoke", "poolShare", "multisig", "claimable"],
      feeBumped: true,
      operations: [
        // Priced far above any bid, so it rests (there is no other MNT order anyway).
        Operation.manageSellOffer({
          selling: asset(EDGE.maintainOffer.selling),
          buying: Asset.native(),
          amount: EDGE.maintainOffer.amount,
          price: EDGE.maintainOffer.price,
        }),
        data("authFrozen"),
        data("authRevoke"),
        // The pool is empty, so this deposits exactly the maximum amounts
        // (https://developers.stellar.org/docs/learn/fundamentals/transactions/list-of-operations#liquidity-pool-deposit).
        Operation.liquidityPoolDeposit({
          liquidityPoolId: pool.id,
          maxAmountA: EDGE.pool.deposit,
          maxAmountB: EDGE.pool.deposit,
          minPrice: EDGE.pool.minPrice,
          maxPrice: EDGE.pool.maxPrice,
          source: roles.poolShare,
        }),
        data("poolShare"),
        data("multisig"),
        Operation.createClaimableBalance({
          asset: Asset.native(),
          amount: EDGE.claimable.amount,
          claimants: [new Claimant(roles.destination, Claimant.predicateUnconditional())],
          source: roles.claimable,
        }),
      ],
      settles: [
        "authMaintain/offer",
        "poolShare/shares",
        "poolShare/data",
        "multisig/data",
        "claimable/sponsoring",
      ],
    },
    {
      // Last, because nothing may follow a freeze, a raised threshold or AUTH_IMMUTABLE.
      name: "restrict",
      source: "authIssuer",
      signers: ["authIssuer", "multisig", "immutable"],
      feeBumped: true,
      operations: [
        Operation.setTrustLineFlags({
          trustor: roles.authFrozen,
          asset: asset("FRZ"),
          flags: { authorized: false },
        }),
        Operation.setTrustLineFlags({
          trustor: roles.authMaintain,
          asset: asset("MNT"),
          flags: { authorized: false, authorizedToMaintainLiabilities: true },
        }),
        Operation.setOptions<{ ed25519PublicKey: string }>({
          signer: { ed25519PublicKey: roles.multisigSigner, weight: EDGE.multisig.signerWeight },
          masterWeight: EDGE.multisig.masterWeight,
          highThreshold: EDGE.multisig.highThreshold,
          source: roles.multisig,
        }),
        Operation.setOptions({ setFlags: AuthImmutableFlag, source: roles.immutable }),
      ],
      settles: [
        "authFrozen/frz-frozen",
        "authMaintain/mnt-maintain",
        "authMaintain/offer",
        "multisig/thresholds",
        "immutable/flag",
      ],
    },
  ];
}
