import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { exitCodeFor } from "../../../src/cli/exit-codes.js";
import { DustinError } from "../../../src/errors/dustin-error.js";
import {
  HORIZON_LAG_TOLERANCE_LEDGERS,
  LATEST_OPERATIONS,
  accountHistory,
  assertNoReset,
  describeMissing,
  judgeReset,
  recordedLedger,
  type AccountHistory,
  type ResetInput,
} from "../../../src/fixture/reset.js";
import { horizonJson } from "../../../src/reader/horizon-json.js";
import { noSleep } from "../../helpers/no-sleep.js";

// Matrix row X-15, testnet reset detection (docs/edge-cases-and-test-matrix.md section 4). A reset
// clears every ledger entry and its history and restarts the network from the genesis ledger
// (https://developers.stellar.org/docs/networks#testnet-and-futurenet-data-reset), while a merged
// account's operations stay on Horizon (day-1 experiment 11). The operations pages and the merge
// transaction below were recorded from testnet Horizon on 2026-09-29.

type Vector = { path: string; status: number; body: unknown };
const vector = (name: string) =>
  JSON.parse(readFileSync(`test/fixtures/horizon/reset/${name}.json`, "utf8")) as Vector;
const merged = vector("operations-merged");
const unknown = vector("operations-unknown");
const mergeTx = vector("transaction-merge");
const MERGED = "GCPPFHGLKA7GCBWJXBH4EXFXS3OXAMXFLOBAZLU2K3KKMO6JKZORNFW7";
const UNKNOWN = "GBZKBBOISOKOMXMPBCBGIAO7FGHYJV5L562UUQDNEWRFPAFAY37Q4AWY";
const INTO = "GDPZI3OAYYEAXTYY2OHFDZAEEG4PXNBN7AHNLQTEH22O5HTBGBSVB2TS";
const MERGE_TX = "36e53646514a36c673830955b661b91de297842481295f458de8c5911e5c989c";
const MERGE_LEDGER = 4_914_211;
const MERGE = {
  into: INTO,
  transactionHash: MERGE_TX,
  createdAt: "2026-09-28T11:24:02Z",
  ledger: MERGE_LEDGER,
};
const ops = (account: string) =>
  `/accounts/${account}/operations?order=desc&limit=${LATEST_OPERATIONS}`;

/** A Horizon client over the recorded pages (404 for anything else). */
function client(pages: Vector[]) {
  const byPath = new Map(pages.map((p) => [p.path, p]));
  const requests: string[] = [];
  const fetch = (url: string) => {
    const path = url.replace("https://horizon-testnet.stellar.org", "");
    requests.push(path);
    const hit = byPath.get(path);
    return Promise.resolve(
      new Response(JSON.stringify(hit?.body ?? { status: 404 }), { status: hit?.status ?? 404 }),
    );
  };
  return {
    client: horizonJson("https://horizon-testnet.stellar.org", { fetch, sleep: noSleep }),
    requests,
  };
}

/** A client that fails the test on any request. */
const noRequest = horizonJson("https://horizon-testnet.stellar.org", {
  fetch: () => Promise.reject(new Error("no request expected")),
  retries: 0,
});

const noHistory: AccountHistory = { found: false, merge: null, latestType: null };
const mergedHistory: AccountHistory = { found: true, merge: MERGE, latestType: "account_merge" };

