import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import {
  loadEvidenceCheck,
  type EvidenceCheck,
  type FetchLike,
  type MainDeps,
} from "./evidence-module.js";

// The Epic 4 closing review of 2026-09-29, evidence:check half (findings EP-5 to EP-16, BH-7,
// BH-8, BH-16, AC-11): every test here failed on the script before its fix (the probes of the
// review, ported). The network is a fake: each test says what Horizon and the pages answer.

let m: EvidenceCheck;
beforeAll(async () => {
  m = await loadEvidenceCheck();
});

const HORIZON = "https://horizon-testnet.stellar.org";
const TX = "36e53646514a36c673830955b661b91de297842481295f458de8c5911e5c989c";
const TX2 = "f7161ce4667cc9b3457aa6daa948f8b39df847b0576ab73849ac7325ad81f700";
const G = "GCPPFHGLKA7GCBWJXBH4EXFXS3OXAMXFLOBAZLU2K3KKMO6JKZORNFW7";
const INTO = "GDPZI3OAYYEAXTYY2OHFDZAEEG4PXNBN7AHNLQTEH22O5HTBGBSVB2TS";
const targets = (md: string) => m.extractLinks(md).map((l) => l.target);

/** A repository in a temporary directory: its files, and the paths git lists as committed. */
function repo(files: Record<string, string>, committed: string[] = Object.keys(files)) {
  const root = mkdtempSync(join(tmpdir(), "dustin-evidence-"));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return { root, git: { root, files: new Set(committed) } };
}

/** A fake network: `answers` by URL (a status, or a Response factory); anything else is 200. */
function network(answers: Record<string, number | (() => Response)> = {}) {
  const asked: string[] = [];
  const fetch: FetchLike = (url) => {
    asked.push(url);
    const a = answers[url];
    if (typeof a === "function") return Promise.resolve(a());
    return Promise.resolve(
      new Response(JSON.stringify({}), {
        status: a ?? 200,
        headers: { "content-type": "application/hal+json" },
      }),
    );
  };
  return { fetch, asked };
}

async function runMain(argv: string[], deps: MainDeps) {
  const out: string[] = [];
  const err: string[] = [];
  const code = await m.main(argv, {
    sleep: () => Promise.resolve(),
    env: {},
    stdout: (s) => void out.push(s),
    stderr: (s) => void err.push(s),
    ...deps,
  });
  return { code, out: out.join(""), err: err.join("") };
}

describe("EP-5: link text over two lines, titles, angle-bracket destinations, nested brackets", () => {
  it("finds every one of them (probes P-E1 to P-E3)", () => {
    expect(targets("See [the run\nsummary](runs/missing/summary.md) for details.\n")).toEqual([
      "runs/missing/summary.md",
    ]);
    expect(targets("[a](missing-a.md 'Title')\n[b](missing-b.md (Title))\n")).toEqual([
      "missing-a.md",
      "missing-b.md",
    ]);
    expect(targets("[a](<runs/my run/summary.md>)\n")).toEqual(["runs/my run/summary.md"]);
    expect(targets("[see [the run]](runs/a/summary.md) and [x [y [z]]](b.md)")).toEqual([
      "runs/a/summary.md",
      "b.md",
    ]);
    // An image inside a link: both, in the order they start.
    expect(targets("[![badge](https://img.example/b.svg)](https://ci.example/run)")).toEqual([
      "https://ci.example/run",
      "https://img.example/b.svg",
    ]);
  });

  it("does not take text across a blank line for a link", () => {
    expect(targets("[not\n\nlinked](x.md)")).toEqual([]);
  });
});

describe("EP-11: a footnote definition is not a reference definition", () => {
  it("reads no link from `[^1]: text`, and still finds the links inside it (probe P-E4)", () => {
    expect(targets("Text[^1].\n\n[^1]: See the run of 2026-09-28.\n")).toEqual([]);
    expect(targets("[^1]: See [the run](runs/a/summary.md).\n[ref]: b.md\n")).toEqual([
      "runs/a/summary.md",
      "b.md",
    ]);
  });
});

