import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { run } from "../../../src/cli/run.js";

// Horizon JSON recorded from a live messy fixture on 2026-09-26 (dustin fixture create).
const DIR = "test/fixtures/horizon/messy";
const recorded = new Map<string, { status: number; body: unknown }>();
for (const file of readdirSync(DIR).filter((f) => f !== "manifest.json")) {
  const r = JSON.parse(readFileSync(join(DIR, file), "utf8")) as {
    path: string;
    status: number;
    body: unknown;
  };
  recorded.set(r.path, r);
}

function fakeHorizon(mutate?: (path: string, body: unknown) => unknown) {
  return (url: string) => {
    const path = url.replace("https://horizon-testnet.stellar.org", "");
    const hit = recorded.get(path);
    const body = hit && mutate ? mutate(path, structuredClone(hit.body)) : hit?.body;
    return Promise.resolve(
      new Response(JSON.stringify(body ?? { status: 404 }), { status: hit ? hit.status : 404 }),
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

const manifestPath = join(DIR, "manifest.json");

describe("dustin fixture verify (recorded Horizon)", () => {
  it("passes every Appendix B check on the recorded fixture and writes a snapshot", async () => {
    const c = capture();
    const snapshot = join(mkdtempSync(join(tmpdir(), "dustin-")), "snapshot.json");
    const code = await run(
      ["node", "dustin", "fixture", "verify", manifestPath, "--snapshot", snapshot],
      c.io,
      "0.0.0",
      { env: {}, fetch: fakeHorizon() },
    );
    expect(c.text()).toContain("Fixture verified");
    expect(code).toBe(0);
    const saved = JSON.parse(readFileSync(snapshot, "utf8")) as { result: { pass: boolean } };
    expect(saved.result.pass).toBe(true);
  });

  it("exits 3 when the fixture gains one stroop of spendable XLM", async () => {
    const c = capture();
    const bump = (path: string, body: unknown) => {
      if (!/^\/accounts\/[A-Z0-9]+$/.test(path)) return body;
      const acc = body as { balances: { asset_type: string; balance: string }[] };
      const native = acc.balances.find((b) => b.asset_type === "native");
      if (native && native.balance === "4.0000000") native.balance = "4.0000001";
      return acc;
    };
    const code = await run(["node", "dustin", "fixture", "verify", manifestPath], c.io, "0.0.0", {
      env: {},
      fetch: fakeHorizon(bump),
    });
    expect(code).toBe(3);
    expect(c.text()).toMatch(/FAIL\s+\[Appendix B\] holds zero spendable XLM/);
  });

  it("refuses a file that is not a fixture manifest", async () => {
    const bad = join(mkdtempSync(join(tmpdir(), "dustin-")), "bad.json");
    writeFileSync(bad, JSON.stringify({ hello: "world" }));
    const c = capture();
    expect(
      await run(["node", "dustin", "fixture", "verify", bad], c.io, "0.0.0", { env: {} }),
    ).toBe(1);
    expect(c.text()).toContain("MANIFEST_INVALID");
  });
});
