import { createHash, randomBytes } from "node:crypto";
import {
  Asset,
  Horizon,
  Keypair,
  Operation,
  TransactionBuilder,
  type FeeBumpTransaction,
  type Transaction,
} from "@stellar/stellar-sdk";
import { formatStroops, toStroops } from "../amounts.js";
import { baseFeeFromFeeStats } from "../config/fees.js";
import {
  FRIENDBOT_URL,
  resolveConfig,
  verifyHorizonIsTestnet,
  type DustinConfig,
  type ResolvedConfig,
} from "../config/network.js";
import { DustinError } from "../errors/dustin-error.js";
import {
  horizonSubmitter,
  submitAndConfirm,
  type SubmitOutcome,
  type Submitter,
} from "../execute/submit.js";
import type { HorizonAccount } from "../inspect/horizon-types.js";
import { reserveFromHorizon } from "../inspect/reserve.js";
import {
  accountOffers,
  horizonJson,
  latestLedger,
  type FetchLike,
  type HorizonJsonClient,
} from "../reader/horizon-json.js";
import { strictSendToNativePath, type CreditAssetRef } from "../reader/ledger-reader.js";
import { hashHex, wrapInFeeBump } from "../sponsor/fee-bump.js";
import type { FixtureKeys, FixtureManifest } from "./manifest.js";
import {
  MESSY,
  MESSY_ROLES,
  messyAsset,
  messySteps,
  type MessyAsset,
  type MessyRole,
  type MessyRoles,
  type MessyStep,
} from "./messy.js";
import { expectationFromManifest, loadVerifyInput, verifyFixture } from "./verify.js";

export interface BuildOptions {
  config?: DustinConfig;
  /** Progress lines; never receives a secret. */
  log?: (line: string) => void;
  now?: () => Date;
  friendbotUrl?: string;
  /** How long to wait for Horizon's path finder to see the market maker's bid. */
  pathWaitMs?: number;
  /** HTTP for the testnet check, Friendbot, Horizon reads and submission (tests). */
  fetch?: FetchLike;
  /**
   * Receives the new secret keys before any account is funded, so a build that stops halfway
   * still leaves the keys to every account it touched. Must store them before it returns or its
   * promise resolves; the build waits for it, and a store that fails stops the build before
   * anything is funded (closing review CP-12).
   */
  onKeys?: (keys: FixtureKeys) => void | Promise<void>;
}

export interface RecordedResponse {
  path: string;
  status: number;
  body: unknown;
}

export interface BuildResult {
  manifest: FixtureManifest;
  keys: FixtureKeys;
  /** Raw Horizon JSON of the finished fixture, for offline planner tests. */
  recorded: Record<string, RecordedResponse>;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * `<profile>-<UTC second>-<6 hex>` (`messy-...` by default): the suffix keeps two builds started in
 * the same second apart.
 */
export function fixtureId(
  createdAt: Date,
  suffix = randomBytes(3).toString("hex"),
  profile: "messy" | "edge" = "messy",
): string {
  const second = createdAt
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d+Z$/, "Z");
  return `${profile}-${second}-${suffix}`;
}

/** The error for a fixture step whose transaction did not apply. */
export function stepError(
  step: string,
  outcome: Exclude<SubmitOutcome, { kind: "applied" }>,
): DustinError {
  if (outcome.kind === "unknown") {
    return new DustinError(
      "HORIZON_UNAVAILABLE",
      `Fixture step "${step}" was not seen on the ledger before its time bound passed.`,
      {
        stage: "submit",
        retryable: true,
        verdict: "retry-same",
        remedy: "Run the command again; it builds a new fixture with new keys.",
        horizon: { hash: outcome.hash },
      },
    );
  }
  const { codes } = outcome;
  const inner = codes.innerTransaction ? ` / ${codes.innerTransaction}` : "";
  const ops = codes.operations?.length ? ` [${codes.operations.join(", ")}]` : "";
  return new DustinError(
    "FIXTURE_STEP_FAILED",
    `Fixture step "${step}" failed: ${codes.transaction ?? "?"}${inner}${ops}.`,
    {
      stage: "submit",
      horizon: {
        status: outcome.status,
        ...(codes.transaction ? { transaction: codes.transaction } : {}),
        ...(codes.innerTransaction ? { innerTransaction: codes.innerTransaction } : {}),
        ...(codes.operations ? { operations: codes.operations } : {}),
        hash: outcome.hash,
      },
    },
  );
}

