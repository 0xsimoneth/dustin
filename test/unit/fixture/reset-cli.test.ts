import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { run } from "../../../src/cli/run.js";
import { HORIZON_LAG_TOLERANCE_LEDGERS } from "../../../src/fixture/reset.js";
import { EDGE_DIR, EDGE_E4_DIR, edgeManifest } from "../../helpers/edge-ledger.js";
import { MESSY_DIR, loadRecorded, messyManifest } from "../../helpers/recorded-horizon.js";

// X-15 through `dustin fixture verify` (src/cli/commands/fixture.ts), on the recorded messy and
// edge fixtures. A suspected testnet reset (none of the accounts read exists, and Horizon's latest
// ledger lies far below the recorded one or Horizon holds no history for any of them) stops the
// command with RESET_SUSPECTED and exit 3 before any check is printed. Any other account that
// answers 404 fails its "exists" check with the reason (exit 3, as for any failing check): closed
// by its merge, gone, or never seen by Horizon (Epic 4 review EP-1, EP-2, EP-20).

const vector = (name: string) =>
  JSON.parse(readFileSync(`test/fixtures/horizon/reset/${name}.json`, "utf8")) as {
    path: string;
    body: unknown;
  };
const MERGED_PAGE = vector("operations-merged");
const MERGE_TX_RECORD = vector("transaction-merge");
const MERGED = "GCPPFHGLKA7GCBWJXBH4EXFXS3OXAMXFLOBAZLU2K3KKMO6JKZORNFW7";
const INTO = "GDPZI3OAYYEAXTYY2OHFDZAEEG4PXNBN7AHNLQTEH22O5HTBGBSVB2TS";
const MERGE_TX = "36e53646514a36c673830955b661b91de297842481295f458de8c5911e5c989c";
const MERGE_LEDGER = 4_914_211;

/**
 * The recorded page of a merged account's operations, moved to `account` (a synthesized answer:
 * the recorded fixtures were never merged), and its recorded merge transaction.
 */
const mergedHistoryOf = (account: string) => ({
  [ops(account)]: JSON.parse(
    JSON.stringify(MERGED_PAGE.body).replaceAll(MERGED, account),
  ) as unknown,
  [MERGE_TX_RECORD.path]: MERGE_TX_RECORD.body,
});

