import { CommanderError } from "commander";
import { DustinError } from "../errors/dustin-error.js";
import { containsSecretSeed, redact } from "../errors/redact.js";
import {
  UNEXPECTED_ERROR,
  USAGE_ERROR,
  channel,
  failureOf,
  type Channel,
  type Failure,
  type OutputMode,
} from "./channel.js";
import { ExitCode, exitCodeFor } from "./exit-codes.js";
import { buildProgram, type CliDeps, type CliIo, type CliState } from "./program.js";

export type { CliIo } from "./program.js";

/**
 * Runs the CLI and returns the exit code. It never rejects and never lets a rejection escape
 * (AC-E4-S2-3): whatever is thrown, even a value whose conversion to text throws, ends as an exit
 * code and one error message. Secrets are refused on argv before anything is parsed (docs/README.md
 * canonical decision 4): argv is visible in process listings and shell history. When the standard
 * error writer itself throws, the message is written once more through the last-resort writer
 * (`CliDeps.lastResort`, the process's standard error by default), and the exit code of the error
 * is still returned (Epic 4 review BH-19).
 */
export async function run(
  argv: string[],
  io: CliIo,
  version: string,
  deps: CliDeps = { env: {} },
): Promise<number> {
  let mode: OutputMode = { json: false, verbose: false };
  let out: Channel | null = null;
  // Reports the failure the command ends with; returns its exit code whatever the writers do.
  const report: Reporter = (write, failure) => {
    try {
      write();
    } catch {
      lastResort(deps, mode, failure);
    }
    return failure.exitCode;
  };
  try {
    mode = scanMode(argv);
    out = channel(io, mode);
    return await runCommand(argv, io, version, deps, mode, out, report);
  } catch (error) {
    // Only a failure outside the command's own reporting lands here.
    const channelled = out ?? channel(io, mode);
    return report(
      () => channelled.error(error, ExitCode.UNEXPECTED),
      failureOf(error, ExitCode.UNEXPECTED),
    );
  }
}

/** Writes a failure with `write`; should that throw, once through the last-resort writer. */
type Reporter = (write: () => void, failure: Failure) => number;

/**
 * The last-resort write of a failure (Epic 4 review BH-19): one line, NDJSON in machine mode, to
 * `deps.lastResort` or else the process's standard error, and nothing more if that throws too.
 */
function lastResort(deps: CliDeps, mode: OutputMode, failure: Failure): void {
  try {
    const text = mode.json
      ? `${JSON.stringify({ type: "error", ...failure })}\n`
      : `dustin: ${failure.code === UNEXPECTED_ERROR ? "" : `${failure.code}: `}${failure.message}\n`;
    const write = deps.lastResort ?? ((t: string) => void process.stderr.write(t));
    write(redact(text));
  } catch {
    // Nothing is left to report with; the exit code still says what happened.
  }
}

async function runCommand(
  argv: string[],
  io: CliIo,
  version: string,
  deps: CliDeps,
  mode: OutputMode,
  out: Channel,
  report: Reporter,
): Promise<number> {
  const position = argv.slice(2).findIndex((arg) => containsSecretSeed(arg));
  if (position >= 0) {
    const failure: Failure = {
      code: "SECRET_IN_ARGV",
      message: `argument ${position + 1} looks like a secret key; it was not used and is not shown.`,
      remedy:
        "Put secrets in DUSTIN_ACCOUNT_SECRET and DUSTIN_SPONSOR_SECRET instead, never on the command line.",
      exitCode: ExitCode.USAGE,
    };
    return report(() => out.fail(failure), failure);
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
      const failure: Failure = {
        code: USAGE_ERROR,
        message: error.message,
        remedy: "Run dustin --help, or dustin <command> --help, for the usage.",
        exitCode: ExitCode.USAGE,
      };
      if (mode.json) return report(() => out.fail(failure), failure);
      return ExitCode.USAGE;
    }
    const code = error instanceof DustinError ? exitCodeFor(error) : ExitCode.UNEXPECTED;
    return report(() => out.error(error, code), failureOf(error, code));
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
