import {
  horizonSubmitter,
  submitAndConfirm,
  type SubmitOutcome,
} from "../../src/execute/submit.js";
import type { OperationDescriptor } from "../../src/plan/model.js";
import { hashHex } from "../../src/sponsor/fee-bump.js";
import { FeeSponsor } from "../../src/sponsor/sponsor.js";
import { buildInnerTransaction } from "../../src/tx/build-inner.js";
import type { FakeLedger } from "./fake-ledger.js";
import { TESTNET_HORIZON } from "./recorded-horizon.js";

const TESTNET = "Test SDF Network ; September 2015";

/**
 * Submits operations to a fake ledger the way Dustin does, outside any plan: an inner transaction
 * from `source` with fee 0, wrapped in a fee bump paid by `sponsor`. The fake ledger does not
 * check signatures, so no key is involved. For negative controls: a transaction the planner would
 * never build, applied with the ledger's rules and result codes.
 */
export async function submitToFakeLedger(
  ledger: FakeLedger,
  input: { source: string; sponsor: string; operations: OperationDescriptor[] },
): Promise<SubmitOutcome> {
  const account = ledger.accounts.get(input.source);
  if (!account) throw new Error(`fake ledger: no account ${input.source}`);
  const maxTime = Math.floor(Date.now() / 1000) + 120;
  const inner = buildInnerTransaction({
    account: input.source,
    sequence: account.sequence,
    operations: input.operations,
    networkPassphrase: TESTNET,
    maxTime,
  });
  const sponsor = new FeeSponsor(
    { publicKey: () => input.sponsor, sign: () => undefined },
    { networkPassphrase: TESTNET },
  );
  const bump = await sponsor.wrap(inner, 100);
  return submitAndConfirm(
    horizonSubmitter(TESTNET_HORIZON, { fetch: ledger.fetch }),
    { xdr: bump.toXDR(), hash: hashHex(bump), maxTime },
    { pollIntervalMs: 0 },
  );
}
