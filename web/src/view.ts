import { stepAction, subjectLabel, type ClosePlan } from "stellar-dustin";
import { baseAccount, isDestinationAddress } from "./address";

/**
 * The plan as the page shows it: a pure mapping of the SDK's ClosePlan to words and rows, with
 * the status as a word (never a colour alone) and the CLI's wording for every step
 * (docs/ux-design.md, principle P6). Tested in test/view.test.ts without a browser.
 */

export type StatusWord = "CLOSABLE" | "PARTIAL" | "BLOCKED";

export interface ViewOptions {
  /** The `--partial` checkbox: it changes what the close would do, never the plan. */
  allowPartial: boolean;
  /** The explorer's base URL for account links, such as https://stellar.expert/explorer/testnet. */
  explorerBase: string;
}

export interface StepRow {
  id: string;
  /** 1-based transaction number, as the CLI prints it. */
  tx: number;
  action: string;
  why: string;
}

export interface TransactionRow {
  number: number;
  phase: string;
  opCount: number;
  bid: string;
  reason: string;
}

export interface BlockerRow {
  code: string;
  permanent: boolean;
  reason: string;
  remedy: string;
}

export interface UnclosableRow {
  code: string;
  subject: string;
  reason: string;
  remedy: string;
  rungs: Array<{ rung: string; reason: string }>;
}

export interface Link {
  label: string;
  /** The address as the plan holds it, always shown as text. */
  address: string;
  /**
   * The explorer page of `target`, or null when the address is not a G... or M... address with a
   * valid checksum: then there is nothing safe to link, and the address is text only (E5-S1
   * review, W3).
   */
  url: string | null;
  /** The account the URL opens: the address itself, or the base G... account of a muxed one. */
  target: string | null;
}

export interface PlanView {
  status: {
    word: StatusWord;
    /** The CLI's sentence after the word. */
    sentence: string;
    /** What the close would do with the `--partial` choice made on the form. */
    closeNote: string;
  };
  account: string;
  destination: string | null;
  sponsor: string | null;
  observed: { ledger: string; closedAt: string };
  /** Null when the account does not exist: Horizon answered 404, so nothing is known. */
  balance: { balance: string; minimum: string; spendable: string; baseReserve: string } | null;
  /** Null when the account does not exist: nothing moves. */
  recovery: {
    /** True for a closable plan, the only kind that ends in a merge and moves XLM to the destination. */
    merges: boolean;
    toDestination: string;
    detail: string;
    sponsors: Array<{ sponsor: string; xlm: string; entries: string[] }>;
  } | null;
  /** Null when the plan has no transaction: nothing to bid for. */
  fees: {
    bid: string;
    perOperation: string;
    budget: string;
    withinBudget: boolean;
    payer: string;
  } | null;
  steps: StepRow[];
  transactions: TransactionRow[];
  blockers: BlockerRow[];
  unclosable: UnclosableRow[];
  warnings: string[];
  sequenceGuard: string | null;
  links: Link[];
  planHash: string;
}

const WORD: Record<ClosePlan["status"], StatusWord> = {
  closable: "CLOSABLE",
  partial: "PARTIAL",
  blocked: "BLOCKED",
};

/** The CLI's words (src/render/plan-text.ts, STATUS). */
const SENTENCE: Record<ClosePlan["status"], string> = {
  closable: "the plan ends in a merge",
  partial: "some items cannot be disposed of, so the account would not be merged",
  blocked: "the merge is not possible today",
};

/**
 * Stroops as the CLI prints XLM: 7 decimals, as a string, no floating point. A value that is not
 * a finite number prints as "unknown" instead of "NaN.NaN XLM" (E5-S1 review, W3).
 */
export function xlm(stroops: number): string {
  if (!Number.isFinite(stroops)) return "unknown";
  const sign = stroops < 0 ? "-" : "";
  const abs = Math.abs(Math.trunc(stroops));
  const whole = Math.floor(abs / 10_000_000);
  const fraction = String(abs % 10_000_000).padStart(7, "0");
  return `${sign}${whole}.${fraction} XLM`;
}

/** A count with thousands separators, or "unknown" for a value that is not a finite number. */
const grouped = (n: number) => (Number.isFinite(n) ? n.toLocaleString("en-US") : "unknown");

export function shortAddress(address: string): string {
  return address.length > 12 ? `${address.slice(0, 4)}...${address.slice(-4)}` : address;
}

/**
 * What the close would do with the `--partial` choice on the form, in the executor's own terms
 * (src/execute/executor.ts): without `allowPartial` a plan that cannot end in a merge stops before
 * anything is signed (exit code 3); with it the close goes on without the merge and the account
 * stays open (exit code 4). `--partial` never clears a blocker, and without a destination the CLI
 * cannot even start (`--to` is required), so neither note promises a step there (E5-S1 review,
 * W1).
 */
function closeNote(plan: ClosePlan, allowPartial: boolean, missing: boolean): string {
  const n = plan.steps.length;
  const steps = `${n} step${n === 1 ? "" : "s"}`;
  switch (plan.status) {
    case "closable":
      return allowPartial
        ? "--partial changes nothing for this plan: every item can be disposed of, so the close would run every step and end in the merge."
        : "The close would run every step listed and end in the merge.";
    case "partial":
      return allowPartial
        ? `With --partial, the close would run the ${steps} listed and stop before the merge; the account would stay open (exit code 4).`
        : `Without --partial, the close refuses to start because of the items below that cannot be disposed of (exit code 3); with it, the ${steps} listed would run and the account would stay open.`;
    case "blocked":
      if (missing) return "Nothing can run: the account does not exist on the ledger.";
      if (plan.blockers.some((b) => b.code === "DESTINATION_MISSING")) {
        return n === 0
          ? "The CLI needs --to; nothing runs until a destination is given."
          : `The CLI needs --to; nothing runs until a destination is given. The ${steps} listed are the cleanup the planner can see without one.`;
      }
      if (n === 0) {
        return "Nothing can run today: the blockers below hold, and there is no cleanup the account's own key could do.";
      }
      return allowPartial
        ? `With --partial, the close may go on without the merge, which the blockers below still block: at most the ${steps} listed could run, and the account would stay open (exit code 4).`
        : `Without --partial, the close refuses to start while the blockers below hold (exit code 3). --partial does not clear a blocker: it only lets the close go on without the merge, at most the ${steps} listed, and the account would stay open (exit code 4).`;
  }
}

