import { formatStroops, toStroops } from "../amounts.js";
import type {
  HorizonAccount,
  HorizonBalance,
  HorizonClaimableBalance,
  HorizonOffer,
} from "../inspect/horizon-types.js";
import { reserveFromHorizon } from "../inspect/reserve.js";
import { accountOffers, latestLedger, type HorizonJsonClient } from "../reader/horizon-json.js";
import { horizonReader } from "../reader/ledger-reader.js";
import {
  EDGE,
  EDGE_ASSET_CODES,
  edgeIssuerOf,
  type EdgeAccountRole,
  type EdgeAssetCode,
  type EdgeIssuerRole,
  type EdgeRoles,
  type EdgeVariant,
  type EdgeVariantRole,
} from "./edge.js";
import { describeMissing, type MissingAccount } from "./reset.js";
import type { VerifyCheck, VerifyResult } from "./verify.js";

/** What the edge checks read from Horizon: GET requests only. */
export interface EdgeVerifyInput {
  roles: EdgeRoles;
  poolId: string;
  baseReserve: bigint;
  /** `null` when Horizon answers 404. */
  accounts: Partial<Record<EdgeAccountRole, HorizonAccount | null>>;
  offers: Partial<Record<EdgeVariantRole, HorizonOffer[]>>;
  /** Claimable balances each variant sponsors (GET /claimable_balances?sponsor=). */
  claimableSponsored: Partial<Record<EdgeVariantRole, number>>;
  /** Claimable balances that name a variant as a claimant (GET /claimable_balances?claimant=). */
  claimableClaimant?: Partial<Record<EdgeVariantRole, HorizonClaimableBalance[]>>;
  /**
   * The variants the fixture was built with: a manifest's `variants`. Default: every variant of the
   * recipe. A manifest written before a variant was added does not list it, and nothing is checked
   * or read for it (E4-S3 added offer-types, offer-stale and claimant).
   */
  variants?: readonly EdgeVariantRole[];
  /** Horizon's latest ledger when the input was read (the reset check compares it, X-15). */
  latestLedger?: number;
  /**
   * Why each account that answers 404 is missing, as the reset check found it (X-15): merged, with
   * the ledger and hash of the merge; gone without a merge among its latest operations; or never
   * seen by Horizon.
   */
  missing?: Partial<Record<EdgeAccountRole, MissingAccount>>;
}

const HELPERS = ["destination", "authIssuer", "clawbackIssuer", "plainIssuer"] as const;

function creditLine(
  account: HorizonAccount | null | undefined,
  code: EdgeAssetCode,
  roles: EdgeRoles,
): HorizonBalance | undefined {
  const issuer = roles[edgeIssuerOf(code)];
  return account?.balances.find((b) => b.asset_code === code && b.asset_issuer === issuer);
}

function describeLine(line: HorizonBalance | undefined): string {
  if (!line) return "no trustline";
  return (
    `balance ${line.balance}, is_authorized ${String(line.is_authorized === true)}, ` +
    `is_authorized_to_maintain_liabilities ${String(line.is_authorized_to_maintain_liabilities === true)}` +
    (line.is_clawback_enabled ? ", is_clawback_enabled true" : "")
  );
}

function flagsOf(account: HorizonAccount | null | undefined): string {
  if (!account) return "account missing";
  const f = account.flags;
  const set = [
    f.auth_required ? "AUTH_REQUIRED" : "",
    f.auth_revocable ? "AUTH_REVOCABLE" : "",
    f.auth_immutable ? "AUTH_IMMUTABLE" : "",
    f.auth_clawback_enabled ? "AUTH_CLAWBACK_ENABLED" : "",
  ].filter(Boolean);
  return set.length ? set.join(" + ") : "none";
}

/**
 * Checks every account of an edge fixture against its recipe. Pure; no I/O. Check ids are
 * `<role>/<check>`, so a builder step can wait for the ones it settles.
 */
