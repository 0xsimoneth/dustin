import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

// AC-E4-S7-3 (docs/epics-and-stories.md, story 4.7): `npm run evidence:check` verifies every link
// of the evidence package. These are the script's pure helpers, offline; its network part runs only
// when the script runs (scripts/evidence-check.mjs).

interface Link {
  target: string;
  line: number;
}
type Classified =
  | { kind: "anchor" | "mailto" }
  | { kind: "relative"; path: string }
  | { kind: "tx"; hash: string; via: "horizon" | "stellar.expert" }
  | { kind: "horizon-account"; account: string }
  | { kind: "https"; url: string }
  | { kind: "refused"; reason: string };
interface Checked {
  file: string;
  line: number;
  target: string;
  verdict: "ok" | "gone" | "skipped" | "failed";
  detail: string;
}
interface EvidenceCheck {
  TESTNET_HORIZON: string;
  extractLinks(markdown: string): Link[];
  classifyLink(target: string): Classified;
  judgeResponse(
    c: Classified,
    status: number | null,
    error?: string,
  ): Pick<Checked, "verdict" | "detail">;
  defaultFiles(root: string): string[];
  assertTestnetHorizon(url: string): void;
  render(results: Checked[]): string;
  exitCodeOf(results: Checked[]): number;
}

let m: EvidenceCheck;
beforeAll(async () => {
  // A variable path keeps TypeScript from resolving the plain JavaScript module's types.
  const path = "../../../scripts/evidence-check.mjs";
  m = (await import(path)) as EvidenceCheck;
});

const HASH = "36e53646514a36c673830955b661b91de297842481295f458de8c5911e5c989c";
const G = "GCPPFHGLKA7GCBWJXBH4EXFXS3OXAMXFLOBAZLU2K3KKMO6JKZORNFW7";

describe("extractLinks", () => {
  it("finds inline links, images, autolinks, bare URLs and reference definitions, with their line numbers", () => {
    const md = [
      "# Evidence", // 1
      "See [the summary](runs/a/summary.md) and ![the screenshot](tests/offline.png).", // 2
      'On the explorer: [tx 1](https://stellar.expert/explorer/testnet/tx/abc "title").', // 3
      "An autolink <https://horizon-testnet.stellar.org/accounts/GX> and a bare https://github.com/x/y.", // 4
      "[ref]: ../docs/test-matrix.md", // 5
    ].join("\n");
    expect(m.extractLinks(md)).toEqual([
      { target: "runs/a/summary.md", line: 2 },
      { target: "tests/offline.png", line: 2 },
      { target: "https://stellar.expert/explorer/testnet/tx/abc", line: 3 },
      { target: "https://horizon-testnet.stellar.org/accounts/GX", line: 4 },
      { target: "https://github.com/x/y", line: 4 },
      { target: "../docs/test-matrix.md", line: 5 },
    ]);
  });

  it("ignores code spans and fenced blocks, which hold templates rather than links", () => {
    const md = [
      "Links: `https://stellar.expert/explorer/testnet/tx/<hash>` is a template.",
      "```",
      "[not a link](nowhere.md) https://example.invalid/",
      "```",
      "A link with code as its text: [`report.json`](runs/b/report.json).",
    ].join("\n");
    expect(m.extractLinks(md)).toEqual([{ target: "runs/b/report.json", line: 5 }]);
  });

  it("strips the punctuation that ends a sentence from a bare URL, and keeps a link's fragment", () => {
    expect(
      m
        .extractLinks("Run https://github.com/o/r/actions/runs/1, then [x](README.md#run).")
        .map((l) => l.target),
    ).toEqual(["https://github.com/o/r/actions/runs/1", "README.md#run"]);
  });
});

describe("classifyLink", () => {
  it("sends every transaction hash to testnet Horizon, whether it is linked on Horizon or on StellarExpert", () => {
    expect(m.classifyLink(`https://horizon-testnet.stellar.org/transactions/${HASH}`)).toEqual({
      kind: "tx",
      hash: HASH,
      via: "horizon",
    });
    expect(m.classifyLink(`https://stellar.expert/explorer/testnet/tx/${HASH}`)).toEqual({
      kind: "tx",
      hash: HASH,
      via: "stellar.expert",
    });
  });

  it("marks a Horizon account link, whose 404 means the account is gone", () => {
    expect(m.classifyLink(`https://horizon-testnet.stellar.org/accounts/${G}`)).toEqual({
      kind: "horizon-account",
      account: G,
    });
  });

  it("refuses any Horizon or explorer network that is not the testnet, before any request", () => {
    expect(m.classifyLink(`https://horizon.stellar.org/transactions/${HASH}`)).toMatchObject({
      kind: "refused",
    });
    expect(m.classifyLink(`https://horizon-futurenet.stellar.org/accounts/${G}`)).toMatchObject({
      kind: "refused",
    });
    expect(m.classifyLink(`https://stellar.expert/explorer/public/tx/${HASH}`)).toMatchObject({
      kind: "refused",
    });
    expect(m.classifyLink("ftp://example.org/file")).toMatchObject({ kind: "refused" });
  });

  it("checks other https links by their status, relative links on disk, and skips anchors and mail", () => {
    expect(m.classifyLink(`https://stellar.expert/explorer/testnet/account/${G}`)).toEqual({
      kind: "https",
      url: `https://stellar.expert/explorer/testnet/account/${G}`,
    });
    expect(m.classifyLink("https://github.com/0xsimoneth/dustin/actions/runs/1")).toMatchObject({
      kind: "https",
    });
    expect(m.classifyLink("runs/a/summary.md#what")).toEqual({
      kind: "relative",
      path: "runs/a/summary.md",
    });
    expect(m.classifyLink("../docs/test%20matrix.md")).toEqual({
      kind: "relative",
      path: "../docs/test matrix.md",
    });
    expect(m.classifyLink("#run")).toEqual({ kind: "anchor" });
    expect(m.classifyLink("mailto:x@example.org")).toEqual({ kind: "mailto" });
  });
});

