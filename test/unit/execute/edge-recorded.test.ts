import { FeeBumpTransaction, TransactionBuilder } from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";
import { executeClose, type ExecuteOptions } from "../../../src/execute/executor.js";
import { horizonSubmitter } from "../../../src/execute/submit.js";
import type { EdgeVariantRole } from "../../../src/fixture/edge.js";
import { planClose } from "../../../src/plan/plan-close.js";
import { horizonJson, type FetchLike } from "../../../src/reader/horizon-json.js";
import { horizonReader } from "../../../src/reader/ledger-reader.js";
import type { Signer } from "../../../src/sponsor/signer.js";
import { edgeAccount, edgeLedger } from "../../helpers/edge-ledger.js";
import { noSleep } from "../../helpers/no-sleep.js";
import { TESTNET_HORIZON } from "../../helpers/recorded-horizon.js";
import { submitToFakeLedger } from "../../helpers/submit-ops.js";
import { recordIncludedFaults } from "./harness.js";

// The D3 edge rows offline (docs/edge-cases-and-test-matrix.md section 4): the edge fixture as
// recorded on testnet right after its build, replayed on the fake ledger, which applies the
// protocol rules Dustin depends on and answers with Horizon's result codes. It does not check
// signatures, so the signers only need the right public keys.

const TESTNET = "Test SDF Network ; September 2015";

const signerFor = (publicKey: string): Signer => ({
  publicKey: () => publicKey,
  sign: () => undefined,
});

/**
 * The recorded edge fixture behind a Horizon client. `beforeFirstPost` changes the fake ledger once,
 * right before the first envelope is posted: after the executor planned and signed (edge case C-04).
 */
function edge(beforeFirstPost?: (ledger: ReturnType<typeof edgeLedger>["ledger"]) => void) {
  const { ledger, manifest } = edgeLedger();
  let acted = false;
  const intercept: FetchLike = (url, init) => {
    if (beforeFirstPost && !acted && (init?.method ?? "GET") === "POST") {
      acted = true;
      beforeFirstPost(ledger);
    }
    return ledger.fetch(url, init);
  };
  const fetch = recordIncludedFaults(ledger, intercept);
  const reader = horizonReader(horizonJson(TESTNET_HORIZON, { fetch, retries: 0 }));
  const deps: Partial<ExecuteOptions> = {
    reader,
    submitter: horizonSubmitter(TESTNET_HORIZON, { fetch }),
    sleep: noSleep,
  };
  const account = (role: EdgeVariantRole) => manifest.accounts[role];
  const plan = (role: EdgeVariantRole) =>
    planClose(
      {
        account: account(role),
        destination: manifest.accounts.destination,
        feeSponsor: manifest.accounts.sponsor,
      },
      { reader },
    );
  const signers = (role: EdgeVariantRole) => ({
    account: signerFor(account(role)),
    feeSponsor: signerFor(manifest.accounts.sponsor),
  });
  const run = async (role: EdgeVariantRole, options: Partial<ExecuteOptions> = {}) =>
    executeClose(await plan(role), signers(role), { confirm: true, ...deps, ...options });
  return { ledger, manifest, account, plan, run };
}

const lines = (balances: Array<{ asset_type: string; asset_code?: string }>) =>
  balances
    .filter((b) => b.asset_type !== "native")
    .map((b) => b.asset_code ?? b.asset_type)
    .sort();

function submittedOperations(xdrs: string[]): string[][] {
  return xdrs.map((xdr) => {
    const bump = TransactionBuilder.fromXDR(xdr, TESTNET);
    if (!(bump instanceof FeeBumpTransaction)) throw new Error("not a fee bump");
    return bump.innerTransaction.operations.map((op) => op.type);
  });
}

