import { Keypair } from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";
import { run } from "../../../src/cli/run.js";

function capture() {
  const out: string[] = [];
  const err: string[] = [];
  return {
    io: { stdout: (s: string) => void out.push(s), stderr: (s: string) => void err.push(s) },
    out: () => out.join(""),
    err: () => err.join(""),
  };
}

const node = ["node", "dustin"];

describe("dustin CLI run()", () => {
  it("prints help and exits 0", async () => {
    const c = capture();
    expect(await run([...node, "--help"], c.io, "1.2.3")).toBe(0);
    expect(c.out()).toMatch(/\bplan\b/);
  });

  it("prints the version and exits 0", async () => {
    const c = capture();
    expect(await run([...node, "--version"], c.io, "1.2.3")).toBe(0);
    expect(c.out().trim()).toBe("1.2.3");
  });

  it("refuses a secret on argv with exit 2 and never echoes it", async () => {
    const seed = Keypair.random().secret();
    for (const argv of [
      [...node, "close", Keypair.random().publicKey(), "--to", seed],
      [...node, "close", `--memo=${seed}`],
    ]) {
      const c = capture();
      expect(await run(argv, c.io, "1.2.3")).toBe(2);
      expect(c.err()).toContain("SECRET_IN_ARGV");
      expect(c.out() + c.err()).not.toContain(seed);
    }
  });

  it("refuses any network other than testnet with exit 2", async () => {
    const c = capture();
    const argv = [...node, "--network", "public", "plan", Keypair.random().publicKey()];
    expect(await run(argv, c.io, "1.2.3")).toBe(2);
    expect(c.err()).toContain("MAINNET_REFUSED");
  });

  it("maps usage errors to exit 2", async () => {
    const c = capture();
    expect(await run([...node, "plan"], c.io, "1.2.3")).toBe(2);
    const d = capture();
    expect(await run([...node, "frobnicate"], d.io, "1.2.3")).toBe(2);
  });

  it("maps an unexpected failure to exit 1", async () => {
    const c = capture();
    expect(await run([...node, "plan", Keypair.random().publicKey()], c.io, "1.2.3")).toBe(1);
    expect(c.err()).toContain("NOT_IMPLEMENTED");
  });
});

describe("argv secret guard (review findings)", () => {
  it("refuses seeds glued to other characters and never lets commander echo them", async () => {
    const seed = Keypair.random().secret();
    for (const argv of [
      [...node, `${seed}X`],
      [...node, "plan", Keypair.random().publicKey(), `--frob=${seed}Q`],
      [...node, "plan", Keypair.random().publicKey(), `--to=2${seed}`],
    ]) {
      const c = capture();
      expect(await run(argv, c.io, "1.2.3")).toBe(2);
      expect(c.err()).toContain("SECRET_IN_ARGV");
      expect(c.out() + c.err()).not.toContain(seed);
    }
  });

  it("redacts whatever commander prints", async () => {
    const c = capture();
    const fake = `S${"A".repeat(54)}`; // not a seed, but commander output still passes through redact()
    expect(
      await run([...node, "plan", Keypair.random().publicKey(), `--nope=${fake}`], c.io, "1.2.3"),
    ).toBe(2);
    expect(c.err()).toContain("unknown option");
  });

  it("accepts --memo on plan and refuses --to together with --destination", async () => {
    const acct = Keypair.random().publicKey();
    const dest = Keypair.random().publicKey();
    const a = capture();
    expect(await run([...node, "plan", acct, "--to", dest, "--memo", "m"], a.io, "1.2.3")).toBe(1); // reaches NOT_IMPLEMENTED
    const b = capture();
    expect(
      await run([...node, "plan", acct, "--to", dest, "--destination", dest], b.io, "1.2.3"),
    ).toBe(2);
  });
});
