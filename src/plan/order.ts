import { Asset, LiquidityPoolFeeV18, getLiquidityPoolId } from "@stellar/stellar-sdk";
import { formatStroops, toStroops } from "../amounts.js";
import type {
  AssetRef,
  ExistingAccountSnapshot,
  OfferInfo,
  PoolShareInfo,
  TrustlineInfo,
} from "../inspect/snapshot.js";
import { assetKey } from "../inspect/snapshot.js";
import { mergeBlockers, signingCapability } from "./blockers.js";
import { LADDER_ORDERS, chooseRung } from "./ladder.js";
import type {
  Blocker,
  CloseStep,
  DisposalDecision,
  LadderOrder,
  PlanOptions,
  PlanStatus,
  TransactionPhase,
  UnclosableItem,
} from "./model.js";

/** Steps that must stay in one transaction, tagged with their phase (canonical decision 6). */
export interface PlanUnit {
  phase: TransactionPhase;
  steps: CloseStep[];
}

export interface OrderResult {
  units: PlanUnit[];
  unclosable: UnclosableItem[];
  blockers: Blocker[];
  warnings: string[];
  status: PlanStatus;
  ladderOrder: LadderOrder;
}

const label = (a: AssetRef) => (a.type === "native" ? "XLM" : a.code);
const sentence = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

type Draft = Omit<CloseStep, "id" | "dependsOn"> & { ref: number; deps: number[] };

/**
 * The ordering engine (architecture section 5.1; PRD section 8). Pure: it reads only the snapshot.
 * R1 offers first; R2 dispose before removing; R3 sponsored trustlines are removed by the owner
 * like any other; R4 data entries any time before the merge; R5 signers are left to the merge;
 * R6 held pool shares are reported, never touched, and an empty pool-share trustline is removed
 * before its pool's asset trustlines; R7 the merge last; R9 market-dependent steps isolated.
 * Units come out in execution order: cleanup, then conversions, then the merge.
 */
