import { describe, expect, it } from "vitest";
import { executeClose } from "../../../src/execute/executor.js";
import type { FetchLike } from "../../../src/reader/horizon-json.js";
import type { FakeLedger } from "../../helpers/fake-ledger.js";
import { messy } from "../../helpers/snapshots.js";
import { harness, signers } from "./harness.js";

// Story E3-S3: the reserve sponsors the plan names are read on Horizon before the first submission
// and again after the final check, and the report records what was observed next to what was
// planned (`recovery.sponsorsObserved`). Removing a sponsored entry moves no XLM: the sponsor's
// num_sponsoring falls, and with it its minimum balance, (2 + subentries + num_sponsoring -
// num_sponsored) x base reserve
// (https://developers.stellar.org/docs/build/guides/transactions/sponsored-reserves#effect-on-minimum-balance;
// day-1 experiment 3). The fake ledger (test/helpers/fake-ledger.ts) already lowers the sponsor's
// num_sponsoring when a sponsored trustline is removed.

type Request = { method: string; path: string };

/** Records every request to the fake ledger's Horizon, in order. */
function tapped(requests: Request[]) {
  return (_ledger: FakeLedger, fetch: FetchLike): FetchLike =>
    (url, init) => {
      requests.push({
        method: init?.method ?? "GET",
        path: url.replace("https://horizon-testnet.stellar.org", ""),
      });
      return fetch(url, init);
    };
}

