import { appendFileSync } from "node:fs";
import {
  Asset,
  Horizon,
  Keypair,
  Operation,
  TransactionBuilder,
  type xdr,
} from "@stellar/stellar-sdk";
import { beforeAll, expect, it } from "vitest";
import { formatStroops, toStroops } from "../../src/amounts.js";
import { baseFeeFromFeeStats } from "../../src/config/fees.js";
import {
  DEFAULT_HORIZON_URL,
  TESTNET_PASSPHRASE,
  verifyHorizonIsTestnet,
} from "../../src/config/network.js";
import { executeClose, type Signers } from "../../src/execute/executor.js";
import type { CloseReport } from "../../src/execute/report.js";
import { horizonSubmitter, submitAndConfirm } from "../../src/execute/submit.js";
import { buildMessyFixture, type BuildResult } from "../../src/fixture/builder.js";
import type { HorizonAccount } from "../../src/inspect/horizon-types.js";
import type { ClosePlan, CloseStep, PlanOptions } from "../../src/plan/model.js";
import { planClose } from "../../src/plan/plan-close.js";
import { accountOffers, horizonJson } from "../../src/reader/horizon-json.js";
import { strictSendToNativePath } from "../../src/reader/ledger-reader.js";
import { renderReport } from "../../src/render/report-text.js";
import { hashHex, wrapInFeeBump } from "../../src/sponsor/fee-bump.js";
import { keypairSigner } from "../../src/sponsor/signer.js";
import { beforeFirstSale } from "../unit/execute/submit-hooks.js";
import { describeTestnet } from "./gate.js";

/**
 * Stories E3-S1 and E3-S2 live on testnet: the disposal ladder of docs/README.md canonical
 * decision 8, one fresh messy fixture per case (buildMessyFixture creates every key in memory and
 * funds them from Friendbot; the builder's baseline fixture is never touched).
 *
 *   DUSTIN_TESTNET=1 npx vitest run --project testnet test/testnet/ladder.test.ts
 *
 * With DUSTIN_LADDER_RECORD=<file>, every transaction hash is appended to that file as one JSON
 * line with its purpose and the public keys of the case (public data only), for the story records.
 */

const HORIZON = DEFAULT_HORIZON_URL;
const client = horizonJson(HORIZON);
const server = new Horizon.Server(HORIZON);
const submitter = horizonSubmitter(HORIZON);

type Fixture = Pick<BuildResult, "manifest" | "keys">;

function record(entry: Record<string, unknown>): void {
  const file = process.env.DUSTIN_LADDER_RECORD;
  if (file) appendFileSync(file, `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`);
}

/** A fresh messy fixture for one case, with its public keys and construction hashes recorded. */
async function freshFixture(name: string): Promise<Fixture> {
  const { manifest, keys } = await buildMessyFixture();
  record({ case: name, fixture: manifest.id, accounts: manifest.accounts });
  for (const t of manifest.transactions) {
    record({
      case: name,
      purpose: `fixture ${manifest.id}: ${t.step}`,
      hash: t.hash,
      ledger: t.ledger,
    });
  }
  return { manifest, keys };
}

const signersOf = (f: Fixture): Signers => ({
  account: keypairSigner(Keypair.fromSecret(f.keys.secrets.fixture)),
  feeSponsor: keypairSigner(Keypair.fromSecret(f.keys.secrets.sponsor)),
});

const account = (id: string) => client.get<HorizonAccount>(`/accounts/${id}`);

async function nativeOf(id: string): Promise<bigint> {
  const a = await account(id);
  return toStroops(a?.balances.find((b) => b.asset_type === "native")?.balance ?? "0");
}

async function lineOf(id: string, code: string): Promise<string | null> {
  const a = await account(id);
  return a?.balances.find((b) => b.asset_code === code)?.balance ?? null;
}

