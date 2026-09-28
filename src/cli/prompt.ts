import { createInterface } from "node:readline";
import { Writable, type Readable } from "node:stream";
import type { Prompt, PromptContext } from "./commands/close.js";
import type { SecretPrompt } from "./secrets.js";

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

/**
 * The hidden prompt for a secret that is in neither the environment nor `.env` (review finding
 * CA-18, PRD decision D-11). It is asked only when standard input and standard error are both
 * terminals, and names the one that is not otherwise. The question goes to standard error; the
 * readline interface writes to a stream that drops everything, so nothing typed is ever echoed
 * (readline in terminal mode writes the line as it is edited to its `output`,
 * https://nodejs.org/api/readline.html#readlinecreateinterfaceoptions), and `historySize: 0` keeps
 * no history of it (same page: "To disable the history set this value to 0"). Resolves with the
 * line on Enter (https://nodejs.org/api/readline.html#event-line); with null at the end of input
 * (Ctrl-D) or on Ctrl-C, which readline reports as "close" and "SIGINT"
 * (https://nodejs.org/api/readline.html#event-close, https://nodejs.org/api/readline.html#event-sigint).
 * The value is handed to the caller only; it is never written anywhere.
 */
export function hiddenPrompt(streams: {
  input: Readable & { isTTY?: boolean };
  output: Writable & { isTTY?: boolean };
}): SecretPrompt {
  return (question) => {
    if (streams.input.isTTY !== true) {
      return Promise.resolve({
        unasked:
          "standard input is not a terminal (it is redirected or piped), so nothing can be typed",
      });
    }
    if (streams.output.isTTY !== true) {
      return Promise.resolve({
        unasked:
          "standard error is not a terminal (it is redirected), so the question would not be seen",
      });
    }
    return new Promise((resolve) => {
      streams.output.write(question);
      const muted = new Writable({
        write(_chunk, _encoding, callback) {
          callback();
        },
      });
      const rl = createInterface({
        input: streams.input,
        output: muted,
        terminal: true,
        historySize: 0,
      });
      let settled = false;
      const settle = (answer: string | null) => {
        if (settled) return;
        settled = true;
        rl.close();
        // The Enter was not echoed either: end the question's line.
        streams.output.write("\n");
        resolve(answer);
      };
      rl.once("close", () => settle(null));
      rl.once("SIGINT", () => settle(null));
      rl.once("line", (line) => settle(line));
    });
  };
}
