import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Account, Keypair, Networks, TransactionBuilder } from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";
import { toStroops } from "../../../src/amounts.js";
import { run } from "../../../src/cli/run.js";
import { TESTNET_PASSPHRASE } from "../../../src/config/network.js";
import type { DustinError } from "../../../src/errors/dustin-error.js";
import {
  EDGE,
  EDGE_KEY_ROLES,
  edgePlainIssuerBalance,
  edgeSteps,
  type EdgeRoles,
} from "../../../src/fixture/edge.js";
import { readAnyManifest, readManifest } from "../../../src/fixture/manifest.js";
import { EDGE_DIR, EDGE_E4_DIR } from "../../helpers/edge-ledger.js";
import { MESSY_DIR } from "../../helpers/recorded-horizon.js";

// The Epic 4 closing review of 2026-09-29, fixture half: every test here failed on the code before
// its fix (the probes of the review, ported).

type Loose = Record<string, unknown> & { accounts: Record<string, unknown> };
const loadManifest = (dir: string) =>
  JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8")) as Loose;
function writeManifest(m: unknown): string {
  const path = join(mkdtempSync(join(tmpdir(), "dustin-")), "manifest.json");
  writeFileSync(path, JSON.stringify(m));
  return path;
}
const codeOf = (read: (path: string) => unknown, path: string) => {
  try {
    read(path);
    return "valid";
  } catch (error) {
    return (error as DustinError).code ?? (error as Error).name;
  }
};

describe("EP-3, BH-17: both validators check the ledgers the reset check compares", () => {
  const broken: Array<[string, (m: Loose) => void]> = [
    ["no createdAtLedger", (m) => delete m.createdAtLedger],
    ["a createdAtLedger that is not a number", (m) => (m.createdAtLedger = "4874320")],
    ["a createdAtLedger of 0", (m) => (m.createdAtLedger = 0)],
    ["a fractional createdAtLedger", (m) => (m.createdAtLedger = 4874320.5)],
    ["no transactions", (m) => delete m.transactions],
    ["transactions that are not a list", (m) => (m.transactions = {})],
    [
      "a transaction without a ledger",
      (m) => delete (m.transactions as Array<Record<string, unknown>>)[0]!.ledger,
    ],
    [
      "a transaction whose ledger is not a number",
      (m) => ((m.transactions as Array<Record<string, unknown>>)[2]!.ledger = null),
    ],
    ["a transaction that is not an object", (m) => ((m.transactions as unknown[])[1] = 4874322)],
    ["no id", (m) => delete m.id],
  ];

  it("messy: MANIFEST_INVALID, never a NaN that disables the ledger comparison", () => {
    for (const [name, change] of broken) {
      const m = loadManifest(MESSY_DIR);
      change(m);
      const path = writeManifest(m);
      expect(codeOf(readManifest, path), name).toBe("MANIFEST_INVALID");
      expect(codeOf(readAnyManifest, path), name).toBe("MANIFEST_INVALID");
    }
    expect(codeOf(readManifest, join(MESSY_DIR, "manifest.json"))).toBe("valid");
  });

  it("edge: MANIFEST_INVALID for the same faults", () => {
    for (const [name, change] of broken) {
      const m = loadManifest(EDGE_E4_DIR);
      change(m);
      expect(codeOf(readAnyManifest, writeManifest(m)), name).toBe("MANIFEST_INVALID");
    }
    expect(codeOf(readAnyManifest, join(EDGE_DIR, "manifest.json"))).toBe("valid");
    expect(codeOf(readAnyManifest, join(EDGE_E4_DIR, "manifest.json"))).toBe("valid");
  });

  it("BH-17: through the CLI a manifest without transactions is MANIFEST_INVALID before any request, not a TypeError", async () => {
    for (const dir of [MESSY_DIR, EDGE_E4_DIR]) {
      const m = loadManifest(dir);
      delete m.transactions;
      const requests: string[] = [];
      const out: string[] = [];
      const exit = await run(
        ["node", "dustin", "fixture", "verify", writeManifest(m)],
        { stdout: (s: string) => void out.push(s), stderr: (s: string) => void out.push(s) },
        "0.0.0",
        {
          env: {},
          fetch: (url: string) => {
            requests.push(url);
            return Promise.resolve(
              new Response(JSON.stringify({ network_passphrase: TESTNET_PASSPHRASE })),
            );
          },
        },
      );
      expect(out.join(""), dir).toContain("MANIFEST_INVALID");
      expect(out.join(""), dir).not.toMatch(/TypeError|unexpected error/);
      expect(exit).toBe(2); // a malformed manifest is a validation error (Epic 4 review D-4)
      expect(requests).toEqual([]);
    }
  });
});