describe("E3-S3: reserve sponsors observed before and after the run", () => {
  it("S-03, AC-E3-S3-1 (offline): records the reserve sponsor's num_sponsoring, minimum balance and XLM balance before the first submission and after the final check", async () => {
    const requests: Request[] = [];
    const { ledger, deps, plan } = harness(tapped(requests));
    const L = ledger.ledgerSeq;
    const p = await plan();
    expect(p.recovery.reservesReturnedToSponsors.map((x) => x.sponsor)).toEqual([
      messy.reserveSponsor,
    ]);
    requests.length = 0;

    const report = await executeClose(p, signers(), { confirm: true, ...deps });
    expect(report.status).toBe("closed");
    // Planned: one sponsored trustline, 0.5 XLM. Observed: num_sponsoring 1 -> 0, the minimum
    // balance 0.5 XLM lower, the XLM balance unchanged (the fee sponsor paid every fee).
    expect(report.recovery.reservesReturnedToSponsors).toEqual([
      {
        sponsor: messy.reserveSponsor,
        xlm: "0.5000000",
        entries: [`trustline SPTA:${messy.issuer}`],
      },
    ]);
    expect(report.recovery.sponsorsObserved).toEqual([
      {
        sponsor: messy.reserveSponsor,
        before: { numSponsoring: 1, balance: "10.0000000", minimumBalance: "1.5000000", ledger: L },
        after: {
          numSponsoring: 0,
          balance: "10.0000000",
          minimumBalance: "1.0000000",
          ledger: L + 3,
        },
      },
    ]);
    // Read before the first POST, and again after the final 404 for the account.
    const sponsorReads = requests.flatMap((r, i) =>
      r.path === `/accounts/${messy.reserveSponsor}` ? [i] : [],
    );
    const posts = requests.flatMap((r, i) => (r.method === "POST" ? [i] : []));
    const finalCheck = requests.map((r) => r.path).lastIndexOf(`/accounts/${messy.fixture}`);
    expect(sponsorReads).toHaveLength(2);
    expect(sponsorReads[0]!).toBeLessThan(posts[0]!);
    expect(sponsorReads[1]!).toBeGreaterThan(finalCheck);
    expect(report.warnings).toEqual([]);
  });

  it("warns instead of failing the close when a sponsor cannot be read", async () => {
    let down = false;
    const { ledger, deps, plan } = harness((_l, fetch) => (url, init) => {
      if (down && url.endsWith(`/accounts/${messy.reserveSponsor}`)) {
        return Promise.resolve(new Response(JSON.stringify({ status: 503 }), { status: 503 }));
      }
      return fetch(url, init);
    });
    const report = await executeClose(await plan(), signers(), {
      confirm: true,
      ...deps,
      onEvent: (e) => {
        // From the executor's own fresh plan on, Horizon fails every read of the sponsor.
        if (e.type === "plan") down = true;
      },
    });
    expect(report.status).toBe("closed");
    expect(report.stop).toBeNull();
    expect(report.recovery.sponsorsObserved).toEqual([
      { sponsor: messy.reserveSponsor, before: null, after: null },
    ]);
    const about = report.warnings.filter((w) => w.includes(messy.reserveSponsor));
    expect(about).toHaveLength(2);
    expect(about[0]).toMatch(/could not be read before the first submission/);
    expect(about[1]).toMatch(/could not be read after the run/);
    expect(about[0]).toMatch(/HORIZON_UNAVAILABLE/);
    expect(ledger.accounts.has(messy.fixture)).toBe(false);
  });

  it("keeps the figure from before when only the read after the run fails", async () => {
    let down = false;
    const { deps, plan } = harness((_l, fetch) => (url, init) => {
      if (down && url.endsWith(`/accounts/${messy.reserveSponsor}`)) {
        return Promise.reject(new Error("socket hang up"));
      }
      return fetch(url, init);
    });
    const report = await executeClose(await plan(), signers(), {
      confirm: true,
      ...deps,
      onEvent: (e) => {
        if (e.type === "verified") down = true;
      },
    });
    expect(report.status).toBe("closed");
    const [observed] = report.recovery.sponsorsObserved!;
    expect(observed!.before).toMatchObject({ numSponsoring: 1 });
    expect(observed!.after).toBeNull();
    expect(report.warnings.join(" ")).toMatch(/could not be read after the run/);
  });

  it("reads no sponsor when the plan names none", async () => {
    const requests: Request[] = [];
    const { ledger, deps, plan } = harness(tapped(requests));
    // SPTA without its sponsorship: nothing of the account is sponsored.
    const spta = ledger.accounts.get(messy.fixture)!.balances.find((b) => b.asset_code === "SPTA")!;
    delete spta.sponsor;
    ledger.accounts.get(messy.fixture)!.num_sponsored = 0;
    ledger.accounts.get(messy.reserveSponsor)!.num_sponsoring = 0;
    const report = await executeClose(await plan(), signers(), { confirm: true, ...deps });
    expect(report.status).toBe("closed");
    expect(report.recovery.reservesReturnedToSponsors).toEqual([]);
    expect(report.recovery.sponsorsObserved).toEqual([]);
    expect(requests.some((r) => r.path === `/accounts/${messy.reserveSponsor}`)).toBe(false);
  });

  it("reads a sponsor that only a re-plan names after the run, with no figure from before", async () => {
    const { ledger, deps, plan } = harness();
    const late = `LATE:${messy.issuer}`;
    let changed = false;
    const report = await executeClose(await plan(), signers(), {
      confirm: true,
      ...deps,
      onDrift: "replan",
      onEvent: (e) => {
        if (e.type === "tx:confirmed" && e.index === 0 && !changed) {
          changed = true;
          // A trustline sponsored by the market maker appears and the market vanishes, so the sale
          // fails and the accepted re-plan removes the new trustline too (edge case E9).
          ledger.addTrustline(messy.fixture, late, { sponsor: messy.marketMaker });
          ledger.quotes.clear();
        }
      },
    });
    expect(report.status).toBe("closed");
    const bySponsor = new Map(report.recovery.sponsorsObserved!.map((o) => [o.sponsor, o]));
    expect(bySponsor.get(messy.reserveSponsor)).toMatchObject({
      before: { numSponsoring: 1 },
      after: { numSponsoring: 0 },
    });
    expect(bySponsor.get(messy.marketMaker)).toMatchObject({
      before: null,
      after: { numSponsoring: 0 },
    });
  });

  it("AC-E3-S3-3 (offline): a sponsored account entry releases two base reserves to its sponsor with the merge", async () => {
    const { ledger, deps, plan } = harness((l, fetch) => mergeReleasesAccountSponsorship(l, fetch));
    // Another account sponsors the closing account's own entry (CAP-33): two base reserves.
    ledger.accounts.get(messy.fixture)!.sponsor = messy.marketMaker;
    ledger.accounts.get(messy.fixture)!.num_sponsored += 2;
    ledger.accounts.get(messy.marketMaker)!.num_sponsoring += 2;
    const p = await plan();
    expect(p.recovery.reservesReturnedToSponsors).toContainEqual({
      sponsor: messy.marketMaker,
      xlm: "1.0000000",
      entries: ["account entry"],
    });
    const report = await executeClose(p, signers(), { confirm: true, ...deps });
    expect(report.status).toBe("closed");
    expect(report.recovery.reservesReturnedToSponsors).toContainEqual({
      sponsor: messy.marketMaker,
      xlm: "1.0000000",
      entries: ["account entry"],
    });
    const observed = report.recovery.sponsorsObserved!.find(
      (o) => o.sponsor === messy.marketMaker,
    )!;
    expect(observed.before!.numSponsoring - observed.after!.numSponsoring).toBe(2);
    expect(observed.before!.minimumBalance).not.toBe(observed.after!.minimumBalance);
    expect(observed.before!.balance).toBe(observed.after!.balance);
  });
});

/**
 * The fake ledger removes a merged account without touching the sponsor of its entry; stellar-core
 * removes it with removeEntryWithPossibleSponsorship, which lowers the sponsor's num_sponsoring by
 * the entry's two base reserves (MergeOpFrame::doApplyFromV16,
 * https://github.com/stellar/stellar-core/blob/master/src/transactions/MergeOpFrame.cpp). This
 * wrapper does that after a merge applies, for this test only.
 */
function mergeReleasesAccountSponsorship(ledger: FakeLedger, fetch: FetchLike): FetchLike {
  return async (url, init) => {
    const sponsor = ledger.accounts.get(messy.fixture)?.sponsor;
    const response = await fetch(url, init);
    if ((init?.method ?? "GET") === "POST" && sponsor && !ledger.accounts.has(messy.fixture)) {
      ledger.accounts.get(sponsor)!.num_sponsoring -= 2;
    }
    return response;
  };
}
