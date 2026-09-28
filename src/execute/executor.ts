import { formatStroops, toStroops } from "../amounts.js";
import {
  assertTestnetPassphrase,
  resolveConfig,
  verifyHorizonIsTestnet,
  type DustinConfig,
  type ResolvedConfig,
} from "../config/network.js";
import { timerSleep, type Sleep } from "../config/pauses.js";
import { DustinError, type ErrorStage } from "../errors/dustin-error.js";
import type { HorizonAccount } from "../inspect/horizon-types.js";
import { reserveFromHorizon } from "../inspect/reserve.js";
import { assetKey } from "../inspect/snapshot.js";
import type { ClosePlan, CloseStep, PlannedTransaction } from "../plan/model.js";
import { planClose, type PlanCloseInput } from "../plan/plan-close.js";
import { horizonJson } from "../reader/horizon-json.js";
import { horizonReader, type LedgerReader } from "../reader/ledger-reader.js";
import type { Signer } from "../sponsor/signer.js";
import { FeeSponsor } from "../sponsor/sponsor.js";
import {
  recordOutcome,
  submitPlannedTransaction,
  type AttemptContext,
  type AttemptSettings,
  type TransactionOutcome,
} from "./attempt.js";
import { operationFailure } from "./classify.js";
import type { CloseEvent } from "./events.js";
import { validateExecuteOptions } from "./options.js";
import { mergePreflight } from "./preflight.js";
import {
  describeSubject,
  replanDrift,
  rungOneAssets,
  stepIdentity,
  withPathsOnlyFor,
} from "./replan.js";
import {
  mergeAmountFromResultXdr,
  type CloseReport,
  type CloseStatus,
  type StepOutcome,
  type StopReason,
  type SubmittedTransaction,
} from "./report.js";
import type { ResultCodes } from "./result-codes.js";
import {
  horizonSubmitter,
  lookupTransaction,
  outcomeFromRecord,
  type Submitter,
} from "./submit.js";
import { verifyClosed } from "./verify.js";

export type { CloseReport, CloseStatus } from "./report.js";
export type { CloseEvent } from "./events.js";

export interface Signers {
  /** Signs the inner transactions: the closing account's key, a wallet or a device. */
  account: Signer;
  /** Signs only the fee-bump envelopes and pays every fee. */
  feeSponsor: Signer;
}

export interface ExecuteOptions {
  /** The literal `true`: executing is irreversible, so the caller must say so. */
  confirm: true;
  /** Run the cleanup even when the plan cannot end in a merge; default false. */
  allowPartial?: boolean;
  /**
   * When the account changed since the plan, or a mid-run re-plan finds something the approved
   * plan did not have: stop (default) or continue with the fresh plan.
   */
  onDrift?: "abort" | "replan";
  onEvent?: (event: CloseEvent) => void;
  /**
   * Called with a copy of the report whenever it changes (created, each submission attempt, each
   * outcome, each re-plan, finished, and right before an error is thrown), so a caller can persist
   * it while the run progresses (PRD FR-17, AC-E2-S3-6). Copies carry the status `running` until
   * the run finishes; the last copy carries the final status (blind review BH1).
   */
  onReport?: (report: CloseReport) => void;
  config?: DustinConfig;
  reader?: LedgerReader;
  /**
   * Custom submitter. The default posts to `config.horizonUrl` after checking that it serves the
   * testnet; an injected submitter is the caller's responsibility (review finding R6).
   */
  submitter?: Submitter;
  /** Per-close sponsor budget in stroops; overrides the plan's (default 5 XLM). */
  budgetStroops?: number;
  /** Cap on the bid per operation; overrides the plan's (default 1,000,000 stroops). */
  maxBaseFeeStroops?: number;
  /** Seconds of validity for each inner transaction; default 120. */
  timeoutSeconds?: number;
  /** Pause between lookups by hash and between the final checks; default 2000 ms, at least 200. */
  pollIntervalMs?: number;
  /** How long to keep looking for an unconfirmed envelope after its time bound; default 10 s. */
  graceSeconds?: number;
  /** Re-plans allowed after operations failed on the ledger; default 3 (architecture 7.2). */
  maxReplans?: number;
  /** Envelopes per planned transaction, the first included; default 5. */
  maxAttemptsPerTransaction?: number;
  /** Posts of one envelope after HTTP 429; default 5. */
  maxRateLimitRetries?: number;
  /** First pause after a 429, doubled each time; default 1000 ms, at least 200. */
  backoffMs?: number;
  /** How long the final check waits for Horizon to answer 404 after a merge; default 30 s. */
  verifyTimeoutMs?: number;
  /**
   * Waits between lookups and retries; default a timer. Pauses are at least 200 ms and never 0
   * (src/config/pauses.ts), so tests that must not wait inject a sleep that returns at once.
   */
  sleep?: Sleep;
  /**
   * Local clock in milliseconds, for report timestamps and for measuring how long a wait lasts;
   * whether a time bound has passed is judged by ledger close times. Default `Date.now`.
   */
  now?: () => number;
  /**
   * How long to wait, beyond an unconfirmed envelope's time bound and the grace, for a ledger that
   * closed after the bound; after it the run stops with OUTCOME_UNKNOWN. Default 60 s.
   */
  ledgerWaitSeconds?: number;
}

/**
 * Executes a close plan (SOW Deliverable 2). Every transaction is an inner transaction signed by
 * the account and wrapped in a fee bump signed by the sponsor (ADR-0003). Before anything is signed
 * the account is re-inspected and re-planned; a changed plan aborts unless `onDrift: "replan"`.
 * A merge in its own transaction runs only after a fresh preflight. Submissions are retried and
 * rebuilt safely, and operation failures re-plan from live state (E2-S3). The ledger is the source
 * of truth: running again after any stop continues from wherever the account is.
 *
 * Expected outcomes are returned as a report (ADR-0006): `closed`, `partial`, `aborted` (nothing
 * submitted) or `failed` (stopped part-way; run again to continue), with `stop` saying why. An
 * exception after the report exists (Horizon unreachable, a signer that throws, a bug) finishes
 * the report, publishes it and is thrown as a DustinError carrying it (review finding R1).
 */
