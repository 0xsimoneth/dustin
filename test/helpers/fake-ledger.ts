import {
  Asset,
  FeeBumpTransaction,
  LiquidityPoolAsset,
  LiquidityPoolFeeV18,
  StrKey,
  TransactionBuilder,
  getLiquidityPoolId,
  type Transaction,
} from "@stellar/stellar-sdk";
import type { OperationRecord } from "@stellar/stellar-sdk";
import { formatStroops, toStroops } from "../../src/amounts.js";
import type {
  HorizonAccount,
  HorizonBalance,
  HorizonOffer,
} from "../../src/inspect/horizon-types.js";
import { hashHex } from "../../src/sponsor/fee-bump.js";
import { TESTNET_HORIZON, loadRecorded, messyManifest, MESSY_DIR } from "./recorded-horizon.js";

const TESTNET = "Test SDF Network ; September 2015";

type Fault =
  "504-not-applied" | "504-applied" | "network-error-applied" | { status: number; body: unknown };

interface TxRecord {
  hash: string;
  ledger: number;
  successful: boolean;
  fee_charged: string;
  result_xdr: string;
  fee_account: string;
  source_account: string;
}

/** A liquidity pool as Horizon's `GET /liquidity_pools/{id}` returns it (the fields tests use). */
export interface FakeLiquidityPool {
  id: string;
  fee_bp: number;
  type: "constant_product";
  total_trustlines: string;
  total_shares: string;
  reserves: Array<{ asset: string; amount: string }>;
}

class OpFailure extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

const assetKeyOf = (a: Asset) => (a.isNative() ? "native" : `${a.getCode()}:${a.getIssuer()}`);
const horizonKey = (b: {
  asset_type: string;
  asset_code?: string;
  asset_issuer?: string;
  liquidity_pool_id?: string;
}) =>
  b.asset_type === "native"
    ? "native"
    : b.asset_type === "liquidity_pool_shares"
      ? `pool:${b.liquidity_pool_id}`
      : `${b.asset_code}:${b.asset_issuer}`;
const sdkAsset = (key: string) => {
  if (key === "native") return Asset.native();
  const [code, issuer] = key.split(":");
  return new Asset(code ?? "", issuer);
};
const poolIdOf = (lp: LiquidityPoolAsset) =>
  Buffer.from(getLiquidityPoolId("constant_product", lp.getLiquidityPoolParameters())).toString(
    "hex",
  );
const baseOf = (address: string) =>
  StrKey.isValidMed25519PublicKey(address)
    ? StrKey.encodeEd25519PublicKey(
        Buffer.from(StrKey.decodeMed25519PublicKey(address).subarray(0, 32)),
      )
    : address;

/**
 * An in-memory testnet for executor tests: serves the Horizon GETs Dustin uses and applies
 * submitted fee bumps with the protocol rules Dustin depends on (sequence numbers, offer and
 * trustline removal, burns, merges, the sequence guard), returning Horizon's result codes. A
 * failed inner transaction still consumes its sequence number and the sponsor's fee.
 */
export class FakeLedger {
  ledgerSeq: number;
  baseReserve = 5_000_000n;
  accounts = new Map<string, HorizonAccount>();
  offers = new Map<string, HorizonOffer[]>();
  /** Strict-send quotes to XLM keyed by "CODE:ISSUER"; the amount is what the market pays. */
  quotes = new Map<string, string>();
  transactions = new Map<string, TxRecord>();
  submissions: string[] = [];
  faults: Fault[] = [];
  /**
   * Liquidity pools by pool id (hex). A pool is created with its first pool-share trustline and
   * erased with its last (CAP-38, https://github.com/stellar/stellar-protocol/blob/master/core/cap-0038.md).
   */
  liquidityPools = new Map<string, FakeLiquidityPool>();
  /** Pools that exist on the ledger but that Horizon answers 404 for (review finding R13). */
  unlistedPools = new Set<string>();

  constructor(ledgerSeq: number) {
    this.ledgerSeq = ledgerSeq;
  }

  /** The id (hex) of the constant-product pool of two assets ("native" or "CODE:ISSUER"). */
  static poolId(x: string, y: string): string {
    return poolIdOf(FakeLedger.poolAsset(x, y));
  }

  /** The SDK pool-share asset of two assets in either order: sorted, fee 30 bps (CAP-38). */
  static poolAsset(x: string, y: string): LiquidityPoolAsset {
    const [a, b] = [sdkAsset(x), sdkAsset(y)].sort((p, q) => Asset.compare(p, q)) as [Asset, Asset];
    return new LiquidityPoolAsset(a, b, LiquidityPoolFeeV18);
  }