export function orderClose(s: ExistingAccountSnapshot, options: PlanOptions): OrderResult {
  const ladderOrder: LadderOrder = options.preferDestination ? "prefer-destination" : "sow";
  const memo = options.memo ?? null;
  const blockers = mergeBlockers(s, memo);
  const signing = signingCapability(s);
  const unclosable: UnclosableItem[] = [];
  const warnings: string[] = [];
  if (!signing.cleanup) {
    return { units: [], unclosable, blockers, warnings, status: "blocked", ladderOrder };
  }

  let nextRef = 0;
  const draft = (step: Omit<Draft, "ref">): Draft => ({ ...step, ref: nextRef++ });

  const cancels = s.offers.map((offer) =>
    draft({
      kind: "cancel_offer",
      txIndex: -1,
      subject: {
        type: "offer",
        offerId: offer.id,
        selling: offer.selling,
        buying: offer.buying,
        amount: offer.amount,
      },
      reason:
        `Open offer ${offer.id} sells ${offer.amount} ${label(offer.selling)} for ${label(offer.buying)}. ` +
        "Offers are subentries that block the merge, and their liabilities stop the balance from moving and the trustline from being removed; it is cancelled with amount 0.",
      deps: [],
      threshold: "medium",
      operation: {
        type: "manageSellOffer",
        offerId: offer.id,
        selling: offer.selling,
        buying: offer.buying,
        amount: "0",
        price: offer.price,
      },
      feeEstimateStroops: 0,
    }),
  );
  const cancelRefsTouching = (key: string) =>
    cancels
      .filter((c) => {
        const o = c.subject as Extract<CloseStep["subject"], { type: "offer" }>;
        return assetKey(o.selling) === key || assetKey(o.buying) === key;
      })
      .map((c) => c.ref);

  // A pool's asset trustlines cannot be deleted while a share trustline references the pool
  // (CHANGE_TRUST_CANNOT_DELETE). Held shares stay (withdrawal is out of scope), so their assets'
  // trustlines stay too; an empty share trustline is removed first and unblocks them.
  const pools = resolvePools(s, warnings);
  const unresolved = pools.filter((p) => p.assets === null).map((p) => p.poolId);
  const held = pools.filter((p) => toStroops(p.balance) > 0n);
  const poolAssets = new Set(held.flatMap((p) => p.assets ?? []));
  const poolUnits: Draft[][] = [];
  const poolRemovalsFor = new Map<string, number[]>();
  for (const pool of pools.filter((p) => toStroops(p.balance) === 0n)) {
    const subject = {
      type: "pool_share" as const,
      poolId: pool.poolId,
      balance: pool.balance,
      sponsor: pool.sponsor,
    };
    const [a, b] = pool.assets ?? [];
    if (a === undefined || b === undefined) {
      unclosable.push({
        code: "LIQUIDITY_POOL_SHARES",
        subject,
        reason: `The empty share trustline of liquidity pool ${pool.poolId} cannot be removed: Horizon did not return the pool and no pair of this account's assets hashes to its id, so its two assets, which the removal must name, are unknown.`,
        remedy:
          "Check the pool on Horizon (/liquidity_pools/{id}) and run the plan again, or remove the pool-share trustline outside Dustin.",
        blocksMerge: true,
      });
      continue;
    }
    const remove = poolShareRemoval(draft, pool, [a, b], s.reserve.baseReserve);
    poolUnits.push([remove]);
    for (const asset of [a, b]) {
      poolRemovalsFor.set(asset, [...(poolRemovalsFor.get(asset) ?? []), remove.ref]);
    }
  }

  const cleanupUnits: Draft[][] = [];
  const convertUnits: Draft[][] = [];
  for (const line of s.trustlines) {
    const key = assetKey(line.asset);
    const subject = {
      type: "trustline" as const,
      asset: line.asset,
      balance: line.balance,
      sponsor: line.sponsor,
    };
    if (poolAssets.has(key)) {
      unclosable.push({
        code: "POOL_ASSET_TRUSTLINE",
        subject,
        reason: `The ${line.asset.code} trustline cannot be removed while the account holds shares of a liquidity pool that uses ${line.asset.code} (CHANGE_TRUST_CANNOT_DELETE).`,
        remedy:
          "Withdraw from the pool and remove the pool-share trustline first, then run the plan again.",
        blocksMerge: true,
      });
      continue;
    }
    // A pool that cannot be resolved may use any of the account's assets, and removing one of them
    // would fail the whole transaction on CHANGE_TRUST_CANNOT_DELETE, fee included (review
    // finding R13), so every credit trustline stays until the pool is known.
    if (unresolved.length > 0) {
      const which =
        unresolved.length === 1
          ? `liquidity pool ${unresolved[0]}, whose share trustline this account holds: Horizon did not return the pool and no pair of this account's assets hashes to its id`
          : `one of the liquidity pools ${unresolved.join(", ")}, whose share trustlines this account holds: Horizon did not return them and no pair of this account's assets hashes to their ids`;
      unclosable.push({
        code: "POOL_ASSET_TRUSTLINE",
        subject,
        reason: `The ${line.asset.code} trustline is kept because it may belong to ${which}. A pool's asset trustline cannot be removed while the account holds the pool's share trustline (CHANGE_TRUST_CANNOT_DELETE).`,
        remedy:
          "Check the pool on Horizon (/liquidity_pools/{id}) and run the plan again, or remove the pool-share trustline outside Dustin first.",
        blocksMerge: true,
      });
      continue;
    }
    if (line.clawbackEnabled && toStroops(line.balance) > 0n) {
      warnings.push(
        `Trustline ${key} is clawback-enabled: the issuer can change this balance before execution; the executor re-plans if that happens.`,
      );
    }
    const touching = [...cancelRefsTouching(key), ...(poolRemovalsFor.get(key) ?? [])];
    if (toStroops(line.balance) === 0n) {
      cleanupUnits.push([removal(draft, line, touching, "")]);
      continue;
    }
    const route = chooseRung(s, line, {
      order: ladderOrder,
      slippageBps: options.slippageBps ?? 100,
      memo,
    });
    if (!route.ok) {
      unclosable.push({
        code: route.code,
        subject,
        reason: route.reason,
        remedy: route.remedy,
        blocksMerge: true,
        ...(route.ruledOut.length ? { rungsRuledOut: route.ruledOut } : {}),
      });
      continue;
    }
    const dispose = disposal(
      draft,
      s,
      line,
      route.decision,
      cancels.map((c) => c.ref),
      ladderOrder,
    );
    const remove = removal(
      draft,
      line,
      [dispose.ref, ...touching],
      " once the balance is disposed of",
    );
    (route.decision.rung === "path_payment" ? convertUnits : cleanupUnits).push([dispose, remove]);
  }

  const dataUnits = s.data.map((entry) => [
    draft({
      kind: "remove_data",
      txIndex: -1,
      subject: { type: "data", name: entry.name },
      reason: `Data entry "${entry.name}" is a subentry that blocks the merge; a manage-data operation without a value deletes it.`,
      deps: [],
      threshold: "medium",
      operation: { type: "manageData", name: entry.name, value: null },
      feeEstimateStroops: 0,
    }),
  ]);

  const ordered: Array<{ phase: TransactionPhase; drafts: Draft[] }> = [
    ...cancels.map((c) => ({ phase: "cleanup" as const, drafts: [c] })),
    ...poolUnits.map((u) => ({ phase: "cleanup" as const, drafts: u })),
    ...cleanupUnits.map((u) => ({ phase: "cleanup" as const, drafts: u })),
    ...dataUnits.map((u) => ({ phase: "cleanup" as const, drafts: u })),
    ...convertUnits.map((u) => ({ phase: "convert" as const, drafts: u })),
  ];
  const destination = s.destination?.account ?? options.destination;
  if (blockers.length === 0 && unclosable.length === 0) {
    const everything = ordered.flatMap((u) => u.drafts.map((d) => d.ref));
    ordered.push({
      phase: "merge",
      drafts: [
        draft({
          kind: "merge",
          txIndex: -1,
          subject: { type: "account", destination },
          reason:
            "Every subentry is removed by the earlier steps; the account sponsors nothing, is not immutable and the destination exists. " +
            `The merge sends the whole XLM balance to ${destination} and deletes the account. It cannot be undone.`,
          deps: everything,
          threshold: "high",
          operation: { type: "accountMerge", destination },
          feeEstimateStroops: 0,
        }),
      ],
    });
  }

  // Final ids follow execution order: S01, S02, ...
  const ids = new Map<number, string>();
  ordered
    .flatMap((u) => u.drafts)
    .forEach((d, i) => ids.set(d.ref, `S${String(i + 1).padStart(2, "0")}`));
  const units: PlanUnit[] = ordered.map((u) => ({
    phase: u.phase,
    steps: u.drafts.map(({ ref, deps, ...rest }) => ({
      id: ids.get(ref)!,
      ...rest,
      dependsOn: deps.map((d) => ids.get(d)!),
    })),
  }));

  const status: PlanStatus =
    blockers.length > 0 ? "blocked" : unclosable.length > 0 ? "partial" : "closable";
  return { units, unclosable, blockers, warnings, status, ladderOrder };
}

