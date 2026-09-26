import { describe, expect, it } from "vitest";
import { executeClose, type CloseEvent } from "../../../src/execute/executor.js";
import { horizonSubmitter } from "../../../src/execute/submit.js";
import { planClose } from "../../../src/plan/plan-close.js";
import type { ClosePlan } from "../../../src/plan/model.js";
import { horizonJson } from "../../../src/reader/horizon-json.js";
import { horizonReader } from "../../../src/reader/ledger-reader.js";
import type { Signer } from "../../../src/sponsor/signer.js";
import { FakeLedger } from "../../helpers/fake-ledger.js";
import { TESTNET_HORIZON } from "../../helpers/recorded-horizon.js";
import { messy } from "../../helpers/snapshots.js";

// The fake ledger does not verify signatures, so signers only need the right public keys.
const signerFor = (publicKey: string): Signer => ({
  publicKey: () => publicKey,
  sign: () => undefined,
});
const signers = () => ({ account: signerFor(messy.fixture), feeSponsor: signerFor(messy.sponsor) });

function setup() {
  const ledger = FakeLedger.messy();
  const reader = horizonReader(
    horizonJson(TESTNET_HORIZON, { fetch: ledger.fetch, retries: 0, backoffMs: 0 }),
  );
  const submitter = horizonSubmitter(TESTNET_HORIZON, { fetch: ledger.fetch });
  const deps = { reader, submitter, pollIntervalMs: 0 };
  const plan = () =>
    planClose(
      { account: messy.fixture, destination: messy.destination, feeSponsor: messy.sponsor },
      { reader },
    );
  return { ledger, deps, plan };
}

describe("executeClose on the fake ledger", () => {
  it("publishes a copy of the report after every change, ending with the final status", async () => {
    const { deps, plan } = setup();
    const copies: Array<{ status: string; transactions: number; finished: boolean }> = [];
    const report = await executeClose(await plan(), signers(), {
      confirm: true,
      ...deps,
      onReport: (r) =>
        copies.push({
          status: r.status,
          transactions: r.transactions.length,
          finished: r.finishedAt !== null,
        }),
    });
    expect(copies[0]).toEqual({ status: "aborted", transactions: 0, finished: false });
    expect(copies.at(-1)).toEqual({ status: "closed", transactions: 3, finished: true });
    // Each submission is published before its outcome is known.
    expect(copies.some((c) => c.transactions === 1 && !c.finished)).toBe(true);
    expect(report.transactions).toHaveLength(3);
  });

  it("closes the messy fixture in the planned fee-bumped transactions and verifies it is gone", async () => {
    const { ledger, deps, plan } = setup();
    const destinationBefore = ledger.native(messy.destination);
    const events: CloseEvent["type"][] = [];
    const report = await executeClose(await plan(), signers(), {
      confirm: true,
      ...deps,
      onEvent: (e) => events.push(e.type),
    });
    expect(report.status).toBe("closed");
    expect(report.transactions.map((t) => [t.phase, t.result])).toEqual([
      ["cleanup", "applied"],
      ["convert", "applied"],
      ["merge", "applied"],
    ]);
    expect(ledger.accounts.has(messy.fixture)).toBe(false);
    expect(ledger.native(messy.destination) - destinationBefore).toBe(40_000_007n);
    expect(report.verification).toMatchObject({ accountExists: false, horizonStatus: 404 });
    expect(report.transactions.every((t) => t.feeAccount === messy.sponsor)).toBe(true);
    expect(report.recovery.feesPaidBySponsorStroops).toBe(1500);
    expect(report.recovery.feesPaidByAccount).toBe("0");
    expect(ledger.accounts.get(messy.reserveSponsor)!.num_sponsoring).toBe(0);
    expect(report.steps.every((s) => s.status === "applied")).toBe(true);
    expect(events[0]).toBe("plan");
    expect(events.filter((e) => e === "tx:confirmed")).toHaveLength(3);
    expect(events.at(-1)).toBe("done");
    for (const t of report.transactions) {
      expect(t.hash).toMatch(/^[0-9a-f]{64}$/);
      expect(t.explorerUrl).toBe(`https://stellar.expert/explorer/testnet/tx/${t.hash}`);
      expect(t.feeBumpEnvelopeXdr.length).toBeGreaterThan(0);
    }
  });

  it("requires confirm: true and the account's own signer", async () => {
    const { ledger, deps, plan } = setup();
    const p = await plan();
    await expect(
      executeClose(p, signers(), { ...deps, confirm: false as unknown as true }),
    ).rejects.toMatchObject({ code: "CONFIRMATION_REQUIRED" });
    await expect(
      executeClose(
        p,
        { account: signerFor(messy.destination), feeSponsor: signerFor(messy.sponsor) },
        { confirm: true, ...deps },
      ),
    ).rejects.toMatchObject({ code: "WRONG_SIGNER" });
    await expect(
      executeClose(
        p,
        { account: signerFor(messy.fixture), feeSponsor: signerFor(messy.fixture) },
        { confirm: true, ...deps },
      ),
    ).rejects.toMatchObject({ code: "INVALID_ADDRESS" });
    expect(ledger.submissions).toHaveLength(0);
  });

  it("aborts on drift by default and continues with the fresh plan when asked", async () => {
    const { ledger, deps, plan } = setup();
    const p = await plan();
    const dustb = ledger.accounts
      .get(messy.fixture)!
      .balances.find((b) => b.asset_code === "DUSTB")!;
    dustb.balance = "0.0000004"; // an incoming payment after planning
    const aborted = await executeClose(p, signers(), { confirm: true, ...deps });
    expect(aborted.status).toBe("aborted");
    expect(aborted.message).toMatch(/changed since the plan/);
    expect(ledger.submissions).toHaveLength(0);
    const replanned = await executeClose(p, signers(), {
      confirm: true,
      onDrift: "replan",
      ...deps,
    });
    expect(replanned.status).toBe("closed");
  });

  it("refuses a plan that cannot merge unless allowPartial, then runs everything but the merge", async () => {
    const { ledger, deps, plan } = setup();
    const dustb = ledger.accounts
      .get(messy.fixture)!
      .balances.find((b) => b.asset_code === "DUSTB")!;
    Object.assign(dustb, { is_authorized: false, is_authorized_to_maintain_liabilities: false });
    const p: ClosePlan = await plan();
    expect(p.status).toBe("partial");
    const refused = await executeClose(p, signers(), { confirm: true, ...deps });
    expect(refused.status).toBe("aborted");
    expect(ledger.submissions).toHaveLength(0);
    const partial = await executeClose(p, signers(), {
      confirm: true,
      allowPartial: true,
      ...deps,
    });
    expect(partial.status).toBe("partial");
    expect(partial.transactions.map((t) => t.phase)).toEqual(["cleanup", "convert"]);
    const left = ledger.accounts.get(messy.fixture)!;
    expect(left.balances.filter((b) => b.asset_type !== "native").map((b) => b.asset_code)).toEqual(
      ["DUSTB"],
    );
    expect(partial.verification).toMatchObject({ accountExists: true });
  });

  it("refuses to start when the sponsor cannot cover the close budget", async () => {
    const { ledger, deps, plan } = setup();
    ledger.accounts.get(messy.sponsor)!.balances[0]!.balance = "3.0000000";
    await expect(
      executeClose(await plan(), signers(), { confirm: true, ...deps }),
    ).rejects.toMatchObject({
      code: "SPONSOR_UNDERFUNDED",
    });
    expect(ledger.submissions).toHaveLength(0);
  });

  it("stops with the result codes when a transaction fails on the ledger", async () => {
    const { ledger, deps, plan } = setup();
    const report = await executeClose(await plan(), signers(), {
      confirm: true,
      ...deps,
      onEvent: (e) => {
        // The market disappears after the cleanup lands.
        if (e.type === "tx:confirmed" && e.index === 0) ledger.quotes.clear();
      },
    });
    expect(report.status).toBe("failed");
    expect(report.transactions.map((t) => t.result)).toEqual(["applied", "failed"]);
    expect(report.transactions[1]!.resultCodes).toMatchObject({
      innerTransaction: "tx_failed",
      operations: ["op_too_few_offers"],
    });
    expect(report.message).toMatch(/op_too_few_offers/);
    expect(ledger.accounts.has(messy.fixture)).toBe(true);
  });

  it("checks the account again before a separate merge and does not submit it if a subentry came back", async () => {
    const { ledger, deps, plan } = setup();
    const report = await executeClose(await plan(), signers(), {
      confirm: true,
      ...deps,
      onEvent: (e) => {
        if (e.type === "tx:confirmed" && e.index === 1) {
          const acc = ledger.accounts.get(messy.fixture)!;
          acc.data = { late: "MQ==" };
          acc.subentry_count += 1;
        }
      },
    });
    expect(report.status).toBe("failed");
    expect(report.transactions.map((t) => t.phase)).toEqual(["cleanup", "convert"]);
    expect(report.message).toMatch(/merge preflight/i);
    expect(ledger.accounts.has(messy.fixture)).toBe(true);
  });
});

