import { PassThrough } from "node:stream";
import { Keypair } from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";
import { hiddenPrompt } from "../../../src/cli/prompt.js";
import { askCloseSigners } from "../../../src/cli/secrets.js";
import type { DustinError } from "../../../src/errors/dustin-error.js";
import { executeClose } from "../../../src/execute/executor.js";
import { messy } from "../../helpers/snapshots.js";
import { harness, signerFor } from "../execute/harness.js";
import { closeCli, emptyDir, executeArgs, secretForms, zeroSpendableWorld } from "./close-world.js";

// Epic 4 closing review, the secrets of `close --execute` and the SDK's signers. Each test is
// named after its finding ID and fails on the code before the fix.

/** A fake terminal: standard input and standard error as TTYs, what is written collected. */
function terminal() {
  const input = Object.assign(new PassThrough(), { isTTY: true });
  const output = Object.assign(new PassThrough(), { isTTY: true });
  const written: string[] = [];
  output.on("data", (chunk: Buffer) => written.push(chunk.toString("utf8")));
  return { input, output, written };
}

const flat = (text: string) => text.replace(/\s+/g, " ");

describe("EX-10: WRONG_SIGNER names where the wrong secret came from", () => {
  it("EX-10: a seed of another account typed at the hidden prompt is named as typed there", async () => {
    const world = zeroSpendableWorld();
    const other = Keypair.random();
    const r = await closeCli(world, executeArgs(world, "--yes"), {
      env: { DUSTIN_SPONSOR_SECRET: world.env.DUSTIN_SPONSOR_SECRET },
      secretPrompt: () => Promise.resolve(other.secret()),
    });
    expect(r.code).toBe(2);
    const err = flat(r.err);
    // Before the fix: "The secret in DUSTIN_ACCOUNT_SECRET belongs to ...", "Set DUSTIN_ACCOUNT_SECRET to ...".
    expect(err).toContain(
      `WRONG_SIGNER: The secret key typed at the hidden prompt for DUSTIN_ACCOUNT_SECRET belongs to ${other.publicKey()}, not to the account ${world.id}.`,
    );
    expect(err).toContain(
      "Run the command again and type the secret key of the account being closed at the hidden prompt",
    );
    for (const form of secretForms(other, world.account, world.sponsor)) {
      expect(r.err).not.toContain(form);
    }
  });

  it("EX-10: a wrong seed in .env is named as coming from .env", async () => {
    const world = zeroSpendableWorld();
    const other = Keypair.random();
    const r = await closeCli(world, executeArgs(world, "--yes"), {
      env: { DUSTIN_SPONSOR_SECRET: world.env.DUSTIN_SPONSOR_SECRET },
      cwd: emptyDir(`DUSTIN_ACCOUNT_SECRET=${other.secret()}\n`),
    });
    expect(r.code).toBe(2);
    const err = flat(r.err);
    expect(err).toContain(
      "The secret key in DUSTIN_ACCOUNT_SECRET (from .env in the working directory) belongs to",
    );
    expect(err).toContain("Set DUSTIN_ACCOUNT_SECRET in .env to the secret key of the account");
  });

  it("EX-10: a wrong seed in the environment is named as coming from the environment", async () => {
    const world = zeroSpendableWorld();
    const r = await closeCli(world, executeArgs(world, "--yes"), {
      env: { ...world.env, DUSTIN_ACCOUNT_SECRET: Keypair.random().secret() },
    });
    expect(r.code).toBe(2);
    expect(flat(r.err)).toContain(
      "The secret key in DUSTIN_ACCOUNT_SECRET (from the environment) belongs to",
    );
    expect(flat(r.err)).toContain("Set DUSTIN_ACCOUNT_SECRET in the environment to");
  });

  it("EX-10: --sponsor against a sponsor typed at the prompt names the prompt", async () => {
    const world = zeroSpendableWorld();
    const other = Keypair.random().publicKey();
    const r = await closeCli(world, executeArgs(world, "--yes", "--sponsor", other), {
      env: { DUSTIN_ACCOUNT_SECRET: world.env.DUSTIN_ACCOUNT_SECRET },
      secretPrompt: () => Promise.resolve(world.sponsor.secret()),
    });
    expect(r.code).toBe(2);
    expect(flat(r.err)).toContain(
      `--sponsor names ${other}, but the secret key typed at the hidden prompt for DUSTIN_SPONSOR_SECRET belongs to ${world.sponsor.publicKey()}.`,
    );
  });
});

