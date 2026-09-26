// Day-1 protocol experiments for Dustin (docs/technical-spike.md section 8.4).
// Testnet only. Every key is generated in memory for this run and never printed or stored.
// Output: public keys, transaction hashes and Horizon result codes only.
//
// Run from the repository root: node scripts/spike/day1.ts <output.json>
// (Node >= 22.18 strips TypeScript types natively; results of the 2026-09-26 run are in
// docs/research/day1-experiments-2026-09-26.json and summarised in docs/progress-log.md.)

import {
  Asset,
  AccountRequiresMemoError,
  Horizon,
  Keypair,
  Memo,
  Networks,
  Operation,
  TransactionBuilder,
} from "@stellar/stellar-sdk";
import type { xdr } from "@stellar/stellar-sdk";
import { writeFileSync } from "node:fs";

const HORIZON_URL = "https://horizon-testnet.stellar.org";
const FRIENDBOT_URL = "https://friendbot.stellar.org";
const PASSPHRASE = Networks.TESTNET;
const TESTNET_PASSPHRASE = "Test SDF Network ; September 2015";
const STROOPS_PER_XLM = 10_000_000n;

const server = new Horizon.Server(HORIZON_URL);

// SDK 17.1.0: Transaction.hash() returns a Uint8Array, so .toString("hex") would print decimal bytes.
const hex = (bytes: Uint8Array): string => Buffer.from(bytes).toString("hex");
const results: Record<string, unknown> = {};

// ---------- amounts (BigInt stroops, never JS numbers) ----------

function toStroops(amount: string): bigint {
  const [whole, frac = ""] = amount.split(".");
  return BigInt(whole) * STROOPS_PER_XLM + BigInt((frac + "0000000").slice(0, 7));
}

function fromStroops(stroops: bigint): string {
  const sign = stroops < 0n ? "-" : "";
  const abs = stroops < 0n ? -stroops : stroops;
  return `${sign}${abs / STROOPS_PER_XLM}.${(abs % STROOPS_PER_XLM).toString().padStart(7, "0")}`;
}

// ---------- network helpers ----------

async function assertTestnet(): Promise<void> {
  if (PASSPHRASE !== TESTNET_PASSPHRASE) throw new Error("refusing: not the testnet passphrase");
  const root = (await (await fetch(HORIZON_URL)).json()) as { network_passphrase: string };
  if (root.network_passphrase !== TESTNET_PASSPHRASE) throw new Error("refusing: Horizon is not testnet");
}

async function friendbot(publicKey: string): Promise<void> {
  const res = await fetch(`${FRIENDBOT_URL}/?addr=${encodeURIComponent(publicKey)}`);
  if (!res.ok) throw new Error(`friendbot failed with HTTP ${res.status}`);
}

async function latestLedger(): Promise<{ sequence: number; closedAt: string; baseReserve: bigint; baseFee: number; protocol: number }> {
  const page = await server.ledgers().order("desc").limit(1).call();
  const l = page.records[0];
  return {
    sequence: l.sequence,
    closedAt: l.closed_at,
    baseReserve: BigInt(l.base_reserve_in_stroops),
    baseFee: l.base_fee_in_stroops,
    protocol: l.protocol_version,
  };
}

