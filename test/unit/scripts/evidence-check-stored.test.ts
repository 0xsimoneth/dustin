import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import {
  loadEvidenceCheck,
  type EvidenceCheck,
  type FetchLike,
  type HorizonRecord,
  type MainDeps,
} from "./evidence-module.js";

// The stored transaction records of evidence/tests/transactions/ (final audit of 2026-09-30,
// item 3): Horizon's record of every transaction the documents cite as text only, so the evidence
// outlives the testnet reset of 2026-12-16. evidence:check judges each file offline, compares it
// with Horizon's answer while the testnet keeps it, and requires a record for every transaction
// the documents of STORED_TX_SOURCES cite. The network is a fake.

let m: EvidenceCheck;
beforeAll(async () => {
  m = await loadEvidenceCheck();
});

const HORIZON = "https://horizon-testnet.stellar.org";
const DIR = "evidence/tests/transactions";
const h = (c: string) => c.repeat(64);

function record(hash: string, overrides: Partial<HorizonRecord> = {}): HorizonRecord {
  return {
    hash,
    ledger: 4915293,
    created_at: "2026-09-28T12:53:20Z",
    successful: true,
    envelope_xdr: "AAAABQAAAAA=",
    result_xdr: "AAAAAAAAAMg=",
    fee_account: "GBDOAFW4WYIOVCBZNVI4CF4QOD2J3HZYMMQZSOF2LOSNZGZCSMVBIGMQ",
    ...overrides,
  };
}

const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

function repo(files: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), "dustin-stored-"));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return { root, git: { root, files: new Set(Object.keys(files)) } };
}

/** A fake network: a JSON body (answered 200) or a status by URL; anything else is 200 with {}. */
function network(answers: Record<string, number | object> = {}) {
  const asked: string[] = [];
  const fetch: FetchLike = (url) => {
    asked.push(url);
    const a = answers[url];
    const status = typeof a === "number" ? a : 200;
    const body = typeof a === "object" ? a : {};
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/hal+json" },
      }),
    );
  };
  return { fetch, asked };
}

async function runMain(argv: string[], deps: MainDeps) {
  const out: string[] = [];
  const code = await m.main(argv, {
    sleep: () => Promise.resolve(),
    env: {},
    stdout: (s) => void out.push(s),
    stderr: () => undefined,
    ...deps,
  });
  return { code, out: out.join("") };
}

describe("a stored record, judged offline", () => {
  it("reads Horizon's record bare or in the { hash, horizon } wrapper of the run directories", () => {
    const r = record(h("a"));
    expect(m.horizonRecordOf(r)).toEqual(r);
    expect(m.horizonRecordOf({ hash: h("a"), horizon: r })).toEqual(r);
    expect(m.horizonRecordOf({ ...r, envelope_xdr: "" })).toBeNull();
    expect(m.horizonRecordOf({ ...r, ledger: "4915293" })).toBeNull();
    expect(m.horizonRecordOf({ ...r, hash: h("A") })).toBeNull();
    expect(m.horizonRecordOf(null)).toBeNull();
  });

  it("must be named after its transaction, be JSON, and hold that transaction's record", () => {
    expect(m.judgeStoredFile(`${h("a")}.json`, json(record(h("a"))))).toMatchObject({
      verdict: "ok",
      hash: h("a"),
    });
    expect(m.judgeStoredFile("notes.json", json(record(h("a"))))).toMatchObject({
      verdict: "failed",
      detail: "notes.json is not named <transaction hash>.json (64 lowercase hex digits)",
    });
    expect(m.judgeStoredFile(`${h("a")}.json`, "{ not json").verdict).toBe("failed");
    expect(m.judgeStoredFile(`${h("a")}.json`, json({ hash: h("a") }))).toMatchObject({
      verdict: "failed",
      detail: `${h("a")}.json holds no Horizon transaction record (hash, ledger, created_at, successful, envelope_xdr)`,
    });
    expect(m.judgeStoredFile(`${h("a")}.json`, json(record(h("b"))))).toMatchObject({
      verdict: "failed",
      detail: `${h("a")}.json holds the record of transaction ${h("b")}`,
    });
  });
});

describe("a stored record, compared with Horizon's answer", () => {
  const c = { kind: "stored" as const, hash: h("a") };

  it("is ok when Horizon answers 200 with the same ledger, time, result and envelopes", () => {
    const stored = record(h("a"));
    const body = { ...stored, _links: { self: { href: `${HORIZON}/transactions/${h("a")}` } } };
    expect(m.judgeStoredAnswer(c, { status: 200, body }, stored)).toEqual({
      verdict: "ok",
      detail: "transaction on testnet Horizon (HTTP 200), equal to its stored record",
    });
  });

  it("fails and names every field that differs", () => {
    const stored = record(h("a"));
    const body = { ...stored, ledger: 4915294, envelope_xdr: "AAAAAgAAAAA=" };
    expect(m.judgeStoredAnswer(c, { status: 200, body }, stored)).toEqual({
      verdict: "failed",
      detail: `transaction ${h("a")} on testnet Horizon differs from its stored record in ledger, envelope_xdr`,
    });
  });

  it("fails on a 404, and leaves a 503 or an answer that is not JSON unchecked", () => {
    const stored = record(h("a"));
    expect(m.judgeStoredAnswer(c, { status: 404 }, stored).verdict).toBe("failed");
    expect(m.judgeStoredAnswer(c, { status: 503, tries: 4 }, stored).verdict).toBe("unchecked");
    expect(m.judgeStoredAnswer(c, { status: 200, body: null }, stored)).toEqual({
      verdict: "unchecked",
      detail: `could not compare transaction ${h("a")} with its stored record: Horizon's answer was not JSON`,
    });
  });
});

