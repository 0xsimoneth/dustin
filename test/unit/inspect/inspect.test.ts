import { Keypair, StrKey } from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";
import { inspectAccount } from "../../../src/inspect/inspect.js";
import { horizonReader } from "../../../src/reader/ledger-reader.js";
import { horizonJson } from "../../../src/reader/horizon-json.js";
import {
  MESSY_DIR,
  TESTNET_HORIZON,
  loadRecorded,
  messyManifest,
  recordedFetch,
} from "../../helpers/recorded-horizon.js";

const recorded = loadRecorded(MESSY_DIR);
const m = messyManifest().accounts;

function reader(overrides: Record<string, unknown> = {}) {
  const { fetch, requests } = recordedFetch(recorded, overrides);
  return {
    reader: horizonReader(horizonJson(TESTNET_HORIZON, { fetch, backoffMs: 0, retries: 0 })),
    requests,
  };
}

const accountPath = `/accounts/${m.fixture}`;
function fixtureAccount(): Record<string, unknown> {
  return structuredClone(recorded.get(accountPath)) as Record<string, unknown>;
}

describe("inspectAccount on the recorded messy fixture", () => {
  it("returns the full inventory", async () => {
    const { reader: r } = reader();
    const s = await inspectAccount(m.fixture, { destination: m.destination, reader: r });
    if (!s.exists) throw new Error("expected an existing account");
    expect(s.account).toBe(m.fixture);
    expect(s.subentryCount).toBe(7);
    expect(s.numSponsored).toBe(1);
    expect(s.numSponsoring).toBe(0);
    expect(s.native.balance).toBe("4.0000000");
    expect(s.reserve).toEqual({
      baseReserve: "0.5000000",
      minimum: "4.0000000",
      spendable: "0.0000000",
    });
    expect(s.trustlines.map((t) => [t.asset.code, t.balance, t.sponsor !== null])).toEqual([
      ["DUSTA", "0.0000007", false],
      ["DUSTB", "0.0000003", false],
      ["DUSTC", "0.0000005", false],
      ["SPTA", "0.0000001", true],
    ]);
    const dustb = s.trustlines.find((t) => t.asset.code === "DUSTB")!;
    expect(dustb.buyingLiabilities).toBe("0.0000002");
    expect(s.offers).toHaveLength(2);
    expect(s.offers[0]).toMatchObject({
      amount: "0.0000002",
      price: { n: 100, d: 1 },
      buying: { type: "native" },
    });
    expect(s.data).toEqual([{ name: "dustin.fixture", valueBase64: "bWVzc3k=" }]);
    expect(s.masterWeight).toBe(1);
    expect(s.thresholds).toEqual({ low: 0, medium: 0, high: 0 });
    expect(s.poolShares).toEqual([]);
    expect(s.claimableBalancesSponsored).toBeNull();
  });

  it("collects the facts the ladder and the merge checks need", async () => {
    const { reader: r } = reader();
    const s = await inspectAccount(m.fixture, { destination: m.destination, reader: r });
    if (!s.exists) throw new Error("expected an existing account");
    expect(s.destination).toMatchObject({
      account: m.destination,
      exists: true,
      memoRequired: false,
    });
    expect(s.destination?.trustlines.map((t) => t.asset.code)).toEqual(["DUSTC"]);
    expect(s.issuers).toEqual([{ account: m.issuer, exists: true, memoRequired: false }]);
    const quote = (code: string) => s.quotes.find((q) => q.asset.code === code)?.quote;
    expect(quote("DUSTA")).toEqual({
      sourceAmount: "0.0000007",
      destinationAmount: "0.0000007",
      path: [],
    });
    expect(quote("DUSTB")).toBeNull();
    expect(quote("SPTA")).toBeNull();
    expect(s.observed.ledger).toBeGreaterThan(0);
    expect(s.feeStats.lastLedgerBaseFee).toBe(100);
  });

  it("makes GET requests only, and exactly these", async () => {
    const { reader: r, requests } = reader();
    await inspectAccount(m.fixture, { destination: m.destination, reader: r });
    expect(requests.every((q) => q.method === "GET")).toBe(true);
    const paths = requests.map((q) => q.path.split("?")[0]).sort();
    expect(paths).toEqual(
      [
        "/",
        "/fee_stats",
        "/ledgers",
        accountPath,
        `${accountPath}/offers`,
        `/accounts/${m.destination}`,
        `/accounts/${m.issuer}`,
        "/paths/strict-send",
        "/paths/strict-send",
        "/paths/strict-send",
        "/paths/strict-send",
      ].sort(),
    );
  });

  it("is JSON-stable and hashes only account state", async () => {
    const a = await inspectAccount(m.fixture, {
      destination: m.destination,
      reader: reader().reader,
    });
    expect(JSON.parse(JSON.stringify(a))).toEqual(a);
    expect(a.snapshotHash).toMatch(/^[0-9a-f]{64}$/);
    const fee = structuredClone(recorded.get("/fee_stats")) as { fee_charged: { p80: string } };
    fee.fee_charged.p80 = "999999";
    const b = await inspectAccount(m.fixture, {
      destination: m.destination,
      reader: reader({ "/fee_stats": fee }).reader,
    });
    expect(b.snapshotHash).toBe(a.snapshotHash);
    const acc = fixtureAccount();
    (acc.balances as { asset_type: string; balance: string }[]).find(
      (x) => x.asset_type === "native",
    )!.balance = "4.0000001";
    const c = await inspectAccount(m.fixture, {
      destination: m.destination,
      reader: reader({ [accountPath]: acc }).reader,
    });
    expect(c.snapshotHash).not.toBe(a.snapshotHash);
  });
});