async function httpGet(path: string): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${HORIZON_URL}${path}`);
  return { status: res.status, body: await res.json() };
}

let BASE_FEE_STROOPS = 100;

async function pickBaseFee(): Promise<void> {
  const stats = await server.feeStats();
  const lastBase = Number(stats.last_ledger_base_fee);
  const p80 = Number(stats.fee_charged.p80);
  BASE_FEE_STROOPS = Math.min(Math.max(100, lastBase, p80), 1_000_000);
  results.feeStats = {
    last_ledger_base_fee: stats.last_ledger_base_fee,
    fee_charged_p80: stats.fee_charged.p80,
    max_fee_p50: stats.max_fee.p50,
    chosenBaseFeeStroops: BASE_FEE_STROOPS,
  };
}

function errorInfo(e: unknown): Record<string, unknown> {
  if (e instanceof AccountRequiresMemoError) {
    return { kind: "AccountRequiresMemoError", accountId: e.accountId, operationIndex: e.operationIndex };
  }
  const r = (e as { response?: { status?: number; data?: { extras?: { result_codes?: unknown } } } }).response;
  return {
    kind: (e as Error).constructor?.name ?? "Error",
    status: r?.status,
    result_codes: r?.data?.extras?.result_codes,
    message: (e as Error).message,
  };
}

type Outcome = { ok: true; hash: string; innerHash?: string; ledger: number } | ({ ok: false; hash?: string; innerHash?: string } & Record<string, unknown>);

// A plain transaction: the source pays its own fee (setup only).
async function submitPlain(source: Keypair, ops: xdr.Operation[], extraSigners: Keypair[] = []): Promise<Outcome> {
  const account = await server.loadAccount(source.publicKey());
  const tx = new TransactionBuilder(account, { fee: String(BASE_FEE_STROOPS), networkPassphrase: PASSPHRASE })
    .setTimeout(120);
  for (const op of ops) tx.addOperation(op);
  const built = tx.build();
  built.sign(source, ...extraSigners);
  const hash = hex(built.hash());
  try {
    const res = await server.submitTransaction(built);
    return { ok: true, hash, ledger: res.ledger };
  } catch (e) {
    return { ok: false, hash, ...errorInfo(e) };
  }
}

// The Dustin shape: inner transaction sourced and signed by the account, fee-bumped by the sponsor.
async function submitBumped(
  sponsor: Keypair,
  source: Keypair,
  ops: xdr.Operation[],
  opts: { innerFee?: string; signers?: Keypair[]; memo?: Memo; baseFee?: number } = {},
): Promise<Outcome> {
  const account = await server.loadAccount(source.publicKey());
  const builder = new TransactionBuilder(account, {
    fee: opts.innerFee ?? "0",
    networkPassphrase: PASSPHRASE,
    memo: opts.memo,
  }).setTimeout(120);
  for (const op of ops) builder.addOperation(op);
  const inner = builder.build();
  inner.sign(...(opts.signers ?? [source]));
  const feeBump = TransactionBuilder.buildFeeBumpTransaction(
    sponsor.publicKey(),
    String(opts.baseFee ?? BASE_FEE_STROOPS),
    inner,
    PASSPHRASE,
  );
  feeBump.sign(sponsor);
  const hash = hex(feeBump.hash());
  const innerHash = hex(inner.hash());
  try {
    const res = await server.submitTransaction(feeBump);
    return { ok: true, hash, innerHash, ledger: res.ledger };
  } catch (e) {
    return { ok: false, hash, innerHash, ...errorInfo(e) };
  }
}

async function accountOrNull(id: string): Promise<Horizon.AccountResponse | null> {
  try {
    return await server.loadAccount(id);
  } catch (e) {
    if ((e as { response?: { status?: number } }).response?.status === 404) return null;
    throw e;
  }
}

function nativeBalance(acc: Horizon.AccountResponse): bigint {
  const line = acc.balances.find((b) => b.asset_type === "native");
  return line ? toStroops(line.balance) : 0n;
}

function nativeSellingLiabilities(acc: Horizon.AccountResponse): bigint {
  const line = acc.balances.find((b) => b.asset_type === "native") as { selling_liabilities?: string } | undefined;
  return line?.selling_liabilities ? toStroops(line.selling_liabilities) : 0n;
}

// Minimum balance per CAP-33: (2 + numSubEntries + numSponsoring - numSponsored) * baseReserve.
function minimumBalance(acc: Horizon.AccountResponse, baseReserve: bigint): bigint {
  return (2n + BigInt(acc.subentry_count) + BigInt(acc.num_sponsoring) - BigInt(acc.num_sponsored)) * baseReserve;
}

function spendable(acc: Horizon.AccountResponse, baseReserve: bigint): bigint {
  return nativeBalance(acc) - minimumBalance(acc, baseReserve) - nativeSellingLiabilities(acc);
}

async function run(name: string, fn: () => Promise<unknown>): Promise<void> {
  const started = Date.now();
  try {
    results[name] = await fn();
  } catch (e) {
    results[name] = { crashed: true, ...errorInfo(e) };
  }
  console.log(`[${new Date().toISOString()}] ${name} done in ${Date.now() - started} ms`);
}

// =====================================================================

await assertTestnet();
const ledger0 = await latestLedger();
results.network = { horizon: HORIZON_URL, passphrase: PASSPHRASE, ledgerAtStart: ledger0.sequence, protocol: ledger0.protocol };
await pickBaseFee();

const S = Keypair.random(); // fee sponsor (fee-bump fee source)
await friendbot(S.publicKey());

const names = ["A", "C", "R", "I", "M", "J", "H", "K", "B", "E", "D", "D2", "Q", "F"] as const;
const kp = Object.fromEntries(names.map((n) => [n, Keypair.random()])) as Record<(typeof names)[number], Keypair>;
const startBalance: Record<string, string> = { M: "100", R: "10" };
{
  const res = await submitPlain(
    S,
    names.map((n) => Operation.createAccount({ destination: kp[n].publicKey(), startingBalance: startBalance[n] ?? "5" })),
  );
  if (!res.ok) throw new Error(`account creation failed: ${JSON.stringify(res)}`);
  results.accounts = {
    S_feeSponsor: S.publicKey(),
    ...Object.fromEntries(names.map((n) => [n, kp[n].publicKey()])),
    createTx: res.hash,
  };
}

const I = kp.I;
const DUST = new Asset("DUST", I.publicKey());
const ZERO = new Asset("ZERO", I.publicKey());
const SPT = new Asset("SPT", I.publicKey());
const NOMK = new Asset("NOMK", I.publicKey());
const ORPH = new Asset("ORPH", kp.J.publicKey());
const ORPZ = new Asset("ORPZ", kp.J.publicKey());
const FRZ = new Asset("FRZ", kp.Q.publicKey());

// ---------- Experiment 5, part 1: bump sequence now, merge attempt now; the rest waits for ledgers ----------
let exp5: Record<string, unknown> = {};
let seqAtMergeForRetry = 0n;
await run("exp5_part1_bump_and_early_merge", async () => {
  const L = (await latestLedger()).sequence;
  const bumpTo = BigInt(L + 20) << 32n;
  const bump = await submitPlain(kp.B, [Operation.bumpSequence({ bumpTo: bumpTo.toString() })]);
  const accAfterBump = await server.loadAccount(kp.B.publicKey());
  const seqAtMerge = BigInt(accAfterBump.sequence) + 1n;
  const early = await submitBumped(S, kp.B, [Operation.accountMerge({ destination: S.publicKey() })]);
  const accAfterEarly = await server.loadAccount(kp.B.publicKey());
  seqAtMergeForRetry = BigInt(accAfterEarly.sequence) + 1n;
  exp5 = {
    ledgerWhenBuilt: L,
    bumpTo: bumpTo.toString(),
    bump,
    sequenceAfterBump: accAfterBump.sequence,
    earlyMerge: { seqAtMerge: seqAtMerge.toString(), ...early },
    sequenceAfterEarlyMerge: accAfterEarly.sequence,
    earlyMergeConsumedSequence: BigInt(accAfterEarly.sequence) === BigInt(accAfterBump.sequence) + 1n,
    unblocksAtLedgerFormula: ((seqAtMergeForRetry >> 32n) + 1n).toString(),
  };
  return exp5;
});

// ---------- Experiment 1: zero-spendable account, fee-bumped with inner fee "0" and "100" ----------
await run("exp1_zero_spendable_fee_bump", async () => {
  const A = kp.A;
  const setup = await submitPlain(
    S,
    [
      Operation.changeTrust({ asset: DUST, source: A.publicKey() }),
      Operation.changeTrust({ asset: ZERO, source: A.publicKey() }),
      Operation.payment({ destination: A.publicKey(), asset: DUST, amount: "0.0000007", source: I.publicKey() }),
      Operation.manageData({ name: "d1", value: "v", source: A.publicKey() }),
      Operation.manageData({ name: "d2", value: "v", source: A.publicKey() }),
    ],
    [A, I],
  );
  const { baseReserve } = await latestLedger();
  let acc = await server.loadAccount(A.publicKey());
  const min = minimumBalance(acc, baseReserve);
  const drainAmount = spendable(acc, baseReserve);
  const drain = await submitBumped(S, A, [
    Operation.payment({ destination: S.publicKey(), asset: Asset.native(), amount: fromStroops(drainAmount) }),
  ]);
  acc = await server.loadAccount(A.publicKey());
  const afterDrain = { balance: fromStroops(nativeBalance(acc)), minimum: fromStroops(min), spendable: fromStroops(spendable(acc, baseReserve)), sequence: acc.sequence };

  // Negative control: the same account cannot pay its own fee.
  const unbumped = await submitPlain(A, [Operation.manageData({ name: "d1", value: null })]);
  const accAfterUnbumped = await server.loadAccount(A.publicKey());

  const innerZero = await submitBumped(S, A, [Operation.manageData({ name: "d1", value: null })], { innerFee: "0" });
  const accAfterZero = await server.loadAccount(A.publicKey());
  let txRecord: Record<string, unknown> | null = null;
  let innerLookup: Record<string, unknown> | null = null;
  if (innerZero.ok) {
    const t = await httpGet(`/transactions/${innerZero.hash}`);
    const b = t.body as Record<string, unknown>;
    txRecord = {
      status: t.status,
      source_account: b.source_account,
      fee_account: b.fee_account,
      fee_charged: b.fee_charged,
      max_fee: b.max_fee,
      inner_transaction: b.inner_transaction,
      fee_bump_transaction: b.fee_bump_transaction,
    };
    const li = await httpGet(`/transactions/${innerZero.innerHash}`);
    innerLookup = { status: li.status, returnedHash: (li.body as { hash?: string }).hash, fee_account: (li.body as { fee_account?: string }).fee_account };
  }
  const innerHundred = await submitBumped(S, A, [Operation.manageData({ name: "d2", value: null })], { innerFee: "100" });
  const accAfterHundred = await server.loadAccount(A.publicKey());
  const dustLine = acc.balances.find((b) => (b as { asset_code?: string }).asset_code === "DUST") as Record<string, unknown> | undefined;
  return {
    setup,
    drain,
    afterDrain,
    unbumpedControl: { ...unbumped, sequenceUnchanged: accAfterUnbumped.sequence === acc.sequence },
    innerFeeZero: { ...innerZero, balanceAfter: fromStroops(nativeBalance(accAfterZero)), txRecord, innerHashLookup: innerLookup },
    innerFeeHundred: { ...innerHundred, balanceAfter: fromStroops(nativeBalance(accAfterHundred)) },
    horizonOmitsClawbackFlagWhenFalse: dustLine ? !("is_clawback_enabled" in dustLine) : "no DUST line",
    dustLineKeys: dustLine ? Object.keys(dustLine) : [],
  };
});

// ---------- Experiment 6 + 2: market maker bid, dust quote, buy-offer cancel via manageSellOffer ----------
await run("exp6_quote_and_exp2_buy_offer_cancel", async () => {
  const M = kp.M;
  const setup = await submitPlain(M, [
    Operation.changeTrust({ asset: DUST }),
    Operation.manageBuyOffer({ selling: Asset.native(), buying: DUST, buyAmount: "10", price: "1" }),
  ]);
  // Horizon's path-finding graph may trail the ledger that created the offer: poll and count.
  const polls: { ledger: number; records: number }[] = [];
  let quote = await server.strictSendPaths(DUST, "0.0000007", [Asset.native()]).call();
  polls.push({ ledger: (await latestLedger()).sequence, records: quote.records.length });
  while (quote.records.length === 0 && polls.length < 30) {
    await new Promise((r) => setTimeout(r, 1000));
    quote = await server.strictSendPaths(DUST, "0.0000007", [Asset.native()]).call();
    polls.push({ ledger: (await latestLedger()).sequence, records: quote.records.length });
  }
  const noMarketQuote = await server.strictSendPaths(NOMK, "0.0000003", [Asset.native()]).call();

  const before = await server.offers().forAccount(M.publicKey()).call();
  const created = await submitBumped(S, M, [
    Operation.manageBuyOffer({ selling: Asset.native(), buying: DUST, buyAmount: "5", price: "0.5" }),
  ]);
  const mid = await server.offers().forAccount(M.publicKey()).call();
  const beforeIds = new Set(before.records.map((o) => String(o.id)));
  const newOffer = mid.records.find((o) => !beforeIds.has(String(o.id)));
  let cancel: Outcome | { skipped: string } = { skipped: "buy offer not found" };
  if (newOffer) {
    cancel = await submitBumped(S, M, [
      Operation.manageSellOffer({
        selling: Asset.native(),
        buying: DUST,
        amount: "0",
        price: { n: newOffer.price_r.n, d: newOffer.price_r.d },
        offerId: String(newOffer.id),
      }),
    ]);
  }
  const after = await server.offers().forAccount(M.publicKey()).call();
  return {
    setup,
    offerLedger: setup.ok ? setup.ledger : null,
    quotePolls: polls,
    dustQuote: quote.records.map((r) => ({ source_amount: r.source_amount, destination_amount: r.destination_amount, path: r.path })),
    noMarketQuoteRecords: noMarketQuote.records.length,
    buyOfferCreated: created,
    buyOfferRecord: newOffer ? { id: newOffer.id, selling: newOffer.selling, buying: newOffer.buying, amount: newOffer.amount, price: newOffer.price, price_r: newOffer.price_r } : null,
    cancelViaManageSellOffer: cancel,
    offerGone: newOffer ? !after.records.some((o) => String(o.id) === String(newOffer.id)) : null,
    remainingOffers: after.records.length,
  };
});

// ---------- Experiment 14 + 7: path payment to self, then last removal + merge in one transaction ----------
await run("exp14_path_payment_to_self_and_exp7_merge_same_tx", async () => {
  const A = kp.A;
  const { baseReserve } = await latestLedger();
  const accBefore = await server.loadAccount(A.publicKey());
  const quote = await server.strictSendPaths(DUST, "0.0000007", [Asset.native()]).call();
  const best = quote.records.reduce<(typeof quote.records)[number] | null>(
    (acc, r) => (!acc || toStroops(r.destination_amount) > toStroops(acc.destination_amount) ? r : acc),
    null,
  );
  if (!best) return { skipped: "no path for DUST", accBefore: accBefore.balances };
  const quoted = toStroops(best.destination_amount);
  const destMin = quoted - (quoted * 100n) / 10_000n > 0n ? quoted - (quoted * 100n) / 10_000n : 1n; // 1% slippage, floor 1 stroop
  const sell = await submitBumped(S, A, [
    Operation.pathPaymentStrictSend({
      sendAsset: DUST,
      sendAmount: "0.0000007",
      destination: A.publicKey(),
      destAsset: Asset.native(),
      destMin: fromStroops(destMin),
      path: [],
    }),
    Operation.changeTrust({ asset: DUST, limit: "0" }),
  ]);
  const accMid = await server.loadAccount(A.publicKey());
  const proceeds = nativeBalance(accMid) - nativeBalance(accBefore);
  const mergeAmount = nativeBalance(accMid);
  const destBefore = nativeBalance(await server.loadAccount(kp.D.publicKey()));
  const merge = await submitBumped(S, A, [
    Operation.changeTrust({ asset: ZERO, limit: "0" }),
    Operation.accountMerge({ destination: kp.D.publicKey() }),
  ]);
  const accAfter = await accountOrNull(A.publicKey());
  const destAfter = nativeBalance(await server.loadAccount(kp.D.publicKey()));
  const opsAfterMerge = await httpGet(`/accounts/${A.publicKey()}/operations?order=desc&limit=10`);
  const accountGet = await httpGet(`/accounts/${A.publicKey()}`);
  return {
    quoted: best.destination_amount,
    destMin: fromStroops(destMin),
    sellToSelf: sell,
    proceedsStroops: proceeds.toString(),
    spendableBeforeSell: fromStroops(spendable(accBefore, baseReserve)),
    removalPlusMergeSameTx: merge,
    accountExistsAfter: accAfter !== null,
    horizonAccountStatus: accountGet.status,
    destinationCreditedStroops: (destAfter - destBefore).toString(),
    expectedMergeAmountStroops: mergeAmount.toString(),
    exp11_operationsOfMergedAccount: {
      status: opsAfterMerge.status,
      count: ((opsAfterMerge.body as { _embedded?: { records?: unknown[] } })._embedded?.records ?? []).length,
      types: ((opsAfterMerge.body as { _embedded?: { records?: { type: string }[] } })._embedded?.records ?? []).map((r) => r.type),
    },
  };
});

// ---------- Experiment 3: sponsored trustline removed by its owner alone ----------
await run("exp3_sponsored_trustline_owner_removal", async () => {
  const C = kp.C;
  const R = kp.R;
  const sandwich = await submitPlain(
    R,
    [
      Operation.beginSponsoringFutureReserves({ sponsoredId: C.publicKey() }),
      Operation.changeTrust({ asset: SPT, source: C.publicKey() }),
      Operation.endSponsoringFutureReserves({ source: C.publicKey() }),
    ],
    [C],
  );
  const rBefore = await server.loadAccount(R.publicKey());
  const cBefore = await server.loadAccount(C.publicKey());
  const sptLine = cBefore.balances.find((b) => (b as { asset_code?: string }).asset_code === "SPT") as { sponsor?: string } | undefined;
  const overSigned = await submitBumped(S, C, [Operation.changeTrust({ asset: SPT, limit: "0" })], { signers: [C, R] });
  const removal = await submitBumped(S, C, [Operation.changeTrust({ asset: SPT, limit: "0" })]);
  const rAfter = await server.loadAccount(R.publicKey());
  const cAfter = await server.loadAccount(C.publicKey());
  let effects: string[] = [];
  if (removal.ok) {
    const eff = await server.effects().forTransaction(removal.hash).call();
    effects = eff.records.map((r) => r.type);
  }
  return {
    sandwich,
    trustlineSponsorField: sptLine?.sponsor,
    before: { R_num_sponsoring: rBefore.num_sponsoring, C_num_sponsored: cBefore.num_sponsored, R_balance: fromStroops(nativeBalance(rBefore)) },
    overSignedWithReserveSponsor: overSigned,
    removalSignedByOwnerOnly: removal,
    after: { R_num_sponsoring: rAfter.num_sponsoring, C_num_sponsored: cAfter.num_sponsored, R_balance: fromStroops(nativeBalance(rAfter)) },
    effects,
  };
});

// ---------- Experiment 4: payments and trustline removal after the issuer merged away ----------
await run("exp4_merged_issuer", async () => {
  const J = kp.J;
  const H = kp.H;
  const K = kp.K;
  const setup = await submitPlain(
    S,
    [
      Operation.changeTrust({ asset: ORPH, source: H.publicKey() }),
      Operation.changeTrust({ asset: ORPZ, source: H.publicKey() }),
      Operation.changeTrust({ asset: ORPH, source: K.publicKey() }),
      Operation.payment({ destination: H.publicKey(), asset: ORPH, amount: "0.0000005", source: J.publicKey() }),
    ],
    [H, K, J],
  );
  const issuerMerge = await submitPlain(J, [Operation.accountMerge({ destination: S.publicKey() })]);
  const issuerGone = (await accountOrNull(J.publicKey())) === null;
  const payToMergedIssuer = await submitBumped(S, H, [
    Operation.payment({ destination: J.publicKey(), asset: ORPH, amount: "0.0000005" }),
  ]);
  const hMid = await server.loadAccount(H.publicKey());
  const orphMid = hMid.balances.find((b) => (b as { asset_code?: string }).asset_code === "ORPH") as { balance?: string } | undefined;
  let payToDestinationHolder: Outcome | { skipped: string } = { skipped: "burn succeeded" };
  if (!payToMergedIssuer.ok) {
    payToDestinationHolder = await submitBumped(S, H, [
      Operation.payment({ destination: K.publicKey(), asset: ORPH, amount: "0.0000005" }),
    ]);
  }
  const removeZeroBalanceLine = await submitBumped(S, H, [Operation.changeTrust({ asset: ORPZ, limit: "0" })]);
  const removeEmptiedLine = await submitBumped(S, H, [Operation.changeTrust({ asset: ORPH, limit: "0" })]);
  const createToMergedIssuer = await submitBumped(S, H, [Operation.changeTrust({ asset: new Asset("NEWX", J.publicKey()) })]);
  return {
    setup,
    issuerWithOutstandingSupplyMerge: issuerMerge,
    issuerGone,
    payToMergedIssuer,
    orphBalanceAfterPayAttempt: orphMid?.balance,
    payToDestinationHolder,
    removeZeroBalanceLineIssuerGone: removeZeroBalanceLine,
    removeEmptiedLine,
    createTrustlineToMergedIssuer: createToMergedIssuer,
  };
});

// ---------- Experiment 13: deauthorized and maintain-liabilities trustlines ----------
await run("exp13_deauthorized_trustline", async () => {
  const Q = kp.Q;
  const F = kp.F;
  const setup = await submitPlain(
    S,
    [
      Operation.setOptions({ setFlags: 11 as never, source: Q.publicKey() }), // AUTH_REQUIRED | AUTH_REVOCABLE | AUTH_CLAWBACK_ENABLED
      Operation.changeTrust({ asset: FRZ, source: F.publicKey() }),
      Operation.setTrustLineFlags({ trustor: F.publicKey(), asset: FRZ, flags: { authorized: true }, source: Q.publicKey() }),
      Operation.payment({ destination: F.publicKey(), asset: FRZ, amount: "0.0000005", source: Q.publicKey() }),
      Operation.setTrustLineFlags({ trustor: F.publicKey(), asset: FRZ, flags: { authorized: false }, source: Q.publicKey() }),
    ],
    [Q, F],
  );
  const fFrozen = await server.loadAccount(F.publicKey());
  const frozenLine = fFrozen.balances.find((b) => (b as { asset_code?: string }).asset_code === "FRZ");
  const payBackFrozen = await submitBumped(S, F, [Operation.payment({ destination: Q.publicKey(), asset: FRZ, amount: "0.0000005" })]);
  const removeWithBalance = await submitBumped(S, F, [Operation.changeTrust({ asset: FRZ, limit: "0" })]);
  const toMaintain = await submitPlain(Q, [
    Operation.setTrustLineFlags({ trustor: F.publicKey(), asset: FRZ, flags: { authorizedToMaintainLiabilities: true } }),
  ]);
  const fMaintain = await server.loadAccount(F.publicKey());
  const maintainLine = fMaintain.balances.find((b) => (b as { asset_code?: string }).asset_code === "FRZ");
  const payBackMaintain = await submitBumped(S, F, [Operation.payment({ destination: Q.publicKey(), asset: FRZ, amount: "0.0000005" })]);
  const backToFrozenAndClawback = await submitPlain(Q, [
    Operation.setTrustLineFlags({ trustor: F.publicKey(), asset: FRZ, flags: { authorizedToMaintainLiabilities: false } }),
    Operation.clawback({ asset: FRZ, from: F.publicKey(), amount: "0.0000005" }),
  ]);
  const removeAfterClawback = await submitBumped(S, F, [Operation.changeTrust({ asset: FRZ, limit: "0" })]);
  return {
    setup,
    frozenLine,
    payBackWhileDeauthorized: payBackFrozen,
    removeWhileBalanceRemains: removeWithBalance,
    toMaintainLiabilities: toMaintain,
    maintainLine,
    payBackWhileMaintainOnly: payBackMaintain,
    backToFrozenAndClawback,
    removeDeauthorizedZeroBalanceLine: removeAfterClawback,
  };
});

// ---------- Experiment 10: SEP-29 memo-required destination and the merge ----------
await run("exp10_sep29_merge", async () => {
  const E = kp.E;
  const D2 = kp.D2;
  const mark = await submitPlain(D2, [Operation.manageData({ name: "config.memo_required", value: "1" })]);
  const withoutMemo = await submitBumped(S, E, [Operation.accountMerge({ destination: D2.publicKey() })]);
  const eStillExists = (await accountOrNull(E.publicKey())) !== null;
  const withMemo = await submitBumped(S, E, [Operation.accountMerge({ destination: D2.publicKey() })], { memo: Memo.text("dustin-day1") });
  const eGone = (await accountOrNull(E.publicKey())) === null;
  return { markMemoRequired: mark, mergeWithoutMemo: withoutMemo, accountUntouchedAfterClientRefusal: eStillExists, mergeWithMemo: withMemo, accountGoneAfterMemoMerge: eGone };
});

// ---------- Experiment 5, part 2 and 12: wait for the sequence guard to clear, measure ledger cadence ----------
await run("exp5_part2_merge_after_wait_and_exp12_ledger", async () => {
  const unblocksAt = Number((seqAtMergeForRetry >> 32n) + 1n);
  const start = await latestLedger();
  let current = start;
  const deadline = Date.now() + 10 * 60 * 1000;
  // Submit once the latest closed ledger is unblocksAt - 1: the merge then applies at unblocksAt or later.
  while (current.sequence < unblocksAt - 1) {
    if (Date.now() > deadline) return { timedOut: true, unblocksAt, current: current.sequence };
    await new Promise((r) => setTimeout(r, 2000));
    current = await latestLedger();
  }
  const guardOkForNextLedger = seqAtMergeForRetry < BigInt(current.sequence + 1) << 32n;
  const merge = await submitBumped(S, kp.B, [Operation.accountMerge({ destination: S.publicKey() })]);
  const bGone = (await accountOrNull(kp.B.publicKey())) === null;
  const end = await latestLedger();
  const seconds = (Date.parse(end.closedAt) - Date.parse(ledger0.closedAt)) / 1000;
  return {
    part1: exp5,
    unblocksAtLedger: unblocksAt,
    submittedWhenLatestLedger: current.sequence,
    plannerGuardOkForNextLedger: guardOkForNextLedger,
    mergeAfterWait: merge,
    appliedAtOrAfterUnblock: merge.ok ? merge.ledger >= unblocksAt : null,
    accountGone: bGone,
    exp12: {
      baseReserveStroops: end.baseReserve.toString(),
      baseFeeStroops: end.baseFee,
      protocol: end.protocol,
      ledgersObserved: end.sequence - ledger0.sequence,
      secondsObserved: seconds,
      secondsPerLedger: Number((seconds / (end.sequence - ledger0.sequence)).toFixed(2)),
    },
  };
});

const out = process.argv[2] ?? "day1-results.json";
writeFileSync(out, JSON.stringify(results, null, 2));
console.log(`results written to ${out}`);
