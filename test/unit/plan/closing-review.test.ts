import { Account, MuxedAccount } from "@stellar/stellar-sdk";
import { beforeAll, describe, expect, it } from "vitest";
import type { HorizonAccount } from "../../../src/inspect/horizon-types.js";
import { inspectAccount } from "../../../src/inspect/inspect.js";
import type { ExistingAccountSnapshot } from "../../../src/inspect/snapshot.js";
import type { Blocker, BlockerCode, ClosePlan, UnclosableItem } from "../../../src/plan/model.js";
import { planClose } from "../../../src/plan/plan-close.js";
import { planFromSnapshot } from "../../../src/plan/plan.js";
import { horizonJson } from "../../../src/reader/horizon-json.js";
import { horizonReader, strictSendToNativePath } from "../../../src/reader/ledger-reader.js";
import { edgeManifest, edgeRecordedReader } from "../../helpers/edge-ledger.js";
import {
  MESSY_DIR,
  TESTNET_HORIZON,
  loadRecorded,
  recordedFetch,
} from "../../helpers/recorded-horizon.js";
import { copy, messy, messySnapshot } from "../../helpers/snapshots.js";

// The closing review of 2026-09-28, planner half (findings CP-1 to CP-7 and CP-15 to CP-17 of the
// edge case hunt): every test here failed on the code before its fix.

let base: ExistingAccountSnapshot;
beforeAll(async () => {
  base = await messySnapshot();
});
const opts = () => ({ destination: messy.destination, feeSponsor: messy.sponsor });

/** The recorded messy fixture with nothing left to clean up: native XLM only. */
function bare(s: ExistingAccountSnapshot): ExistingAccountSnapshot {
  const b = copy(s);
  b.trustlines = [];
  b.poolShares = [];
  b.offers = [];
  b.data = [];
  b.quotes = [];
  b.subentryCount = 0;
  b.numSponsored = 0;
  return b;
}

/** The master key as the account's only signer, with the given weight. */
function onlySigner(s: ExistingAccountSnapshot, weight: number): ExistingAccountSnapshot {
  s.masterWeight = weight;
  s.signers = [{ key: s.account, weight, type: "ed25519_public_key", sponsor: null }];
  return s;
}

function blocker(plan: ClosePlan, code: BlockerCode): Blocker {
  const found = plan.blockers.find((b) => b.code === code);
  if (!found) throw new Error(`no ${code} blocker in ${plan.blockers.map((b) => b.code).join()}`);
  return found;
}

function item(plan: ClosePlan, code: string): UnclosableItem {
  const found = plan.unclosable.find(
    (u) => u.subject.type === "trustline" && u.subject.asset.code === code,
  );
  if (!found) throw new Error(`no unclosable ${code}`);
  return found;
}

const DUSTA = { type: "credit_alphanum12" as const, code: "DUSTA", issuer: messy.issuer };

/**
 * The recorded messy fixture read through Horizon, with responses replaced: `memoIssuer` makes the
 * issuer SEP-29 memo-required, so without a memo the return to the issuer is ruled out too.
 */
function messyReader(
  overrides: Record<string, unknown>,
  { memoIssuer = false }: { memoIssuer?: boolean } = {},
) {
  const issuerPath = `/accounts/${messy.issuer}`;
  const issuer = structuredClone(loadRecorded(MESSY_DIR).get(issuerPath)) as HorizonAccount;
  issuer.data["config.memo_required"] = Buffer.from("1").toString("base64");
  const { fetch } = recordedFetch(loadRecorded(MESSY_DIR), {
    ...(memoIssuer ? { [issuerPath]: issuer } : {}),
    ...overrides,
  });
  return horizonReader(horizonJson(TESTNET_HORIZON, { fetch, retries: 0 }));
}