async function status(id: string): Promise<number> {
  const response = await fetch(`${HORIZON}/accounts/${id}`, {
    headers: { accept: "application/json" },
  });
  return response.status;
}

/** A classic transaction from `source`, paying its own fee, submitted until it applies. */
async function submitOwn(
  name: string,
  source: Keypair,
  operations: xdr.Operation[],
  purpose: string,
): Promise<{ hash: string; ledger: number }> {
  const loaded = await server.loadAccount(source.publicKey());
  const fee = baseFeeFromFeeStats(await server.feeStats());
  const builder = new TransactionBuilder(loaded, {
    fee: String(fee),
    networkPassphrase: TESTNET_PASSPHRASE,
  }).setTimeout(120);
  for (const op of operations) builder.addOperation(op);
  const tx = builder.build();
  tx.sign(source);
  const outcome = await submitAndConfirm(submitter, {
    xdr: tx.toXDR(),
    hash: hashHex(tx),
    maxTime: Number(tx.timeBounds?.maxTime ?? 0),
  });
  record({ case: name, purpose, hash: hashHex(tx), result: outcome.kind });
  if (outcome.kind !== "applied") throw new Error(`${purpose}: ${JSON.stringify(outcome)}`);
  return { hash: outcome.hash, ledger: outcome.ledger };
}

/**
 * Polls Horizon's strict-send path finder for `amount` of `asset` into XLM until `accept` holds
 * for the best destination amount (null: no record). The path finder can trail the ledger that
 * changed an offer (day-1 experiment 6, docs/progress-log.md).
 */