describe("every transaction a source document cites has a stored record", () => {
  it("reports each uncovered transaction once, listed or linked, and nothing that is stored, labelled or never on the ledger", () => {
    const md = [
      `| Step | Hash |`,
      `|---|---|`,
      `| sale | \`${h("a")}\` |`,
      `| merge | \`${h("b")}\` |`,
      `The [merge](https://stellar.expert/explorer/testnet/tx/${h("c")}) and again \`${h("b")}\`.`,
      `| - | \`${h("d")}\` | refused \`tx_bad_auth_extra\`, never on the ledger (inner hash \`${h("e")}\`) |`,
      `The recipe hash \`${h("f")}\` matches.`,
    ].join("\n");
    expect(m.uncoveredCitations(md, new Set([h("a")]))).toEqual([
      { hash: h("b"), line: 4 },
      { hash: h("c"), line: 5 },
    ]);
  });
});

describe("evidence:check with the default files", () => {
  const A = h("a");
  const G = h("7");

  function evidenceRepo() {
    return repo({
      "README.md": "# Dustin",
      [`${DIR}/README.md`]: `# Stored records\n\n[a](${A}.json)\n`,
      [`${DIR}/${A}.json`]: json(record(A)),
      [`${DIR}/${h("b")}.json`]: json(record(h("c"))),
      [`${DIR}/${G}.json`]: json(record(G)),
      "evidence/runs/x/tx-1.json": json({ hash: h("d"), horizon: record(h("d")) }),
      "docs/stories/3-1-ladder-path-payment.md": [
        `| # | Hash |`,
        `|---|---|`,
        `| 1 | \`${A}\` |`,
        `| 2 | \`${h("d")}\` |`,
        `| 3 | \`${h("e")}\` |`,
        `| - | \`${h("f")}\`, never on the ledger |`,
      ].join("\n"),
    });
  }

  it("judges every stored file, compares each record with Horizon, and requires a record for every cited transaction", async () => {
    const { root, git } = evidenceRepo();
    const { fetch, asked } = network({
      [`${HORIZON}/transactions/${A}`]: record(A),
      [`${HORIZON}/transactions/${G}`]: record(G, { successful: false }),
    });
    const r = await runMain([], { cwd: root, git, fetch });
    expect(asked.sort()).toEqual(
      [`${HORIZON}/transactions/${A}`, `${HORIZON}/transactions/${G}`].sort(),
    );
    expect(r.out).toContain(
      `FAIL       ${DIR}/${h("b")}.json:1  ${h("b")}.json  ${h("b")}.json holds the record of transaction ${h("c")}`,
    );
    expect(r.out).toContain(
      `FAIL       ${DIR}/${G}.json:1  ${G}  transaction ${G} on testnet Horizon differs from its stored record in successful`,
    );
    expect(r.out).toContain(
      `FAIL       docs/stories/3-1-ladder-path-payment.md:5  ${h("e")}  transaction cited with no stored Horizon record: save ${HORIZON}/transactions/${h("e")} as ${DIR}/${h("e")}.json`,
    );
    expect(r.out).not.toContain(`docs/stories/3-1-ladder-path-payment.md:4`);
    expect(r.out).not.toContain(`docs/stories/3-1-ladder-path-payment.md:6`);
    expect(r.out).toContain(
      "1 links, 0 listed transaction hashes, 3 stored transaction records and 1 cited transactions without a stored record: 2 ok, 0 account gone, 0 skipped, 3 failed, 0 unchecked.",
    );
    expect(r.code).toBe(1);
  });

  it("passes when every record is intact and equal to Horizon's answer, and every citation is covered", async () => {
    const { root, git } = repo({
      "README.md": "# Dustin",
      [`${DIR}/${A}.json`]: json(record(A)),
      "docs/write-up.md": `The merge (\`${A}\`).`,
    });
    const { fetch, asked } = network({ [`${HORIZON}/transactions/${A}`]: record(A) });
    const r = await runMain([], { cwd: root, git, fetch });
    expect(asked).toEqual([`${HORIZON}/transactions/${A}`]);
    expect(r.out).toContain(
      "0 links, 1 listed transaction hashes and 1 stored transaction records: 2 ok, 0 account gone, 0 skipped, 0 failed, 0 unchecked.",
    );
    expect(r.code).toBe(0);
  });

  it("leaves the stored records alone when files are named on the command line", async () => {
    const { root, git } = evidenceRepo();
    const { fetch, asked } = network();
    const r = await runMain([join(root, "README.md")], { cwd: root, git, fetch });
    expect(asked).toEqual([]);
    expect(r.out).toContain("0 links and 0 listed transaction hashes");
    expect(r.code).toBe(0);
  });
});
