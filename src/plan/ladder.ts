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
  | {
      viable: false;
      reason: string;
      /** What would make this rung possible, for the remedy of an item no rung can dispose of. */
      fix?: string;
    };

export const LADDER_ORDERS: Record<LadderOrder, DisposalRung[]> = {
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
    // A clawback needs the trustline's clawback flag, which only a trustline created after its
    // issuer set AUTH_CLAWBACK_ENABLED has and nothing can set later
    // (https://developers.stellar.org/docs/build/guides/transactions/clawbacks#set-trust-line-flag;
    // closing review CP-7).
    const clawback = line.clawbackEnabled ? " or to claw the balance back" : "";
    return {
      ok: false,
      code: maintain ? "MAINTAIN_LIABILITIES_ONLY" : "TRUSTLINE_NOT_AUTHORIZED",
      reason: maintain
        ? `Issuer ${issuer} has limited the ${code} trustline to maintaining liabilities, so the balance of ${line.balance} ${code} cannot be sent anywhere, not even back to the issuer.`
        : `Issuer ${issuer} has not authorized the ${code} trustline (or revoked it), so the balance of ${line.balance} ${code} cannot be sent anywhere, not even back to the issuer.`,
      remedy: `Ask the issuer ${issuer} to authorize the trustline again (SetTrustLineFlags)${clawback}, then run the plan again.`,
      ruledOut: [],
    };
  }

  const evaluations: Record<DisposalRung, Evaluation> = {
    path_payment: evaluatePathPayment(snapshot, line, options.slippageBps),
    return_to_issuer: evaluateIssuer(snapshot, line, options.memo),
    send_to_destination: evaluateDestination(snapshot, line, options.memo),
  };
  const order = LADDER_ORDERS[options.order];
  const ruledOut = order.flatMap((rung) => {
    const e = evaluations[rung];
    return e.viable ? [] : [{ rung, reason: e.reason }];
  });
  const viable = order.filter((rung) => evaluations[rung].viable);
  const chosen = viable[0];
  if (!chosen) {
    // One fix per rung, in ladder order, each naming what blocks that rung (AC-E3-S2-4: a
    // destination trustline without room names the limit to raise).
    const fixes = order.flatMap((rung) => {
      const e = evaluations[rung];
      return !e.viable && e.fix ? [e.fix] : [];
    });
    return {
      ok: false,
      code: "NO_DISPOSAL_ROUTE",
      reason: `No route disposes of ${line.balance} ${code}: ${ruledOut.map((r) => `${r.rung.replaceAll("_", " ")}: ${r.reason}`).join("; ")}.`,
      remedy:
        fixes.length > 0
          ? `Make one route possible, then run the plan again: ${fixes.join("; or ")}.`
          : "Make one route possible, then run the plan again: a market that buys the asset for XLM, a destination that holds an authorized trustline for it with room, or a memo if the issuer requires one.",
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
  const code = line.asset.code;
  const noMarket = `wait for a market that buys ${code} for XLM`;
  const quote =
    snapshot.quotes.find((q) => assetKey(q.asset) === assetKey(line.asset))?.quote ?? null;
  if (!quote)
    return {
      viable: false,
      reason: "Horizon found no strict-send path to XLM for the full balance",
      fix: noMarket,
    };
  const hops: AssetRef[] = [line.asset, ...quote.path, { type: "native" }];
  for (let i = 0; i + 1 < hops.length; i++) {
    const from = assetKey(hops[i]!);
    const to = assetKey(hops[i + 1]!);
    const own = snapshot.offers.find(
      (o) => assetKey(o.selling) === to && assetKey(o.buying) === from,
    );
    if (own) {
      // The plan's cleanup cancels the offer, so a partial run reopens the rung: the next plan
      // quotes the market without it (closing review CP-6).
      return {
        viable: false,
        reason: `the quoted path may use this account's own offer ${own.id}, which the plan cancels first`,
        fix: `cancel this account's own offer ${own.id} with a --partial run (if no other market buys ${code} for XLM once it is gone, wait for one)`,
      };
    }
  }
  const quoted = toStroops(quote.destinationAmount);
  // The protocol cannot deliver less than 1 stroop, so such a quote is no path (AC-E3-S1-3). The
  // inspector keeps it (src/inspect/inspect.ts, bestQuote) so that this branch decides and the
  // plan says why (closing review CP-5).
  if (quoted < 1n) {
    return {
      viable: false,
      reason: "the best strict-send quote pays less than 1 stroop of XLM for the full balance",
      fix: `wait for a market that pays at least 1 stroop of XLM for ${line.balance} ${code}`,
    };
  }
  // Round the slippage up: for dust a rounded-down 1% is 0 and destMin would equal the quote.
  const slipped = quoted - (quoted * BigInt(slippageBps) + 9_999n) / 10_000n;
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
      fix: `pass the memo that issuer ${line.asset.issuer} requires (--memo; SEP-29)`,
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
  const code = line.asset.code;
  const d = snapshot.destination;
  if (!d || !d.exists)
    return {
      viable: false,
      reason: "the destination account does not exist",
      fix: "close into a destination account that exists",
    };
  if (d.baseAccount === snapshot.account)
    return { viable: false, reason: "the destination is the account itself" };
  if (d.baseAccount === line.asset.issuer) {
    return {
      viable: false,
      reason: "the destination is the issuer, so this is the return to issuer",
    };
  }
  if (d.memoRequired && !memo)
    return {
      viable: false,
      reason: "the destination requires a memo (SEP-29) and none was given",
      fix: "pass the memo the destination requires (--memo; SEP-29)",
    };
  const t = d.trustlines.find((x) => assetKey(x.asset) === assetKey(line.asset));
  if (!t)
    return {
      viable: false,
      reason: `the destination holds no ${code} trustline`,
      fix: `open a ${code} trustline on the destination ${d.account}, or close into a destination that holds one`,
    };
  if (!t.authorized)
    return {
      viable: false,
      reason: `the destination's ${code} trustline is not authorized`,
      fix: `ask issuer ${line.asset.issuer} to authorize the destination's ${code} trustline`,
    };
  // PAYMENT_LINE_FULL: the receiver's limit must hold the amount and still satisfy its buying
  // liabilities (https://developers.stellar.org/docs/data/apis/horizon/api-reference/errors/result-codes/operation-specific/payment).
  const room = toStroops(t.limit) - toStroops(t.balance) - toStroops(t.buyingLiabilities);
  if (room < toStroops(line.balance)) {
    return {
      viable: false,
      reason: `the destination's ${code} trustline has no room for ${line.balance}`,
      fix: `raise the destination's trustline limit for ${code} (it has room for ${formatStroops(room > 0n ? room : 0n)} of the ${line.balance} to send)`,
    };
  }
  return { viable: true, to: d.account };
}