describe("EP-12: emphasis markers around a bare URL are not part of it", () => {
  it("drops the closing ** and _ of GFM emphasis (probe P-E6)", () => {
    const url = `https://horizon-testnet.stellar.org/transactions/${TX}`;
    expect(targets(`Merged: **${url}**\n`)).toEqual([url]);
    expect(targets(`Merged: _${url}_, then ~~https://example.org/a~~.`)).toEqual([
      url,
      "https://example.org/a",
    ]);
    expect(targets("(see https://example.org/a_(b))")).toEqual(["https://example.org/a_(b)"]);
    expect(m.classifyLink(targets(`**${url}**`)[0]!)).toEqual({
      kind: "tx",
      hash: TX,
      via: "horizon",
    });
  });
});

describe("EP-13, BH-16: every kind of code block is left out", () => {
  it("a fence indented in a list item (probe P-E7)", () => {
    expect(
      targets(
        "1. Run:\n   ```\n   curl https://horizon-testnet.stellar.org/accounts/<id>\n   ```\n",
      ),
    ).toEqual([]);
  });

  it("a 4-backtick fence holding a 3-backtick one, a tilde fence, and an unclosed fence", () => {
    expect(
      targets("````md\n```\n[a](a.md)\n```\n[b](b.md)\n````\n[c](c.md)\n~~~\n[d](d.md)\n~~~\n"),
    ).toEqual(["c.md"]);
    expect(targets("[e](e.md)\n```\n[f](f.md) https://example.org/f\n")).toEqual(["e.md"]);
  });

  it("an indented code block after a blank line, but not a list item's continuation", () => {
    expect(
      targets("Text.\n\n    curl https://example.org/x\n    [a](a.md)\n\nAfter [b](b.md)."),
    ).toEqual(["b.md"]);
    expect(targets("- item\n\n    continued with [c](c.md)\n")).toEqual(["c.md"]);
    expect(targets("Paragraph\n    still paragraph [d](d.md)\n")).toEqual(["d.md"]);
  });

  it("a code span over two lines, and one of two backticks holding a single one", () => {
    expect(
      targets("A `span over\nhttps://example.org/x` and ``a ` b https://example.org/y``."),
    ).toEqual([]);
  });
});

describe("EP-15: anchors are checked against headings, and /paths from the repository root", () => {
  it("builds GitHub's slugs: lowercase, punctuation removed, spaces to hyphens, repeats numbered", () => {
    expect(m.githubSlug("SOW Appendix A: the deliverable tracker")).toBe(
      "sow-appendix-a-the-deliverable-tracker",
    );
    expect(m.githubSlug("What survives a testnet reset?")).toBe("what-survives-a-testnet-reset");
    expect(m.githubSlug("Run the tests (offline) & live")).toBe("run-the-tests-offline--live");
    const anchors = m.headingAnchors(
      [
        "# Title",
        "## The `evidence:check` script",
        "## [Linked](x.md) *heading*",
        "## Title",
        "Setext heading",
        "---",
        '<a id="custom-anchor"></a>',
        "```",
        "# not a heading",
        "```",
      ].join("\n"),
    );
    expect([...anchors].sort()).toEqual(
      [
        "title",
        "the-evidencecheck-script",
        "linked-heading",
        "title-1",
        "setext-heading",
        "custom-anchor",
      ].sort(),
    );
  });

  it("fails an anchor that no heading of its file makes, alone or after a Markdown file (probe P-E10)", async () => {
    const { root, git } = repo({
      "evidence/README.md": [
        "# Evidence",
        "## What survives a testnet reset?",
        "[ok](#what-survives-a-testnet-reset) [bad](#no-such-heading)",
        "[ok](../README.md#quick-start) [bad](../README.md#no-such-heading) [json](runs/a.json#L3)",
      ].join("\n"),
      "README.md": "# Dustin\n## Quick start\n",
      "evidence/runs/a.json": "{}",
    });
    const r = await runMain([], { cwd: root, git, fetch: network().fetch });
    expect(r.code).toBe(1);
    expect(r.out).toContain(
      "evidence/README.md:3  #no-such-heading  no heading or id #no-such-heading in evidence/README.md",
    );
    expect(r.out).toContain(
      "evidence/README.md:4  ../README.md#no-such-heading  no heading or id #no-such-heading in README.md",
    );
    expect(r.out).toContain("5 links and 0 listed transaction hashes: 3 ok");
  });

  it("resolves a link that starts with / from the repository root, not from the file's directory (probe P-E11)", async () => {
    expect(m.classifyLink("/docs/test-matrix.md")).toEqual({
      kind: "relative",
      path: "docs/test-matrix.md",
      fromRoot: true,
      fragment: null,
    });
    const { root, git } = repo({
      "evidence/README.md":
        "[matrix](/docs/test-matrix.md) [missing](/evidence/docs/test-matrix.md)",
      "docs/test-matrix.md": "# Matrix",
    });
    const r = await runMain(["evidence/README.md"], { cwd: root, git, fetch: network().fetch });
    expect(r.out).toContain("evidence/docs/test-matrix.md does not exist");
    expect(r.out).toContain("2 links and 0 listed transaction hashes: 1 ok");
  });
});