  /**
   * Gives `accountId` a credit trustline ("CODE:ISSUER") as ChangeTrust would: the issuer must
   * exist and differ from the account; the line is one subentry and, when sponsored, one
   * sponsored reserve. Authorized by default; reserves are not checked.
   */
  addTrustline(
    accountId: string,
    asset: string,
    options: { balance?: string; authorized?: boolean; sponsor?: string } = {},
  ): void {
    const account = this.accounts.get(accountId);
    if (!account) throw new Error(`fake ledger: no account ${accountId}`);
    const [code, issuer] = asset.split(":") as [string, string];
    if (issuer === accountId) throw new Error(`CHANGE_TRUST_SELF_NOT_ALLOWED: ${asset}`);
    if (!this.accounts.has(issuer)) throw new Error(`CHANGE_TRUST_NO_ISSUER: ${asset}`);
    if (account.balances.some((b) => horizonKey(b) === asset)) {
      throw new Error(`fake ledger: ${accountId} already trusts ${asset}`);
    }
    const authorized = options.authorized ?? true;
    account.balances.push({
      asset_type: code.length <= 4 ? "credit_alphanum4" : "credit_alphanum12",
      asset_code: code,
      asset_issuer: issuer,
      balance: formatStroops(toStroops(options.balance ?? "0")),
      limit: "922337203685.4775807",
      buying_liabilities: "0.0000000",
      selling_liabilities: "0.0000000",
      is_authorized: authorized,
      is_authorized_to_maintain_liabilities: authorized,
      last_modified_ledger: this.ledgerSeq,
      ...(options.sponsor ? { sponsor: options.sponsor } : {}),
    });
    account.subentry_count += 1;
    if (options.sponsor) {
      const sponsor = this.accounts.get(options.sponsor);
      if (!sponsor) throw new Error(`fake ledger: no sponsor account ${options.sponsor}`);
      account.num_sponsored += 1;
      sponsor.num_sponsoring += 1;
    }
  }

  /**
   * Gives `accountId` a pool-share trustline, as ChangeTrust on a LiquidityPoolAsset does (CAP-38;
   * stellar-core ChangeTrustOpFrame): the account needs a trustline, authorized at least to
   * maintain liabilities, for each asset of the pool except XLM and assets it issues itself
   * (CHANGE_TRUST_TRUST_LINE_MISSING, CHANGE_TRUST_NOT_AUTH_MAINTAIN_LIABILITIES); the line counts
   * as two subentries and, when sponsored, two sponsored reserves (computeMultiplier); the pool is
   * created with its first share trustline. `balance` stands in for shares from a deposit.
   * Reserves are not checked. Returns the pool id.
   */
  addPoolShareTrustline(
    accountId: string,
    assets: [string, string],
    options: { balance?: string; sponsor?: string } = {},
  ): string {
    const account = this.accounts.get(accountId);
    if (!account) throw new Error(`fake ledger: no account ${accountId}`);
    const lp = FakeLedger.poolAsset(...assets);
    const id = poolIdOf(lp);
    if (account.balances.some((b) => horizonKey(b) === `pool:${id}`)) {
      throw new Error(`fake ledger: ${accountId} already holds a share trustline of pool ${id}`);
    }
    const keys = [assetKeyOf(lp.assetA), assetKeyOf(lp.assetB)];
    for (const key of keys) {
      if (key === "native" || key.endsWith(`:${accountId}`)) continue;
      const line = account.balances.find((b) => horizonKey(b) === key);
      if (!line)
        throw new Error(`CHANGE_TRUST_TRUST_LINE_MISSING: ${accountId} has no ${key} trustline`);
      if (!line.is_authorized && !line.is_authorized_to_maintain_liabilities) {
        throw new Error(`CHANGE_TRUST_NOT_AUTH_MAINTAIN_LIABILITIES: ${key} on ${accountId}`);
      }
    }
    const balance = formatStroops(toStroops(options.balance ?? "0"));
    account.balances.push({
      asset_type: "liquidity_pool_shares",
      liquidity_pool_id: id,
      balance,
      limit: "922337203685.4775807",
      is_authorized: false,
      is_authorized_to_maintain_liabilities: false,
      last_modified_ledger: this.ledgerSeq,
      ...(options.sponsor ? { sponsor: options.sponsor } : {}),
    });
    account.subentry_count += 2;
    if (options.sponsor) {
      const sponsor = this.accounts.get(options.sponsor);
      if (!sponsor) throw new Error(`fake ledger: no sponsor account ${options.sponsor}`);
      account.num_sponsored += 2;
      sponsor.num_sponsoring += 2;
    }
    const pool = this.liquidityPools.get(id) ?? {
      id,
      fee_bp: LiquidityPoolFeeV18,
      type: "constant_product" as const,
      total_trustlines: "0",
      total_shares: "0.0000000",
      reserves: keys.map((asset) => ({ asset, amount: "0.0000000" })),
    };
    pool.total_trustlines = String(Number(pool.total_trustlines) + 1);
    pool.total_shares = formatStroops(toStroops(pool.total_shares) + toStroops(balance));
    this.liquidityPools.set(id, pool);
    return id;
  }

