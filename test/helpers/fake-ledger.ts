import {
  FeeBumpTransaction,
  StrKey,
  TransactionBuilder,
  type Asset,
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

class OpFailure extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

const assetKeyOf = (a: Asset) => (a.isNative() ? "native" : `${a.getCode()}:${a.getIssuer()}`);
const horizonKey = (b: { asset_type: string; asset_code?: string; asset_issuer?: string }) =>
  b.asset_type === "native" ? "native" : `${b.asset_code}:${b.asset_issuer}`;
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

  constructor(ledgerSeq: number) {
    this.ledgerSeq = ledgerSeq;
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
            inner_transaction: "tx_no_account",
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
    const codes: string[] = [];
    let failed = false;
    // Sequence number consumed whatever the outcome (CAP-15).
    source.sequence = (BigInt(source.sequence) + 1n).toString();
    draftAccounts[inner.source]!.sequence = source.sequence;
    for (const op of inner.operations) {
      try {
        this.applyOp(op, inner, draftAccounts, draftOffers);
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
  ): void {
    const me = accounts[inner.source]!;
    const line = (key: string) =>
      me.balances.find((b) => b.asset_type !== "native" && horizonKey(b) === key);
    const recomputeLiabilities = () => {
      for (const b of me.balances) {
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
        const asset = op.line as Asset;
        const l = line(assetKeyOf(asset));
        if (!l) throw new OpFailure("op_invalid_limit");
        if (toStroops(l.balance) + toStroops(l.buying_liabilities ?? "0") > 0n)
          throw new OpFailure("op_invalid_limit");
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

  private nativeOf(a: HorizonAccount): bigint {
    const n = a.balances.find((b: HorizonBalance) => b.asset_type === "native");
    return n ? toStroops(n.balance) : 0n;
  }
}
