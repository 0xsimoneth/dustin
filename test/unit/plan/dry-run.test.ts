import { Keypair } from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";
import type { ExistingAccountSnapshot } from "../../../src/inspect/snapshot.js";
import { planFromSnapshot } from "../../../src/plan/plan.js";
import { planClose } from "../../../src/plan/plan-close.js";
import { horizonJson } from "../../../src/reader/horizon-json.js";
import { horizonReader } from "../../../src/reader/ledger-reader.js";
import { randomSnapshot } from "../../helpers/generate.js";
import {
  MESSY_DIR,
  TESTNET_HORIZON,
  loadRecorded,
  recordedFetch,
} from "../../helpers/recorded-horizon.js";
import { messy } from "../../helpers/snapshots.js";

function recordedReader() {
  const { fetch, requests } = recordedFetch(loadRecorded(MESSY_DIR));
  return {
    reader: horizonReader(horizonJson(TESTNET_HORIZON, { fetch, retries: 0 })),
    requests,
  };
}

describe("dry-run guarantee", () => {
  it("planClose makes GET requests only and never touches a submission endpoint", async () => {
    const { reader, requests } = recordedReader();
    await planClose({ account: messy.fixture, destination: messy.destination }, { reader });
    expect(requests.length).toBeGreaterThan(0);
    expect(requests.filter((r) => r.method !== "GET")).toEqual([]);
    expect(requests.filter((r) => /transactions/.test(r.path))).toEqual([]);
  });

  it("accepts no secret or signer in its types", async () => {
    const { reader } = recordedReader();
    const plan = await planClose(
      {
        account: messy.fixture,
        destination: messy.destination,
        // @ts-expect-error a signer is not part of the planner's input
        signer: Keypair.random(),
      },
      { reader },
    );
    expect(JSON.stringify(plan)).not.toMatch(/"signer"|secret/i);
  });

  it("produces the committed plan for the recorded fixture at a fixed 100-stroop base fee", async () => {
    const { reader } = recordedReader();
    const plan = await planClose(
      {
        account: messy.fixture,
        destination: messy.destination,
        feeSponsor: messy.sponsor,
        baseFeeStroops: 100,
      },
      { reader },
    );
    expect(plan.fees).toMatchObject({
      baseFeeStroops: 100,
      perTransactionStroops: [1000, 300, 200],
      totalStroops: 1500,
    });
    expect(plan).toMatchSnapshot();
  });
});

describe("planner synthetic cases", () => {
  const empty = (): ExistingAccountSnapshot => {
    const s = randomSnapshot(11, { offers: 0, trustlines: 0 });
    s.data = [];
    s.subentryCount = 0;
    return s;
  };

  it("closes an account with nothing to clean in one merge-only transaction", () => {
    const s = empty();
    const plan = planFromSnapshot(s, { destination: s.destination!.account });
    expect(plan.status).toBe("closable");
    expect(plan.steps.map((st) => st.kind)).toEqual(["merge"]);
    expect(plan.transactions).toEqual([expect.objectContaining({ phase: "merge", opCount: 1 })]);
  });

  it("removes a lone data entry and merges in one transaction", () => {
    const s = empty();
    s.data = [{ name: "note", valueBase64: "MQ==" }];
    const plan = planFromSnapshot(s, { destination: s.destination!.account });
    expect(plan.steps.map((st) => st.kind)).toEqual(["remove_data", "merge"]);
    expect(plan.transactions).toHaveLength(1);
  });

  it("cancels one offer before removing its trustline", () => {
    const s = randomSnapshot(12, { offers: 1, trustlines: 1 });
    Object.assign(s.trustlines[0]!, { balance: "0.0000000", authorized: true, sponsor: null });
    s.offers[0]!.selling = s.trustlines[0]!.asset;
    s.data = [];
    const plan = planFromSnapshot(s, { destination: s.destination!.account });
    expect(plan.steps.map((st) => st.kind)).toEqual(["cancel_offer", "remove_trustline", "merge"]);
    expect(plan.steps[1]!.dependsOn).toEqual([plan.steps[0]!.id]);
  });

  it("blocks raised thresholds before anything is signed", () => {
    const s = empty();
    s.thresholds = { low: 2, medium: 2, high: 2 };
    const plan = planFromSnapshot(s, { destination: s.destination!.account });
    expect(plan.status).toBe("blocked");
    expect(plan.steps).toEqual([]);
    expect(plan.blockers.map((b) => b.code)).toEqual(["THRESHOLD_UNMET"]);
  });
});
