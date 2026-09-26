import { formatStroops, toStroops } from "../amounts.js";
import type { AssetRef, ExistingAccountSnapshot, TrustlineInfo } from "../inspect/snapshot.js";
import { assetKey } from "../inspect/snapshot.js";
import type { DisposalDecision, DisposalRung, LadderOrder, UnclosableCode } from "./model.js";

export interface LadderOptions {
  order: LadderOrder;
  slippageBps: number;
  memo: string | null;
}

export type LadderResult =
  | { ok: true; decision: DisposalDecision }
  | {
      ok: false;
      code: UnclosableCode;
      reason: string;
      remedy: string;
      ruledOut: Array<{ rung: DisposalRung; reason: string }>;
    };

type Evaluation =
  | { viable: true; to: string; quotedXlm?: string; destMinXlm?: string }
  | { viable: false; reason: string };

const ORDERS: Record<LadderOrder, DisposalRung[]> = {
  // SOW order (canonical decision 8).
  sow: ["path_payment", "return_to_issuer", "send_to_destination"],
  // --prefer-destination: the destination before the burn.
  "prefer-destination": ["path_payment", "send_to_destination", "return_to_issuer"],
};

/**
 * Picks the disposal rung for one non-zero balance. Pure: it reads only the snapshot.
 * A balance whose trustline is not authorized cannot be sent anywhere, not even to its issuer
 * (`*_SRC_NOT_AUTHORIZED`, day-1 experiment 13), so it is unclosable before any rung is tried.
 */
export function chooseRung(
  snapshot: ExistingAccountSnapshot,
  line: TrustlineInfo,
  options: LadderOptions,
): LadderResult {
  const code = line.asset.code;
  const issuer = line.asset.issuer;
  if (!line.authorized) {
    const maintain = line.authorizedToMaintainLiabilities;
    return {
      ok: false,
      code: maintain ? "MAINTAIN_LIABILITIES_ONLY" : "TRUSTLINE_NOT_AUTHORIZED",
      reason: maintain
        ? `Issuer ${issuer} has limited the ${code} trustline to maintaining liabilities, so the balance of ${line.balance} ${code} cannot be sent anywhere, not even back to the issuer.`
        : `Issuer ${issuer} has not authorized the ${code} trustline (or revoked it), so the balance of ${line.balance} ${code} cannot be sent anywhere, not even back to the issuer.`,
      remedy: `Ask the issuer ${issuer} to authorize the trustline again (SetTrustLineFlags) or to claw the balance back, then run the plan again.`,
      ruledOut: [],
    };
  }

  const evaluations: Record<DisposalRung, Evaluation> = {
    path_payment: evaluatePathPayment(snapshot, line, options.slippageBps),
    return_to_issuer: evaluateIssuer(snapshot, line, options.memo),
    send_to_destination: evaluateDestination(snapshot, line, options.memo),
  };
  const order = ORDERS[options.order];
  const ruledOut = order.flatMap((rung) => {
    const e = evaluations[rung];
    return e.viable ? [] : [{ rung, reason: e.reason }];
  });
  const viable = order.filter((rung) => evaluations[rung].viable);
  const chosen = viable[0];
  if (!chosen) {
    return {
      ok: false,
      code: "NO_DISPOSAL_ROUTE",
      reason: `No route disposes of ${line.balance} ${code}: ${ruledOut.map((r) => `${r.rung.replaceAll("_", " ")}: ${r.reason}`).join("; ")}.`,
      remedy:
        "Make one route possible, then run the plan again: a market that buys the asset for XLM, a destination that holds an authorized trustline for it with room, or a memo if the issuer requires one.",
      ruledOut,
    };
  }
  const e = evaluations[chosen] as Extract<Evaluation, { viable: true }>;
  return {
    ok: true,
    decision: {
      rung: chosen,
      amount: line.balance,
      to: e.to,
      ...(e.quotedXlm !== undefined ? { quotedXlm: e.quotedXlm } : {}),
      ...(e.destMinXlm !== undefined ? { destMinXlm: e.destMinXlm } : {}),
      fallbackRungs: viable.slice(1),
      ruledOut,
    },
  };
}