describe("EP-6, BH-7: a bad link fails on its own; a bad argument is a usage error", () => {
  it("a bare % in a relative link is a failure of that link, not a URIError out of main (probe P-E5)", async () => {
    expect(m.classifyLink("report-100%.md")).toEqual({
      kind: "invalid",
      reason: "malformed percent escape in report-100%.md",
    });
    const { root, git } = repo({
      "evidence/README.md": "See [the 100% report](report-100%.md) and [x](README.md).",
    });
    const r = await runMain([], { cwd: root, git, fetch: network().fetch });
    expect(r.code).toBe(1);
    expect(r.out).toContain(
      "FAIL       evidence/README.md:1  report-100%.md  malformed percent escape",
    );
    expect(r.out).toContain("2 links and 0 listed transaction hashes: 1 ok");
  });

  it("a directory, a missing file or an unknown option is exit 2 with the usage text, never a stack trace", async () => {
    const { root, git } = repo({ "evidence/README.md": "# x" });
    for (const argv of [["evidence"], ["no-such.md"], ["--json"]]) {
      const r = await runMain(argv, { cwd: root, git, fetch: network().fetch });
      expect(r.code, argv.join(" ")).toBe(2);
      expect(r.err).toContain("Usage: npm run evidence:check");
      expect(r.err).not.toMatch(/\n\s+at /);
    }
    const help = await runMain(["--help"], { cwd: root, git });
    expect(help.code).toBe(0);
    expect(help.out).toContain("3 none failed but some could not be checked");
  });
});

