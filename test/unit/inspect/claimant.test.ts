import { describe, expect, it } from "vitest";
import { DustinError } from "../../../src/errors/dustin-error.js";
import { inspectAccount } from "../../../src/inspect/inspect.js";
import { planClose } from "../../../src/plan/plan-close.js";
import { horizonJson } from "../../../src/reader/horizon-json.js";
import { horizonReader, type LedgerReader } from "../../../src/reader/ledger-reader.js";
import {
  MESSY_DIR,
  TESTNET_HORIZON,
  loadRecorded,
  messyManifest,
  recordedFetch,
} from "../../helpers/recorded-horizon.js";
import { noSleep } from "../../helpers/no-sleep.js";

// Matrix row X-03 (docs/edge-cases-and-test-matrix.md section 4): claimable balances that name
// the account as a claimant. The inspector reads GET /claimable_balances?claimant=<account> (the
// query the SDK's ClaimableBalanceCallBuilder.claimant() builds), follows its pages, and the
// snapshot carries what it found. The balances below are synthesized in Horizon's record format
// on the recorded messy fixture (which is never read live: it is the builder's baseline fixture).

const recorded = loadRecorded(MESSY_DIR);
const m = messyManifest().accounts;
const page = (cursor = "") =>
  `/claimable_balances?claimant=${m.fixture}&limit=200${cursor ? `&cursor=${cursor}` : ""}`;

/** A claimable balance record as Horizon returns it (the fields the inspector reads). */
function balance(n: number, asset: string, amount: string, sponsor: string) {
  const id = `00000000${n.toString(16).padStart(64, "0")}`;
  return {
    id,
    asset,
    amount,
    sponsor,
    last_modified_ledger: 4_874_000 + n,
    claimants: [{ destination: m.fixture, predicate: { unconditional: true } }],
    flags: { clawback_enabled: false },
    paging_token: `${4_874_000 + n}-${id}`,
  };
}

function inspect(overrides: Record<string, unknown>, reader?: LedgerReader) {
  const { fetch, requests } = recordedFetch(recorded, overrides);
  const r = reader ?? horizonReader(horizonJson(TESTNET_HORIZON, { fetch, retries: 0 }));
  return {
    run: () => inspectAccount(m.fixture, { destination: m.destination, reader: r }),
    requests,
  };
}

describe("X-03: claimable balances claimable by the account (inspector)", () => {
  it("reads /claimable_balances?claimant=<account> and carries id, asset, amount and sponsor, sorted by id", async () => {
    const credit = `CBA:${m.issuer}`;
    const { run, requests } = inspect({
      [page()]: {
        _embedded: {
          records: [
            balance(2, credit, "0.0000002", m.issuer),
            balance(1, "native", "0.1", m.marketMaker),
          ],
        },
      },
    });
    const s = await run();
    if (!s.exists) throw new Error("expected an existing account");
    expect(s.claimableBalancesClaimable).toEqual([
      {
        id: balance(1, "native", "0", "").id,
        asset: "native",
        amount: "0.1000000",
        sponsor: m.marketMaker,
      },
      {
        id: balance(2, credit, "0", "").id,
        asset: credit,
        amount: "0.0000002",
        sponsor: m.issuer,
      },
    ]);
    expect(requests).toContainEqual({ method: "GET", path: page() });
  });

  it("follows Horizon's 200-record pages to the end", async () => {
    const first = Array.from({ length: 200 }, (_, i) =>
      balance(i + 1, "native", "0.0000001", m.issuer),
    );
    const last = first.at(-1)!.paging_token;
    const { run, requests } = inspect({
      [page()]: { _embedded: { records: first } },
      [page(last)]: { _embedded: { records: [balance(201, "native", "0.0000001", m.issuer)] } },
    });
    const s = await run();
    if (!s.exists) throw new Error("expected an existing account");
    expect(s.claimableBalancesClaimable).toHaveLength(201);
    expect(requests.filter((q) => q.path.startsWith("/claimable_balances?claimant="))).toEqual([
      { method: "GET", path: page() },
      { method: "GET", path: page(last) },
    ]);
  });

  it("finds none on the recorded fixture: the recorded page is empty", async () => {
    const s = await inspect({}).run();
    if (!s.exists) throw new Error("expected an existing account");
    expect(s.claimableBalancesClaimable).toEqual([]);
  });

  it("leaves them out of the snapshot hash: they are not the account's entries and change no step", async () => {
    const without = await inspect({}).run();
    const withOne = await inspect({
      [page()]: { _embedded: { records: [balance(1, "native", "5", m.issuer)] } },
    }).run();
    expect(withOne.snapshotHash).toBe(without.snapshotHash);
  });

  it("AC-16: leaves the field out, rather than null or an empty list, for a custom reader that cannot answer the query", async () => {
    const { fetch } = recordedFetch(recorded);
    const full = horizonReader(horizonJson(TESTNET_HORIZON, { fetch, retries: 0 }));
    const older: LedgerReader = { ...full, claimableBalancesClaimableBy: undefined };
    const s = await inspect({}, older).run();
    if (!s.exists) throw new Error("expected an existing account");
    expect("claimableBalancesClaimable" in s).toBe(false);
    expect(s.snapshotHash).toBe((await inspect({}).run()).snapshotHash);
  });
});

