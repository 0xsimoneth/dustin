import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";
import type { Prompt, PromptContext } from "./commands/close.js";

export interface PromptStreams {
  /** Standard input; a prompt is asked only when it is a terminal. */
  input: Readable & { isTTY?: boolean };
  /** Where the question is written: standard error, so standard output stays clean for --json. */
  output: Writable & { isTTY?: boolean };
  /**
   * Standard output. Without --json the plan and the summary the question confirms are printed
   * there, so it must be a terminal too then (review round 3, R3-28).
   */
  stdout?: { isTTY?: boolean };
  /** Terminal mode (line editing, Ctrl-C as SIGINT); default: when the input is a terminal. */
  terminal?: boolean;
}

/**
 * Why the typed confirmation cannot be asked on these streams, or null when it can: every stream
 * it depends on must be a terminal, and the reason names the one that is not (review round 3,
 * R3-28, R3-31). Standard input carries the answer; standard error carries the question (with it
 * redirected, as in `2>log`, the question would be invisible and the typed answer would land in
 * the log); the facts being confirmed are on standard output without --json and on standard error
 * with it (with standard output redirected or piped, `> run.txt` or `| head`, they never reached
 * the screen: "what is executed is what is on screen", docs/ux-design.md section 2.2).
 */
function unaskable(streams: PromptStreams, facts: PromptContext["facts"]): string | null {
  if (streams.input.isTTY !== true) {
    return "standard input is not a terminal (it is redirected or piped), so no answer can be typed";
  }
  if (streams.output.isTTY !== true) {
    return "standard error is not a terminal (it is redirected), so the question would not be seen";
  }
  if (facts === "stdout" && streams.stdout?.isTTY !== true) {
    return "standard output is not a terminal (it is redirected or piped), so the plan and the summary to confirm were not on screen";
  }
  return null;
}

/**
 * The typed confirmation of `close --execute` on a terminal. Resolves with the answer; with null
 * at the end of input (Ctrl-D) or on Ctrl-C; or, without asking, with `{ unasked }` naming the
 * stream that is not a terminal. The close command treats anything but the right answer as "not
 * confirmed" (exit 3). Readline emits "close" at the end of input and "SIGINT" on Ctrl-C; without
 * a SIGINT listener it would only pause the input
 * (https://nodejs.org/api/readline.html#event-close, https://nodejs.org/api/readline.html#event-sigint).
 */
export function terminalPrompt(streams: PromptStreams): Prompt {
  return (question, context) => {
    // Without a context the facts count as shown with the question, on standard error.
    const why = unaskable(streams, context?.facts ?? "stderr");
    if (why !== null) return Promise.resolve({ unasked: why });
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
