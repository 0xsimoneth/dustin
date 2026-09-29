import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { loadEvidenceCheck, type Checked, type EvidenceCheck } from "./evidence-module.js";

// AC-E4-S7-3 (docs/epics-and-stories.md, story 4.7): `npm run evidence:check` verifies every link
// of the evidence package. These are the script's pure helpers, offline; its network part runs only
// when the script runs (scripts/evidence-check.mjs). The Epic 4 review's fixes are tested in
// evidence-check-review.test.ts.

let m: EvidenceCheck;
beforeAll(async () => {
  m = await loadEvidenceCheck();
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

  it("marks a Horizon account link, whose 404 is judged by the account's history", () => {
    expect(m.classifyLink(`https://horizon-testnet.stellar.org/accounts/${G}`)).toEqual({
      kind: "account",
      account: G,
      via: "horizon",
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

  it("checks other https links by their status, relative links against the repository, anchors against headings, and skips mail", () => {
    expect(m.classifyLink("https://github.com/0xsimoneth/dustin/actions/runs/1")).toMatchObject({
      kind: "https",
    });
    expect(m.classifyLink("runs/a/summary.md#what")).toEqual({
      kind: "relative",
      path: "runs/a/summary.md",
      fromRoot: false,
      fragment: "what",
    });
    expect(m.classifyLink("../docs/test%20matrix.md")).toEqual({
      kind: "relative",
      path: "../docs/test matrix.md",
      fromRoot: false,
      fragment: null,
    });
    expect(m.classifyLink("#run")).toEqual({ kind: "anchor", fragment: "run" });
    expect(m.classifyLink("mailto:x@example.org")).toEqual({ kind: "mailto" });
  });
});

describe("judgeResponse", () => {
  const tx = { kind: "tx", hash: HASH, via: "stellar.expert" } as const;
  const account = { kind: "account", account: G, via: "horizon" } as const;
  const page = { kind: "https", url: "https://example.org/" } as const;

  it("a transaction must be on testnet Horizon (200)", () => {
    expect(m.judgeResponse(tx, { status: 200 }).verdict).toBe("ok");
    expect(m.judgeResponse(tx, { status: 404 })).toEqual({
      verdict: "failed",
      detail: `transaction ${HASH} not found on testnet Horizon (HTTP 404)`,
    });
  });

  it("an account that exists is ok; a 404 goes on to its history; another answer fails", () => {
    expect(m.judgeResponse(account, { status: 200 }).verdict).toBe("ok");
    expect(m.judgeResponse(account, { status: 404 }).verdict).toBe("history");
    expect(m.judgeResponse(account, { status: 400 }).verdict).toBe("failed");
  });

  it("any other link resolves below 400; no answer at all is unchecked and says why", () => {
    expect(m.judgeResponse(page, { status: 204 }).verdict).toBe("ok");
    expect(m.judgeResponse(page, { status: 403 }).verdict).toBe("failed");
    expect(m.judgeResponse(page, { status: null, error: "ETIMEDOUT", tries: 4 })).toEqual({
      verdict: "unchecked",
      detail: "could not check https://example.org/: no answer (ETIMEDOUT) after 4 tries",
    });
  });
});

describe("the Horizon it talks to", () => {
  it("refuses any Horizon but the testnet one", () => {
    expect(m.TESTNET_HORIZON).toBe("https://horizon-testnet.stellar.org");
    expect(() => m.assertTestnetHorizon("https://horizon-testnet.stellar.org")).not.toThrow();
    expect(() => m.assertTestnetHorizon("https://horizon-testnet.stellar.org/")).not.toThrow();
    expect(() => m.assertTestnetHorizon("https://horizon.stellar.org")).toThrow(/testnet/);
  });

  it("defaults to every Markdown file under evidence/, then README.md and docs/write-up.md", () => {
    const root = mkdtempSync(join(tmpdir(), "dustin-evidence-"));
    for (const dir of ["evidence/runs/b", "evidence/runs/a", "evidence/tests", "docs"]) {
      mkdirSync(join(root, dir), { recursive: true });
    }
    for (const file of [
      "evidence/README.md",
      "evidence/runs/b/summary.md",
      "evidence/runs/a/summary.md",
      "evidence/runs/a/report.json",
      "evidence/runs/README.md",
      "evidence/tests/README.md",
      "README.md",
      "docs/write-up.md",
      "docs/other.md",
    ]) {
      writeFileSync(join(root, file), "# x");
    }
    expect(m.defaultFiles(root)).toEqual([
      join("evidence", "README.md"),
      join("evidence", "runs", "README.md"),
      join("evidence", "runs", "a", "summary.md"),
      join("evidence", "runs", "b", "summary.md"),
      join("evidence", "tests", "README.md"),
      "README.md",
      join("docs", "write-up.md"),
    ]);
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

  it("lists every failure, unchecked link and gone account, and counts the rest", () => {
    const text = m.render([
      row("ok", "HTTP 200"),
      row("gone", `account ${G} gone (merged)`),
      row("failed", "HTTP 404"),
      row("unchecked", "could not check x: HTTP 503 after 4 tries"),
      row("skipped", "mailto"),
    ]);
    expect(text).toContain(`GONE       evidence/README.md:3  x  account ${G} gone (merged)`);
    expect(text).toContain("FAIL       evidence/README.md:3  x  HTTP 404");
    expect(text).toContain("UNCHECKED  evidence/README.md:3  x  could not check x");
    expect(text).not.toContain("HTTP 200");
    expect(text).toContain(
      "5 links and 0 listed transaction hashes: 1 ok, 1 account gone, 1 skipped, 1 failed, 1 unchecked.",
    );
  });

  it("exits 1 on any failure, 3 when nothing failed but something is unchecked, and 0 otherwise", () => {
    expect(m.exitCodeOf([row("ok", ""), row("gone", "")])).toBe(0);
    expect(m.exitCodeOf([row("ok", ""), row("failed", ""), row("unchecked", "")])).toBe(1);
    expect(m.exitCodeOf([row("ok", ""), row("unchecked", "")])).toBe(3);
  });
});