/**
 * The account's pool shares with each pool's assets as Horizon returned them or, when Horizon did
 * not return the pool, derived from its id (review finding R13). A derived pool is planned exactly
 * as if Horizon had returned it; a pool that cannot be derived keeps `assets: null`.
 */
function resolvePools(s: ExistingAccountSnapshot, warnings: string[]): PoolShareInfo[] {
  const missing = s.poolShares.filter((p) => p.assets === null).map((p) => p.poolId);
  if (missing.length === 0) return s.poolShares;
  const derived = derivePoolAssets(missing, s.trustlines);
  return s.poolShares.map((pool) => {
    if (pool.assets !== null) return pool;
    const assets = derived.get(pool.poolId) ?? null;
    warnings.push(
      assets
        ? `Liquidity pool ${pool.poolId} was not found on Horizon; its assets ${assets.join(" / ")} were derived from the pool id.`
        : `Liquidity pool ${pool.poolId} was not found on Horizon and no pair of this account's assets hashes to its id; every asset trustline stays, because any of them may belong to the pool.`,
    );
    return { ...pool, assets };
  });
}

/**
 * Finds the two assets of liquidity pools from their ids alone ("native" or "CODE:ISSUER", in the
 * pool's own order). A pool id is the SHA-256 of the pool's LiquidityPoolParameters: constant
 * product, both assets in lexicographic order and the fee, which can only be 30 bps
 * (CAP-38, https://github.com/stellar/stellar-protocol/blob/master/core/cap-0038.md). The SDK's
 * `getLiquidityPoolId` (lib/esm/base/get_liquidity_pool_id.js) hashes exactly that; the transaction
 * builder checks pool assets with the same function. While an account holds a pool-share
 * trustline it also holds trustlines for the pool's assets (CHANGE_TRUST_TRUST_LINE_MISSING on
 * creation, CHANGE_TRUST_CANNOT_DELETE on their removal), except XLM and assets it issues itself
 * (stellar-core `ChangeTrustOpFrame::tryIncrementPoolUseCount`), so every pair of XLM and the
 * account's trustline assets is a candidate. A pool with an asset the account issues is not found,
 * and the caller then treats every trustline as a possible pool asset. Pure and deterministic; at
 * most n(n+1)/2 hashes for n trustlines, only for pools Horizon did not return.
 */