describe("the recorded edge fixture on the fake ledger", () => {
  it("S-02 (recorded): refuses the frozen account without allowPartial; with it burns ILQX, removes it and the data entry, and leaves only FRZ", async () => {
    const e = edge();
    const refused = await e.run("authFrozen");
    expect(refused).toMatchObject({ status: "aborted", transactions: [] });
    expect(refused.stop?.code).toBe("PLAN_NOT_CLOSABLE");
    expect(e.ledger.submissions).toEqual([]);

    const report = await e.run("authFrozen", { allowPartial: true });
    expect(report.status).toBe("partial");
    expect(report.unclosable.map((u) => u.code)).toEqual(["TRUSTLINE_NOT_AUTHORIZED"]);
    expect(submittedOperations(e.ledger.submissions)).toEqual([
      ["payment", "changeTrust", "manageData"],
    ]);
    const left = edgeAccount(e.ledger, e.manifest, "authFrozen");
    expect(lines(left.balances)).toEqual(["FRZ"]);
    expect(left.data).toEqual({});
    expect(report.verification).toMatchObject({ accountExists: true });
  });

  it("S-02 negative probe (recorded): paying the frozen FRZ back to its issuer fails with op_src_not_authorized", async () => {
    const e = edge();
    const outcome = await submitToFakeLedger(e.ledger, {
      source: e.account("authFrozen"),
      sponsor: e.manifest.accounts.sponsor,
      operations: [
        {
          type: "payment",
          destination: e.manifest.accounts.authIssuer,
          asset: {
            type: "credit_alphanum4",
            code: "FRZ",
            issuer: e.manifest.accounts.authIssuer,
          },
          amount: "0.0000005",
        },
      ],
    });
    expect(outcome).toMatchObject({
      kind: "failed",
      codes: {
        transaction: "tx_fee_bump_inner_failed",
        innerTransaction: "tx_failed",
        operations: ["op_src_not_authorized"],
      },
    });
  });

  it("S-02 forced (AC-E3-S6-3, recorded): RVK revoked after planning makes the return fail with op_src_not_authorized, which the report records; allowPartial runs the rest", async () => {
    const revoke = (ledger: ReturnType<typeof edgeLedger>["ledger"]) => {
      const e = edgeLedger().manifest;
      const line = ledger.accounts
        .get(e.accounts.authRevoke)!
        .balances.find((b) => b.asset_code === "RVK")!;
      Object.assign(line, { is_authorized: false, is_authorized_to_maintain_liabilities: false });
    };
    const e = edge(revoke);
    const p = await e.plan("authRevoke");
    expect(p.status).toBe("closable");
    const report = await e.run("authRevoke", { allowPartial: true });
    expect(report.status).toBe("partial");
    const [failed, ...rest] = report.transactions;
    expect(failed).toMatchObject({ result: "failed" });
    expect(failed!.resultCodes?.operations).toContain("op_src_not_authorized");
    expect(failed!.explanation).toMatch(/no longer authorizes/);
    const step = report.steps.find((s) => s.status === "failed");
    expect(step).toMatchObject({
      failures: 1,
      explanation: "The issuer no longer authorizes this trustline to send the asset.",
    });
    expect(step!.resultCodes?.operations).toContain("op_src_not_authorized");
    expect(report.replans).toHaveLength(1);
    expect(report.replans[0]!.trigger.resultCodes.operations).toContain("op_src_not_authorized");
    expect(report.replans[0]!.drift).toEqual([]);
    expect(report.unclosable.map((u) => u.code)).toEqual(["TRUSTLINE_NOT_AUTHORIZED"]);
    expect(rest.map((t) => t.result)).toEqual(["applied"]);
    expect(submittedOperations(e.ledger.submissions)).toEqual([
      ["payment", "changeTrust", "manageData", "accountMerge"],
      ["manageData"],
    ]);
    const left = edgeAccount(e.ledger, e.manifest, "authRevoke");
    expect(lines(left.balances)).toEqual(["RVK"]);
    expect(left.data).toEqual({});
  });

  it("S-02 forced without allowPartial (recorded): the re-plan cannot merge, so the run stops with PLAN_NOT_CLOSABLE and keeps the failed transaction", async () => {
    const e = edge((ledger) => {
      const e2 = edgeLedger().manifest;
      const line = ledger.accounts
        .get(e2.accounts.authRevoke)!
        .balances.find((b) => b.asset_code === "RVK")!;
      Object.assign(line, { is_authorized: false, is_authorized_to_maintain_liabilities: false });
    });
    const report = await e.run("authRevoke");
    expect(report.status).toBe("failed");
    expect(report.stop?.code).toBe("PLAN_NOT_CLOSABLE");
    expect(report.stop?.detail).toMatch(/not authorized the RVK trustline/);
    expect(report.transactions.map((t) => t.result)).toEqual(["failed"]);
    expect(e.ledger.submissions).toHaveLength(1);
  });

  it("S-05 (recorded): closes auth-authorized in one fee-bumped transaction, returning AUTH to its issuer", async () => {
    const e = edge();
    const before = e.ledger.native(e.manifest.accounts.destination);
    const report = await e.run("authAuthorized");
    expect(report.status).toBe("closed");
    expect(submittedOperations(e.ledger.submissions)).toEqual([
      ["payment", "changeTrust", "accountMerge"],
    ]);
    expect(report.steps.find((s) => s.rung)).toMatchObject({ rung: "return_to_issuer" });
    expect(e.ledger.accounts.has(e.account("authAuthorized"))).toBe(false);
    // The whole 1.5 XLM reaches the destination; the account paid no fee. (The fake ledger keeps
    // no result XDR, so the merged amount is read from the destination, not the report.)
    expect(e.ledger.native(e.manifest.accounts.destination) - before).toBe(15_000_000n);
    expect(report.recovery.feesPaidByAccount).toBe("0");
  });

  it("S-06 (recorded): cancels the MNT offer, keeps the maintain-liabilities balance and stops before the merge", async () => {
    const e = edge();
    const report = await e.run("authMaintain", { allowPartial: true });
    expect(report.status).toBe("partial");
    expect(report.unclosable.map((u) => u.code)).toEqual(["MAINTAIN_LIABILITIES_ONLY"]);
    expect(submittedOperations(e.ledger.submissions)).toEqual([["manageSellOffer"]]);
    expect(e.ledger.offers.get(e.account("authMaintain"))).toEqual([]);
    const mnt = edgeAccount(e.ledger, e.manifest, "authMaintain").balances.find(
      (b) => b.asset_code === "MNT",
    );
    expect(mnt).toMatchObject({ balance: "0.0000005", is_authorized: false });
  });

  it("S-07 (recorded): closes the clawback-enabled holder through the return to issuer", async () => {
    const e = edge();
    const p = await e.plan("clawback");
    expect(p.warnings.join(" ")).toMatch(/clawback-enabled/);
    const report = await e.run("clawback");
    expect(report.status).toBe("closed");
    expect(report.steps.find((s) => s.rung)).toMatchObject({ rung: "return_to_issuer" });
    expect(e.ledger.accounts.has(e.account("clawback"))).toBe(false);
  });

  it("S-07b (recorded): a clawback after planning fails the return with op_underfunded; the executor re-plans and closes", async () => {
    const e = edge((ledger) => {
      const m = edgeLedger().manifest;
      const line = ledger.accounts
        .get(m.accounts.clawbackDrift)!
        .balances.find((b) => b.asset_code === "CLAW")!;
      line.balance = "0.0000000"; // ClawbackOp burns the holder's balance (CAP-35)
    });
    const report = await e.run("clawbackDrift");
    expect(report.status).toBe("closed");
    expect(report.transactions.map((t) => t.result)).toEqual(["failed", "applied"]);
    expect(report.transactions[0]!.resultCodes?.operations).toContain("op_underfunded");
    expect(report.replans).toHaveLength(1);
    expect(report.replans[0]!.drift).toEqual([]);
    expect(submittedOperations(e.ledger.submissions)).toEqual([
      ["payment", "changeTrust", "accountMerge"],
      ["changeTrust", "accountMerge"],
    ]);
  });

  it("S-08 (recorded): the partial close removes only the data entry; removing LPA fails with op_cannot_delete", async () => {
    const e = edge();
    const refused = await e.run("poolShare");
    expect(refused.stop?.code).toBe("PLAN_NOT_CLOSABLE");
    const report = await e.run("poolShare", { allowPartial: true });
    expect(report.status).toBe("partial");
    expect(submittedOperations(e.ledger.submissions)).toEqual([["manageData"]]);
    const left = edgeAccount(e.ledger, e.manifest, "poolShare");
    expect(lines(left.balances)).toEqual(["LPA", "LPB", "liquidity_pool_shares"]);
    const probe = await submitToFakeLedger(e.ledger, {
      source: e.account("poolShare"),
      sponsor: e.manifest.accounts.sponsor,
      operations: [
        {
          type: "changeTrust",
          asset: { type: "credit_alphanum4", code: "LPA", issuer: e.manifest.accounts.plainIssuer },
          limit: "0",
        },
      ],
    });
    expect(probe).toMatchObject({ kind: "failed", codes: { operations: ["op_cannot_delete"] } });
  });

  it("S-09 (recorded): refuses without allowPartial and signs nothing; with it removes the data entry and leaves the merge out", async () => {
    const e = edge();
    const refused = await e.run("multisig");
    expect(refused).toMatchObject({ status: "aborted", transactions: [] });
    expect(e.ledger.submissions).toEqual([]);
    const report = await e.run("multisig", { allowPartial: true });
    expect(report.status).toBe("partial");
    expect(report.blockers.map((b) => b.code)).toEqual(["THRESHOLD_UNMET"]);
    expect(submittedOperations(e.ledger.submissions)).toEqual([["manageData"]]);
    expect(edgeAccount(e.ledger, e.manifest, "multisig").data).toEqual({});
  });

  it.each([
    { row: "X-01", role: "claimable" as const, code: "IS_SPONSOR" },
    { row: "X-04", role: "immutable" as const, code: "AUTH_IMMUTABLE_SET" },
  ])(
    "$row (recorded): $code leaves nothing to run, with or without allowPartial",
    async ({ role, code }) => {
      const e = edge();
      const refused = await e.run(role);
      expect(refused.stop?.code).toBe("PLAN_NOT_CLOSABLE");
      expect(refused.blockers.map((b) => b.code)).toContain(code);
      const partial = await e.run(role, { allowPartial: true });
      expect(partial).toMatchObject({ status: "aborted", transactions: [] });
      expect(partial.stop?.code).toBe("NOTHING_TO_EXECUTE");
      expect(e.ledger.submissions).toEqual([]);
    },
  );
});
