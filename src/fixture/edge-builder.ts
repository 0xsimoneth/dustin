import { createHash } from "node:crypto";
import {
  Account,
  Keypair,
  TransactionBuilder,
  type FeeBumpTransaction,
  type Transaction,
} from "@stellar/stellar-sdk";
import { formatStroops } from "../amounts.js";
import { baseFeeFromFeeStats, type FeeStatsLike } from "../config/fees.js";
import {
  FRIENDBOT_URL,
  resolveConfig,
  verifyHorizonIsTestnet,
  type DustinConfig,
} from "../config/network.js";
import { timerSleep, type Sleep } from "../config/pauses.js";
import { DustinError } from "../errors/dustin-error.js";
import { horizonSubmitter, submitAndConfirm, type SubmitOutcome } from "../execute/submit.js";
import type { HorizonAccount } from "../inspect/horizon-types.js";
import { inspectAccount } from "../inspect/inspect.js";
import { reserveFromHorizon } from "../inspect/reserve.js";
import { horizonJson, latestLedger, type FetchLike } from "../reader/horizon-json.js";
import { horizonReader } from "../reader/ledger-reader.js";
import { hashHex, wrapInFeeBump } from "../sponsor/fee-bump.js";
import {
  awaitFunded,
  fixtureId,
  friendbot,
  pollAccount,
  stepError,
  type RecordedResponse,
} from "./builder.js";
import {
  EDGE,
  EDGE_ACCOUNT_ROLES,
  EDGE_KEY_ROLES,
  edgeIssuerOf,
  edgePool,
  edgeSteps,
  type EdgeAccountRole,
  type EdgeAssetCode,
  type EdgeKeyRole,
  type EdgeRoles,
  type EdgeStep,
  type EdgeVariant,
} from "./edge.js";
import { loadEdgeVerifyInput, verifyEdgeFixture } from "./edge-verify.js";
import type { EdgeFixtureKeys, EdgeFixtureManifest, FixtureManifest } from "./manifest.js";
import type { VerifyResult } from "./verify.js";

export interface EdgeBuildOptions {
  config?: DustinConfig;
  /** Progress lines; never receives a secret. */
  log?: (line: string) => void;
  now?: () => Date;
  friendbotUrl?: string;
  /** HTTP for the testnet check, Friendbot, Horizon reads and submission (tests). */
  fetch?: FetchLike;
  /** Pauses between Friendbot tries, lookups and state polls; default a timer (tests inject one). */
  sleep?: Sleep;
  /** How long to poll Horizon for a step's expected state; default 30 s. */
  settleTimeoutMs?: number;
  /**
   * Receives the new secret keys before any account is funded, so a build that stops halfway
   * still leaves the keys to every account it touched. Must store them before it returns or its
   * promise resolves; the build waits for it, and a store that fails stops the build before
   * anything is funded (closing review CP-12).
   */
  onKeys?: (keys: EdgeFixtureKeys) => void | Promise<void>;
}

export interface EdgeBuildResult {
  manifest: EdgeFixtureManifest;
  keys: EdgeFixtureKeys;
  /**
   * The Horizon JSON the planner reads for every variant, recorded right after the build (public
   * data only), keyed by file name: the offline test vectors (test/fixtures/horizon/edge/).
   */
  recorded: Record<string, RecordedResponse>;
}

function invalid(detail: string): DustinError {
  return new DustinError("FIXTURE_INVALID", `The edge fixture is not valid: ${detail}.`, {
    stage: "build",
  });
}

const kebab = (role: string) => role.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

/** Default bound on the polls for a step's expected state. */
const DEFAULT_SETTLE_TIMEOUT_MS = 30_000;

/**
 * Refused for its sequence number, before inclusion (nothing consumed): `tx_bad_seq`, or for a
 * fee bump the inner transaction's.
 */
function badSequence(outcome: SubmitOutcome): boolean {
  return (
    outcome.kind === "rejected" &&
    (outcome.codes.transaction === "tx_bad_seq" || outcome.codes.innerTransaction === "tx_bad_seq")
  );
}

/**
 * `settleTimeoutMs` is a bound, not a pause, so 0 is allowed; NaN or Infinity would keep a check
 * that never passes polling Horizon forever, so anything but a finite number of at least 0 is
 * refused before any request (closing review CP-13).
 */