  /** The recorded live messy fixture plus a funded fee sponsor. */
  static messy(): FakeLedger {
    const recorded = loadRecorded(MESSY_DIR);
    const m = messyManifest().accounts;
    const ledgerPage = recorded.get("/ledgers?order=desc&limit=1") as {
      _embedded: { records: { sequence: number }[] };
    };
    const fake = new FakeLedger(ledgerPage._embedded.records[0]!.sequence);
    for (const id of [m.fixture, m.destination, m.issuer, m.reserveSponsor, m.marketMaker]) {
      fake.accounts.set(id, structuredClone(recorded.get(`/accounts/${id}`)) as HorizonAccount);
    }
    fake.accounts.set(
      m.sponsor,
      FakeLedger.plainAccount(m.sponsor, "10000.0000000", fake.ledgerSeq),
    );
    const offers = recorded.get(`/accounts/${m.fixture}/offers?limit=200&order=asc`) as {
      _embedded: { records: HorizonOffer[] };
    };
    fake.offers.set(m.fixture, structuredClone(offers._embedded.records));
    fake.quotes.set(`DUSTA:${m.issuer}`, "0.0000007");
    return fake;
  }

  static plainAccount(id: string, balance: string, ledgerSeq: number): HorizonAccount {
    return {
      id,
      account_id: id,
      sequence: (BigInt(ledgerSeq - 1000) << 32n).toString(),
      subentry_count: 0,
      num_sponsoring: 0,
      num_sponsored: 0,
      thresholds: { low_threshold: 0, med_threshold: 0, high_threshold: 0 },
      flags: {
        auth_required: false,
        auth_revocable: false,
        auth_immutable: false,
        auth_clawback_enabled: false,
      },
      signers: [{ key: id, weight: 1, type: "ed25519_public_key" }],
      data: {},
      balances: [
        {
          asset_type: "native",
          balance,
          buying_liabilities: "0.0000000",
          selling_liabilities: "0.0000000",
        },
      ],
    };
  }

  native(id: string): bigint {
    const b = this.accounts.get(id)?.balances.find((x) => x.asset_type === "native");
    return b ? toStroops(b.balance) : 0n;
  }

  readonly fetch = (url: string, init?: RequestInit): Promise<Response> => {
    const path = url.startsWith(TESTNET_HORIZON) ? url.slice(TESTNET_HORIZON.length) : url;
    const json = (body: unknown, status = 200) =>
      Promise.resolve(new Response(JSON.stringify(body), { status }));
    const notFound = () => json({ status: 404 }, 404);
    if ((init?.method ?? "GET") === "POST" && path === "/transactions") {
      return this.post(typeof init?.body === "string" ? init.body : "");
    }
    if (path === "/") return json({ network_passphrase: TESTNET });
    if (path.startsWith("/ledgers")) {
      return json({
        _embedded: {
          records: [
            {
              sequence: this.ledgerSeq,
              closed_at: new Date(Date.now()).toISOString(),
              base_fee_in_stroops: 100,
              base_reserve_in_stroops: Number(this.baseReserve),
              protocol_version: 28,
              paging_token: String(this.ledgerSeq),
            },
          ],
        },
      });
    }
    if (path === "/fee_stats")
      return json({ last_ledger_base_fee: "100", fee_charged: { p80: "100" } });
    const tx = /^\/transactions\/([0-9a-f]{64})$/.exec(path);
    if (tx) return this.transactions.has(tx[1]!) ? json(this.transactions.get(tx[1]!)) : notFound();
    const offers = /^\/accounts\/([A-Z0-9]{56})\/offers/.exec(path);
    if (offers) {
      const records = (this.offers.get(offers[1]!) ?? []).map((o) => ({
        ...o,
        paging_token: o.id,
      }));
      return this.accounts.has(offers[1]!) ? json({ _embedded: { records } }) : notFound();
    }
    const account = /^\/accounts\/([A-Z0-9]{56})$/.exec(path);
    if (account)
      return this.accounts.has(account[1]!) ? json(this.accounts.get(account[1]!)) : notFound();
    if (path.startsWith("/paths/strict-send")) {
      const q = new URLSearchParams(path.split("?")[1]);
      const out = this.quotes.get(`${q.get("source_asset_code")}:${q.get("source_asset_issuer")}`);
      const records = out
        ? [{ source_amount: q.get("source_amount"), destination_amount: out, path: [] }]
        : [];
      return json({ _embedded: { records } });
    }
    if (path.startsWith("/claimable_balances")) return json({ _embedded: { records: [] } });
    const pool = /^\/liquidity_pools\/([0-9a-f]{64})$/.exec(path);
    if (pool && !this.unlistedPools.has(pool[1]!) && this.liquidityPools.has(pool[1]!)) {
      return json(this.liquidityPools.get(pool[1]!));
    }
    return notFound();
  };

