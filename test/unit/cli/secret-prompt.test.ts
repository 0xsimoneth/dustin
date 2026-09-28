import { PassThrough } from "node:stream";
import { Keypair } from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";
import { hiddenPrompt } from "../../../src/cli/prompt.js";
import { run } from "../../../src/cli/run.js";
import type { SecretPrompt } from "../../../src/cli/secrets.js";
import {
  closeCli,
  executeArgs,
  secretForms,
  zeroSpendableWorld,
  type World,
} from "./close-world.js";

// Review finding CA-18, PRD decision D-11 (story E4-S2): `close --execute` asks for a secret that
// is in neither the environment nor `.env` with a hidden prompt, when standard input and standard
// error are both terminals and --json is not given (canonical decision 4). Otherwise the run is
// refused with MISSING_ACCOUNT_SECRET or MISSING_SPONSOR_SECRET, exit 2. The prompt is injected
// (CliDeps.secretPrompt), so the tests drive it with fake terminal streams.

function terminal(inputIsTTY = true, outputIsTTY = true) {
  const input = Object.assign(new PassThrough(), { isTTY: inputIsTTY });
  const output = Object.assign(new PassThrough(), { isTTY: outputIsTTY });
  const written: string[] = [];
  output.on("data", (chunk: Buffer) => written.push(chunk.toString("utf8")));
  return { input, output, written };
}

describe("hiddenPrompt", () => {
  it("writes the question, resolves with what was typed and never echoes it", async () => {
    const t = terminal();
    const secret = Keypair.random().secret();
    const answer = hiddenPrompt(t)("Type the secret (the input is hidden): ");
    t.input.write(`${secret}\r`);
    await expect(answer).resolves.toBe(secret);
    const shown = t.written.join("");
    expect(shown).toContain("Type the secret (the input is hidden): ");
    expect(shown).not.toContain(secret);
    expect(shown).not.toContain(secret.slice(0, 8));
  });

  it("resolves with null at the end of input, on Ctrl-D and on Ctrl-C", async () => {
    for (const send of [
      (i: PassThrough) => i.end(),
      (i: PassThrough) => i.write("\x04"),
      (i: PassThrough) => i.write("\x03"),
    ]) {
      const t = terminal();
      const answer = hiddenPrompt(t)("? ");
      send(t.input);
      await expect(answer).resolves.toBeNull();
    }
  });

  it("does not ask when standard input or standard error is not a terminal, and says which", async () => {
    const piped = terminal(false, true);
    await expect(hiddenPrompt(piped)("? ")).resolves.toEqual({
      unasked: expect.stringMatching(/^standard input is not a terminal/) as unknown,
    });
    const logged = terminal(true, false);
    await expect(hiddenPrompt(logged)("? ")).resolves.toEqual({
      unasked: expect.stringMatching(/^standard error is not a terminal/) as unknown,
    });
    expect(piped.written).toEqual([]);
    expect(logged.written).toEqual([]);
  });
});

/** A secret prompt that answers from a list and records every question. */
function answering(...answers: Array<string | null | { unasked: string }>) {
  const questions: string[] = [];
  const prompt: SecretPrompt = (question) => {
    questions.push(question);
    return Promise.resolve(answers.shift() ?? null);
  };
  return { prompt, questions };
}

function expectNoSecret(world: World, ...texts: string[]) {
  for (const text of texts) {
    for (const form of secretForms(world.account, world.sponsor)) expect(text).not.toContain(form);
  }
}