describe("X-15: accountHistory reads what Horizon still holds for an account", () => {
  it("EP-20: finds the account_merge the account itself sourced, with its destination, transaction and ledger", async () => {
    const { client: c, requests } = client([merged, mergeTx]);
    await expect(accountHistory(c, MERGED)).resolves.toEqual(mergedHistory);
    expect(requests).toEqual([ops(MERGED), `/transactions/${MERGE_TX}`]);
  });

  it("BH-18: reads the latest 200 operations, so later operations that name the merged account cannot push the merge out", async () => {
    // Synthesized from the recorded page: 150 operations of other accounts that still name the
    // merged one (claimable balances created for it) come after its merge.
    const page = structuredClone(merged) as Vector & {
      body: { _embedded: { records: Array<Record<string, unknown>> } };
    };
    const later = Array.from({ length: 150 }, (_, i) => ({
      id: String(21_200_000_000_000_000 + i),
      paging_token: String(21_200_000_000_000_000 + i),
      type: "create_claimable_balance",
      source_account: INTO,
      transaction_hash: `${i}`.padStart(64, "a"),
      created_at: "2026-09-29T08:00:00Z",
    }));
    page.body._embedded.records = [...later.reverse(), ...page.body._embedded.records];
    const { client: c, requests } = client([page, mergeTx]);
    const history = await accountHistory(c, MERGED);
    expect(history.merge).toEqual(MERGE);
    expect(history.latestType).toBe("create_claimable_balance");
    expect(requests[0]).toBe(`/accounts/${MERGED}/operations?order=desc&limit=200`);
  });

  it("EP-20: keeps the merge without its ledger when Horizon does not return the transaction", async () => {
    const { client: c } = client([merged]);
    await expect(accountHistory(c, MERGED)).resolves.toEqual({
      ...mergedHistory,
      merge: { ...MERGE, ledger: null },
    });
  });

  it("reports no history for an account Horizon has never seen (404)", async () => {
    const { client: c } = client([unknown]);
    await expect(accountHistory(c, UNKNOWN)).resolves.toEqual(noHistory);
  });

  it("reports history without a merge when the latest operations hold none", async () => {
    const page = structuredClone(merged) as Vector & {
      body: { _embedded: { records: Array<{ type: string }> } };
    };
    page.body._embedded.records = page.body._embedded.records.filter(
      (r) => r.type !== "account_merge",
    );
    const { client: c, requests } = client([page]);
    await expect(accountHistory(c, MERGED)).resolves.toEqual({
      found: true,
      merge: null,
      latestType: "change_trust",
    });
    expect(requests).toEqual([ops(MERGED)]);
  });
});

describe("X-15: judgeReset", () => {
  const base: Omit<ResetInput, "missing" | "existing"> = {
    manifestId: "messy-x",
    recordedLedger: 4_874_327,
    latestLedger: 4_900_000,
  };
  const gone = (history: AccountHistory, role = "fixture", account = UNKNOWN) => ({
    role,
    account,
    history,
  });

  it("suspects a reset when no account exists and Horizon's latest ledger lies far below the recorded one", () => {
    const finding = judgeReset({
      ...base,
      latestLedger: 1_234,
      existing: 0,
      missing: [gone(noHistory)],
    });
    expect(finding).toEqual({
      kind: "reset-suspected",
      reason: `none of its accounts exists, and the manifest records ledger 4874327 while Horizon's latest ledger is 1234, more than ${HORIZON_LAG_TOLERANCE_LEDGERS} ledgers earlier: the network restarted from an earlier ledger, as a testnet reset does`,
    });
  });

  it("suspects a reset when no account exists and Horizon holds no history for any of them", () => {
    const finding = judgeReset({
      ...base,
      existing: 0,
      missing: [gone(noHistory), gone(noHistory, "destination", INTO)],
    });
    expect(finding).toEqual({
      kind: "reset-suspected",
      reason: `none of its accounts exists and Horizon holds no operation for any of them (fixture ${UNKNOWN}, destination ${INTO}), so none was merged: a testnet reset removes accounts together with their history`,
    });
  });

  it("EP-1: never suspects a reset while a manifest account exists, however far behind Horizon's latest ledger is", () => {
    for (const latestLedger of [base.recordedLedger - 1, 812]) {
      expect(judgeReset({ ...base, latestLedger, existing: 2, missing: [] }).kind).toBe("no-reset");
    }
    expect(
      judgeReset({ ...base, latestLedger: 812, existing: 1, missing: [gone(noHistory)] }).kind,
    ).toBe("no-reset");
  });

  it("EP-1: tolerates a Horizon that lags the recorded ledger by up to the named tolerance", () => {
    const lagging = (by: number) =>
      judgeReset({
        ...base,
        latestLedger: base.recordedLedger - by,
        existing: 0,
        missing: [gone(mergedHistory, "fixture", MERGED)],
      }).kind;
    expect(HORIZON_LAG_TOLERANCE_LEDGERS).toBe(120);
    expect(lagging(1)).toBe("no-reset");
    expect(lagging(HORIZON_LAG_TOLERANCE_LEDGERS)).toBe("no-reset");
    expect(lagging(HORIZON_LAG_TOLERANCE_LEDGERS + 1)).toBe("reset-suspected");
  });

  it("EP-1: a latest ledger that was not read is not taken as ledger 0", () => {
    expect(
      judgeReset({
        ...base,
        latestLedger: null,
        existing: 0,
        missing: [gone(mergedHistory, "fixture", MERGED)],
      }),
    ).toEqual({
      kind: "no-reset",
      closed: [{ role: "fixture", account: MERGED, ...MERGE }],
      gone: [],
      unseen: [],
    });
    // Without history the accounts still point to a reset, whatever the ledger.
    expect(
      judgeReset({ ...base, latestLedger: null, existing: 0, missing: [gone(noHistory)] }).kind,
    ).toBe("reset-suspected");
  });

  it("EP-2: one account without history among others that exist is reported as unseen, not as a reset", () => {
    expect(judgeReset({ ...base, existing: 1, missing: [gone(noHistory, "claimant")] })).toEqual({
      kind: "no-reset",
      closed: [],
      gone: [],
      unseen: [{ role: "claimant", account: UNKNOWN }],
    });
  });

  it("reports a merged account as closed, not as a reset", () => {
    const finding = judgeReset({
      ...base,
      existing: 1,
      missing: [gone(mergedHistory, "fixture", MERGED)],
    });
    expect(finding).toEqual({
      kind: "no-reset",
      closed: [{ role: "fixture", account: MERGED, ...MERGE }],
      gone: [],
      unseen: [],
    });
  });

  it("reports an account gone without a merge in its latest operations as gone, not as a reset", () => {
    const finding = judgeReset({
      ...base,
      existing: 1,
      missing: [gone({ found: true, merge: null, latestType: "change_trust" }, "fixture", MERGED)],
    });
    expect(finding).toEqual({
      kind: "no-reset",
      closed: [],
      gone: [{ role: "fixture", account: MERGED, latestType: "change_trust" }],
      unseen: [],
    });
  });

  it("suspects nothing when every account exists and the ledger moved on", () => {
    expect(judgeReset({ ...base, existing: 2, missing: [] })).toEqual({
      kind: "no-reset",
      closed: [],
      gone: [],
      unseen: [],
    });
  });
});

