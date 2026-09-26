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
  const baseFee = options.baseFee !== undefined ? Number.parseInt(options.baseFee, 10) : undefined;
  return planClose(
    {
      account,
      destination: options.to ?? options.destination ?? "",
      ...(options.sponsor ? { feeSponsor: options.sponsor } : {}),
      ...(options.memo ? { memo: options.memo } : {}),
      ...(options.preferDestination ? { preferDestination: true } : {}),
      ...(baseFee !== undefined && Number.isFinite(baseFee) ? { baseFeeStroops: baseFee } : {}),
    },
    { config, reader },
  );
}

export function printPlan(
  plan: ClosePlan,
  options: PlanCommandOptions,
  ctx: CommandContext,
  next: string,
): void {
  if (options.json) {
    ctx.io.stdout(`${JSON.stringify(plan, null, 2)}\n`);
    return;
  }
  ctx.io.stdout(renderPlan(plan, { next }));
}

export async function planCommand(
  account: string,
  options: PlanCommandOptions,
  ctx: CommandContext,
): Promise<ExitCode> {
  const plan = await buildPlan(account, options, ctx);
  const flags = options.preferDestination ? " --prefer-destination" : "";
  // Full addresses keep the command copyable; a shell line continuation keeps it within 120 columns.
  printPlan(
    plan,
    options,
    ctx,
    `dustin close ${plan.account} \\\n        --to ${plan.destination}${flags} --execute`,
  );
  // Canonical decision 5: a printed plan is exit 0, whatever its status.
  return ExitCode.OK;
}
