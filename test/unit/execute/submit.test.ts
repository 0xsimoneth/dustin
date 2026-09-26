import { describe, expect, it, vi } from "vitest";
import { horizonSubmitter, submitAndConfirm } from "../../../src/execute/submit.js";

const HASH = "ab".repeat(32);
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const applied = {
  hash: HASH,
  ledger: 42,
  successful: true,
  fee_charged: "300",
  result_xdr: "AAAA",
  envelope_xdr: "BBBB",
};

/** `record` is what `GET /transactions/{hash}` finds: a fixed record, null (404) or a function. */
function fake(responses: Array<Response | Error>, record: unknown = null) {
  const calls: { method: string; url: string }[] = [];
  const fetch = vi.fn((url: string, init?: RequestInit) => {
    calls.push({ method: init?.method ?? "GET", url });
    if ((init?.method ?? "GET") === "GET") {
      const found: unknown = typeof record === "function" ? (record as () => unknown)() : record;
      return Promise.resolve(found === null ? json({ status: 404 }, 404) : json(found));
    }
    const next = responses.shift();
    return next instanceof Error ? Promise.reject(next) : Promise.resolve(next!);
  });
  return { submitter: horizonSubmitter("https://h.example", { fetch }), calls };
}

describe("submitAndConfirm", () => {
  it("returns the applied transaction", async () => {
    const { submitter, calls } = fake([json(applied)]);
    const r = await submitAndConfirm(
      submitter,
      { xdr: "ENV", hash: HASH, maxTime: 0 },
      { pollIntervalMs: 0 },
    );
    expect(r).toEqual({
      kind: "applied",
      hash: HASH,
      ledger: 42,
      feeChargedStroops: 300,
      resultXdr: "AAAA",
    });
    expect(calls).toEqual([{ method: "POST", url: "https://h.example/transactions" }]);
  });

  it("reports Horizon's result codes for a rejected or failed transaction", async () => {
    const body = {
      status: 400,
      extras: {
        result_codes: {
          transaction: "tx_fee_bump_inner_failed",
          inner_transaction: "tx_failed",
          operations: ["op_too_few_offers"],
        },
      },
    };
    const { submitter } = fake([json(body, 400)]);
    const r = await submitAndConfirm(
      submitter,
      { xdr: "ENV", hash: HASH, maxTime: 0 },
      { pollIntervalMs: 0 },
    );
    // Included in the ledger but failed: sequence number and fee consumed.
    expect(r).toEqual({
      kind: "failed",
      hash: HASH,
      status: 400,
      codes: {
        transaction: "tx_fee_bump_inner_failed",
        innerTransaction: "tx_failed",
        operations: ["op_too_few_offers"],
      },
    });
    const { submitter: s2 } = fake([
      json({ status: 400, extras: { result_codes: { transaction: "tx_bad_seq" } } }, 400),
    ]);
    expect(
      (await submitAndConfirm(s2, { xdr: "ENV", hash: HASH, maxTime: 0 }, { pollIntervalMs: 0 }))
        .kind,
    ).toBe("rejected");
  });

  it("treats a 504 as pending and finds the transaction by hash without resubmitting", async () => {
    const { submitter, calls } = fake([json({ status: 504 }, 504)], applied);
    const r = await submitAndConfirm(
      submitter,
      { xdr: "ENV", hash: HASH, maxTime: 9_999_999_999 },
      { pollIntervalMs: 0 },
    );
    expect(r.kind).toBe("applied");
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(1);
    expect(calls.some((c) => c.url === `https://h.example/transactions/${HASH}`)).toBe(true);
  });

  it("polls after a network error too, and gives up as unknown once the time bound has passed", async () => {
    const { submitter, calls } = fake([new Error("ECONNRESET")]);
    const past = Math.floor(Date.now() / 1000) - 60;
    const r = await submitAndConfirm(
      submitter,
      { xdr: "ENV", hash: HASH, maxTime: past },
      { pollIntervalMs: 0 },
    );
    expect(r).toEqual({ kind: "unknown", hash: HASH });
    expect(calls.filter((c) => c.method === "GET").length).toBeGreaterThanOrEqual(1);
  });
});