export async function executeClose(
  plan: ClosePlan,
  signers: Signers,
  options: ExecuteOptions,
): Promise<CloseReport> {
  if (options.confirm !== true) {
    throw new DustinError(
      "CONFIRMATION_REQUIRED",
      "executeClose needs `confirm: true`; nothing was executed.",
      {
        stage: "config",
        remedy:
          "Show the plan to the account holder and pass confirm: true only after they approve it.",
      },
    );
  }
  validateExecuteOptions(options);
  assertTestnetPassphrase(plan.network.passphrase);
  const accountKey = signers.account.publicKey();
  const sponsorKey = signers.feeSponsor.publicKey();
  if (accountKey !== plan.account) {
    throw new DustinError(
      "WRONG_SIGNER",
      `The account signer is ${accountKey}, not the account ${plan.account}.`,
      {
        stage: "config",
        remedy: "Set DUSTIN_ACCOUNT_SECRET to the secret key of the account being closed.",
      },
    );
  }
  if (sponsorKey === plan.account) {
    throw new DustinError(
      "INVALID_ADDRESS",
      "The fee sponsor must be a different account from the one being closed.",
      {
        stage: "config",
      },
    );
  }
  if (plan.feeSponsor && plan.feeSponsor !== sponsorKey) {
    throw new DustinError(
      "WRONG_SIGNER",
      `The sponsor signer is ${sponsorKey}, but the plan names ${plan.feeSponsor}.`,
      {
        stage: "config",
        remedy:
          "Set DUSTIN_SPONSOR_SECRET to the sponsor's secret key, or plan again with --sponsor.",
      },
    );
  }

  const config = resolveConfig(options.config);
  const reader = options.reader ?? horizonReader(horizonJson(config.horizonUrl));
  // The planner checks the passphrase of the Horizon it reads, which says nothing about where the
  // envelopes go. With the default submitter they go to config.horizonUrl, so that server must
  // prove it serves the testnet before anything is signed (review finding R6). An injected
  // submitter is the caller's responsibility.
  if (!options.submitter) await verifyHorizonIsTestnet(config.horizonUrl);
  const submitter = options.submitter ?? horizonSubmitter(config.horizonUrl);

  // Nothing has happened yet, so a failure to plan is thrown as it is.
  const fresh = await planClose(replanInput(plan, sponsorKey, options), { reader });
  return new CloseRun({
    plan,
    fresh,
    signers,
    sponsorKey,
    options,
    config,
    reader,
    submitter,
  }).execute();
}

interface RunInput {
  /** The plan the caller approved. */
  plan: ClosePlan;
  /** The same plan made again from live state before anything is signed (round 0). */
  fresh: ClosePlan;
  signers: Signers;
  sponsorKey: string;
  options: ExecuteOptions;
  config: ResolvedConfig;
  reader: LedgerReader;
  submitter: Submitter;
}

type AfterFailure = { kind: "replan"; plan: ClosePlan } | { kind: "stop"; stop: StopReason };

/** The statuses a finished run can have: `running` is for copies published before the end. */
type FinalStatus = Exclude<CloseStatus, "running">;

/** One execution: the report, the plan rounds and what applied so far. */
class CloseRun {
  private readonly report: CloseReport;
  private readonly settings: AttemptSettings;
  /** Step outcomes of the plan the run started with, by step identity (stable across re-plans). */
  private readonly outcomes = new Map<string, StepOutcome>();
  /** Every step that applied, with the plan round it applied in (edge case E9). */
  private readonly appliedSteps: Array<{ step: CloseStep; round: number }> = [];
  /** The plan of each round: 0 is `fresh`, n the n-th re-plan. */
  private readonly roundPlans: ClosePlan[];
  /** The steps each envelope carried, by hash: tells which envelopes carried the merge. */
  private readonly envelopeSteps = new Map<string, CloseStep[]>();
  private readonly failedObservers = new Set<string>();
  /** Envelopes whose outcome was not known during the run and that a later lookup settled. */
  private readonly settledLate = new Set<string>();
  /** Assets whose strict-send sale failed on the market during this run. */
  private readonly demoted = new Set<string>();
  private sponsor: FeeSponsor | null = null;
  private stage: ErrorStage = "plan";
  private round = 0;
  private merge: { hash: string; ledger: number } | null = null;

  constructor(private readonly input: RunInput) {
    const { fresh, plan, sponsorKey, options } = input;
    this.report = {
      schemaVersion: 1,
      kind: "dustin-close-report",
      network: { passphrase: fresh.network.passphrase, horizon: fresh.network.horizon },
      account: plan.account,
      destination: plan.destination,
      feeSponsor: sponsorKey,
      planHash: fresh.planHash,
      // Until finish() sets the outcome, every published copy says the run is in progress.
      status: "running",
      message: null,
      stop: null,
      startedAt: new Date((options.now ?? Date.now)()).toISOString(),
      finishedAt: null,
      transactions: [],
      steps: fresh.steps.map((s) => ({ stepId: s.id, status: "not_run", txIndex: s.txIndex })),
      replans: [],
      unclosable: fresh.unclosable,
      blockers: fresh.blockers,
      warnings: [...fresh.warnings],
      recovery: {
        mergedXlm: null,
        reservesReturnedToSponsors: [],
        feesPaidByAccount: "0",
        feesPaidBySponsorStroops: 0,
      },
      verification: null,
    };
    fresh.steps.forEach((step, i) => this.outcomes.set(stepIdentity(step), this.report.steps[i]!));
    this.roundPlans = [fresh];
    this.settings = {
      timeoutSeconds: options.timeoutSeconds ?? 120,
      pollIntervalMs: options.pollIntervalMs ?? 2000,
      graceSeconds: options.graceSeconds ?? 10,
      backoffMs: options.backoffMs ?? 1000,
      maxAttempts: options.maxAttemptsPerTransaction ?? 5,
      maxRateLimitRetries: options.maxRateLimitRetries ?? 5,
      ledgerWaitSeconds: options.ledgerWaitSeconds ?? 60,
      now: options.now ?? (() => Date.now()),
      sleep: options.sleep ?? timerSleep,
    };
  }

  async execute(): Promise<CloseReport> {
    try {
      this.publish();
      this.emit({ type: "plan", plan: this.input.fresh, round: 0 });
      return await this.start();
    } catch (error) {
      throw this.interrupted(error);
    }
  }