describe("inspectAccount variants", () => {
  it("reports a missing account instead of throwing", async () => {
    const s = await inspectAccount(m.fixture, {
      reader: reader({ [accountPath]: undefined }).reader,
    });
    expect(s.exists).toBe(false);
    expect(s.snapshotHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("rejects C, M and malformed addresses before any request", async () => {
    const { reader: r, requests } = reader();
    const contract = StrKey.encodeContract(Buffer.alloc(32, 1));
    await expect(inspectAccount(contract, { reader: r })).rejects.toMatchObject({
      code: "CONTRACT_ACCOUNT",
    });
    const muxed = StrKey.encodeMed25519PublicKey(
      Buffer.concat([Keypair.random().rawPublicKey(), Buffer.alloc(8)]),
    );
    await expect(inspectAccount(muxed, { reader: r })).rejects.toMatchObject({
      code: "INVALID_ADDRESS",
    });
    await expect(inspectAccount("GABC", { reader: r })).rejects.toMatchObject({
      code: "INVALID_ADDRESS",
    });
    await expect(
      inspectAccount(m.fixture, { destination: "nope", reader: r }),
    ).rejects.toMatchObject({
      code: "INVALID_ADDRESS",
    });
    expect(requests).toEqual([]);
  });

  it("accepts a muxed destination and inspects its base account", async () => {
    const raw = StrKey.decodeEd25519PublicKey(m.destination);
    const muxed = StrKey.encodeMed25519PublicKey(
      Buffer.concat([Buffer.from(raw), Buffer.alloc(8, 7)]),
    );
    const s = await inspectAccount(m.fixture, { destination: muxed, reader: reader().reader });
    expect(s.destination).toMatchObject({
      account: muxed,
      baseAccount: m.destination,
      exists: true,
    });
  });

  it("detects pool shares, sponsoring with claimable balances, SEP-29 and a frozen trustline", async () => {
    const acc = fixtureAccount();
    acc.num_sponsoring = 2;
    const balances = acc.balances as Record<string, unknown>[];
    balances.push({
      asset_type: "liquidity_pool_shares",
      liquidity_pool_id: "ab".repeat(32),
      balance: "1.0000000",
      limit: "10.0000000",
      is_authorized: false,
    });
    const dusta = balances.find((b) => b.asset_code === "DUSTA")!;
    dusta.is_authorized = false;
    dusta.is_authorized_to_maintain_liabilities = false;
    const dest = structuredClone(recorded.get(`/accounts/${m.destination}`)) as {
      data: Record<string, string>;
    };
    dest.data["config.memo_required"] = "MQ==";
    const cb = `/claimable_balances?sponsor=${m.fixture}&limit=200`;
    const { reader: r, requests } = reader({
      [accountPath]: acc,
      [`/accounts/${m.destination}`]: dest,
      [`/liquidity_pools/${"ab".repeat(32)}`]: {
        reserves: [
          { asset: "native", amount: "1.0000000" },
          { asset: `DUSTC:${m.issuer}`, amount: "1.0000000" },
        ],
      },
      [cb]: {
        _embedded: {
          records: [
            { id: "a", paging_token: "a" },
            { id: "b", paging_token: "b" },
          ],
        },
      },
    });
    const s = await inspectAccount(m.fixture, { destination: m.destination, reader: r });
    if (!s.exists) throw new Error("expected an existing account");
    expect(s.poolShares).toEqual([
      {
        poolId: "ab".repeat(32),
        balance: "1.0000000",
        sponsor: null,
        assets: ["native", `DUSTC:${m.issuer}`],
      },
    ]);
    expect(s.trustlines).toHaveLength(4);
    expect(s.claimableBalancesSponsored).toBe(2);
    expect(s.destination?.memoRequired).toBe(true);
    const frozen = s.trustlines.find((t) => t.asset.code === "DUSTA")!;
    expect(frozen.authorized).toBe(false);
    expect(s.quotes.find((q) => q.asset.code === "DUSTA")?.quote).toBeNull();
    // A trustline that cannot send is not quoted.
    expect(requests.filter((q) => q.path.includes("source_asset_code=DUSTA&"))).toEqual([]);
  });
});