/**
 * Builds a fresh `messy` fixture on testnet from Friendbot funding alone, drains it to exactly its
 * minimum balance and verifies it. Every call creates new keys, so it is repeatable after a testnet
 * reset (docs/README.md canonical decision 12).
 */
export async function buildMessyFixture(options: BuildOptions = {}): Promise<BuildResult> {
  const config = resolveConfig(options.config);
  const log = options.log ?? (() => undefined);
  const createdAt = (options.now ?? (() => new Date()))();
  const doFetch: FetchLike = options.fetch ?? ((url, init) => fetch(url, init));
  await verifyHorizonIsTestnet(config.horizonUrl, doFetch);

  const server = new Horizon.Server(config.horizonUrl, {
    allowHttp: config.horizonUrl.startsWith("http://"),
  });
  const client = horizonJson(config.horizonUrl, { fetch: doFetch });
  const submitter = horizonSubmitter(config.horizonUrl, { fetch: doFetch });
  const keypairs = Object.fromEntries(MESSY_ROLES.map((r) => [r, Keypair.random()])) as Record<
    MessyRole,
    Keypair
  >;
  const roles = Object.fromEntries(
    MESSY_ROLES.map((r) => [r, keypairs[r].publicKey()]),
  ) as MessyRoles;
  const id = fixtureId(createdAt);
  const keys: FixtureKeys = {
    schemaVersion: 1,
    kind: "dustin-fixture-keys",
    id,
    note: "Testnet secret keys for this fixture. Never commit this file.",
    secrets: Object.fromEntries(MESSY_ROLES.map((r) => [r, keypairs[r].secret()])) as Record<
      MessyRole,
      string
    >,
  };
  await options.onKeys?.(keys);

  log(`Funding the fee sponsor ${roles.sponsor} from Friendbot`);
  await friendbot(options.friendbotUrl ?? FRIENDBOT_URL, roles.sponsor, doFetch);
  const createdAtLedger = (await latestLedger(client)).sequence;
  const baseFee = baseFeeFromFeeStats(await server.feeStats());
  log(
    `Fee bid ${baseFee} stroops per operation (the sponsor is charged the ledger's clearing fee)`,
  );

  const transactions: FixtureManifest["transactions"] = [];
  const record = (
    step: string,
    envelope: Transaction | FeeBumpTransaction,
    ledger: number,
    inner?: Transaction,
  ) => {
    const hash = hashHex(envelope);
    transactions.push({
      step,
      hash,
      ...(inner ? { innerHash: hashHex(inner) } : {}),
      ledger,
      feeBumped: inner !== undefined,
      explorerUrl: `${config.explorerBaseUrl}/tx/${hash}`,
    });
    log(`  ${step.padEnd(22)} ok  ledger ${ledger}  ${hash}`);
  };

  const runStep = async (step: MessyStep): Promise<void> => {
    const source = await server.loadAccount(roles[step.source]);
    const builder = new TransactionBuilder(source, {
      // The fee sponsor pays for fee-bumped transactions; their inner fee is 0 (CAP-15).
      fee: step.feeBumped ? "0" : String(baseFee),
      networkPassphrase: config.networkPassphrase,
    }).setTimeout(120);
    for (const op of step.operations) builder.addOperation(op);
    const inner = builder.build();
    inner.sign(...step.signers.map((r) => keypairs[r]));
    const envelope = step.feeBumped
      ? wrapInFeeBump(inner, keypairs.sponsor, baseFee, config.networkPassphrase)
      : inner;
    const outcome = await submitAndConfirm(submitter, {
      xdr: envelope.toXDR(),
      hash: hashHex(envelope),
      maxTime: Number(inner.timeBounds?.maxTime ?? 0),
    });
    if (outcome.kind !== "applied") throw stepError(step.name, outcome);
    record(step.name, envelope, outcome.ledger, step.feeBumped ? inner : undefined);
  };

  log(`Building fixture ${roles.fixture}`);
  for (const step of messySteps(roles)) await runStep(step);

  // Drain to exactly the minimum balance. The payment is fee-bumped, so no fee leaves the fixture
  // and the arithmetic is exact (docs/edge-cases-and-test-matrix.md section 5.2, steps 10 and 11).
  const baseReserve = BigInt((await latestLedger(client)).base_reserve_in_stroops);
  const beforeDrain = reserveFromHorizon(await mustGetAccount(client, roles.fixture), baseReserve);
  if (beforeDrain.spendable <= 0n) {
    throw invalid(
      `the fixture has no spendable XLM to drain (${formatStroops(beforeDrain.spendable)})`,
    );
  }
  await runStep({
    name: "drain-to-minimum",
    source: "fixture",
    signers: ["fixture"],
    feeBumped: true,
    operations: [
      Operation.payment({
        destination: roles.sponsor,
        asset: Asset.native(),
        amount: formatStroops(beforeDrain.spendable),
      }),
    ],
  });
  const drained = reserveFromHorizon(await mustGetAccount(client, roles.fixture), baseReserve);
  if (drained.spendable !== 0n) {
    throw invalid(
      `after the drain the fixture still has ${formatStroops(drained.spendable)} XLM spendable`,
    );
  }
  log(
    `Drained: balance ${formatStroops(drained.balance)} = minimum ${formatStroops(drained.minimum)}, spendable 0`,
  );

  const liquidPath = await waitForLiquidPath(server, roles.issuer, options.pathWaitMs ?? 60_000);
  log(
    `Strict-send path for ${liquidPath.asset}: ${liquidPath.sourceAmount} -> ${liquidPath.destinationAmount} XLM`,
  );

  const zeroSpendableProof = await proveZeroSpendable(
    server,
    submitter,
    keypairs.fixture,
    baseFee,
    config,
  );
  log(`Unbumped transaction from the fixture rejected with ${zeroSpendableProof.resultCode}`);

  const offers = await accountOffers(client, roles.fixture);
  const assets: readonly MessyAsset[] = MESSY.assets;
  const manifest: FixtureManifest = {
    schemaVersion: 1,
    kind: "dustin-fixture",
    profile: "messy",
    id,
    createdAt: createdAt.toISOString(),
    network: {
      passphrase: config.networkPassphrase,
      horizonUrl: config.horizonUrl,
      explorerBaseUrl: config.explorerBaseUrl,
    },
    createdAtLedger,
    recipeHash: createHash("sha256").update(JSON.stringify(MESSY)).digest("hex"),
    accounts: roles,
    assets: assets.map((a) => ({
      code: a.code,
      issuer: roles.issuer,
      dust: a.dust,
      expectedRung: a.expectedRung,
      sponsored: a.sponsored === true,
      destinationTrusts: a.destinationTrusts === true,
    })),
    offers: offers.map((o) => ({
      id: String(o.id),
      selling: assetLabel(o.selling),
      buying: assetLabel(o.buying),
      amount: o.amount,
      price: o.price,
    })),
    dataEntries: [MESSY.dataEntry.name],
    expected: {
      subentryCount: MESSY.expected.subentryCount,
      numSponsored: MESSY.expected.numSponsored,
      baseReserve: formatStroops(baseReserve),
      balance: formatStroops(drained.balance),
      minimumBalance: formatStroops(drained.minimum),
      spendable: formatStroops(drained.spendable),
    },
    transactions,
    zeroSpendableProof,
    liquidPath,
    verification: { pass: false, checks: [] },
  };
  manifest.verification = verifyFixture(
    await loadVerifyInput(client, expectationFromManifest(manifest), roles.fixture),
  );
  return { manifest, keys, recorded: await recordHorizon(client, roles) };
}