  private timestamp(): string {
    return new Date(this.settings.now()).toISOString();
  }

  private publish(): void {
    this.report.recovery.feesPaidBySponsorStroops = this.report.transactions.reduce(
      (sum, t) =>
        t.result === "applied" || t.result === "failed" ? sum + (t.feeChargedStroops ?? 0) : sum,
      0,
    );
    const { onReport } = this.input.options;
    if (onReport) this.observe("onReport", () => onReport(structuredClone(this.report)));
  }

  private emit(event: CloseEvent): void {
    const { onEvent } = this.input.options;
    if (onEvent) this.observe("onEvent", () => onEvent(event));
  }

  /**
   * Calls one of the caller's observers. An observer that throws must not stop a run that has
   * already signed and submitted (review finding 3): its error becomes a warning, once per callback.
   */
  private observe(name: "onReport" | "onEvent", call: () => void): void {
    try {
      call();
    } catch (error) {
      if (this.failedObservers.has(name)) return;
      this.failedObservers.add(name);
      this.report.warnings.push(
        `The caller's ${name} callback threw (${error instanceof Error ? error.message : String(error)}); the run went on without it.`,
      );
    }
  }

  private finish(status: FinalStatus, message: string | null, stop: StopReason | null) {
    this.report.status = status;
    this.report.message = message;
    this.report.stop = stop;
    this.report.finishedAt = this.timestamp();
    this.publish();
    this.emit({ type: "done", status });
    return this.report;
  }

  /** A stop before anything was submitted. */
  private abort(stop: StopReason): CloseReport {
    return this.finish("aborted", stop.detail, stop);
  }

  private async start(): Promise<CloseReport> {
    const { plan, fresh, options, sponsorKey } = this.input;
    if (fresh.blockers.some((b) => b.code === "ACCOUNT_MISSING")) {
      // A re-run after a completed close lands here (PRD FR-17): nothing to do, and the 404 is
      // the proof the account is gone.
      this.report.verification = {
        accountExists: false,
        horizonStatus: 404,
        checkedAt: this.timestamp(),
        accountUrl: `${this.input.config.explorerBaseUrl}/account/${plan.account}`,
        ledger: fresh.observed.ledger,
      };
      return this.abort({
        code: "ACCOUNT_MISSING",
        stage: "inspect",
        verdict: "stop",
        detail: `The account ${plan.account} does not exist on the testnet ledger (Horizon answered 404); if an earlier run merged it, the close is complete. Nothing was submitted.`,
      });
    }
    if (fresh.planHash !== plan.planHash) {
      const action = options.onDrift ?? "abort";
      this.emit({
        type: "drift",
        action,
        previousPlanHash: plan.planHash,
        planHash: fresh.planHash,
      });
      if (action === "abort") {
        return this.abort({
          code: "PLAN_CHANGED",
          stage: "plan",
          verdict: "replan",
          detail: `The account changed since the plan was made (plan hash ${plan.planHash} is now ${fresh.planHash}); nothing was submitted. Review the new plan and run again.`,
        });
      }
    }
    if (fresh.status !== "closable" && !options.allowPartial) {
      return this.abort({
        code: "PLAN_NOT_CLOSABLE",
        stage: "plan",
        verdict: "stop",
        detail: `The plan cannot end in a merge (status ${fresh.status}); nothing was submitted. Allow a partial close (--partial) to run everything else.`,
      });
    }
    if (fresh.transactions.length === 0) {
      return this.abort({
        code: "NOTHING_TO_EXECUTE",
        stage: "plan",
        verdict: "stop",
        detail: "The plan has nothing to execute.",
      });
    }
    // Review finding R2: a plan whose bids already exceed the budget would be stopped by the
    // sponsor part-way, after the cleanup and before the merge. Refuse it before anything is signed.
    if (!fresh.fees.withinBudget) {
      const { totalStroops, budgetStroops } = fresh.fees;
      return this.abort({
        code: "OVER_BUDGET",
        stage: "sponsor",
        verdict: "stop",
        detail: `The fee bids of this plan total ${totalStroops} stroops (${formatStroops(BigInt(totalStroops))} XLM), above the close budget of ${budgetStroops} stroops (${formatStroops(BigInt(budgetStroops))} XLM); nothing was signed. Raise the close budget or wait for network fees to fall, then run the close again.`,
      });
    }
    if (plan.destination === sponsorKey) {
      this.report.warnings.push(
        "The destination is also the fee sponsor: it pays the fees and receives the merged XLM.",
      );
    }
    await this.checkSponsorFunds();
    this.sponsor = new FeeSponsor(this.input.signers.feeSponsor, {
      networkPassphrase: fresh.network.passphrase,
      budgetStroops: fresh.fees.budgetStroops,
      maxBaseFeeStroops: fresh.fees.maxBaseFeeStroops,
    });
    return this.runPlans();
  }

  /** Canonical decision 7: refuse to start when the sponsor cannot cover the close budget. */
  private async checkSponsorFunds(): Promise<void> {
    const { reader, fresh, sponsorKey } = this.input;
    this.stage = "sponsor";
    const ledgerNow = await reader.latestLedger();
    const budget = fresh.fees.budgetStroops;
    const sponsorAccount = await reader.account(sponsorKey);
    const spendable = sponsorAccount
      ? reserveFromHorizon(sponsorAccount, BigInt(ledgerNow.base_reserve_in_stroops)).spendable
      : -1n;
    if (spendable < BigInt(budget)) {
      throw new DustinError(
        "SPONSOR_UNDERFUNDED",
        sponsorAccount
          ? `The fee sponsor ${sponsorKey} can spend ${formatStroops(spendable)} XLM, less than the close budget of ${formatStroops(BigInt(budget))} XLM.`
          : `The fee sponsor ${sponsorKey} does not exist.`,
        {
          stage: "sponsor",
          remedy: "Fund the fee sponsor (on testnet, from Friendbot) and run the close again.",
        },
      );
    }
  }

