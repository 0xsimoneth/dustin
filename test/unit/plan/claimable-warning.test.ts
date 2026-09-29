import { beforeAll, describe, expect, it } from "vitest";
import type {
  ClaimableBalanceInfo,
  ExistingAccountSnapshot,
} from "../../../src/inspect/snapshot.js";
import { claimableBalanceWarning } from "../../../src/plan/claimable.js";
import { planFromSnapshot } from "../../../src/plan/plan.js";
import { CLAIMANT_READ_LIMIT } from "../../../src/reader/ledger-reader.js";
import { copy, messy, messySnapshot } from "../../helpers/snapshots.js";

// Matrix row X-03: claimable balances that name the account as a claimant. Claimable balance
// cleanup is out of scope (SOW), and such a balance blocks nothing, so the plan warns and stays
// closable. The balances are synthesized on copies of the recorded messy fixture.

let base: ExistingAccountSnapshot;
beforeAll(async () => {
  base = await messySnapshot();
});

const opts = () => ({ destination: messy.destination });
const id = (n: number) => `00000000${n.toString(16).padStart(64, "0")}`;
const cb = (n: number, asset: string, amount: string): ClaimableBalanceInfo => ({
  id: id(n),
  asset,
  amount,
  sponsor: messy.issuer,
});

describe("X-03: the plan warns about claimable balances the account can claim", () => {
  it("names how many, of which assets, that they stay on the ledger and that the merged account can no longer claim them", () => {
    const s = copy(base);
    s.claimableBalancesClaimable = [
      cb(1, "native", "0.0000001"),
      cb(2, `CBA:${messy.issuer}`, "0.0000002"),
      cb(3, "native", "1.0000000"),
    ];
    const plan = planFromSnapshot(s, opts());
    const warning = plan.warnings.find((w) => w.includes("claimable balance"));
    expect(warning).toBe(
      `This account is a claimant of 3 claimable balances: 2 of XLM (1.0000001 XLM in total) and 1 of CBA issued by ${messy.issuer} (0.0000002 CBA); ids ${id(1)}, ${id(2)}, ${id(3)}. ` +
        "The merge does not touch them: they stay on the ledger, and after the merge this account can no longer claim them unless it is created again; any other claimant their predicates allow can still claim them. " +
        "Before the close, this account can claim those whose predicates still allow it (ClaimClaimableBalance, sourced by this account, with a trustline for an asset other than XLM); claimable balance cleanup is out of scope.",
    );
  });

  it("keeps the plan closable and its steps, grouping and hash unchanged", () => {
    const without = planFromSnapshot(copy(base), opts());
    const s = copy(base);
    s.claimableBalancesClaimable = [cb(1, "native", "0.0000001")];
    const plan = planFromSnapshot(s, opts());
    expect(plan.status).toBe("closable");
    expect(plan.blockers).toEqual([]);
    expect(plan.steps).toEqual(without.steps);
    expect(plan.planHash).toBe(without.planHash);
    expect(plan.warnings).toEqual([claimableBalanceWarning(s), ...without.warnings]);
  });

  it("says one balance in the singular", () => {
    const s = copy(base);
    s.claimableBalancesClaimable = [cb(7, "native", "0.5")];
    expect(claimableBalanceWarning(s)).toMatch(
      new RegExp(
        `^This account is a claimant of 1 claimable balance: 1 of XLM \\(0\\.5000000 XLM\\); id ${id(7)}\\. `,
      ),
    );
  });

  it("names at most five ids and counts the rest", () => {
    const s = copy(base);
    s.claimableBalancesClaimable = Array.from({ length: 8 }, (_, i) =>
      cb(i + 1, "native", "0.0000001"),
    );
    const warning = claimableBalanceWarning(s)!;
    expect(warning).toContain(`8 of XLM (0.0000008 XLM in total)`);
    expect(warning).toContain(`ids ${[1, 2, 3, 4, 5].map(id).join(", ")} and 3 more.`);
    expect(warning).not.toContain(id(6));
  });

  it("warns nothing when there are none, or when nothing was read (the field is absent)", () => {
    const none = copy(base);
    none.claimableBalancesClaimable = [];
    expect(claimableBalanceWarning(none)).toBeNull();
    const unread = copy(base);
    delete unread.claimableBalancesClaimable;
    expect(claimableBalanceWarning(unread)).toBeNull();
    expect(planFromSnapshot(none, opts()).warnings.join(" ")).not.toMatch(/claimable/);
  });

  it("warns on a blocked plan too, next to the blockers", () => {
    const s = copy(base);
    s.flags.authImmutable = true;
    s.claimableBalancesClaimable = [cb(1, "native", "0.0000001")];
    const plan = planFromSnapshot(s, opts());
    expect(plan.status).toBe("blocked");
    expect(plan.warnings).toContain(claimableBalanceWarning(s));
    // Nothing can be signed at all: the warning still reaches the plan.
    const locked = copy(s);
    locked.flags.authImmutable = false;
    locked.masterWeight = 0;
    locked.signers[0]!.weight = 0;
    const lockedPlan = planFromSnapshot(locked, opts());
    expect(lockedPlan.steps).toEqual([]);
    expect(lockedPlan.warnings).toContain(claimableBalanceWarning(s));
  });
});