export function verifyEdgeFixture(input: EdgeVerifyInput): VerifyResult {
  const { roles, accounts } = input;
  const recipe: readonly EdgeVariant[] = EDGE.variants;
  const built = new Set(input.variants ?? recipe.map((v) => v.role));
  const has = (role: EdgeVariantRole) => built.has(role);
  const checks: VerifyCheck[] = [];
  const add = (id: string, label: string, pass: boolean, observed: string, expected: string) =>
    checks.push({ id, label, appendixB: false, pass, observed, expected });
  const missing = (role: EdgeAccountRole) => describeMissing(input.missing?.[role]);

  for (const role of HELPERS) {
    const account = accounts[role];
    add(
      `${role}/exists`,
      `${role} exists`,
      Boolean(account),
      account ? "exists" : missing(role),
      "exists",
    );
  }
  const issuerFlags: Record<EdgeIssuerRole, readonly string[]> = EDGE.issuerFlags;
  for (const role of ["authIssuer", "clawbackIssuer", "plainIssuer"] as const) {
    const expected = issuerFlags[role].length ? issuerFlags[role].join(" + ") : "none";
    const observed = flagsOf(accounts[role]);
    add(`${role}/flags`, `${role} account flags`, observed === expected, observed, expected);
  }
  const edgeKeys = new Set(EDGE_ASSET_CODES.map((code) => `${code}:${roles[edgeIssuerOf(code)]}`));
  const destinationLines = (accounts.destination?.balances ?? []).filter((b) =>
    edgeKeys.has(`${b.asset_code}:${b.asset_issuer}`),
  );
  add(
    "destination/no-edge-trustlines",
    "the destination holds no trustline for an edge asset (so no transfer to it is possible)",
    destinationLines.length === 0,
    destinationLines.length ? destinationLines.map((b) => b.asset_code).join(", ") : "none",
    "none",
  );

  const variants = recipe.filter((v) => has(v.role));
  for (const variant of variants) {
    const role = variant.role;
    const account = accounts[role];
    const id = (check: string) => `${role}/${check}`;
    add(
      id("exists"),
      `${variant.name} exists`,
      Boolean(account),
      account ? "exists" : missing(role),
      "exists",
    );
    if (!account) continue;
    const reserve = reserveFromHorizon(account, input.baseReserve);
    add(
      id("zero-spendable"),
      `${variant.name} holds zero spendable XLM`,
      reserve.spendable === 0n,
      `balance ${formatStroops(reserve.balance)}, minimum ${formatStroops(reserve.minimum)}, spendable ${formatStroops(reserve.spendable)}`,
      "spendable 0.0000000",
    );
    add(
      id("subentries"),
      `${variant.name} subentries and sponsored reserves`,
      account.subentry_count === variant.subentries &&
        account.num_sponsoring === variant.numSponsoring,
      `subentry_count ${account.subentry_count}, num_sponsoring ${account.num_sponsoring}`,
      `subentry_count ${variant.subentries}, num_sponsoring ${variant.numSponsoring}`,
    );
    for (const d of variant.dust.filter((x) => !["LPA", "LPB"].includes(x.code))) {
      const line = creditLine(account, d.code, roles);
      add(
        id(`${d.code.toLowerCase()}-dust`),
        `${variant.name} holds ${d.amount} ${d.code}`,
        line !== undefined && toStroops(line.balance) === toStroops(d.amount),
        describeLine(line),
        `balance ${formatStroops(toStroops(d.amount))}`,
      );
    }
    if (variant.dataEntry) {
      const present = EDGE.dataEntry.name in account.data;
      add(
        id("data"),
        `${variant.name} has the data entry ${EDGE.dataEntry.name}`,
        present,
        present ? "present" : "absent",
        "present",
      );
    }
  }

  const line = (role: EdgeVariantRole, code: EdgeAssetCode) =>
    creditLine(accounts[role], code, roles);
  const authorized = (l: HorizonBalance | undefined) => l?.is_authorized === true;
  const maintainOnly = (l: HorizonBalance | undefined) =>
    l !== undefined && l.is_authorized !== true && l.is_authorized_to_maintain_liabilities === true;
  const frozen = (l: HorizonBalance | undefined) =>
    l !== undefined && l.is_authorized !== true && l.is_authorized_to_maintain_liabilities !== true;

  const name = (role: EdgeVariantRole) => recipe.find((v) => v.role === role)!.name;
  if (has("authFrozen")) {
    const frz = line("authFrozen", "FRZ");
    add(
      "authFrozen/frz-frozen",
      "auth-frozen: the FRZ trustline is not authorized (frozen)",
      frozen(frz),
      describeLine(frz),
      "is_authorized false, is_authorized_to_maintain_liabilities false",
    );
    const ilqx = line("authFrozen", "ILQX");
    add(
      "authFrozen/ilqx-authorized",
      "auth-frozen: the ILQX trustline is authorized",
      authorized(ilqx),
      describeLine(ilqx),
      "is_authorized true",
    );
  }
  if (has("authMaintain")) {
    const mnt = line("authMaintain", "MNT");
    add(
      "authMaintain/mnt-maintain",
      "auth-maintain: the MNT trustline is authorized to maintain liabilities only",
      maintainOnly(mnt),
      describeLine(mnt),
      "is_authorized false, is_authorized_to_maintain_liabilities true",
    );
    const offers = input.offers.authMaintain ?? [];
    const mntOffer = offers.filter(
      (o) =>
        o.selling.asset_code === EDGE.maintainOffer.selling &&
        o.selling.asset_issuer === roles.authIssuer &&
        o.buying.asset_type === "native" &&
        toStroops(o.amount) === toStroops(EDGE.maintainOffer.amount),
    );
    add(
      "authMaintain/offer",
      "auth-maintain: one open offer selling MNT for XLM",
      offers.length === 1 && mntOffer.length === 1,
      offers.length
        ? offers
            .map((o) => `offer ${o.id} sells ${o.amount} ${o.selling.asset_code ?? "XLM"}`)
            .join("; ")
        : "no offer",
      `one offer selling ${EDGE.maintainOffer.amount} MNT for XLM`,
    );
  }
  for (const [role, code] of [
    ["authAuthorized", "AUTH"],
    ["authRevoke", "RVK"],
  ] as const) {
    if (!has(role)) continue;
    const l = line(role, code);
    add(
      `${role}/${code.toLowerCase()}-authorized`,
      `${name(role)}: the ${code} trustline is authorized`,
      authorized(l),
      describeLine(l),
      "is_authorized true",
    );
  }
  for (const role of ["clawback", "clawbackDrift"] as const) {
    if (!has(role)) continue;
    const l = line(role, "CLAW");
    add(
      `${role}/claw-clawback-enabled`,
      `${name(role)}: Horizon shows is_clawback_enabled on the CLAW trustline`,
      l?.is_clawback_enabled === true && authorized(l),
      describeLine(l),
      "is_authorized true, is_clawback_enabled true",
    );
  }
  if (has("poolShare")) {
    const pool = accounts.poolShare?.balances.find(
      (b) => b.asset_type === "liquidity_pool_shares" && b.liquidity_pool_id === input.poolId,
    );
    add(
      "poolShare/shares",
      `pool-share: holds shares of pool ${input.poolId}`,
      pool !== undefined && toStroops(pool.balance) > 0n,
      pool ? `${pool.balance} shares` : "no pool-share trustline",
      "a non-zero share balance",
    );
    const assetLines = (["LPA", "LPB"] as const).filter((code) => line("poolShare", code));
    add(
      "poolShare/asset-lines",
      "pool-share: holds the pool's LPA and LPB trustlines",
      assetLines.length === 2,
      assetLines.join(", ") || "none",
      "LPA, LPB",
    );
  }
  if (has("multisig")) {
    const multisig = accounts.multisig;
    const master = multisig?.signers.find((s) => s.key === multisig.account_id)?.weight ?? 0;
    const second = multisig?.signers.find((s) => s.key === roles.multisigSigner)?.weight ?? 0;
    const high = multisig?.thresholds.high_threshold ?? 0;
    add(
      "multisig/thresholds",
      "multisig: master weight 1, a second signer of weight 1, high threshold 2",
      master === EDGE.multisig.masterWeight &&
        second === EDGE.multisig.signerWeight &&
        high === EDGE.multisig.highThreshold,
      `master weight ${master}, second signer weight ${second}, high threshold ${high}`,
      `master weight ${EDGE.multisig.masterWeight}, second signer weight ${EDGE.multisig.signerWeight}, high threshold ${EDGE.multisig.highThreshold}`,
    );
  }
  if (has("claimable")) {
    const sponsored = input.claimableSponsored.claimable ?? 0;
    add(
      "claimable/sponsoring",
      "claimable: sponsors the claimable balance it created",
      accounts.claimable?.num_sponsoring === 1 && sponsored === 1,
      `num_sponsoring ${accounts.claimable?.num_sponsoring ?? "?"}, claimable balances sponsored ${sponsored}`,
      "num_sponsoring 1, claimable balances sponsored 1",
    );
  }
  if (has("immutable")) {
    add(
      "immutable/flag",
      "immutable: AUTH_IMMUTABLE is set",
      accounts.immutable?.flags.auth_immutable === true,
      flagsOf(accounts.immutable),
      "AUTH_IMMUTABLE",
    );
  }
  // The checks of the variants added in E4-S3 come last, so the ids of a fixture built before
  // them keep their order.
  const assetOf = (a: { asset_type: string; asset_code?: string; asset_issuer?: string }) =>
    a.asset_type === "native" ? "XLM" : `${a.asset_code ?? "?"}:${a.asset_issuer ?? "?"}`;
  const key = (code: string) =>
    code === "native" ? "XLM" : `${code}:${roles[edgeIssuerOf(code as EdgeAssetCode)]}`;
  const describeOffers = (list: readonly HorizonOffer[]) =>
    list.length
      ? list
          .map(
            (o) =>
              `offer ${o.id} sells ${o.amount} ${o.selling.asset_code ?? "XLM"} for ${o.buying.asset_code ?? "XLM"} at ${o.price_r.n}/${o.price_r.d}`,
          )
          .join("; ")
      : "no offer";
  const offerLike = (
    o: HorizonOffer,
    selling: string,
    buying: string,
    amount: string,
    price: { n: number; d: number },
  ) =>
    assetOf(o.selling) === key(selling) &&
    assetOf(o.buying) === key(buying) &&
    toStroops(o.amount) === toStroops(amount) &&
    o.price_r.n * price.d === price.n * o.price_r.d;
  if (has("offerTypes")) {
    const t = EDGE.offerTypes;
    const list = input.offers.offerTypes ?? [];
    // A buy offer is stored as the sell offer it amounts to: it sells buyAmount x price of its
    // selling asset at the inverse price (observed on testnet, 2026-09-28).
    const buySold = formatStroops(toStroops(t.buy.buyAmount) * BigInt(t.buy.price));
    const found = [
      list.some((o) =>
        offerLike(o, t.sellsXlm.selling, t.sellsXlm.buying, t.sellsXlm.amount, { n: 1, d: 1 }),
      ),
      list.some((o) =>
        offerLike(o, t.buy.selling, t.buy.buying, buySold, { n: 1, d: Number(t.buy.price) }),
      ),
      list.some((o) =>
        offerLike(o, t.passive.selling, t.passive.buying, t.passive.amount, { n: 1, d: 1 }),
      ),
    ];
    add(
      "offerTypes/offers",
      "offer-types: an offer selling XLM for OFA, a buy offer paying OFB for XLM, a passive offer selling OFA for OFB",
      list.length === 3 && found.every(Boolean),
      describeOffers(list),
      `offers selling ${t.sellsXlm.amount} XLM for OFA at 1/1, ${buySold} OFB for XLM at 1/${t.buy.price}, ${t.passive.amount} OFA for OFB at 1/1`,
    );
    const native = accounts.offerTypes?.balances.find((b) => b.asset_type === "native");
    const liabilities = formatStroops(toStroops(native?.selling_liabilities ?? "0"));
    add(
      "offerTypes/xlm-liabilities",
      "offer-types: its offer selling XLM holds native selling liabilities",
      toStroops(liabilities) === toStroops(t.sellsXlm.amount),
      `native selling liabilities ${liabilities}`,
      `native selling liabilities ${formatStroops(toStroops(t.sellsXlm.amount))}`,
    );
  }
  if (has("offerStale")) {
    const o = EDGE.staleOffer;
    const list = input.offers.offerStale ?? [];
    add(
      "offerStale/offer",
      "offer-stale: one open offer selling its OFC for XLM",
      list.length === 1 &&
        list.every((x) => offerLike(x, o.selling, "native", o.amount, { n: 1, d: 1 })),
      describeOffers(list),
      `one offer selling ${o.amount} OFC for XLM at 1/1`,
    );
  }
  if (has("claimant")) {
    const list = input.claimableClaimant?.claimant ?? [];
    const want = EDGE.claimantBalances.map(
      (b) => `${formatStroops(toStroops(b.amount))} ${key(b.asset)}`,
    );
    const seen = list.map(
      (b) => `${formatStroops(toStroops(b.amount))} ${b.asset === "native" ? "XLM" : b.asset}`,
    );
    add(
      "claimant/claimable",
      "claimant: named as a claimant of the plain issuer's two claimable balances",
      seen.length === want.length && want.every((w) => seen.includes(w)),
      seen.length ? seen.join(", ") : "none",
      want.join(", "),
    );
  }
  return { pass: checks.every((c) => c.pass), checks };
}