  private attemptContext(plan: ClosePlan, steps: CloseStep[]): AttemptContext {
    return {
      plan,
      round: this.round,
      reader: this.input.reader,
      account: () => this.freshAccount(),
      submitter: this.input.submitter,
      accountSigner: this.input.signers.account,
      sponsor: this.sponsor!,
      maxBaseFeeStroops: this.input.fresh.fees.maxBaseFeeStroops,
      explorerBaseUrl: this.input.config.explorerBaseUrl,
      settings: this.settings,
      record: (entry) => {
        this.envelopeSteps.set(entry.hash, steps);
        this.report.transactions.push(entry);
        this.publish();
      },
      changed: () => this.publish(),
      emit: (event) => this.emit(event),
      enter: (stage) => {
        this.stage = stage;
      },
    };
  }

  /** Runs the plan, and each re-plan after an operation failed on the ledger. */
  private async runPlans(): Promise<CloseReport> {
    let current = this.input.fresh;
    rounds: for (;;) {
      const byId = new Map(current.steps.map((s) => [s.id, s]));
      for (const tx of current.transactions) {
        const steps = tx.stepIds.map((id) => byId.get(id)!);
        // A merge that follows anything already submitted in this run (a later transaction, or the
        // first one of a re-plan) runs only after fresh facts (architecture rule R7).
        const carriesMerge = steps.some((s) => s.kind === "merge");
        const mergeFollowsWork = tx.index > 0 || this.report.transactions.length > 0;
        if (mergeFollowsWork && carriesMerge) {
          const blocked = await this.mergePreflightStop(current, tx, steps);
          if (blocked) return this.stopped(blocked);
        }
        const ctx = this.attemptContext(current, steps);
        if (carriesMerge) ctx.preflight = () => this.mergePreflightStop(current, tx, steps);
        const outcome = await submitPlannedTransaction(ctx, tx, steps);
        if (outcome.kind === "stopped") return this.stopped(outcome.stop);
        if (outcome.kind === "applied") {
          this.applied(steps, outcome);
          continue;
        }
        const next =
          outcome.kind === "replan"
            ? await this.replanFrom({
                tx,
                hash: outcome.entry.hash,
                codes: outcome.codes,
                explanation: outcome.reason,
                where: outcome.reason,
              })
            : await this.afterFailure(tx, steps, outcome);
        if (next.kind === "stop") return this.stopped(next.stop);
        current = next.plan;
        continue rounds;
      }
      return this.complete();
    }
  }

  /**
   * Fresh facts before a merge that follows work already submitted in this run, and before every
   * rebuild of a merge-carrying transaction (architecture rule R7; edge case E2). Null when the
   * merge may go; otherwise the MERGE_PREFLIGHT_FAILED stop.
   */
  private async mergePreflightStop(
    current: ClosePlan,
    tx: PlannedTransaction,
    steps: CloseStep[],
  ): Promise<StopReason | null> {
    this.stage = "merge";
    const preflight = await mergePreflight(this.input.reader, current, {
      mergeOnly: steps.every((s) => s.kind === "merge"),
      readAccount: () => this.freshAccount(),
    });
    this.emit({ type: "preflight", index: tx.index, ok: preflight.ok, detail: preflight.detail });
    if (preflight.ok) return null;
    return {
      code: "MERGE_PREFLIGHT_FAILED",
      stage: "merge",
      verdict: "replan",
      detail: `Merge preflight failed: ${preflight.detail}. The merge was not submitted.`,
      round: this.round,
      txIndex: tx.index,
      ...(preflight.unblocksAtLedger !== undefined
        ? { unblocksAtLedger: preflight.unblocksAtLedger }
        : {}),
    };
  }

  /**
   * The closing account as Horizon has it. Instances behind one address can lag each other: a read
   * whose sequence number is below one this run saw used by its own included transactions comes
   * from a Horizon behind the one that took them, so it is read again after a short wait, at most
   * five times, and the last read is used as it is (edge cases E3, E4). Waiting costs a few
   * seconds; acting on the stale read would build at a used sequence number or refuse a clean merge.
   */
  private async freshAccount(): Promise<HorizonAccount | null> {
    const used = this.report.transactions.reduce(
      (most, t) =>
        (t.result === "applied" || t.result === "failed") && BigInt(t.sequence) > most
          ? BigInt(t.sequence)
          : most,
      0n,
    );
    for (let read = 1; ; read++) {
      const account = await this.input.reader.account(this.input.plan.account);
      if (!account || BigInt(account.sequence) >= used || read >= 5) return account;
      await this.settings.sleep(this.settings.pollIntervalMs);
    }
  }

  private outcomeFor(step: CloseStep): StepOutcome {
    const identity = stepIdentity(step);
    let outcome = this.outcomes.get(identity);
    if (!outcome) {
      // A step the approved plan did not have, accepted with onDrift "replan".
      outcome = { stepId: `R${this.round}.${step.id}`, status: "not_run", txIndex: step.txIndex };
      this.report.steps.push(outcome);
      this.outcomes.set(identity, outcome);
    }
    return outcome;
  }

  private applied(
    steps: CloseStep[],
    outcome: Extract<TransactionOutcome, { kind: "applied" }>,
  ): void {
    for (const step of steps) {
      const o = this.outcomeFor(step);
      o.status = "applied";
      o.txHash = outcome.entry.hash;
      if (outcome.entry.round > 0) o.round = outcome.entry.round;
      if (step.disposal) o.rung = step.disposal.rung;
    }
    this.appliedSteps.push(...steps.map((step) => ({ step, round: outcome.entry.round })));
    if (steps.some((s) => s.kind === "merge")) {
      this.merge = { hash: outcome.entry.hash, ledger: outcome.entry.ledger ?? 0 };
      const merged = mergeAmountFromResultXdr(outcome.resultXdr);
      this.report.recovery.mergedXlm = merged === null ? null : formatStroops(merged);
    }
    // Observers hear of it only now, with the steps and the merge recorded (review finding 3).
    this.publish();
    this.emit({
      type: "tx:confirmed",
      index: outcome.entry.index,
      hash: outcome.entry.hash,
      ledger: outcome.entry.ledger ?? 0,
      feeChargedStroops: outcome.entry.feeChargedStroops ?? 0,
    });
  }

