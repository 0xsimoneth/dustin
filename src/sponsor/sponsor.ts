import {
  TransactionBuilder,
  type FeeBumpTransaction,
  type Transaction,
} from "@stellar/stellar-sdk";
import { DEFAULT_MAX_BASE_FEE, MIN_BASE_FEE } from "../config/fees.js";
import { assertTestnetPassphrase } from "../config/network.js";
import { DustinError } from "../errors/dustin-error.js";
import { DEFAULT_BUDGET_STROOPS } from "../plan/fees.js";
import type { Signer } from "./signer.js";

export interface FeeSponsorOptions {
  networkPassphrase: string;
  /** Cap on the bid per operation; default 1,000,000 stroops. */
  maxBaseFeeStroops?: number;
  /** Cap on the sum of all bids of one close; default 5 XLM. */
  budgetStroops?: number;
}

/**
 * The fee sponsor (docs/adr/ADR-0003): it signs only fee-bump envelopes and never an inner
 * transaction. Before signing it checks the content (ADR-0002 relay controls): the sponsor is not
 * the inner source and every operation acts for the inner source, so its signature can never
 * authorise anything but paying the fee. Its worst-case loss is the budget.
 */
export class FeeSponsor {
  readonly publicKey: string;
  private readonly signer: Signer;
  private readonly networkPassphrase: string;
  private readonly maxBaseFeeStroops: number;
  private readonly budgetStroops: number;
  /**
   * Every total bid signed, or being signed, for each inner source and sequence number. A bid is
   * an object so that the one a failed signature takes back is exactly the one it added.
   */
  private readonly bids = new Map<string, Set<{ total: number }>>();
  /** The sum, over sequence numbers, of the largest bid in `bids`. */
  private spent = 0;

  constructor(signer: Signer, options: FeeSponsorOptions) {
    assertTestnetPassphrase(options.networkPassphrase);
    const cap = options.maxBaseFeeStroops ?? DEFAULT_MAX_BASE_FEE;
    if (cap < MIN_BASE_FEE) {
      throw new DustinError(
        "CONFIG_INVALID",
        `The fee cap of ${cap} stroops per operation is below the network minimum of ${MIN_BASE_FEE}.`,
        { stage: "config" },
      );
    }
    this.signer = signer;
    this.publicKey = signer.publicKey();
    this.networkPassphrase = options.networkPassphrase;
    this.maxBaseFeeStroops = cap;
    this.budgetStroops = options.budgetStroops ?? DEFAULT_BUDGET_STROOPS;
  }

  /**
   * The most this close can cost the sponsor so far: for every sequence number, the largest bid
   * signed for it, or being signed. An inner sequence number is consumed once, at apply time, whatever envelope
   * carries it (https://developers.stellar.org/docs/build/guides/transactions/fee-bump-transactions#application),
   * so of all the envelopes signed for one sequence number at most one is ever charged; a rebuild
   * for the same sequence number with a higher bid (E2-S3) needs only the difference.
   */
  get spentBidStroops(): number {
    return this.spent;
  }

  /**
   * Forgets the bids signed for a sequence number that no envelope of this close can use any more:
   * another transaction consumed it and every envelope signed for it was refused at validation, so
   * none of them can ever be charged (edge case E7). Only the caller can know that; it must not
   * release a sequence number while an envelope for it may still apply or may have applied.
   */
  release(source: string, sequence: string): void {
    const key = `${source}:${sequence}`;
    this.spent -= this.largest(key);
    this.bids.delete(key);
  }

  /** What is left of the close budget for sequence numbers not signed for yet. */
  get remainingStroops(): number {
    return this.budgetStroops - this.spent;
  }

  /** The largest total bid (base fee x (operations + 1)) the budget still allows for a sequence number. */
  headroomStroops(source: string, sequence: string): number {
    return this.budgetStroops - this.spent + this.largest(`${source}:${sequence}`);
  }

  private largest(key: string): number {
    let most = 0;
    for (const bid of this.bids.get(key) ?? []) most = Math.max(most, bid.total);
    return most;
  }

  /** Counts `bid` for `key`: only by how much it raises the largest bid for that sequence number. */
  private reserve(key: string, bid: { total: number }): void {
    const before = this.largest(key);
    const bids = this.bids.get(key) ?? new Set();
    bids.add(bid);
    this.bids.set(key, bids);
    this.spent += this.largest(key) - before;
  }

  /** Takes back `bid`, if it is still counted (a `release` may have dropped it already). */
  private takeBack(key: string, bid: { total: number }): void {
    const bids = this.bids.get(key);
    if (!bids?.has(bid)) return;
    const before = this.largest(key);
    bids.delete(bid);
    if (bids.size === 0) this.bids.delete(key);
    this.spent -= before - this.largest(key);
  }

  async wrap(inner: Transaction, baseFeeStroops: number): Promise<FeeBumpTransaction> {
    if (inner.source === this.publicKey) {
      throw refused("the inner transaction is sourced by the sponsor itself");
    }
    for (const op of inner.operations) {
      if (op.source !== undefined && op.source !== inner.source) {
        throw refused(`operation ${op.type} acts for ${op.source}, not for the inner source`);
      }
    }
    const bid = Math.min(
      Math.max(MIN_BASE_FEE, Math.floor(baseFeeStroops)),
      this.maxBaseFeeStroops,
    );
    const total = bid * (inner.operations.length + 1);
    const key = `${inner.source}:${inner.sequence}`;
    const previous = this.largest(key);
    if (this.spent - previous + Math.max(previous, total) > this.budgetStroops) {
      throw new DustinError(
        "SPONSOR_BUDGET_EXCEEDED",
        `Signing this fee bump (bid ${total} stroops) would exceed the close budget of ${this.budgetStroops} stroops.`,
        {
          stage: "sponsor",
          remedy: "Raise the budget or wait for network fees to fall, then run the close again.",
        },
      );
    }
    const feeBump = TransactionBuilder.buildFeeBumpTransaction(
      this.publicKey,
      String(bid),
      inner,
      this.networkPassphrase,
    );
    // Blind review BH16: the bid is counted before the signer is awaited, so a wrap that starts
    // meanwhile sees it in the budget, and it is taken back if the signer throws.
    const reserved = { total };
    this.reserve(key, reserved);
    try {
      await this.signer.sign(feeBump);
    } catch (error) {
      this.takeBack(key, reserved);
      throw error;
    }
    return feeBump;
  }
}

function refused(detail: string): DustinError {
  return new DustinError("SPONSOR_REFUSED", `The fee sponsor refuses to sign: ${detail}.`, {
    stage: "sponsor",
  });
}
