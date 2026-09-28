import { beforeAll, describe, expect, it } from "vitest";
import type { ExistingAccountSnapshot, TrustlineInfo } from "../../../src/inspect/snapshot.js";
import { chooseRung } from "../../../src/plan/ladder.js";
import type { ClosePlan, CloseStep } from "../../../src/plan/model.js";
import { planClose } from "../../../src/plan/plan-close.js";
import { planFromSnapshot } from "../../../src/plan/plan.js";
import { horizonJson } from "../../../src/reader/horizon-json.js";
import { horizonReader, strictSendToNativePath } from "../../../src/reader/ledger-reader.js";
import {
  MESSY_DIR,
  TESTNET_HORIZON,
  loadRecorded,
  recordedFetch,
} from "../../helpers/recorded-horizon.js";
import { copy, messy, messySnapshot } from "../../helpers/snapshots.js";

/**
 * Story E3-S1, the path-payment sale, at the planner: dust too small to buy one stroop of XLM
 * (AC-E3-S1-3, matrix row X-10) and the destMin bound (AC-E3-S1-4).
 */

let base: ExistingAccountSnapshot;
beforeAll(async () => {
  base = await messySnapshot();
});

const line = (s: ExistingAccountSnapshot, code: string): TrustlineInfo =>
  s.trustlines.find((t) => t.asset.code === code)!;
const sale = (plan: ClosePlan, code: string): CloseStep =>
  plan.steps.find(
    (s) =>
      s.kind === "dispose_balance" &&
      s.subject.type === "trustline" &&
      s.subject.asset.code === code,
  )!;
const options = () => ({ destination: messy.destination, feeSponsor: messy.sponsor });
const DUSTA = {
  type: "credit_alphanum12" as const,
  code: "DUSTA",
  issuer: messy.issuer,
};

describe("AC-E3-S1-3: a balance too small to buy 1 stroop of XLM goes to the issuer", () => {
  it("AC-E3-S1-3, X-10 (planner): a strict-send answer of 0.0000000 XLM plans the burn, not a sale", async () => {
    // Horizon answers with a path whose destination amount rounds to zero (dust below the
    // resolution of the book). The inspector keeps the quote (src/inspect/inspect.ts, bestQuote),
    // and the ladder rules the sale out because it pays less than 1 stroop (closing review CP-5),
    // then returns the balance to its issuer.
    const { fetch } = recordedFetch(loadRecorded(MESSY_DIR), {
      [strictSendToNativePath(DUSTA, "0.0000007")]: {
        _embedded: {
          records: [{ source_amount: "0.0000007", destination_amount: "0.0000000", path: [] }],
        },
      },
    });
    const reader = horizonReader(horizonJson(TESTNET_HORIZON, { fetch, retries: 0 }));
    const plan = await planClose({ account: messy.fixture, ...options() }, { reader });

    expect(plan.status).toBe("closable");
    expect(sale(plan, "DUSTA").disposal).toMatchObject({
      rung: "return_to_issuer",
      to: messy.issuer,
    });
    expect(
      sale(plan, "DUSTA").disposal!.ruledOut.find((r) => r.rung === "path_payment")?.reason,
    ).toBe("the best strict-send quote pays less than 1 stroop of XLM for the full balance");
    expect(sale(plan, "DUSTA").operation).toMatchObject({
      type: "payment",
      destination: messy.issuer,
      amount: "0.0000007",
    });
    // Nothing is sold, so there is no market-dependent transaction: one fee bump closes it.
    expect(plan.transactions.map((t) => t.phase)).toEqual(["cleanup"]);
    expect(plan.recovery.quotedProceedsXlm).toBe("0.0000000");
    expect(plan.recovery.xlmToDestination).toBe("4.0000000");
  });

  it("AC-E3-S1-3: the ladder itself refuses a quote below 1 stroop (a snapshot built elsewhere)", () => {
    // planFromSnapshot is public: a caller may hand it a snapshot whose quote was not filtered.
    const s = copy(base);
    s.quotes.find((q) => q.asset.code === "DUSTA")!.quote!.destinationAmount = "0.0000000";
    const r = chooseRung(s, line(s, "DUSTA"), { order: "sow", slippageBps: 100, memo: null });
    if (!r.ok) throw new Error(r.reason);
    expect(r.decision.rung).toBe("return_to_issuer");
    expect(r.decision.ruledOut.find((x) => x.rung === "path_payment")?.reason).toMatch(
      /less than 1 stroop/,
    );
    const plan = planFromSnapshot(s, options());
    expect(sale(plan, "DUSTA").disposal!.rung).toBe("return_to_issuer");
    expect(plan.transactions.map((t) => t.phase)).toEqual(["cleanup"]);
  });
});

describe("AC-E3-S1-4: destMin is never below 1 stroop and the slippage is configurable", () => {
  const withQuote = (amount: string) => {
    const s = copy(base);
    s.quotes.find((q) => q.asset.code === "DUSTA")!.quote!.destinationAmount = amount;
    return s;
  };
  const destMin = (s: ExistingAccountSnapshot, slippageBps?: number) => {
    const plan = planFromSnapshot(s, {
      ...options(),
      ...(slippageBps !== undefined ? { slippageBps } : {}),
    });
    return sale(plan, "DUSTA").disposal!.destMinXlm;
  };

  it("AC-E3-S1-4: floors destMin at 1 stroop for a 1-stroop quote, for any slippage", () => {
    const s = withQuote("0.0000001");
    for (const bps of [0, 100, 500, 10_000]) expect(destMin(s, bps)).toBe("0.0000001");
  });

  it("AC-E3-S1-4: applies the slippage bound in basis points, rounded against the seller", () => {
    const s = withQuote("1.0000000");
    expect(destMin(s)).toBe("0.9900000"); // default 100 bps (1%)
    expect(destMin(s, 500)).toBe("0.9500000"); // the 5% the story names, as an option
    expect(destMin(s, 0)).toBe("1.0000000");
    expect(destMin(s, 10_000)).toBe("0.0000001"); // 100%: still at least 1 stroop
    // For dust, 1% rounds up to a whole stroop, so destMin stays below the quote.
    expect(destMin(withQuote("0.0000007"))).toBe("0.0000006");
  });

  it("AC-E3-S1-4: records the bound in the plan and puts it on the operation", () => {
    const plan = planFromSnapshot(withQuote("1.0000000"), { ...options(), slippageBps: 250 });
    expect(plan.options?.slippageBps).toBe(250);
    expect(sale(plan, "DUSTA").operation).toMatchObject({
      type: "pathPaymentStrictSend",
      destMin: "0.9750000",
    });
  });

  it("AC-E3-S1-4: refuses a slippage outside 0 to 10000 basis points before planning", () => {
    for (const bad of [-1, 10_001, 1.5])
      expect(() => planFromSnapshot(base, { ...options(), slippageBps: bad })).toThrow(
        /slippageBps/,
      );
  });
});