describe("CP-1: the cleanup's threshold counts only when there is a cleanup", () => {
  it("medium 2 above a master weight of 1 that meets low 0 and high 1: an account with nothing to clean up plans its merge", () => {
    // Unordered thresholds are valid (low <= medium <= high is only recommended:
    // https://developers.stellar.org/docs/learn/fundamentals/transactions/signatures-multisig#thresholds).
    // The merge's transaction needs low 0 for its source and high 1 for AccountMerge.
    const s = onlySigner(bare(base), 1);
    s.thresholds = { low: 0, medium: 2, high: 1 };
    const plan = planFromSnapshot(s, opts());
    expect(plan.blockers).toEqual([]);
    expect(plan.status).toBe("closable");
    expect(plan.steps.map((st) => st.kind)).toEqual(["merge"]);
  });

  it("still blocks, with nothing signed, when there is a cleanup the master key cannot sign", () => {
    const s = onlySigner(copy(base), 1);
    s.thresholds = { low: 0, medium: 2, high: 1 };
    const plan = planFromSnapshot(s, opts());
    expect(plan.blockers.map((b) => b.code)).toEqual(["THRESHOLD_UNMET"]);
    expect(blocker(plan, "THRESHOLD_UNMET").reason).toContain(
      "Blocked: the cleanup needs weight 2, so nothing can be signed, and the merge cannot run without the cleanup.",
    );
    expect(plan.steps).toEqual([]);
  });

  it("a data entry alone is a cleanup: it needs the medium threshold", () => {
    const s = onlySigner(bare(base), 1);
    s.data = [{ name: "k", valueBase64: "MQ==" }];
    s.subentryCount = 1;
    s.thresholds = { low: 0, medium: 2, high: 1 };
    const plan = planFromSnapshot(s, opts());
    expect(plan.blockers.map((b) => b.code)).toEqual(["THRESHOLD_UNMET"]);
    expect(plan.steps).toEqual([]);
  });

  it("names no cleanup in the reason when the merge alone is out of reach", () => {
    const high = onlySigner(bare(base), 1);
    high.thresholds = { low: 0, medium: 0, high: 2 };
    const r1 = blocker(planFromSnapshot(high, opts()), "THRESHOLD_UNMET").reason;
    expect(r1).toContain("Blocked: the merge needs weight 2. The account has nothing to clean up.");
    expect(r1).not.toMatch(/cleanup needs weight/i);

    const low = onlySigner(bare(base), 1);
    low.thresholds = { low: 2, medium: 0, high: 0 };
    const r2 = blocker(planFromSnapshot(low, opts()), "THRESHOLD_UNMET").reason;
    expect(r2).toContain(
      "Blocked: every transaction needs weight 2 for its source account (low threshold), so the merge, which needs weight 2, cannot be signed. The account has nothing to clean up.",
    );
    expect(r2).not.toMatch(/cleanup needs weight/i);
  });
});

