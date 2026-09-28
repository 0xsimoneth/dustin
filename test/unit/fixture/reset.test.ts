import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { exitCodeFor } from "../../../src/cli/exit-codes.js";
import { DustinError } from "../../../src/errors/dustin-error.js";
import {
  accountHistory,
  assertNoReset,
  judgeReset,
  recordedLedger,
  type AccountHistory,
} from "../../../src/fixture/reset.js";
import { horizonJson } from "../../../src/reader/horizon-json.js";
import { noSleep } from "../../helpers/no-sleep.js";

// Matrix row X-15, testnet reset detection (docs/edge-cases-and-test-matrix.md section 4). A reset
// clears every ledger entry and restarts the network from the genesis ledger
// (https://developers.stellar.org/docs/networks#testnet-and-futurenet-data-reset), while a merged
// account's operations stay on Horizon (day-1 experiment 11). The two operations pages below were
// recorded from testnet Horizon on 2026-09-28.

const vector = (name: string) =>
  JSON.parse(readFileSync(`test/fixtures/horizon/reset/${name}.json`, "utf8")) as {
    path: string;
    status: number;
    body: unknown;
  };
const merged = vector("operations-merged");
const unknown = vector("operations-unknown");
const MERGED = "GCPPFHGLKA7GCBWJXBH4EXFXS3OXAMXFLOBAZLU2K3KKMO6JKZORNFW7";
const UNKNOWN = "GBZKBBOISOKOMXMPBCBGIAO7FGHYJV5L562UUQDNEWRFPAFAY37Q4AWY";
const INTO = "GDPZI3OAYYEAXTYY2OHFDZAEEG4PXNBN7AHNLQTEH22O5HTBGBSVB2TS";
const MERGE_TX = "36e53646514a36c673830955b661b91de297842481295f458de8c5911e5c989c";

