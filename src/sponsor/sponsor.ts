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
  /** The largest total bid signed for each inner source and sequence number. */
  private readonly largestBid = new Map<string, number>();
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
   * signed for it. An inner sequence number is consumed once, at apply time, whatever envelope
   * carries it (https://developers.stellar.org/docs/build/guides/transactions/fee-bump-transactions#application),
   * so of all the envelopes signed for one sequence number at most one is ever charged; a rebuild
   * for the same sequence number with a higher bid (E2-S3) needs only the difference.
   */
  get spentBidStroops(): number {
    return this.spent;
  }

  /** The largest total bid (base fee x (operations + 1)) the budget still allows for a sequence number. */
  headroomStroops(source: string, sequence: string): number {
    return this.budgetStroops - this.spent + (this.largestBid.get(`${source}:${sequence}`) ?? 0);
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
    const previous = this.largestBid.get(key) ?? 0;
    const spentAfter = this.spent - previous + Math.max(previous, total);
    if (spentAfter > this.budgetStroops) {
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
    await this.signer.sign(feeBump);
    this.largestBid.set(key, Math.max(previous, total));
    this.spent = spentAfter;
    return feeBump;
  }
}

function refused(detail: string): DustinError {
  return new DustinError("SPONSOR_REFUSED", `The fee sponsor refuses to sign: ${detail}.`, {
    stage: "sponsor",
  });
}