describe("CP-2: a remedy offers --partial only for a cleanup the plan holds", () => {
  const partial = /--partial/;

  it("the recorded immutable variant has no step, so AUTH_IMMUTABLE_SET offers nothing more", async () => {
    const m = edgeManifest();
    const { reader } = edgeRecordedReader();
    const plan = await planClose(
      {
        account: m.accounts.immutable,
        destination: m.accounts.destination,
        feeSponsor: m.accounts.sponsor,
      },
      { reader },
    );
    expect(plan.steps).toEqual([]);
    expect(blocker(plan, "AUTH_IMMUTABLE_SET").remedy).toBe(
      "None: the flag cannot be cleared, so the account can never be merged.",
    );
  });

  it("AUTH_IMMUTABLE with a cleanup: --partial runs it, and the account keeps its XLM (nothing is emptied)", () => {
    const s = copy(base);
    s.flags.authImmutable = true;
    const plan = planFromSnapshot(s, opts());
    const { remedy } = blocker(plan, "AUTH_IMMUTABLE_SET");
    expect(remedy).toBe(
      "None: the flag cannot be cleared, so the account can never be merged. With --partial the cleanup and the sale still run, but the account stays on the ledger and keeps its XLM.",
    );
    expect(remedy).not.toMatch(/empties/);
  });

  it("AUTH_IMMUTABLE with a cleanup the master key cannot sign: neither blocker offers --partial", () => {
    const s = onlySigner(copy(base), 1);
    s.flags.authImmutable = true;
    s.thresholds = { low: 0, medium: 2, high: 2 };
    const plan = planFromSnapshot(s, opts());
    expect(plan.blockers.map((b) => b.code)).toEqual(["AUTH_IMMUTABLE_SET", "THRESHOLD_UNMET"]);
    expect(plan.steps).toEqual([]);
    for (const b of plan.blockers) expect(b.remedy, b.code).not.toMatch(partial);
  });

  it("THRESHOLD_UNMET on an account with nothing to clean up offers no --partial", () => {
    const s = onlySigner(bare(base), 1);
    s.thresholds = { low: 0, medium: 0, high: 2 };
    const plan = planFromSnapshot(s, opts());
    expect(plan.steps).toEqual([]);
    expect(blocker(plan, "THRESHOLD_UNMET").remedy).not.toMatch(partial);
  });

  it("names what a --partial run executes: the cleanup, the sale, or both", () => {
    // A second signer of weight 1 lets the signers reach the high threshold of 2 outside Dustin.
    const withSigner = (s: ExistingAccountSnapshot) => {
      s.thresholds = { low: 0, medium: 0, high: 2 };
      s.signers.push({
        key: messy.destination,
        weight: 1,
        type: "ed25519_public_key",
        sponsor: null,
      });
      return s;
    };
    // The messy fixture: offers, returns, the data entry (the cleanup) and the DUSTA sale.
    const both = planFromSnapshot(withSigner(copy(base)), opts());
    expect(blocker(both, "THRESHOLD_UNMET").remedy).toMatch(
      / The cleanup and the sale can run now with --partial\.$/,
    );
    // The DUSTA trustline alone: its sale is the only transaction before the merge.
    const sale = withSigner(copy(base));
    sale.trustlines = sale.trustlines.filter((t) => t.asset.code === "DUSTA");
    sale.quotes = sale.quotes.filter((q) => q.asset.code === "DUSTA");
    sale.offers = [];
    sale.data = [];
    const saleOnly = planFromSnapshot(sale, opts());
    expect(saleOnly.transactions.map((t) => t.phase)).toEqual(["convert"]);
    expect(blocker(saleOnly, "THRESHOLD_UNMET").remedy).toMatch(
      / The sale can run now with --partial\.$/,
    );
  });

  it("SEQNUM_TOO_FAR offers --partial only when something runs before the merge", () => {
    const far = (s: ExistingAccountSnapshot) => {
      s.sequence = (BigInt(s.observed.ledger + 500) << 32n).toString();
      return s;
    };
    const alone = planFromSnapshot(far(bare(base)), opts());
    expect(blocker(alone, "SEQNUM_TOO_FAR").remedy).toBe(
      "Wait until that ledger and run the plan again; a sequence number can only go up, so nothing else helps.",
    );
    const messyFar = planFromSnapshot(far(copy(base)), opts());
    expect(blocker(messyFar, "SEQNUM_TOO_FAR").remedy).toMatch(
      / The cleanup and the sale can run now with --partial\.$/,
    );
  });
});

/** A second signer of the given weight next to the master key. */
function withSecondSigner(s: ExistingAccountSnapshot, weight: number): ExistingAccountSnapshot {
  s.signers.push({ key: messy.destination, weight, type: "ed25519_public_key", sponsor: null });
  return s;
}

describe("CP-3: MASTER_KEY_DISABLED with no other signer", () => {
  it("says no key can sign for the account, so it can never be cleaned up or merged", () => {
    // "If the master key's weight is set at 0, it cannot be used to sign transactions, even for
    // operations with a threshold value of 0"
    // (https://developers.stellar.org/docs/learn/fundamentals/transactions/signatures-multisig#thresholds).
    const plan = planFromSnapshot(onlySigner(copy(base), 0), opts());
    const b = blocker(plan, "MASTER_KEY_DISABLED");
    expect(b.reason).toContain("The account has no other signer.");
    expect(b.remedy).toBe(
      "None: no key can sign for this account (the master key has weight 0 and there is no other signer), so it can never be cleaned up or merged.",
    );
    expect(b.permanent).toBe(true);
    expect(plan.steps).toEqual([]);
  });

  it("keeps the multisig remedy when other signers can sign", () => {
    const s = withSecondSigner(onlySigner(copy(base), 0), 1);
    s.thresholds = { low: 1, medium: 1, high: 1 };
    const b = blocker(planFromSnapshot(s, opts()), "MASTER_KEY_DISABLED");
    expect(b.remedy).toBe(
      "Multisig closing is out of scope: sign with the account's other signers outside Dustin.",
    );
  });
});