describe("D-10: the SDK's WRONG_SIGNER names the signer argument, never an environment variable", () => {
  it("D-10: a signer for another account names signers.account", async () => {
    const h = harness();
    const plan = await h.plan();
    const other = Keypair.random().publicKey();
    const error = (await executeClose(
      plan,
      { account: signerFor(other), feeSponsor: signerFor(messy.sponsor) },
      { confirm: true, ...h.deps },
    ).catch((e: unknown) => e)) as DustinError;
    expect(error.code).toBe("WRONG_SIGNER");
    expect(error.remedy).toContain("signers.account");
    // Before the fix: "Set DUSTIN_ACCOUNT_SECRET to the secret key of the account being closed."
    expect(error.remedy).not.toContain("DUSTIN_");
  });

  it("D-10: a sponsor signer the plan does not name names signers.feeSponsor", async () => {
    const h = harness();
    const plan = await h.plan();
    const error = (await executeClose(
      plan,
      { account: signerFor(messy.fixture), feeSponsor: signerFor(Keypair.random().publicKey()) },
      { confirm: true, ...h.deps },
    ).catch((e: unknown) => e)) as DustinError;
    expect(error.code).toBe("WRONG_SIGNER");
    expect(error.remedy).toContain("signers.feeSponsor");
    expect(error.remedy).not.toContain("DUSTIN_");
    expect(error.remedy).not.toContain("--sponsor");
  });
});

describe("EX-11: both secrets pasted at the first hidden prompt", () => {
  it("EX-11: the second pasted line answers the second question at once, with nothing echoed", async () => {
    const t = terminal();
    const ask = hiddenPrompt(t);
    const first = ask("A: ");
    t.input.write("FIRST\rSECOND\r");
    await expect(first).resolves.toBe("FIRST");
    // Before the fix the second line was dropped and the second question kept waiting.
    const second = await Promise.race([
      ask("B: "),
      new Promise((resolve) => setTimeout(() => resolve("<still waiting>"), 100)),
    ]);
    expect(second).toBe("SECOND");
    const shown = t.written.join("");
    expect(shown).toContain("A: ");
    expect(shown).toContain("B: ");
    expect(shown).not.toContain("FIRST");
    expect(shown).not.toContain("SECOND");
  });

  it("EX-11: close --execute reads both pasted secrets and closes", async () => {
    const world = zeroSpendableWorld();
    const t = terminal();
    const prompt = hiddenPrompt(t);
    let pasted = false;
    const r = await closeCli(world, executeArgs(world, "--yes"), {
      env: {},
      secretPrompt: (question) => {
        const answer = prompt(question);
        if (!pasted) {
          pasted = true;
          t.input.write(`${world.account.secret()}\r${world.sponsor.secret()}\r`);
        }
        return answer;
      },
    });
    expect(r.code).toBe(0);
    for (const form of secretForms(world.account, world.sponsor)) {
      expect(t.written.join("")).not.toContain(form);
      expect(r.err).not.toContain(form);
      expect(r.out).not.toContain(form);
    }
  });
});

describe("BH-21: an empty line at the hidden prompt", () => {
  it("BH-21: says that no secret was typed, not that the input ended or Ctrl-C was pressed", async () => {
    const error = (await askCloseSigners(Keypair.random().publicKey(), { env: {} }, () =>
      Promise.resolve(""),
    ).catch((e: unknown) => e)) as DustinError;
    expect(error.code).toBe("MISSING_ACCOUNT_SECRET");
    expect(error.message).toContain(
      "no secret was typed at the hidden prompt (the line entered was empty)",
    );
    expect(error.message).not.toContain("the input ended");
  });

  it("BH-21: the end of input and Ctrl-C keep their own words", async () => {
    const error = (await askCloseSigners(Keypair.random().publicKey(), { env: {} }, () =>
      Promise.resolve(null),
    ).catch((e: unknown) => e)) as DustinError;
    expect(error.message).toContain("(the input ended, or Ctrl-C was pressed)");
  });
});
