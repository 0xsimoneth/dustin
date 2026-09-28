import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { formatStroops, toStroops } from "../../src/amounts.js";
import { containsSecretSeed } from "../../src/errors/redact.js";
import type { CloseReport } from "../../src/execute/report.js";
import type { ClosePlan } from "../../src/plan/model.js";
import type { FixtureManifest } from "../../src/fixture/manifest.js";
import type { VerifyResult } from "../../src/fixture/verify.js";

/** An account's XLM position as Horizon showed it, or null when Horizon answered 404. */
export interface AccountState {
  balance: string;
  numSponsoring: number;
}

/** Everything a live close leaves behind that a reviewer needs to check it independently. */
export interface CloseEvidence {
  /** The report `executeClose()` returned (public keys, hashes, both envelopes, result codes). */
  report: CloseReport;
  /** The fixture's public manifest: public keys, assets, offers, construction hashes. */
  manifest: FixtureManifest;
  /** The fixture verification (SOW Appendix B checks) run right before the close. */
  verification: VerifyResult;
  /** Horizon `GET /accounts/{fixture}` right before the close. */
  accountBefore: unknown;
  /** Horizon `GET /transactions/{hash}` of every submitted hash, in submission order. */
  transactions: Array<{ hash: string; record: unknown }>;
  /** Horizon `GET /accounts/{fixture}` after the close: status and body, 404 when merged. */
  accountAfter: { status: number; body: unknown };
  /** XLM positions before and after the close, by role (destination, reserve sponsor, ...). */
  balances: Array<{
    role: string;
    account: string;
    before: AccountState | null;
    after: AccountState | null;
  }>;
  /** The latest ledger before the close started and after it was verified. */
  ledgers: { before: number; after: number };
  /** The plan the close was approved with (written as plan.json), and its text (plan.txt). */
  plan?: ClosePlan;
  planText?: string;
}

export interface WriteEvidenceOptions {
  /** The directory that holds the runs, e.g. `evidence/runs`. */
  root: string;
  /** Strings that must appear in no file, e.g. the fixture's secret keys. */
  forbidden?: readonly string[];
  now?: Date;
  /**
   * Appended to the directory name, `<UTC stamp>-<label>` (for example `e3` for the Epic 3 close):
   * lower-case letters, digits and hyphens only.
   */
  label?: string;
}

/**
 * Throws unless `label` can end a run directory's name, `<UTC stamp>-<label>`: lower-case letters,
 * digits and hyphens, starting with a letter or a digit, so it can never leave `root`. A live close
 * checks its label with this before it builds a fixture, so a label the writer would refuse never
 * costs a spent fixture its record (review finding CC-11).
 */
export function assertEvidenceLabel(label: string): void {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(label)) {
    throw new Error(
      `Evidence label ${JSON.stringify(label)} must be lower-case letters, digits and hyphens.`,
    );
  }
}

/** `20260926T134512Z`: sortable, and valid in a path on every platform. */
export function runStamp(date: Date): string {
  return date
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d+Z$/, "Z");
}

const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

/**
 * Writes the evidence of one live close to `<root>/<UTC stamp>/` and returns that directory
 * (review finding R16). The explorer links die at the next testnet reset, so the files keep the
 * report with both envelopes, the Horizon JSON of every transaction and the 404 of the closed
 * account (docs/README.md canonical decision 12). Secrets cannot be written: every file is built
 * first and scanned for a seed-shaped string (`containsSecretSeed`) and for each `forbidden`
 * string; one hit refuses the whole run and nothing is written. An existing run is never
 * overwritten.
 */
