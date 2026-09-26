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

function fake(responses: Array<Response | Error>, record: unknown = null) {
  const calls: { method: string; url: string }[] = [];
  const fetch = vi.fn((url: string, init?: RequestInit) => {
    calls.push({ method: init?.method ?? "GET", url });
    if ((init?.method ?? "GET") === "GET") {
      return Promise.resolve(record === null ? json({ status: 404 }, 404) : json(record));
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
