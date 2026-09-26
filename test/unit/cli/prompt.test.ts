import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { terminalPrompt } from "../../../src/cli/prompt.js";

function terminal(isTTY = true) {
  const input = Object.assign(new PassThrough(), { isTTY });
  const output = new PassThrough();
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

  it("does not ask at all when the input is not a terminal", async () => {
    const t = terminal(false);
    await expect(terminalPrompt(t)("? ")).resolves.toBeNull();
    expect(t.written).toEqual([]);
  });
});