  /**
   * An included transaction failed: its operations did nothing, its sequence number and fee are
   * spent. Classify the failed operation (docs/adr/ADR-0006-error-taxonomy.md) and either stop, or
   * re-plan from live state with the same options (architecture section 7.2).
   */
  private async afterFailure(
    tx: PlannedTransaction,
    steps: CloseStep[],
    outcome: Extract<TransactionOutcome, { kind: "failed" }>,
  ): Promise<AfterFailure> {
    const { reader, plan } = this.input;
    const at = {
      round: this.round,
      txIndex: tx.index,
      hash: outcome.entry.hash,
      resultCodes: outcome.codes,
    };
    const failure = operationFailure(outcome.codes);
    if (!failure) {
      const label = `Transaction ${tx.index + 1} (${tx.phase})`;
      const inner = outcome.codes.innerTransaction ?? outcome.codes.transaction;
      if (inner && inner !== "tx_failed" && inner !== "tx_fee_bump_inner_failed") {
        // Review round 3, R3-9: it failed before any operation ran (an inner tx_too_late or
        // tx_bad_seq at apply time), so nothing of it applied and only its sequence number and
        // fee were spent: plan the rest again from the ledger, as after any safe failure.
        return this.replanFrom({
          tx,
          hash: at.hash,
          codes: outcome.codes,
          explanation: outcome.entry.explanation ?? inner,
          where: `${label} was included but failed with ${inner} before any operation ran.`,
        });
      }
      // No code says which operation failed, so no step can be blamed or demoted; the next run
      // plans from the ledger, which is what the verdict says.
      return {
        kind: "stop",
        stop: {
          code: "OPERATION_FAILED",
          stage: "submit",
          verdict: "replan",
          detail: `${label} failed on the ledger without an operation result (${outcome.entry.explanation ?? "no result codes"}), so the run cannot tell which step failed. Run the close again to continue from the current state.`,
          ...at,
        },
      };
    }
    const step = steps[failure.index];
    const stepOutcome = step ? this.outcomeFor(step) : undefined;
    if (stepOutcome) {
      stepOutcome.status = "failed";
      stepOutcome.txHash = outcome.entry.hash;
      stepOutcome.failures = (stepOutcome.failures ?? 0) + 1;
      stepOutcome.resultCodes = outcome.codes;
      stepOutcome.explanation = failure.explanation;
      this.publish();
    }
    const stepId = stepOutcome?.stepId;
    const where = `Step ${stepId ?? `${failure.index + 1} of transaction ${tx.index + 1}`} (${step?.kind.replaceAll("_", " ") ?? "operation"}) failed with ${failure.code}: ${failure.explanation}`;
    const stopWith = (stop: Omit<StopReason, "stage" | keyof typeof at>): AfterFailure => ({
      kind: "stop",
      stop: { stage: "submit", ...at, ...(stepId ? { stepId } : {}), ...stop },
    });

    if (failure.code === "op_seq_num_too_far") {
      // Waiting for the ledger is E3-S4; until then the run stops and says when to come back.
      const account = await reader.account(plan.account);
      const unblocks = account ? Number((BigInt(account.sequence) + 1n) >> 32n) + 1 : undefined;
      return stopWith({
        code: "SEQNUM_TOO_FAR",
        verdict: "replan",
        detail: `${where}${unblocks !== undefined ? ` Run the close again at or after ledger ${unblocks}.` : ""}`,
        ...(unblocks !== undefined ? { unblocksAtLedger: unblocks } : {}),
      });
    }
    if (failure.verdict === "stop") {
      return stopWith({ code: "OPERATION_FAILED", verdict: "stop", detail: where });
    }
    if ((stepOutcome?.failures ?? 0) >= 2 && stepOutcome) {
      // AC-E2-S3-4: reported as a blocker too, so the receipt's "Not closed" section shows it.
      const subject = step ? describeSubject(step.subject) : "operation";
      this.report.blockers.push({
        code: "STEP_FAILED_TWICE",
        reason: `Step ${stepOutcome.stepId} (${step?.kind.replaceAll("_", " ") ?? "operation"}, ${subject}) failed twice on the ledger with ${failure.code}: ${failure.explanation}`,
        // Review round 3, R3-5: --partial only lets a plan that cannot merge run; it is not an
        // input to the planner, so the next plan includes the same step again.
        remedy: `Look at the account's ${subject} on the explorer to find out why the step keeps failing, resolve that or wait until it settles, then run the close again, which plans from the ledger; --partial does not skip it, since the next plan includes the step again.`,
        permanent: false,
        stepId: stepOutcome.stepId,
        resultCodes: outcome.codes,
      });
      return stopWith({
        code: "STEP_FAILED_TWICE",
        verdict: "stop",
        detail: `${where} It failed twice, so the run stops here, before the merge.`,
      });
    }
    if (failure.demoteRung1 && step?.subject.type === "trustline") {
      this.demoted.add(assetKey(step.subject.asset));
    }
    return this.replanFrom({
      tx,
      hash: at.hash,
      codes: outcome.codes,
      explanation: failure.explanation,
      where,
      ...(stepId ? { stepId } : {}),
    });
  }

