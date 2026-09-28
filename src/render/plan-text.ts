import { formatStroops, toStroops } from "../amounts.js";
import type { AssetRef } from "../inspect/snapshot.js";
import type { ClosePlan, CloseStep, StepSubject, UnclosableItem } from "../plan/model.js";

/**
 * Renders a plan for people: plain ASCII, status as words, at most 120 columns
 * (docs/ux-design.md sections 2.4 and 2.10). The same data is available as JSON.
 */
const WIDTH = 120;

export function short(address: string): string {
  return address.length > 12 ? `${address.slice(0, 4)}...${address.slice(-4)}` : address;
}

const label = (a: AssetRef) => (a.type === "native" ? "XLM" : a.code);
const xlm = (stroops: number) => `${formatStroops(BigInt(stroops))} XLM`;
const grouped = (n: number) => n.toLocaleString("en-US");

function wrap(text: string, indent: number, width = WIDTH): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/)) {
    if (line && indent + line.length + 1 + word.length > width) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(line);
  return lines.map((l) => `${" ".repeat(indent)}${l}`);
}

function subjectCode(subject: StepSubject): string {
  return subject.type === "trustline" ? subject.asset.code : "";
}

/** What an item or a step acts on, in a few words: "0.0000003 DUSTB (issuer GABC...WXYZ)". */
export function subjectLabel(subject: StepSubject): string {
  switch (subject.type) {
    case "trustline":
      return `${subject.balance} ${subject.asset.code} (issuer ${short(subject.asset.issuer)})`;
    case "pool_share":
      return `pool share ${short(subject.poolId)} (balance ${subject.balance})`;
    case "offer":
      return `offer ${subject.offerId}`;
    case "data":
      return `data entry "${subject.name}"`;
    case "account":
      return "the account";
  }
}

/**
 * An item no rung can dispose of, for people (AC-E3-S2-3): its code and subject, why, each rung of
 * the ladder ruled out on a line of its own, and the remedy. The item's `reason` lists the ruled-out
 * rungs in one sentence for JSON readers; here they are shown as a list instead of that sentence.
 */
export function unclosableLines(item: UnclosableItem, indent: number): string[] {
  const lines = [
    `${" ".repeat(Math.max(0, indent - 2))}${item.code}  ${subjectLabel(item.subject)}`,
  ];
  const rungs = item.rungsRuledOut ?? [];
  if (rungs.length > 0 && item.subject.type === "trustline") {
    lines.push(
      ...wrap(
        `No route disposes of ${item.subject.balance} ${item.subject.asset.code}; every rung of the ladder is ruled out:`,
        indent,
      ),
    );
    for (const r of rungs) {
      // A hanging indent: continuation lines start under the text, not under the dash.
      const [first = "", ...rest] = wrap(`${r.rung.replaceAll("_", " ")}: ${r.reason}`, indent + 4);
      lines.push(`${" ".repeat(indent + 2)}- ${first.trimStart()}`, ...rest);
    }
  } else {
    lines.push(...wrap(item.reason, indent));
  }
  lines.push(...wrap(`remedy: ${item.remedy}`, indent));
  return lines;
}

export function stepAction(step: CloseStep): string {
  const s = step.subject;
  switch (step.kind) {
    case "cancel_offer":
      return s.type === "offer"
        ? `cancel offer ${s.offerId}: sells ${s.amount} ${label(s.selling)} for ${label(s.buying)}`
        : "cancel offer";
    case "dispose_balance": {
      const d = step.disposal;
      const amount = s.type === "trustline" ? s.balance : "";
      if (d?.rung === "path_payment") {
        return `sell ${amount} ${subjectCode(s)} for XLM: path payment, quote ${d.quotedXlm}, at least ${d.destMinXlm}`;
      }
      if (d?.rung === "return_to_issuer")
        return `return ${amount} ${subjectCode(s)} to issuer ${short(d.to)} (burn)`;
      return `send ${amount} ${subjectCode(s)} to destination ${short(d?.to ?? "")}`;
    }
    case "remove_trustline":
      if (s.type === "pool_share") {
        return `remove pool-share trustline ${short(s.poolId)}${s.sponsor ? ` (reserves sponsored by ${short(s.sponsor)})` : ""}`;
      }
      return s.type === "trustline" && s.sponsor
        ? `remove trustline ${s.asset.code} (reserve sponsored by ${short(s.sponsor)})`
        : `remove trustline ${subjectCode(s)}`;
    case "remove_data":
      return s.type === "data" ? `delete data entry "${s.name}"` : "delete data entry";
    case "merge":
      return s.type === "account"
        ? `merge into ${short(s.destination)} (cannot be undone)`
        : "merge";
  }
}

const STATUS: Record<ClosePlan["status"], string> = {
  closable: "CLOSABLE: the plan ends in a merge",
  partial: "PARTIAL: some items cannot be disposed of, so the account would not be merged",
  blocked: "BLOCKED: the merge is not possible today",
};

export interface RenderPlanOptions {
  /** The command to suggest at the end; omitted when not given. */
  next?: string;
  /** The first line; the default says the plan is a dry run. */
  heading?: string;
}