export function derivePoolAssets(
  poolIds: readonly string[],
  trustlines: readonly TrustlineInfo[],
): Map<string, [string, string]> {
  const wanted = new Set(poolIds.map((id) => id.toLowerCase()));
  const candidates = new Map<string, Asset>([["native", Asset.native()]]);
  for (const t of trustlines) {
    try {
      candidates.set(assetKey(t.asset), new Asset(t.asset.code, t.asset.issuer));
    } catch {
      // Not a valid asset (Horizon never returns one), so no pool can hold it either.
    }
  }
  const sorted = [...candidates].sort(([, a], [, b]) => Asset.compare(a, b));
  const found = new Map<string, [string, string]>();
  for (let i = 0; i < sorted.length && found.size < wanted.size; i++) {
    for (let j = i + 1; j < sorted.length && found.size < wanted.size; j++) {
      const [keyA, assetA] = sorted[i]!;
      const [keyB, assetB] = sorted[j]!;
      const id = Buffer.from(
        getLiquidityPoolId("constant_product", { assetA, assetB, fee: LiquidityPoolFeeV18 }),
      ).toString("hex");
      if (wanted.has(id)) found.set(id, [keyA, keyB]);
    }
  }
  const result = new Map<string, [string, string]>();
  for (const id of poolIds) {
    const assets = found.get(id.toLowerCase());
    if (assets) result.set(id, assets);
  }
  return result;
}

/** An empty pool-share trustline: ChangeTrustOp with the pool asset and limit 0. */
function poolShareRemoval(
  draft: (step: Omit<Draft, "ref">) => Draft,
  pool: PoolShareInfo,
  assets: [string, string],
  baseReserve: string,
): Draft {
  const reserve = formatStroops(2n * toStroops(baseReserve));
  return draft({
    kind: "remove_trustline",
    txIndex: -1,
    subject: {
      type: "pool_share",
      poolId: pool.poolId,
      balance: pool.balance,
      sponsor: pool.sponsor,
    },
    reason:
      `The share trustline of liquidity pool ${pool.poolId} (${assets.join(" / ")}) is empty; it is a subentry that blocks the merge and keeps the pool's asset trustlines from being removed. ` +
      (pool.sponsor
        ? `Removing it (limit 0) returns its two base reserves (${reserve} XLM) to the reserve sponsor ${pool.sponsor}, not to this account.`
        : `Removing it (limit 0) releases its two base reserves (${reserve} XLM) to this account.`),
    deps: [],
    threshold: "medium",
    operation: {
      type: "changeTrust",
      asset: { type: "liquidity_pool_shares", poolId: pool.poolId, assets },
      limit: "0",
    },
    reserveReleasedTo: pool.sponsor ? { to: "sponsor", sponsor: pool.sponsor } : { to: "account" },
    feeEstimateStroops: 0,
  });
}