  /**
   * Plans the rest again from live state with the user's options (architecture section 7.2), at
   * most `maxReplans` times, and checks the new plan: drift against the approved plan follows
   * `onDrift`, and a plan that can no longer merge stops unless `allowPartial`.
   */
  private async replanFrom(trigger: {
    tx: PlannedTransaction;
    hash: string;
    codes: ResultCodes;
    explanation: string;
    /** One sentence that opens the stop's detail. */
    where: string;
    stepId?: string;
  }): Promise<AfterFailure> {
    const { options, reader, fresh, plan, sponsorKey } = this.input;
    const { tx, where, stepId } = trigger;
    // The round of the transaction that forced the re-plan. A stop raised after the new round was
    // counted still names that transaction (txIndex, hash), so it carries its round too (review
    // round 3, R3-7).
    const triggerRound = this.round;
    const stopWith = (
      stop: Omit<StopReason, "stage" | "round" | "txIndex" | "hash"> & { stage?: ErrorStage },
    ): AfterFailure => ({
      kind: "stop",
      stop: {
        stage: "submit",
        round: triggerRound,
        txIndex: tx.index,
        hash: trigger.hash,
        resultCodes: trigger.codes,
        ...(stepId ? { stepId } : {}),
        ...stop,
      },
    });
    if (this.report.replans.length >= (options.maxReplans ?? 3)) {
      return stopWith({
        code: "REPLAN_LIMIT",
        verdict: "stop",
        detail: `${where} The run already re-planned ${this.report.replans.length} times, so it stops here.`,
      });
    }
    this.stage = "plan";
    const allowed = new Set([...rungOneAssets(fresh)].filter((a) => !this.demoted.has(a)));
    const next = await planClose(replanInput(plan, sponsorKey, options), {
      reader: withPathsOnlyFor(reader, allowed),
    });
    const drift = replanDrift(fresh, next);
    this.round += 1;
    this.roundPlans[this.round] = next;
    this.report.replans.push({
      round: this.round,
      at: this.timestamp(),
      planHash: next.planHash,
      trigger: {
        round: triggerRound,
        txIndex: tx.index,
        hash: trigger.hash,
        stepId: stepId ?? null,
        resultCodes: trigger.codes,
        explanation: trigger.explanation,
      },
      demoted: [...this.demoted],
      drift,
      transactions: next.transactions.length,
    });
    this.report.unclosable = next.unclosable;
    this.report.blockers = next.blockers;
    for (const warning of next.warnings) {
      if (!this.report.warnings.includes(warning)) this.report.warnings.push(warning);
    }
    this.publish();
    this.emit({ type: "plan", plan: next, round: this.round });

    // Edge case E8: the account is gone, so nothing is left to plan and the run is not partial.
    // Stop, and let the final check decide: a 404 after a merge of this run is a close.
    if (next.blockers.some((b) => b.code === "ACCOUNT_MISSING")) {
      return stopWith({
        code: "ACCOUNT_MISSING",
        stage: "inspect",
        verdict: "stop",
        detail: `${where} The re-plan found the account ${plan.account} gone (Horizon answered 404).`,
      });
    }
    if (drift.length > 0) {
      const action = options.onDrift ?? "abort";
      this.emit({
        type: "drift",
        action,
        previousPlanHash: fresh.planHash,
        planHash: next.planHash,
      });
      if (action === "abort") {
        return stopWith({
          code: "PLAN_CHANGED",
          verdict: "replan",
          detail: `${where} The re-plan found what the approved plan did not have: ${drift.join("; ")}. Review the new plan and run again.`,
        });
      }
    }
    if (next.status !== "closable" && !options.allowPartial) {
      const reasons = [
        ...next.unclosable.map((u) => u.reason),
        ...next.blockers.map((b) => b.reason),
      ];
      return stopWith({
        code: "PLAN_NOT_CLOSABLE",
        verdict: "stop",
        detail: `${where} After it the account can no longer be merged: ${reasons.join(" ")} Allow a partial close (--partial) to run everything else.`,
      });
    }
    // Review finding 5: the R2 check for the re-plan, against what is left of the budget, so a
    // re-plan never runs its first transactions and then stops before the merge for lack of it.
    const left = this.sponsor!.remainingStroops;
    if (next.fees.totalStroops > left) {
      return stopWith({
        code: "OVER_BUDGET",
        stage: "sponsor",
        verdict: "stop",
        detail: `${where} The re-plan's fee bids total ${next.fees.totalStroops} stroops, more than the ${left} stroops left of the close budget of ${next.fees.budgetStroops} stroops; nothing more was signed. Raise the close budget or wait for network fees to fall, then run the close again.`,
      });
    }
    return { kind: "replan", plan: next };
  }

  /** An applied envelope that carried the merge, in case the run stopped before recording it. */
  private mergeInReport(): { hash: string; ledger: number } | null {
    const entry = this.report.transactions.find(
      (t) =>
        t.result === "applied" &&
        (this.envelopeSteps.get(t.hash) ?? []).some((s) => s.kind === "merge"),
    );
    return entry ? { hash: entry.hash, ledger: entry.ledger ?? 0 } : null;
  }

  /**
   * A stop during the run: `failed` once something was submitted, `aborted` if not, and `closed`
   * when a merge of this run turns out to have applied after all.
   */
  private async stopped(stop: StopReason): Promise<CloseReport> {
    if (!this.report.transactions.some((t) => t.attempts > 0)) return this.abort(stop);
    await this.settleUnknown();
    const verification = await this.verifyOrWarn();
    // The merge was found applied after all (a lagging lookup settled): a close like any other,
    // verified or not, and the stop it settled no longer stands (review round 3, R3-10).
    if (this.merge) return this.merged(verification);
    const closed = verification ? await this.closedUnseen(verification) : null;
    if (closed) return closed;
    this.recoverReserves();
    const known = this.settledStop(stop);
    return this.finish(
      "failed",
      `${known.detail}${known.verdict === "replan" && !/run the close again/i.test(known.detail) ? " Run the close again to continue from the current state." : ""}`,
      known,
    );
  }

  /**
   * A stop that names an envelope whose outcome was not known, once `settleUnknown` found it on
   * the ledger (review round 3, R3-35; blind review BH-11): the trigger stays (code, round,
   * transaction, hash), and the detail says what is known now. For OUTCOME_UNKNOWN the time bound
   * a re-run had to wait for no longer matters, so `maxTime` goes and the detail is rewritten;
   * another stop keeps its detail and gains a sentence.
   */
  private settledStop(stop: StopReason): StopReason {
    const entry = this.report.transactions.find((t) => t.hash === stop.hash);
    if (!entry || !this.settledLate.has(entry.hash)) return stop;
    const found =
      entry.result === "applied"
        ? `found applied in ledger ${entry.ledger ?? "?"}`
        : `found failed on the ledger (${entry.explanation ?? "no result codes"})`;
    if (stop.code !== "OUTCOME_UNKNOWN") {
      return {
        ...stop,
        detail: `${stop.detail} Looked up again before the final check, envelope ${entry.hash} was ${found}.`,
      };
    }
    const { maxTime: _passed, ...rest } = stop;
    const label = `Transaction ${entry.index + 1} (${entry.phase})${entry.round > 0 ? ` of round ${entry.round}` : ""}`;
    return {
      ...rest,
      verdict: "replan",
      detail: `${label} (${entry.hash}) had no known outcome when the run stopped, so nothing was rebuilt; looked up again before the final check, it was ${found}. No time bound needs to pass first: run the close again to continue from the ledger.`,
    };
  }

