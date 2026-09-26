import { Account, Memo, TransactionBuilder, type Transaction } from "@stellar/stellar-sdk";
import { assertTestnetPassphrase } from "../config/network.js";
import { DustinError } from "../errors/dustin-error.js";
import type { OperationDescriptor } from "../plan/model.js";
import { MAX_OPERATIONS } from "../plan/grouping.js";
import { toOperation } from "./operations.js";

export interface InnerTransactionInput {
  /** The closing account: source of the transaction and of every operation. */
  account: string;
  /** The account's current sequence number; the transaction uses the next one. */
  sequence: string;
  operations: OperationDescriptor[];
  networkPassphrase: string;
  /** Upper time bound (Unix seconds), from Horizon's clock. */
  maxTime: number;
  memo?: string | null;
}

/**
 * The unsigned inner transaction. Its fee is 0: it is only ever submitted inside a fee bump, which
 * pays the whole fee (CAP-15; day-1 experiment 1). It always has an upper time bound, which makes
 * rebuilding for the same sequence number safe once the bound has passed (architecture 7.3).
 */
export function buildInnerTransaction(input: InnerTransactionInput): Transaction {
  assertTestnetPassphrase(input.networkPassphrase);
  if (input.operations.length === 0 || input.operations.length > MAX_OPERATIONS) {
    throw new DustinError(
      "TOO_MANY_OPERATIONS",
      `A transaction needs 1 to ${MAX_OPERATIONS} operations; got ${input.operations.length}.`,
      { stage: "build" },
    );
  }
  const builder = new TransactionBuilder(new Account(input.account, input.sequence), {
    fee: "0",
    networkPassphrase: input.networkPassphrase,
    timebounds: { minTime: 0, maxTime: input.maxTime },
    ...(input.memo ? { memo: Memo.text(input.memo) } : {}),
  });
  for (const op of input.operations) builder.addOperation(toOperation(op));
  return builder.build();
}
