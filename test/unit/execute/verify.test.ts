import { describe, expect, it, vi } from "vitest";
import { verifyClosed } from "../../../src/execute/verify.js";
import { horizonJson } from "../../../src/reader/horizon-json.js";
import { horizonReader, type LedgerReader } from "../../../src/reader/ledger-reader.js";
import { FakeLedger } from "../../helpers/fake-ledger.js";
import { TESTNET_HORIZON } from "../../helpers/recorded-horizon.js";
import { messy } from "../../helpers/snapshots.js";

function setup() {
  const ledger = FakeLedger.messy();
  const reader = horizonReader(
    horizonJson(TESTNET_HORIZON, { fetch: ledger.fetch, retries: 0, backoffMs: 0 }),
  );
  const reads = { account: 0 };
  const counting: LedgerReader = {
    ...reader,
    account: (id) => {
      reads.account++;
      return reader.account(id);
    },
  };
  // A clock that moves only when the helper waits, so no test waits real time.
  let t = 1_000_000;
  const clock = {
    now: () => t,
    sleep: (ms: number) => {
      t += ms;
      return Promise.resolve();
    },
  };
  return { ledger, reader: counting, reads, clock };
}

describe("verifyClosed", () => {
  it("reports a merged account as gone, with the ledger Horizon had reached", async () => {
    const { ledger, reader, reads, clock } = setup();
    ledger.accounts.delete(messy.fixture);
    const v = await verifyClosed(messy.fixture, { reader, ...clock });
    expect(v).toMatchObject({
      accountExists: false,
      horizonStatus: 404,
      ledger: ledger.ledgerSeq,
      accountUrl: `https://stellar.expert/explorer/testnet/account/${messy.fixture}`,
    });
    expect(Date.parse(v.checkedAt)).not.toBeNaN();
    expect(reads.account).toBe(1);
  });

  it("polls until Horizon answers 404, within the time limit", async () => {
    const { ledger, reader, reads, clock } = setup();
    let seen = 0;
    const lagging: LedgerReader = {
      ...reader,
      account: async (id) => {
        seen++;
        if (seen === 3) ledger.accounts.delete(messy.fixture);
        return reader.account(id);
      },
    };
    const v = await verifyClosed(messy.fixture, {
      reader: lagging,
      timeoutMs: 30_000,
      intervalMs: 2_000,
      ...clock,
    });
    expect(v).toMatchObject({ accountExists: false, horizonStatus: 404 });
    expect(reads.account).toBe(3);
  });

  it("gives up when the account still exists at the time limit, without waiting real time", async () => {
    const { reader, reads, clock } = setup();
    const v = await verifyClosed(messy.fixture, {
      reader,
      timeoutMs: 10_000,
      intervalMs: 2_000,
      ...clock,
    });
    expect(v).toMatchObject({ accountExists: true, horizonStatus: 200 });
    expect(reads.account).toBe(6);
  });

  it("checks once when the time limit is 0", async () => {
    const { reader, reads, clock } = setup();
    const v = await verifyClosed(messy.fixture, { reader, timeoutMs: 0, ...clock });
    expect(v.accountExists).toBe(true);
    expect(reads.account).toBe(1);
  });

  it("refuses a Horizon that does not serve the testnet when it reads through its own client", async () => {
    vi.stubGlobal("fetch", (url: string) =>
      Promise.resolve(
        new Response(
          JSON.stringify(
            url === `${TESTNET_HORIZON}/`
              ? { network_passphrase: "Public Global Stellar Network ; September 2015" }
              : { status: 404 },
          ),
          { status: url === `${TESTNET_HORIZON}/` ? 200 : 404 },
        ),
      ),
    );
    await expect(verifyClosed(messy.fixture, { timeoutMs: 0 })).rejects.toMatchObject({
      code: "MAINNET_REFUSED",
    });
  });
});