  /** Every planned transaction ran. */
  private async complete(): Promise<CloseReport> {
    await this.settleUnknown();
    const verification = await this.verifyOrWarn();
    if (this.merge) return this.merged(verification);
    const closed = verification ? await this.closedUnseen(verification) : null;
    if (closed) return closed;
    this.recoverReserves();
    const left = this.report.unclosable.length + this.report.blockers.length;
    return this.finish(
      "partial",
      `Everything that could run has run; the account still exists because ${left} item(s) block the merge (see unclosable and blockers).`,
      null,
    );
  }

  /**
   * A merge of this run applied, seen by hash: the run is `closed` (decision EX-10; `CloseStatus`
   * in report.ts), whether it ended the planned way or after a stop that a later lookup settled. A
   * verified close has the final check's 404 and no stop. When Horizon still returned the account
   * at the final check, the message says so and the stop ACCOUNT_STILL_EXISTS names the merge;
   * the CLI exits 5 for it, never 0 (review round 3, R3-10: `complete()` returned `failed` and
   * `stopped()` kept its stale stop for the same state).
   */
  private merged(verification: CloseReport["verification"]): CloseReport {
    const merge = this.merge!;
    this.recoverReserves();
    if (verification?.accountExists !== true) return this.finish("closed", null, null);
    return this.finish(
      "closed",
      `The merge (${merge.hash}) applied in ledger ${merge.ledger}, but Horizon still returned the account at the final check; check it on the explorer.`,
      {
        code: "ACCOUNT_STILL_EXISTS",
        stage: "confirm",
        verdict: "stop",
        detail: `The merge (${merge.hash}) applied in ledger ${merge.ledger}, but Horizon still returns the account.`,
        hash: merge.hash,
      },
    );
  }

  /**
   * Review finding 2: the account is gone although the run never saw its merge apply (a lost
   * lookup, or a rebuilt merge refused with tx_no_source_account). The merge envelopes the run
   * posted that could have applied are looked up once more: one found applied makes the run a
   * close like any other. If none is confirmed the account is still verified gone, so the run is
   * reported closed with a message saying the merge was not confirmed, never failed. Null when the
   * account exists, or when no merge envelope of this run could have applied: none was posted, or
   * every one was refused before inclusion or failed on the ledger. Then someone else removed the
   * account, and the stop stands (review round 3, R3-1).
   */
  private async closedUnseen(
    verification: NonNullable<CloseReport["verification"]>,
  ): Promise<CloseReport | null> {
    if (this.merge || verification.accountExists) return null;
    const merges = this.mergeCandidates();
    if (merges.length === 0) return null;
    for (const entry of merges) {
      const lookup = await lookupTransaction(this.input.submitter, entry.hash);
      if (lookup.kind !== "found") continue;
      const found = outcomeFromRecord(entry.hash, lookup.record);
      if (found.kind !== "applied") continue;
      recordOutcome(entry, found);
      this.applied(this.envelopeSteps.get(entry.hash)!, {
        kind: "applied",
        entry,
        resultXdr: found.resultXdr,
      });
      this.recoverReserves();
      return this.finish("closed", null, null);
    }
    this.recoverReserves();
    return this.finish(
      "closed",
      `The account is gone (Horizon answered 404) after this run posted its merge (${merges.map((t) => t.hash).join(", ")}), but the merge was not confirmed by hash, so the merged amount is not known; check the destination on the explorer.`,
      null,
    );
  }

  /**
   * The final check, when a failure of it must not change the run's outcome (review finding 4):
   * without a merge the account's state is only informative, so a check that throws leaves
   * `verification` null, keeps the real stop (or the partial result) and adds a warning. After a
   * merge an unverified close must not pass for a verified one, so the error is thrown as before
   * (review finding R1).
   */
  private async verifyOrWarn(): Promise<NonNullable<CloseReport["verification"]> | null> {
    if (this.merge) return this.verify();
    try {
      return await this.verify();
    } catch (error) {
      const why =
        error instanceof DustinError
          ? `${error.code}: ${error.message}`
          : error instanceof Error
            ? error.message
            : String(error);
      this.report.warnings.push(
        `The final check of the account failed (${why}); its state after the run was not verified.`,
      );
      return null;
    }
  }

  /**
   * Before the final check, every envelope still `unknown` is looked up once more (edge case E5): a
   * Horizon that lagged may have caught up. One found applied has its steps recorded (and, if it
   * carried the merge, makes the run a close); one found failed is recorded as failed.
   */
  private async settleUnknown(): Promise<void> {
    for (const entry of this.report.transactions) {
      if (entry.result !== "unknown") continue;
      const lookup = await lookupTransaction(this.input.submitter, entry.hash);
      if (lookup.kind !== "found") continue;
      const found = outcomeFromRecord(entry.hash, lookup.record);
      recordOutcome(entry, found);
      this.settledLate.add(entry.hash);
      if (found.kind === "applied") {
        this.applied(this.envelopeSteps.get(entry.hash) ?? [], {
          kind: "applied",
          entry,
          resultXdr: found.resultXdr,
        });
      } else {
        this.publish();
      }
    }
  }

  /** The final check; it waits for the 404 only when a merge applied. */
  private async verify(): Promise<NonNullable<CloseReport["verification"]>> {
    this.stage = "confirm";
    const v = await verifyClosed(this.input.plan.account, {
      reader: this.input.reader,
      config: this.input.config,
      timeoutMs: this.merge ? (this.input.options.verifyTimeoutMs ?? 30_000) : 0,
      intervalMs: this.settings.pollIntervalMs,
      sleep: this.settings.sleep,
      now: this.settings.now,
    });
    this.report.verification = v;
    this.emit({ type: "verified", accountExists: v.accountExists });
    return v;
  }

