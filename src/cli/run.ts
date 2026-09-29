import { CommanderError } from "commander";
import { DustinError } from "../errors/dustin-error.js";
import { containsSecretSeed } from "../errors/redact.js";
import { USAGE_ERROR, channel, type Channel, type OutputMode } from "./channel.js";
import { ExitCode, exitCodeFor } from "./exit-codes.js";
import { buildProgram, type CliDeps, type CliIo, type CliState } from "./program.js";

export type { CliIo } from "./program.js";

/**
 * Runs the CLI and returns the exit code. It never rejects and never lets a rejection escape
 * (AC-E4-S2-3): whatever is thrown, even a value whose conversion to text throws, ends as an exit
 * code and one error message. Secrets are refused on argv before anything is parsed (docs/README.md
 * canonical decision 4): argv is visible in process listings and shell history.
 */
export async function run(
  argv: string[],
  io: CliIo,
  version: string,
  deps: CliDeps = { env: {} },
): Promise<number> {
  const mode = scanMode(argv);
  const out = channel(io, mode);
  try {
    return await runCommand(argv, io, version, deps, mode, out);
  } catch (error) {
    // Only a failure of the error reporting itself lands here.
    try {
      out.error(error, ExitCode.UNEXPECTED);
    } catch {
      // Nothing is left to report with.
    }
    return ExitCode.UNEXPECTED;
  }
}

async function runCommand(
  argv: string[],
  io: CliIo,
  version: string,
  deps: CliDeps,
  mode: OutputMode,
  out: Channel,
): Promise<number> {
  const position = argv.slice(2).findIndex((arg) => containsSecretSeed(arg));
  if (position >= 0) {
    out.fail({
      code: "SECRET_IN_ARGV",
      message: `argument ${position + 1} looks like a secret key; it was not used and is not shown.`,
      remedy:
        "Put secrets in DUSTIN_ACCOUNT_SECRET and DUSTIN_SPONSOR_SECRET instead, never on the command line.",
      exitCode: ExitCode.USAGE,
    });
    return ExitCode.USAGE;
  }

  const state: CliState = { exitCode: ExitCode.OK };
  try {
    await buildProgram(version, io, deps, state, mode, out).parseAsync(argv);
    return state.exitCode;
  } catch (error) {
    if (error instanceof CommanderError) {
      // Commander has already printed help, the version or the usage error for people; in machine
      // mode its text was held back and the error is one `error` line (review finding AA-10).
      if (error.exitCode === 0) return ExitCode.OK;
      if (mode.json) {
        out.fail({
          code: USAGE_ERROR,
          message: error.message,
          remedy: "Run dustin --help, or dustin <command> --help, for the usage.",
          exitCode: ExitCode.USAGE,
        });
      }
      return ExitCode.USAGE;
    }
    const code = error instanceof DustinError ? exitCodeFor(error) : ExitCode.UNEXPECTED;
    out.error(error, code);
    return code;
  }
}

/**
 * The options of `dustin` that take a value (program.ts): the word after one is its value, even
 * when it starts with a dash, as Commander reads it (`--memo --json` is a memo of "--json").
 * test/unit/cli/epic4-review-cli.test.ts checks this list against the program's options.
 */
export const VALUE_OPTIONS: ReadonlySet<string> = new Set([
  "--network",
  "--to",
  "--destination",
  "--sponsor",
  "--memo",
  "--base-fee",
  "--report",
  "--profile",
  "--dir",
  "--out",
  "--snapshot",
]);

/**
 * The output mode from argv, before it is parsed, for what is printed before a command runs: a
 * secret on argv, a usage error, a refused network. `--json` counts for `plan` and `close` only
 * (the fixture commands keep their own output); the parsed options confirm both flags once the
 * command runs (program.ts, the preAction hook). Only a real flag counts (Epic 4 review BH-20): a
 * `--json` or `--verbose` that is the value of another option, or comes after `--`, is an
 * argument, as Commander reads it.
 */
export function scanMode(argv: readonly string[]): OutputMode {
  const words = argv.slice(2);
  let command: string | undefined;
  let json = false;
  let verbose = false;
  for (let i = 0; i < words.length; i++) {
    const word = words[i]!;
    if (word === "--") break;
    if (VALUE_OPTIONS.has(word)) {
      i += 1;
      continue;
    }
    if (word === "--json") json = true;
    else if (word === "--verbose") verbose = true;
    else if (!word.startsWith("-")) command ??= word;
  }
  return { json: (command === "plan" || command === "close") && json, verbose };
}
