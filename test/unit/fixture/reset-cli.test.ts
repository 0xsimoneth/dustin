import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { run } from "../../../src/cli/run.js";
import { EDGE_DIR, edgeManifest } from "../../helpers/edge-ledger.js";
import { MESSY_DIR, loadRecorded, messyManifest } from "../../helpers/recorded-horizon.js";

// X-15 through `dustin fixture verify` (src/cli/commands/fixture.ts), on the recorded messy and
// edge fixtures. A suspected testnet reset stops the command with RESET_SUSPECTED and exit 3
// before any check is printed; an account that was merged is reported as closed, not as a reset,
// and its "exists" check fails with the merge (exit 3, as for any failing check).

const MERGED_PAGE = JSON.parse(
  readFileSync("test/fixtures/horizon/reset/operations-merged.json", "utf8"),
) as { body: unknown };
const MERGED = "GCPPFHGLKA7GCBWJXBH4EXFXS3OXAMXFLOBAZLU2K3KKMO6JKZORNFW7";
const INTO = "GDPZI3OAYYEAXTYY2OHFDZAEEG4PXNBN7AHNLQTEH22O5HTBGBSVB2TS";
const MERGE_TX = "36e53646514a36c673830955b661b91de297842481295f458de8c5911e5c989c";

/**
 * The recorded page of a merged account's operations, moved to `account` (a synthesized answer:
 * the recorded fixtures were never merged).
 */
const mergedHistoryOf = (account: string) =>
  JSON.parse(JSON.stringify(MERGED_PAGE.body).replaceAll(MERGED, account)) as unknown;

function horizon(recorded: Map<string, unknown>, overrides: Record<string, unknown> = {}) {
  return (url: string) => {
    const path = url.replace("https://horizon-testnet.stellar.org", "");
    if (path === "/") {
      return Promise.resolve(
        new Response(JSON.stringify({ network_passphrase: "Test SDF Network ; September 2015" })),
      );
    }
    const body = path in overrides ? overrides[path] : recorded.get(path);
    return Promise.resolve(
      body === null || body === undefined
        ? new Response(JSON.stringify({ status: 404 }), { status: 404 })
        : new Response(JSON.stringify(body)),
    );
  };
}

function capture() {
  const out: string[] = [];
  return {
    io: { stdout: (s: string) => void out.push(s), stderr: (s: string) => void out.push(s) },
    text: () => out.join(""),
  };
}

const verify = async (manifest: string, fetch: ReturnType<typeof horizon>) => {
  const c = capture();
  const code = await run(["node", "dustin", "fixture", "verify", manifest], c.io, "0.0.0", {
    env: {},
    fetch,
  });
  // The checks' evidence is wrapped at 120 columns; compare it as one line.
  return { code, text: c.text().replace(/\s+/g, " ") };
};

const ledgerPage = (sequence: number) => ({
  _embedded: {
    records: [
      {
        sequence,
        closed_at: "2026-12-16T17:30:00Z",
        base_fee_in_stroops: 100,
        base_reserve_in_stroops: 5_000_000,
        protocol_version: 23,
        paging_token: String(sequence),
      },
    ],
  },
});
const ops = (account: string) => `/accounts/${account}/operations?order=desc&limit=10`;

describe("X-15: dustin fixture verify on the messy profile", () => {
  const recorded = loadRecorded(MESSY_DIR);
  const m = messyManifest().accounts;
  const manifest = `${MESSY_DIR}/manifest.json`;

  it("stops with RESET_SUSPECTED (exit 3) when Horizon's latest ledger is behind the manifest", async () => {
    const r = await verify(
      manifest,
      horizon(recorded, { "/ledgers?order=desc&limit=1": ledgerPage(812) }),
    );
    expect(r.code).toBe(3);
    expect(r.text).toContain(
      "dustin: RESET_SUSPECTED: Testnet reset suspected for fixture messy-20260926T035942Z: the manifest records ledger 4874327, but Horizon's latest ledger is 812",
    );
    expect(r.text).toContain("dustin fixture create --profile messy");
    expect(r.text).not.toMatch(/PASS|FAIL/);
  });

  it("stops with RESET_SUSPECTED when the fixture answers 404 and Horizon holds no history for it", async () => {
    const r = await verify(
      manifest,
      horizon(recorded, { [`/accounts/${m.fixture}`]: null, [ops(m.fixture)]: null }),
    );
    expect(r.code).toBe(3);
    expect(r.text).toContain(
      `RESET_SUSPECTED: Testnet reset suspected for fixture messy-20260926T035942Z: the fixture account ${m.fixture} answers 404 and Horizon holds no operation for it`,
    );
  });

  it("reports a merged fixture as closed, with the merge, and not as a reset", async () => {
    const r = await verify(
      manifest,
      horizon(recorded, {
        [`/accounts/${m.fixture}`]: null,
        [ops(m.fixture)]: mergedHistoryOf(m.fixture),
      }),
    );
    expect(r.code).toBe(3);
    expect(r.text).not.toContain("RESET_SUSPECTED");
    expect(r.text).toContain("FAIL fixture account exists");
    expect(r.text).toContain(
      `the account was merged into ${INTO} in transaction ${MERGE_TX} (2026-09-28T11:24:02Z); not a testnet reset`,
    );
  });

  it("still passes on the recorded fixture, reading no operations", async () => {
    const requests: string[] = [];
    const base = horizon(recorded);
    const r = await verify(manifest, (url) => {
      requests.push(url);
      return base(url);
    });
    expect(r.code).toBe(0);
    expect(requests.filter((u) => u.includes("/operations"))).toEqual([]);
  });
});

describe("X-15: dustin fixture verify on the edge profile", () => {
  const recorded = loadRecorded(EDGE_DIR);
  const manifest = edgeManifest();
  const path = `${EDGE_DIR}/manifest.json`;

  it("stops with RESET_SUSPECTED when Horizon's latest ledger is behind the manifest", async () => {
    const r = await verify(
      path,
      horizon(recorded, { "/ledgers?order=desc&limit=1": ledgerPage(3) }),
    );
    expect(r.code).toBe(3);
    expect(r.text).toContain(
      `RESET_SUSPECTED: Testnet reset suspected for fixture ${manifest.id}: the manifest records ledger 4913122, but Horizon's latest ledger is 3`,
    );
    expect(r.text).toContain("dustin fixture create --profile edge");
  });

  it("reports a variant closed by a test as merged, not as a reset", async () => {
    const closed = manifest.accounts.authAuthorized;
    const r = await verify(
      path,
      horizon(recorded, {
        [`/accounts/${closed}`]: null,
        [ops(closed)]: mergedHistoryOf(closed),
      }),
    );
    expect(r.code).toBe(3);
    expect(r.text).not.toContain("RESET_SUSPECTED");
    expect(r.text).toContain("FAIL auth-authorized exists");
    expect(r.text).toContain(`the account was merged into ${INTO} in transaction ${MERGE_TX}`);
  });

  it("stops with RESET_SUSPECTED when every account is gone with its history", async () => {
    const gone = Object.fromEntries(
      Object.values(manifest.accounts).flatMap((account) => [
        [`/accounts/${account}`, null],
        [ops(account), null],
      ]),
    );
    const r = await verify(path, horizon(recorded, gone));
    expect(r.code).toBe(3);
    expect(r.text).toContain("RESET_SUSPECTED");
    expect(r.text).toContain("answers 404 and Horizon holds no operation for it");
  });
});
