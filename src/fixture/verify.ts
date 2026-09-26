import { formatStroops, toStroops } from "../amounts.js";
import type { HorizonAccount, HorizonOffer } from "../inspect/horizon-types.js";
import { reserveFromHorizon } from "../inspect/reserve.js";
import { accountOffers, latestLedger, type HorizonJsonClient } from "../reader/horizon-json.js";
import type { FixtureManifest } from "./manifest.js";

export interface VerifyExpectation {
  reserveSponsor: string;
  sponsoredAsset: { code: string; issuer: string };
  subentryCount: number;
  numSponsored: number;
  destination: string;
}

export interface VerifyInput {
  /** `null` when Horizon answers 404. */
  account: HorizonAccount | null;
  offers: HorizonOffer[];
  baseReserve: bigint;
  destinationExists: boolean;
  expected: VerifyExpectation;
}

export interface VerifyCheck {
  id: string;
  label: string;
  /** True for the four fixture preconditions of SOW Appendix B. */
  appendixB: boolean;
  pass: boolean;
  observed: string;
  expected: string;
}

export interface VerifyResult {
  pass: boolean;
  checks: VerifyCheck[];
}

const isCredit = (assetType: string) =>
  assetType === "credit_alphanum4" || assetType === "credit_alphanum12";

/** Checks SOW Appendix B and the fixture invariants against Horizon data. Pure; no I/O. */
export function verifyFixture(input: VerifyInput): VerifyResult {
  const { account, expected } = input;
  if (!account) {
    return {
      pass: false,
      checks: [
        {
          id: "account-exists",
          label: "fixture account exists",
          appendixB: false,
          pass: false,
          observed: "Horizon answered 404: the account does not exist",
          expected: "the account exists",
        },
      ],
    };
  }

  const reserve = reserveFromHorizon(account, input.baseReserve);
  const credit = account.balances.filter((b) => isCredit(b.asset_type));
  const withBalance = credit.filter((b) => toStroops(b.balance) > 0n);
  const sponsoredLine = credit.find(
    (b) =>
      b.asset_code === expected.sponsoredAsset.code &&
      b.asset_issuer === expected.sponsoredAsset.issuer,
  );
  const poolShares = account.balances.filter((b) => b.asset_type === "liquidity_pool_shares");
  const master = account.signers.find((s) => s.key === account.account_id);
  const masterWeight = master?.weight ?? 0;
  const high = account.thresholds.high_threshold;
  const dataKeys = Object.keys(account.data);

  const checks: VerifyCheck[] = [
    {
      id: "zero-spendable-xlm",
      label: "holds zero spendable XLM",
      appendixB: true,
      pass: reserve.spendable === 0n,
      observed:
        `balance ${formatStroops(reserve.balance)}, minimum ${formatStroops(reserve.minimum)}, ` +
        `native selling liabilities ${formatStroops(reserve.sellingLiabilities)}, ` +
        `spendable ${formatStroops(reserve.spendable)}`,
      expected: "spendable 0.0000000",
    },
    {
      id: "trustlines-with-balance",
      label: "at least 3 trustlines with non-zero balances",
      appendixB: true,
      pass: withBalance.length >= 3,
      observed: `${withBalance.length} (${withBalance.map((b) => `${b.asset_code} ${b.balance}`).join(", ")})`,
      expected: "3 or more",
    },
    {
      id: "open-offer",
      label: "at least 1 open offer",
      appendixB: true,
      pass: input.offers.length >= 1,
      observed: `${input.offers.length} (ids ${input.offers.map((o) => o.id).join(", ") || "none"})`,
      expected: "1 or more",
    },
    {
      id: "data-entry",
      label: "at least 1 data entry",
      appendixB: true,
      pass: dataKeys.length >= 1,
      observed: `${dataKeys.length} (${dataKeys.join(", ") || "none"})`,
      expected: "1 or more",
    },
    {
      id: "sponsored-trustline",
      label: `trustline ${expected.sponsoredAsset.code} is sponsored by the reserve sponsor`,
      appendixB: false,
      pass: sponsoredLine?.sponsor === expected.reserveSponsor,
      observed: sponsoredLine
        ? `sponsor ${sponsoredLine.sponsor ?? "none"}`
        : "trustline not found",
      expected: `sponsor ${expected.reserveSponsor}`,
    },
    {
      id: "subentry-count",
      label: "subentry count",
      appendixB: false,
      pass: account.subentry_count === expected.subentryCount,
      observed: String(account.subentry_count),
      expected: String(expected.subentryCount),
    },
    {
      id: "num-sponsored",
      label: "entries sponsored by another account",
      appendixB: false,
      pass: account.num_sponsored === expected.numSponsored,
      observed: String(account.num_sponsored),
      expected: String(expected.numSponsored),
    },
    {
      id: "not-sponsoring",
      label: "sponsors nothing (a sponsoring account cannot be merged)",
      appendixB: false,
      pass: account.num_sponsoring === 0,
      observed: String(account.num_sponsoring),
      expected: "0",
    },
    {
      id: "no-pool-shares",
      label: "holds no liquidity pool shares",
      appendixB: false,
      pass: poolShares.length === 0,
      observed: String(poolShares.length),
      expected: "0",
    },
    {
      id: "not-immutable",
      label: "AUTH_IMMUTABLE is not set",
      appendixB: false,
      pass: !account.flags.auth_immutable,
      observed: String(account.flags.auth_immutable),
      expected: "false",
    },
    {
      id: "master-key-can-merge",
      label: "the master key alone meets the high threshold",
      appendixB: false,
      pass: masterWeight > 0 && masterWeight >= high,
      observed: `master weight ${masterWeight}, high threshold ${high}`,
      expected: "weight >= high threshold and > 0",
    },
    {
      id: "destination-exists",
      label: "the destination account exists",
      appendixB: false,
      pass: input.destinationExists,
      observed: input.destinationExists ? "exists" : "Horizon answered 404",
      expected: `account ${expected.destination} exists`,
    },
  ];
  return { pass: checks.every((c) => c.pass), checks };
}

