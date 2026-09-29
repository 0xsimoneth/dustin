import {
  accessSync,
  constants,
  existsSync,
  mkdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { randomBytes } from "node:crypto";
import { basename, dirname, join } from "node:path";
import { formatStroops } from "../../amounts.js";
import { verifyHorizonIsTestnet, type ResolvedConfig } from "../../config/network.js";
import type { Sleep } from "../../config/pauses.js";
import { DustinError } from "../../errors/dustin-error.js";
import { redact, redactValue } from "../../errors/redact.js";
import { executeClose, recoveredXlmWords, type CloseEvent } from "../../execute/executor.js";
import type { CloseReport } from "../../execute/report.js";
import { horizonSubmitter } from "../../execute/submit.js";
import { reserveFromHorizon } from "../../inspect/reserve.js";
import { SECONDS_PER_LEDGER } from "../../plan/guard.js";
import type { ClosePlan, CloseStep } from "../../plan/model.js";
import { planClose } from "../../plan/plan-close.js";
import { horizonJson } from "../../reader/horizon-json.js";
import { horizonReader, type LedgerReader } from "../../reader/ledger-reader.js";
import { renderPlan, short, unclosableLines } from "../../render/plan-text.js";
import { nextStep, renderReport } from "../../render/report-text.js";
import { textOf, type Channel } from "../channel.js";
import { ExitCode, exitCodeForReport } from "../exit-codes.js";
import {
  askCloseSigners,
  loadCloseSigners,
  type CloseSigners,
  type SecretPrompt,
  type SecretSources,
} from "../secrets.js";
import type { CommandContext } from "./fixture.js";
import { checkAddresses, destinationOf, parseBaseFee, type PlanCommandOptions } from "./plan.js";

/**
 * Where the facts that the typed confirmation confirms (the plan and the summary) were printed.
 * Since story E4-S1 the question is never asked with --json (review finding AA-10), so they are
 * always on standard output; the field stays for prompts written against it.
 */
export interface PromptContext {
  facts: "stdout" | "stderr";
}

/**
 * Asks one question. Resolves with the answer; with null at the end of input (Ctrl-D) or on
 * Ctrl-C; or with `{ unasked }`, naming why it could not be asked at all, for example a stream that
 * is not a terminal (review round 3, R3-28, R3-31). Anything but the right answer is no
 * confirmation.
 */
export type Prompt = (
  question: string,
  context?: PromptContext,
) => Promise<string | null | { unasked: string }>;

/** The two process signals `close --execute` handles while the executor runs (review CL-1). */
export type HandledSignal = "SIGINT" | "SIGTERM";

/**
 * Where the process signals come from: `process` in the binary, a fake in tests. `on` adds a
 * listener and `off` removes it (https://nodejs.org/api/process.html#signal-events: with a listener
 * installed, SIGINT and SIGTERM no longer end the process by default).
 */
export interface SignalSource {
  on(signal: HandledSignal, listener: () => void): unknown;
  off(signal: HandledSignal, listener: () => void): unknown;
}

export interface CloseCommandOptions extends PlanCommandOptions {
  execute?: boolean;
  yes?: boolean;
  partial?: boolean;
  report?: string;
}

export interface CloseContext extends CommandContext {
  /** Every line the command prints, for people or, with --json, as NDJSON (review AA-10). */
  out: Channel;
  /** Where the two secrets come from: the environment, then `.env` in the working directory. */
  secrets: SecretSources;
  /** The typed confirmation; without it the input counts as non-interactive. */
  prompt?: Prompt;
  /**
   * The hidden prompt for a secret that neither the environment nor `.env` holds (review finding
   * CA-18, PRD decision D-11); never used with --json. Without it a missing secret is refused.
   */
  secretPrompt?: SecretPrompt;
  /**
   * SIGINT and SIGTERM while the executor runs (review finding CL-1): the first stops the run at
   * the next safe point, the second exits at once through `exit`. Without it no handler is added.
   */
  signals?: SignalSource;
  /** Ends the process at once with this code (`process.exit` in the binary; a second signal). */
  exit?: (code: number) => void;
  /**
   * Executor overrides (tests): the pause function, so a test never waits real time (pauses are at
   * least 200 ms, src/config/pauses.ts), or the executor itself.
   */
  execute?: { sleep?: Sleep; executeClose?: typeof executeClose };
}

const EXECUTION_HEADING =
  "Dustin plan  (re-read for execution: nothing is signed before you confirm)";

const grouped = (n: number) => n.toLocaleString("en-US");
const xlm = (stroops: number | bigint) => `${formatStroops(BigInt(stroops))} XLM`;
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * `dustin close <G> --to <G> --execute` (docs/README.md canonical decisions 4 and 5; story E2-S4).
 * Order: local checks, the two secrets (environment first, then `.env`), the network check, a
 * fresh plan shown again, refusals (nothing to do, unclosable without --partial, over budget,
 * underfunded sponsor), the typed confirmation or --yes, then the executor with streamed progress
 * and the receipt. Human text goes to standard output. With --json the run is non-interactive and
 * machine-readable (review finding AA-10): standard output carries one JSON document, the final
 * report, or the plan when the run was refused or failed before the executor had a report
 * (closing review CC-2), and standard error carries NDJSON only. Every line printed here passes
 * through redact(); no secret is ever read into anything but the two signers.
 */
export async function closeExecute(
  account: string,
  options: CloseCommandOptions,
  ctx: CloseContext,
): Promise<ExitCode> {
  const { out } = ctx;
  const destination = destinationOf(options);
  checkAddresses(account, destination);
  const baseFee = parseBaseFee(options.baseFee);

  // Canonical decision 4: the environment, then `.env`, then a hidden prompt in a terminal (review
  // finding CA-18, PRD decision D-11). Machine mode never asks (review finding AA-10).
  const signers = options.json
    ? loadCloseSigners(account, ctx.secrets)
    : await askCloseSigners(account, ctx.secrets, ctx.secretPrompt);
  const sponsor = signers.feeSponsor.publicKey();
  if (options.sponsor !== undefined && options.sponsor !== sponsor) {
    throw new DustinError(
      "WRONG_SIGNER",
      `--sponsor names ${options.sponsor}, but DUSTIN_SPONSOR_SECRET belongs to ${sponsor}.`,
      {
        stage: "config",
        remedy:
          "Leave --sponsor out (the sponsor is the owner of DUSTIN_SPONSOR_SECRET) or fix it.",
      },
    );
  }

  const config = ctx.config();
  await verifyHorizonIsTestnet(config.horizonUrl, ctx.fetch);
  const reader = horizonReader(
    horizonJson(config.horizonUrl, { ...(ctx.fetch ? { fetch: ctx.fetch } : {}), ...ctx.horizon }),
  );
  const plan = await planClose(
    {
      account,
      destination,
      feeSponsor: sponsor,
      ...(options.memo ? { memo: options.memo } : {}),
      ...(options.preferDestination ? { preferDestination: true } : {}),
      ...(baseFee !== undefined ? { baseFeeStroops: baseFee } : {}),
    },
    { config, reader },
  );
  out.say(renderPlan(plan, { heading: EXECUTION_HEADING }));

  // With --json, standard output carries exactly one JSON document once the plan was shown: the
  // close report once the executor has one, and otherwise the plan (kind "dustin-close-plan") that
  // was refused or could not run, whatever stopped it: a refusal, the confirmation, the --report
  // check, a failed read, or an executor that failed before its first copy (review round 3, R3-27;
  // closing review CC-2). The exit code stays the one of the refusal or the error.
  let printed = false;
  const document = (value: ClosePlan | CloseReport) => {
    if (!options.json || printed) return;
    printed = true;
    ctx.io.stdout(`${json(value)}\n`);
  };
  try {
    return await executeShownPlan({
      account,
      destination,
      baseFee,
      signers,
      sponsor,
      config,
      reader,
      plan,
      options,
      ctx,
      out,
      document,
    });
  } catch (error) {
    document(plan);
    throw error;
  }
}

/** What `close --execute` holds once the plan was shown, for the rest of the command. */
interface ShownPlan {
  account: string;
  destination: string;
  baseFee: number | undefined;
  signers: CloseSigners;
  sponsor: string;
  config: ResolvedConfig;
  reader: LedgerReader;
  plan: ClosePlan;
  options: CloseCommandOptions;
  ctx: CloseContext;
  out: Channel;
  /** Prints the one JSON document of --json on standard output; later calls print nothing. */
  document: (value: ClosePlan | CloseReport) => void;
}

/**
 * The rest of `close --execute` once the plan was shown: the refusals, the typed confirmation or
 * --yes, then the executor with streamed progress and the receipt. An error thrown from here
 * before the executor has a report gets the plan printed by the caller (closing review CC-2).
 */
async function executeShownPlan(shown: ShownPlan): Promise<ExitCode> {
  const { account, destination, baseFee, sponsor, reader, plan } = shown;
  const { options, ctx, out, document } = shown;
  // A refusal before anything is signed: the words for people on standard output, or with --json
  // an `error` line and the refused plan as the stdout document; exit 3 (canonical decision 5).
  const refusedWith = (text: string, code: string, message: string, remedy: string) => {
    out.say(text);
    if (out.mode.json) out.fail({ code, message, remedy, exitCode: ExitCode.NOTHING_EXECUTED });
    document(plan);
    return ExitCode.NOTHING_EXECUTED;
  };
  if (plan.blockers.some((b) => b.code === "ACCOUNT_MISSING")) {
    // Review finding AA-13: a run after a completed close. Horizon answers 404 for the account, so
    // there is nothing to sign and nothing to confirm; the executor records the 404 in the report
    // as it does for an SDK caller (PRD FR-17), and the receipt, --report and --json carry it. The
    // exit code stays 3, nothing executed (canonical decision 5). The executor plans again before
    // anything else, and a plan that differs from this one (the account came back) is drift, so
    // nothing can be signed on this path.
    const receipt = options.report !== undefined ? receiptFile(options.report, ctx) : null;
    out.say(
      "\nThe account does not exist on the testnet ledger: nothing is signed, and Horizon's 404 is recorded in the report.\n",
    );
    return runExecutor(shown, receipt, null);
  }
  if (plan.transactions.length === 0) {
    return refusedWith(
      "\nNothing to execute: the plan has no step to run (see the blockers above). Nothing was signed or submitted.\n",
      "NOTHING_TO_EXECUTE",
      "Nothing to execute: the plan has no step to run. Nothing was signed or submitted.",
      "Resolve the blockers of the plan, then run the command again.",
    );
  }
  if (plan.status !== "closable" && !options.partial) {
    return refusedWith(
      notClosable(plan),
      "PLAN_NOT_CLOSABLE",
      `Not executed: the plan cannot end in a merge (status ${plan.status.toUpperCase()}), so nothing was signed or submitted.`,
      "Resolve the plan's unclosable items and blockers, or add --partial to run everything else; the account is not merged then.",
    );
  }
  // The two sponsor and budget refusals below are errors (exit 3 by code, canonical decision 5);
  // with --json the caller prints the refused plan for them, as for every error here (review
  // round 3, R3-27; closing review CC-2).
  if (!plan.fees.withinBudget) {
    throw new DustinError(
      "SPONSOR_BUDGET_EXCEEDED",
      `The plan bids up to ${xlm(plan.fees.totalStroops)} in fees, more than the sponsor's close budget of ${xlm(plan.fees.budgetStroops)}; nothing was signed.`,
      {
        stage: "sponsor",
        remedy: "Wait for network fees to fall, or lower the bid with --base-fee, then run again.",
      },
    );
  }
  const spendable = await sponsorSpendable(reader, sponsor);
  if (spendable < BigInt(plan.fees.budgetStroops)) {
    throw new DustinError(
      "SPONSOR_UNDERFUNDED",
      spendable < 0n
        ? `The fee sponsor ${sponsor} does not exist.`
        : `The fee sponsor ${sponsor} can spend ${xlm(spendable)}, less than the close budget of ${xlm(plan.fees.budgetStroops)}.`,
      {
        stage: "sponsor",
        remedy: "Fund the fee sponsor (on testnet, from Friendbot) and run the close again.",
      },
    );
  }

  // The report file is checked (and its directory created) before the confirmation.
  const receipt = options.report !== undefined ? receiptFile(options.report, ctx) : null;
  out.say(summary(plan, spendable, baseFee));
  if (options.yes) {
    out.say(
      "\nCONFIRMATION SKIPPED: --yes was given, so the typed confirmation was not asked. Executing now.\n",
    );
    if (options.json) {
      out.notice("CONFIRMATION SKIPPED: --yes was given, so the typed confirmation was not asked.");
    }
  } else if (options.json) {
    // Review finding AA-10: --json is machine mode, so nothing is ever asked; without --yes the
    // run is refused before anything is signed (docs/ux-design.md section 2.8).
    throw new DustinError(
      "CONFIRMATION_REQUIRED",
      "--json makes the run non-interactive, so the typed confirmation was not asked; nothing was executed.",
      {
        stage: "config",
        remedy:
          "Add --yes to run it without the typed confirmation, or leave --json out to confirm in a terminal.",
      },
    );
  } else {
    await confirm(destination, ctx.prompt);
  }
  return runExecutor(
    shown,
    receipt,
    `\nClosing ${account} on testnet.\nEvery fee is paid by the sponsor ${sponsor}; the account pays nothing.\n`,
  );
}

/**
 * Runs the executor on the plan shown, with streamed progress, the --report copies and the receipt,
 * and returns the exit code. `opening` is printed first when given.
 *
 * SIGINT and SIGTERM (review finding CL-1; https://nodejs.org/api/process.html#signal-events): the
 * handlers are added before the executor starts and removed when it ends, so Ctrl-C at the typed
 * confirmation stays the prompt's "declined" (exit 3). The first signal aborts the executor's
 * `signal`: it stops at the next safe point, posts nothing new, and returns its report, which is
 * printed and kept as after any stop; the exit code follows the report (3 when nothing was
 * submitted, 5 otherwise, 0 if the close had already completed). A second signal writes the latest
 * copy of the report to --report synchronously and exits 5 at once.
 */
async function runExecutor(
  shown: ShownPlan,
  receipt: ReceiptFile | null,
  opening: string | null,
): Promise<ExitCode> {
  const { account, baseFee, signers, config, reader, plan } = shown;
  const { options, ctx, out, document } = shown;
  const plans: ClosePlan[] = [plan];
  // The receipt describes each transaction with the plan of its round. The executor's fresh plan
  // can share the hash of the plan shown and still differ from it (a better quote, or the sequence
  // guard's regrouping of the merge, review finding CA-11), so the plans the executor ran come
  // first and the plan shown is only the fallback.
  const receiptPlans = () => [...plans.slice(1), plans[0]!];
  let latest: CloseReport | null = null;
  let submitted = false;
  const progress = progressPrinter(out, plans, account, () => submitted);
  const execute = ctx.execute?.executeClose ?? executeClose;

  const controller = new AbortController();
  let signalled = 0;
  const onSignal = (name: HandledSignal) => () => {
    signalled += 1;
    if (signalled === 1) {
      controller.abort(name);
      out.notice(
        `${name} received: the run stops at the next safe point. No new transaction is submitted; one already posted is settled or recorded as unknown, then the receipt is printed. Send it again to exit at once; the latest copy of the report is saved first.`,
      );
      return;
    }
    // The second signal: the report as it stands, then out at once (exit 5).
    if (receipt && latest) receipt.write(forcedCopy(latest, name));
    out.notice(
      `${name} received again: exiting now with code 5, before the run finished.${receipt ? ` The latest copy of the report is in ${receipt.path}; its status "running" says it is not final.` : ""} Look up the hashes printed above, then run the same command again: Dustin re-reads the account and plans only what is left.`,
    );
    ctx.exit?.(ExitCode.STOPPED);
  };
  const handlers: Record<HandledSignal, () => void> = {
    SIGINT: onSignal("SIGINT"),
    SIGTERM: onSignal("SIGTERM"),
  };
  for (const name of ["SIGINT", "SIGTERM"] as const) ctx.signals?.on(name, handlers[name]);
  try {
    if (opening !== null) out.say(opening);
    let report: CloseReport;
    try {
      report = await execute(plan, signers, {
        confirm: true,
        allowPartial: options.partial === true,
        config: {
          horizonUrl: config.horizonUrl,
          networkPassphrase: config.networkPassphrase,
          explorerBaseUrl: config.explorerBaseUrl,
        },
        reader,
        submitter: horizonSubmitter(config.horizonUrl, ctx.fetch ? { fetch: ctx.fetch } : {}),
        // --base-fee is recorded in the plan as an override, which every re-plan keeps (review
        // R12); as the cap it also stops fee escalation from bidding above what the plan showed.
        ...(baseFee !== undefined ? { maxBaseFeeStroops: baseFee } : {}),
        ...(ctx.execute?.sleep ? { sleep: ctx.execute.sleep } : {}),
        signal: controller.signal,
        onEvent: (event) => {
          const fresh = planOf(event);
          if (fresh) plans.push(fresh);
          if (event.type === "tx:submitted") submitted = true;
          out.event(event);
          progress(event);
        },
        onReport: (copy) => {
          latest = copy;
          if (copy.transactions.length > 0) submitted = true;
          receipt?.write(copy);
        },
      });
    } catch (error) {
      const attached = error instanceof DustinError ? error.report : undefined;
      const known = attached ?? latest;
      if (!submitted && (known?.transactions.length ?? 0) === 0) {
        // Nothing reached the network: the error's code decides (6 for an unreachable Horizon).
        // Without a report from the executor, the caller prints the plan (closing review CC-2).
        if (known) {
          const refused = refusedReport(known, error);
          receipt?.write(refused);
          document(refused);
        }
        throw error;
      }
      // Something was submitted: never lose a hash (PRD NFR-03). The run stopped: exit 5.
      const stopped = stoppedReport(known, error, account);
      receipt?.write(stopped);
      out.error(error, ExitCode.STOPPED);
      document(stopped);
      out.say(
        `\n${renderReport(stopped, { plans: receiptPlans(), explorerBaseUrl: config.explorerBaseUrl })}`,
      );
      if (receipt) receiptLine(receipt, out);
      return ExitCode.STOPPED;
    }

    receipt?.write(report);
    const code = exitCodeForReport(report);
    document(report);
    out.say(
      `\n${renderReport(report, { plans: receiptPlans(), explorerBaseUrl: config.explorerBaseUrl })}`,
    );
    if (receipt) receiptLine(receipt, out);
    if (report.status === "closed" && code !== ExitCode.OK) {
      out.notice(
        "the merge was reported applied, but the account was not verified gone on Horizon; check it on the explorer and run the same command again.",
      );
    }
    // With --json, a run that ends with a stop says so in a last `error` line (review AA-10).
    if (options.json && report.stop !== null && code !== ExitCode.OK) {
      out.fail({
        code: report.stop.code,
        message: report.stop.detail,
        remedy: nextStep(report),
        exitCode: code,
      });
    }
    return code;
  } finally {
    for (const name of ["SIGINT", "SIGTERM"] as const) ctx.signals?.off(name, handlers[name]);
  }
}

/**
 * The copy of the report a second signal leaves in --report (review finding CL-1): the latest copy
 * the executor published, still `running`, with a warning that the CLI exited before the run
 * finished, so no reader takes it for a final report.
 */
function forcedCopy(latest: CloseReport, signal: HandledSignal): CloseReport {
  const copy = structuredClone(latest);
  copy.warnings.push(
    `A second ${signal} made the CLI exit before the run finished; this copy was saved while the run was in progress, so it is not the final report. Look up its pending hashes before running the close again.`,
  );
  return copy;
}

/**
 * The last line about the --report file: written; not written at the end but holding an earlier
 * copy of this run's report (review round 3, R3-30); or never written, in which case the receipt
 * is all there is. For people it follows the receipt on standard output; with --json it is a
 * `notice` line.
 */
function receiptLine(receipt: { path: string; ok: boolean; written: boolean }, out: Channel): void {
  const printed = out.mode.json
    ? "the report printed on standard output"
    : "the receipt printed here";
  const text = receipt.ok
    ? `Report written to ${receipt.path}`
    : receipt.written
      ? `Report NOT fully written to ${receipt.path} (see the warning above): the file holds an earlier copy of this run's report, saved while it was in progress; ${printed} is the complete record.`
      : `Report NOT written to ${receipt.path} (see the warning above); ${printed} is the only record of this run's hashes.`;
  if (out.mode.json) out.notice(text);
  else out.say(`${text}\n`);
}

/** The note printed by `close` without `--execute` when flags that need it were given. */
export function ignoredFlagsNote(options: CloseCommandOptions): string | null {
  const flags = [
    ...(options.yes ? ["--yes"] : []),
    ...(options.partial ? ["--partial"] : []),
    ...(options.report !== undefined ? ["--report"] : []),
  ];
  if (flags.length === 0) return null;
  const list =
    flags.length === 1 ? flags[0]! : `${flags.slice(0, -1).join(", ")} and ${flags.at(-1)!}`;
  return `note: ${list} ${flags.length === 1 ? "has" : "have"} no effect without --execute; this is a dry run.`;
}

const json = (value: unknown) => JSON.stringify(redactValue(value), null, 2);

async function sponsorSpendable(reader: LedgerReader, sponsor: string): Promise<bigint> {
  const [ledger, account] = await Promise.all([reader.latestLedger(), reader.account(sponsor)]);
  if (!account) return -1n;
  return reserveFromHorizon(account, BigInt(ledger.base_reserve_in_stroops)).spendable;
}

function wrapped(text: string, indent: number): string {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (line && indent + line.length + 1 + word.length > 120) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(line);
  return lines.map((l) => `${" ".repeat(indent)}${l}\n`).join("");
}

function notClosable(plan: ClosePlan): string {
  let text = `\nNot executed: the plan cannot end in a merge (status ${plan.status.toUpperCase()}), so nothing was signed or submitted.\n`;
  // Each item with its subject, the rungs of the ladder ruled out and the remedy (AC-E3-S2-3).
  for (const item of plan.unclosable) {
    text += unclosableLines(item, 4)
      .map((line) => `${line}\n`)
      .join("");
  }
  for (const b of plan.blockers) {
    text += `  ${b.code}${b.permanent ? " (permanent)" : ""}\n${wrapped(b.reason, 4)}${wrapped(`remedy: ${b.remedy}`, 4)}`;
  }
  text +=
    "To run everything else now, add --partial: the steps above run, the account is not merged.\n";
  return text;
}

/** The four facts to check before typing the confirmation (ux-design section 2.2). */
function summary(
  plan: ClosePlan,
  sponsorSpendableStroops: bigint,
  baseFee: number | undefined,
): string {
  const merge = plan.transactions.findIndex((t) =>
    t.stepIds.some((id) => plan.steps.find((s) => s.id === id)?.kind === "merge"),
  );
  const ops = plan.transactions.reduce((n, t) => n + t.opCount, 0);
  // Review round 3, R3-25: only the close budget bounds what the sponsor pays. A retry after a fee
  // surge raises the bid for the same sequence number (not with --base-fee, which is also the cap
  // per operation), and a transaction that fails on the ledger is charged and makes the run
  // re-plan, which signs transactions the plan did not have; the sponsor signs nothing that would
  // take the close past its budget (FeeSponsor), so the budget is the ceiling.
  const bid =
    baseFee === undefined
      ? xlm(plan.fees.totalStroops)
      : `${xlm(plan.fees.totalStroops)} at ${grouped(baseFee)} stroops per operation (--base-fee), never raised`;
  const lines = [
    "",
    merge >= 0
      ? `You are about to close ${plan.account} on testnet.`
      : `You are about to run a PARTIAL close of ${plan.account} on testnet.`,
    `  destination  ${plan.destination}`,
    merge >= 0
      ? `  receives     ${plan.recovery.xlmToDestination} XLM through the merge in tx ${merge + 1}, which cannot be undone`
      : "  receives     nothing through a merge: the account is not merged and stays open",
    `  sponsor      ${plan.feeSponsor ?? ""}`,
    ...(plan.memo !== null
      ? [
          // The merge is named only when one is planned (review round 3, R3-32).
          `  memo         ${JSON.stringify(plan.memo)} (on every transaction${merge >= 0 ? ", the merge included" : ""})`,
        ]
      : []),
    `  pays         every fee; the plan bids ${bid}`,
    `  at most      ${xlm(plan.fees.budgetStroops)}, the close budget; retries and re-plans can bid more than the plan, never more`,
    `  can spend    ${xlm(sponsorSpendableStroops)}`,
    `  signs        ${plural(plan.transactions.length, "fee-bumped transaction", "fee-bumped transactions")}, ${plural(ops, "operation", "operations")}, signed by the account`,
    `  unclosable   ${plural(plan.unclosable.length, "item", "items")}${plan.unclosable.length > 0 ? ", staying on the account" : ""}`,
  ];
  return `${lines.join("\n")}\n`;
}

/**
 * The typed confirmation. It is asked only where the user saw the facts it confirms: the prompt
 * learns which stream carried them (`facts`) and declines to ask when that stream, its own input
 * or its output is not a terminal, naming which (review round 3, R3-28, R3-31).
 */
async function confirm(destination: string, prompt: Prompt | undefined): Promise<void> {
  const tail = destination.slice(-4);
  if (!prompt) {
    throw declined("no terminal is available to ask on (the input is not interactive)");
  }
  let answer: string | null | { unasked: string };
  try {
    // The plan and the summary were printed on standard output: --json never asks (AA-10).
    answer = await prompt(
      `\nType the last 4 characters of the destination ${destination} to confirm: `,
      { facts: "stdout" },
    );
  } catch {
    answer = null;
  }
  if (answer !== null && typeof answer === "object") {
    throw declined(
      `the question was not asked: ${answer.unasked}`,
      "Run the command in a terminal without redirecting its input, standard output or standard error, or add --yes for a non-interactive run (it works only with --execute).",
    );
  }
  if (answer === null) {
    throw declined("no answer was given (the input ended, or Ctrl-C was pressed)");
  }
  // The answer is never echoed: a user might have typed anything, even a secret.
  if (answer.trim() !== tail) {
    throw declined("the answer does not match the last 4 characters of the destination");
  }
}

function declined(why: string, remedy?: string): DustinError {
  return new DustinError("CONFIRMATION_DECLINED", `Not confirmed: ${why}. Nothing was executed.`, {
    stage: "config",
    remedy:
      remedy ??
      "Run the command in a terminal and type the last 4 characters of the destination, or add --yes for a non-interactive run (it works only with --execute).",
  });
}

/** A plan carried by an event: the executor's fresh plan, or a later re-plan. */
function planOf(event: CloseEvent): ClosePlan | null {
  const candidate = (event as { plan?: unknown }).plan;
  return candidate !== null &&
    typeof candidate === "object" &&
    (candidate as { kind?: unknown }).kind === "dustin-close-plan"
    ? (candidate as ClosePlan)
    : null;
}

function stepSummary(steps: CloseStep[]): string {
  const count = (kind: CloseStep["kind"]) => steps.filter((s) => s.kind === kind).length;
  const parts = [
    count("cancel_offer") ? `cancel ${plural(count("cancel_offer"), "offer", "offers")}` : "",
    count("dispose_balance")
      ? `dispose of ${plural(count("dispose_balance"), "balance", "balances")}`
      : "",
    count("remove_trustline")
      ? `remove ${plural(count("remove_trustline"), "trustline", "trustlines")}`
      : "",
    count("remove_data")
      ? `delete ${plural(count("remove_data"), "data entry", "data entries")}`
      : "",
  ].filter(Boolean);
  const merge = steps.find((s) => s.kind === "merge");
  if (merge?.subject.type === "account")
    parts.push(`merge into ${short(merge.subject.destination)}`);
  return parts.join(", ");
}

/** One block per transaction, one line per state (ux-design section 2.5, UX-DR3). */
function progressPrinter(
  out: Channel,
  plans: ClosePlan[],
  account: string,
  anySubmitted: () => boolean,
) {
  const say = (text: string) => out.say(text);
  const latestPlan = () => plans[plans.length - 1]!;
  const label = (index: number) => {
    const total = latestPlan().transactions.length;
    return index < total ? `tx ${index + 1}/${total}` : `tx ${index + 1}`;
  };
  return (event: CloseEvent) => {
    switch (event.type) {
      case "plan":
      case "done":
        return;
      case "drift": {
        // Two kinds of drift: a changed plan structure (its hash), and less XLM recovered than in
        // the plan shown, which the hash does not show (a worse quote; review BH-7): for the
        // destination, or for the account when the plans do not merge (closing review CX-2). The
        // plan shown is the first of `plans`, the executor's fresh plan the latest.
        const what = [
          event.previousPlanHash !== event.planHash
            ? `the account changed since the plan was shown (plan hash ${event.previousPlanHash} is now ${event.planHash})`
            : "",
          event.xlmToDestination
            ? `${recoveredXlmWords(plans[0]!, latestPlan())} fell from ${event.xlmToDestination.approved} XLM to ${event.xlmToDestination.fresh} XLM since the plan was shown (a worse quote for a sale, or a lower balance)`
            : "",
        ].filter(Boolean);
        const text = what.join(", and ") || "the plan changed since it was shown";
        say(
          `\n${text.charAt(0).toUpperCase()}${text.slice(1)}; ` +
            (event.action === "replan"
              ? "continuing with the fresh plan.\n"
              : anySubmitted()
                ? "the run stops here; the transactions above stay on the ledger.\n"
                : "nothing was submitted.\n"),
        );
        return;
      }
      case "preflight":
        say(
          `\n${label(event.index)}  merge preflight ${event.ok ? "ok" : "FAILED"}: ${event.detail}\n`,
        );
        return;
      case "wait": {
        // Story E3-S4: the merge waits for the sequence guard (about 5 s per ledger).
        const seconds = Math.max(0, event.untilLedger - event.currentLedger) * SECONDS_PER_LEDGER;
        say(
          event.state === "start"
            ? `\n${label(event.index)}  waiting for the sequence guard: the merge can land from ledger ${grouped(event.untilLedger)}\n` +
                `        the latest ledger is ${grouped(event.currentLedger)}, about ${seconds} s to go\n`
            : `        waited     ledger ${grouped(event.currentLedger)} has closed; the merge can land from ledger ${grouped(event.untilLedger)}\n`,
        );
        return;
      }
      case "tx:building": {
        const plan = latestPlan();
        const tx = plan.transactions.find((t) => t.index === event.index);
        const steps = (tx?.stepIds ?? [])
          .map((id) => plan.steps.find((s) => s.id === id))
          .filter((s): s is CloseStep => s !== undefined);
        say(
          `\n${label(event.index)}  ${event.phase}  ${plural(event.opCount, "operation", "operations")}, ` +
            "signed by the account, fee-bumped by the sponsor\n" +
            (steps.length > 0 ? wrapped(stepSummary(steps), 8) : ""),
        );
        return;
      }
      case "tx:submitted":
        say(`        submitted  ${event.hash}\n        ${event.explorerUrl}\n`);
        return;
      case "tx:confirmed":
        say(
          `        confirmed  ledger ${grouped(event.ledger)}, fee charged to the sponsor ` +
            `${xlm(event.feeChargedStroops)} (${grouped(event.feeChargedStroops)} stroops)\n`,
        );
        return;
      case "tx:failed":
        say(`        ${event.result.padEnd(9)}  ${failureCodes(event.detail)}\n`);
        return;
      case "verified":
        say(
          `\nVerifying    GET /accounts/${account} -> ` +
            (event.accountExists
              ? "200: the account still exists\n"
              : "404: the account no longer exists\n"),
        );
        return;
      default: {
        // An event a later executor may add: print its text fields, if any.
        const extra = event as { type?: unknown; detail?: unknown; message?: unknown };
        const text = [extra.detail, extra.message].find((x) => typeof x === "string");
        if (typeof extra.type === "string" && typeof text === "string") {
          say(`        ${extra.type}: ${text}\n`);
        }
      }
    }
  };
}

function failureCodes(detail: string): string {
  try {
    const c = JSON.parse(detail) as {
      transaction?: unknown;
      innerTransaction?: unknown;
      operations?: unknown;
    };
    const codes = [
      c.transaction,
      c.innerTransaction,
      ...(Array.isArray(c.operations) ? (c.operations as unknown[]) : []),
    ].filter((x): x is string => typeof x === "string" && x.length > 0);
    return codes.length > 0 ? codes.join(", ") : "no result codes";
  } catch {
    return detail;
  }
}

/** The report of a run the executor refused before submitting anything, marked as such. */
function refusedReport(known: CloseReport, error: unknown): CloseReport {
  const report = structuredClone(known);
  if (report.finishedAt === null) {
    report.status = "aborted";
    report.message =
      error instanceof DustinError
        ? `${error.code}: ${error.message}`
        : `unexpected error: ${redact(textOf(error))}`;
    report.finishedAt = new Date().toISOString();
  }
  return report;
}

/**
 * The report to print and keep when the executor stopped on an exception after a submission: the
 * copy it attached to the error, or the last copy it published. A copy taken mid-run still has
 * its initial status, so it is marked failed with the error's message.
 */
function stoppedReport(known: CloseReport | null, error: unknown, account: string): CloseReport {
  const message =
    error instanceof DustinError
      ? `${error.code}: ${error.message}`
      : `unexpected error: ${redact(textOf(error))}`;
  if (!known) {
    throw new DustinError(
      "EXECUTION_INTERRUPTED",
      `The run for ${account} stopped after a submission and no report is available (${message}).`,
      { stage: "submit", cause: error },
    );
  }
  const report = structuredClone(known);
  if (report.status === "aborted" || report.finishedAt === null) {
    report.status = "failed";
    report.message = report.message ?? `The run stopped: ${message}`;
    report.finishedAt = report.finishedAt ?? new Date().toISOString();
  }
  return report;
}

/** True when both paths exist and are the same file (links followed): same device and inode. */
function sameFile(a: string, b: string): boolean {
  const x = statSync(a, { throwIfNoEntry: false });
  const y = statSync(b, { throwIfNoEntry: false });
  return x !== undefined && y !== undefined && x.dev === y.dev && x.ino === y.ino;
}

/**
 * The opt-in receipt file of `--report <file>`: the report JSON (public keys, hashes and
 * envelopes only), written with every copy the executor publishes (when the report is created,
 * each envelope before and as its POST starts, each outcome and re-plan, the finish) and once more
 * at the end, through a temporary file and a rename so a reader never sees half a file. It does
 * not depend on standard output: after an EPIPE there the rest of the output goes to standard
 * error (src/cli/output.ts), and the file keeps getting every copy (review round 3, R3-29). It is
 * checked before anything is signed; a write that fails later only warns, because stopping a
 * close half way would be worse.
 */
type ReceiptFile = ReturnType<typeof receiptFile>;

function receiptFile(path: string, ctx: CloseContext) {
  const refuse = (detail: string) =>
    new DustinError("CONFIG_INVALID", `Cannot write the report file ${path}: ${detail}.`, {
      stage: "config",
      remedy: "Choose a writable file path for --report.",
      // The path is printed as it is, never broken or collapsed (Epic 4 review EX-8).
      details: { path },
    });
  try {
    if (path.trim() === "") throw refuse("the path is empty");
    // A report must never take the place of the secrets file (and rotate it away): no name that is
    // .env in any case, since a case-insensitive filesystem (macOS, Windows) opens .env for .ENV,
    // and no other name for the working directory's .env, a symbolic or hard link to it (review
    // round 3, R3-26).
    if (/^\.env(\..*)?$/i.test(basename(path))) throw refuse("it is a .env file");
    const secrets = ctx.secrets.cwd === undefined ? null : join(ctx.secrets.cwd, ".env");
    if (secrets !== null && sameFile(path, secrets)) {
      throw refuse("it is the working directory's .env file");
    }
    if (statSync(path, { throwIfNoEntry: false })?.isDirectory()) throw refuse("it is a directory");
    mkdirSync(dirname(path), { recursive: true });
    accessSync(dirname(path), constants.W_OK);
  } catch (error) {
    if (error instanceof DustinError) throw error;
    throw refuse((error as NodeJS.ErrnoException).code ?? "unknown error");
  }
  let warned = false;
  let writes = 0;
  let lastWriteOk = false;
  let anyWriteOk = false;
  // A re-run with the same --report path must not erase the hashes of the earlier run (PRD
  // NFR-03, ux-design section 2.7): before the first write, an existing file is renamed aside;
  // if that fails, this run's report goes beside it instead, so the earlier file is never touched.
  let target: string | null = null;
  const settle = (): string => {
    if (target !== null) return target;
    if (!existsSync(path)) return (target = path);
    const stamp = new Date().toISOString().replace(/[-:.]/g, "");
    let aside = `${path}.${stamp}`;
    for (let n = 1; existsSync(aside); n += 1) aside = `${path}.${stamp}-${n}`;
    try {
      renameSync(path, aside);
      ctx.out.notice(`the earlier report ${path} was kept as ${aside}.`, [path, aside]);
      return (target = path);
    } catch {
      ctx.out.notice(
        `warning: the earlier report ${path} could not be moved aside; this run's report is written to ${aside}.`,
        [path, aside],
      );
      return (target = aside);
    }
  };
  return {
    get path(): string {
      return target ?? path;
    },
    /** True when the latest write reached the file. */
    get ok(): boolean {
      return lastWriteOk;
    },
    /** True when some write reached the file, so it holds at least an earlier copy (R3-30). */
    get written(): boolean {
      return anyWriteOk;
    },
    write(report: CloseReport): void {
      const file = settle();
      // Created exclusively (wx) under an unguessable name, so a planted file or symlink with a
      // predictable name can never be followed and overwritten.
      const temporary = `${file}.${process.pid}.${writes++}.${randomBytes(6).toString("hex")}.tmp`;
      try {
        writeFileSync(temporary, `${json(report)}\n`, { mode: 0o644, flag: "wx" });
        renameSync(temporary, file);
        lastWriteOk = true;
        anyWriteOk = true;
      } catch (error) {
        lastWriteOk = false;
        try {
          rmSync(temporary, { force: true });
        } catch {
          // Nothing more to do: the warning below says the file could not be written.
        }
        if (!warned) {
          warned = true;
          const code = (error as NodeJS.ErrnoException).code ?? "unknown error";
          ctx.out.notice(
            `warning: cannot write the report file ${file} (${code}); the run goes on and the report is printed at the end.`,
            [file],
          );
        }
      }
    },
  };
}