/** The shape of a G... or M... address; the checksum is checked by the StrKey functions. */
const ADDRESS_SHAPE = /^[GM][A-Z2-7]{55,68}$/;

/**
 * An explorer link for a G... or M... address with a valid checksum, and text only for anything
 * else. A muxed address links the base account it wraps, as the CLI's report does, since the
 * explorer has no page for the muxed form (E5-S1 review, W3).
 */
function explorerLink(base: string, label: string, address: string): Link {
  if (!ADDRESS_SHAPE.test(address) || !isDestinationAddress(address)) {
    return { label, address, url: null, target: null };
  }
  const target = baseAccount(address);
  return { label, address, url: `${base}/account/${encodeURIComponent(target)}`, target };
}

function links(plan: ClosePlan, explorerBase: string): Link[] {
  const base = explorerBase.replace(/\/+$/, "");
  const link = (label: string, address: string): Link => explorerLink(base, label, address);
  const out: Link[] = [link("Account", plan.account)];
  if (plan.destination) out.push(link("Destination", plan.destination));
  if (plan.feeSponsor) out.push(link("Fee sponsor", plan.feeSponsor));
  // One link per issuer, naming every asset of its that the plan touches.
  const issuers = new Map<string, Set<string>>();
  const subjects = [...plan.steps.map((s) => s.subject), ...plan.unclosable.map((u) => u.subject)];
  for (const subject of subjects) {
    if (subject.type !== "trustline") continue;
    const codes = issuers.get(subject.asset.issuer) ?? new Set<string>();
    codes.add(subject.asset.code);
    issuers.set(subject.asset.issuer, codes);
  }
  for (const [issuer, codes] of issuers) {
    out.push(link(`Issuer of ${[...codes].sort().join(", ")}`, issuer));
  }
  return out;
}

export function toView(plan: ClosePlan, options: ViewOptions): PlanView {
  const missing = plan.blockers.some((b) => b.code === "ACCOUNT_MISSING");
  const r = plan.recovery;
  const guard = plan.sequenceGuard;
  return {
    status: {
      word: WORD[plan.status],
      sentence: SENTENCE[plan.status],
      closeNote: closeNote(plan, options.allowPartial, missing),
    },
    account: plan.account,
    destination: plan.destination || null,
    sponsor: plan.feeSponsor,
    observed: { ledger: grouped(plan.observed.ledger), closedAt: plan.observed.closedAt },
    balance: missing ? null : plan.reserve,
    recovery: missing
      ? null
      : {
          merges: plan.status === "closable",
          toDestination: `${r.xlmToDestination} XLM`,
          detail:
            plan.status === "closable"
              ? `balance ${r.nativeBalance} + sale ${r.quotedProceedsXlm}`
              : "nothing arrives: the plan does not merge",
          sponsors: r.reservesReturnedToSponsors.map((x) => ({
            sponsor: x.sponsor,
            xlm: `${x.xlm} XLM`,
            // "trustline CODE:ISSUER" without the issuer, as the CLI prints it.
            entries: x.entries.map((e) => e.replace(/:G[A-Z2-7]{55}/g, "")),
          })),
        },
    fees:
      plan.transactions.length === 0
        ? null
        : {
            bid: xlm(plan.fees.totalStroops),
            perOperation: `${grouped(plan.fees.baseFeeStroops)} stroops per operation`,
            budget: xlm(plan.fees.budgetStroops),
            withinBudget: plan.fees.withinBudget,
            payer: plan.fees.payer,
          },
    steps: plan.steps.map((step) => ({
      id: step.id,
      tx: step.txIndex + 1,
      action: stepAction(step),
      why: step.reason,
    })),
    transactions: plan.transactions.map((t) => ({
      number: t.index + 1,
      phase: t.phase,
      opCount: t.opCount,
      bid: `${grouped(t.feeBumpFeeStroops)} stroops`,
      reason: t.reason,
    })),
    blockers: plan.blockers.map((b) => ({
      code: b.code,
      permanent: b.permanent,
      reason: b.reason,
      remedy: b.remedy,
    })),
    unclosable: plan.unclosable.map((item) => ({
      code: item.code,
      subject: subjectLabel(item.subject),
      reason: item.reason,
      remedy: item.remedy,
      rungs: (item.rungsRuledOut ?? []).map((x) => ({
        rung: x.rung.replaceAll("_", " "),
        reason: x.reason,
      })),
    })),
    warnings: [...plan.warnings],
    sequenceGuard:
      guard === null
        ? null
        : guard.ok
          ? `Sequence guard ok: the sequence number at the merge, ${guard.sequenceAtMerge}, is below ledger ${grouped(guard.earliestLedger)} << 32.`
          : `Sequence guard: the merge waits until ledger ${grouped(guard.unblocksAtLedger ?? 0)} (about ${guard.etaSeconds ?? 0} s).`,
    links: links(plan, options.explorerBase),
    planHash: plan.planHash,
  };
}
