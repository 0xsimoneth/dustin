import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Keypair } from "@stellar/stellar-sdk";
import { run } from "../../../src/cli/run.js";
import type { executeClose } from "../../../src/execute/executor.js";
import type { HorizonBalance } from "../../../src/inspect/horizon-types.js";
import { FakeLedger } from "../../helpers/fake-ledger.js";
import { noSleep } from "../../helpers/no-sleep.js";

export type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

export const LEDGER = 5_000_000;

/**
 * A zero-spendable account whose keys the test holds (the recorded messy fixture has no secrets):
 * one open offer, one dust trustline and one data entry; its balance equals its minimum balance.
 * With `market`, the dust has a DEX quote, so the plan gets a separate path-payment transaction
 * and a separate merge; without it, the dust returns to its issuer and everything closes in one
 * fee-bumped transaction.
 */
export function zeroSpendableWorld(
  options: { market?: boolean; unauthorized?: boolean; dataEntries?: number } = {},
) {
  const ledger = new FakeLedger(LEDGER);
  const account = Keypair.random();
  const sponsor = Keypair.random();
  const destination = Keypair.random().publicKey();
  const issuer = Keypair.random().publicKey();
  const id = account.publicKey();
  const dataEntries = options.dataEntries ?? 1;

  const acc = FakeLedger.plainAccount(id, "0", LEDGER);
  const dust: HorizonBalance = {
    asset_type: "credit_alphanum4",
    asset_code: "DUST",
    asset_issuer: issuer,
    balance: "0.0000005",
    limit: "922337203685.4775807",
    buying_liabilities: "0.0000000",
    selling_liabilities: options.unauthorized ? "0.0000000" : "0.0000001",
    is_authorized: !options.unauthorized,
    is_authorized_to_maintain_liabilities: !options.unauthorized,
  };
  acc.balances.push(dust);
  acc.data = Object.fromEntries(
    Array.from({ length: dataEntries }, (_, i) => [`dustin.note.${i}`, "MQ=="]),
  );
  // A deauthorized trustline has no offers left (revocation removes them).
  const offers = options.unauthorized ? 0 : 1;
  acc.subentry_count = 1 + offers + dataEntries;
  // Zero spendable: the balance is exactly (2 + subentries) x 0.5 XLM.
  const minimumStroops = BigInt(2 + acc.subentry_count) * ledger.baseReserve;
  acc.balances[0]!.balance = `${minimumStroops / 10_000_000n}.${String(minimumStroops % 10_000_000n).padStart(7, "0")}`;
  ledger.accounts.set(id, acc);
  ledger.offers.set(
    id,
    offers
      ? [
          {
            id: "4471",
            seller: id,
            selling: { asset_type: "credit_alphanum4", asset_code: "DUST", asset_issuer: issuer },
            buying: { asset_type: "native" },
            amount: "0.0000001",
            price: "100.0000000",
            price_r: { n: 100, d: 1 },
          },
        ]
      : [],
  );
  if (options.market) ledger.quotes.set(`DUST:${issuer}`, "0.0000004");
  for (const [key, balance] of [
    [issuer, "100.0000000"],
    [destination, "10.0000000"],
    [sponsor.publicKey(), "10000.0000000"],
  ] as const) {
    ledger.accounts.set(key, FakeLedger.plainAccount(key, balance, LEDGER));
  }
  const env = {
    DUSTIN_ACCOUNT_SECRET: account.secret(),
    DUSTIN_SPONSOR_SECRET: sponsor.secret(),
  };
  return { ledger, account, sponsor, destination, issuer, id, env };
}

export type World = ReturnType<typeof zeroSpendableWorld>;

/** Every way a secret could leak: the StrKey form and the raw seed in hex and base64. */
export function secretForms(...keys: Keypair[]): string[] {
  return keys.flatMap((k) => [
    k.secret(),
    Buffer.from(k.rawSecretKey()).toString("hex"),
    Buffer.from(k.rawSecretKey()).toString("base64"),
  ]);
}

export function emptyDir(dotEnv?: string): string {
  const dir = mkdtempSync(join(tmpdir(), "dustin-close-"));
  if (dotEnv !== undefined) writeFileSync(join(dir, ".env"), dotEnv, { mode: 0o600 });
  return dir;
}

export interface CliRun {
  code: number;
  out: string;
  err: string;
  prompts: string[];
}

export async function closeCli(
  world: World,
  args: string[],
  deps: {
    env?: Record<string, string | undefined>;
    cwd?: string;
    answer?: string | null | ((question: string) => string | null);
    fetch?: Fetch;
    executeClose?: typeof executeClose;
  } = {},
): Promise<CliRun> {
  const out: string[] = [];
  const err: string[] = [];
  const prompts: string[] = [];
  const answer = deps.answer;
  const code = await run(
    ["node", "dustin", ...args],
    { stdout: (s) => void out.push(s), stderr: (s) => void err.push(s) },
    "0.0.0",
    {
      env: deps.env ?? world.env,
      cwd: deps.cwd ?? emptyDir(),
      fetch: deps.fetch ?? world.ledger.fetch,
      horizon: { retries: 0 },
      execute: {
        sleep: noSleep,
        ...(deps.executeClose ? { executeClose: deps.executeClose } : {}),
      },
      ...(answer === undefined
        ? {}
        : {
            prompt: (question: string) => {
              prompts.push(question);
              return Promise.resolve(typeof answer === "function" ? answer(question) : answer);
            },
          }),
    },
  );
  return { code, out: out.join(""), err: err.join(""), prompts };
}

export const executeArgs = (world: World, ...extra: string[]) => [
  "close",
  world.id,
  "--to",
  world.destination,
  "--execute",
  ...extra,
];
