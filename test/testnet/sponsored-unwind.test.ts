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
import { DEFAULT_HORIZON_URL, TESTNET_PASSPHRASE } from "../../src/config/network.js";
import { executeClose, type Signers } from "../../src/execute/executor.js";
import type { CloseReport } from "../../src/execute/report.js";
import {
  horizonSubmitter,
  submitAndConfirm,
  type SubmitOutcome,
} from "../../src/execute/submit.js";
import { buildMessyFixture, type BuildResult } from "../../src/fixture/builder.js";
import type { HorizonAccount } from "../../src/inspect/horizon-types.js";
import { reserveFromHorizon } from "../../src/inspect/reserve.js";
import type { ClosePlan, CloseStep } from "../../src/plan/model.js";
import { planClose } from "../../src/plan/plan-close.js";
import { horizonJson, latestLedger } from "../../src/reader/horizon-json.js";
import { renderReport } from "../../src/render/report-text.js";
import { hashHex, wrapInFeeBump } from "../../src/sponsor/fee-bump.js";
import { keypairSigner } from "../../src/sponsor/signer.js";
import { describeTestnet } from "./gate.js";

/**
 * Story E3-S3 live on testnet, matrix rows S-03 (sponsored trustline unwinding) and X-18 (sponsored
 * signer) of docs/edge-cases-and-test-matrix.md section 4. Each case builds its own fresh messy
 * fixture from Friendbot (buildMessyFixture creates every key in memory); the builder's baseline
 * fixture is never touched. In the messy fixture the SPTA trustline's reserve is sponsored by the
 * reserve sponsor, a separate account from the fee sponsor that pays every fee (PRD A-4).
 *
 *   DUSTIN_TESTNET=1 npx vitest run --project testnet --reporter=verbose test/testnet/sponsored-unwind.test.ts
 *
 * Every hash is printed with its purpose and ledger; with DUSTIN_UNWIND_RECORD=<file> it is also
 * appended to that file as one JSON line (public data only), for the story record.
 *
 * Facts: removing a sponsored entry lowers the sponsor's num_sponsoring and the owner's
 * num_sponsored, and moves no XLM; the minimum balance is (2 + numSubEntries + numSponsoring -
 * numSponsored) x base reserve
 * (https://developers.stellar.org/docs/build/guides/transactions/sponsored-reserves#effect-on-minimum-balance).
 * The owner removes the entry alone; a signature it does not need fails the transaction with
 * tx_bad_auth_extra, "unused signatures attached to transaction"
 * (https://developers.stellar.org/docs/data/apis/horizon/api-reference/errors/result-codes/transactions;
 * day-1 experiment 3). The merge removes the account's signers, a sponsored one included, with
 * removeSignerWithPossibleSponsorship (stellar-core MergeOpFrame::doApplyFromV16,
 * https://github.com/stellar/stellar-core/blob/master/src/transactions/MergeOpFrame.cpp).
 */

const HORIZON = DEFAULT_HORIZON_URL;
const client = horizonJson(HORIZON);
const server = new Horizon.Server(HORIZON);
const submitter = horizonSubmitter(HORIZON);

type Fixture = Pick<BuildResult, "manifest" | "keys">;
type Role = keyof Fixture["keys"]["secrets"];

function record(entry: Record<string, unknown>): void {
  const line = JSON.stringify({ at: new Date().toISOString(), ...entry });
  console.log(line);
  const file = process.env.DUSTIN_UNWIND_RECORD;
  if (file) appendFileSync(file, `${line}\n`);
}

async function freshFixture(name: string): Promise<Fixture> {
  const { manifest, keys } = await buildMessyFixture();
  record({ case: name, fixture: manifest.id, accounts: manifest.accounts });
  for (const t of manifest.transactions) {
    record({ case: name, purpose: `fixture: ${t.step}`, hash: t.hash, ledger: t.ledger });
  }
  return { manifest, keys };
}

const keyOf = (f: Fixture, role: Role) => Keypair.fromSecret(f.keys.secrets[role]);

const signersOf = (f: Fixture): Signers => ({
  account: keypairSigner(keyOf(f, "fixture")),
  feeSponsor: keypairSigner(keyOf(f, "sponsor")),
});

const planFor = (f: Fixture) =>
  planClose({
    account: f.manifest.accounts.fixture,
    destination: f.manifest.accounts.destination,
    feeSponsor: f.manifest.accounts.sponsor,
  });

const account = (id: string) => client.get<HorizonAccount>(`/accounts/${id}`);

