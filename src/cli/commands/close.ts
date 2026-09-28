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
import { basename, dirname } from "node:path";
import { formatStroops } from "../../amounts.js";
import { verifyHorizonIsTestnet } from "../../config/network.js";
import type { Sleep } from "../../config/pauses.js";
import { DustinError } from "../../errors/dustin-error.js";
import { redact, redactValue } from "../../errors/redact.js";
import { executeClose, type CloseEvent } from "../../execute/executor.js";
import type { CloseReport } from "../../execute/report.js";
import { horizonSubmitter } from "../../execute/submit.js";
import { reserveFromHorizon } from "../../inspect/reserve.js";
import type { ClosePlan, CloseStep } from "../../plan/model.js";
import { planClose } from "../../plan/plan-close.js";
import { horizonJson } from "../../reader/horizon-json.js";
import { horizonReader, type LedgerReader } from "../../reader/ledger-reader.js";
import { renderPlan, short, unclosableLines } from "../../render/plan-text.js";
import { renderReport } from "../../render/report-text.js";
import { ExitCode, exitCodeForReport } from "../exit-codes.js";
import { loadCloseSigners, type SecretSources } from "../secrets.js";
import type { CommandContext } from "./fixture.js";
import { checkAddresses, destinationOf, parseBaseFee, type PlanCommandOptions } from "./plan.js";

/** Asks one question; resolves with the answer, or null on EOF or a non-interactive input. */
export type Prompt = (question: string) => Promise<string | null>;

export interface CloseCommandOptions extends PlanCommandOptions {
  execute?: boolean;
  yes?: boolean;
  partial?: boolean;
  report?: string;
}

export interface CloseContext extends CommandContext {
  /** Where the two secrets come from: the environment, then `.env` in the working directory. */
  secrets: SecretSources;
  /** The typed confirmation; without it the input counts as non-interactive. */
  prompt?: Prompt;
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
 * and the receipt. Human text goes to stdout, or to stderr with --json so that stdout carries only
 * the final report. Every line printed here passes through redact(); no secret is ever read into
 * anything but the two signers.
 */
export async function closeExecute(
  account: string,
  options: CloseCommandOptions,
  ctx: CloseContext,
): Promise<ExitCode> {
  const say = (text: string) => (options.json ? ctx.io.stderr : ctx.io.stdout)(redact(text));
  const destination = destinationOf(options);
  checkAddresses(account, destination);
  const baseFee = parseBaseFee(options.baseFee);

  const signers = loadCloseSigners(account, ctx.secrets);
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
  say(renderPlan(plan, { heading: EXECUTION_HEADING }));

  // With --json, a refusal made here still prints one JSON document on stdout: the plan that was
  // refused (kind "dustin-close-plan"), where an executed run prints its close report.
  const refusedWith = (text: string) => {
    say(text);
    if (options.json) ctx.io.stdout(`${json(plan)}\n`);
    return ExitCode.NOTHING_EXECUTED;
  };
  if (plan.transactions.length === 0) {
    return refusedWith(
      "\nNothing to execute: the plan has no step to run (see the blockers above). Nothing was signed or submitted.\n",
    );
  }
  if (plan.status !== "closable" && !options.partial) {
    return refusedWith(notClosable(plan));
  }
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
  say(summary(plan, spendable, baseFee));
  if (options.yes) {
    say(
      "\nCONFIRMATION SKIPPED: --yes was given, so the typed confirmation was not asked. Executing now.\n",
    );
  } else {
    await confirm(destination, ctx.prompt);
  }

  const plans: ClosePlan[] = [plan];
  let latest: CloseReport | null = null;
  let submitted = false;
  const progress = progressPrinter(say, plans, account, () => submitted);
  const execute = ctx.execute?.executeClose ?? executeClose;
  say(
    `\nClosing ${account} on testnet.\nEvery fee is paid by the sponsor ${sponsor}; the account pays nothing.\n`,
  );
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
      onEvent: (event) => {
        const fresh = planOf(event);
        if (fresh) plans.push(fresh);
        if (event.type === "tx:submitted") submitted = true;
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
      if (known) {
        const refused = refusedReport(known, error);
        receipt?.write(refused);
        if (options.json) ctx.io.stdout(`${json(refused)}\n`);
      }
      throw error;
    }
    // Something was submitted: never lose a hash (PRD NFR-03). The run stopped: exit 5.
    const stopped = stoppedReport(known, error, account);
    receipt?.write(stopped);
    ctx.io.stderr(
      error instanceof DustinError
        ? `dustin: ${error.code}: ${error.message}\n${error.remedy ? `  ${error.remedy}\n` : ""}`
        : `dustin: unexpected error after a submission: ${redact(String(error))}\n`,
    );
    if (options.json) ctx.io.stdout(`${json(stopped)}\n`);
    say(`\n${renderReport(stopped, { plans, explorerBaseUrl: config.explorerBaseUrl })}`);
    if (receipt) say(receiptLine(receipt));
    return ExitCode.STOPPED;
  }

