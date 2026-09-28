import { beforeAll, describe, expect, it } from "vitest";
import type {
  ClaimableBalanceInfo,
  ExistingAccountSnapshot,
} from "../../../src/inspect/snapshot.js";
import { claimableBalanceWarning } from "../../../src/plan/claimable.js";
import { planFromSnapshot } from "../../../src/plan/plan.js";
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
        "To keep them, claim them before the close (ClaimClaimableBalance, sourced by this account, with a trustline for an asset other than XLM); claimable balance cleanup is out of scope.",
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

  it("warns nothing when there are none, or when the reader could not ask", () => {
    const none = copy(base);
    none.claimableBalancesClaimable = [];
    expect(claimableBalanceWarning(none)).toBeNull();
    const unknown = copy(base);
    unknown.claimableBalancesClaimable = null;
    expect(claimableBalanceWarning(unknown)).toBeNull();
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
