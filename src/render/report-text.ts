import { formatStroops } from "../amounts.js";
import { DEFAULT_EXPLORER_BASE } from "../config/network.js";
import type { CloseReport, SubmittedTransaction } from "../execute/report.js";
import { destinationBaseAccount } from "../inspect/address.js";
import type { ClosePlan, CloseStep } from "../plan/model.js";
import { short, stepAction } from "./plan-text.js";

/**
 * Renders a close report as the receipt printed at the end of `dustin close --execute`: plain
 * ASCII, status as words, full addresses and hashes, at most 120 columns except for URLs
 * (docs/ux-design.md sections 2.5, 2.6 and 2.10; AC-E2-S4-2). The same data is the `--json` output.
 *
 * Facts the wording relies on: the fee account of a fee bump pays the fee instead of the inner
 * transaction's source (https://developers.stellar.org/docs/build/guides/transactions/fee-bump-transactions#fee-account);
 * an account merge removes the source account from the ledger
 * (https://developers.stellar.org/docs/learn/fundamentals/transactions/list-of-operations#account-merge),
 * after which Horizon answers 404 Not Found for it
 * (https://developers.stellar.org/docs/data/apis/horizon/api-reference/errors/error-handling#error-handling-for-queries).
 */

const WIDTH = 120;

export interface RenderReportOptions {
  /**
   * The plans the run executed (the executor's fresh plan and any re-plan); they describe the
   * operations of each transaction. Without them, steps are named by their id.
   */
  plans?: readonly ClosePlan[];
  /** Explorer base for the account links; default StellarExpert testnet. */
  explorerBaseUrl?: string;
}

/**
 * Wraps `text` at 120 columns. The first line starts with `first` (a label, or the indent), the
 * others with `indent` spaces. A single word longer than the room left (a URL) is never split.
 */
function wrap(text: string, indent: number, first?: string): string[] {
  const pad = " ".repeat(indent);
  const lines: string[] = [];
  let line = first ?? pad;
  let words = 0;
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const sep = line === "" || /\s$/.test(line) ? "" : " ";
    if (words > 0 && line.length + sep.length + word.length > WIDTH) {
      lines.push(line);
      line = pad + word;
    } else {
      line += sep + word;
    }
    words++;
  }
  if (words > 0) lines.push(line);
  return lines;
}

/** A labelled field: the label padded to 13 columns, the value wrapped under itself. */
function field(label: string, value: string): string[] {
  return wrap(value, 13, label.padEnd(13));
}

const grouped = (n: number) => n.toLocaleString("en-US");
const xlm = (stroops: number) => `${formatStroops(BigInt(stroops))} XLM`;

function headline(report: CloseReport): string {
  const submitted = report.transactions.length;
  switch (report.status) {
    case "closed":
      return report.verification?.accountExists === false
        ? "CLOSED: the account was merged and no longer exists"
        : "CLOSED: the merge was applied, but the account was not verified gone";
    case "partial":
      return "PARTIAL: everything possible was done; the account still exists";
    case "aborted":
      return submitted === 0
        ? "ABORTED: nothing was submitted"
        : `ABORTED: the run stopped after ${submitted} submitted transaction${submitted === 1 ? "" : "s"}`;
    case "failed":
      return "FAILED: the run stopped before the account was closed";
    default:
      return String(report.status).toUpperCase();
  }
}

const OUTCOME: Record<string, string> = {
  applied: "applied",
  failed: "failed on the ledger (the sponsor paid the fee)",
  rejected: "rejected before inclusion (nothing was charged)",
  unknown: "unknown: not found by hash after its time bound, so it can never apply",
  pending: "pending: the outcome was not known when the run stopped; look the hash up",
};

function resultCodes(tx: SubmittedTransaction): string | null {
  const c = tx.resultCodes;
  if (!c) return null;
  const codes = [c.transaction, c.innerTransaction, ...(c.operations ?? [])].filter(
    (x): x is string => typeof x === "string" && x.length > 0,
  );
  return codes.length > 0 ? codes.join(", ") : null;
}

function transactionLines(
  tx: SubmittedTransaction,
  report: CloseReport,
  steps: Map<string, CloseStep>,
): string[] {
  const extra = tx as SubmittedTransaction & { attempt?: unknown };
  const payer = tx.feeAccount === report.feeSponsor ? "the sponsor" : tx.feeAccount;
  const head = [
    `  tx ${tx.index + 1}`,
    tx.phase,
    typeof extra.attempt === "number" ? `attempt ${extra.attempt}` : "",
    OUTCOME[tx.result] ?? String(tx.result),
    tx.ledger !== null ? `ledger ${grouped(tx.ledger)}` : "",
    tx.feeChargedStroops !== null
      ? `fee ${xlm(tx.feeChargedStroops)} (${grouped(tx.feeChargedStroops)} stroops) charged to ${payer}`
      : "",
  ]
    .filter(Boolean)
    .join("  ");
  const lines = head.length <= WIDTH ? [head] : wrap(head.trimStart(), 8, "  ");
  lines.push(`        outer hash  ${tx.hash}`);
  lines.push(`        inner hash  ${tx.innerHash}`);
  // The full URL on its own line, so it can be clicked from a terminal (ux-design section 2.5).
  lines.push(`        ${tx.explorerUrl}`);
  tx.stepIds.forEach((id, i) => {
    const step = steps.get(id);
    const label = i === 0 ? "        operations  " : " ".repeat(20);
    lines.push(...wrap(step ? stepAction(step) : id, 20, label));
  });
  const codes = resultCodes(tx);
  if (codes) lines.push(...wrap(codes, 20, "        result      "));
  return lines;
}