  private post(body: string): Promise<Response> {
    const xdr = decodeURIComponent(body.replace(/^tx=/, ""));
    this.submissions.push(xdr);
    const fault = this.faults.shift();
    if (fault && typeof fault === "object")
      return Promise.resolve(new Response(JSON.stringify(fault.body), { status: fault.status }));
    const envelope = TransactionBuilder.fromXDR(xdr, TESTNET);
    if (!(envelope instanceof FeeBumpTransaction)) {
      return this.reply(400, {
        extras: { result_codes: { transaction: "tx_not_fee_bumped_in_fake" } },
      });
    }
    // Dropped before inclusion: Horizon times out and the transaction never lands.
    if (fault === "504-not-applied") return this.reply(504, { status: 504 });
    const result = this.apply(envelope);
    if (fault === "504-applied") return this.reply(504, { status: 504 });
    if (fault === "network-error-applied") return Promise.reject(new Error("ECONNRESET"));
    return result;
  }

  private reply(status: number, body: unknown): Promise<Response> {
    return Promise.resolve(new Response(JSON.stringify(body), { status }));
  }

  private apply(bump: FeeBumpTransaction): Promise<Response> {
    const inner = bump.innerTransaction;
    const source = this.accounts.get(inner.source);
    const hash = hashHex(bump);
    if (!source)
      return this.reply(400, {
        extras: {
          result_codes: {
            transaction: "tx_fee_bump_inner_failed",
            // Horizon's string for TxNoAccount (stellar-horizon internal/codes/main.go).
            inner_transaction: "tx_no_source_account",
          },
        },
      });
    if (BigInt(inner.sequence) !== BigInt(source.sequence) + 1n) {
      return this.reply(400, {
        extras: {
          result_codes: {
            transaction: "tx_fee_bump_inner_failed",
            inner_transaction: "tx_bad_seq",
          },
        },
      });
    }
    if (
      Number(inner.timeBounds?.maxTime ?? 0) !== 0 &&
      Number(inner.timeBounds!.maxTime) < Date.now() / 1000
    ) {
      return this.reply(400, {
        extras: {
          result_codes: {
            transaction: "tx_fee_bump_inner_failed",
            inner_transaction: "tx_too_late",
          },
        },
      });
    }
    this.ledgerSeq += 1;
    const fee = 100 * (inner.operations.length + 1);
    const sponsor = this.accounts.get(bump.feeSource)!;
    const draftAccounts = structuredClone(Object.fromEntries(this.accounts));
    const draftOffers = structuredClone(Object.fromEntries(this.offers));
    const draftPools = structuredClone(Object.fromEntries(this.liquidityPools));
    const codes: string[] = [];
    let failed = false;
    // Sequence number consumed whatever the outcome (CAP-15).
    source.sequence = (BigInt(source.sequence) + 1n).toString();
    draftAccounts[inner.source]!.sequence = source.sequence;
    for (const op of inner.operations) {
      try {
        this.applyOp(op, inner, draftAccounts, draftOffers, draftPools);
        codes.push("op_success");
      } catch (e) {
        if (!(e instanceof OpFailure)) throw e;
        codes.push(e.code);
        failed = true;
        break;
      }
    }
    const record: TxRecord = {
      hash,
      ledger: this.ledgerSeq,
      successful: !failed,
      fee_charged: String(fee),
      result_xdr: "",
      fee_account: bump.feeSource,
      source_account: inner.source,
    };
    this.transactions.set(hash, record);
    if (failed) {
      // Nothing of the inner transaction applies, but the sponsor pays the fee.
      this.debit(sponsor, BigInt(fee));
      return this.reply(400, {
        extras: {
          result_codes: {
            transaction: "tx_fee_bump_inner_failed",
            inner_transaction: "tx_failed",
            operations: codes,
          },
        },
      });
    }
    this.accounts = new Map(
      Object.entries(draftAccounts).filter(
        (entry): entry is [string, HorizonAccount] => entry[1] !== null,
      ),
    );
    this.offers = new Map(Object.entries(draftOffers));
    this.liquidityPools = new Map(Object.entries(draftPools));
    this.debit(this.accounts.get(bump.feeSource)!, BigInt(fee));
    return this.reply(200, record);
  }