async function waitForPath(
  asset: { code: string; issuer: string },
  amount: string,
  accept: (best: bigint | null) => boolean,
  timeoutMs = 90_000,
): Promise<{ best: string | null; records: unknown[] }> {
  const path = strictSendToNativePath(
    { type: asset.code.length <= 4 ? "credit_alphanum4" : "credit_alphanum12", ...asset },
    amount,
  );
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const page = await client.get<{
      _embedded: { records: Array<{ destination_amount: string }> };
    }>(path);
    const records = page?._embedded.records ?? [];
    const amounts = records.map((r) => toStroops(r.destination_amount));
    const best = amounts.length > 0 ? amounts.reduce((a, b) => (b > a ? b : a)) : null;
    if (accept(best)) return { best: best === null ? null : formatStroops(best), records };
    if (Date.now() > deadline) {
      throw new Error(`the path finder did not settle for ${asset.code} within ${timeoutMs} ms`);
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
}

const planFor = (f: Fixture, extra: Partial<PlanOptions> = {}) =>
  planClose({
    account: f.manifest.accounts.fixture,
    destination: f.manifest.accounts.destination,
    feeSponsor: f.manifest.accounts.sponsor,
    ...extra,
  });

const disposalOf = (plan: ClosePlan, code: string): CloseStep | undefined =>
  plan.steps.find(
    (s) =>
      s.kind === "dispose_balance" &&
      s.subject.type === "trustline" &&
      s.subject.asset.code === code,
  );

function recordRun(name: string, report: CloseReport): void {
  for (const t of report.transactions) {
    const codes = [
      t.resultCodes?.transaction,
      t.resultCodes?.innerTransaction,
      ...(t.resultCodes?.operations ?? []),
    ].filter(Boolean);
    record({
      case: name,
      purpose: `close tx ${t.index + 1} (${t.phase}), round ${t.round}, attempt ${t.attempt}: ${t.result}${codes.length ? ` (${codes.join(", ")})` : ""}`,
      hash: t.hash,
      innerHash: t.innerHash,
      ledger: t.ledger,
    });
  }
  record({
    case: name,
    status: report.status,
    stop: report.stop?.code ?? null,
    mergedXlm: report.recovery.mergedXlm,
  });
}

/** Horizon's effects of a transaction (account_debited, trustline_removed, ...). */
async function effectsOf(hash: string) {
  const page = await client.get<{
    _embedded: {
      records: Array<{ type: string; account: string; asset_code?: string; amount?: string }>;
    };
  }>(`/transactions/${hash}/effects?limit=200`);
  return page?._embedded.records ?? [];
}

const flat = (text: string) => text.replace(/\s+/g, " ");

describeTestnet("E3-S1 live: the market vanishes between the fresh plan and the sale", () => {
  const name = "AC-E3-S1-2";
  let f: Fixture;
  let plan: ClosePlan;
  let report: CloseReport;
  let receipt: string;
  let cancel: { hash: string; ledger: number } | null = null;
  let destinationDelta: bigint;
  let accountStatus: number;

  beforeAll(async () => {
    f = await freshFixture(name);
    const a = f.manifest.accounts;
    await waitForPath({ code: "DUSTA", issuer: a.issuer }, "0.0000007", (best) => best !== null);
    plan = await planFor(f);
    const [bid] = await accountOffers(client, a.marketMaker);
    if (!bid) throw new Error("the market maker has no bid");
    const marketMaker = Keypair.fromSecret(f.keys.secrets.marketMaker);
    // Right before the first envelope carrying the sale is posted, the market maker cancels its
    // DUSTA bid (manageBuyOffer with buyAmount 0 and the bid's id deletes it,
    // https://developers.stellar.org/docs/learn/fundamentals/transactions/list-of-operations#manage-buy-offer)
    // and the hook waits until that applied.
    const wrapped = beforeFirstSale(submitter, async () => {
      cancel = await submitOwn(
        name,
        marketMaker,
        [
          Operation.manageBuyOffer({
            selling: Asset.native(),
            buying: new Asset("DUSTA", a.issuer),
            buyAmount: "0",
            price: { n: bid.price_r.d, d: bid.price_r.n },
            offerId: bid.id,
          }),
        ],
        "market maker cancels its DUSTA bid right before the sale is posted",
      );
    });
    // An injected submitter skips the executor's own testnet check (review R6), so check here.
    await verifyHorizonIsTestnet(HORIZON);
    const before = await nativeOf(a.destination);
    const plans: ClosePlan[] = [];
    report = await executeClose(plan, signersOf(f), {
      confirm: true,
      submitter: wrapped,
      onEvent: (e) => {
        if (e.type === "plan") plans.push(e.plan);
      },
    });
    recordRun(name, report);
    destinationDelta = (await nativeOf(a.destination)) - before;
    accountStatus = await status(a.fixture);
    receipt = renderReport(report, { plans });
    console.log(receipt);
  }, 900_000);

  it("AC-E3-S1-2: the fresh plan sold DUSTA by path payment, and the bid was cancelled before the sale", () => {
    expect(disposalOf(plan, "DUSTA")?.disposal?.rung).toBe("path_payment");
    expect(cancel).not.toBeNull();
  });

  it("AC-E3-S1-2: the sale is included and fails with op_too_few_offers, spending its sequence number and fee", async () => {
    const [cleanup, sale, burn] = report.transactions;
    expect(report.transactions.map((t) => [t.round, t.phase, t.result])).toEqual([
      [0, "cleanup", "applied"],
      [0, "convert", "failed"],
      [1, "cleanup", "applied"],
    ]);
    expect(cleanup).toBeDefined();
    // If the ledger ever answers another demoting code (op_under_dest_min), the run still falls
    // down the ladder; the code it answered is in the record for the story.
    const code = sale!.resultCodes?.operations?.find((c) => c !== "op_success");
    record({ case: name, saleFailedWith: code });
    expect(code).toBe("op_too_few_offers");
    const onLedger = await client.get<{
      successful: boolean;
      fee_charged: string;
      fee_account: string;
    }>(`/transactions/${sale!.hash}`);
    expect(onLedger).toMatchObject({ successful: false, fee_account: f.manifest.accounts.sponsor });
    expect(Number(onLedger!.fee_charged)).toBeGreaterThan(0);
    expect(burn!.sequence).toBe((BigInt(sale!.sequence) + 1n).toString());
  });

  it("AC-E3-S1-2: the re-plan moves DUSTA to return_to_issuer and the close completes", () => {
    expect(report.status).toBe("closed");
    expect(report.replans).toHaveLength(1);
    expect(report.replans[0]!.demoted).toEqual([`DUSTA:${f.manifest.accounts.issuer}`]);
    expect(report.replans[0]!.trigger.resultCodes.operations).toContain("op_too_few_offers");
    expect(report.steps.find((s) => s.stepId === disposalOf(plan, "DUSTA")!.id)).toMatchObject({
      status: "applied",
      rung: "return_to_issuer",
      round: 1,
      failures: 1,
    });
    expect(accountStatus).toBe(404);
    expect(report.verification).toMatchObject({ accountExists: false, horizonStatus: 404 });
    // No proceeds: the sale failed, so the destination got the balance alone, exactly.
    expect(report.recovery.mergedXlm).toBe("4.0000000");
    expect(destinationDelta).toBe(toStroops(report.recovery.mergedXlm!));
  });

  it("AC-E3-S1-2: the report and the receipt show both attempts and the re-plan with its trigger codes", () => {
    const text = flat(receipt);
    expect(text).toContain("tx 2 convert failed on the ledger");
    expect(text).toContain("tx 1 cleanup round 1 applied");
    expect(text).toMatch(/Re-plans \(1; .*op_too_few_offers/);
    expect(text).toMatch(
      /DUSTA 0\.0000007 burned: returned to its issuer \S+ in tx 1 of round 1, after the sale by path payment failed with op_too_few_offers/,
    );
  });

  it("S-01, AC-E3-S2-1: the illiquid DUSTB is burned: a payment to its issuer, then its trustline is removed", async () => {
    const dustb = disposalOf(plan, "DUSTB")!;
    expect(dustb.disposal).toMatchObject({
      rung: "return_to_issuer",
      to: f.manifest.accounts.issuer,
    });
    expect(dustb.reason).toMatch(/no strict-send path/);
    const effects = await effectsOf(report.transactions[0]!.hash);
    const fixture = f.manifest.accounts.fixture;
    expect(effects).toContainEqual(
      expect.objectContaining({
        type: "account_debited",
        account: fixture,
        asset_code: "DUSTB",
        amount: "0.0000003",
      }),
    );
    expect(effects).toContainEqual(
      expect.objectContaining({ type: "trustline_removed", account: fixture, asset_code: "DUSTB" }),
    );
    // Nobody but the issuer received it: the balance left circulation (a burn).
    expect(
      effects.filter(
        (e) =>
          e.type === "account_credited" &&
          e.asset_code === "DUSTB" &&
          e.account !== f.manifest.accounts.issuer,
      ),
    ).toEqual([]);
    expect(flat(receipt)).toMatch(/DUSTB 0\.0000003 burned: returned to its issuer \S+ in tx 1/);
  });
});

describeTestnet("E3-S2 live: --prefer-destination (canonical decision 8)", () => {
  const name = "AC-E3-S2-2";
  let f: Fixture;
  let plan: ClosePlan;
  let report: CloseReport;
  let receipt: string;
  let dustcBefore: string | null;
  let dustcAfter: string | null;
  let destinationDelta: bigint;

  beforeAll(async () => {
    f = await freshFixture(name);
    const a = f.manifest.accounts;
    await waitForPath({ code: "DUSTA", issuer: a.issuer }, "0.0000007", (best) => best !== null);
    plan = await planFor(f, { preferDestination: true });
    dustcBefore = await lineOf(a.destination, "DUSTC");
    const before = await nativeOf(a.destination);
    const plans: ClosePlan[] = [];
    report = await executeClose(plan, signersOf(f), {
      confirm: true,
      onEvent: (e) => {
        if (e.type === "plan") plans.push(e.plan);
      },
    });
    recordRun(name, report);
    dustcAfter = await lineOf(a.destination, "DUSTC");
    destinationDelta = (await nativeOf(a.destination)) - before;
    receipt = renderReport(report, { plans });
    console.log(receipt);
  }, 900_000);

  it("AC-E3-S2-2: plans DUSTC to the destination and DUSTB and SPTA to the burn, in the prefer-destination order", () => {
    expect(plan.ladderOrder).toBe("prefer-destination");
    expect(
      Object.fromEntries(
        ["DUSTA", "DUSTB", "DUSTC", "SPTA"].map((c) => [c, disposalOf(plan, c)?.disposal?.rung]),
      ),
    ).toEqual({
      DUSTA: "path_payment",
      DUSTB: "return_to_issuer",
      DUSTC: "send_to_destination",
      SPTA: "return_to_issuer",
    });
    expect(disposalOf(plan, "DUSTC")!.disposal!.to).toBe(f.manifest.accounts.destination);
  });

  it("AC-E3-S2-2, X-06 (authorized destination trustline with room): the destination's DUSTC balance rises by exactly the dust", () => {
    expect(report.status).toBe("closed");
    expect(report.verification).toMatchObject({ accountExists: false });
    expect(toStroops(dustcAfter ?? "0") - toStroops(dustcBefore ?? "0")).toBe(5n);
    for (const [code, rung] of [
      ["DUSTA", "path_payment"],
      ["DUSTB", "return_to_issuer"],
      ["DUSTC", "send_to_destination"],
      ["SPTA", "return_to_issuer"],
    ] as const) {
      expect(report.steps.find((s) => s.stepId === disposalOf(plan, code)!.id)).toMatchObject({
        status: "applied",
        rung,
      });
    }
    expect(destinationDelta).toBe(toStroops(report.recovery.mergedXlm!));
    expect(flat(receipt)).toMatch(/DUSTC 0\.0000005 sent to the destination \S+ in tx 1/);
  });
});

describeTestnet("E3-S2 live: an issuer that requires a memo, and no memo (AC-E3-S2-3)", () => {
  const name = "AC-E3-S2-3";
  let f: Fixture;
  let plan: ClosePlan;
  let refused: CloseReport;
  let sequenceBefore: string;
  let sequenceAfterRefusal: string;
  let partial: CloseReport;
  let left: HorizonAccount | null;
  let dustcDelta: bigint;
  let receipt: string;

  beforeAll(async () => {
    f = await freshFixture(name);
    const a = f.manifest.accounts;
    // SEP-29: the data entry config.memo_required = "1" asks senders for a memo
    // (https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0029.md).
    await submitOwn(
      name,
      Keypair.fromSecret(f.keys.secrets.issuer),
      [Operation.manageData({ name: "config.memo_required", value: "1" })],
      "issuer sets config.memo_required = 1 (SEP-29)",
    );
    await waitForPath({ code: "DUSTA", issuer: a.issuer }, "0.0000007", (best) => best !== null);
    plan = await planFor(f);
    sequenceBefore = (await account(a.fixture))!.sequence;
    refused = await executeClose(plan, signersOf(f), { confirm: true });
    recordRun(`${name} without allowPartial`, refused);
    sequenceAfterRefusal = (await account(a.fixture))!.sequence;
    const dustcBefore = await lineOf(a.destination, "DUSTC");
    const plans: ClosePlan[] = [];
    partial = await executeClose(plan, signersOf(f), {
      confirm: true,
      allowPartial: true,
      onEvent: (e) => {
        if (e.type === "plan") plans.push(e.plan);
      },
    });
    recordRun(`${name} with allowPartial`, partial);
    left = await account(a.fixture);
    dustcDelta =
      toStroops((await lineOf(a.destination, "DUSTC")) ?? "0") - toStroops(dustcBefore ?? "0");
    receipt = renderReport(partial, { plans });
    console.log(receipt);
  }, 900_000);

  it("AC-E3-S2-3: DUSTC goes to the destination (rung 3); DUSTB and SPTA have no route, with all three rungs ruled out and a remedy", () => {
    expect(plan.status).toBe("partial");
    expect(plan.steps.some((s) => s.kind === "merge")).toBe(false);
    const dustc = disposalOf(plan, "DUSTC")!.disposal!;
    expect(dustc.rung).toBe("send_to_destination");
    expect(dustc.ruledOut.find((r) => r.rung === "return_to_issuer")?.reason).toMatch(
      /requires a memo \(SEP-29\)/,
    );
    for (const code of ["DUSTB", "SPTA"]) {
      const item = plan.unclosable.find(
        (u) => u.subject.type === "trustline" && u.subject.asset.code === code,
      )!;
      expect(item.code).toBe("NO_DISPOSAL_ROUTE");
      expect(item.rungsRuledOut?.map((r) => r.rung)).toEqual([
        "path_payment",
        "return_to_issuer",
        "send_to_destination",
      ]);
      expect(item.remedy).toContain(
        `pass the memo that issuer ${f.manifest.accounts.issuer} requires`,
      );
    }
  });

  it("AC-E3-S2-3: without allowPartial nothing is signed (aborted, PLAN_NOT_CLOSABLE)", () => {
    expect(refused.status).toBe("aborted");
    expect(refused.stop?.code).toBe("PLAN_NOT_CLOSABLE");
    expect(refused.transactions).toHaveLength(0);
    expect(sequenceAfterRefusal).toBe(sequenceBefore);
  });

  it("AC-E3-S2-3: with allowPartial everything else runs, no merge is attempted, and the account keeps exactly the two trustlines", () => {
    expect(partial.status).toBe("partial");
    expect(partial.stop).toBeNull();
    expect(partial.transactions.map((t) => [t.phase, t.result])).toEqual([
      ["cleanup", "applied"],
      ["convert", "applied"],
    ]);
    expect(left).not.toBeNull();
    const lines = left!.balances
      .filter((b) => b.asset_type !== "native")
      .map((b) => [b.asset_code, b.balance]);
    expect(lines.sort()).toEqual([
      ["DUSTB", "0.0000003"],
      ["SPTA", "0.0000001"],
    ]);
    expect(left!.subentry_count).toBe(2);
    expect(Object.keys(left!.data)).toEqual([]);
    expect(dustcDelta).toBe(5n);
    expect(partial.verification).toMatchObject({ accountExists: true });
  });

  it("AC-E3-S2-3: the receipt lists each unclosable item with its code, the rungs ruled out and the remedy", () => {
    const text = flat(receipt);
    for (const [code, amount] of [
      ["DUSTB", "0.0000003"],
      ["SPTA", "0.0000001"],
    ]) {
      expect(text).toContain(`NO_DISPOSAL_ROUTE ${amount} ${code}`);
      expect(text).toContain(
        `No route disposes of ${amount} ${code}; every rung of the ladder is ruled out:`,
      );
      expect(text).toContain(`- send to destination: the destination holds no ${code} trustline`);
    }
    expect(text).toContain("- return to issuer: issuer");
    expect(text).toContain("remedy: Make one route possible, then run the plan again:");
  });
});

describeTestnet("E3-S1 live: dust below the resolution of the book (X-10, AC-E3-S1-3)", () => {
  const name = "X-10";
  let f: Fixture;
  let quote: { best: string | null; records: unknown[] };
  let probe: { hash: string; codes: string[] };
  let plan: ClosePlan;
  let report: CloseReport;

  beforeAll(async () => {
    f = await freshFixture(name);
    const a = f.manifest.accounts;
    const dusta = new Asset("DUSTA", a.issuer);
    const [bid] = await accountOffers(client, a.marketMaker);
    if (!bid) throw new Error("the market maker has no bid");
    // The market maker re-prices its bid to 0.1 XLM per DUSTA: 7 stroops of DUSTA then buy 0.7
    // stroop of XLM, which rounds to 0 (docs edge case B-01).
    await submitOwn(
      name,
      Keypair.fromSecret(f.keys.secrets.marketMaker),
      [
        Operation.manageBuyOffer({
          selling: Asset.native(),
          buying: dusta,
          buyAmount: "10",
          price: "0.1",
          offerId: bid.id,
        }),
      ],
      "market maker re-prices its DUSTA bid to 0.1 XLM",
    );
    quote = await waitForPath(
      { code: "DUSTA", issuer: a.issuer },
      "0.0000007",
      (best) => best === null || best < 1n,
    );
    record({ case: name, pathFinderAnswer: quote });
    // Probe: what does the ledger answer for the sale itself (U4)? The fixture holds 0.0000005
    // DUSTA free of its own offer's liabilities; the sale is fee-bumped by the sponsor.
    const fixture = Keypair.fromSecret(f.keys.secrets.fixture);
    const sponsor = Keypair.fromSecret(f.keys.secrets.sponsor);
    const loaded = await server.loadAccount(a.fixture);
    const inner = new TransactionBuilder(loaded, {
      fee: "0",
      networkPassphrase: TESTNET_PASSPHRASE,
    })
      .addOperation(
        Operation.pathPaymentStrictSend({
          sendAsset: dusta,
          sendAmount: "0.0000005",
          destination: a.fixture,
          destAsset: Asset.native(),
          destMin: "0.0000001",
          path: [],
        }),
      )
      .setTimeout(120)
      .build();
    inner.sign(fixture);
    const fee = baseFeeFromFeeStats(await server.feeStats());
    const bump = wrapInFeeBump(inner, sponsor, fee, TESTNET_PASSPHRASE);
    const outcome = await submitAndConfirm(submitter, {
      xdr: bump.toXDR(),
      hash: hashHex(bump),
      maxTime: Number(inner.timeBounds?.maxTime ?? 0),
    });
    const codes =
      outcome.kind === "failed" || outcome.kind === "rejected"
        ? [
            outcome.codes.transaction,
            outcome.codes.innerTransaction,
            ...(outcome.codes.operations ?? []),
          ].filter((c): c is string => typeof c === "string")
        : [];
    probe = { hash: hashHex(bump), codes };
    record({
      case: name,
      purpose: `probe: strict-send 0.0000005 DUSTA -> XLM, destMin 0.0000001 (${outcome.kind}${codes.length ? `: ${codes.join(", ")}` : ""})`,
      hash: probe.hash,
    });
    plan = await planFor(f);
    report = await executeClose(plan, signersOf(f), { confirm: true });
    recordRun(name, report);
  }, 900_000);

  it("X-10: the sale of dust that would buy less than 1 stroop fails on the ledger", () => {
    // Recorded, not assumed: op_too_few_offers or op_under_dest_min (edge case U4).
    expect(probe.codes.some((c) => c === "op_too_few_offers" || c === "op_under_dest_min")).toBe(
      true,
    );
  });

  it("AC-E3-S1-3, X-10: the planner routes DUSTA to its issuer instead, and the account closes", () => {
    const dusta = disposalOf(plan, "DUSTA")!.disposal!;
    expect(dusta.rung).toBe("return_to_issuer");
    expect(dusta.ruledOut.find((r) => r.rung === "path_payment")?.reason).toMatch(
      /no strict-send path|less than 1 stroop/,
    );
    expect(plan.transactions.map((t) => t.phase)).toEqual(["cleanup"]);
    expect(report.status).toBe("closed");
    expect(report.verification).toMatchObject({ accountExists: false });
  });
});
