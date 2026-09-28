import { beforeAll, describe, expect, it } from "vitest";
import type { ExistingAccountSnapshot } from "../../../src/inspect/snapshot.js";
import { planFromSnapshot } from "../../../src/plan/plan.js";
import { copy, messy, messySnapshot } from "../../helpers/snapshots.js";

// Review finding CA-11, PRD decision D-10 (story E4-S2): the fields of the sequence guard that
// depend only on time leave the plan hash. A near guard makes the merge wait in a transaction of
// its own (`separateMerge`); once the guard clears, the merge joins the cleanup again (canonical
// decision 6). That regrouping, `unblocksAtLedger` and the wait estimate must not change
// `planHash`, so a guard that clears while the typed confirmation waits is not drift. A plan that
// gains or loses its merge (a far guard coming within `maxWaitLedgers`, or a near one going beyond
// it) stays drift on purpose: the user confirmed a plan with or without the irreversible step.

let base: ExistingAccountSnapshot;
beforeAll(async () => {
  base = await messySnapshot();
});
const opts = () => ({ destination: messy.destination, feeSponsor: messy.sponsor });

/**
 * The recorded fixture without a market: DUSTA returns to its issuer instead of being sold, so
 * everything is cleanup and the merge joins the one cleanup transaction while the guard holds.
 */
function noMarket(s: ExistingAccountSnapshot): ExistingAccountSnapshot {
  const b = copy(s);
  b.quotes = b.quotes.map((q) => ({ ...q, quote: null }));
  return b;
}

/** The account's sequence number `ahead` ledgers past the observed one, as BumpSequence sets it. */
function bumped(s: ExistingAccountSnapshot, ahead: number): ExistingAccountSnapshot {
  const b = copy(s);
  b.sequence = (BigInt(b.observed.ledger + ahead) << 32n).toString();
  return b;
}

/** The same account observed `ledgers` ledgers later: only time has passed. */
function later(s: ExistingAccountSnapshot, ledgers: number): ExistingAccountSnapshot {
  const b = copy(s);
  b.observed = { ...b.observed, ledger: b.observed.ledger + ledgers };
  return b;
}

describe("planHash and the sequence guard (CA-11, D-10)", () => {
  it("control: the one-transaction plan and the near-guard plan are grouped differently", () => {
    const clear = planFromSnapshot(noMarket(base), opts());
    const near = planFromSnapshot(bumped(noMarket(base), 3), opts());
    expect(clear.transactions.map((t) => t.phase)).toEqual(["cleanup"]);
    expect(near.status).toBe("closable");
    expect(near.sequenceGuard).toMatchObject({ ok: false });
    expect(near.transactions.map((t) => t.phase)).toEqual(["cleanup", "merge"]);
    expect(near.steps.find((s) => s.kind === "merge")!.txIndex).toBe(1);
  });

  it("keeps the hash when a near guard clears: the regrouping of the merge is not drift", () => {
    const account = bumped(noMarket(base), 3);
    const shown = planFromSnapshot(account, opts());
    // The same account, ten ledgers later: the guard holds no more and the merge joins the cleanup.
    const fresh = planFromSnapshot(later(account, 10), opts());
    expect(fresh.sequenceGuard).toMatchObject({ ok: true });
    expect(fresh.transactions.map((t) => t.phase)).toEqual(["cleanup"]);
    expect(fresh.planHash).toBe(shown.planHash);
  });

  it("keeps the hash while the wait only gets shorter: unblocksAtLedger and the estimate are left out", () => {
    const account = bumped(noMarket(base), 30);
    const shown = planFromSnapshot(account, opts());
    const fresh = planFromSnapshot(later(account, 10), opts());
    expect(fresh.sequenceGuard!.etaSeconds).toBeLessThan(shown.sequenceGuard!.etaSeconds!);
    expect(fresh.transactions).toHaveLength(shown.transactions.length);
    expect(fresh.planHash).toBe(shown.planHash);
  });

  it("keeps the hash of a plan whose merge runs alone anyway (a sale before it)", () => {
    // With the DUSTA sale the merge is separate with or without the guard (canonical decision 6).
    const shown = planFromSnapshot(bumped(base, 3), opts());
    const fresh = planFromSnapshot(later(bumped(base, 3), 10), opts());
    expect(shown.transactions.at(-1)!.phase).toBe("merge");
    expect(fresh.transactions.at(-1)!.phase).toBe("merge");
    expect(fresh.planHash).toBe(shown.planHash);
  });

  it("is the hash of the guard-free plan, so the hash of an unguarded plan did not change", () => {
    // Plans without a near guard hash exactly as before E4-S2: the committed dry-run snapshot's
    // planHash stays valid, and a near-guard plan hashes as its guard-free twin.
    const unguarded = planFromSnapshot(noMarket(base), opts());
    const near = planFromSnapshot(bumped(noMarket(base), 3), opts());
    expect(near.planHash).toBe(unguarded.planHash);
  });

  it("still changes the hash when a far guard comes within maxWaitLedgers: the plan gains its merge", () => {
    const account = bumped(noMarket(base), 200);
    const shown = planFromSnapshot(account, opts());
    expect(shown.status).toBe("blocked");
    expect(shown.blockers.map((b) => b.code)).toEqual(["SEQNUM_TOO_FAR"]);
    expect(shown.steps.some((s) => s.kind === "merge")).toBe(false);
    // 150 ledgers later the wait is within the default bound of 120 ledgers.
    const fresh = planFromSnapshot(later(account, 150), opts());
    expect(fresh.status).toBe("closable");
    expect(fresh.steps.some((s) => s.kind === "merge")).toBe(true);
    expect(fresh.planHash).not.toBe(shown.planHash);
  });

  it("still changes the hash when a near guard goes beyond the bound: the plan loses its merge", () => {
    const shown = planFromSnapshot(bumped(noMarket(base), 3), opts());
    // Another client bumps the sequence number far ahead while the confirmation waits.
    const fresh = planFromSnapshot(bumped(noMarket(base), 500), opts());
    expect(fresh.status).toBe("blocked");
    expect(fresh.planHash).not.toBe(shown.planHash);
  });

  it("still changes the hash when the account's ledger state changes", () => {
    const account = bumped(noMarket(base), 3);
    const shown = planFromSnapshot(account, opts());
    const changed = later(account, 10);
    changed.data = [...changed.data, { name: "late", valueBase64: "MQ==" }];
    changed.subentryCount += 1;
    expect(planFromSnapshot(changed, opts()).planHash).not.toBe(shown.planHash);
  });
});