describe("EP-17: an edge manifest lists at least one variant, each once, with its own account", () => {
  it("refuses variants: [], a variant listed twice, and a variant whose account is not the one accounts names", () => {
    const broken: Array<[string, (m: Loose) => void]> = [
      ["no variants", (m) => (m.variants = [])],
      [
        "a variant listed twice",
        (m) => {
          const variants = m.variants as unknown[];
          variants.push(variants[0]);
        },
      ],
      [
        "a variant whose account is another role's",
        (m) => {
          const variants = m.variants as Array<{ account: string }>;
          variants[0]!.account = m.accounts.destination as string;
        },
      ],
      ["a variant that is null", (m) => ((m.variants as unknown[])[0] = null)],
    ];
    for (const [name, change] of broken) {
      const m = loadManifest(EDGE_E4_DIR);
      change(m);
      expect(codeOf(readAnyManifest, writeManifest(m)), name).toBe("MANIFEST_INVALID");
    }
  });
});

describe("EP-21: the plain issuer's funding scales with the base reserve", () => {
  const roles = Object.fromEntries(
    EDGE_KEY_ROLES.map((r, i) => [
      r,
      Keypair.fromRawEd25519Seed(Buffer.alloc(32, 60 + i)).publicKey(),
    ]),
  ) as EdgeRoles;
  /** The plain issuer's createAccount startingBalance in the recipe's first step. */
  const funded = (baseReserve: bigint) => {
    const step = edgeSteps(roles, baseReserve)[0]!;
    const builder = new TransactionBuilder(new Account(roles.sponsor, "1"), {
      fee: "0",
      networkPassphrase: Networks.TESTNET,
    }).setTimeout(0);
    for (const op of step.operations) builder.addOperation(op);
    const op = builder
      .build()
      .operations.find((o) => o.type === "createAccount" && o.destination === roles.plainIssuer);
    return op?.type === "createAccount" ? op.startingBalance : null;
  };

  it("covers its 2 own reserves, 3 claimant reserves, the 0.0000001 XLM held and the 0.0000005 XLM for the X-08 offer, whatever the base reserve", () => {
    for (const [reserve, expected] of [
      [5_000_000n, "2.5000006"],
      [10_000_000n, "5.0000006"],
      [25_000_000n, "12.5000006"],
    ] as const) {
      expect(funded(reserve), `base reserve ${reserve}`).toBe(expected);
      const obligations = 5n * reserve + toStroops("0.0000001") + toStroops(EDGE.staleOffer.amount);
      expect(toStroops(funded(reserve)!) >= obligations, `base reserve ${reserve}`).toBe(true);
    }
  });

  it("keeps the recorded build valid: at its base reserve the E4-S3 plain issuer held at least what the formula gives", () => {
    const recorded = JSON.parse(
      readFileSync(join(EDGE_E4_DIR, "account-plain-issuer.json"), "utf8"),
    ) as {
      body: { balances: Array<{ asset_type: string; balance: string }>; num_sponsoring: number };
    };
    const xlm = recorded.body.balances.find((b) => b.asset_type === "native")!;
    expect(recorded.body.num_sponsoring).toBe(3);
    // Funded, less the 0.0000001 XLM its claimable balance holds.
    expect(
      toStroops(xlm.balance) >=
        toStroops(edgePlainIssuerBalance(5_000_000n)) - toStroops("0.0000001"),
    ).toBe(true);
  });
});