describe("EP-7: an answer that could not be had is UNCHECKED, with its own exit code", () => {
  const tx = { kind: "tx", hash: TX, via: "horizon" } as const;

  it("a network error, a timeout, 429 and 5xx after the retries are unchecked, each said as it is (probe P-E12)", () => {
    expect(m.judgeResponse(tx, { status: null, error: "fetch failed", tries: 4 })).toEqual({
      verdict: "unchecked",
      detail: `could not check transaction ${TX}: no answer (fetch failed) after 4 tries`,
    });
    expect(m.judgeResponse(tx, { status: 429, tries: 4 })).toEqual({
      verdict: "unchecked",
      detail: `could not check transaction ${TX}: rate limited (HTTP 429) after 4 tries`,
    });
    expect(m.judgeResponse(tx, { status: 503, tries: 4 }).verdict).toBe("unchecked");
    expect(m.judgeResponse(tx, { status: 404 }).detail).toBe(
      `transaction ${TX} not found on testnet Horizon (HTTP 404)`,
    );
  });

  it("honours Retry-After up to the bound, and leaves a longer wait unchecked without waiting", async () => {
    const pauses: number[] = [];
    let calls = 0;
    const answer = await m.get(`${HORIZON}/transactions/${TX}`, {
      fetch: () =>
        Promise.resolve(
          ++calls === 1
            ? new Response("", { status: 429, headers: { "retry-after": "7" } })
            : new Response("{}", { status: 200 }),
        ),
      sleep: (ms) => Promise.resolve(void pauses.push(ms)),
    });
    expect(answer).toMatchObject({ status: 200, tries: 2 });
    expect(pauses).toEqual([7000]);

    const long = await m.get(`${HORIZON}/transactions/${TX}`, {
      fetch: () =>
        Promise.resolve(new Response("", { status: 429, headers: { "retry-after": "600" } })),
      sleep: () => Promise.reject(new Error("must not wait")),
    });
    expect(long).toEqual({ status: 429, tries: 1, retryAfterMs: 600_000 });
    expect(m.judgeResponse(tx, long).detail).toBe(
      `could not check transaction ${TX}: rate limited (HTTP 429); it asked to wait 600 s, more than the 60 s this check waits`,
    );
    expect(
      m.parseRetryAfter("Wed, 30 Sep 2026 00:00:10 GMT", Date.parse("2026-09-30T00:00:00Z")),
    ).toBe(10_000);
    expect(m.parseRetryAfter(null)).toBeNull();
  });

  it("a 403 from Cloudflare's bot protection is unchecked, any other 403 a failure", async () => {
    const page = { kind: "https", url: "https://medium.com/x" } as const;
    const blocked = await m.get("https://medium.com/x", {
      fetch: () =>
        Promise.resolve(
          new Response("<title>Attention Required! | Cloudflare</title>", {
            status: 403,
            headers: { server: "cloudflare" },
          }),
        ),
    });
    expect(blocked).toEqual({ status: 403, tries: 1, server: "cloudflare" });
    expect(m.judgeResponse(page, blocked)).toEqual({
      verdict: "unchecked",
      detail:
        "could not check https://medium.com/x: its bot protection (Cloudflare) answered HTTP 403 to this automated check; open it in a browser",
    });
    expect(m.judgeResponse(page, { status: 403, server: "nginx" }).verdict).toBe("failed");
  });

  it("exits 3 when a link could not be checked and nothing failed, and documents it", async () => {
    const { root, git } = repo({
      "evidence/README.md": `[tx](https://stellar.expert/explorer/testnet/tx/${TX})`,
    });
    const r = await runMain([], {
      cwd: root,
      git,
      fetch: () => Promise.reject(new Error("getaddrinfo ENOTFOUND")),
    });
    expect(r.code).toBe(3);
    expect(r.out).toContain(`UNCHECKED  evidence/README.md:1`);
    expect(r.out).toContain("no answer (getaddrinfo ENOTFOUND) after 4 tries");
    const script = readFileSync("scripts/evidence-check.mjs", "utf8");
    expect(script).toContain("3 when none failed but one is UNCHECKED");
    expect(m.USAGE).toContain("3 none failed but some could not be checked");
  });
});

describe("EP-8: a relative link must name a committed file", () => {
  it("fails a file that exists on this disk but is not committed, or differs in case", () => {
    const { root } = repo({ "evidence/runs/a/summary.md": "# a", "evidence/local.md": "# local" });
    const git = { root, files: new Set(["evidence/runs/a/summary.md"]) };
    expect(m.judgeRelative("evidence/runs/a/summary.md", { git, root }).verdict).toBe("ok");
    expect(m.judgeRelative("evidence/runs/a", { git, root }).verdict).toBe("ok");
    expect(m.judgeRelative("evidence/local.md", { git, root })).toEqual({
      verdict: "failed",
      detail:
        "evidence/local.md is not committed (not in git ls-files with this exact case), though a file answers to it on this disk",
    });
    expect(m.judgeRelative("evidence/runs/a/SUMMARY.md", { git, root }).verdict).toBe("failed");
    expect(m.judgeRelative("../outside.md", { git, root }).detail).toBe(
      "../outside.md is outside the repository",
    );
  });

  it("outside a git checkout it falls back to the disk, and the report says so", async () => {
    const { root } = repo({ "evidence/README.md": "[x](runs/a.md)", "evidence/runs/a.md": "# a" });
    expect(m.judgeRelative("evidence/runs/a.md", { git: null, root })).toEqual({
      verdict: "ok",
      detail: "exists on this disk (not a git checkout: not checked against git ls-files)",
    });
    const r = await runMain([], { cwd: root, git: null, fetch: network().fetch });
    expect(r.code).toBe(0);
    expect(r.out).toContain(
      "NOTE      not a git checkout: relative links are checked on this disk, not against git ls-files",
    );
  });
});