function horizon(
  recorded: Map<string, unknown>,
  overrides: Record<string, unknown> = {},
  root: Record<string, unknown> = {},
) {
  return (url: string) => {
    const path = url.replace("https://horizon-testnet.stellar.org", "");
    if (path === "/") {
      return Promise.resolve(
        new Response(
          JSON.stringify({ network_passphrase: "Test SDF Network ; September 2015", ...root }),
        ),
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
const LEDGER = "/ledgers?order=desc&limit=1";
const ops = (account: string) => `/accounts/${account}/operations?order=desc&limit=200`;

describe("X-15: dustin fixture verify on the messy profile", () => {
  const recorded = loadRecorded(MESSY_DIR);
  const m = messyManifest().accounts;
  const manifest = `${MESSY_DIR}/manifest.json`;
  const RECORDED_LEDGER = 4_874_327;
  const bothGone = { [`/accounts/${m.fixture}`]: null, [`/accounts/${m.destination}`]: null };

  it("stops with RESET_SUSPECTED (exit 3) when no account exists and Horizon's latest ledger is far behind the manifest", async () => {
    const r = await verify(manifest, horizon(recorded, { ...bothGone, [LEDGER]: ledgerPage(812) }));
    expect(r.code).toBe(3);
    expect(r.text).toContain(
      "dustin: RESET_SUSPECTED: Testnet reset suspected for fixture messy-20260926T035942Z: none of its accounts exists, and the manifest records ledger 4874327 while Horizon's latest ledger is 812",
    );
    expect(r.text).toContain("dustin fixture create --profile messy");
    expect(r.text).not.toMatch(/PASS|FAIL/);
  });

  it("stops with RESET_SUSPECTED when the fixture and the destination answer 404 and Horizon holds no history for them", async () => {
    const r = await verify(
      manifest,
      horizon(recorded, { ...bothGone, [ops(m.fixture)]: null, [ops(m.destination)]: null }),
    );
    expect(r.code).toBe(3);
    expect(r.text).toContain(
      `RESET_SUSPECTED: Testnet reset suspected for fixture messy-20260926T035942Z: none of its accounts exists and Horizon holds no operation for any of them (fixture ${m.fixture}, destination ${m.destination})`,
    );
  });

  it("EP-1: passes right after the build on a Horizon one ledger, or the whole tolerance, behind the manifest", async () => {
    for (const behind of [1, HORIZON_LAG_TOLERANCE_LEDGERS]) {
      const r = await verify(
        manifest,
        horizon(recorded, { [LEDGER]: ledgerPage(RECORDED_LEDGER - behind) }),
      );
      expect(r.text).not.toContain("RESET_SUSPECTED");
      expect(r.code, `${behind} behind`).toBe(0);
    }
  });

  it("EP-1: every account answers 200, so a latest ledger far below the recorded one is not a reset either", async () => {
    const r = await verify(manifest, horizon(recorded, { [LEDGER]: ledgerPage(812) }));
    expect(r.text).not.toContain("RESET_SUSPECTED");
    expect(r.text).toContain("Fixture verified");
  });

  it("EP-2: a fixture that answers 404 with no history while the destination exists fails its check, not as a reset", async () => {
    const r = await verify(
      manifest,
      horizon(
        recorded,
        { [`/accounts/${m.fixture}`]: null, [ops(m.fixture)]: null },
        { history_elder_ledger: 128 },
      ),
    );
    expect(r.code).toBe(3);
    expect(r.text).not.toContain("RESET_SUSPECTED");
    expect(r.text).toContain(
      "FAIL fixture account exists observed: Horizon answered 404 and holds no operation for the account: it was never funded, or it was merged before ledger 128, the oldest this Horizon keeps history for (history_elder_ledger)",
    );
  });

  it("EP-20: reports a merged fixture as closed, with the ledger and hash of the merge, and not as a reset", async () => {
    const r = await verify(
      manifest,
      horizon(recorded, { [`/accounts/${m.fixture}`]: null, ...mergedHistoryOf(m.fixture) }),
    );
    expect(r.code).toBe(3);
    expect(r.text).not.toContain("RESET_SUSPECTED");
    expect(r.text).toContain("FAIL fixture account exists");
    expect(r.text).toContain(
      `the account was closed: merged into ${INTO} in ledger ${MERGE_LEDGER} by transaction ${MERGE_TX} (2026-09-28T11:24:02Z); not a testnet reset`,
    );
  });

  it("EP-20: reports a merged destination as closed in its own check", async () => {
    const r = await verify(
      manifest,
      horizon(recorded, {
        [`/accounts/${m.destination}`]: null,
        ...mergedHistoryOf(m.destination),
      }),
    );
    expect(r.code).toBe(3);
    expect(r.text).toContain(
      `FAIL the destination account exists observed: Horizon answered 404: the account was closed: merged into ${INTO} in ledger ${MERGE_LEDGER}`,
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
  const everyAccountGone = Object.fromEntries(
    Object.values(manifest.accounts).map((account) => [`/accounts/${account}`, null]),
  );

  it("stops with RESET_SUSPECTED when no account exists and Horizon's latest ledger is behind the manifest", async () => {
    const r = await verify(
      path,
      horizon(recorded, { ...everyAccountGone, [LEDGER]: ledgerPage(3) }),
    );
    expect(r.code).toBe(3);
    expect(r.text).toContain(
      `RESET_SUSPECTED: Testnet reset suspected for fixture ${manifest.id}: none of its accounts exists, and the manifest records ledger 4913122 while Horizon's latest ledger is 3`,
    );
    expect(r.text).toContain("dustin fixture create --profile edge");
  });

  it("EP-20: reports a variant closed by a test as merged in ledger N with the hash, not as a reset", async () => {
    const closed = manifest.accounts.authAuthorized;
    const r = await verify(
      path,
      horizon(recorded, { [`/accounts/${closed}`]: null, ...mergedHistoryOf(closed) }),
    );
    expect(r.code).toBe(3);
    expect(r.text).not.toContain("RESET_SUSPECTED");
    expect(r.text).toContain("FAIL auth-authorized exists");
    expect(r.text).toContain(
      `the account was closed: merged into ${INTO} in ledger ${MERGE_LEDGER} by transaction ${MERGE_TX}`,
    );
  });

  it("EP-2: one variant with no history among existing accounts fails its check, not as a reset", async () => {
    const unseen = manifest.accounts.claimable;
    const r = await verify(
      path,
      horizon(recorded, { [`/accounts/${unseen}`]: null, [ops(unseen)]: null }),
    );
    expect(r.code).toBe(3);
    expect(r.text).not.toContain("RESET_SUSPECTED");
    expect(r.text).toContain(
      "FAIL claimable exists observed: Horizon answered 404 and holds no operation for the account: it was never funded",
    );
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
    expect(r.text).toContain("none of its accounts exists and Horizon holds no operation for any");
  });

  it("EP-1: the E4-S3 recording verifies on a Horizon one ledger behind its last build transaction", async () => {
    const e4 = loadRecorded(EDGE_E4_DIR);
    const e4Path = `${EDGE_E4_DIR}/manifest.json`;
    const onTime = await verify(e4Path, horizon(e4));
    const behind = await verify(e4Path, horizon(e4, { [LEDGER]: ledgerPage(4_921_124) }));
    expect(behind.text).not.toContain("RESET_SUSPECTED");
    expect(behind.code).toBe(onTime.code);
  });
});
