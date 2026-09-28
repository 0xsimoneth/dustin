import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { terminalPrompt } from "../../../src/cli/prompt.js";

function terminal(isTTY = true, outputIsTTY = true) {
  const input = Object.assign(new PassThrough(), { isTTY });
  const output = Object.assign(new PassThrough(), { isTTY: outputIsTTY });
  const written: string[] = [];
  output.on("data", (chunk: Buffer) => written.push(chunk.toString("utf8")));
  return { input, output, written };
}

describe("terminalPrompt", () => {
  it("writes the question to its output and resolves with the typed answer", async () => {
    const t = terminal();
    const answer = terminalPrompt(t)("Type the last 4 characters: ");
    t.input.write("M4RX\r");
    await expect(answer).resolves.toBe("M4RX");
    expect(t.written.join("")).toContain("Type the last 4 characters: ");
  });

  it("resolves with null at the end of input, on Ctrl-D and on Ctrl-C", async () => {
    for (const send of [
      (i: PassThrough) => i.end(),
      (i: PassThrough) => i.write("\x04"),
      (i: PassThrough) => i.write("\x03"),
    ]) {
      const t = terminal();
      const answer = terminalPrompt(t)("? ");
      send(t.input);
      await expect(answer).resolves.toBeNull();
    }
  });

  it("does not ask at all when the input is not a terminal, and says so", async () => {
    const t = terminal(false);
    await expect(terminalPrompt(t)("? ")).resolves.toEqual({
      unasked: expect.stringMatching(/^standard input is not a terminal/) as unknown,
    });
    expect(t.written).toEqual([]);
  });

  it("does not ask when the output is redirected, so no answer lands in a log, and says so", async () => {
    // Review round 3, R3-31: the cause is standard error, not "the input is not interactive".
    const t = terminal(true, false);
    await expect(terminalPrompt(t)("? ")).resolves.toEqual({
      unasked: expect.stringMatching(/^standard error is not a terminal/) as unknown,
    });
    expect(t.written).toEqual([]);
  });
});

describe("terminalPrompt and where the facts to confirm went (review round 3, R3-28)", () => {
  it("does not ask when standard output carried the plan and it is not a terminal", async () => {
    const t = terminal();
    const prompt = terminalPrompt({ ...t, stdout: { isTTY: false } });
    await expect(prompt("? ", { facts: "stdout" })).resolves.toEqual({
      unasked: expect.stringMatching(/^standard output is not a terminal/) as unknown,
    });
    expect(t.written).toEqual([]);
  });

  it("asks when standard output carried the plan and it is a terminal", async () => {
    const t = terminal();
    const answer = terminalPrompt({ ...t, stdout: { isTTY: true } })("? ", { facts: "stdout" });
    t.input.write("M4RX\r");
    await expect(answer).resolves.toBe("M4RX");
  });

  it("asks with --json, where the plan went to standard error, whatever standard output is", async () => {
    const t = terminal();
    const answer = terminalPrompt({ ...t, stdout: { isTTY: false } })("? ", { facts: "stderr" });
    t.input.write("M4RX\r");
    await expect(answer).resolves.toBe("M4RX");
  });
});