  /**
   * Reserves that went back to reserve sponsors, from the removals that applied, in whichever
   * round they applied (edge case E9): each removed trustline, pool share and offer is credited to
   * the sponsor that its round's plan named. When the account is verified gone after this run's
   * merge, the sponsored signers and account entry the merge removed are credited too, as the plan
   * that carried the merge listed them; an unconfirmed merge counts as applied then, with the rest
   * of its transaction, because the account being gone proves every entry of it is gone.
   * Units follow the planner (src/plan/recovery.ts): one base reserve per trustline, offer and
   * signer, two per pool share and for the account entry (CAP-33).
   */
  private recoverReserves(): void {
    const gone = this.report.verification?.accountExists === false;
    const released = [...this.appliedSteps];
    const unconfirmed = gone && !this.merge ? this.postedMerge() : null;
    if (unconfirmed) {
      const steps = this.envelopeSteps.get(unconfirmed.hash) ?? [];
      released.push(...steps.map((step) => ({ step, round: unconfirmed.round })));
    }
    const bySponsor = new Map<string, { stroops: bigint; entries: string[] }>();
    for (const { step, round } of released) {
      const plan = this.roundPlans[round] ?? this.input.fresh;
      const reserve = toStroops(plan.reserve.baseReserve);
      const credit = (sponsor: string | null | undefined, units: bigint, entry: string) => {
        if (!sponsor) return;
        const current = bySponsor.get(sponsor) ?? { stroops: 0n, entries: [] };
        current.stroops += units * reserve;
        current.entries.push(entry);
        bySponsor.set(sponsor, current);
      };
      // A step names the sponsor of a trustline or pool share; the sponsors of offers, signers and
      // the account entry are recorded only in the plan's recovery summary, under these labels.
      const listed = new Map(
        plan.recovery.reservesReturnedToSponsors.flatMap(({ sponsor, entries }) =>
          entries.map((entry) => [entry, sponsor] as const),
        ),
      );
      const { subject } = step;
      if (step.kind === "remove_trustline" && subject.type === "trustline") {
        credit(subject.sponsor, 1n, `trustline ${assetKey(subject.asset)}`);
      } else if (step.kind === "remove_trustline" && subject.type === "pool_share") {
        credit(subject.sponsor, 2n, `pool share ${subject.poolId}`);
      } else if (step.kind === "cancel_offer" && subject.type === "offer") {
        credit(listed.get(`offer ${subject.offerId}`), 1n, `offer ${subject.offerId}`);
      } else if (step.kind === "merge" && gone) {
        for (const [entry, sponsor] of listed) {
          if (entry.startsWith("signer ")) credit(sponsor, 1n, entry);
          if (entry === "account entry") credit(sponsor, 2n, entry);
        }
      }
    }
    this.report.recovery.reservesReturnedToSponsors = [...bySponsor.entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([sponsor, { stroops, entries }]) => ({
        sponsor,
        xlm: formatStroops(stroops),
        entries,
      }));
  }

  /** The last merge-carrying envelope this run posted that could have applied. */
  private postedMerge(): SubmittedTransaction | null {
    return this.mergeCandidates().at(-1) ?? null;
  }

  /**
   * The merge-carrying envelopes this run posted whose outcome is not known: `unknown`, or
   * `pending` in a run interrupted mid-POST. Only these could have removed the account; one
   * refused before inclusion or failed on the ledger cannot have (review round 3, R3-1).
   */
  private mergeCandidates(): SubmittedTransaction[] {
    return this.report.transactions.filter(
      (t) =>
        t.attempts > 0 &&
        (t.result === "unknown" || t.result === "pending") &&
        (this.envelopeSteps.get(t.hash) ?? []).some((s) => s.kind === "merge"),
    );
  }

  /**
   * Review finding R1: an exception after the report exists must not lose it. The report is
   * finished (`closed` if the merge applied, else `failed` once something was submitted, else
   * `aborted`), records the error, is published, and travels on the thrown DustinError.
   */
  private interrupted(error: unknown): DustinError {
    const err =
      error instanceof DustinError
        ? error
        : new DustinError(
            "EXECUTION_INTERRUPTED",
            `The close stopped on an unexpected error: ${error instanceof Error ? error.message : String(error)}.`,
            { stage: this.stage, cause: error },
          );
    // An envelope counts only once its POST started; one recorded but never posted does not.
    const submitted = this.report.transactions.filter((t) => t.attempts > 0).length;
    this.merge ??= this.mergeInReport();
    // `stage` says where the run was; the thrown error keeps the stage it was raised with (a read
    // that fails while transaction 2 is built reports "inspect" on the error, "build" here).
    const stop: StopReason = {
      code: err.code,
      stage: this.stage,
      verdict: err.verdict,
      detail: err.message,
      round: this.round,
    };
    const accountUrl = `${this.input.config.explorerBaseUrl}/account/${this.input.plan.account}`;
    const [status, message]: [FinalStatus, string] = this.merge
      ? [
          "closed",
          `The merge applied in ledger ${this.merge.ledger} (${this.merge.hash}), but the run was interrupted before the account was verified gone (${err.code}): ${err.message} Check ${accountUrl}.`,
        ]
      : submitted > 0
        ? [
            "failed",
            `The close stopped on ${err.code} (${err.stage}): ${err.message} ${submitted} envelope(s) were submitted; every hash is in this report. Run the close again to continue from the ledger.`,
          ]
        : [
            "aborted",
            `The close stopped on ${err.code} before anything was submitted: ${err.message}`,
          ];
    try {
      this.finish(status, message, stop);
    } catch {
      // The caller's onReport failed; the report still travels on the error.
    }
    return error instanceof DustinError
      ? error.withReport(this.report)
      : new DustinError(err.code, err.message, {
          stage: err.stage,
          cause: error,
          report: this.report,
        });
  }
}

/**
 * The planner input that reproduces `plan` from live state (review finding R12): every option the
 * user planned with, read back from the plan (`options`, `fees`, `memo`, `ladderOrder`), with the
 * execute options' fee cap and budget taking precedence. A plan serialised before `options` was
 * recorded gets the defaults, which is what it was made with.
 */
function replanInput(plan: ClosePlan, sponsorKey: string, options: ExecuteOptions): PlanCloseInput {
  return {
    account: plan.account,
    destination: plan.destination,
    feeSponsor: sponsorKey,
    ...(plan.memo ? { memo: plan.memo } : {}),
    ...(plan.ladderOrder === "prefer-destination" ? { preferDestination: true } : {}),
    ...(plan.options
      ? {
          slippageBps: plan.options.slippageBps,
          maxOpsPerTransaction: plan.options.maxOpsPerTransaction,
          maxWaitLedgers: plan.options.maxWaitLedgers,
        }
      : {}),
    ...(plan.fees.basis === "override" ? { baseFeeStroops: plan.fees.baseFeeStroops } : {}),
    maxBaseFeeStroops: options.maxBaseFeeStroops ?? plan.fees.maxBaseFeeStroops,
    budgetStroops: options.budgetStroops ?? plan.fees.budgetStroops,
  };
}