  private debit(account: HorizonAccount, stroops: bigint): void {
    const n = account.balances.find((b) => b.asset_type === "native")!;
    n.balance = formatStroops(toStroops(n.balance) - stroops);
  }

  private applyOp(
    op: OperationRecord,
    inner: Transaction,
    accounts: Record<string, HorizonAccount | null>,
    offers: Record<string, HorizonOffer[]>,
    pools: Record<string, FakeLiquidityPool>,
  ): void {
    const me = accounts[inner.source]!;
    const line = (key: string) =>
      me.balances.find((b) => b.asset_type !== "native" && horizonKey(b) === key);
    const recomputeLiabilities = () => {
      for (const b of me.balances) {
        // Pool shares cannot be offered, so Horizon shows no liabilities on them.
        if (b.asset_type === "liquidity_pool_shares") continue;
        b.selling_liabilities = "0.0000000";
        b.buying_liabilities = "0.0000000";
      }
      for (const o of offers[inner.source] ?? []) {
        const sell = me.balances.find((b) => horizonKey(b) === horizonKey(o.selling));
        if (sell)
          sell.selling_liabilities = formatStroops(
            toStroops(sell.selling_liabilities ?? "0") + toStroops(o.amount),
          );
        const buy = me.balances.find((b) => horizonKey(b) === horizonKey(o.buying));
        const bought = (toStroops(o.amount) * BigInt(o.price_r.n)) / BigInt(o.price_r.d);
        if (buy)
          buy.buying_liabilities = formatStroops(toStroops(buy.buying_liabilities ?? "0") + bought);
      }
    };
    switch (op.type) {
      case "manageSellOffer": {
        const list = offers[inner.source] ?? [];
        const index = list.findIndex((o) => String(o.id) === String(op.offerId));
        if (index < 0) throw new OpFailure("op_offer_not_found");
        list.splice(index, 1);
        me.subentry_count -= 1;
        recomputeLiabilities();
        return;
      }
      case "payment":
      case "pathPaymentStrictSend": {
        const asset = op.type === "payment" ? op.asset : op.sendAsset;
        const amount = toStroops(op.type === "payment" ? op.amount : op.sendAmount);
        const l = line(assetKeyOf(asset));
        if (!l) throw new OpFailure("op_src_no_trust");
        if (!l.is_authorized) throw new OpFailure("op_src_not_authorized");
        if (toStroops(l.balance) - toStroops(l.selling_liabilities ?? "0") < amount)
          throw new OpFailure("op_underfunded");
        const destination = baseOf(op.destination);
        if (op.type === "pathPaymentStrictSend") {
          const out = this.quotes.get(assetKeyOf(asset));
          if (!out) throw new OpFailure("op_too_few_offers");
          if (toStroops(out) < toStroops(op.destMin)) throw new OpFailure("op_under_dest_min");
          l.balance = formatStroops(toStroops(l.balance) - amount);
          const target = accounts[destination]!;
          const n = target.balances.find((b) => b.asset_type === "native")!;
          n.balance = formatStroops(toStroops(n.balance) + toStroops(out));
          return;
        }
        const issuer = asset.getIssuer();
        if (destination !== issuer) {
          const target = accounts[destination];
          if (!target) throw new OpFailure("op_no_destination");
          const tl = target.balances.find(
            (b) => b.asset_type !== "native" && horizonKey(b) === assetKeyOf(asset),
          );
          if (!tl) throw new OpFailure("op_no_trust");
          if (!tl.is_authorized) throw new OpFailure("op_not_authorized");
          tl.balance = formatStroops(toStroops(tl.balance) + amount);
        }
        // A payment to the issuer burns, even if the issuer account is gone (day-1 experiment 4).
        l.balance = formatStroops(toStroops(l.balance) - amount);
        return;
      }
      case "changeTrust": {
        if (op.line instanceof LiquidityPoolAsset) {
          this.removePoolShareLine(me, op.line, op.limit, accounts, pools);
          return;
        }
        const asset = op.line;
        const l = line(assetKeyOf(asset));
        if (!l) throw new OpFailure("op_invalid_limit");
        if (toStroops(l.balance) + toStroops(l.buying_liabilities ?? "0") > 0n)
          throw new OpFailure("op_invalid_limit");
        // After the limit check, as in stellar-core ChangeTrustOpFrame::doApply: an asset trustline
        // that one of the account's pool-share trustlines uses cannot be deleted (CAP-38).
        const key = assetKeyOf(asset);
        const inUse = me.balances.some(
          (b) =>
            b.asset_type === "liquidity_pool_shares" &&
            (pools[b.liquidity_pool_id ?? ""]?.reserves ?? []).some((r) => r.asset === key),
        );
        if (inUse) throw new OpFailure("op_cannot_delete");
        me.balances = me.balances.filter((b) => b !== l);
        me.subentry_count -= 1;
        if (l.sponsor) {
          me.num_sponsored -= 1;
          const s = accounts[l.sponsor];
          if (s) s.num_sponsoring -= 1;
        }
        return;
      }
      case "manageData": {
        if (!(op.name in me.data)) throw new OpFailure("op_data_name_not_found");
        const { [op.name]: _removed, ...rest } = me.data;
        me.data = rest;
        me.subentry_count -= 1;
        return;
      }
      case "accountMerge": {
        const destination = baseOf(op.destination);
        const target = accounts[destination];
        if (!target) throw new OpFailure("op_no_account");
        if (me.flags.auth_immutable) throw new OpFailure("op_immutable_set");
        const signersBeyondMaster = me.signers.filter((s) => s.key !== inner.source).length;
        if (me.subentry_count !== signersBeyondMaster) throw new OpFailure("op_has_sub_entries");
        if (BigInt(me.sequence) >= BigInt(this.ledgerSeq) << 32n)
          throw new OpFailure("op_seq_num_too_far");
        if (me.num_sponsoring > 0) throw new OpFailure("op_is_sponsor");
        const n = target.balances.find((b) => b.asset_type === "native")!;
        n.balance = formatStroops(toStroops(n.balance) + this.nativeOf(me));
        accounts[inner.source] = null;
        delete offers[inner.source];
        return;
      }
      default:
        throw new OpFailure(`op_unsupported_in_fake_${op.type}`);
    }
  }