// Review finding R11 and E2-S3: what was never accepted is not polled, and a polled failure carries
// its result codes.
describe("submitAndConfirm classification", () => {
  // Day-1 testnet failure 1d13837c... (ledger 4874035): a merge refused with op_seq_num_too_far.
  const FAILED_XDR =
    "AAAAAAAAAMj////zfU2t/R/yDpMCqbrww6W6leQYvC+W4hfExzqE/XEpyJUAAAAAAAAAAP////8AAAABAAAAAAAAAAj////7AAAAAAAAAAA=";
  const clock = () => {
    let t = 1_000_000;
    return {
      now: () => t,
      sleep: (ms: number) => {
        t += ms / 1000;
        return Promise.resolve();
      },
    };
  };
  const envelope = { xdr: "ENV", hash: HASH, maxTime: 1_000_100 };

  it("treats a 400 without result codes as refused and does not poll", async () => {
    const { submitter, calls } = fake([json({ status: 400, title: "Transaction Malformed" }, 400)]);
    const r = await submitAndConfirm(submitter, envelope, { ...clock(), pollIntervalMs: 1000 });
    expect(r).toEqual({ kind: "rejected", hash: HASH, status: 400, codes: {} });
    expect(calls.map((c) => c.method)).toEqual(["POST"]);
  });

  it("treats a 429 and any other 4xx as refused and does not poll", async () => {
    for (const status of [429, 403, 413]) {
      const { submitter, calls } = fake([json({ status }, status)]);
      const r = await submitAndConfirm(submitter, envelope, { ...clock(), pollIntervalMs: 1000 });
      expect(r).toEqual({ kind: "rejected", hash: HASH, status, codes: {} });
      expect(calls.map((c) => c.method)).toEqual(["POST"]);
    }
  });

  it("decodes the result of a transaction found failed on the ledger after a 504", async () => {
    const record = {
      hash: HASH,
      ledger: 4874035,
      successful: false,
      fee_charged: "200",
      result_xdr: FAILED_XDR,
    };
    const { submitter } = fake([json({ status: 504 }, 504)], record);
    const r = await submitAndConfirm(submitter, envelope, { ...clock(), pollIntervalMs: 1000 });
    expect(r).toEqual({
      kind: "failed",
      hash: HASH,
      status: 200,
      ledger: 4874035,
      feeChargedStroops: 200,
      resultXdr: FAILED_XDR,
      codes: {
        transaction: "tx_fee_bump_inner_failed",
        innerTransaction: "tx_failed",
        operations: ["op_seq_num_too_far"],
      },
    });
  });

  it("reads the fee charged from extras.result_xdr of a failure", async () => {
    const body = {
      status: 400,
      extras: {
        result_xdr: FAILED_XDR,
        result_codes: {
          transaction: "tx_fee_bump_inner_failed",
          inner_transaction: "tx_failed",
          operations: ["op_seq_num_too_far"],
        },
      },
    };
    const { submitter } = fake([json(body, 400)]);
    const r = await submitAndConfirm(submitter, envelope, { ...clock(), pollIntervalMs: 1000 });
    expect(r).toMatchObject({ kind: "failed", status: 400, feeChargedStroops: 200 });
  });

  it("gives up on an unconfirmed envelope only after a ledger closed past its time bound", async () => {
    const c = clock();
    let lookups = 0;
    const { submitter } = fake([json({ status: 504 }, 504)], () => {
      lookups++;
      return null;
    });
    const closeTimes = [envelope.maxTime - 5, envelope.maxTime, envelope.maxTime + 5];
    const ledgerCloseTime = vi.fn(() => Promise.resolve(closeTimes.shift()!));
    const r = await submitAndConfirm(submitter, envelope, {
      ...c,
      pollIntervalMs: 5000,
      ledgerCloseTime,
    });
    expect(r).toEqual({ kind: "unknown", hash: HASH });
    expect(ledgerCloseTime).toHaveBeenCalledTimes(3);
    // The ledger's clock decided: this machine's clock (95 s behind it here) never reached maxTime,
    // and the last lookup came after the ledger had passed it (review finding 6).
    expect(c.now()).toBeLessThan(envelope.maxTime);
    expect(lookups).toBeGreaterThan(2);
  });

  it("finds a transaction that was included just before the time bound on the last lookup", async () => {
    let ledgerPassed = false;
    const { submitter } = fake([json({ status: 504 }, 504)], () => (ledgerPassed ? applied : null));
    const r = await submitAndConfirm(submitter, envelope, {
      ...clock(),
      pollIntervalMs: 5000,
      ledgerCloseTime: () => {
        ledgerPassed = true;
        return Promise.resolve(envelope.maxTime + 1);
      },
    });
    expect(r.kind).toBe("applied");
  });

  it("says an envelope may still apply while no ledger has closed past its time bound", async () => {
    const { submitter } = fake([new Error("ECONNRESET")]);
    const r = await submitAndConfirm(submitter, envelope, {
      ...clock(),
      pollIntervalMs: 5000,
      ledgerWaitSeconds: 30,
      ledgerCloseTime: () => Promise.resolve(envelope.maxTime - 100),
    });
    expect(r).toEqual({ kind: "unknown", hash: HASH, mayStillApply: true });
  });
});