function assertSettleTimeout(value: number | undefined): number {
  if (value === undefined) return DEFAULT_SETTLE_TIMEOUT_MS;
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value;
  throw new DustinError(
    "CONFIG_INVALID",
    `Invalid option: settleTimeoutMs must be a finite number of milliseconds of at least 0; got ${String(value)}.`,
    {
      stage: "config",
      remedy: `Leave settleTimeoutMs out to use the default of ${DEFAULT_SETTLE_TIMEOUT_MS / 1000} s.`,
    },
  );
}

/**
 * A fetch that keeps every JSON answer Horizon gives to a GET, keyed by path, so the build can hand
 * over exactly what the planner read. The testnet check (`/`) is left out: the offline reader
 * answers it itself.
 */
function recordingFetch(doFetch: FetchLike, horizonUrl: string) {
  const responses = new Map<string, { status: number; body: unknown }>();
  const fetch: FetchLike = async (url, init) => {
    const response = await doFetch(url, init);
    const get = (init?.method ?? "GET") === "GET";
    if (get && url.startsWith(horizonUrl) && [200, 404].includes(response.status)) {
      const path = url.slice(horizonUrl.length);
      if (path !== "/") {
        try {
          responses.set(path, {
            status: response.status,
            body: await response.clone().json(),
          });
        } catch {
          // Not JSON: nothing the planner could have read.
        }
      }
    }
    return response;
  };
  return { fetch, responses };
}

/**
 * The checks a build step waits for that do not hold yet, as "label: what Horizon shows". A check
 * the verification did not run counts as open: per-variant checks are skipped while Horizon
 * answers 404 for the account, so a skipped check never lets a step count as settled (closing
 * review CP-11).
 */
export function openSettleChecks(result: VerifyResult, settles: readonly string[]): string[] {
  const byId = new Map(result.checks.map((c) => [c.id, c]));
  return settles.flatMap((id) => {
    const check = byId.get(id);
    if (!check) return [`${id}: not checked (Horizon did not return its account)`];
    return check.pass ? [] : [`${check.label}: ${check.observed}`];
  });
}