export function renderVerify(result: VerifyResult): string {
  const width = Math.max(...result.checks.map((c) => c.label.length));
  const lines = result.checks.map(
    (c) =>
      `${c.pass ? "PASS" : "FAIL"}  ${c.appendixB ? "[Appendix B] " : "             "}${c.label.padEnd(width)}  ${c.observed}`,
  );
  lines.push("", result.pass ? "Fixture verified: every check passed." : "Fixture NOT verified.");
  return `${lines.join("\n")}\n`;
}

/** Expectations for the messy profile, taken from its manifest. */
export function expectationFromManifest(manifest: FixtureManifest): VerifyExpectation {
  const sponsored = manifest.assets.find((a) => a.sponsored);
  return {
    reserveSponsor: manifest.accounts.reserveSponsor,
    sponsoredAsset: { code: sponsored?.code ?? "", issuer: sponsored?.issuer ?? "" },
    subentryCount: manifest.expected.subentryCount,
    numSponsored: manifest.expected.numSponsored,
    destination: manifest.accounts.destination,
  };
}

/** Reads the fixture, its offers, the destination and the base reserve from Horizon. GET only. */
export async function loadVerifyInput(
  client: HorizonJsonClient,
  expected: VerifyExpectation,
  fixture: string,
): Promise<VerifyInput> {
  const [account, offers, ledger, destination] = await Promise.all([
    client.get<HorizonAccount>(`/accounts/${fixture}`),
    accountOffers(client, fixture),
    latestLedger(client),
    client.get<HorizonAccount>(`/accounts/${expected.destination}`),
  ]);
  return {
    account,
    offers,
    baseReserve: BigInt(ledger.base_reserve_in_stroops),
    destinationExists: destination !== null,
    expected,
  };
}
