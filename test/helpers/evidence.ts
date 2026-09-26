import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { formatStroops, toStroops } from "../../src/amounts.js";
import { containsSecretSeed } from "../../src/errors/redact.js";
import type { CloseReport } from "../../src/execute/report.js";
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
}

export interface WriteEvidenceOptions {
  /** The directory that holds the runs, e.g. `evidence/runs`. */
  root: string;
  /** Strings that must appear in no file, e.g. the fixture's secret keys. */
  forbidden?: readonly string[];
  now?: Date;
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
  const files = new Map<string, string>([
    ["summary.md", summary(evidence, now)],
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
  const dir = join(options.root, runStamp(now));
  mkdirSync(options.root, { recursive: true });
  // Not recursive: an existing run directory throws EEXIST instead of being overwritten.
  mkdirSync(dir);
  for (const [name, content] of files) writeFileSync(join(dir, name), content);
  return dir;
}

function summary(e: CloseEvidence, now: Date): string {
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
    `# Live close ${runStamp(now)}`,
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

function formatSigned(stroops: bigint): string {
  return stroops >= 0n ? `+${formatStroops(stroops)}` : formatStroops(stroops);
}