describe("dustin close --execute and the hidden prompt (CA-18, D-11)", () => {
  it("asks for both secrets when neither the environment nor .env holds them, and closes (exit 0)", async () => {
    const world = zeroSpendableWorld();
    const { prompt, questions } = answering(world.account.secret(), world.sponsor.secret());
    const r = await closeCli(world, executeArgs(world, "--yes"), { env: {}, secretPrompt: prompt });
    expect(r.code).toBe(0);
    expect(questions).toHaveLength(2);
    expect(questions[0]).toMatch(/DUSTIN_ACCOUNT_SECRET is not set in the environment or in \.env/);
    expect(questions[0]).toMatch(/the input is hidden/);
    expect(questions[1]).toMatch(/DUSTIN_SPONSOR_SECRET/);
    expect(world.ledger.accounts.has(world.id)).toBe(false);
    expectNoSecret(world, r.out, r.err, ...questions);
  });

  it("asks only for the one that is missing", async () => {
    const world = zeroSpendableWorld();
    const { prompt, questions } = answering(world.sponsor.secret());
    const r = await closeCli(world, executeArgs(world, "--yes"), {
      env: { DUSTIN_ACCOUNT_SECRET: world.env.DUSTIN_ACCOUNT_SECRET },
      secretPrompt: prompt,
    });
    expect(r.code).toBe(0);
    expect(questions).toHaveLength(1);
    expect(questions[0]).toMatch(/DUSTIN_SPONSOR_SECRET/);
  });

  it("checks a typed account secret before asking for the sponsor's (exit 2)", async () => {
    const world = zeroSpendableWorld();
    const other = Keypair.random();
    const { prompt, questions } = answering(other.secret(), world.sponsor.secret());
    const r = await closeCli(world, executeArgs(world, "--yes"), { env: {}, secretPrompt: prompt });
    expect(r.code).toBe(2);
    expect(r.err).toContain("WRONG_SIGNER");
    expect(questions).toHaveLength(1);
    for (const form of secretForms(other)) expect(r.out + r.err).not.toContain(form);
  });

  it("refuses a typed value that is not a secret key without echoing it (exit 2)", async () => {
    const world = zeroSpendableWorld();
    const { prompt } = answering("hunter2");
    const r = await closeCli(world, executeArgs(world, "--yes"), { env: {}, secretPrompt: prompt });
    expect(r.code).toBe(2);
    expect(r.err).toContain("CONFIG_INVALID");
    expect(r.err).toContain("from the hidden prompt is not a valid Stellar secret key");
    expect(r.err).not.toContain("hunter2");
  });

  it("counts Ctrl-C or the end of input at the prompt as a missing secret (exit 2)", async () => {
    const world = zeroSpendableWorld();
    const { prompt } = answering(null);
    const r = await closeCli(world, executeArgs(world, "--yes"), { env: {}, secretPrompt: prompt });
    expect(r.code).toBe(2);
    expect(r.err).toContain("MISSING_ACCOUNT_SECRET");
    expect(r.err).toMatch(/no secret was typed at the hidden prompt/);
    expect(world.ledger.submissions).toHaveLength(0);
  });

  it("refuses as before when the prompt cannot be asked, naming why (exit 2)", async () => {
    const world = zeroSpendableWorld();
    const { prompt } = answering({
      unasked: "standard input is not a terminal (it is redirected or piped)",
    });
    const r = await closeCli(world, executeArgs(world, "--yes"), { env: {}, secretPrompt: prompt });
    expect(r.code).toBe(2);
    expect(r.err).toContain("MISSING_ACCOUNT_SECRET");
    expect(r.err).toContain("standard input is not a terminal");
  });

  it("never asks with --json: machine mode is non-interactive (exit 2)", async () => {
    const world = zeroSpendableWorld();
    const { prompt, questions } = answering(world.account.secret(), world.sponsor.secret());
    const r = await closeCli(world, executeArgs(world, "--yes", "--json"), {
      env: {},
      secretPrompt: prompt,
    });
    expect(r.code).toBe(2);
    expect(questions).toEqual([]);
    expect(JSON.parse(r.err.trim())).toMatchObject({
      type: "error",
      code: "MISSING_ACCOUNT_SECRET",
      exitCode: 2,
    });
  });

  it("names the three sources in the help text of close", async () => {
    const out: string[] = [];
    const code = await run(
      ["node", "dustin", "close", "--help"],
      { stdout: (s) => void out.push(s), stderr: () => undefined },
      "0.0.0",
    );
    expect(code).toBe(0);
    const help = out.join("").replace(/\s+/g, " ");
    expect(help).toContain("DUSTIN_ACCOUNT_SECRET and DUSTIN_SPONSOR_SECRET");
    expect(help).toMatch(/environment/);
    expect(help).toMatch(/\.env in the working directory/);
    expect(help).toMatch(/hidden prompt/);
    expect(help).toMatch(/never from the command line/);
  });
});