describe("judgeResponse", () => {
  const tx = { kind: "tx", hash: HASH, via: "stellar.expert" } as const;
  const account = { kind: "horizon-account", account: G } as const;
  const page = { kind: "https", url: "https://example.org/" } as const;

  it("a transaction must be on testnet Horizon (200)", () => {
    expect(m.judgeResponse(tx, 200).verdict).toBe("ok");
    expect(m.judgeResponse(tx, 404)).toEqual({
      verdict: "failed",
      detail: `transaction ${HASH} not found on testnet Horizon (HTTP 404)`,
    });
  });

  it("an account Horizon answers 404 for is listed as gone, not as a failure", () => {
    expect(m.judgeResponse(account, 200).verdict).toBe("ok");
    expect(m.judgeResponse(account, 404)).toEqual({
      verdict: "gone",
      detail: `account ${G} gone (Horizon 404)`,
    });
    expect(m.judgeResponse(account, 500).verdict).toBe("failed");
  });

  it("any other link resolves below 400; no answer at all is a failure that says why", () => {
    expect(m.judgeResponse(page, 301).verdict).toBe("ok");
    expect(m.judgeResponse(page, 403).verdict).toBe("failed");
    expect(m.judgeResponse(page, null, "ETIMEDOUT")).toEqual({
      verdict: "failed",
      detail: "https://example.org/ did not answer: ETIMEDOUT",
    });
  });
});

describe("defaultFiles and the Horizon it talks to", () => {
  it("defaults to evidence/README.md and every evidence/runs/*/summary.md, sorted", () => {
    const root = mkdtempSync(join(tmpdir(), "dustin-evidence-"));
    mkdirSync(join(root, "evidence", "runs", "b"), { recursive: true });
    mkdirSync(join(root, "evidence", "runs", "a"), { recursive: true });
    mkdirSync(join(root, "evidence", "runs", "c"), { recursive: true });
    writeFileSync(join(root, "evidence", "README.md"), "# x");
    writeFileSync(join(root, "evidence", "runs", "b", "summary.md"), "# b");
    writeFileSync(join(root, "evidence", "runs", "a", "summary.md"), "# a");
    writeFileSync(join(root, "evidence", "runs", "README.md"), "# runs");
    expect(m.defaultFiles(root)).toEqual([
      join("evidence", "README.md"),
      join("evidence", "runs", "a", "summary.md"),
      join("evidence", "runs", "b", "summary.md"),
    ]);
  });

  it("refuses any Horizon but the testnet one", () => {
    expect(m.TESTNET_HORIZON).toBe("https://horizon-testnet.stellar.org");
    expect(() => m.assertTestnetHorizon("https://horizon-testnet.stellar.org")).not.toThrow();
    expect(() => m.assertTestnetHorizon("https://horizon-testnet.stellar.org/")).not.toThrow();
    expect(() => m.assertTestnetHorizon("https://horizon.stellar.org")).toThrow(/testnet/);
  });
});

describe("render and exitCodeOf", () => {
  const row = (verdict: Checked["verdict"], detail: string): Checked => ({
    file: "evidence/README.md",
    line: 3,
    target: "x",
    verdict,
    detail,
  });

  it("lists every failure and every gone account, and counts the rest", () => {
    const text = m.render([
      row("ok", "HTTP 200"),
      row("gone", `account ${G} gone (Horizon 404)`),
      row("failed", "HTTP 404"),
      row("skipped", "anchor"),
    ]);
    expect(text).toContain(`GONE    evidence/README.md:3  x  account ${G} gone (Horizon 404)`);
    expect(text).toContain("FAIL    evidence/README.md:3  x  HTTP 404");
    expect(text).not.toContain("HTTP 200");
    expect(text).toContain("4 links: 1 ok, 1 account gone, 1 skipped, 1 failed.");
  });

  it("exits 1 on any failure and 0 otherwise, a gone account included", () => {
    expect(m.exitCodeOf([row("ok", ""), row("gone", "")])).toBe(0);
    expect(m.exitCodeOf([row("ok", ""), row("failed", "")])).toBe(1);
  });
});