interface SponsorRead {
  numSponsoring: number;
  balance: string;
  minimumBalance: string;
  ledger: number;
}

/** A reserve sponsor as Horizon shows it, with its minimum balance (CAP-33). */
async function sponsorState(id: string): Promise<SponsorRead> {
  const ledger = await latestLedger(client);
  const a = await account(id);
  if (!a) throw new Error(`${id} does not exist`);
  const reserve = reserveFromHorizon(a, BigInt(ledger.base_reserve_in_stroops));
  return {
    numSponsoring: a.num_sponsoring,
    balance: formatStroops(reserve.balance),
    minimumBalance: formatStroops(reserve.minimum),
    ledger: ledger.sequence,
  };
}

/**
 * A transaction from the fixture, signed by it and by `alsoSignedBy`, fee-bumped by the fixture's
 * sponsor (inner fee 0, CAP-15) and submitted until its fate is known.
 */
async function fromFixture(
  f: Fixture,
  name: string,
  purpose: string,
  operations: xdr.Operation[],
  alsoSignedBy: Role[] = [],
): Promise<SubmitOutcome> {
  const loaded = await server.loadAccount(f.manifest.accounts.fixture);
  const fee = baseFeeFromFeeStats(await server.feeStats());
  const builder = new TransactionBuilder(loaded, {
    fee: "0",
    networkPassphrase: TESTNET_PASSPHRASE,
  }).setTimeout(120);
  for (const op of operations) builder.addOperation(op);
  const inner = builder.build();
  inner.sign(keyOf(f, "fixture"), ...alsoSignedBy.map((r) => keyOf(f, r)));
  const bump = wrapInFeeBump(inner, keyOf(f, "sponsor"), fee, TESTNET_PASSPHRASE);
  const outcome = await submitAndConfirm(submitter, {
    xdr: bump.toXDR(),
    hash: hashHex(bump),
    maxTime: Number(inner.timeBounds?.maxTime ?? 0),
  });
  record({
    case: name,
    purpose,
    hash: hashHex(bump),
    innerHash: hashHex(inner),
    result: outcome.kind,
    ...("ledger" in outcome && outcome.ledger !== undefined ? { ledger: outcome.ledger } : {}),
    ...("codes" in outcome ? { codes: outcome.codes } : {}),
  });
  return outcome;
}

function recordRun(name: string, report: CloseReport): void {
  for (const t of report.transactions) {
    record({
      case: name,
      purpose: `close tx ${t.index + 1} (${t.phase}), round ${t.round}, attempt ${t.attempt}: ${t.result}`,
      hash: t.hash,
      innerHash: t.innerHash,
      ledger: t.ledger,
    });
  }
  record({ case: name, status: report.status, recovery: report.recovery });
}

interface Effect {
  type: string;
  account?: string;
  asset?: string;
  signer?: string;
  former_sponsor?: string;
}

async function effectsOf(hash: string): Promise<Effect[]> {
  const page = await client.get<{ _embedded: { records: Effect[] } }>(
    `/transactions/${hash}/effects?limit=200`,
  );
  return page?._embedded.records ?? [];
}

/** The applied envelope that carried a step of the plan. */
function envelopeOf(report: CloseReport, step: CloseStep) {
  return report.transactions.find((t) => t.result === "applied" && t.stepIds.includes(step.id));
}

const flat = (text: string) => text.replace(/\s+/g, " ");