describe("Epic 4 review: the claimant warning", () => {
  it("EP-4: a read that failed (null) is said as such, and the plan stays as it is", () => {
    const failed = copy(base);
    failed.claimableBalancesClaimable = null;
    expect(claimableBalanceWarning(failed)).toBe(
      "Dustin could not read the claimable balances that name this account as a claimant (GET /claimable_balances?claimant=), so this plan cannot say whether there are any. " +
        "A merge does not touch such balances: they stay on the ledger, and after the merge this account can no longer claim them unless it is created again. Check them on Horizon before the close; claimable balance cleanup is out of scope.",
    );
    const plan = planFromSnapshot(failed, opts());
    const without = planFromSnapshot(copy(base), opts());
    expect(plan.planHash).toBe(without.planHash);
    expect(plan.warnings).toEqual([claimableBalanceWarning(failed), ...without.warnings]);
  });

  it("EP-4: a list as long as the read's bound says at least that many", () => {
    const s = copy(base);
    s.claimableBalancesClaimable = Array.from({ length: CLAIMANT_READ_LIMIT }, (_, i) =>
      cb(i + 1, "native", "0.0000001"),
    );
    expect(claimableBalanceWarning(s)).toMatch(
      /^This account is a claimant of at least 2000 claimable balances \(Dustin reads the first 2000 only\): 2000 of XLM \(0\.0002000 XLM in total\); ids /,
    );
    s.claimableBalancesClaimable = s.claimableBalancesClaimable.slice(1);
    expect(claimableBalanceWarning(s)).toMatch(
      /^This account is a claimant of 1999 claimable balances: /,
    );
  });

  it("EP-18: never tells the account to claim what its predicates may no longer allow", () => {
    // P-C2 of the review: a balance whose predicate for this account already failed was still
    // "to keep, claim before the close". The snapshot carries no predicate, so the advice holds
    // whatever they say.
    const s = copy(base);
    s.claimableBalancesClaimable = [cb(1, "native", "5")];
    const warning = claimableBalanceWarning(s)!;
    expect(warning).not.toContain("To keep them, claim them before the close");
    expect(warning).toContain(
      "Before the close, this account can claim those whose predicates still allow it (ClaimClaimableBalance",
    );
  });

  it("EP-18: parses native and CODE:ISSUER strictly, and shows anything else as given", () => {
    // P-C3 of the review: "CBA" without an issuer read as "CBA issued by " (an empty issuer).
    const s = copy(base);
    s.claimableBalancesClaimable = [
      cb(1, "CBA", "0.0000001"),
      cb(2, `CBA:${messy.issuer}:extra`, "0.0000002"),
      cb(3, "CBA:GABC", "0.0000003"),
      cb(4, `ABCDEFGHIJKLM:${messy.issuer}`, "0.0000004"),
      cb(5, `CBA:${messy.issuer}`, "0.0000005"),
      cb(6, "Native", "0.0000006"),
    ];
    const warning = claimableBalanceWarning(s)!;
    expect(warning).toContain('1 of "CBA" (0.0000001)');
    expect(warning).toContain(`1 of "CBA:${messy.issuer}:extra" (0.0000002)`);
    expect(warning).toContain('1 of "CBA:GABC" (0.0000003)');
    expect(warning).toContain(`1 of "ABCDEFGHIJKLM:${messy.issuer}" (0.0000004)`);
    expect(warning).toContain(`1 of CBA issued by ${messy.issuer} (0.0000005 CBA)`);
    expect(warning).toContain('1 of "Native" (0.0000006)');
    expect(warning).not.toMatch(/issued by \(/);
  });

  it("AC-16: a snapshot without the field is a valid planFromSnapshot input, and its plan warns nothing about claimants", () => {
    // Before the fix the property was required, and this assignment did not type-check.
    const { claimableBalancesClaimable: _dropped, ...rest } = copy(base);
    const input: ExistingAccountSnapshot = rest;
    const plan = planFromSnapshot(input, opts());
    expect(plan.snapshotHash).toBe(base.snapshotHash);
    expect(plan.planHash).toBe(planFromSnapshot(copy(base), opts()).planHash);
    expect(plan.warnings.join(" ")).not.toMatch(/claimant/);
  });
});