/**
 * Reads what `verifyEdgeFixture` checks from Horizon, for the variants the fixture was built with
 * (default: every variant of the recipe). GET requests only.
 */
export async function loadEdgeVerifyInput(
  client: HorizonJsonClient,
  roles: EdgeRoles,
  poolId: string,
  variants?: readonly EdgeVariantRole[],
): Promise<EdgeVerifyInput> {
  const recipe: readonly EdgeVariant[] = EDGE.variants;
  const built = recipe.map((v) => v.role).filter((r) => !variants || variants.includes(r));
  const has = (role: EdgeVariantRole) => built.includes(role);
  const reader = horizonReader(client);
  const accountRoles: EdgeAccountRole[] = [...HELPERS, ...built];
  const offersOf = (role: EdgeVariantRole) =>
    has(role) ? accountOffers(client, roles[role]) : Promise.resolve(undefined);
  const [ledger, records, maintain, types, stale, claimable, claimant] = await Promise.all([
    latestLedger(client),
    Promise.all(accountRoles.map((role) => client.get<HorizonAccount>(`/accounts/${roles[role]}`))),
    offersOf("authMaintain"),
    offersOf("offerTypes"),
    offersOf("offerStale"),
    has("claimable") ? reader.claimableBalancesSponsoredBy(roles.claimable) : Promise.resolve(0),
    has("claimant") && reader.claimableBalancesClaimableBy
      ? reader.claimableBalancesClaimableBy(roles.claimant)
      : Promise.resolve(undefined),
  ]);
  const offers: EdgeVerifyInput["offers"] = {};
  if (maintain) offers.authMaintain = maintain;
  if (types) offers.offerTypes = types;
  if (stale) offers.offerStale = stale;
  return {
    roles,
    poolId,
    baseReserve: BigInt(ledger.base_reserve_in_stroops),
    accounts: Object.fromEntries(accountRoles.map((role, i) => [role, records[i] ?? null])),
    offers,
    claimableSponsored: has("claimable") ? { claimable } : {},
    ...(claimant ? { claimableClaimant: { claimant } } : {}),
    variants: built,
    latestLedger: ledger.sequence,
  };
}