describe("CP-4: a threshold the signers together can never reach", () => {
  // SetOptions needs the high threshold when it changes signers or thresholds
  // (https://developers.stellar.org/docs/learn/fundamentals/transactions/list-of-operations#set-options),
  // so signers whose total weight is below it can never lower a threshold or add a signer.
  const never = "the merge can never be authorized and the account can never be closed";

  it("a single key of weight 1 and a high threshold of 2: no suggestion that cannot work", () => {
    const s = onlySigner(copy(base), 1);
    s.thresholds = { low: 0, medium: 0, high: 2 };
    const { reason, remedy } = blocker(planFromSnapshot(s, opts()), "THRESHOLD_UNMET");
    expect(reason).toContain("The account has no other signer.");
    expect(remedy).toBe(
      `None: the account's total signing weight is 1, less than the 2 the merge needs, and SetOptions, which could lower the thresholds or add a signer, needs that weight too (the high threshold), so ${never}. With --partial the cleanup and the sale still run, but the account stays on the ledger and keeps its XLM.`,
    );
    expect(remedy).not.toContain("sign outside Dustin");
    expect(remedy).not.toContain("lower the thresholds to the master key's weight");
  });

  it("counts every signer: a second key that brings the total to the threshold keeps the multisig remedy", () => {
    const s = withSecondSigner(onlySigner(copy(base), 1), 1);
    s.thresholds = { low: 0, medium: 0, high: 2 };
    const { remedy } = blocker(planFromSnapshot(s, opts()), "THRESHOLD_UNMET");
    expect(remedy).toMatch(
      /^Multisig closing is out of scope: sign outside Dustin with enough weight/,
    );
    expect(remedy).not.toContain(never);
  });

  it("the master key alone can lower a medium threshold it cannot meet, when it meets high and low", () => {
    const s = onlySigner(copy(base), 1);
    s.thresholds = { low: 0, medium: 2, high: 1 };
    const { remedy } = blocker(planFromSnapshot(s, opts()), "THRESHOLD_UNMET");
    expect(remedy).toContain("have the signers lower the thresholds to the master key's weight");
  });

  it("the low threshold counts too: every transaction needs it for its source account", () => {
    const s = withSecondSigner(onlySigner(copy(base), 1), 1);
    s.thresholds = { low: 3, medium: 0, high: 0 };
    const { remedy } = blocker(planFromSnapshot(s, opts()), "THRESHOLD_UNMET");
    expect(remedy).toMatch(
      /^None: the account's total signing weight is 2, less than the 3 the merge needs/,
    );
    // Nothing can be signed, so nothing runs with --partial either.
    expect(remedy).not.toMatch(/--partial/);
  });

  it("MASTER_KEY_DISABLED whose other signers together stay below the merge's threshold", () => {
    const s = withSecondSigner(onlySigner(copy(base), 0), 1);
    s.thresholds = { low: 0, medium: 0, high: 2 };
    const { remedy } = blocker(planFromSnapshot(s, opts()), "MASTER_KEY_DISABLED");
    expect(remedy).toBe(
      `None: the account's total signing weight is 1 (the master key has weight 0), less than the 2 the merge needs, and SetOptions, which could lower the thresholds or add a signer, needs that weight too (the high threshold), so ${never}.`,
    );
  });
});

describe("CP-5: a strict-send path that pays less than a stroop, as Horizon returns it", () => {
  // Horizon finds a path for the full 0.0000007 DUSTA, but it pays 0.0000000 XLM.
  const dustQuote = {
    [strictSendToNativePath(DUSTA, "0.0000007")]: {
      _embedded: {
        records: [{ source_amount: "0.0000007", destination_amount: "0.0000000", path: [] }],
      },
    },
  };

  it("the inspector keeps the best answer, even below a stroop", async () => {
    const s = await inspectAccount(messy.fixture, {
      destination: messy.destination,
      reader: messyReader(dustQuote),
    });
    if (!s.exists) throw new Error("recorded fixture missing");
    expect(s.quotes.find((q) => q.asset.code === "DUSTA")?.quote).toEqual({
      sourceAmount: "0.0000007",
      destinationAmount: "0.0000000",
      path: [],
    });
  });

  it("planClose: the plan says the path pays less than 1 stroop, not that Horizon found none", async () => {
    const reader = messyReader(dustQuote, { memoIssuer: true });
    const plan = await planClose({ account: messy.fixture, ...opts() }, { reader });
    const dusta = item(plan, "DUSTA");
    expect(dusta.code).toBe("NO_DISPOSAL_ROUTE");
    expect(dusta.rungsRuledOut![0]).toEqual({
      rung: "path_payment",
      reason: "the best strict-send quote pays less than 1 stroop of XLM for the full balance",
    });
    expect(dusta.reason).not.toContain("Horizon found no strict-send path");
    expect(dusta.remedy).toContain(
      "wait for a market that pays at least 1 stroop of XLM for 0.0000007 DUSTA",
    );
    expect(dusta.remedy).not.toContain("wait for a market that buys DUSTA for XLM");
  });

  it("with no path at all, the plan still says Horizon found none", async () => {
    const none = { [strictSendToNativePath(DUSTA, "0.0000007")]: { _embedded: { records: [] } } };
    const plan = await planClose(
      { account: messy.fixture, ...opts() },
      { reader: messyReader(none, { memoIssuer: true }) },
    );
    expect(item(plan, "DUSTA").rungsRuledOut![0]!.reason).toBe(
      "Horizon found no strict-send path to XLM for the full balance",
    );
  });
});