/** The sponsor's per-close budget and whether the plan's bid fits in it (review R2). */
function budgetLine(fees: ClosePlan["fees"]): string {
  const budget = `${xlm(fees.budgetStroops)} per close for the sponsor`;
  return fees.withinBudget
    ? `${budget}; the bid above is within it`
    : `${budget}; the bid above EXCEEDS it: wait for network fees to fall or lower the bid (--base-fee)`;
}

export function renderPlan(plan: ClosePlan, options: RenderPlanOptions = {}): string {
  const out: string[] = [];
  const sponsor = plan.feeSponsor ?? "(not given; pass --sponsor)";
  out.push(options.heading ?? "Dustin plan  (dry run: nothing is signed, nothing is submitted)");
  out.push(
    `Network      testnet   ledger ${grouped(plan.observed.ledger)}   observed ${plan.observed.closedAt}`,
  );
  out.push(`Account      ${plan.account}`);
  out.push(
    `Balance      ${plan.reserve.balance} XLM, minimum balance ${plan.reserve.minimum} XLM, ` +
      `spendable ${plan.reserve.spendable} XLM (base reserve ${plan.reserve.baseReserve})`,
  );
  out.push(`Destination  ${plan.destination}`);
  out.push(`Sponsor      ${sponsor}`);
  if (plan.memo !== null)
    out.push(`Memo         ${JSON.stringify(plan.memo)} (on every transaction)`);
  out.push(
    `Fees         bid up to ${xlm(plan.fees.totalStroops)} (${grouped(plan.fees.baseFeeStroops)} stroops per operation), ` +
      "paid by the sponsor; the account pays 0",
  );
  const [firstBudget = "", ...moreBudget] = wrap(budgetLine(plan.fees), 13);
  out.push(`Budget       ${firstBudget.trimStart()}`, ...moreBudget);
  out.push(`Status       ${STATUS[plan.status]}`);

  if (plan.steps.length > 0) {
    out.push("", "Steps, in execution order");
    for (const step of plan.steps) {
      out.push(`  ${step.id}  tx ${step.txIndex + 1}  ${stepAction(step)}`);
      out.push(...wrap(`why: ${step.reason}`, 13));
    }
    out.push(
      "",
      `Transactions (${plan.transactions.length}, each fee-bumped by the sponsor; inner fee 0)`,
    );
    for (const tx of plan.transactions) {
      out.push(
        `  tx ${tx.index + 1}  ${tx.phase.padEnd(8)} ${String(tx.opCount).padStart(3)} op${tx.opCount === 1 ? " " : "s"}   bid ${grouped(tx.feeBumpFeeStroops)} stroops`,
      );
      out.push(...wrap(tx.reason, 13));
    }
  }

  if (plan.unclosable.length > 0) {
    out.push("", "Cannot be disposed of (the account is not merged while these remain)");
    for (const item of plan.unclosable) out.push(...unclosableLines(item, 4));
  }
  if (plan.blockers.length > 0) {
    out.push("", "Blockers (the merge is not possible while these hold)");
    for (const b of plan.blockers) {
      out.push(`  ${b.code}${b.permanent ? " (permanent)" : ""}`);
      out.push(...wrap(b.reason, 4), ...wrap(`remedy: ${b.remedy}`, 4));
    }
  }
  if (plan.warnings.length > 0) {
    out.push("", "Warnings");
    for (const w of plan.warnings) out.push(...wrap(`- ${w}`, 2));
  }

  const r = plan.recovery;
  out.push("", plan.status === "closable" ? "If everything succeeds" : "Accounting");
  const entry = (e: string) => e.replace(/:G[A-Z2-7]{55}/g, "");
  out.push(
    ...wrap(
      `${r.xlmToDestination} XLM arrives at ${short(plan.destination)}` +
        (plan.status === "closable"
          ? ` (balance ${r.nativeBalance} + sale ${r.quotedProceedsXlm})`
          : " (nothing: the plan does not merge)"),
      2,
    ),
  );
  // UX-DR2 and AC-E3-S3-4: the reserves released to sponsors on a line of their own. A sponsored
  // entry's reserve returns to its sponsor, so xlmToDestination leaves it out (story E3-S3).
  const released = r.reservesReturnedToSponsors.reduce((sum, x) => sum + toStroops(x.xlm), 0n);
  out.push(
    ...wrap(
      r.reservesReturnedToSponsors.length > 0
        ? `Reserves released to sponsors: ${formatStroops(released)} XLM, never this account's`
        : "Reserves released to sponsors: none",
      2,
    ),
  );
  for (const x of r.reservesReturnedToSponsors) {
    out.push(
      ...wrap(
        `${x.xlm} XLM reserve unlocked for sponsor ${short(x.sponsor)} ` +
          `(${x.entries.map(entry).join(", ")})`,
        4,
      ),
    );
  }
  out.push("  0.0000000 XLM paid by the account; every fee is sponsored");
  if (plan.sequenceGuard) {
    const g = plan.sequenceGuard;
    out.push(
      g.ok
        ? `  sequence guard ok: sequence at merge ${g.sequenceAtMerge} is below ledger ${grouped(g.earliestLedger)} << 32`
        : `  sequence guard: the merge waits until ledger ${grouped(g.unblocksAtLedger ?? 0)} (about ${g.etaSeconds} s)`,
    );
  }
  out.push(`  plan hash ${plan.planHash}`);
  if (options.next) out.push("", `Next: ${options.next}`);
  return `${out.join("\n")}\n`;
}
