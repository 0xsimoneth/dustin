import { FeeBumpTransaction, Keypair, TransactionBuilder } from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";
import { executeClose } from "../../../src/execute/executor.js";
import { horizonSubmitter } from "../../../src/execute/submit.js";
import type { HorizonAccount } from "../../../src/inspect/horizon-types.js";
import type { BlockerCode } from "../../../src/plan/model.js";
import { planClose } from "../../../src/plan/plan-close.js";
import { horizonJson } from "../../../src/reader/horizon-json.js";
import { horizonReader } from "../../../src/reader/ledger-reader.js";
import type { Signer } from "../../../src/sponsor/signer.js";
import { FakeLedger } from "../../helpers/fake-ledger.js";
import { noSleep } from "../../helpers/no-sleep.js";
import { TESTNET_HORIZON } from "../../helpers/recorded-horizon.js";
import { messy } from "../../helpers/snapshots.js";
import { recordIncludedFaults } from "./harness.js";

// E3-S5 AC-5 (docs/epics-and-stories.md Story 3.5), offline on the fake ledger: with a
// detection-only blocker, executeClose refuses without allowPartial and signs nothing; with it, the
// safe steps run and the run stops before the merge (canonical decisions 4 and 11). The fake ledger
// does not check signatures or thresholds; the plan decides what is signed.

const TESTNET = "Test SDF Network ; September 2015";
const HOLDER = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 61)).publicKey();
const K2 = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 62)).publicKey();
const DUSTB = `DUSTB:${messy.issuer}`;
const LPA = `LPA:${messy.issuer}`;
const LPB = `LPB:${messy.issuer}`;

const signerFor = (publicKey: string): Signer => ({
  publicKey: () => publicKey,
  sign: () => undefined,
});
const signers = { account: signerFor(HOLDER), feeSponsor: signerFor(messy.sponsor) };

/**
 * An account with two safe steps (a data entry and an empty DUSTB trustline) and whatever `setup`
 * adds, on the fake ledger with the recorded messy participants and a funded fee sponsor.
 */
function holderWith(setup: (ledger: FakeLedger, account: HorizonAccount) => void) {
  const ledger = FakeLedger.messy();
  const account = FakeLedger.plainAccount(HOLDER, "10.0000000", ledger.ledgerSeq);
  ledger.accounts.set(HOLDER, account);
  account.data = { "dustin.fixture": Buffer.from("edge").toString("base64") };
  account.subentry_count += 1;
  ledger.addTrustline(HOLDER, DUSTB);
  setup(ledger, account);
  const fetch = recordIncludedFaults(ledger, ledger.fetch);
  const reader = horizonReader(horizonJson(TESTNET_HORIZON, { fetch, retries: 0 }));
  const deps = { reader, submitter: horizonSubmitter(TESTNET_HORIZON, { fetch }), sleep: noSleep };
  const plan = () =>
    planClose(
      { account: HOLDER, destination: messy.destination, feeSponsor: messy.sponsor },
      { reader },
    );
  return { ledger, deps, plan };
}

/** The operation types of every envelope the fake ledger received. */
function submittedOperations(ledger: FakeLedger): string[][] {
  return ledger.submissions.map((xdr) => {
    const bump = TransactionBuilder.fromXDR(xdr, TESTNET);
    if (!(bump instanceof FeeBumpTransaction)) throw new Error("not a fee bump");
    return bump.innerTransaction.operations.map((op) => op.type);
  });
}