describe("CP-6: a sale ruled out by the account's own offer", () => {
  it("the fix names the offer and how to reopen the rung: a --partial run cancels it", () => {
    const s = copy(base);
    s.issuers.find((i) => i.account === messy.issuer)!.memoRequired = true;
    // The only DUSTA -> XLM liquidity may be this offer selling XLM for DUSTA (edge case B-24).
    s.offers.push({
      id: "999",
      selling: { type: "native" },
      buying: DUSTA,
      amount: "0.0000007",
      price: { n: 1, d: 1 },
      sponsor: null,
      lastModifiedLedger: null,
    });
    const plan = planFromSnapshot(s, opts());
    const dusta = item(plan, "DUSTA");
    expect(dusta.code).toBe("NO_DISPOSAL_ROUTE");
    expect(dusta.rungsRuledOut![0]!.reason).toMatch(/own offer 999/);
    expect(dusta.remedy).toMatch(
      /^Make one route possible, then run the plan again: cancel this account's own offer 999 with a --partial run \(if no other market buys DUSTA for XLM once it is gone, wait for one\); or /,
    );
    // The plan's cleanup cancels offer 999, so a partial run reopens the rung.
    expect(
      plan.steps.some(
        (st) =>
          st.kind === "cancel_offer" && st.subject.type === "offer" && st.subject.offerId === "999",
      ),
    ).toBe(true);
  });
});

describe("CP-7: the unauthorized-trustline remedy offers a clawback only where one can happen", () => {
  // Clawback needs the trustline's clawback flag, set only on trustlines created after the issuer
  // set AUTH_CLAWBACK_ENABLED (https://developers.stellar.org/docs/tokens/control-asset-access#clawback-enabled-0x8);
  // SetTrustLineFlags can clear it but never set it
  // (https://developers.stellar.org/docs/build/guides/transactions/clawbacks#set-trust-line-flag).
  it("the recorded FRZ and MNT trustlines are not clawback-enabled: re-authorization is the only remedy", async () => {
    const m = edgeManifest();
    for (const [role, code] of [
      ["authFrozen", "FRZ"],
      ["authMaintain", "MNT"],
    ] as const) {
      const { reader } = edgeRecordedReader();
      const plan = await planClose(
        {
          account: m.accounts[role],
          destination: m.accounts.destination,
          feeSponsor: m.accounts.sponsor,
        },
        { reader },
      );
      expect(item(plan, code).remedy, code).toBe(
        `Ask the issuer ${m.accounts.authIssuer} to authorize the trustline again (SetTrustLineFlags), then run the plan again.`,
      );
    }
  });

  it("a clawback-enabled trustline that is not authorized keeps the clawback", () => {
    const s = copy(base);
    const dusta = s.trustlines.find((t) => t.asset.code === "DUSTA")!;
    Object.assign(dusta, {
      authorized: false,
      authorizedToMaintainLiabilities: false,
      clawbackEnabled: true,
    });
    expect(item(planFromSnapshot(s, opts()), "DUSTA").remedy).toBe(
      `Ask the issuer ${messy.issuer} to authorize the trustline again (SetTrustLineFlags) or to claw the balance back, then run the plan again.`,
    );
  });
});