describeTestnet(
  "S-03 live: the sponsored trustline is removed by the account alone (AC-E3-S3-1, AC-E3-S3-2)",
  () => {
    const name = "S-03";
    let f: Fixture;
    let control: SubmitOutcome;
    let sequenceBeforeControl: string;
    let sequenceAfterControl: string;
    let before: SponsorRead;
    let after: SponsorRead;
    let plan: ClosePlan;
    let report: CloseReport;
    let receipt: string;
    let removal: CloseStep;

    beforeAll(async () => {
      f = await freshFixture(name);
      const a = f.manifest.accounts;
      const spta = f.manifest.assets.find((x) => x.sponsored)!;
      before = await sponsorState(a.reserveSponsor);
      record({ case: name, reserveSponsorBefore: before });

      // Matrix S-03 negative control: the same removal, with the reserve sponsor's signature on the
      // inner transaction too, is refused before inclusion and consumes nothing.
      sequenceBeforeControl = (await account(a.fixture))!.sequence;
      control = await fromFixture(
        f,
        name,
        "negative control: SPTA burned and removed, the inner transaction also signed by the reserve sponsor",
        [
          Operation.payment({
            destination: spta.issuer,
            asset: new Asset(spta.code, spta.issuer),
            amount: spta.dust,
          }),
          Operation.changeTrust({ asset: new Asset(spta.code, spta.issuer), limit: "0" }),
        ],
        ["reserveSponsor"],
      );
      sequenceAfterControl = (await account(a.fixture))!.sequence;

      plan = await planFor(f);
      removal = plan.steps.find(
        (s) =>
          s.kind === "remove_trustline" &&
          s.subject.type === "trustline" &&
          s.subject.asset.code === spta.code,
      )!;
      const plans: ClosePlan[] = [];
      report = await executeClose(plan, signersOf(f), {
        confirm: true,
        onEvent: (e) => {
          if (e.type === "plan") plans.push(e.plan);
        },
      });
      recordRun(name, report);
      after = await sponsorState(a.reserveSponsor);
      record({ case: name, reserveSponsorAfter: after });
      receipt = renderReport(report, { plans });
      console.log(receipt);
    }, 900_000);

    it("S-03 negative control: the removal also signed by the reserve sponsor is refused with tx_bad_auth_extra, nothing consumed", async () => {
      expect(control.kind).toBe("rejected");
      expect(control.kind === "rejected" && control.codes).toMatchObject({
        transaction: "tx_fee_bump_inner_failed",
        innerTransaction: "tx_bad_auth_extra",
      });
      expect(sequenceAfterControl).toBe(sequenceBeforeControl);
      const onLedger = await client.get(`/transactions/${control.hash}`);
      expect(onLedger).toBeNull();
    });

    it("AC-E3-S3-2: the plan returns the SPTA reserve to the reserve sponsor, and xlmToDestination leaves it out", () => {
      const a = f.manifest.accounts;
      const issuer = f.manifest.assets.find((x) => x.sponsored)!.issuer;
      expect(plan.status).toBe("closable");
      expect(plan.recovery.reservesReturnedToSponsors).toEqual([
        { sponsor: a.reserveSponsor, xlm: "0.5000000", entries: [`trustline SPTA:${issuer}`] },
      ]);
      // What the destination gets is the account's own XLM plus the sale, nothing of the sponsor's.
      expect(toStroops(plan.recovery.xlmToDestination)).toBe(
        toStroops(plan.recovery.nativeBalance) + toStroops(plan.recovery.quotedProceedsXlm),
      );
      expect(removal.reserveReleasedTo).toEqual({ to: "sponsor", sponsor: a.reserveSponsor });
      expect(removal.reason).toMatch(/needs only this account's signature/);
    });

    it("S-03: the transaction that removed SPTA carries the account's signature only, and Horizon shows trustline_sponsorship_removed", async () => {
      const tx = envelopeOf(report, removal)!;
      const onLedger = await client.get<{
        fee_account: string;
        source_account: string;
        signatures: string[];
        inner_transaction?: { signatures: string[] };
      }>(`/transactions/${tx.hash}`);
      expect(onLedger).toMatchObject({
        fee_account: f.manifest.accounts.sponsor,
        source_account: f.manifest.accounts.fixture,
      });
      expect(onLedger!.signatures).toHaveLength(1);
      expect(onLedger!.inner_transaction!.signatures).toHaveLength(1);
      const effects = await effectsOf(tx.hash);
      const released = effects.filter((e) => e.type === "trustline_sponsorship_removed");
      record({ case: name, removalTx: tx.hash, sponsorshipEffects: released });
      expect(released).toHaveLength(1);
      expect(effects.some((e) => e.type === "trustline_removed")).toBe(true);
    });

    it("AC-E3-S3-1: num_sponsoring falls by 1, the minimum balance by 0.5 XLM, and the XLM balance is unchanged", () => {
      expect(report.status).toBe("closed");
      expect(report.verification).toMatchObject({ accountExists: false, horizonStatus: 404 });
      expect(after.numSponsoring).toBe(before.numSponsoring - 1);
      expect(toStroops(before.minimumBalance) - toStroops(after.minimumBalance)).toBe(5_000_000n);
      expect(after.balance).toBe(before.balance);
    });

    it("AC-E3-S3-1, AC-E3-S3-2: the report's observed figures say the same, next to the planned reserve", () => {
      const a = f.manifest.accounts;
      expect(report.recovery.reservesReturnedToSponsors).toEqual(
        plan.recovery.reservesReturnedToSponsors,
      );
      const [observed] = report.recovery.sponsorsObserved!;
      expect(report.recovery.sponsorsObserved).toHaveLength(1);
      expect(observed!.sponsor).toBe(a.reserveSponsor);
      expect(observed!.before).toMatchObject({
        numSponsoring: before.numSponsoring,
        balance: before.balance,
        minimumBalance: before.minimumBalance,
      });
      expect(observed!.after).toMatchObject({
        numSponsoring: after.numSponsoring,
        balance: after.balance,
        minimumBalance: after.minimumBalance,
      });
    });

    it("AC-E3-S3-4: the receipt shows Reserves released to sponsors on its own line, planned and observed", () => {
      const text = flat(receipt);
      expect(receipt).toMatch(
        /^ {2}Reserves released to sponsors: 0\.5000000 XLM, never this account's$/m,
      );
      expect(text).toContain(`num_sponsoring ${before.numSponsoring} -> ${after.numSponsoring}`);
      expect(text).toContain(
        `minimum balance ${before.minimumBalance} -> ${after.minimumBalance} XLM (0.5000000 XLM released)`,
      );
      expect(text).toMatch(/XLM balance \S+ -> \S+ \(unchanged\)/);
    });
  },
);

describeTestnet(
  "X-18 live: a signer sponsored by the reserve sponsor is removed by the merge",
  () => {
    const name = "X-18";
    const k3 = Keypair.random();
    let f: Fixture;
    let sandwich: SubmitOutcome;
    let before: SponsorRead;
    let after: SponsorRead;
    let plan: ClosePlan;
    let report: CloseReport;

    beforeAll(async () => {
      f = await freshFixture(name);
      const a = f.manifest.accounts;
      // The reserve sponsor sponsors a new signer K3 on the fixture (CAP-33 sandwich), fee-bumped by
      // the fee sponsor. The signer's reserve is sponsored, so the fixture still holds zero
      // spendable XLM. K3 is a key only, never funded and never used to sign.
      sandwich = await fromFixture(
        f,
        name,
        "fixture: the reserve sponsor sponsors signer K3 on the fixture",
        [
          Operation.beginSponsoringFutureReserves({
            sponsoredId: a.fixture,
            source: a.reserveSponsor,
          }),
          Operation.setOptions({ signer: { ed25519PublicKey: k3.publicKey(), weight: 1 } }),
          Operation.endSponsoringFutureReserves({}),
        ],
        ["reserveSponsor"],
      );
      record({ case: name, sponsoredSigner: k3.publicKey() });
      before = await sponsorState(a.reserveSponsor);
      record({ case: name, reserveSponsorBefore: before });
      plan = await planFor(f);
      report = await executeClose(plan, signersOf(f), { confirm: true });
      recordRun(name, report);
      after = await sponsorState(a.reserveSponsor);
      record({ case: name, reserveSponsorAfter: after });
    }, 900_000);

    it("X-18: the plan returns the signer's reserve to the reserve sponsor with the merge", () => {
      const a = f.manifest.accounts;
      const issuer = f.manifest.assets.find((x) => x.sponsored)!.issuer;
      expect(sandwich.kind).toBe("applied");
      expect(plan.status).toBe("closable");
      expect(plan.recovery.reservesReturnedToSponsors).toEqual([
        {
          sponsor: a.reserveSponsor,
          xlm: "1.0000000",
          entries: [`trustline SPTA:${issuer}`, `signer ${k3.publicKey()}`],
        },
      ]);
    });

    it("X-18: the reserve sponsor's num_sponsoring falls by 2 (the trustline and the signer), its XLM balance unchanged", () => {
      expect(report.status).toBe("closed");
      expect(report.verification).toMatchObject({ accountExists: false });
      expect(before.numSponsoring - after.numSponsoring).toBe(2);
      expect(toStroops(before.minimumBalance) - toStroops(after.minimumBalance)).toBe(10_000_000n);
      expect(after.balance).toBe(before.balance);
      expect(report.recovery.reservesReturnedToSponsors).toEqual(
        plan.recovery.reservesReturnedToSponsors,
      );
      const [observed] = report.recovery.sponsorsObserved!;
      expect(observed!.before!.numSponsoring - observed!.after!.numSponsoring).toBe(2);
    });

    it("X-18: the merge transaction shows signer_sponsorship_removed", async () => {
      const merge = plan.steps.find((s) => s.kind === "merge")!;
      const tx = envelopeOf(report, merge)!;
      const effects = await effectsOf(tx.hash);
      const released = effects.filter((e) => e.type === "signer_sponsorship_removed");
      record({ case: name, mergeTx: tx.hash, sponsorshipEffects: released });
      expect(released).toHaveLength(1);
    });
  },
);