function assetLabel(a: { asset_type: string; asset_code?: string; asset_issuer?: string }): string {
  return a.asset_type === "native" ? "native" : `${a.asset_code}:${a.asset_issuer}`;
}

function invalid(detail: string): DustinError {
  return new DustinError("FIXTURE_INVALID", `The fixture is not valid: ${detail}.`, {
    stage: "build",
  });
}

async function mustGetAccount(client: HorizonJsonClient, id: string): Promise<HorizonAccount> {
  const account = await client.get<HorizonAccount>(`/accounts/${id}`);
  if (!account) throw invalid(`account ${id} does not exist`);
  return account;
}

/** Funds a fresh testnet account from Friendbot, with three tries. `wait` pauses between tries. */
export async function friendbot(
  url: string,
  publicKey: string,
  doFetch: FetchLike,
  wait: (ms: number) => Promise<unknown> = sleep,
): Promise<void> {
  let problem = "";
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await wait(2000 * attempt);
    try {
      const response = await doFetch(`${url}/?addr=${encodeURIComponent(publicKey)}`, {
        signal: AbortSignal.timeout(30_000),
      });
      if (response.ok) return;
      problem = `HTTP ${response.status}`;
    } catch {
      problem = "unreachable";
    }
  }
  throw new DustinError("FRIENDBOT_FAILED", `Friendbot could not fund ${publicKey} (${problem}).`, {
    stage: "build",
    retryable: true,
    verdict: "retry-same",
    remedy: "Friendbot is rate limited; wait a minute and run the command again.",
  });
}