describe("EP-9, AC-11: every file of the evidence package, and every listed hash", () => {
  it("extracts the hashes listed in code spans and table cells, lowercase, but not a labelled plan hash", () => {
    const md = [
      `| # | Hash | Inner hash |`,
      `|---|---|---|`,
      `| 1 | \`${TX}\` | ${TX2.toUpperCase()} |`,
      `| Plan hash | \`${"a".repeat(64)}\` |`,
      `The merge \`${TX2}\`; the snapshot hash \`${"b".repeat(64)}\`; pool \`${"c".repeat(64)}\`.`,
      `Linked: [tx](https://stellar.expert/explorer/testnet/tx/${"d".repeat(64)}).`,
      "```",
      `\`${"e".repeat(64)}\``,
      "```",
    ].join("\n");
    expect(m.extractHashes(md)).toEqual([
      { hash: TX, line: 3 },
      { hash: TX2, line: 3 },
      { hash: TX2, line: 5 },
    ]);
  });

  it("checks each listed hash once on testnet Horizon, and not again when it is linked", async () => {
    const { root, git } = repo({
      "evidence/README.md": `| 1 | \`${TX}\` |\n| 2 | \`${TX2}\` |\n[tx](https://stellar.expert/explorer/testnet/tx/${TX2})`,
      "evidence/runs/a/summary.md": `| 1 | \`${TX}\` |`,
      "docs/write-up.md": `The merge (\`${"f".repeat(64)}\`).`,
      "README.md": "# Dustin",
    });
    const { fetch, asked } = network({ [`${HORIZON}/transactions/${"f".repeat(64)}`]: 404 });
    const r = await runMain([], { cwd: root, git, fetch });
    expect(asked.sort()).toEqual(
      [
        `${HORIZON}/transactions/${TX}`,
        `${HORIZON}/transactions/${TX2}`,
        `${HORIZON}/transactions/${"f".repeat(64)}`,
      ].sort(),
    );
    expect(r.code).toBe(1);
    expect(r.out).toContain(
      `FAIL       docs/write-up.md:1  ${"f".repeat(64)}  transaction ${"f".repeat(64)} not found on testnet Horizon (HTTP 404)`,
    );
    // docs/write-up.md is one of STORED_TX_SOURCES, so its uncovered hash also fails the rule of the
    // stored records (final audit of 2026-09-30; evidence-check-stored.test.ts).
    expect(r.out).toContain(
      "1 links, 2 listed transaction hashes and 1 cited transactions without a stored record: 2 ok",
    );
  });
});

describe("EP-10, BH-8: an account that answers 404 is judged by its history", () => {
  const merged = {
    _embedded: {
      records: [
        {
          type: "account_merge",
          source_account: G,
          into: INTO,
          transaction_hash: TX,
        },
      ],
    },
  };
  const json = (body: unknown) => () =>
    new Response(JSON.stringify(body), { headers: { "content-type": "application/hal+json" } });

  it("history ending in its own account_merge is gone (merged); no history at all is a failure (probe P-E8)", () => {
    expect(m.judgeAccountHistory(G, { status: 200, body: merged })).toEqual({
      verdict: "gone",
      detail: `account ${G} gone (merged into ${INTO} by transaction ${TX})`,
    });
    expect(m.judgeAccountHistory(G, { status: 404 })).toEqual({
      verdict: "failed",
      detail: `account ${G} answers 404 and testnet Horizon holds no operation for it: it never existed on this network, or a reset removed it`,
    });
    expect(m.judgeAccountHistory(G, { status: 503, tries: 4 }).verdict).toBe("unchecked");
  });

  it("checks StellarExpert account links on Horizon too, and sends uppercase hashes lowercase (probes P-E13, P-E14)", async () => {
    expect(m.classifyLink(`https://stellar.expert/explorer/testnet/account/${G}`)).toEqual({
      kind: "account",
      account: G,
      via: "stellar.expert",
    });
    expect(
      m.classifyLink(`https://stellar.expert/explorer/testnet/tx/${TX.toUpperCase()}`),
    ).toEqual({
      kind: "tx",
      hash: TX,
      via: "stellar.expert",
    });
    const never = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
    const { root, git } = repo({
      "evidence/README.md": [
        `[closed](https://stellar.expert/explorer/testnet/account/${G})`,
        `[never](${HORIZON}/accounts/${never})`,
      ].join("\n"),
    });
    const { fetch, asked } = network({
      [`${HORIZON}/accounts/${G}`]: 404,
      [`${HORIZON}/accounts/${G}/operations?order=desc&limit=200`]: json(merged),
      [`${HORIZON}/accounts/${never}`]: 404,
      [`${HORIZON}/accounts/${never}/operations?order=desc&limit=200`]: 404,
    });
    const r = await runMain(["evidence/README.md"], { cwd: root, git, fetch });
    expect(asked).not.toContain(`https://stellar.expert/explorer/testnet/account/${G}`);
    expect(r.code).toBe(1);
    expect(r.out).toContain(`GONE       evidence/README.md:1`);
    expect(r.out).toContain(`gone (merged into ${INTO} by transaction ${TX})`);
    expect(r.out).toContain(`FAIL       evidence/README.md:2  ${HORIZON}/accounts/${never}`);
  });
});