describe("CP-15: the destination fix names the account that holds trustlines and the full asset", () => {
  it("a muxed destination: the trustline goes on the base G account, and the asset is CODE:ISSUER", async () => {
    const muxed = new MuxedAccount(new Account(messy.destination, "0"), "7").accountId();
    expect(muxed.startsWith("M")).toBe(true);
    const plan = await planClose(
      { account: messy.fixture, destination: muxed, feeSponsor: messy.sponsor },
      { reader: messyReader({}, { memoIssuer: true }) },
    );
    const { remedy } = item(plan, "DUSTB");
    expect(remedy).toContain(
      `open a DUSTB:${messy.issuer} trustline on the destination account ${messy.destination}, or close into a destination that holds one`,
    );
    expect(remedy).not.toContain(muxed);
  });
});

describe("CP-16: IS_SPONSOR speaks of a clawback only for a clawback-enabled asset", () => {
  // Only the asset's issuer can claw a claimable balance back, and only when the balance is
  // clawback-enabled (CLAWBACK_CLAIMABLE_BALANCE_NOT_CLAWBACK_ENABLED otherwise,
  // https://developers.stellar.org/docs/learn/fundamentals/transactions/list-of-operations#clawback-claimable-balance);
  // XLM has no issuer.
  it("the recorded claimable variant created an XLM balance: no unconditional clawback", async () => {
    const m = edgeManifest();
    const { reader } = edgeRecordedReader();
    const plan = await planClose(
      {
        account: m.accounts.claimable,
        destination: m.accounts.destination,
        feeSponsor: m.accounts.sponsor,
      },
      { reader },
    );
    const { remedy } = blocker(plan, "IS_SPONSOR");
    expect(remedy).not.toContain("or clawed back by its issuer");
    expect(remedy).toContain(
      "otherwise it ends when the balance is claimed by its claimant or, if it holds a clawback-enabled asset, clawed back by that asset's issuer (ClawbackClaimableBalance).",
    );
  });
});

describe("CP-17: the sequence-guard wording names what runs before the merge", () => {
  /** A sequence number 3 ledgers ahead: the merge waits, within the default bound. */
  function guarded(s: ExistingAccountSnapshot): ClosePlan {
    s.sequence = (BigInt(s.observed.ledger + 3) << 32n).toString();
    return planFromSnapshot(s, opts());
  }
  const guardWarning = (plan: ClosePlan) => plan.warnings.find((w) => w.includes("sequence"))!;

  it("a plan whose only earlier transaction is the DUSTA sale says the sale runs first", () => {
    const s = copy(base);
    s.trustlines = s.trustlines.filter((t) => t.asset.code === "DUSTA");
    s.quotes = s.quotes.filter((q) => q.asset.code === "DUSTA");
    s.offers = [];
    s.data = [];
    s.poolShares = [];
    s.subentryCount = 1;
    s.numSponsored = 0;
    const plan = guarded(s);
    expect(plan.transactions.map((t) => t.phase)).toEqual(["convert", "merge"]);
    expect(guardWarning(plan)).toContain(
      "The sale runs first; the executor waits before submitting the merge.",
    );
    expect(guardWarning(plan)).not.toMatch(/cleanup/);
    expect(plan.transactions[1]!.reason).toMatch(
      /^The merge runs alone after the sale because it must wait until ledger \d+ for the sequence guard\.$/,
    );
  });

  it("the messy fixture runs its cleanup and its sale first", () => {
    const plan = guarded(copy(base));
    expect(plan.transactions.map((t) => t.phase)).toEqual(["cleanup", "convert", "merge"]);
    expect(guardWarning(plan)).toContain("The cleanup and the sale run first;");
    expect(plan.transactions.at(-1)!.reason).toMatch(
      /^The merge runs alone after the cleanup and the sale because/,
    );
  });

  it("a plan without a sale still says the cleanup runs first", () => {
    const s = copy(base);
    s.quotes = s.quotes.map((q) => ({ ...q, quote: null }));
    const plan = guarded(s);
    expect(plan.transactions.map((t) => t.phase)).toEqual(["cleanup", "merge"]);
    expect(guardWarning(plan)).toContain("The cleanup runs first;");
    expect(plan.transactions.at(-1)!.reason).toMatch(
      /^The merge runs alone after the cleanup because/,
    );
  });
});