  /**
   * ChangeTrust with limit 0 on a pool-share trustline, following stellar-core
   * ChangeTrustOpFrame::doApply and CAP-38: a missing line is a new line with limit 0 and a line
   * that holds shares is below its minimum limit, both CHANGE_TRUST_INVALID_LIMIT; otherwise the
   * line goes with its two subentries (two sponsored reserves on both sides when sponsored), the
   * pool loses a share trustline and is erased with its last. Only deletion is modelled.
   */
  private removePoolShareLine(
    me: HorizonAccount,
    lp: LiquidityPoolAsset,
    limit: string,
    accounts: Record<string, HorizonAccount | null>,
    pools: Record<string, FakeLiquidityPool>,
  ): void {
    if (toStroops(limit) !== 0n) throw new OpFailure("op_unsupported_in_fake_pool_share_limit");
    const id = poolIdOf(lp);
    const l = me.balances.find((b) => horizonKey(b) === `pool:${id}`);
    if (!l || toStroops(l.balance) > 0n) throw new OpFailure("op_invalid_limit");
    const pool = pools[id];
    if (!pool) throw new OpFailure("op_inconsistent_in_fake_pool_missing");
    me.balances = me.balances.filter((b) => b !== l);
    me.subentry_count -= 2;
    if (l.sponsor) {
      me.num_sponsored -= 2;
      const s = accounts[l.sponsor];
      if (s) s.num_sponsoring -= 2;
    }
    pool.total_trustlines = String(Number(pool.total_trustlines) - 1);
    if (pool.total_trustlines === "0") delete pools[id];
  }

  private nativeOf(a: HorizonAccount): bigint {
    const n = a.balances.find((b: HorizonBalance) => b.asset_type === "native");
    return n ? toStroops(n.balance) : 0n;
  }
}