export function writeCloseEvidence(evidence: CloseEvidence, options: WriteEvidenceOptions): string {
  const now = options.now ?? new Date();
  if (options.label !== undefined) assertEvidenceLabel(options.label);
  const name = options.label ? `${runStamp(now)}-${options.label}` : runStamp(now);
  const files = new Map<string, string>([
    ["summary.md", summary(evidence, name, now)],
    ...(evidence.plan ? [["plan.json", json(evidence.plan)] as [string, string]] : []),
    ...(evidence.planText !== undefined
      ? [
          [
            "plan.txt",
            evidence.planText.endsWith("\n") ? evidence.planText : `${evidence.planText}\n`,
          ] as [string, string],
        ]
      : []),
    ["report.json", json(evidence.report)],
    ["fixture-manifest.json", json(evidence.manifest)],
    ["fixture-verification.json", json(evidence.verification)],
    ["account-before.json", json(evidence.accountBefore)],
    ...evidence.transactions.map((t, i): [string, string] => [
      `tx-${i + 1}.json`,
      json({ hash: t.hash, horizon: t.record }),
    ]),
    ["account-after.json", json(evidence.accountAfter)],
    ["balances.json", json({ ledgers: evidence.ledgers, accounts: evidence.balances })],
  ]);
  for (const [name, content] of files) {
    if (containsSecretSeed(content)) {
      throw new Error(`Refusing to write evidence: ${name} contains a secret seed.`);
    }
    if ((options.forbidden ?? []).some((secret) => secret !== "" && content.includes(secret))) {
      throw new Error(`Refusing to write evidence: ${name} contains a forbidden secret.`);
    }
  }
  const dir = join(options.root, name);
  mkdirSync(options.root, { recursive: true });
  // Not recursive: an existing run directory throws EEXIST instead of being overwritten.
  mkdirSync(dir);
  for (const [name, content] of files) writeFileSync(join(dir, name), content);
  return dir;
}

function summary(e: CloseEvidence, name: string, now: Date): string {
  const r = e.report;
  const explorer = e.manifest.network.explorerBaseUrl;
  const horizon = r.network.horizon;
  const accountLink = (id: string) => `[${id}](${explorer}/account/${id})`;
  const role = (name: string, id: string) => `| ${name} | ${accountLink(id)} |`;
  const records = new Map(e.transactions.map((t) => [t.hash, t.record]));
  const txRows = r.transactions.map((t, i) => {
    const found = records.get(t.hash);
    // An envelope refused before inclusion, or rebuilt after its time bound passed, is not on
    // the ledger at all (E2-S3 keeps every submitted hash); only the next attempt carries it.
    if (found === null || found === undefined) {
      return [
        i + 1,
        t.phase,
        `\`${t.hash}\``,
        "-",
        "-",
        `not on the ledger (${t.result})`,
        "-",
        "-",
        `[explorer](${t.explorerUrl})`,
        `[Horizon](${horizon}/transactions/${t.hash})`,
      ].join(" | ");
    }
    const record = found as {
      fee_account?: string;
      source_account?: string;
      successful?: boolean;
    };
    return [
      i + 1,
      t.phase,
      `\`${t.hash}\``,
      t.ledger ?? "-",
      t.feeChargedStroops ?? "-",
      record.successful === true ? "yes" : "no",
      record.fee_account === r.feeSponsor ? "yes (sponsor)" : `no (${record.fee_account ?? "?"})`,
      record.source_account === r.account ? "yes" : `no (${record.source_account ?? "?"})`,
      `[explorer](${t.explorerUrl})`,
      `[Horizon](${horizon}/transactions/${t.hash})`,
    ].join(" | ");
  });
  const ledgers = r.transactions.map((t) => t.ledger).filter((l): l is number => l !== null);
  const moved = (s: { before: AccountState | null; after: AccountState | null }) =>
    s.before && s.after
      ? `${s.before.balance} -> ${s.after.balance} XLM (${formatSigned(toStroops(s.after.balance) - toStroops(s.before.balance))}), sponsoring ${s.before.numSponsoring} -> ${s.after.numSponsoring}`
      : `${s.before ? `${s.before.balance} XLM` : "missing"} -> ${s.after ? `${s.after.balance} XLM` : "missing (404)"}`;
  const checks = e.verification.checks.map(
    (c) =>
      `| ${c.pass ? "PASS" : "FAIL"} | ${c.appendixB ? "yes" : "no"} | ${c.label} | ${c.observed} |`,
  );
  return [
    `# Live close ${name}`,
    "",
    "Written by `test/testnet/execute-close.test.ts` with `DUSTIN_EVIDENCE=1`. Public data only: public keys, hashes, envelopes and Horizon JSON.",
    "",
    "| Field | Value |",
    "|---|---|",
    `| Captured (UTC) | ${now.toISOString()} |`,
    `| Close started / finished | ${r.startedAt} / ${r.finishedAt ?? "-"} |`,
    `| Network passphrase | \`${r.network.passphrase}\` |`,
    `| Horizon | ${horizon} |`,
    `| Ledgers | before the close ${e.ledgers.before}; transactions ${ledgers.join(", ") || "-"}; after verification ${e.ledgers.after} |`,
    `| Fixture | ${e.manifest.id} (profile ${e.manifest.profile}) |`,
    role("Closed account", r.account),
    role("Destination", r.destination),
    role("Fee sponsor (fee account of every transaction)", r.feeSponsor),
    role("Reserve sponsor", e.manifest.accounts.reserveSponsor),
    `| Status | ${r.status}${r.message ? ` (${r.message})` : ""} |`,
    `| Plan hash | \`${r.planHash}\` |`,
    `| Merged XLM (from the merge result) | ${r.recovery.mergedXlm ?? "-"} |`,
    `| Fees paid by the closed account / by the sponsor | ${r.recovery.feesPaidByAccount} / ${r.recovery.feesPaidBySponsorStroops} stroops |`,
    "",
    "## Transactions",
    "",
    "| # | Phase | Hash | Ledger | Fee charged (stroops) | Successful | Fee account is the sponsor | Source is the closed account | Explorer | Horizon |",
    "|---|---|---|---|---|---|---|---|---|---|",
    ...txRows.map((row) => `| ${row} |`),
    "",
    ...ladderSection(e),
    "## Fixture before the close (SOW Appendix B)",
    "",
    `Verification ${e.verification.pass ? "passed" : "FAILED"}.`,
    "",
    "| Result | Appendix B | Check | Observed |",
    "|---|---|---|---|",
    ...checks,
    "",
    "## After the close",
    "",
    `- \`GET ${horizon}/accounts/${r.account}\` answered HTTP ${e.accountAfter.status}${e.accountAfter.status === 404 ? ": the account no longer exists" : ""} (\`account-after.json\`).`,
    ...e.balances.map((s) => `- ${s.role} ${s.account}: ${moved(s)}.`),
    "",
    "## Files",
    "",
    ...(e.plan
      ? [
          "- `plan.json`: the close plan the run was approved with (`planClose()` output, read-only).",
        ]
      : []),
    ...(e.planText !== undefined
      ? ["- `plan.txt`: the same plan as `dustin plan` prints it."]
      : []),
    "- `report.json`: the close report, with the inner and fee-bump envelope XDR of every transaction.",
    "- `fixture-manifest.json`: the fixture's public manifest.",
    "- `fixture-verification.json`: the pre-close verification.",
    "- `account-before.json`: Horizon's view of the account before the close.",
    ...r.transactions.map(
      (t, i) => `- \`tx-${i + 1}.json\`: Horizon's record of transaction ${t.hash}.`,
    ),
    "- `account-after.json`: Horizon's answer for the account after the close.",
    "- `balances.json`: XLM positions before and after, and the ledgers.",
    "",
    "Explorer links resolve only until the next testnet reset (scheduled for 2026-12-16), which deletes every account and transaction; the JSON and XDR in this directory are the durable record.",
    "",
  ].join("\n");
}