const entryName = (entry: string) => entry.replace(/:G[A-Z2-7]{55}/g, "");

function destinationAccountUrl(explorer: string, destination: string): string {
  try {
    return `${explorer}/account/${destinationBaseAccount(destination)}`;
  } catch {
    return `${explorer}/account/${destination}`;
  }
}

export function renderReport(report: CloseReport, options: RenderReportOptions = {}): string {
  const explorer = options.explorerBaseUrl ?? DEFAULT_EXPLORER_BASE;
  const steps = new Map<string, CloseStep>();
  for (const plan of options.plans ?? []) for (const step of plan.steps) steps.set(step.id, step);
  const extra = report as CloseReport & { stopReason?: unknown };
  const out: string[] = [];

  out.push(`Dustin close receipt   ${headline(report)}`);
  if (report.message) out.push(...field("Why", report.message));
  if (typeof extra.stopReason === "string" && extra.stopReason !== report.message) {
    out.push(...field("Stopped", extra.stopReason));
  }
  out.push(...field("Network", `testnet, Horizon ${report.network.horizon}`));
  out.push(`Account      ${report.account}`);
  out.push(`Destination  ${report.destination}`);
  out.push(`Sponsor      ${report.feeSponsor}   paid every fee`);
  out.push(
    ...field(
      "Run",
      `started ${report.startedAt}` +
        (report.finishedAt ? `, finished ${report.finishedAt}` : ", not finished"),
    ),
  );
  out.push(`Plan hash    ${report.planHash}`);

  const n = report.transactions.length;
  out.push("");
  out.push(
    n === 0
      ? "Transactions (none submitted)"
      : `Transactions (${n} submitted; every fee was paid by the sponsor, the account paid nothing)`,
  );
  for (const tx of report.transactions) out.push(...transactionLines(tx, report, steps));

  const r = report.recovery;
  const merged = report.steps.some(
    (s) => s.status === "applied" && steps.get(s.stepId)?.kind === "merge",
  );
  const mergeApplied = r.mergedXlm !== null || merged || report.status === "closed";
  out.push("", "Result");
  if (r.mergedXlm !== null) {
    out.push(
      ...wrap(
        `${r.mergedXlm} XLM merged into the destination ${short(report.destination)} (read from the merge result)`,
        4,
        "  ",
      ),
    );
  } else if (mergeApplied) {
    out.push(
      ...wrap(
        "The merge was applied, but the merged amount is not in the transaction result; the explorer shows it on the merge transaction.",
        4,
        "  ",
      ),
    );
  } else {
    out.push(
      ...wrap("No merge: the account was not merged, so no XLM moved through a merge.", 4, "  "),
    );
  }
  for (const x of r.reservesReturnedToSponsors) {
    out.push(
      ...wrap(
        `${x.xlm} XLM reserve returned to sponsor ${short(x.sponsor)}, never this account's (${x.entries.map(entryName).join(", ")})`,
        4,
        "  ",
      ),
    );
  }
  out.push(`  0 XLM in fees paid by the account`);
  out.push(
    `  ${xlm(r.feesPaidBySponsorStroops)} (${grouped(r.feesPaidBySponsorStroops)} stroops) in fees paid by the sponsor`,
  );

  if (report.unclosable.length > 0 || (report.status !== "closed" && report.blockers.length > 0)) {
    out.push("", "Not closed (the account is not merged while these remain)");
    for (const item of report.unclosable) {
      out.push(`  ${item.code}`);
      out.push(...wrap(item.reason, 4), ...wrap(`remedy: ${item.remedy}`, 4));
    }
    for (const b of report.blockers) {
      out.push(`  ${b.code}${b.permanent ? " (permanent)" : ""}`);
      out.push(...wrap(b.reason, 4), ...wrap(`remedy: ${b.remedy}`, 4));
    }
  }
  if (report.warnings.length > 0) {
    out.push("", "Warnings");
    for (const w of report.warnings) out.push(...wrap(`- ${w}`, 4, "  "));
  }

  out.push("", "Verify it yourself");
  out.push(`  account      ${explorer}/account/${report.account}`);
  out.push(`  destination  ${destinationAccountUrl(explorer, report.destination)}`);
  const v = report.verification;
  if (v === null) {
    out.push(
      ...wrap("not checked: the run stopped before the final Horizon check", 15, "  verified     "),
    );
  } else {
    out.push(
      ...wrap(
        v.accountExists
          ? `account ${report.account} still exists on Horizon (${v.horizonStatus})`
          : `account ${report.account} no longer exists on Horizon (404)`,
        15,
        "  verified     ",
      ),
    );
    // A later executor may record the ledger of the check; render it when present.
    const ledger: unknown = Reflect.get(v, "ledger");
    const at = typeof ledger === "number" ? ` at ledger ${grouped(ledger)}` : "";
    out.push(`               checked ${v.checkedAt}${at}`);
  }

  const next = nextStep(report);
  if (next) out.push("", ...field("Next", next));
  return `${out.join("\n")}\n`;
}

function nextStep(report: CloseReport): string | null {
  switch (report.status) {
    case "closed":
      return report.verification?.accountExists === false
        ? null
        : "Check the account on the explorer; if it still exists, run the same command again.";
    case "partial":
      return "The account still exists. Resolve the items above, then run the same command again: Dustin re-reads the account and plans only what is left.";
    case "aborted":
      return report.transactions.length === 0
        ? "Nothing was submitted. Review the plan and run the command again."
        : "Run the same command again to continue: Dustin re-reads the account and plans only what is left.";
    default:
      return "Run the same command again to continue: Dustin re-reads the account and plans only what is left.";
  }
}
