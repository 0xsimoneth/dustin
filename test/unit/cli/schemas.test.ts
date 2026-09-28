import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Account, MuxedAccount } from "@stellar/stellar-sdk";
import { beforeAll, describe, expect, it } from "vitest";
import { executeClose } from "../../../src/execute/executor.js";
import type { CloseReport } from "../../../src/execute/report.js";
import { horizonSubmitter } from "../../../src/execute/submit.js";
import type { ExistingAccountSnapshot } from "../../../src/inspect/snapshot.js";
import type { ClosePlan } from "../../../src/plan/model.js";
import { planClose } from "../../../src/plan/plan-close.js";
import { planFromSnapshot } from "../../../src/plan/plan.js";
import { horizonJson } from "../../../src/reader/horizon-json.js";
import { horizonReader } from "../../../src/reader/ledger-reader.js";
import { edgeLedger, edgeManifest, edgeRecordedReader } from "../../helpers/edge-ledger.js";
import { TESTNET_HORIZON, loadRecorded, recordedFetch } from "../../helpers/recorded-horizon.js";
import { copy, messy, messySnapshot } from "../../helpers/snapshots.js";
import {
  failedOps,
  harness,
  recordIncludedFaults,
  signerFor,
  signers,
} from "../execute/harness.js";
import {
  PLAN_SCHEMA_ID,
  REPORT_SCHEMA_ID,
  publishedSchemas,
  type SchemaRegistry,
} from "./json-schema.js";
import { closeCli, emptyDir, executeArgs, zeroSpendableWorld, type Fetch } from "./close-world.js";

// AC-E4-S1-2 (story E4-S1): the `--json` output validates against docs/plan-schema.json and
// docs/receipt-schema.json (JSON Schema draft 2020-12). Every plan and report of the offline
// fixtures below is validated in strict mode, where a property the schema does not list is an
// error, so the schemas stay complete as the code grows.

let schemas: SchemaRegistry;
let base: ExistingAccountSnapshot;
beforeAll(async () => {
  schemas = publishedSchemas();
  base = await messySnapshot();
});

const expectPlan = (plan: unknown, label: string) =>
  expect(schemas.validate(PLAN_SCHEMA_ID, plan, { strict: true }), label).toEqual([]);
const expectReport = (report: unknown, label: string) =>
  expect(schemas.validate(REPORT_SCHEMA_ID, report, { strict: true }), label).toEqual([]);
const opts = () => ({ destination: messy.destination, feeSponsor: messy.sponsor });

describe("the validator itself", () => {
  it("refuses what the schemas refuse", () => {
    const plan = planFromSnapshot(base, { ...opts(), baseFeeStroops: 100 });
    expect(schemas.validate(PLAN_SCHEMA_ID, { ...plan, status: "done" })).not.toEqual([]);
    expect(schemas.validate(PLAN_SCHEMA_ID, { ...plan, planHash: "xyz" })).not.toEqual([]);
    const { steps: _steps, ...incomplete } = plan;
    expect(schemas.validate(PLAN_SCHEMA_ID, incomplete)).not.toEqual([]);
    // An unknown property passes the published schema and fails strict mode.
    expect(schemas.validate(PLAN_SCHEMA_ID, { ...plan, extra: 1 })).toEqual([]);
    expect(schemas.validate(PLAN_SCHEMA_ID, { ...plan, extra: 1 }, { strict: true })).not.toEqual(
      [],
    );
  });

  it("declares draft 2020-12 in both schemas", () => {
    for (const file of ["docs/plan-schema.json", "docs/receipt-schema.json"]) {
      const schema = JSON.parse(readFileSync(file, "utf8")) as { $schema: string };
      expect(schema.$schema, file).toBe("https://json-schema.org/draft/2020-12/schema");
    }
  });
});

describe("docs/plan-schema.json and the plans of the offline fixtures", () => {
  it("validates the recorded messy fixture's plan, and its variants", () => {
    expectPlan(planFromSnapshot(base, { ...opts(), baseFeeStroops: 100 }), "messy");
    expectPlan(
      planFromSnapshot(base, { ...opts(), preferDestination: true }),
      "prefer-destination",
    );
    expectPlan(planFromSnapshot(base, { destination: messy.destination }), "no sponsor");
    expectPlan(planFromSnapshot(base, { ...opts(), memo: "HELLO" }), "memo");
    const muxed = new MuxedAccount(new Account(messy.destination, "0"), "7").accountId();
    expectPlan(planFromSnapshot(base, { ...opts(), destination: muxed }), "muxed destination");
    for (const ahead of [3, 500]) {
      const s = copy(base);
      s.sequence = (BigInt(s.observed.ledger + ahead) << 32n).toString();
      expectPlan(planFromSnapshot(s, opts()), `sequence guard ${ahead} ledgers ahead`);
    }
  });

  it("validates the plan of an account that does not exist", async () => {
    const { reader } = harnessWithout();
    expectPlan(
      await planClose({ account: messy.fixture, destination: messy.destination }, { reader }),
      "missing account",
    );
  });

  it("validates the plan of every variant of the recorded edge fixture", async () => {
    const manifest = edgeManifest();
    for (const v of manifest.variants) {
      const { reader } = edgeRecordedReader();
      const plan = await planClose(
        {
          account: v.account,
          destination: manifest.accounts.destination,
          feeSponsor: manifest.accounts.sponsor,
        },
        { reader },
      );
      expectPlan(plan, v.name);
    }
  });

  it("validates the recorded pool-share plan", async () => {
    const dir = "test/fixtures/horizon/pool-share";
    const m = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8")) as {
      accounts: { holder: string; destination: string; sponsor: string };
    };
    const { fetch } = recordedFetch(loadRecorded(dir));
    const plan = await planClose(
      {
        account: m.accounts.holder,
        destination: m.accounts.destination,
        feeSponsor: m.accounts.sponsor,
      },
      { reader: horizonReader(horizonJson(TESTNET_HORIZON, { fetch, retries: 0 })) },
    );
    expectPlan(plan, "pool share");
  });

  it("validates what `dustin plan --json` and the refused `close --execute --json` print", async () => {
    for (const options of [{}, { market: true }, { unauthorized: true }] as const) {
      const world = zeroSpendableWorld(options);
      const plan = await closeCli(world, ["plan", world.id, "--to", world.destination, "--json"]);
      expectPlan(JSON.parse(plan.out), `plan --json ${JSON.stringify(options)}`);
      const refused = await closeCli(world, executeArgs(world, "--json"));
      expectPlan(JSON.parse(refused.out), `refused close ${JSON.stringify(options)}`);
    }
  });
});

