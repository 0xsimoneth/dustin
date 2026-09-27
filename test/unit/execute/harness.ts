import { FeeBumpTransaction, Networks, TransactionBuilder } from "@stellar/stellar-sdk";
import { planClose, type PlanCloseInput } from "../../../src/plan/plan-close.js";
import { hashHex } from "../../../src/sponsor/fee-bump.js";
import { horizonSubmitter } from "../../../src/execute/submit.js";
import { horizonJson, type FetchLike } from "../../../src/reader/horizon-json.js";
import { horizonReader } from "../../../src/reader/ledger-reader.js";
import type { Signer } from "../../../src/sponsor/signer.js";
import { FakeLedger } from "../../helpers/fake-ledger.js";
import { TESTNET_HORIZON } from "../../helpers/recorded-horizon.js";
import { messy } from "../../helpers/snapshots.js";

/**
 * A clock that moves only when the code under test waits, so no test waits real time. A wait that
 * never ends (a deadline read from another clock) fails the test after `maxSleeps` waits instead
 * of spinning.
 */
export function testClock(startMs = Date.now(), maxSleeps = 1000) {
  let t = startMs;
  const sleeps: number[] = [];
  return {
    now: () => t,
    sleep: (ms: number) => {
      sleeps.push(ms);
      if (sleeps.length > maxSleeps) {
        return Promise.reject(new Error(`waited ${maxSleeps} times without reaching a deadline`));
      }
      t += Math.max(ms, 1);
      return Promise.resolve();
    },
    advance: (ms: number) => {
      t += ms;
    },
    sleeps,
  };
}
export type TestClock = ReturnType<typeof testClock>;

/**
 * The fake ledger's Horizon with its ledger close times taken from `clock`, so the ledger's clock
 * moves with the test clock. The clock starts at the real time, which keeps every time bound in the
 * future for the fake ledger's own `tx_too_late` check.
 */
export function withLedgerClock(fetch: FetchLike, clock: TestClock): FetchLike {
  return async (url, init) => {
    const response = await fetch(url, init);
    if (!url.includes("/ledgers")) return response;
    const page = (await response.json()) as { _embedded: { records: { closed_at: string }[] } };
    for (const record of page._embedded.records) {
      record.closed_at = new Date(clock.now()).toISOString();
    }
    return new Response(JSON.stringify(page));
  };
}

// The fake ledger does not verify signatures, so signers only need the right public keys.
export const signerFor = (publicKey: string): Signer => ({
  publicKey: () => publicKey,
  sign: () => undefined,
});
export const signers = () => ({
  account: signerFor(messy.fixture),
  feeSponsor: signerFor(messy.sponsor),
});

/**
 * The recorded messy fixture on the fake ledger, behind a Horizon client. `wrap` can intercept
 * requests (it sees the fake ledger's own fetch). The executor options wait on the test clock.
 */
export function harness(wrap?: (ledger: FakeLedger, fetch: FetchLike) => FetchLike) {
  const ledger = FakeLedger.messy();
  const clock = testClock();
  const base = recordIncludedFaults(ledger, withLedgerClock(ledger.fetch, clock));
  const fetch = wrap ? wrap(ledger, base) : base;
  const reader = horizonReader(horizonJson(TESTNET_HORIZON, { fetch, retries: 0, backoffMs: 0 }));
  const submitter = horizonSubmitter(TESTNET_HORIZON, { fetch });
  const deps = {
    reader,
    submitter,
    pollIntervalMs: 5000,
    now: clock.now,
    sleep: clock.sleep,
  };
  const plan = (extra: Partial<PlanCloseInput> = {}) =>
    planClose(
      {
        account: messy.fixture,
        destination: messy.destination,
        feeSponsor: messy.sponsor,
        ...extra,
      },
      { reader },
    );
  return { ledger, clock, deps, plan };
}

/**
 * A Horizon behind the one that took a transaction, for one account read: `arm()` (call it before
 * the envelope is posted) keeps the account as it is, and the next read of it after that gets the
 * copy. Used to reach the paths behind a 404 that the account does not contradict (edge case E5).
 */
export function staleAccountOnce(account: string) {
  let copy: unknown = null;
  let pending = false;
  return {
    arm(ledger: FakeLedger) {
      copy = structuredClone(ledger.accounts.get(account));
      pending = true;
    },
    wrap(fetch: FetchLike): FetchLike {
      return (url, init) => {
        const reading = (init?.method ?? "GET") === "GET";
        if (pending && reading && url.endsWith(`/accounts/${account}`)) {
          pending = false;
          return Promise.resolve(new Response(JSON.stringify(copy)));
        }
        return fetch(url, init);
      };
    },
  };
}

/** Horizon's JSON answer with a status. */
export const reply = (status: number, body: unknown = { status }) =>
  Promise.resolve(new Response(JSON.stringify(body), { status }));

type Codes = { transaction: string; inner_transaction?: string; operations?: string[] };
/**
 * A POST answer carrying result codes, as a fake-ledger fault. It stands for an envelope refused at
 * validation: nothing is recorded, so a lookup by hash answers 404.
 */
export const answer = (codes: Codes, status = 400) => ({
  status,
  body: { status, extras: { result_codes: codes } },
});
/**
 * The same answer for a transaction that was included and failed: `recordIncludedFaults` records
 * it on the fake ledger (sequence number used, record found by hash), as Horizon would.
 */
export const included = (codes: Codes) => ({ ...answer(codes), included: true });
export const failedOps = (...operations: string[]) =>
  included({ transaction: "tx_fee_bump_inner_failed", inner_transaction: "tx_failed", operations });

/**
 * A fetch that records every fault marked `included` on the fake ledger when its envelope is
 * posted: a failed record under the envelope's hash and the inner sequence number used. Without
 * it, a scripted `tx_failed` answer reads as a refusal at validation (edge case E6).
 */
export function recordIncludedFaults(ledger: FakeLedger, fetch: FetchLike): FetchLike {
  return (url, init) => {
    const next = ledger.faults[0] as { included?: boolean } | string | undefined;
    const posting = (init?.method ?? "GET") === "POST";
    if (posting && typeof next === "object" && next.included) {
      const body = typeof init?.body === "string" ? init.body : "";
      const xdr = decodeURIComponent(body.replace(/^tx=/, ""));
      const bump = TransactionBuilder.fromXDR(xdr, Networks.TESTNET) as FeeBumpTransaction;
      const inner = bump.innerTransaction;
      const hash = hashHex(bump);
      ledger.transactions.set(hash, {
        hash,
        ledger: ledger.ledgerSeq,
        successful: false,
        fee_charged: String(100 * (inner.operations.length + 1)),
        result_xdr: "",
        fee_account: bump.feeSource,
        source_account: inner.source,
      });
      const account = ledger.accounts.get(inner.source);
      if (account) account.sequence = inner.sequence;
    }
    return fetch(url, init);
  };
}