/**
 * Rung 1: strict-send the full balance to the account itself (day-1 experiment 14); the XLM leaves
 * with the merge. The quote is not trusted if any hop could be served by one of the account's own
 * offers, because the plan cancels them first (edge case B-24): converting X into Y consumes offers
 * that sell Y for X.
 */
function evaluatePathPayment(
  snapshot: ExistingAccountSnapshot,
  line: TrustlineInfo,
  slippageBps: number,
): Evaluation {
  const quote =
    snapshot.quotes.find((q) => assetKey(q.asset) === assetKey(line.asset))?.quote ?? null;
  if (!quote)
    return {
      viable: false,
      reason: "Horizon found no strict-send path to XLM for the full balance",
    };
  const hops: AssetRef[] = [line.asset, ...quote.path, { type: "native" }];
  for (let i = 0; i + 1 < hops.length; i++) {
    const from = assetKey(hops[i]!);
    const to = assetKey(hops[i + 1]!);
    const own = snapshot.offers.find(
      (o) => assetKey(o.selling) === to && assetKey(o.buying) === from,
    );
    if (own) {
      return {
        viable: false,
        reason: `the quoted path may use this account's own offer ${own.id}, which the plan cancels first`,
      };
    }
  }
  const quoted = toStroops(quote.destinationAmount);
  const slipped = quoted - (quoted * BigInt(slippageBps)) / 10_000n;
  const destMin = slipped >= 1n ? slipped : 1n;
  return {
    viable: true,
    to: snapshot.account,
    quotedXlm: formatStroops(quoted),
    destMinXlm: formatStroops(destMin),
  };
}

/**
 * Rung 2: pay the balance back to its issuer, which burns it. It works even if the issuer account
 * was merged away (day-1 experiment 4). A memo-required issuer (SEP-29) makes the SDK refuse a
 * memo-less payment (day-1 experiment 10).
 */
function evaluateIssuer(
  snapshot: ExistingAccountSnapshot,
  line: TrustlineInfo,
  memo: string | null,
): Evaluation {
  const issuer = snapshot.issuers.find((i) => i.account === line.asset.issuer);
  if (issuer?.memoRequired && !memo) {
    return {
      viable: false,
      reason: `issuer ${line.asset.issuer} requires a memo (SEP-29) and none was given`,
    };
  }
  return { viable: true, to: line.asset.issuer };
}

/** Rung 3: transfer to the merge destination if it holds an authorized trustline with room. */
function evaluateDestination(
  snapshot: ExistingAccountSnapshot,
  line: TrustlineInfo,
  memo: string | null,
): Evaluation {
  const d = snapshot.destination;
  if (!d || !d.exists) return { viable: false, reason: "the destination account does not exist" };
  if (d.baseAccount === line.asset.issuer) {
    return {
      viable: false,
      reason: "the destination is the issuer, so this is the return to issuer",
    };
  }
  if (d.memoRequired && !memo)
    return { viable: false, reason: "the destination requires a memo (SEP-29) and none was given" };
  const t = d.trustlines.find((x) => assetKey(x.asset) === assetKey(line.asset));
  if (!t) return { viable: false, reason: `the destination holds no ${line.asset.code} trustline` };
  if (!t.authorized)
    return {
      viable: false,
      reason: `the destination's ${line.asset.code} trustline is not authorized`,
    };
  const room = toStroops(t.limit) - toStroops(t.balance) - toStroops(t.buyingLiabilities);
  if (room < toStroops(line.balance)) {
    return {
      viable: false,
      reason: `the destination's ${line.asset.code} trustline has no room for ${line.balance}`,
    };
  }
  return { viable: true, to: d.account };
}