/**
 * The disposal ladder as planned and as it ran: one row per balance the plan disposed of, with the
 * rung it was planned on, the rung it applied with (a failed sale falls down the ladder, E2-S3) and
 * the transaction that carried it.
 */
function ladderSection(e: CloseEvidence): string[] {
  const plan = e.plan;
  if (!plan) return [];
  const outcomes = new Map(e.report.steps.map((o) => [o.stepId, o]));
  const rows = plan.steps
    .filter((step) => step.kind === "dispose_balance" && step.disposal)
    .map((step) => {
      const subject = step.subject.type === "trustline" ? step.subject : null;
      const outcome = outcomes.get(step.id);
      return [
        step.id,
        subject ? `${subject.asset.code}:${subject.asset.issuer}` : "-",
        step.disposal!.amount,
        step.disposal!.rung,
        outcome?.rung ?? (outcome?.status === "applied" ? step.disposal!.rung : "-"),
        outcome?.status ?? "-",
        outcome?.txHash ? `\`${outcome.txHash}\`` : "-",
      ].join(" | ");
    });
  if (rows.length === 0) return [];
  return [
    "## Disposal ladder",
    "",
    `Ladder order: \`${plan.ladderOrder}\` (${plan.ladderOrder === "sow" ? "the SOW order: path payment, return to issuer, transfer to the destination" : "--prefer-destination: the destination before the return to issuer"}).`,
    "",
    "| Step | Asset | Amount | Planned rung | Applied rung | Outcome | Transaction |",
    "|---|---|---|---|---|---|---|",
    ...rows.map((row) => `| ${row} |`),
    "",
  ];
}

function formatSigned(stroops: bigint): string {
  return stroops >= 0n ? `+${formatStroops(stroops)}` : formatStroops(stroops);
}