describe("EP-4, BH-5: a failed claimant read costs the warning, never the inspection", () => {
  it("a reader that throws: the inspection completes with claimableBalancesClaimable null", async () => {
    // P-C1 of the review: the optional read failing aborted the whole inspection.
    const { fetch } = recordedFetch(recorded);
    const full = horizonReader(horizonJson(TESTNET_HORIZON, { fetch, retries: 0 }));
    const failing: LedgerReader = {
      ...full,
      claimableBalancesClaimableBy: () =>
        Promise.reject(
          new DustinError("HORIZON_UNAVAILABLE", "Horizon answered HTTP 503.", {
            stage: "inspect",
            retryable: true,
          }),
        ),
    };
    const s = await inspect({}, failing).run();
    if (!s.exists) throw new Error("expected an existing account");
    expect(s.claimableBalancesClaimable).toBeNull();
    expect(s.snapshotHash).toBe((await inspect({}).run()).snapshotHash);
  });

  it("Horizon answering 503 to the claimant query only: planClose returns the plan, warning that the balances could not be read", async () => {
    const { fetch } = recordedFetch(recorded);
    const failing = (url: string, init?: RequestInit) =>
      url.includes("/claimable_balances?claimant=")
        ? Promise.resolve(new Response("{}", { status: 503 }))
        : fetch(url, init);
    const reader = horizonReader(
      horizonJson(TESTNET_HORIZON, { fetch: failing, retries: 1, sleep: noSleep }),
    );
    const plan = await planClose({ account: m.fixture, destination: m.destination }, { reader });
    const without = await planClose(
      { account: m.fixture, destination: m.destination },
      { reader: horizonReader(horizonJson(TESTNET_HORIZON, { fetch, retries: 0 })) },
    );
    expect(plan.status).toBe(without.status);
    expect(plan.planHash).toBe(without.planHash);
    expect(plan.warnings[0]).toMatch(
      /^Dustin could not read the claimable balances that name this account as a claimant/,
    );
    expect(plan.warnings.slice(1)).toEqual(without.warnings);
  });

  it("EP-19: a claimant page without a cursor to continue from is a failed read, not an endless loop", async () => {
    const full = Array.from({ length: 200 }, (_, i) => {
      const { paging_token: _token, ...record } = balance(i + 1, "native", "0.0000001", m.issuer);
      return record;
    });
    const { run, requests } = inspect({ [page()]: { _embedded: { records: full } } });
    const s = await run();
    if (!s.exists) throw new Error("expected an existing account");
    expect(s.claimableBalancesClaimable).toBeNull();
    expect(requests.filter((q) => q.path.startsWith("/claimable_balances?claimant="))).toEqual([
      { method: "GET", path: page() },
    ]);
  });

  it("EP-4: reads at most ten pages of 200; the snapshot holds the 2000 read", async () => {
    const pages: Record<string, unknown> = {};
    let cursor = "";
    for (let p = 0; p < 11; p++) {
      const records = Array.from({ length: 200 }, (_, i) =>
        balance(p * 200 + i + 1, "native", "0.0000001", m.issuer),
      );
      pages[page(cursor)] = { _embedded: { records } };
      cursor = records.at(-1)!.paging_token;
    }
    const { run, requests } = inspect(pages);
    const s = await run();
    if (!s.exists) throw new Error("expected an existing account");
    expect(s.claimableBalancesClaimable).toHaveLength(2000);
    expect(requests.filter((q) => q.path.startsWith("/claimable_balances?claimant="))).toHaveLength(
      10,
    );
  });
});
