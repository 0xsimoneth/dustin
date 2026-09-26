import { CommanderError } from "commander";
import { DustinError } from "../errors/dustin-error.js";
import { containsSecretSeed, redact } from "../errors/redact.js";
import { ExitCode, exitCodeFor } from "./exit-codes.js";
import { buildProgram, type CliIo } from "./program.js";

export type { CliIo } from "./program.js";

/**
 * Runs the CLI and returns the exit code. Secrets are refused on argv before anything is parsed
 * (docs/README.md canonical decision 4): argv is visible in process listings and shell history.
 */
export async function run(argv: string[], io: CliIo, version: string): Promise<number> {
  const position = argv.slice(2).findIndex((arg) => containsSecretSeed(arg));
  if (position >= 0) {
    io.stderr(
      `dustin: SECRET_IN_ARGV: argument ${position + 1} looks like a secret key; it was not used and is not shown.\n` +
        "  Put secrets in DUSTIN_ACCOUNT_SECRET and DUSTIN_SPONSOR_SECRET instead, never on the command line.\n",
    );
    return ExitCode.USAGE;
  }

  try {
    await buildProgram(version, io).parseAsync(argv);
    return ExitCode.OK;
  } catch (error) {
    if (error instanceof CommanderError) {
      // Commander has already printed help, the version or the usage error.
      return error.exitCode === 0 ? ExitCode.OK : ExitCode.USAGE;
    }
    if (error instanceof DustinError) {
      io.stderr(`dustin: ${error.code}: ${error.message}\n`);
      if (error.remedy) io.stderr(`  ${error.remedy}\n`);
      return exitCodeFor(error);
    }
    io.stderr(`dustin: unexpected error: ${redact(String(error))}\n`);
    return ExitCode.UNEXPECTED;
  }
}
