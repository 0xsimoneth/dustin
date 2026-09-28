import { describe, expect, it } from "vitest";
import {
  ledgerWaitLimitMs,
  mergePreflight,
  waitForLedger,
} from "../../../src/execute/preflight.js";
import type { ClosePlan } from "../../../src/plan/model.js";
import { planClose } from "../../../src/plan/plan-close.js";
import { horizonJson } from "../../../src/reader/horizon-json.js";
import { horizonReader } from "../../../src/reader/ledger-reader.js";
import { FakeLedger } from "../../helpers/fake-ledger.js";
import { TESTNET_HORIZON } from "../../helpers/recorded-horizon.js";
import { messy } from "../../helpers/snapshots.js";
import { testClock } from "./harness.js";

// Story E3-S4: what the merge preflight tells the executor about the sequence guard, and the
// bounded wait for a ledger (src/execute/preflight.ts).

/** The fake ledger after the cleanup and the sale: only the merge is left to run. */
async function readyToMerge() {
  const ledger = FakeLedger.messy();
  const reader = horizonReader(horizonJson(TESTNET_HORIZON, { fetch: ledger.fetch, retries: 0 }));
  const plan: ClosePlan = await planClose(
    { account: messy.fixture, destination: messy.destination, feeSponsor: messy.sponsor },
    { reader },
  );
  const account = ledger.accounts.get(messy.fixture)!;
  account.balances = account.balances.filter((b) => b.asset_type === "native");
  account.data = {};
  account.subentry_count = 0;
  account.num_sponsored = 0;
  ledger.offers.set(messy.fixture, []);
  return { ledger, reader, plan };
}

describe("mergePreflight and the sequence guard", () => {
  it("names the latest ledger it read next to the unblocking ledger when only the guard fails", async () => {
    const { ledger, reader, plan } = await readyToMerge();
    const L = ledger.ledgerSeq;
    ledger.accounts.get(messy.fixture)!.sequence = (BigInt(L + 5) << 32n).toString();
    expect(await mergePreflight(reader, plan, { mergeOnly: true })).toEqual({
      ok: false,
      detail: `the sequence guard blocks the merge until ledger ${L + 6}`,
      unblocksAtLedger: L + 6,
      currentLedger: L,
    });
  });

  it("judges the guard by a ledger already known to have closed when Horizon answers an older one", async () => {
    const { ledger, reader, plan } = await readyToMerge();
    const L = ledger.ledgerSeq;
    ledger.accounts.get(messy.fixture)!.sequence = (BigInt(L + 5) << 32n).toString();
    // Ledger L + 5 was seen closed a moment ago; a Horizon behind still answers L. Ledgers only
    // grow, so the merge can land from L + 6 whatever the lagging answer says.
    expect(
      await mergePreflight(reader, plan, { mergeOnly: true, knownLedger: L + 5 }),
    ).toMatchObject({ ok: true });
    // A known ledger older than Horizon's answer changes nothing.
    expect(
      await mergePreflight(reader, plan, { mergeOnly: true, knownLedger: L - 10 }),
    ).toMatchObject({ ok: false, unblocksAtLedger: L + 6, currentLedger: L });
  });

  it("does not name a ledger for the other failures", async () => {
    const { ledger, reader, plan } = await readyToMerge();
    ledger.accounts.delete(messy.destination);
    const result = await mergePreflight(reader, plan, { mergeOnly: true });
    expect(result).toEqual({ ok: false, detail: "the destination no longer exists" });
  });
});

describe("waitForLedger", () => {
  const readerAt = (ledgers: number[]) => {
    let i = 0;
    const reads: number[] = [];
    return {
      reads,
      reader: {
        latestLedger: () => {
          const sequence = ledgers[Math.min(i++, ledgers.length - 1)]!;
          reads.push(sequence);
          return Promise.resolve({
            sequence,
            closed_at: "2026-09-28T12:00:00Z",
            base_fee_in_stroops: 100,
            base_reserve_in_stroops: 5_000_000,
            protocol_version: 28,
          });
        },
      },
    };
  };

  it("returns at once, without a pause, when the ledger has already closed", async () => {
    const clock = testClock(0);
    const { reader } = readerAt([120]);
    const waited = await waitForLedger(reader, 100, {
      pollIntervalMs: 2000,
      limitMs: 60_000,
      sleep: clock.sleep,
      now: clock.now,
    });
    expect(waited).toEqual({ reached: true, ledger: 120, waitedMs: 0, polls: 1 });
    expect(clock.sleeps).toEqual([]);
  });

  it("polls the latest ledger with the injected pause until the target has closed", async () => {
    const clock = testClock(0);
    const { reader, reads } = readerAt([10, 10, 11, 12, 13]);
    const waited = await waitForLedger(reader, 13, {
      pollIntervalMs: 2000,
      limitMs: 60_000,
      sleep: clock.sleep,
      now: clock.now,
    });
    expect(waited).toEqual({ reached: true, ledger: 13, waitedMs: 8000, polls: 5 });
    expect(reads).toEqual([10, 10, 11, 12, 13]);
    expect(clock.sleeps).toEqual([2000, 2000, 2000, 2000]);
  });

  it("gives up once the local-clock limit has passed, with the last ledger it saw", async () => {
    const clock = testClock(0);
    const { reader } = readerAt([10]);
    const waited = await waitForLedger(reader, 13, {
      pollIntervalMs: 5000,
      limitMs: 20_000,
      sleep: clock.sleep,
      now: clock.now,
    });
    expect(waited).toEqual({ reached: false, ledger: 10, waitedMs: 20_000, polls: 5 });
    expect(clock.sleeps).toEqual([5000, 5000, 5000, 5000]);
  });

  it("refuses a pause below the 200 ms floor (src/config/pauses.ts)", async () => {
    const clock = testClock(0);
    const { reader } = readerAt([10]);
    await expect(
      waitForLedger(reader, 13, {
        pollIntervalMs: 0,
        limitMs: 20_000,
        sleep: clock.sleep,
        now: clock.now,
      }),
    ).rejects.toMatchObject({ code: "CONFIG_INVALID" });
  });

  it("derives the limit from the ledgers to wait for: twice their time at 5 s each, plus two ledgers", () => {
    expect(ledgerWaitLimitMs(0)).toBe(20_000);
    expect(ledgerWaitLimitMs(8)).toBe(100_000);
    expect(ledgerWaitLimitMs(119)).toBe(1_210_000);
  });
});
