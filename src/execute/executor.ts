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
import { SECONDS_PER_LEDGER, sequenceGuard } from "../plan/guard.js";
import type { ClosePlan, CloseStep, PlannedTransaction } from "../plan/model.js";
import { DEFAULT_MAX_WAIT_LEDGERS } from "../plan/plan.js";
import { planClose, type PlanCloseInput } from "../plan/plan-close.js";
import { horizonJson, type LedgerSummary } from "../reader/horizon-json.js";
import { horizonReader, type LedgerReader } from "../reader/ledger-reader.js";
import type { Signer } from "../sponsor/signer.js";
import { FeeSponsor } from "../sponsor/sponsor.js";
import { abortReason, interruptibleSleep } from "./abort.js";
import {
  recordOutcome,
  submitPlannedTransaction,
  type AttemptContext,
  type AttemptSettings,
  type InterruptionPoint,
  type TransactionOutcome,
} from "./attempt.js";
import { operationFailure } from "./classify.js";
import type { CloseEvent } from "./events.js";
import { validateExecuteOptions } from "./options.js";
import { ledgerWaitLimitMs, mergePreflight, waitForLedger } from "./preflight.js";
import {
  describeSubject,
  replanDrift,
  rungOneAssets,
  stepIdentity,
  withPathsOnlyFor,
} from "./replan.js";
import {
  mayHaveApplied,
  mergeAmountFromResultXdr,
  type CloseReport,
  type CloseStatus,
  type SponsorState,
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
import { reportLinks } from "./summary.js";
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
   * When the account changed since the plan, when the fresh plan made before signing recovers less
   * XLM than the approved plan (a worse quote; review BH-7): the account's balance plus the quoted
   * sales, which the merge sends to the destination or, in a plan without a merge, the account
   * keeps (closing review CX-2), or when a mid-run re-plan finds something the approved plan did
   * not have: stop (default) or continue with the fresh plan.
   */
  onDrift?: "abort" | "replan";
  onEvent?: (event: CloseEvent) => void;
  /**
   * Called with a copy of the report whenever it changes (created, each submission attempt, each
   * outcome, each re-plan, finished, and right before an error is thrown), so a caller can persist
   * it while the run progresses (PRD FR-17, AC-E2-S3-6). Copies carry the status `running` until
   * the run finishes; the last copy carries the final status (blind review BH1). An async
   * observer whose promise rejects after the finish adds a warning and one more copy (CX-6).
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
  /**
   * Seconds of validity for each inner transaction; default 120, at most 3600: an envelope whose
   * outcome is not known is waited for until a ledger closes past its time bound.
   */
  timeoutSeconds?: number;
  /**
   * Pause between lookups by hash and between the final checks; default 2000 ms, at least 200, at
   * most 2^31 - 1 (Node's timer limit).
   */
  pollIntervalMs?: number;
  /**
   * How long to keep looking for an unconfirmed envelope after its time bound; default 10 s, at
   * most 3600 (closing review CX-9).
   */
  graceSeconds?: number;
  /** Re-plans allowed after operations failed on the ledger; default 3 (architecture 7.2). */
  maxReplans?: number;
  /** Envelopes per planned transaction, the first included; default 5. */
  maxAttemptsPerTransaction?: number;
  /** Posts of one envelope after HTTP 429; default 5. */
  maxRateLimitRetries?: number;
  /**
   * First pause after a 429, doubled each time; default 1000 ms, at least 200, at most 2^31 - 1,
   * and the doubled pause never goes beyond that limit either.
   */
  backoffMs?: number;
  /**
   * How long the final check waits for Horizon to answer 404 after a merge; default 30 s, at most
   * one hour (3,600,000 ms; closing review CX-9).
   */
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
   * A standard AbortSignal (https://nodejs.org/api/globals.html#class-abortsignal) that stops the
   * run at the next safe point (review finding CL-1, story E4-S2): no envelope is posted after the
   * abort; one already posted is looked up once more and settled, or recorded as unknown; a wait
   * (for an envelope's outcome, for the sequence guard) ends at once. The report is finished with
   * the stop INTERRUPTED, published and returned like every other stop: `aborted` when nothing was
   * posted, `failed` after a submission, `closed` when a merge of the run applied. A signal
   * aborted after the last transaction changes nothing. A string reason (the CLI gives "SIGINT" or
   * "SIGTERM") is named in the stop's detail.
   */
  signal?: AbortSignal;
  /**
   * How long to wait, beyond an unconfirmed envelope's time bound and the grace, for a ledger that
   * closed after the bound; after it the run stops with OUTCOME_UNKNOWN. Default 60 s, at most 3600
   * (closing review CX-9).
   */
  ledgerWaitSeconds?: number;
}

/**
 * Executes a close plan (SOW Deliverable 2). Every transaction is an inner transaction signed by
 * the account and wrapped in a fee bump signed by the sponsor (ADR-0003). Before anything is signed
 * the account is re-inspected and re-planned; a changed plan, or one that recovers less XLM than
 * the approved plan (review BH-7, closing review CX-2), aborts unless `onDrift: "replan"`.
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
  /** The failing operation code of each failure of a step, in order (closing review CX-4). */
  private readonly failureCodes = new Map<StepOutcome, string[]>();
  private sponsor: FeeSponsor | null = null;
  /** The injected pause as given; `settings.sleep` is the same pause, ended early by the signal. */
  private readonly rawSleep: Sleep;
  /** Where the run was interrupted, once it was (review finding CL-1). */
  private interruptedAt: { where: string; reason: string } | null = null;
  private stage: ErrorStage = "plan";
  private round = 0;
  private merge: { hash: string; ledger: number } | null = null;

  constructor(private readonly input: RunInput) {
    const { fresh, plan, sponsorKey, options, config } = input;
    this.report = {
      schemaVersion: 1,
      kind: "dustin-close-report",
      network: { passphrase: fresh.network.passphrase, horizon: fresh.network.horizon },
      account: plan.account,
      destination: plan.destination,
      feeSponsor: sponsorKey,
      planHash: fresh.planHash,
      // Review finding AA-9: the receipt's "Verify it yourself" links, in the persisted report too.
      links: reportLinks(config.explorerBaseUrl, config.horizonUrl, plan),
      // Until finish() sets the outcome, every published copy says the run is in progress.
      status: "running",
      message: null,
      stop: null,
      startedAt: new Date((options.now ?? Date.now)()).toISOString(),
      finishedAt: null,
      transactions: [],
      steps: fresh.steps.map((s) => ({ stepId: s.id, status: "not_run", txIndex: s.txIndex })),
      replans: [],
      // Copies: a blocker the run finds must never be pushed into a plan it emitted (R3-19).
      unclosable: [...fresh.unclosable],
      blockers: [...fresh.blockers],
      warnings: [...fresh.warnings],
      recovery: {
        mergedXlm: null,
        reservesReturnedToSponsors: [],
        feesPaidByAccount: "0",
        feesPaidBySponsorStroops: 0,
        sponsorsObserved: [],
      },
      verification: null,
    };
    fresh.steps.forEach((step, i) => this.outcomes.set(stepIdentity(step), this.report.steps[i]!));
    this.roundPlans = [fresh];
    this.rawSleep = options.sleep ?? timerSleep;
    const { signal } = options;
    this.settings = {
      timeoutSeconds: options.timeoutSeconds ?? 120,
      pollIntervalMs: options.pollIntervalMs ?? 2000,
      graceSeconds: options.graceSeconds ?? 10,
      backoffMs: options.backoffMs ?? 1000,
      maxAttempts: options.maxAttemptsPerTransaction ?? 5,
      maxRateLimitRetries: options.maxRateLimitRetries ?? 5,
      ledgerWaitSeconds: options.ledgerWaitSeconds ?? 60,
      now: options.now ?? (() => Date.now()),
      // Review finding CL-1: every wait of the run ends once the signal is aborted, and every loop
      // that sleeps checks the signal after the pause, so the wait never becomes a tight loop.
      sleep: interruptibleSleep(this.rawSleep, signal),
      ...(signal ? { aborted: () => signal.aborted } : {}),
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
   * An async observer (TypeScript accepts one for a `void` callback) whose promise rejects is
   * caught the same way, so it cannot end the process as an unhandled rejection; its warning is
   * recorded when the rejection arrives (review round 3, R3-15). A rejection that arrives once the
   * run has finished missed the last copy, so the report is published again with the warning: the
   * last copy (the --report file) says what the returned report says (closing review CX-6).
   */
  private observe(name: "onReport" | "onEvent", call: () => unknown): void {
    const failed = (error: unknown): boolean => {
      if (this.failedObservers.has(name)) return false;
      this.failedObservers.add(name);
      this.report.warnings.push(
        `The caller's ${name} callback threw (${error instanceof Error ? error.message : String(error)}); the run went on without it.`,
      );
      return true;
    };
    try {
      const result = call();
      if (isThenable(result)) {
        void result.then(undefined, (error: unknown) => {
          if (failed(error) && this.report.status !== "running") this.publish();
        });
      }
    } catch (error) {
      failed(error);
    }
  }

  private finish(status: FinalStatus, message: string | null, stop: StopReason | null) {
    this.report.status = status;
    this.report.message = message;
    this.report.stop = stop;
    this.report.finishedAt = this.timestamp();
    this.publish();
    const warnings = this.report.warnings.length;
    this.emit({ type: "done", status });
    // An onEvent that threw on "done" added a warning after the last copy: publish it too, so the
    // last copy (the --report file) says what the returned report says (review round 3, R3-20).
    if (this.report.warnings.length > warnings) this.publish();
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
    // Drift before anything is signed: a changed structure (plan hash), or less XLM recovered than
    // the caller approved, for the destination or, without a merge, for the account (closing
    // review CX-2). The plan hash leaves quotes and destMin out, so a sale quoted lower while the
    // confirmation waited changes only the amount (review BH-7).
    // Mid-run re-plans are judged by replanDrift() instead, where a failed sale may fall down the
    // ladder and lower the proceeds by design.
    const hashChanged = fresh.planHash !== plan.planHash;
    const fell = xlmFell(plan, fresh);
    // Closing review CX-3: a fresh plan without the approved plan's merge is named for what it is.
    const merges = (p: ClosePlan) => p.steps.some((s) => s.kind === "merge");
    const lostMerge = merges(plan) && !merges(fresh);
    // The warning for a run that goes on with the fresh plan: added only once every refusal below
    // has passed, so no stopped run says it went on (closing review CX-3).
    let wentOn: string | null = null;
    if (hashChanged || fell) {
      const action = options.onDrift ?? "abort";
      this.emit({
        type: "drift",
        action,
        previousPlanHash: plan.planHash,
        planHash: fresh.planHash,
        ...(fell ? { xlmToDestination: fell } : {}),
      });
      const amounts = fell
        ? `${recoveredXlmWords(plan, fresh)} fell from ${fell.approved} XLM to ${fell.fresh} XLM`
        : "";
      const noMerge = `the fresh plan no longer merges (status ${fresh.status})`;
      if (action === "abort") {
        if (hashChanged) {
          const clauses = [
            `The account changed since the plan was made (plan hash ${plan.planHash} is now ${fresh.planHash})`,
            ...(lostMerge ? [noMerge] : []),
            ...(fell ? [amounts] : []),
          ];
          const said =
            clauses.length > 1
              ? `${clauses.slice(0, -1).join(", ")}, and ${clauses.at(-1)!}`
              : clauses[0]!;
          return this.abort({
            code: "PLAN_CHANGED",
            stage: "plan",
            verdict: "replan",
            detail: `${said}; nothing was submitted. Review the new plan and run again.`,
            ...(fell ? { xlmToDestination: fell } : {}),
          });
        }
        return this.abort({
          code: "XLM_TO_DESTINATION_FELL",
          stage: "plan",
          verdict: "replan",
          detail: `Since the plan was approved, ${amounts} (a worse quote for a sale, or a lower balance); nothing was signed or submitted. Review the new plan and run again.`,
          xlmToDestination: fell!,
        });
      }
      const causes = [
        ...(lostMerge ? [noMerge] : []),
        ...(fell ? [`${amounts} (a worse quote for a sale, or a lower balance)`] : []),
      ];
      if (causes.length > 0) {
        wentOn = `Since the plan was approved, ${causes.join(", and ")}; the run went on with the fresh plan (onDrift "replan")${lostMerge ? " as a partial close (allowPartial): the account is not merged" : ""}.`;
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
    // Story E3-S3: the reserve sponsors as they are before anything is submitted.
    await this.observeSponsors("before");
    // Past every refusal before signing: only now has the run gone on with the fresh plan (CX-3).
    if (wentOn !== null) this.report.warnings.push(wentOn);
    // Review finding CA-11, PRD decision D-10: the plan hash leaves out the regrouping of the merge
    // that a near sequence guard causes, so a fresh plan with the approved hash may group the same
    // steps differently. The run follows the fresh plan's grouping and says so.
    const regrouped = !hashChanged ? regroupedWords(plan, fresh) : null;
    if (regrouped !== null) this.report.warnings.push(regrouped);
    this.sponsor = new FeeSponsor(this.input.signers.feeSponsor, {
      networkPassphrase: fresh.network.passphrase,
      budgetStroops: fresh.fees.budgetStroops,
      maxBaseFeeStroops: fresh.fees.maxBaseFeeStroops,
    });
    return this.runPlans();
  }

  /**
   * Story E3-S3: reads the reserve sponsors on Horizon and records their `num_sponsoring`, XLM
   * balance and minimum balance in `recovery.sponsorsObserved`: "before" the first submission, the
   * sponsors the executor's fresh plan names; "after" the final check, those and any a re-plan
   * named. A read that fails becomes a warning and leaves that figure null, so observing never
   * changes the outcome of a close.
   */
  private async observeSponsors(when: "before" | "after"): Promise<void> {
    const observed = (this.report.recovery.sponsorsObserved ??= []);
    const named = (plans: ClosePlan[]) =>
      plans.flatMap((p) => p.recovery.reservesReturnedToSponsors.map((x) => x.sponsor));
    const sponsors = [
      ...new Set(
        when === "before"
          ? named([this.input.fresh])
          : [...observed.map((o) => o.sponsor), ...named(this.roundPlans)],
      ),
    ];
    if (sponsors.length === 0) return;
    const moment = when === "before" ? "before the first submission" : "after the run";
    const warn = (sponsor: string, why: string) =>
      this.report.warnings.push(
        `The reserve sponsor ${sponsor} could not be read ${moment} (${why}); the report has no observed figure for it there.`,
      );
    const record = (sponsor: string, state: SponsorState | null) => {
      let entry = observed.find((o) => o.sponsor === sponsor);
      if (!entry) {
        entry = { sponsor, before: null, after: null };
        observed.push(entry);
      }
      entry[when] = state;
    };
    let ledger: LedgerSummary;
    try {
      ledger = await this.input.reader.latestLedger();
    } catch (error) {
      for (const sponsor of sponsors) {
        warn(sponsor, errorText(error));
        record(sponsor, null);
      }
      return;
    }
    for (const sponsor of sponsors) {
      try {
        const account = await this.input.reader.account(sponsor);
        if (!account) {
          warn(sponsor, "Horizon answered 404");
          record(sponsor, null);
          continue;
        }
        const reserve = reserveFromHorizon(account, BigInt(ledger.base_reserve_in_stroops));
        record(sponsor, {
          numSponsoring: account.num_sponsoring,
          balance: formatStroops(reserve.balance),
          minimumBalance: formatStroops(reserve.minimum),
          ledger: ledger.sequence,
        });
      } catch (error) {
        warn(sponsor, errorText(error));
        record(sponsor, null);
      }
    }
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
      horizonUrl: this.input.config.horizonUrl,
      settings: this.settings,
      record: (entry) => {
        this.envelopeSteps.set(entry.hash, steps);
        this.report.transactions.push(entry);
        this.publish();
      },
      withdraw: (entry) => {
        // Epic 4 review EX-1: recorded, never posted; only envelopes whose POST started are listed.
        const at = this.report.transactions.indexOf(entry);
        if (at >= 0) this.report.transactions.splice(at, 1);
        this.envelopeSteps.delete(entry.hash);
        this.publish();
      },
      changed: () => this.publish(),
      emit: (event) => this.emit(event),
      enter: (stage) => {
        this.stage = stage;
      },
      interruption: (at) => this.interruption(at),
    };
  }

  /**
   * The stop of a run whose signal was aborted, or null while it is not (review finding CL-1). The
   * run is at a safe point, which `at.where` names ("before transaction 2 (merge) was built"). An
   * envelope whose outcome is open (it may still apply, or it could not be looked up) is named with
   * its time bound, as for OUTCOME_UNKNOWN: a new envelope for its sequence number could only
   * replace it after that bound.
   */
  private interruption(at: InterruptionPoint): StopReason | null {
    const { signal } = this.input.options;
    if (!signal?.aborted) return null;
    const reason = abortReason(signal);
    this.interruptedAt = { where: at.where, reason };
    const open = at.envelope && outcomeOpen(at.envelope) ? at.envelope : undefined;
    const wait = open
      ? ` Its outcome is not known: run the close again only after a ledger has closed after ${new Date(open.maxTime * 1000).toISOString()} (its time bound, ${open.maxTime}); until then it may still apply, and a new envelope for the same sequence number could only replace it with a tenfold bid, which Dustin never relies on. The run then continues from the ledger.`
      : " Run the close again to continue from the ledger.";
    return {
      code: "INTERRUPTED",
      stage: this.stage,
      verdict: "replan",
      detail: `The run was interrupted (${reason}) ${at.where}; nothing was posted after the interruption.${wait}`,
      round: this.round,
      ...(at.txIndex !== undefined ? { txIndex: at.txIndex } : {}),
      ...(open ? { hash: open.hash, maxTime: open.maxTime } : {}),
    };
  }

  /** Runs the plan, and each re-plan after an operation failed on the ledger. */
  private async runPlans(): Promise<CloseReport> {
    let current = this.input.fresh;
    rounds: for (;;) {
      const byId = new Map(current.steps.map((s) => [s.id, s]));
      for (const tx of current.transactions) {
        // Review finding CL-1: the safe point before each planned transaction.
        const interrupted = this.interruption({
          where: `before transaction ${tx.index + 1} (${tx.phase})${this.round > 0 ? ` of round ${this.round}` : ""} was built`,
          txIndex: tx.index,
        });
        if (interrupted) return this.stopped(interrupted);
        const steps = tx.stepIds.map((id) => byId.get(id)!);
        // A merge that follows anything already submitted in this run (a later transaction, or the
        // first one of a re-plan) runs only after fresh facts (architecture rule R7). So does one
        // whose plan says the sequence guard does not hold yet, even as the plan's first and only
        // transaction: the plan promised a wait before it (story E3-S4, review finding R8).
        const carriesMerge = steps.some((s) => s.kind === "merge");
        const mergeFollowsWork = tx.index > 0 || this.report.transactions.length > 0;
        const guardWaits = current.sequenceGuard?.ok === false;
        if ((mergeFollowsWork || guardWaits) && carriesMerge) {
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
   * Fresh facts before a merge that follows work already submitted in this run, before a merge
   * whose plan says the sequence guard does not hold yet, and before every rebuild of a
   * merge-carrying transaction (architecture rule R7; edge case E2). When the sequence guard is all
   * that holds the merge back, it first waits for the ledger within the plan's bound (story E3-S4)
   * and checks again. Null when the merge may go; otherwise the stop: SEQNUM_TOO_FAR for the guard,
   * MERGE_PREFLIGHT_FAILED for anything else.
   */
  private async mergePreflightStop(
    current: ClosePlan,
    tx: PlannedTransaction,
    steps: CloseStep[],
  ): Promise<StopReason | null> {
    this.stage = "merge";
    const check = (knownLedger?: number) =>
      mergePreflight(this.input.reader, current, {
        mergeOnly: steps.every((s) => s.kind === "merge"),
        readAccount: () => this.freshAccount(),
        ...(knownLedger !== undefined ? { knownLedger } : {}),
      });
    let preflight = await check();
    const until = preflight.unblocksAtLedger;
    if (!preflight.ok && until !== undefined) {
      // Every other check passed: only the ledger has to move on (story E3-S4, review R8).
      const blocked = preflight;
      const waited = await this.waitForSequence(
        current,
        tx,
        until,
        blocked.currentLedger ?? until - 1,
      );
      if ("stop" in waited) {
        // An interrupted wait is no failed preflight (review finding CL-1).
        if (waited.stop.code !== "INTERRUPTED") {
          this.emit({ type: "preflight", index: tx.index, ok: false, detail: blocked.detail });
        }
        return waited.stop;
      }
      preflight = await check(waited.ledger);
      const later = preflight.unblocksAtLedger;
      if (!preflight.ok && later !== undefined) {
        // The account's sequence number moved on while the executor waited: another client
        // bumped it. The run stops rather than chase it.
        this.emit({ type: "preflight", index: tx.index, ok: false, detail: preflight.detail });
        return this.sequenceStop(
          tx,
          later,
          `the account's sequence number moved on while the executor waited for ledger ${until}, so the merge now has to wait until ledger ${later}.`,
        );
      }
    }
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
   * The wait for the sequence guard (story E3-S4, review finding R8). A merge fails with
   * ACCOUNT_MERGE_SEQNUM_TOO_FAR in every ledger before `untilLedger` (stellar-core
   * MergeOpFrame::isSeqnumTooFar), and a transaction submitted now lands at the earliest in the
   * ledger after the latest one closed, so the merge may go once ledger `untilLedger - 1` has
   * closed. The wait is allowed when `untilLedger` is at most the plan's `maxWaitLedgers` (default
   * 120) after the latest ledger, the planner's own rule, and it polls the latest ledger every
   * `pollIntervalMs` with the injected pause, for at most `ledgerWaitLimitMs` of the local clock.
   * Returns the ledger it saw close, or the SEQNUM_TOO_FAR stop when the wait would exceed the
   * bound or the bound ran out.
   */
  private async waitForSequence(
    current: ClosePlan,
    tx: PlannedTransaction,
    untilLedger: number,
    currentLedger: number,
  ): Promise<{ ledger: number } | { stop: StopReason }> {
    const maxWait = current.options?.maxWaitLedgers ?? DEFAULT_MAX_WAIT_LEDGERS;
    const ahead = untilLedger - currentLedger;
    if (ahead > maxWait) {
      return {
        stop: this.sequenceStop(
          tx,
          untilLedger,
          `the merge must wait until ledger ${untilLedger}, ${ahead} ledgers (${aboutTime(ahead)}) after the latest ledger ${currentLedger}, more than the plan allows (maxWaitLedgers ${maxWait}).`,
        ),
      };
    }
    const target = untilLedger - 1;
    this.emit({
      type: "wait",
      reason: "sequence",
      state: "start",
      index: tx.index,
      untilLedger,
      currentLedger,
    });
    // A read of the latest ledger that fails is a poll that did not reach the ledger: the wait
    // goes on until its limit (closing review CX-7).
    const waited = await waitForLedger(this.input.reader, target, {
      pollIntervalMs: this.settings.pollIntervalMs,
      limitMs: ledgerWaitLimitMs(target - currentLedger),
      sleep: this.settings.sleep,
      now: this.settings.now,
      knownLedger: currentLedger,
      ...(this.settings.aborted ? { aborted: this.settings.aborted } : {}),
    });
    if (waited.interrupted) {
      const stop = this.interruption({
        where: `while the merge waited for the sequence guard (it can land from ledger ${untilLedger}; the latest ledger was ${waited.ledger})`,
        txIndex: tx.index,
      });
      if (stop) return { stop };
    }
    if (!waited.reached) {
      const seconds = Math.round(waited.waitedMs / 1000);
      return {
        stop: this.sequenceStop(
          tx,
          untilLedger,
          waited.readError !== undefined
            ? `the executor waited ${seconds} s for ledger ${target} to close, but the last read of the latest ledger failed (${waited.readError}); the last ledger Horizon reported was ${waited.ledger}.`
            : `the executor waited ${seconds} s for ledger ${target} to close, but Horizon still reported ledger ${waited.ledger}: ledgers closed slower than the wait allows.`,
        ),
      };
    }
    this.emit({
      type: "wait",
      reason: "sequence",
      state: "end",
      index: tx.index,
      untilLedger,
      currentLedger: waited.ledger,
    });
    return { ledger: waited.ledger };
  }

  /** The stop before a merge that the sequence guard holds back (story E3-S4). */
  private sequenceStop(tx: PlannedTransaction, untilLedger: number, why: string): StopReason {
    return {
      code: "SEQNUM_TOO_FAR",
      stage: "merge",
      verdict: "replan",
      detail: `The sequence guard holds the merge back (ACCOUNT_MERGE_SEQNUM_TOO_FAR): ${why} The merge was not submitted. Run the close again at or after ledger ${untilLedger}; it continues from the ledger.`,
      round: this.round,
      txIndex: tx.index,
      unblocksAtLedger: untilLedger,
    };
  }

  /**
   * The closing account as Horizon has it. Instances behind one address can lag each other: a read
   * whose sequence number is below one this run saw used by its own included transactions comes
   * from a Horizon behind the one that took them, so it is read again after a short wait, at most
   * five times, and the last read is used as it is (edge cases E3, E4). Waiting costs a few
   * seconds; acting on the stale read would build at a used sequence number or refuse a clean merge.
   * Once the run is interrupted the pause ends at once, so the signal is checked after it and the
   * last read is used as it is: nothing is posted after the interruption anyway, and reading again
   * without a pause would poll Horizon back to back (Epic 4 review BH-2, EX-7).
   */
  private async freshAccount(): Promise<HorizonAccount | null> {
    const used = this.usedSequence();
    for (let read = 1; ; read++) {
      const account = await this.input.reader.account(this.input.plan.account);
      if (!account || BigInt(account.sequence) >= used || read >= 5) return account;
      await this.settings.sleep(this.settings.pollIntervalMs);
      if (this.settings.aborted?.()) return account;
    }
  }

  /**
   * The highest sequence number this run saw used: by its envelopes that applied or failed on the
   * ledger, by an envelope Horizon did not find while the account showed its number used (edge
   * case E5), and by a number a `tx_bad_seq` refusal proved used. The last two count too since
   * review round 3 (R3-11): a read below them is as stale as one below an applied transaction.
   */
  private usedSequence(): bigint {
    let most = 0n;
    for (const t of this.report.transactions) {
      const badSeq =
        t.result === "rejected" &&
        (t.resultCodes?.innerTransaction === "tx_bad_seq" ||
          t.resultCodes?.transaction === "tx_bad_seq");
      const used =
        t.result === "applied" ||
        t.result === "failed" ||
        (t.result === "unknown" && t.sequenceUsed === true) ||
        badSeq;
      if (used && BigInt(t.sequence) > most) most = BigInt(t.sequence);
    }
    return most;
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
      this.failureCodes.set(stepOutcome, [
        ...(this.failureCodes.get(stepOutcome) ?? []),
        failure.code,
      ]);
      this.publish();
    }
    // Every failure of this step in the run, this one last.
    const codes = (stepOutcome && this.failureCodes.get(stepOutcome)) ?? [failure.code];
    const stepId = stepOutcome?.stepId;
    const where = `Step ${stepId ?? `${failure.index + 1} of transaction ${tx.index + 1}`} (${step?.kind.replaceAll("_", " ") ?? "operation"}) failed with ${failure.code}: ${failure.explanation}`;
    const stopWith = (stop: Omit<StopReason, "stage" | keyof typeof at>): AfterFailure => ({
      kind: "stop",
      stop: { stage: "submit", ...at, ...(stepId ? { stepId } : {}), ...stop },
    });

    if (failure.code === "op_seq_num_too_far") {
      // Story E3-S4: the failed merge was included, so it consumed a sequence number (edge case
      // A-15). The guard is computed again for the next merge from the account as it is now.
      // Within the plan's bound the rest is planned again from the ledger: the new merge waits in
      // its preflight and is built at the new sequence number. Beyond the bound, or once the merge
      // has failed this way twice, the run stops and says when to run the close again.
      const [account, latest] = await Promise.all([
        reader.account(plan.account),
        reader.latestLedger(),
      ]);
      const guard = account
        ? sequenceGuard({
            sequence: account.sequence,
            observedLedger: latest.sequence,
            mergeTxIndex: 0,
          })
        : null;
      const unblocks = guard?.unblocksAtLedger ?? undefined;
      const maxWait =
        (this.roundPlans[this.round] ?? this.input.fresh).options?.maxWaitLedgers ??
        DEFAULT_MAX_WAIT_LEDGERS;
      // "This way" means op_seq_num_too_far: a failure of the merge with another code (a re-plan
      // code such as op_has_sub_entries) is counted apart (closing review CX-4).
      const twice = codes.filter((c) => c === "op_seq_num_too_far").length >= 2;
      const tooFar = unblocks !== undefined && unblocks - latest.sequence > maxWait;
      if (twice || tooFar) {
        const when =
          unblocks !== undefined ? ` Run the close again at or after ledger ${unblocks}.` : "";
        return stopWith({
          code: "SEQNUM_TOO_FAR",
          verdict: "replan",
          detail: twice
            ? `${where} The merge failed this way twice, so the run stops here.${when}`
            : `${where} The next merge would have to wait until ledger ${unblocks}, ${unblocks! - latest.sequence} ledgers after ledger ${latest.sequence}: more than the plan allows (maxWaitLedgers ${maxWait}).${when}`,
          ...(unblocks !== undefined ? { unblocksAtLedger: unblocks } : {}),
        });
      }
      return this.replanFrom({
        tx,
        hash: at.hash,
        codes: outcome.codes,
        explanation: failure.explanation,
        where,
        ...(stepId ? { stepId } : {}),
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
        // Each code when they differ, in order (closing review CX-4).
        reason: `Step ${stepOutcome.stepId} (${step?.kind.replaceAll("_", " ") ?? "operation"}, ${subject}) ${failedHow(codes)}: ${failure.explanation}`,
        // Review round 3, R3-5: --partial only lets a plan that cannot merge run; it is not an
        // input to the planner, so the next plan includes the same step again.
        remedy: `Look at the account's ${subject} on the explorer to find out why the step keeps failing, resolve that or wait until it settles, then run the close again, which plans from the ledger; --partial does not skip it, since the next plan includes the step again.`,
        permanent: false,
        stepId: stepOutcome.stepId,
        resultCodes: outcome.codes,
      });
      const times = codes.length === 2 ? "twice" : `${codes.length} times`;
      const before = codes.slice(0, -1);
      const earlier = before.every((c) => c === failure.code)
        ? ""
        : ` (${before.length === 1 ? "first" : "before this"} with ${before.join(", then ")})`;
      return stopWith({
        code: "STEP_FAILED_TWICE",
        verdict: "stop",
        detail: `${where} It failed ${times}${earlier}, so the run stops here, before the merge.`,
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
    /**
     * Set when the merge failed with op_seq_num_too_far within the plan's bound: the first ledger
     * the next merge can land in (closing review CX-5).
     */
    unblocksAtLedger?: number;
  }): Promise<AfterFailure> {
    const { options, reader, fresh, plan, sponsorKey } = this.input;
    const { tx, where, stepId, unblocksAtLedger } = trigger;
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
    // Closing review CX-5: after op_seq_num_too_far within the bound, waiting for a ledger is all
    // the merge needs, so a stop that cannot plan it again now is the guard's stop: verdict
    // replan, and the ledger to run the close again at.
    const guardStop = (why: string): AfterFailure | null =>
      unblocksAtLedger === undefined
        ? null
        : stopWith({
            code: "SEQNUM_TOO_FAR",
            verdict: "replan",
            detail: `${where} The next merge can land from ledger ${unblocksAtLedger}, but ${why} Run the close again at or after ledger ${unblocksAtLedger}; it continues from the ledger.`,
            unblocksAtLedger,
          });
    const maxReplans = options.maxReplans ?? 3;
    if (this.report.replans.length >= maxReplans) {
      return (
        guardStop(
          `the run already re-planned ${this.report.replans.length} times (maxReplans ${maxReplans}), so it cannot plan the merge again now.`,
        ) ??
        stopWith({
          code: "REPLAN_LIMIT",
          verdict: "stop",
          detail: `${where} The run already re-planned ${this.report.replans.length} times, so it stops here.`,
        })
      );
    }
    this.stage = "plan";
    const allowed = new Set([...rungOneAssets(fresh)].filter((a) => !this.demoted.has(a)));
    const paths = withPathsOnlyFor(reader, allowed);
    const next = await planClose(replanInput(plan, sponsorKey, options), {
      // The closing account is read as the attempt loop reads it: again, a bounded number of
      // times, while it lags the transactions this run saw use their sequence numbers. A stale
      // read would plan steps that already applied again (review round 3, R3-11).
      reader: {
        ...paths,
        account: (id) => (id === plan.account ? this.freshAccount() : paths.account(id)),
      },
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
    // Copies, as in the constructor: the re-plan was emitted as it is (review round 3, R3-19).
    this.report.unclosable = [...next.unclosable];
    this.report.blockers = [...next.blockers];
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
      const { totalStroops, budgetStroops } = next.fees;
      return (
        guardStop(
          `the re-plan's fee bids total ${totalStroops} stroops, more than the ${left} stroops left of the close budget of ${budgetStroops} stroops; nothing more was signed.`,
        ) ??
        stopWith({
          code: "OVER_BUDGET",
          stage: "sponsor",
          verdict: "stop",
          detail: `${where} The re-plan's fee bids total ${totalStroops} stroops, more than the ${left} stroops left of the close budget of ${budgetStroops} stroops; nothing more was signed. Raise the close budget or wait for network fees to fall, then run the close again.`,
        })
      );
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
    if (stop.code === "INTERRUPTED" && this.interruptedAt) {
      // Review finding CL-1: the envelope the interruption left open is settled now, so its time
      // bound no longer matters.
      const { maxTime: _settled, ...rest } = stop;
      const { where, reason } = this.interruptedAt;
      return {
        ...rest,
        detail: `The run was interrupted (${reason}) ${where}; nothing was posted after the interruption. Looked up again before the final check, envelope ${entry.hash} was ${found}; no time bound needs to pass first: run the close again to continue from the ledger.`,
      };
    }
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
   * every one was refused before inclusion, failed on the ledger (review round 3, R3-1) or was
   * judged unable to apply by the run itself (closing review CX-1; `mergeCandidates`). Then
   * someone else removed the account, and the stop stands.
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
      // The final check's own loop does not watch the signal, so it gets the pause as given; it
      // waits only after a merge applied, when the run is complete anyway (review finding CL-1).
      sleep: this.rawSleep,
      now: this.settings.now,
    });
    this.report.verification = v;
    this.emit({ type: "verified", accountExists: v.accountExists });
    // Story E3-S3: the reserve sponsors as they are after the final check.
    await this.observeSponsors("after");
    return v;
  }

  /**
   * Reserves that went back to reserve sponsors, from the removals that applied, in whichever
   * round they applied (edge case E9): each removed trustline, pool share and offer is credited to
   * the sponsor that its round's plan named. When the account is verified gone after this run's
   * merge, the sponsored signers and account entry the merge removed are credited too, as the plan
   * that carried the merge listed them; an unconfirmed merge counts as applied then, with the rest
   * of its transaction, because the account being gone proves every entry of it is gone.
   * For the same reason, every sponsored entry that any round's plan named is credited then, with
   * the sponsor of the latest plan naming it, whether a confirmed removal of this run, an envelope
   * that applied unseen or another party removed it (review round 3, R3-12).
   * Units follow the planner (src/plan/recovery.ts): one base reserve per trustline, offer and
   * signer, two per pool share and for the account entry (CAP-33).
   */
  private recoverReserves(): void {
    const gone = this.report.verification?.accountExists === false;
    const unconfirmed = gone && !this.merge ? this.postedMerge() : null;
    const mergedByRun = gone && (this.merge !== null || unconfirmed !== null);
    if (mergedByRun) this.markGoneSteps(unconfirmed);
    const bySponsor = new Map<string, { stroops: bigint; entries: string[] }>();
    const credit = (
      plan: ClosePlan,
      sponsor: string | null | undefined,
      units: bigint,
      entry: string,
    ) => {
      if (!sponsor) return;
      const current = bySponsor.get(sponsor) ?? { stroops: 0n, entries: [] };
      current.stroops += units * toStroops(plan.reserve.baseReserve);
      current.entries.push(entry);
      bySponsor.set(sponsor, current);
    };
    for (const { step, round } of this.appliedSteps) {
      const plan = this.roundPlans[round] ?? this.input.fresh;
      // A step names the sponsor of a trustline or pool share; the sponsors of offers, signers and
      // the account entry are recorded only in the plan's recovery summary, under these labels.
      const listed = new Map(
        plan.recovery.reservesReturnedToSponsors.flatMap(({ sponsor, entries }) =>
          entries.map((entry) => [entry, sponsor] as const),
        ),
      );
      const { subject } = step;
      if (step.kind === "remove_trustline" && subject.type === "trustline") {
        credit(plan, subject.sponsor, 1n, `trustline ${assetKey(subject.asset)}`);
      } else if (step.kind === "remove_trustline" && subject.type === "pool_share") {
        credit(plan, subject.sponsor, 2n, `pool share ${subject.poolId}`);
      } else if (step.kind === "cancel_offer" && subject.type === "offer") {
        credit(plan, listed.get(`offer ${subject.offerId}`), 1n, `offer ${subject.offerId}`);
      } else if (step.kind === "merge" && gone) {
        for (const [entry, sponsor] of listed) {
          if (entry.startsWith("signer ")) credit(plan, sponsor, 1n, entry);
          if (entry === "account entry") credit(plan, sponsor, 2n, entry);
        }
      }
    }
    if (mergedByRun) {
      const credited = new Set([...bySponsor.values()].flatMap((v) => v.entries));
      for (const plan of [...this.roundPlans].reverse()) {
        for (const { sponsor, entries } of plan.recovery.reservesReturnedToSponsors) {
          for (const entry of entries) {
            if (credited.has(entry)) continue;
            credited.add(entry);
            const double = entry.startsWith("pool share ") || entry === "account entry";
            credit(plan, sponsor, double ? 2n : 1n, entry);
          }
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

  /**
   * With the account verified gone after this run's merge every entry of it is gone, so the steps
   * of an envelope that may have applied unseen count as applied, not confirmed by hash (review
   * round 3, R3-12): those of the unconfirmed merge, and those of an envelope whose sequence number
   * is known used. A step still `not_run` is marked, and so is one that failed in an envelope
   * before the unseen one, which carried it again; it keeps its failure count (closing review
   * CX-10). One that another envelope applied, or that failed later, keeps its status.
   */
  private markGoneSteps(unconfirmed: SubmittedTransaction | null): void {
    const order = new Map(this.report.transactions.map((t, i) => [t.hash, i]));
    for (const entry of this.report.transactions) {
      const unseen = entry.result === "unknown" && entry.sequenceUsed === true;
      if (entry !== unconfirmed && !unseen) continue;
      const at = order.get(entry.hash)!;
      for (const step of this.envelopeSteps.get(entry.hash) ?? []) {
        const outcome = this.outcomes.get(stepIdentity(step));
        if (!outcome || outcome.status === "applied") continue;
        // A failed step is marked only when it failed before this envelope carried it again.
        if (outcome.status === "failed" && (order.get(outcome.txHash ?? "") ?? Infinity) >= at) {
          continue;
        }
        outcome.status = "applied";
        outcome.txHash = entry.hash;
        if (entry.round > 0) outcome.round = entry.round;
        if (step.disposal) outcome.rung = step.disposal.rung;
        outcome.explanation = `Not confirmed by hash: Horizon never returned envelope ${entry.hash}, but the account was verified gone after this run's merge, so this entry is gone too.`;
        this.appliedSteps.push({ step, round: entry.round });
      }
    }
  }

  /** The last merge-carrying envelope this run posted that could have applied. */
  private postedMerge(): SubmittedTransaction | null {
    return this.mergeCandidates().at(-1) ?? null;
  }

  /**
   * The merge-carrying envelopes this run posted that may have applied unseen: `pending` in a run
   * interrupted mid-POST, or `unknown` with a flag that leaves its fate open (`mayStillApply`,
   * `lookupError`, `sequenceUsed`). Only these could have removed the account; one refused before
   * inclusion or failed on the ledger cannot have (review round 3, R3-1), and neither can one the
   * run itself found gone past its time bound with its sequence number unused, which it judged
   * "can never apply" (closing review CX-1).
   */
  private mergeCandidates(): SubmittedTransaction[] {
    return this.report.transactions.filter(
      (t) =>
        t.attempts > 0 &&
        mayHaveApplied(t) &&
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
      // The removals that applied returned their reserves, interrupted or not (review round 3,
      // R3-13); the other finishing paths compute them the same way.
      this.recoverReserves();
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
 * True for an envelope whose outcome is open: posted and not settled, and it may still apply or
 * could not be looked up. A new envelope for its sequence number must wait for its time bound.
 */
function outcomeOpen(t: SubmittedTransaction): boolean {
  return (
    t.result === "pending" ||
    (t.result === "unknown" && (t.mayStillApply === true || t.lookupError !== undefined))
  );
}

/** A promise, or anything else with a `then` method: what an async observer returns. */
function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    value !== null &&
    (typeof value === "object" || typeof value === "function") &&
    typeof (value as { then?: unknown }).then === "function"
  );
}

/**
 * Both amounts when the fresh plan recovers less XLM than the approved one; null when it recovers
 * as much or more, which is not drift (review BH-7). What a plan recovers is the account's native
 * balance plus the quoted proceeds of its sales, in BigInt stroops: `recovery.xlmToDestination`
 * when the plan merges, and what the account keeps when it does not, where `xlmToDestination` is
 * 0 and would hide a worse quote (closing review CX-2).
 */
function xlmFell(
  approved: ClosePlan,
  fresh: ClosePlan,
): { approved: string; fresh: string } | null {
  const recovered = (p: ClosePlan) =>
    toStroops(p.recovery.nativeBalance) + toStroops(p.recovery.quotedProceedsXlm);
  const before = recovered(approved);
  const now = recovered(fresh);
  return now < before ? { approved: formatStroops(before), fresh: formatStroops(now) } : null;
}

/**
 * What the two amounts of a fall (`xlmFell`) measure, in words, from whether the plans merge: the
 * XLM the destination would receive when both do, the XLM the account would keep when neither does,
 * and the XLM the close would recover otherwise (closing review CX-2). The CLI's progress line uses
 * the same words.
 */
export function recoveredXlmWords(approved: ClosePlan, fresh: ClosePlan): string {
  const merges = (p: ClosePlan) => p.steps.some((s) => s.kind === "merge");
  if (merges(approved) && merges(fresh)) return "the XLM the destination would receive";
  if (!merges(approved) && !merges(fresh)) {
    return "the XLM the account would keep (its balance plus the quoted sales; the plan does not merge)";
  }
  return "the XLM the close would recover (the account's balance plus the quoted sales)";
}

/**
 * The warning for a fresh plan that has the approved plan's hash but groups its steps into other
 * transactions, or null when the groupings are the same. The hash leaves out only the regrouping of
 * the merge by a near sequence guard (review finding CA-11, PRD decision D-10): the guard cleared
 * after the plan was approved, so the merge joins the cleanup, or it holds now, so the merge waits
 * in a transaction of its own.
 */
function regroupedWords(approved: ClosePlan, fresh: ClosePlan): string | null {
  const grouping = (p: ClosePlan) => JSON.stringify(p.transactions.map((t) => t.stepIds));
  if (grouping(approved) === grouping(fresh)) return null;
  const mergeTx = (p: ClosePlan) => p.steps.find((s) => s.kind === "merge")?.txIndex;
  const before = mergeTx(approved);
  const now = mergeTx(fresh);
  if (before === undefined || now === undefined) return null;
  const alone = (p: ClosePlan, index: number) => (p.transactions[index]?.stepIds.length ?? 0) === 1;
  const was = `transaction ${before + 1} of ${approved.transactions.length}${alone(approved, before) ? ", alone" : ""}`;
  const is = `transaction ${now + 1} of ${fresh.transactions.length}`;
  const why =
    fresh.sequenceGuard?.ok === false
      ? `the sequence guard holds the merge until ledger ${fresh.sequenceGuard.unblocksAtLedger} now, so the merge waits alone in ${is}`
      : `the sequence guard cleared after the plan was approved, so the merge runs in ${is} with the cleanup`;
  return `The steps are the ones approved, but ${why} instead of in ${was}; the plan hash leaves this regrouping out (PRD decision D-10), and the run follows the fresh plan.`;
}

/** An error in a few words for a warning: its code and message when it is a DustinError. */
function errorText(error: unknown): string {
  if (error instanceof DustinError) return `${error.code}: ${error.message}`;
  return error instanceof Error ? error.message : String(error);
}

/**
 * How a step failed on the ledger, from the failing code of each of its failures in order: "failed
 * twice on the ledger with X" when they share one code, otherwise each code in order, so that a
 * STEP_FAILED_TWICE blocker never credits a failure to the wrong code (closing review CX-4).
 */
function failedHow(codes: string[]): string {
  const times = codes.length === 2 ? "twice" : `${codes.length} times`;
  if (new Set(codes).size <= 1) return `failed ${times} on the ledger with ${codes.at(-1) ?? ""}`;
  return codes.length === 2
    ? `failed twice on the ledger, first with ${codes[0]!}, then with ${codes[1]!}`
    : `failed ${times} on the ledger, with ${codes.slice(0, -1).join(", ")} and then ${codes.at(-1)!}`;
}

/** A wait of `ledgers` ledgers in words, at the observed 5 s per ledger (src/plan/guard.ts). */
function aboutTime(ledgers: number): string {
  const seconds = ledgers * SECONDS_PER_LEDGER;
  return seconds < 120 ? `about ${seconds} s` : `about ${Math.ceil(seconds / 60)} minutes`;
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