function removal(
  draft: (step: Omit<Draft, "ref">) => Draft,
  line: TrustlineInfo,
  deps: number[],
  after: string,
): Draft {
  const code = line.asset.code;
  return draft({
    kind: "remove_trustline",
    txIndex: -1,
    subject: { type: "trustline", asset: line.asset, balance: line.balance, sponsor: line.sponsor },
    reason:
      `The ${code} trustline is empty${after}; a trustline is a subentry that blocks the merge. ` +
      (line.sponsor
        ? `Removing it (limit 0) needs only this account's signature and returns its 0.5 XLM reserve to the reserve sponsor ${line.sponsor}, not to this account.`
        : "Removing it (limit 0) releases its 0.5 XLM reserve to this account."),
    deps,
    threshold: "medium",
    operation: { type: "changeTrust", asset: line.asset, limit: "0" },
    reserveReleasedTo: line.sponsor ? { to: "sponsor", sponsor: line.sponsor } : { to: "account" },
    feeEstimateStroops: 0,
  });
}

function disposal(
  draft: (step: Omit<Draft, "ref">) => Draft,
  s: ExistingAccountSnapshot,
  line: TrustlineInfo,
  decision: DisposalDecision,
  deps: number[],
  order: LadderOrder,
): Draft {
  const code = line.asset.code;
  // Explain only the rungs tried before the chosen one; later rungs did not decide anything.
  const tried = LADDER_ORDERS[order].slice(0, LADDER_ORDERS[order].indexOf(decision.rung));
  const why = decision.ruledOut
    .filter((r) => tried.includes(r.rung))
    .map((r) => `${sentence(r.reason)}. `)
    .join("");
  const subject = {
    type: "trustline" as const,
    asset: line.asset,
    balance: line.balance,
    sponsor: line.sponsor,
  };
  const base = {
    kind: "dispose_balance" as const,
    txIndex: -1,
    subject,
    deps,
    threshold: "medium" as const,
    disposal: decision,
    feeEstimateStroops: 0,
  };
  if (decision.rung === "path_payment") {
    return draft({
      ...base,
      reason: `Sell the full ${line.balance} ${code} for about ${decision.quotedXlm} XLM (at least ${decision.destMinXlm}) with a strict-send path payment to this account; the XLM leaves with the merge. It runs in its own transaction so a moved market cannot roll back the rest.`,
      operation: {
        type: "pathPaymentStrictSend",
        sendAsset: line.asset,
        sendAmount: line.balance,
        destination: s.account,
        destAsset: { type: "native" },
        destMin: decision.destMinXlm ?? "0.0000001",
        path: s.quotes.find((q) => assetKey(q.asset) === assetKey(line.asset))?.quote?.path ?? [],
      },
    });
  }
  if (decision.rung === "return_to_issuer") {
    const gone = s.issuers.find((i) => i.account === line.asset.issuer)?.exists === false;
    return draft({
      ...base,
      reason:
        `${why}Pay the ${line.balance} ${code} back to its issuer ${line.asset.issuer}, which burns it.` +
        (gone
          ? " The issuer account no longer exists; a payment to it still burns the balance (verified on testnet, 2026-09-26)."
          : ""),
      operation: {
        type: "payment",
        destination: line.asset.issuer,
        asset: line.asset,
        amount: line.balance,
      },
    });
  }
  return draft({
    ...base,
    reason: `${why}Send the ${line.balance} ${code} to the destination ${decision.to}, which holds an authorized ${code} trustline with room${order === "prefer-destination" ? " (--prefer-destination)" : ""}.`,
    operation: {
      type: "payment",
      destination: decision.to,
      asset: line.asset,
      amount: line.balance,
    },
  });
}

export type { OfferInfo };
