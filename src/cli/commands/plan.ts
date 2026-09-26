import { DEFAULT_MAX_BASE_FEE, MIN_BASE_FEE } from "../../config/fees.js";
import { DustinError } from "../../errors/dustin-error.js";
import type { ClosePlan } from "../../plan/model.js";
import { planClose } from "../../plan/plan-close.js";
import { horizonJson } from "../../reader/horizon-json.js";
import { horizonReader } from "../../reader/ledger-reader.js";
import { renderPlan } from "../../render/plan-text.js";
import { ExitCode } from "../exit-codes.js";
import type { CommandContext } from "./fixture.js";

export interface PlanCommandOptions {
  to?: string;
  destination?: string;
  sponsor?: string;
  preferDestination?: boolean;
  memo?: string;
  baseFee?: string;
  json?: boolean;
}

/** Builds the plan with GET requests only; `dustin plan` never reads a secret. */
export async function buildPlan(
  account: string,
  options: PlanCommandOptions,
  ctx: CommandContext,
): Promise<ClosePlan> {
  const config = ctx.config();
  const reader = horizonReader(
    horizonJson(config.horizonUrl, { ...(ctx.fetch ? { fetch: ctx.fetch } : {}), ...ctx.horizon }),
  );
  const baseFee = parseBaseFee(options.baseFee);
  return planClose(
    {
      account,
      destination: options.to ?? options.destination ?? "",
      ...(options.sponsor ? { feeSponsor: options.sponsor } : {}),
      ...(options.memo ? { memo: options.memo } : {}),
      ...(options.preferDestination ? { preferDestination: true } : {}),
      ...(baseFee !== undefined ? { baseFeeStroops: baseFee } : {}),
    },
    { config, reader },
  );
}

export function printPlan(
  plan: ClosePlan,
  options: PlanCommandOptions,
  ctx: CommandContext,
  next: string | undefined,
): void {
  if (options.json) {
    ctx.io.stdout(`${JSON.stringify(plan, null, 2)}\n`);
    return;
  }
  ctx.io.stdout(renderPlan(plan, next ? { next } : {}));
}

export async function planCommand(
  account: string,
  options: PlanCommandOptions,
  ctx: CommandContext,
): Promise<ExitCode> {
  const plan = await buildPlan(account, options, ctx);
  // Full addresses keep the command copyable; a shell line continuation keeps it within 120 columns.
  printPlan(plan, options, ctx, nextCommand(plan, options));
  // Canonical decision 5: a printed plan is exit 0, whatever its status.
  return ExitCode.OK;
}

/** `--base-fee` must be a whole number of stroops between the network minimum and the cap. */
export function parseBaseFee(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const n = /^\d+$/.test(value) ? Number(value) : Number.NaN;
  if (!Number.isSafeInteger(n) || n < MIN_BASE_FEE || n > DEFAULT_MAX_BASE_FEE) {
    throw new DustinError(
      "CONFIG_INVALID",
      `--base-fee must be a whole number of stroops from ${MIN_BASE_FEE} to ${DEFAULT_MAX_BASE_FEE}; got "${value}".`,
      { stage: "config" },
    );
  }
  return n;
}

/** The command that makes sense after this plan, with the flags that shaped it. */
export function nextCommand(plan: ClosePlan, options: PlanCommandOptions): string | undefined {
  const flags = [
    ...(options.preferDestination ? ["--prefer-destination"] : []),
    ...(options.memo ? [`--memo "${options.memo}"`] : []),
  ];
  const base = `dustin close ${plan.account} \\\n        --to ${plan.destination}${flags.map((f) => ` ${f}`).join("")}`;
  if (plan.status === "closable") return `${base} --execute`;
  if (plan.steps.length === 0) return undefined;
  const why =
    plan.status === "partial" ? "the items above stay" : "resolve the blockers above to close it";
  return `${base} --execute --partial\n      (runs everything that can run; the account is not merged: ${why})`;
}
