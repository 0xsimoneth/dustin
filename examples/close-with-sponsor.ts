// Closes a Stellar testnet account with the stellar-dustin SDK, the way `dustin close --execute`
// does: plan (read-only), show the plan, ask for the destination's last four characters, then
// execute, with every fee paid by a sponsor that signs only the fee-bump envelopes.
//
//   DUSTIN_ACCOUNT_SECRET=S... DUSTIN_SPONSOR_SECRET=S... node close-with-sponsor.js <destination G...> \
//     [--partial] [--prefer-destination]
//
// (compiled with tsc, or run with any TypeScript runner). The two secrets come from this program's
// environment because it is an example; the SDK itself never reads the environment or `.env`.
// Testnet only: every entry point of the package refuses any other network. CI type-checks this
// file against the package's published types (`npm run typecheck:examples`, after the build).
import { createInterface } from "node:readline/promises";
import { Keypair } from "@stellar/stellar-sdk";
import {
  DustinError,
  executeClose,
  keypairSigner,
  planClose,
  remedyOf,
  renderPlan,
  renderReport,
  type CloseEvent,
  type CloseReport,
  type ClosePlan,
} from "stellar-dustin";

function keyFrom(name: "DUSTIN_ACCOUNT_SECRET" | "DUSTIN_SPONSOR_SECRET"): Keypair {
  const value = process.env[name];
  if (value === undefined || value === "") throw new Error(`${name} is not set`);
  return Keypair.fromSecret(value);
}

/** One line per event, as the run goes; the report carries the same facts in full. */
function describe(event: CloseEvent): string | null {
  switch (event.type) {
    case "plan":
      return `planned again before signing: ${event.plan.transactions.length} transaction(s)`;
    case "preflight":
      return `merge preflight ${event.ok ? "ok" : "failed"}: ${event.detail}`;
    case "tx:confirmed":
      return `tx ${event.index + 1} confirmed in ledger ${event.ledger}, the sponsor paid ${event.feeChargedStroops} stroops: ${event.hash}`;
    case "tx:failed":
      return `tx ${event.index + 1} failed (${event.result}): ${event.detail}`;
    case "verified":
      return event.accountExists ? "the account still exists" : "the account no longer exists";
    case "done":
      return `done: ${event.status}`;
    default:
      return null; // "drift", "wait", "tx:building" and "tx:submitted" are in the report too
  }
}

/** The CLI's exit codes for a finished run (docs/README.md, canonical decision 5). */
function exitCodeOf(report: CloseReport): number {
  switch (report.status) {
    case "closed":
      return 0;
    case "partial":
      return 4;
    case "aborted":
      return 3; // nothing was executed: a drift, or a refusal before signing
    default:
      return 5; // stopped after a submission: run it again to continue
  }
}

async function confirmed(plan: ClosePlan, destination: string): Promise<boolean> {
  console.log(renderPlan(plan));
  const prompt = createInterface({ input: process.stdin, output: process.stderr });
  try {
    const typed = await prompt.question(
      `Type the last 4 characters of the destination ${destination} to confirm: `,
    );
    return typed.trim() === destination.slice(-4);
  } finally {
    prompt.close();
  }
}

async function main(args: readonly string[]): Promise<number> {
  const destination = args.find((a) => !a.startsWith("--"));
  if (destination === undefined) {
    console.error(
      "usage: close-with-sponsor <destination G...> [--partial] [--prefer-destination]",
    );
    return 2;
  }
  // --prefer-destination tries the transfer to the destination before the return to the issuer
  // (a planning option); --partial runs the cleanup even when the merge cannot happen (an
  // execution option).
  const allowPartial = args.includes("--partial");
  const preferDestination = args.includes("--prefer-destination");
  const account = keyFrom("DUSTIN_ACCOUNT_SECRET");
  const sponsor = keyFrom("DUSTIN_SPONSOR_SECRET");

  try {
    // 1. Plan: GET requests to Horizon only; no key is used and nothing is signed.
    const plan = await planClose({
      account: account.publicKey(),
      destination,
      feeSponsor: sponsor.publicKey(),
      preferDestination,
    });
    if (plan.status === "blocked") {
      console.log(renderPlan(plan));
      console.error("The plan is blocked (its remedies are above); nothing was executed.");
      return 3;
    }
    if (plan.status === "partial" && !allowPartial) {
      console.log(renderPlan(plan));
      console.error("Some items cannot be disposed of; run with --partial to clean up the rest.");
      return 3;
    }

    // 2. Approve: the account holder reads the plan and types the destination's last four
    //    characters, as `dustin close --execute` asks.
    if (!(await confirmed(plan, destination))) {
      console.error("Not confirmed; nothing was executed.");
      return 3;
    }

    // 3. Execute: the account signs the inner transactions, the sponsor only the fee bumps. The
    //    executor plans again before signing and stops if the account changed; Ctrl-C stops the
    //    run at the next safe point and still returns the report.
    const stop = new AbortController();
    process.once("SIGINT", () => stop.abort("SIGINT"));
    const report = await executeClose(
      plan,
      { account: keypairSigner(account), feeSponsor: keypairSigner(sponsor) },
      {
        confirm: true,
        allowPartial,
        signal: stop.signal,
        onEvent: (event) => {
          const line = describe(event);
          if (line !== null) console.error(line);
        },
      },
    );
    console.log(renderReport(report, { plans: [plan] }));
    return exitCodeOf(report);
  } catch (error) {
    if (!(error instanceof DustinError)) throw error;
    // Every error of the package is a DustinError with a stable code (docs/errors.md).
    console.error(`${error.code}: ${error.message}`);
    console.error(remedyOf(error));
    if (error.report !== undefined) {
      console.error(
        `The report so far names ${error.report.transactions.length} transaction(s); keep it.`,
      );
    }
    switch (error.code) {
      case "HORIZON_UNAVAILABLE":
        return 6;
      case "SPONSOR_BUDGET_EXCEEDED":
      case "SPONSOR_UNDERFUNDED":
      case "CONFIRMATION_REQUIRED":
        return 3;
      case "INVALID_ADDRESS":
      case "CONTRACT_ACCOUNT":
      case "MAINNET_REFUSED":
      case "WRONG_SIGNER":
      case "CONFIG_INVALID":
        return 2;
      default:
        return error.report === undefined ? 1 : 5;
    }
  }
}

process.exitCode = await main(process.argv.slice(2));