describe("EP-14: mainnet explorers and redirects to them are refused", () => {
  it("refuses the known mainnet explorers, Lab mainnet links and hosts that name the mainnet (probe P-E9)", () => {
    for (const url of [
      `https://stellarchain.io/transactions/${TX}`,
      `https://www.steexp.com/tx/${TX}`,
      `https://lumenscan.io/txns/${TX}`,
      `https://blockchair.com/stellar/transaction/${TX}`,
      `https://lab.stellar.org/r/mainnet/tx/${TX}`,
      `https://lab.stellar.org/transaction/dashboard?$=network$id=mainnet`,
      "https://mainnet.sorobanrpc.com",
      "https://horizon.stellar.lobstr.co/accounts/x",
      `https://stellar.expert/explorer/futurenet/tx/${TX}`,
    ]) {
      expect(m.classifyLink(url), url).toMatchObject({ kind: "refused" });
    }
    for (const url of [
      `https://testnet.stellarchain.io/transactions/${TX}`,
      `https://lab.stellar.org/r/testnet/tx/${TX}`,
      "https://soroban-testnet.stellar.org",
    ]) {
      expect(m.classifyLink(url), url).toMatchObject({ kind: "https" });
    }
  });

  it("does not follow a redirect to a refused URL", async () => {
    const { root, git } = repo({ "evidence/README.md": "[x](https://short.example/tx)" });
    const { fetch, asked } = network({
      "https://short.example/tx": () =>
        new Response("", {
          status: 302,
          headers: { location: `https://stellar.expert/explorer/public/tx/${TX}` },
        }),
    });
    const r = await runMain([], { cwd: root, git, fetch });
    expect(asked).toEqual(["https://short.example/tx"]);
    expect(r.code).toBe(1);
    expect(r.out).toContain(
      `redirects to https://stellar.expert/explorer/public/tx/${TX}, refused: StellarExpert network public is not the testnet`,
    );
  });

  it("follows other redirects, at most five", async () => {
    const hop = (n: number) => () =>
      new Response("", { status: 301, headers: { location: `https://a.example/${n + 1}` } });
    const answers = Object.fromEntries(
      Array.from({ length: 10 }, (_, n) => [`https://a.example/${n}`, hop(n)]),
    );
    const answer = await m.get("https://a.example/0", { fetch: network(answers).fetch });
    expect(answer).toMatchObject({ status: 301, tooManyRedirects: true });
    const ok = await m.get("https://a.example/0", {
      fetch: network({ "https://a.example/0": hop(0) }).fetch,
    });
    expect(ok).toMatchObject({ status: 200, tries: 1 });
  });
});

describe("EP-16: an empty DUSTIN_HORIZON_URL counts as unset, as in the CLI", () => {
  it("asks the testnet Horizon, and still refuses any other", async () => {
    expect(m.horizonFromEnv({ DUSTIN_HORIZON_URL: "" })).toBe(HORIZON);
    expect(m.horizonFromEnv({})).toBe(HORIZON);
    const { root, git } = repo({ "evidence/README.md": "# x" });
    expect((await runMain([], { cwd: root, git, env: { DUSTIN_HORIZON_URL: "" } })).code).toBe(0);
    const other = await runMain([], {
      cwd: root,
      git,
      env: { DUSTIN_HORIZON_URL: "https://horizon.stellar.org" },
    });
    expect(other.code).toBe(2);
    expect(other.err).toContain("only asks the testnet Horizon");
  });
});