/** The messy harness with the fixture gone from the ledger. */
function harnessWithout() {
  const h = harness();
  h.ledger.accounts.delete(messy.fixture);
  return h.deps;
}

describe("docs/receipt-schema.json and the reports of the offline fixture runs", () => {
  it("validates a close, every copy published while it ran, and the plans it emitted", async () => {
    const { deps, plan } = harness();
    const copies: CloseReport[] = [];
    const plans: ClosePlan[] = [];
    const report = await executeClose(await plan(), signers(), {
      confirm: true,
      ...deps,
      onReport: (c) => void copies.push(c),
      onEvent: (e) => {
        if (e.type === "plan") plans.push(e.plan);
      },
    });
    expect(report.status).toBe("closed");
    expectReport(report, "closed");
    copies.forEach((c, i) => expectReport(c, `copy ${i} (${c.status})`));
    plans.forEach((p, i) => expectPlan(p, `emitted plan ${i}`));
  });

  it("validates a run that failed, re-planned and stopped", async () => {
    const h = harness();
    let posts = 0;
    const fetch: Fetch = (url, init) => {
      if ((init?.method ?? "GET") === "POST" && ++posts === 2) {
        h.ledger.faults.push(failedOps("op_too_few_offers", "op_success"));
      }
      if ((init?.method ?? "GET") === "POST" && posts === 3) {
        h.ledger.faults.push(failedOps("op_success", "op_cannot_delete"));
      }
      return recordIncludedFaults(h.ledger, h.ledger.fetch)(url, init);
    };
    const reader = horizonReader(horizonJson(TESTNET_HORIZON, { fetch, retries: 0 }));
    const report = await executeClose(await h.plan(), signers(), {
      confirm: true,
      ...h.deps,
      reader,
      submitter: horizonSubmitter(TESTNET_HORIZON, { fetch }),
    });
    expect(report.transactions.some((t) => t.result === "failed")).toBe(true);
    expectReport(report, report.status);
  });

  it("validates an aborted run, a missing account, an interrupted one and a partial close", async () => {
    // Aborted: the account changed before signing.
    const drift = harness();
    const approved = await drift.plan();
    const account = drift.ledger.accounts.get(messy.fixture)!;
    account.data = { ...account.data, late: "MQ==" };
    account.subentry_count += 1;
    expectReport(
      await executeClose(approved, signers(), { confirm: true, ...drift.deps }),
      "aborted",
    );

    // The account is gone: Horizon's 404 is recorded (review AA-13).
    const gone = harness();
    const plan = await gone.plan();
    gone.ledger.accounts.delete(messy.fixture);
    const missing = await executeClose(plan, signers(), { confirm: true, ...gone.deps });
    expect(missing.stop?.code).toBe("ACCOUNT_MISSING");
    expectReport(missing, "account missing");

    // Interrupted while an envelope's outcome was open (review CL-1).
    const cut = harness();
    cut.ledger.faults.push("504-not-applied");
    const controller = new AbortController();
    const interrupted = await executeClose(await cut.plan(), signers(), {
      confirm: true,
      ...cut.deps,
      signal: controller.signal,
      onEvent: (e) => {
        if (e.type === "tx:submitted") controller.abort("SIGINT");
      },
    });
    expect(interrupted.stop?.code).toBe("INTERRUPTED");
    expectReport(interrupted, "interrupted");

    // Partial: the frozen variant of the edge fixture, with allowPartial.
    const { ledger, manifest } = edgeLedger();
    const frozen = manifest.variants.find((v) => v.expected.status === "partial")!;
    const fetch = recordIncludedFaults(ledger, ledger.fetch);
    const reader = horizonReader(horizonJson(TESTNET_HORIZON, { fetch, retries: 0 }));
    const partialPlan = await planClose(
      {
        account: frozen.account,
        destination: manifest.accounts.destination,
        feeSponsor: manifest.accounts.sponsor,
      },
      { reader },
    );
    const partial = await executeClose(
      partialPlan,
      { account: signerFor(frozen.account), feeSponsor: signerFor(manifest.accounts.sponsor) },
      {
        confirm: true,
        allowPartial: true,
        reader,
        submitter: horizonSubmitter(TESTNET_HORIZON, { fetch }),
        sleep: cut.deps.sleep,
      },
    );
    expect(partial.status).toBe("partial");
    expectReport(partial, "partial");
  });

  it("validates what `close --execute --json` prints and `--report` keeps", async () => {
    const world = zeroSpendableWorld({ market: true });
    const path = join(emptyDir(), "close.json");
    const r = await closeCli(world, executeArgs(world, "--yes", "--json", "--report", path));
    expect(r.code).toBe(0);
    expectReport(JSON.parse(r.out), "--json");
    expectReport(JSON.parse(readFileSync(path, "utf8")), "--report");
  });
});