describe("the executor's re-plan reproduces the user's plan (review finding R12)", () => {
  it("forwards every plan option, so a plan made with custom options runs without drift", async () => {
    const { deps } = setup();
    const plan = await planClose(
      {
        account: messy.fixture,
        destination: messy.destination,
        feeSponsor: messy.sponsor,
        slippageBps: 500,
        maxOpsPerTransaction: 4,
        maxWaitLedgers: 7,
        baseFeeStroops: 200,
        maxBaseFeeStroops: 5000,
        budgetStroops: 40_000_000,
      },
      { reader: deps.reader },
    );
    let fresh: ClosePlan | undefined;
    const report = await executeClose(plan, signers(), {
      confirm: true,
      ...deps,
      onEvent: (e) => {
        if (e.type === "plan") fresh ??= e.plan;
      },
    });
    expect(report.status).toBe("closed");
    expect(fresh!.planHash).toBe(plan.planHash);
    expect(fresh!.options).toEqual(plan.options);
    expect(fresh!.fees).toMatchObject({
      baseFeeStroops: 200,
      basis: "override",
      maxBaseFeeStroops: 5000,
      budgetStroops: 40_000_000,
    });
    expect(report.transactions.map((t) => t.stepIds.length)).toEqual([4, 4, 1, 2, 1]);
  });

  it("lets the execute options override the plan's fee cap and budget", async () => {
    const { deps, plan } = setup();
    let fresh: ClosePlan | undefined;
    await executeClose(await plan(), signers(), {
      confirm: true,
      ...deps,
      budgetStroops: 30_000_000,
      maxBaseFeeStroops: 3000,
      onEvent: (e) => {
        if (e.type === "plan") fresh ??= e.plan;
      },
    });
    expect(fresh!.fees).toMatchObject({ budgetStroops: 30_000_000, maxBaseFeeStroops: 3000 });
  });

  it("treats a slippage bound changed after planning as drift", async () => {
    const { ledger, deps, plan } = setup();
    const p = await plan();
    const tampered: ClosePlan = { ...p, options: { ...p.options!, slippageBps: 5000 } };
    const report = await executeClose(tampered, signers(), { confirm: true, ...deps });
    expect(report.status).toBe("aborted");
    expect(report.message).toMatch(/changed since the plan/);
    expect(ledger.submissions).toHaveLength(0);
  });
});
