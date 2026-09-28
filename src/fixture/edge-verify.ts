import { formatStroops, toStroops } from "../amounts.js";
import type { HorizonAccount, HorizonBalance, HorizonOffer } from "../inspect/horizon-types.js";
import { reserveFromHorizon } from "../inspect/reserve.js";
import { accountOffers, latestLedger, type HorizonJsonClient } from "../reader/horizon-json.js";
import { horizonReader } from "../reader/ledger-reader.js";
import {
  EDGE,
  edgeIssuerOf,
  type EdgeAccountRole,
  type EdgeAssetCode,
  type EdgeIssuerRole,
  type EdgeRoles,
  type EdgeVariant,
  type EdgeVariantRole,
} from "./edge.js";
import { describeClosed, type MergeRecord } from "./reset.js";
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
  /** Horizon's latest ledger when the input was read (the reset check compares it, X-15). */
  latestLedger?: number;
  /** The merges that removed accounts which answer 404 while Horizon holds the merge (X-15). */
  closed?: Partial<Record<EdgeAccountRole, MergeRecord>>;
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
  const checks: VerifyCheck[] = [];
  const add = (id: string, label: string, pass: boolean, observed: string, expected: string) =>
    checks.push({ id, label, appendixB: false, pass, observed, expected });
  const missing = (role: EdgeAccountRole) => {
    const closed = input.closed?.[role];
    return closed ? `Horizon answered 404: ${describeClosed(closed)}` : "Horizon answered 404";
  };

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
  const edgeKeys = new Set(
    (["FRZ", "MNT", "AUTH", "RVK", "CLAW", "ILQX", "LPA", "LPB"] as const).map(
      (code) => `${code}:${roles[edgeIssuerOf(code)]}`,
    ),
  );
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

  const variants: readonly EdgeVariant[] = EDGE.variants;
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
  const name = (role: EdgeVariantRole) => variants.find((v) => v.role === role)!.name;
  for (const [role, code] of [
    ["authAuthorized", "AUTH"],
    ["authRevoke", "RVK"],
  ] as const) {
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
    const l = line(role, "CLAW");
    add(
      `${role}/claw-clawback-enabled`,
      `${name(role)}: Horizon shows is_clawback_enabled on the CLAW trustline`,
      l?.is_clawback_enabled === true && authorized(l),
      describeLine(l),
      "is_authorized true, is_clawback_enabled true",
    );
  }
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
  const sponsored = input.claimableSponsored.claimable ?? 0;
  add(
    "claimable/sponsoring",
    "claimable: sponsors the claimable balance it created",
    accounts.claimable?.num_sponsoring === 1 && sponsored === 1,
    `num_sponsoring ${accounts.claimable?.num_sponsoring ?? "?"}, claimable balances sponsored ${sponsored}`,
    "num_sponsoring 1, claimable balances sponsored 1",
  );
  add(
    "immutable/flag",
    "immutable: AUTH_IMMUTABLE is set",
    accounts.immutable?.flags.auth_immutable === true,
    flagsOf(accounts.immutable),
    "AUTH_IMMUTABLE",
  );
  return { pass: checks.every((c) => c.pass), checks };
}

/** Reads what `verifyEdgeFixture` checks from Horizon. GET requests only. */
export async function loadEdgeVerifyInput(
  client: HorizonJsonClient,
  roles: EdgeRoles,
  poolId: string,
): Promise<EdgeVerifyInput> {
  const variants: readonly EdgeVariant[] = EDGE.variants;
  const reader = horizonReader(client);
  const accountRoles: EdgeAccountRole[] = [...HELPERS, ...variants.map((v) => v.role)];
  const [ledger, records, offers, claimable] = await Promise.all([
    latestLedger(client),
    Promise.all(accountRoles.map((role) => client.get<HorizonAccount>(`/accounts/${roles[role]}`))),
    accountOffers(client, roles.authMaintain),
    reader.claimableBalancesSponsoredBy(roles.claimable),
  ]);
  return {
    roles,
    poolId,
    baseReserve: BigInt(ledger.base_reserve_in_stroops),
    accounts: Object.fromEntries(accountRoles.map((role, i) => [role, records[i] ?? null])),
    offers: { authMaintain: offers },
    claimableSponsored: { claimable },
    latestLedger: ledger.sequence,
  };
}
