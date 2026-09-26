import { toStroops } from "../amounts.js";
import type {
  AssetRef,
  ExistingAccountSnapshot,
  OfferInfo,
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
 * R6 pool shares are reported, never touched; R7 the merge last; R9 market-dependent steps
 * isolated. Units come out in execution order: cleanup, then conversions, then the merge.
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

  const poolAssets = new Set(s.poolShares.flatMap((p) => p.assets ?? []));
  for (const pool of s.poolShares) {
    if (pool.assets === null) {
      warnings.push(
        `Liquidity pool ${pool.poolId} was not found on Horizon; its asset trustlines may not be removable.`,
      );
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
    if (line.clawbackEnabled && toStroops(line.balance) > 0n) {
      warnings.push(
        `Trustline ${key} is clawback-enabled: the issuer can change this balance before execution; the executor re-plans if that happens.`,
      );
    }
    const touching = cancelRefsTouching(key);
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