/** A Horizon client over the recorded pages (404 for anything else). */
function client(pages: Array<{ path: string; status: number; body: unknown }>) {
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

const noHistory: AccountHistory = { found: false, merge: null, latestType: null };

describe("X-15: accountHistory reads what Horizon still holds for an account", () => {
  it("finds the account_merge the account itself sourced, with its destination and transaction", async () => {
    const { client: c, requests } = client([merged]);
    await expect(accountHistory(c, MERGED)).resolves.toEqual({
      found: true,
      merge: { into: INTO, transactionHash: MERGE_TX, createdAt: "2026-09-28T11:24:02Z" },
      latestType: "account_merge",
    });
    expect(requests).toEqual([`/accounts/${MERGED}/operations?order=desc&limit=10`]);
  });

  it("reports no history for an account Horizon has never seen (404)", async () => {
    const { client: c } = client([unknown]);
    await expect(accountHistory(c, UNKNOWN)).resolves.toEqual(noHistory);
  });

  it("reports history without a merge when the latest operations hold none", async () => {
    const page = structuredClone(merged) as {
      path: string;
      status: number;
      body: { _embedded: { records: Array<{ type: string }> } };
    };
    page.body._embedded.records = page.body._embedded.records.filter(
      (r) => r.type !== "account_merge",
    );
    const { client: c } = client([page]);
    await expect(accountHistory(c, MERGED)).resolves.toEqual({
      found: true,
      merge: null,
      latestType: "change_trust",
    });
  });
});

describe("X-15: judgeReset", () => {
  const base = { manifestId: "messy-x", recordedLedger: 4_874_327, latestLedger: 4_900_000 };

  it("suspects a reset when the manifest's recorded ledger is ahead of Horizon's latest ledger", () => {
    const finding = judgeReset({ ...base, latestLedger: 1_234, missing: [] });
    expect(finding.kind).toBe("reset-suspected");
    expect(finding.kind === "reset-suspected" && finding.reason).toBe(
      "the manifest records ledger 4874327, but Horizon's latest ledger is 1234: the network restarted from an earlier ledger, as a testnet reset does",
    );
  });

  it("suspects a reset when a manifest account answers 404 and Horizon holds no history for it", () => {
    const finding = judgeReset({
      ...base,
      missing: [{ role: "fixture", account: UNKNOWN, history: noHistory }],
    });
    expect(finding).toEqual({
      kind: "reset-suspected",
      reason: `the fixture account ${UNKNOWN} answers 404 and Horizon holds no operation for it, so it was not merged: a testnet reset removes accounts together with their history`,
    });
  });

  it("reports a merged account as closed, not as a reset", () => {
    const merge = { into: INTO, transactionHash: MERGE_TX, createdAt: "2026-09-28T11:24:02Z" };
    const finding = judgeReset({
      ...base,
      missing: [
        { role: "fixture", account: MERGED, history: { found: true, merge, latestType: "x" } },
      ],
    });
    expect(finding).toEqual({
      kind: "no-reset",
      closed: [{ role: "fixture", account: MERGED, ...merge }],
      gone: [],
    });
  });

  it("reports an account gone without a merge in its latest operations as gone, not as a reset", () => {
    const finding = judgeReset({
      ...base,
      missing: [
        {
          role: "fixture",
          account: MERGED,
          history: { found: true, merge: null, latestType: "change_trust" },
        },
      ],
    });
    expect(finding).toEqual({
      kind: "no-reset",
      closed: [],
      gone: [{ role: "fixture", account: MERGED, latestType: "change_trust" }],
    });
  });

  it("suspects nothing when every account exists and the ledger moved on", () => {
    expect(judgeReset({ ...base, missing: [] })).toEqual({
      kind: "no-reset",
      closed: [],
      gone: [],
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

  it("throws RESET_SUSPECTED (exit 3) with the ledgers and the rebuild remedy", async () => {
    const { client: c } = client([unknown]);
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
      "Testnet reset suspected for fixture messy-20260101T000000Z: the manifest records ledger 4874327, but Horizon's latest ledger is 42: the network restarted from an earlier ledger, as a testnet reset does.",
    );
    expect(e.remedy).toBe(
      "A reset deletes every account the fixture had, so it cannot be verified or closed. Build a new one with `dustin fixture create --profile messy` (new keys, new manifest).",
    );
    expect(e.details).toEqual({ recordedLedger: 4_874_327, latestLedger: 42 });
    expect(exitCodeFor(e)).toBe(3);
  });

  it("reads the history of every missing account, and only of those", async () => {
    const { client: c, requests } = client([merged, unknown]);
    const error = await assertNoReset(c, {
      manifestId: "edge-x",
      profile: "edge",
      recordedLedger: 10,
      latestLedger: 20,
      accounts: [
        { role: "authAuthorized", account: MERGED, found: false },
        { role: "destination", account: INTO, found: true },
        { role: "clawback", account: UNKNOWN, found: false },
      ],
    }).catch((e: unknown) => e);
    expect(requests.sort()).toEqual(
      [
        `/accounts/${MERGED}/operations?order=desc&limit=10`,
        `/accounts/${UNKNOWN}/operations?order=desc&limit=10`,
      ].sort(),
    );
    expect(error).toMatchObject({ code: "RESET_SUSPECTED" });
    expect((error as DustinError).message).toContain(`the clawback account ${UNKNOWN}`);
  });

  it("returns the merged accounts when nothing points to a reset", async () => {
    const { client: c } = client([merged]);
    await expect(
      assertNoReset(c, {
        manifestId: "edge-x",
        profile: "edge",
        recordedLedger: 10,
        latestLedger: 20,
        accounts: [{ role: "authAuthorized", account: MERGED, found: false }],
      }),
    ).resolves.toEqual({
      closed: [
        {
          role: "authAuthorized",
          account: MERGED,
          into: INTO,
          transactionHash: MERGE_TX,
          createdAt: "2026-09-28T11:24:02Z",
        },
      ],
      gone: [],
    });
  });
});