const cases: Array<{
  row: string;
  code: BlockerCode;
  setup: (ledger: FakeLedger, account: HorizonAccount) => void;
  still: (account: HorizonAccount) => void;
}> = [
  {
    row: "S-09",
    code: "THRESHOLD_UNMET",
    setup: (_ledger, account) => {
      account.signers.push({ key: K2, weight: 1, type: "ed25519_public_key" });
      account.subentry_count += 1;
      account.thresholds = { low_threshold: 0, med_threshold: 0, high_threshold: 2 };
    },
    still: (account) => expect(account.thresholds.high_threshold).toBe(2),
  },
  {
    row: "X-04",
    code: "AUTH_IMMUTABLE_SET",
    setup: (_ledger, account) => {
      account.flags.auth_immutable = true;
    },
    still: (account) => expect(account.flags.auth_immutable).toBe(true),
  },
  {
    row: "X-02",
    code: "IS_SPONSOR",
    setup: (_ledger, account) => {
      account.num_sponsoring = 1;
    },
    still: (account) => expect(account.num_sponsoring).toBe(1),
  },
  {
    row: "S-08",
    code: "LIQUIDITY_POOL_SHARES",
    setup: (ledger) => {
      ledger.addTrustline(HOLDER, LPA);
      ledger.addTrustline(HOLDER, LPB);
      ledger.addPoolShareTrustline(HOLDER, [LPA, LPB], { balance: "1.0000000" });
    },
    still: (account) =>
      expect(account.balances.map((b) => b.asset_code ?? b.asset_type)).toEqual([
        "native",
        "LPA",
        "LPB",
        "liquidity_pool_shares",
      ]),
  },
];

describe("E3-S5 AC-5: detection-only blockers and allowPartial (fake ledger)", () => {
  it.each(cases)(
    "$row: $code refuses without allowPartial and signs nothing",
    async ({ code, setup }) => {
      const h = holderWith(setup);
      const plan = await h.plan();
      expect(plan.status).toBe("blocked");
      expect(plan.blockers.map((b) => b.code)).toContain(code);
      expect(plan.steps.map((st) => st.kind)).not.toContain("merge");
      const report = await executeClose(plan, signers, { confirm: true, ...h.deps });
      expect(report.status).toBe("aborted");
      expect(report.stop?.code).toBe("PLAN_NOT_CLOSABLE");
      expect(report.transactions).toEqual([]);
      expect(h.ledger.submissions).toEqual([]);
    },
  );

  it.each(cases)(
    "$row: $code with allowPartial runs the safe steps and stops before the merge",
    async ({ code, setup, still }) => {
      const h = holderWith(setup);
      const plan = await h.plan();
      const report = await executeClose(plan, signers, {
        confirm: true,
        allowPartial: true,
        ...h.deps,
      });
      expect(report.status).toBe("partial");
      expect(report.stop).toBeNull();
      expect(report.transactions.map((t) => t.result)).toEqual(["applied"]);
      expect(report.blockers.map((b) => b.code)).toContain(code);
      expect(report.message).toMatch(/block the merge/);
      // The safe steps applied; no envelope carried a merge.
      expect(submittedOperations(h.ledger)).toEqual([["changeTrust", "manageData"]]);
      expect(report.steps.map((st) => st.status)).toEqual(["applied", "applied"]);
      const account = h.ledger.accounts.get(HOLDER)!;
      expect(account.data).toEqual({});
      expect(account.balances.some((b) => b.asset_code === "DUSTB")).toBe(false);
      still(account);
      expect(report.verification).toMatchObject({ accountExists: true });
    },
  );

  it("S-09: a raised medium threshold leaves nothing signable, even with allowPartial", async () => {
    const h = holderWith((_ledger, account) => {
      account.signers.push({ key: K2, weight: 1, type: "ed25519_public_key" });
      account.subentry_count += 1;
      account.thresholds = { low_threshold: 0, med_threshold: 2, high_threshold: 2 };
    });
    const plan = await h.plan();
    expect(plan.steps).toEqual([]);
    expect(plan.blockers[0]!.reason).toContain("Blocked: the cleanup needs weight 2");
    const report = await executeClose(plan, signers, {
      confirm: true,
      allowPartial: true,
      ...h.deps,
    });
    expect(report.status).toBe("aborted");
    expect(report.stop?.code).toBe("NOTHING_TO_EXECUTE");
    expect(h.ledger.submissions).toEqual([]);
  });
});
