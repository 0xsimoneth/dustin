import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";
import type { Prompt } from "./commands/close.js";

export interface PromptStreams {
  /** Standard input; a prompt is asked only when it is a terminal. */
  input: Readable & { isTTY?: boolean };
  /** Where the question is written: standard error, so standard output stays clean for --json. */
  output: Writable;
  /** Terminal mode (line editing, Ctrl-C as SIGINT); default: when the input is a terminal. */
  terminal?: boolean;
}

/**
 * The typed confirmation of `close --execute` on a terminal. Resolves with the answer, or with
 * null when the input is not a terminal, at the end of input (Ctrl-D) or on Ctrl-C; the close
 * command treats null as "not confirmed" (exit 3). Readline emits "close" at the end of input and
 * "SIGINT" on Ctrl-C; without a SIGINT listener it would only pause the input
 * (https://nodejs.org/api/readline.html#event-close, https://nodejs.org/api/readline.html#event-sigint).
 */
export function terminalPrompt(streams: PromptStreams): Prompt {
  return (question) => {
    if (streams.input.isTTY !== true) return Promise.resolve(null);
    return new Promise((resolve) => {
      const rl = createInterface({
        input: streams.input,
        output: streams.output,
        terminal: streams.terminal ?? true,
      });
      let settled = false;
      const settle = (answer: string | null) => {
        if (settled) return;
        settled = true;
        rl.close();
        resolve(answer);
      };
      rl.once("close", () => settle(null));
      rl.once("SIGINT", () => settle(null));
      rl.question(question, (answer) => settle(answer));
    });
  };
}