describe("X-15: recordedLedger and assertNoReset", () => {
  it("takes the highest ledger the manifest records: its creation or any build transaction", () => {
    expect(
      recordedLedger({ createdAtLedger: 10, transactions: [{ ledger: 12 }, { ledger: 11 }] }),
    ).toBe(12);
    expect(recordedLedger({ createdAtLedger: 10, transactions: [] })).toBe(10);
  });

  it("throws RESET_SUSPECTED (exit 3) with the ledgers and the rebuild remedy, reading no history", async () => {
    const { client: c, requests } = client([unknown]);
    const error = await assertNoReset(c, {
      manifestId: "messy-20260101T000000Z",
      profile: "messy",
      recordedLedger: 4_874_327,
      latestLedger: 42,
      accounts: [{ role: "fixture", account: UNKNOWN, found: false }],
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DustinError);
    const e = error as DustinError;
    expect(e.code).toBe("RESET_SUSPECTED");
    expect(e.message).toBe(
      `Testnet reset suspected for fixture messy-20260101T000000Z: none of its accounts exists, and the manifest records ledger 4874327 while Horizon's latest ledger is 42, more than ${HORIZON_LAG_TOLERANCE_LEDGERS} ledgers earlier: the network restarted from an earlier ledger, as a testnet reset does.`,
    );
    expect(e.remedy).toBe(
      "A reset deletes every account the fixture had, so it cannot be verified or closed. Build a new one with `dustin fixture create --profile messy` (new keys, new manifest).",
    );
    expect(e.details).toEqual({ recordedLedger: 4_874_327, latestLedger: 42 });
    expect(exitCodeFor(e)).toBe(3);
    expect(requests).toEqual([]);
  });

  it("EP-1: every account answers 200 with Horizon one ledger behind the manifest: no reset, no request", async () => {
    // P-R1 of the review: `fixture verify` right after `fixture create`, answered by a lagging instance.
    await expect(
      assertNoReset(noRequest, {
        manifestId: "edge-x",
        profile: "edge",
        recordedLedger: 4_921_125,
        latestLedger: 4_921_124,
        accounts: [
          { role: "destination", account: INTO, found: true },
          { role: "claimant", account: MERGED, found: true },
        ],
      }),
    ).resolves.toEqual({ closed: [], gone: [], unseen: [], missing: {} });
  });

  it("reads the history of every missing account, and only of those", async () => {
    const { client: c, requests } = client([merged, mergeTx, unknown]);
    const error = await assertNoReset(c, {
      manifestId: "edge-x",
      profile: "edge",
      recordedLedger: 10,
      latestLedger: 20,
      accounts: [
        { role: "authAuthorized", account: UNKNOWN, found: false },
        { role: "clawback", account: INTO, found: false },
      ],
    }).catch((e: unknown) => e);
    expect(requests.sort()).toEqual([ops(INTO), ops(UNKNOWN)].sort());
    expect(error).toMatchObject({ code: "RESET_SUSPECTED" });
    expect((error as DustinError).message).toContain(
      `(authAuthorized ${UNKNOWN}, clawback ${INTO})`,
    );
  });

  it("EP-20: returns the merged accounts with the ledger and hash of the merge", async () => {
    const { client: c } = client([merged, mergeTx]);
    await expect(
      assertNoReset(c, {
        manifestId: "edge-x",
        profile: "edge",
        recordedLedger: 10,
        latestLedger: 20,
        accounts: [
          { role: "authAuthorized", account: MERGED, found: false },
          { role: "destination", account: INTO, found: true },
        ],
      }),
    ).resolves.toEqual({
      closed: [{ role: "authAuthorized", account: MERGED, ...MERGE }],
      gone: [],
      unseen: [],
      missing: { authAuthorized: { kind: "closed", merge: MERGE } },
    });
  });

  it("EP-2: an account without history among existing ones is missing, with Horizon's history window", async () => {
    const root: Vector = {
      path: "/",
      status: 200,
      body: { network_passphrase: "Test SDF Network ; September 2015", history_elder_ledger: 128 },
    };
    const { client: c } = client([unknown, root]);
    const checked = await assertNoReset(c, {
      manifestId: "edge-x",
      profile: "edge",
      recordedLedger: 4_921_125,
      latestLedger: 4_929_344,
      accounts: [
        { role: "claimant", account: UNKNOWN, found: false },
        { role: "destination", account: INTO, found: true },
      ],
    });
    expect(checked.missing).toEqual({ claimant: { kind: "unseen", historyElderLedger: 128 } });
    expect(describeMissing(checked.missing.claimant)).toBe(
      "Horizon answered 404 and holds no operation for the account: it was never funded, or it was merged before ledger 128, the oldest this Horizon keeps history for (history_elder_ledger); not taken for a testnet reset, since other accounts of the fixture exist or keep their history",
    );
  });
});

describe("X-15: describeMissing, the evidence of a failing exists check", () => {
  it("EP-20: names a merge as a close, with its ledger and hash", () => {
    expect(describeMissing({ kind: "closed", merge: MERGE })).toBe(
      `Horizon answered 404: the account was closed: merged into ${INTO} in ledger ${MERGE_LEDGER} by transaction ${MERGE_TX} (2026-09-28T11:24:02Z); not a testnet reset`,
    );
    expect(describeMissing({ kind: "closed", merge: { ...MERGE, ledger: null } })).toBe(
      `Horizon answered 404: the account was closed: merged into ${INTO} by transaction ${MERGE_TX} (2026-09-28T11:24:02Z); not a testnet reset`,
    );
  });

  it("EP-20: an account with history but no merge among its latest operations, and one with no reason", () => {
    expect(describeMissing({ kind: "gone", latestType: "payment" })).toBe(
      "Horizon answered 404 but holds operations for the account (the latest a payment), its own account_merge not among the latest 200; not a testnet reset, which clears the history too",
    );
    expect(describeMissing(undefined)).toBe("Horizon answered 404: the account does not exist");
  });
});