  receipt?.write(report);
  const code = exitCodeForReport(report);
  if (options.json) ctx.io.stdout(`${json(report)}\n`);
  say(`\n${renderReport(report, { plans, explorerBaseUrl: config.explorerBaseUrl })}`);
  if (receipt) say(receiptLine(receipt));
  if (report.status === "closed" && code !== ExitCode.OK) {
    ctx.io.stderr(
      "dustin: the merge was reported applied, but the account was not verified gone on Horizon; check it on the explorer and run the same command again.\n",
    );
  }
  return code;
}

/** The last line about the --report file: written, or not, in which case the receipt is all there is. */
function receiptLine(receipt: { path: string; ok: boolean }): string {
  return receipt.ok
    ? `Report written to ${receipt.path}\n`
    : `Report NOT written to ${receipt.path} (see the warning above); the receipt printed here is the only record of this run's hashes.\n`;
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
  return `dustin: note: ${list} ${flags.length === 1 ? "has" : "have"} no effect without --execute; this is a dry run.\n`;
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

async function confirm(destination: string, prompt: Prompt | undefined): Promise<void> {
  const tail = destination.slice(-4);
  let answer: string | null = null;
  if (prompt) {
    try {
      answer = await prompt(
        `\nType the last 4 characters of the destination ${destination} to confirm: `,
      );
    } catch {
      answer = null;
    }
  }
  if (answer === null) {
    throw declined("no answer was given (the input is not interactive, or it ended)");
  }
  // The answer is never echoed: a user might have typed anything, even a secret.
  if (answer.trim() !== tail) {
    throw declined("the answer does not match the last 4 characters of the destination");
  }
}

function declined(why: string): DustinError {
  return new DustinError("CONFIRMATION_DECLINED", `Not confirmed: ${why}. Nothing was executed.`, {
    stage: "config",
    remedy:
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
  say: (text: string) => void,
  plans: ClosePlan[],
  account: string,
  anySubmitted: () => boolean,
) {
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
        // Two kinds of drift: a changed plan structure (its hash), and less XLM for the destination
        // than the plan shown, which the hash does not show (a worse quote; review BH-7).
        const what = [
          event.previousPlanHash !== event.planHash
            ? `the account changed since the plan was shown (plan hash ${event.previousPlanHash} is now ${event.planHash})`
            : "",
          event.xlmToDestination
            ? `the XLM the destination receives fell from ${event.xlmToDestination.approved} XLM to ${event.xlmToDestination.fresh} XLM since the plan was shown (a worse quote for a sale, or a lower balance)`
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
        : `unexpected error: ${redact(String(error))}`;
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
      : `unexpected error: ${redact(String(error))}`;
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

/**
 * The opt-in receipt file of `--report <file>`: the report JSON (public keys, hashes and
 * envelopes only) written after every change and at the end, through a temporary file and a
 * rename so a reader never sees half a file. It is checked before anything is signed; a write
 * that fails later only warns, because stopping a close half way would be worse.
 */
function receiptFile(path: string, ctx: CloseContext) {
  const refuse = (detail: string) =>
    new DustinError("CONFIG_INVALID", `Cannot write the report file ${path}: ${detail}.`, {
      stage: "config",
      remedy: "Choose a writable file path for --report.",
    });
  try {
    if (path.trim() === "") throw refuse("the path is empty");
    // A report must never take the place of the secrets file (and rotate it away).
    if (/^\.env(\..*)?$/.test(basename(path))) throw refuse("it is a .env file");
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
      ctx.io.stderr(`dustin: the earlier report ${path} was kept as ${aside}.\n`);
      return (target = path);
    } catch {
      ctx.io.stderr(
        `dustin: warning: the earlier report ${path} could not be moved aside; this run's report is written to ${aside}.\n`,
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
    write(report: CloseReport): void {
      const file = settle();
      // Created exclusively (wx) under an unguessable name, so a planted file or symlink with a
      // predictable name can never be followed and overwritten.
      const temporary = `${file}.${process.pid}.${writes++}.${randomBytes(6).toString("hex")}.tmp`;
      try {
        writeFileSync(temporary, `${json(report)}\n`, { mode: 0o644, flag: "wx" });
        renameSync(temporary, file);
        lastWriteOk = true;
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
          ctx.io.stderr(
            `dustin: warning: cannot write the report file ${file} (${code}); the run goes on and the report is printed at the end.\n`,
          );
        }
      }
    },
  };
}