/** A readable file name for a recorded path: account-auth-frozen, offers-auth-maintain, ... */
export function recordName(path: string, roleOf: ReadonlyMap<string, string>): string {
  const who = (id: string) => kebab(roleOf.get(id) ?? id);
  const account = /^\/accounts\/(G[A-Z2-7]{55})$/.exec(path);
  if (account) return `account-${who(account[1]!)}`;
  const offers = /^\/accounts\/(G[A-Z2-7]{55})\/offers/.exec(path);
  if (offers) return `offers-${who(offers[1]!)}`;
  const claimable = /^\/claimable_balances\?sponsor=(G[A-Z2-7]{55})/.exec(path);
  if (claimable) return `claimable-balances-${who(claimable[1]!)}`;
  if (path.startsWith("/paths/strict-send")) {
    const q = new URLSearchParams(path.split("?")[1] ?? "");
    return `paths-strict-send-${q.get("source_asset_code") ?? "asset"}`;
  }
  if (path.startsWith("/liquidity_pools/")) return "liquidity-pool";
  if (path === "/fee_stats") return "fee-stats";
  if (path.startsWith("/ledgers")) return "ledger-latest";
  return path.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

/**
 * Builds a fresh `edge` fixture on testnet from Friendbot funding alone: the fee sponsor creates the
 * helpers and one account per variant, every other transaction is fee-bumped by it, and each step
 * is followed by polling Horizon until the state it creates is visible. Every call creates new
 * keys, so it is repeatable after a testnet reset (docs/README.md canonical decision 12).
 */
export async function buildEdgeFixture(options: EdgeBuildOptions = {}): Promise<EdgeBuildResult> {
  const settleTimeoutMs = assertSettleTimeout(options.settleTimeoutMs);
  const config = resolveConfig(options.config);
  const log = options.log ?? (() => undefined);
  const sleep = options.sleep ?? timerSleep;
  const createdAt = (options.now ?? (() => new Date()))();
  const doFetch: FetchLike = options.fetch ?? ((url, init) => fetch(url, init));
  await verifyHorizonIsTestnet(config.horizonUrl, doFetch);

  const client = horizonJson(config.horizonUrl, { fetch: doFetch, sleep });
  const submitter = horizonSubmitter(config.horizonUrl, { fetch: doFetch });
  const keypairs = Object.fromEntries(EDGE_KEY_ROLES.map((r) => [r, Keypair.random()])) as Record<
    EdgeKeyRole,
    Keypair
  >;
  const roles = Object.fromEntries(
    EDGE_KEY_ROLES.map((r) => [r, keypairs[r].publicKey()]),
  ) as EdgeRoles;
  const id = fixtureId(createdAt, undefined, "edge");
  const keys: EdgeFixtureKeys = {
    schemaVersion: 1,
    kind: "dustin-fixture-keys",
    id,
    note: "Testnet secret keys for this fixture. Never commit this file.",
    secrets: Object.fromEntries(EDGE_KEY_ROLES.map((r) => [r, keypairs[r].secret()])) as Record<
      EdgeKeyRole,
      string
    >,
  };
  await options.onKeys?.(keys);

  log(`Funding the fee sponsor ${roles.sponsor} from Friendbot`);
  await friendbot(options.friendbotUrl ?? FRIENDBOT_URL, roles.sponsor, doFetch, {
    sleep,
    horizonUrl: config.horizonUrl,
  });
  // The instance that answers next may not have ingested the funding yet (closing review CP-10).
  await awaitFunded(client, roles.sponsor, settleTimeoutMs, sleep);
  const ledger = await latestLedger(client);
  const createdAtLedger = ledger.sequence;
  const baseReserve = BigInt(ledger.base_reserve_in_stroops);
  const stats = await client.get<FeeStatsLike>("/fee_stats");
  const baseFee = baseFeeFromFeeStats(
    stats ?? { last_ledger_base_fee: "100", fee_charged: { p80: "100" } },
  );
  log(`Fee bid ${baseFee} stroops per operation; base reserve ${formatStroops(baseReserve)} XLM`);
  const pool = edgePool(roles);

  const transactions: FixtureManifest["transactions"] = [];
  const settle = async (step: EdgeStep): Promise<void> => {
    const deadline = Date.now() + settleTimeoutMs;
    for (;;) {
      const result = verifyEdgeFixture(await loadEdgeVerifyInput(client, roles, pool.id));
      const open = openSettleChecks(result, step.settles);
      if (open.length === 0) return;
      if (Date.now() > deadline) {
        throw invalid(`after step "${step.name}" Horizon still shows ${open.join("; ")}`);
      }
      await sleep(1000);
    }
  };
  /** Builds, signs and submits one step at the given source sequence number. */
  const submitStep = async (step: EdgeStep, sequence: string) => {
    const sourceId = roles[step.source];
    const builder = new TransactionBuilder(new Account(sourceId, sequence), {
      // The fee sponsor pays for fee-bumped transactions; their inner fee is 0 (CAP-15).
      fee: step.feeBumped ? "0" : String(baseFee),
      networkPassphrase: config.networkPassphrase,
    }).setTimeout(120);
    for (const op of step.operations) builder.addOperation(op);
    const inner = builder.build();
    inner.sign(...step.signers.map((r) => keypairs[r]));
    const envelope: Transaction | FeeBumpTransaction = step.feeBumped
      ? wrapInFeeBump(inner, keypairs.sponsor, baseFee, config.networkPassphrase)
      : inner;
    const hash = hashHex(envelope);
    const outcome = await submitAndConfirm(
      submitter,
      { xdr: envelope.toXDR(), hash, maxTime: Number(inner.timeBounds?.maxTime ?? 0) },
      { sleep },
    );
    return { outcome, hash, inner };
  };
  const exists = (account: HorizonAccount | null) => account !== null;
  const runStep = async (step: EdgeStep): Promise<void> => {
    const sourceId = roles[step.source];
    // A lagging instance may not show an account the previous steps created yet (CP-10).
    const source = await pollAccount(client, sourceId, exists, settleTimeoutMs, sleep);
    if (!source) throw invalid(`the ${step.source} account ${sourceId} does not exist`);
    let { outcome, hash, inner } = await submitStep(step, source.sequence);
    if (badSequence(outcome)) {
      // The sequence number came from an instance behind the ledger: read the source until it
      // shows a newer one, then build the step once more (closing review CP-10).
      const used = BigInt(source.sequence);
      const moved = (a: HorizonAccount | null) => a !== null && BigInt(a.sequence) > used;
      const fresh = await pollAccount(client, sourceId, moved, settleTimeoutMs, sleep);
      if (fresh) {
        log(`  ${step.name.padEnd(16)} tx_bad_seq at a stale sequence number; built again`);
        ({ outcome, hash, inner } = await submitStep(step, fresh.sequence));
      }
    }
    if (outcome.kind !== "applied") throw stepError(step.name, outcome);
    transactions.push({
      step: step.name,
      hash,
      ...(step.feeBumped ? { innerHash: hashHex(inner) } : {}),
      ledger: outcome.ledger,
      feeBumped: step.feeBumped,
      explorerUrl: `${config.explorerBaseUrl}/tx/${hash}`,
    });
    log(`  ${step.name.padEnd(16)} ok  ledger ${outcome.ledger}  ${hash}`);
    await settle(step);
  };

  log("Building the edge variants");
  for (const step of edgeSteps(roles, baseReserve)) await runStep(step);

  const input = await loadEdgeVerifyInput(client, roles, pool.id);
  const verification = verifyEdgeFixture(input);
  const variants: readonly EdgeVariant[] = EDGE.variants;
  const recorded = await recordHorizon(config.horizonUrl, doFetch, sleep, roles);
  const shares =
    input.accounts.poolShare?.balances.find((b) => b.liquidity_pool_id === pool.id)?.balance ??
    "0.0000000";
  const codes: EdgeAssetCode[] = ["FRZ", "MNT", "AUTH", "RVK", "CLAW", "ILQX", "LPA", "LPB"];
  const manifest: EdgeFixtureManifest = {
    schemaVersion: 1,
    kind: "dustin-fixture",
    profile: "edge",
    id,
    createdAt: createdAt.toISOString(),
    network: {
      passphrase: config.networkPassphrase,
      horizonUrl: config.horizonUrl,
      explorerBaseUrl: config.explorerBaseUrl,
    },
    createdAtLedger,
    recipeHash: createHash("sha256").update(JSON.stringify(EDGE)).digest("hex"),
    accounts: Object.fromEntries(EDGE_ACCOUNT_ROLES.map((r) => [r, roles[r]])) as Record<
      EdgeAccountRole,
      string
    >,
    multisigSigner: roles.multisigSigner,
    issuerFlags: {
      authIssuer: [...EDGE.issuerFlags.authIssuer],
      clawbackIssuer: [...EDGE.issuerFlags.clawbackIssuer],
      plainIssuer: [],
    },
    assets: codes.map((code) => ({
      code,
      issuer: roles[edgeIssuerOf(code)],
      issuerRole: edgeIssuerOf(code),
    })),
    pool: {
      id: pool.id,
      assets: [pool.asset.assetA, pool.asset.assetB].map(
        (a) => `${a.getCode()}:${a.getIssuer()}`,
      ) as [string, string],
      shares,
    },
    variants: variants.map((v) => {
      const account = input.accounts[v.role];
      const reserve = account ? reserveFromHorizon(account, input.baseReserve) : null;
      return {
        name: v.name,
        role: v.role,
        account: roles[v.role],
        rows: [...v.rows],
        summary: v.summary,
        expected: v.expected,
        balance: reserve ? formatStroops(reserve.balance) : "0.0000000",
        minimumBalance: reserve ? formatStroops(reserve.minimum) : "0.0000000",
        spendable: reserve ? formatStroops(reserve.spendable) : "0.0000000",
      };
    }),
    transactions,
    verification,
  };
  return { manifest, keys, recorded };
}

/**
 * Records what the planner reads for every variant by running the inspector through a recording
 * fetch, plus the fee sponsor's account (the offline executor tests pay fees from it). GET only.
 */
async function recordHorizon(
  horizonUrl: string,
  doFetch: FetchLike,
  sleep: Sleep,
  roles: EdgeRoles,
): Promise<Record<string, RecordedResponse>> {
  const recorder = recordingFetch(doFetch, horizonUrl);
  const client = horizonJson(horizonUrl, { fetch: recorder.fetch, sleep });
  const reader = horizonReader(client);
  const variants: readonly EdgeVariant[] = EDGE.variants;
  for (const v of variants) {
    await inspectAccount(roles[v.role], { destination: roles.destination, reader });
  }
  await client.get(`/accounts/${roles.sponsor}`);
  const roleOf = new Map(EDGE_ACCOUNT_ROLES.map((r) => [roles[r], r]));
  const recorded: Record<string, RecordedResponse> = {};
  for (const [path, response] of [...recorder.responses].sort(([a], [b]) => (a < b ? -1 : 1))) {
    let name = recordName(path, roleOf);
    for (let n = 2; name in recorded; n++) name = `${recordName(path, roleOf)}-${n}`;
    recorded[name] = { path, ...response };
  }
  return recorded;
}
