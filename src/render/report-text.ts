import { formatStroops, toStroops } from "../amounts.js";
import { DEFAULT_EXPLORER_BASE } from "../config/network.js";
import {
  mayHaveApplied,
  type CloseReport,
  type SponsorObservation,
  type SponsorState,
  type SubmittedTransaction,
} from "../execute/report.js";
import { destinationBaseAccount } from "../inspect/address.js";
import type { ClosePlan, CloseStep, DisposalRung } from "../plan/model.js";
import { short, stepAction, unclosableLines } from "./plan-text.js";

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

function headline(report: CloseReport, appliedMerge: boolean): string {
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
    case "running":
      // Only a copy saved while the run was going (--report, onReport) carries this status.
      return "RUNNING: this copy was saved while the run was in progress; it is not the final report";
    case "failed":
      return appliedMerge || report.stop?.code === "ACCOUNT_STILL_EXISTS"
        ? "FAILED: the merge applied, but the account was not verified gone"
        : "FAILED: the run stopped before the account was closed";
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

/**
 * The label of an envelope whose outcome is not known, from what is known about it, so that it
 * never contradicts its meaning line (review round 3, R3-22; blind review BH-13): lookups that
 * failed are not "not found", and a used sequence number means it may have applied. Reports
 * written before `lookupError` and `sequenceUsed` existed are read from their explanation.
 */
function unknownLabel(tx: SubmittedTransaction): string {
  const meaning = tx.explanation ?? "";
  if (tx.lookupError !== undefined || /could not be (looked up|settled)/.test(meaning)) {
    const what = /could not be settled/.test(meaning)
      ? "its outcome could not be settled"
      : "it could not be looked up";
    return tx.mayStillApply
      ? `unknown: ${what}, and it may still apply until its time bound passes`
      : `unknown: ${what}, so whether it applied is not known`;
  }
  if (tx.sequenceUsed === true || /sequence number used/.test(meaning)) {
    return "unknown: not found by hash, but its sequence number is used, so it may have applied";
  }
  if (tx.mayStillApply) {
    return "unknown: not found yet, and it may still apply until its time bound passes";
  }
  return OUTCOME.unknown!;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function resultCodes(tx: Pick<SubmittedTransaction, "resultCodes">): string | null {
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
  const payer = tx.feeAccount === report.feeSponsor ? "the sponsor" : tx.feeAccount;
  const head = [
    `  tx ${tx.index + 1}`,
    tx.phase,
    // Round n is the n-th re-plan; its transactions are numbered from 1 again (E2-S3).
    tx.round > 0 ? `round ${tx.round}` : "",
    tx.attempt > 1 ? `attempt ${tx.attempt}` : "",
    tx.result === "unknown"
      ? unknownLabel(tx)
      : tx.result === "pending" && report.status === "running"
        ? "pending: posted, its outcome was not known yet when this copy was saved"
        : (OUTCOME[tx.result] ?? String(tx.result)),
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
  if (tx.explanation) lines.push(...wrap(tx.explanation, 20, "        meaning     "));
  if (tx.rebuiltBecause) lines.push(...wrap(tx.rebuiltBecause, 20, "        rebuilt     "));
  return lines;
}

const entryName = (entry: string) => entry.replace(/:G[A-Z2-7]{55}/g, "");

/** An envelope as the receipt numbers it: "tx 3", or "tx 1 of round 2" after a re-plan. */
const txName = (tx: SubmittedTransaction) =>
  `tx ${tx.index + 1}${tx.round > 0 ? ` of round ${tx.round}` : ""}`;

/** A rung as the subject of "the ... failed". */
const RUNG_ATTEMPT: Record<DisposalRung, string> = {
  path_payment: "sale by path payment",
  return_to_issuer: "return to its issuer",
  send_to_destination: "transfer to the destination",
};

/** The first code of a failure that is not a success: the operation's, else the transaction's. */
function firstCode(codes: SubmittedTransaction["resultCodes"]): string {
  const op = codes?.operations?.find((c) => c !== "op_success");
  return op ?? codes?.innerTransaction ?? codes?.transaction ?? "no result code";
}

/**
 * Every failure on the ledger of the disposal of one asset, in the order of the report: for each
 * envelope that failed on the disposal's operation, the rung it tried, from the plan of that
 * envelope's round, and the operation's code. The step outcome keeps only the last codes and the
 * rung of the plan the run started with, so a receipt built from it alone named the wrong rung
 * after a fall down the ladder (closing review CC-8).
 */
function disposalFailures(
  report: CloseReport,
  stepsOfRound: (round: number) => Map<string, CloseStep>,
  asset: { code: string; issuer: string },
): Array<{ rung: DisposalRung | undefined; code: string }> {
  const failures: Array<{ rung: DisposalRung | undefined; code: string }> = [];
  for (const tx of report.transactions) {
    if (tx.result !== "failed") continue;
    // The operations follow the transaction's steps; the first that is not a success failed.
    const ops = tx.resultCodes?.operations ?? [];
    const at = ops.findIndex((c) => c !== "op_success");
    if (at < 0) continue;
    const step = stepsOfRound(tx.round).get(tx.stepIds[at] ?? "");
    if (step?.kind !== "dispose_balance" || step.subject.type !== "trustline") continue;
    const { code, issuer } = step.subject.asset;
    if (code !== asset.code || issuer !== asset.issuer) continue;
    failures.push({ rung: step.disposal?.rung, code: ops[at]! });
  }
  return failures;
}

/** "the sale by path payment failed with X, then the return to its issuer failed with Y". */
function failedRungs(failures: Array<{ rung: DisposalRung | undefined; code: string }>): string {
  return failures
    .map((f) => `the ${f.rung ? RUNG_ATTEMPT[f.rung] : "disposal"} failed with ${f.code}`)
    .join(", then ");
}

/**
 * What became of each leftover balance (stories E3-S1 and E3-S2; PRD FR-12): sold for XLM, burned
 * by the return to its issuer (a payment to the issuer takes the asset out of circulation,
 * https://developers.stellar.org/docs/learn/fundamentals/stellar-data-structures/assets#deleting-or-burning-assets),
 * or sent to the destination, with the transaction and plan round it applied in; after a fall
 * down the ladder, each rung that failed and its code, as the failed envelopes and the plans of
 * their rounds show them (closing review CC-8). The steps come from the plans, so without them
 * this section is empty; so it is for a run that submitted nothing. `openMerge` is a merge
 * envelope whose fate is not known: a sale's XLM leaves with it if it applies (CC-10).
 */
function disposalLines(
  report: CloseReport,
  stepsOfRound: (round: number) => Map<string, CloseStep>,
  merged: boolean,
  openMerge: SubmittedTransaction | undefined,
): string[] {
  if (report.transactions.length === 0) return [];
  const lines: string[] = [];
  for (const outcome of report.steps) {
    // A step a re-plan added (onDrift "replan") is "R<round>.S<nn>", in the plan of that round.
    const added = /^R(\d+)\.(.+)$/.exec(outcome.stepId);
    const step = added
      ? stepsOfRound(Number(added[1])).get(added[2]!)
      : stepsOfRound(0).get(outcome.stepId);
    if (step?.kind !== "dispose_balance" || step.subject.type !== "trustline") continue;
    const { code, issuer } = step.subject.asset;
    const planned = step.disposal?.rung;
    // The rungs that failed, from the envelopes that failed and the plans of their rounds (CC-8).
    const failures = disposalFailures(report, stepsOfRound, step.subject.asset);
    let text: string;
    if (outcome.status === "applied") {
      const rung = outcome.rung ?? planned;
      const tx = report.transactions.find((t) => t.hash === outcome.txHash);
      const where = tx ? ` in ${txName(tx)}` : "";
      // No final word on the XLM while a merge envelope may still apply or may have applied
      // (closing review CC-10), nor in a copy saved while the run is going (CC-9).
      const xlmNow = merged
        ? "the XLM left with the merge"
        : openMerge
          ? `the XLM leaves with the merge if that envelope applies (${txName(openMerge)})`
          : report.status === "running"
            ? "the XLM is on the account while the run goes on"
            : "the XLM stays on the account";
      text =
        rung === "path_payment"
          ? `sold for XLM by path payment to the account itself${where}; ${xlmNow}`
          : rung === "return_to_issuer"
            ? `burned: returned to its issuer ${short(issuer)}${where}`
            : `sent to the destination ${short(report.destination)}${where}`;
      // The fall down the ladder names only rungs that failed, never the plan's first choice when
      // a re-plan moved the balance without a failure of it.
      const before = failures.filter((f) => f.rung !== rung);
      if (before.length > 0) text += `, after ${failedRungs(before)}`;
    } else if (outcome.status === "failed") {
      text =
        failures.length > 0
          ? `not disposed of: ${failedRungs(failures)}`
          : `not disposed of: the ${planned ? RUNG_ATTEMPT[planned] : "disposal"} failed with ${firstCode(outcome.resultCodes)}`;
    } else {
      text =
        report.status === "running"
          ? "not run yet"
          : "not disposed of: the run stopped before this step";
    }
    lines.push(...wrap(text, 4, `  ${code} ${step.subject.balance}  `));
  }
  return lines;
}

/**
 * "Reserves released to sponsors" on a line of its own (story E3-S3, AC-E3-S3-4; UX-DR2): the
 * reserves this run's removals returned to each reserve sponsor, as the plans attribute them, and
 * under each what Horizon showed for that sponsor before the first submission and after the final
 * check. Removing a sponsored entry moves no XLM: it lowers the sponsor's num_sponsoring, and so
 * its minimum balance
 * (https://developers.stellar.org/docs/build/guides/transactions/sponsored-reserves#effect-on-minimum-balance).
 * The executor attributes the reserves when the run ends, so a copy saved while the run is going
 * says so instead of "none" (closing review CC-9).
 */
function sponsorLines(report: CloseReport): string[] {
  const planned = report.recovery.reservesReturnedToSponsors;
  const observed = report.recovery.sponsorsObserved ?? [];
  const total = planned.reduce((sum, x) => sum + toStroops(x.xlm), 0n);
  const running = report.status === "running";
  const lines = wrap(
    planned.length > 0
      ? `Reserves released to sponsors: ${formatStroops(total)} XLM, never this account's`
      : running
        ? "Reserves released to sponsors: attributed when the run ends"
        : "Reserves released to sponsors: none",
    4,
    "  ",
  );
  const sponsors = new Set([...planned.map((x) => x.sponsor), ...observed.map((o) => o.sponsor)]);
  for (const sponsor of sponsors) {
    const x = planned.find((p) => p.sponsor === sponsor);
    lines.push(
      ...wrap(
        x
          ? `${x.xlm} XLM reserve returned to sponsor ${short(sponsor)}, never this account's (${x.entries.map(entryName).join(", ")})`
          : running
            ? `reserve of sponsor ${short(sponsor)}: attributed when the run ends`
            : `nothing returned to sponsor ${short(sponsor)} by this run`,
        6,
        "    ",
      ),
    );
    const o = observed.find((s) => s.sponsor === sponsor);
    if (o) lines.push(...wrap(observedText(o, running), 6, "      "));
  }
  return lines;
}

/**
 * What Horizon showed for one reserve sponsor before and after the run, in one sentence; in a copy
 * saved while the run is going, the reading after the run is not taken yet (CC-9).
 */
function observedText(o: SponsorObservation, running = false): string {
  const state = (s: SponsorState) =>
    `num_sponsoring ${s.numSponsoring}, minimum balance ${s.minimumBalance} XLM, XLM balance ${s.balance}`;
  const { before, after } = o;
  if (before && after) {
    const released = toStroops(before.minimumBalance) - toStroops(after.minimumBalance);
    const change = toStroops(after.balance) - toStroops(before.balance);
    const minimum =
      released > 0n
        ? `${formatStroops(released)} XLM released`
        : released === 0n
          ? "unchanged"
          : `${formatStroops(-released)} XLM more locked`;
    const balance =
      change === 0n
        ? "unchanged"
        : `${change > 0n ? "+" : "-"}${formatStroops(change > 0n ? change : -change)}`;
    return (
      `observed on Horizon: num_sponsoring ${before.numSponsoring} -> ${after.numSponsoring}, ` +
      `minimum balance ${before.minimumBalance} -> ${after.minimumBalance} XLM (${minimum}), ` +
      `XLM balance ${before.balance} -> ${after.balance} (${balance})`
    );
  }
  if (before) {
    return `observed on Horizon before the first submission: ${state(before)}; ${running ? "not read yet" : "not read after the run"}`;
  }
  if (after) {
    return `observed on Horizon after the run: ${state(after)}; not read before the first submission`;
  }
  return "not observed: Horizon could not be read (see the warnings)";
}

function destinationAccountUrl(explorer: string, destination: string): string {
  try {
    return `${explorer}/account/${destinationBaseAccount(destination)}`;
  } catch {
    return `${explorer}/account/${destination}`;
  }
}

export function renderReport(report: CloseReport, options: RenderReportOptions = {}): string {
  const explorer = options.explorerBaseUrl ?? DEFAULT_EXPLORER_BASE;
  // Step ids restart at S01 in every re-planned round, so each transaction is described with the
  // plan of its own round: round 0 is `report.planHash`, round n the n-th re-plan's hash (E2-S3).
  const byHash = new Map<string, ClosePlan>();
  for (const plan of options.plans ?? [])
    if (!byHash.has(plan.planHash)) byHash.set(plan.planHash, plan);
  const stepsOfRound = (round: number): Map<string, CloseStep> => {
    const hash =
      round === 0
        ? report.planHash
        : (report.replans ?? []).find((r) => r.round === round)?.planHash;
    const plan = hash === undefined ? undefined : byHash.get(hash);
    return new Map((plan?.steps ?? []).map((step) => [step.id, step]));
  };
  const steps = stepsOfRound(0);
  const out: string[] = [];
  // A merge that applied, whether or not its result gave the merged amount (review round 3,
  // R3-36): its step outcome, or an applied envelope that carried it. Without the plans only an
  // envelope of the merge phase tells.
  const isMerge = (round: number, id: string) => stepsOfRound(round).get(id)?.kind === "merge";
  const appliedMerge =
    report.recovery.mergedXlm !== null ||
    report.steps.some((s) => {
      const added = /^R(\d+)\.(.+)$/.exec(s.stepId);
      return (
        s.status === "applied" &&
        (added ? isMerge(Number(added[1]), added[2]!) : isMerge(0, s.stepId))
      );
    }) ||
    report.transactions.some(
      (t) =>
        t.result === "applied" &&
        (t.phase === "merge" || t.stepIds.some((id) => isMerge(t.round, id))),
    );

  out.push(`Dustin close receipt   ${headline(report, appliedMerge)}`);
  if (report.message) out.push(...field("Why", report.message));
  // The machine-readable stop reason (E2-S3): integrators branch on the code and the verdict.
  if (report.stop) {
    out.push(
      ...field(
        "Stop code",
        `${report.stop.code} (stage ${report.stop.stage}, next: ${report.stop.verdict})` +
          (report.stop.detail && report.stop.detail !== report.message
            ? `: ${report.stop.detail}`
            : ""),
      ),
    );
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
  for (const tx of report.transactions) {
    out.push(...transactionLines(tx, report, tx.round > 0 ? stepsOfRound(tx.round) : steps));
  }
  const replans = report.replans ?? [];
  if (replans.length > 0) {
    out.push("", `Re-plans (${replans.length}; the ledger was read again after a failure)`);
    for (const r of replans) {
      const codes = resultCodes({ resultCodes: r.trigger.resultCodes });
      out.push(
        ...wrap(
          `round ${r.round} after tx ${r.trigger.txIndex + 1} of round ${r.trigger.round} failed` +
            (codes ? ` (${codes})` : "") +
            `: ${r.trigger.explanation}` +
            (r.demoted.length > 0
              ? ` No more path payments for ${r.demoted.map(entryName).join(", ")}.`
              : "") +
            ` ${plural(r.transactions, "transaction", "transactions")} left.`,
          4,
          "  ",
        ),
      );
    }
  }

  const r = report.recovery;
  const merged = report.steps.some(
    (s) => s.status === "applied" && steps.get(s.stepId)?.kind === "merge",
  );
  const mergeApplied = r.mergedXlm !== null || merged || appliedMerge || report.status === "closed";
  // Without an applied merge, the last merge envelope whose fate is open (`mayHaveApplied`, the
  // executor's own rule since closing review CX-1): the account's XLM goes with it if it applies
  // (CC-10).
  const openMerge = mergeApplied
    ? undefined
    : report.transactions
        .filter(
          (t) =>
            mayHaveApplied(t) &&
            (t.phase === "merge" || t.stepIds.some((id) => isMerge(t.round, id))),
        )
        .at(-1);
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
  } else if (openMerge) {
    out.push(
      ...wrap(
        `The merge (${txName(openMerge)}) has no known outcome: if it applies, or applied, the account's XLM goes to the destination with it; look its hash up on the explorer.`,
        4,
        "  ",
      ),
    );
  } else {
    out.push(
      ...wrap("No merge: the account was not merged, so no XLM moved through a merge.", 4, "  "),
    );
  }
  out.push(...sponsorLines(report));
  out.push(`  0 XLM in fees paid by the account`);
  out.push(
    `  ${xlm(r.feesPaidBySponsorStroops)} (${grouped(r.feesPaidBySponsorStroops)} stroops) in fees paid by the sponsor`,
  );

  const disposals = disposalLines(report, stepsOfRound, mergeApplied, openMerge);
  if (disposals.length > 0) {
    out.push("", "Disposals (what became of each leftover balance)", ...disposals);
  }

  if (report.unclosable.length > 0 || (report.status !== "closed" && report.blockers.length > 0)) {
    out.push("", "Not closed (the account is not merged while these remain)");
    for (const item of report.unclosable) out.push(...unclosableLines(item, 4));
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
      ...wrap(
        report.status === "running"
          ? "not checked yet: the run was still in progress when this copy was saved"
          : "not checked: the run stopped before the final Horizon check",
        15,
        "  verified     ",
      ),
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
  // Review finding AA-13: a run after a completed close found the account gone (Horizon 404) and
  // submitted nothing; running it again would change nothing.
  if (
    report.stop?.code === "ACCOUNT_MISSING" &&
    report.verification?.accountExists === false &&
    report.transactions.length === 0
  ) {
    return "If an earlier run merged the account, the close is complete: the account link above shows the merge as its last operation. Otherwise check the address; there is nothing to close.";
  }
  // Story E3-S4: a run the sequence guard stopped before the merge says when to come back.
  const until = report.stop?.code === "SEQNUM_TOO_FAR" ? report.stop.unblocksAtLedger : undefined;
  if (until !== undefined && report.status !== "closed") {
    return `The sequence guard holds the merge until ledger ${grouped(until)} (ACCOUNT_MERGE_SEQNUM_TOO_FAR). Run the same command again at or after that ledger: Dustin re-reads the account and plans only what is left.`;
  }
  switch (report.status) {
    case "closed":
      return report.verification?.accountExists === false
        ? null
        : "Check the account on the explorer; if it still exists, run the same command again.";
    case "partial":
      // A plan whose guard was beyond the bound ran its cleanup only; its blocker names the ledger.
      if (
        report.unclosable.length === 0 &&
        report.blockers.length > 0 &&
        report.blockers.every((b) => b.code === "SEQNUM_TOO_FAR")
      ) {
        return "The account still exists: the sequence guard holds the merge (SEQNUM_TOO_FAR above). Run the same command again once that ledger has closed: Dustin re-reads the account and merges it.";
      }
      return "The account still exists. Resolve the items above, then run the same command again: Dustin re-reads the account and plans only what is left.";
    case "aborted":
      return report.transactions.length === 0
        ? "Nothing was submitted. Review the plan and run the command again."
        : "Run the same command again to continue: Dustin re-reads the account and plans only what is left.";
    case "running":
      // A copy saved while the run was going (review round 3, R3-23): a second close of the same
      // account started while it may still run would compete for its sequence numbers.
      return "This copy was saved while the run was in progress. Do not start the same close again while that run may still be going: two runs would compete for the account's sequence numbers. If it is gone (the process was killed or crashed), look the pending hashes above up first, then run the same command again: Dustin re-reads the account and plans only what is left.";
    default:
      return "Run the same command again to continue: Dustin re-reads the account and plans only what is left.";
  }
}