/**
 * Horizon's path finder can trail the ledger that created the market maker's bid (day-1
 * experiment 6), so poll until a strict-send path to XLM of at least one stroop appears.
 */
async function waitForLiquidPath(
  server: Horizon.Server,
  issuer: string,
  waitMs: number,
): Promise<FixtureManifest["liquidPath"]> {
  const assets: readonly MessyAsset[] = MESSY.assets;
  const liquid = assets.find((a) => a.expectedRung === "path_payment");
  if (!liquid) throw invalid("the recipe has no liquid asset");
  const deadline = Date.now() + waitMs;
  for (;;) {
    const page = await server
      .strictSendPaths(messyAsset(liquid.code, issuer), liquid.dust, [Asset.native()])
      .call();
    const best = page.records
      .filter((r) => toStroops(r.destination_amount) >= 1n)
      .sort((a, b) =>
        toStroops(b.destination_amount) > toStroops(a.destination_amount) ? 1 : -1,
      )[0];
    if (best) {
      return {
        asset: liquid.code,
        sourceAmount: best.source_amount,
        destinationAmount: best.destination_amount,
        path: best.path.map((p) =>
          p.asset_type === "native" ? "native" : `${p.asset_code}:${p.asset_issuer}`,
        ),
      };
    }
    if (Date.now() > deadline) {
      throw invalid(
        `no strict-send path from ${liquid.code} to XLM appeared within ${waitMs / 1000} s`,
      );
    }
    await sleep(1000);
  }
}

/**
 * Evidence for "zero spendable XLM": the same account cannot pay the fee of an unbumped
 * transaction. Horizon rejects it with tx_insufficient_balance at validation, so the sequence
 * number is not consumed (day-1 experiment 1).
 */
async function proveZeroSpendable(
  server: Horizon.Server,
  submitter: Submitter,
  fixture: Keypair,
  baseFee: number,
  config: ResolvedConfig,
): Promise<FixtureManifest["zeroSpendableProof"]> {
  const source = await server.loadAccount(fixture.publicKey());
  const sequenceBefore = source.sequence;
  const probe = new TransactionBuilder(source, {
    fee: String(baseFee),
    networkPassphrase: config.networkPassphrase,
  })
    .addOperation(
      Operation.manageData({ name: MESSY.dataEntry.name, value: MESSY.dataEntry.value }),
    )
    .setTimeout(60)
    .build();
  probe.sign(fixture);
  const outcome = await submitAndConfirm(submitter, {
    xdr: probe.toXDR(),
    hash: hashHex(probe),
    maxTime: Number(probe.timeBounds?.maxTime ?? 0),
  });
  if (outcome.kind === "applied") {
    throw invalid("an unbumped transaction from the fixture succeeded, so it holds spendable XLM");
  }
  const code = outcome.kind === "unknown" ? undefined : outcome.codes.transaction;
  if (outcome.kind !== "rejected" || code !== "tx_insufficient_balance") {
    throw invalid(`the unbumped probe ended ${outcome.kind} with ${code ?? "no result code"}`);
  }
  const after = await server.loadAccount(fixture.publicKey());
  return { resultCode: code, sequenceUnchanged: after.sequence === sequenceBefore };
}

async function recordHorizon(
  client: HorizonJsonClient,
  roles: MessyRoles,
): Promise<Record<string, RecordedResponse>> {
  const assets: readonly MessyAsset[] = MESSY.assets;
  const paths: Record<string, string> = {
    "account-fixture": `/accounts/${roles.fixture}`,
    "offers-fixture": `/accounts/${roles.fixture}/offers?limit=200&order=asc`,
    "account-destination": `/accounts/${roles.destination}`,
    "account-issuer": `/accounts/${roles.issuer}`,
    "account-reserve-sponsor": `/accounts/${roles.reserveSponsor}`,
    "account-market-maker": `/accounts/${roles.marketMaker}`,
    "fee-stats": "/fee_stats",
    "ledger-latest": "/ledgers?order=desc&limit=1",
  };
  for (const a of assets) {
    const asset: CreditAssetRef = {
      type: a.code.length <= 4 ? "credit_alphanum4" : "credit_alphanum12",
      code: a.code,
      issuer: roles.issuer,
    };
    paths[`paths-strict-send-${a.code}`] = strictSendToNativePath(asset, a.dust);
  }
  const recorded: Record<string, RecordedResponse> = {};
  for (const [key, path] of Object.entries(paths)) {
    const body = await client.get<unknown>(path);
    recorded[key] = { path, status: body === null ? 404 : 200, body };
  }
  return recorded;
}
