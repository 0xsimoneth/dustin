import { Command, Option } from "commander";
import { configFromEnv, resolveConfig } from "../config/network.js";
import type { Sleep } from "../config/pauses.js";
import { DustinError } from "../errors/dustin-error.js";
import { redact } from "../errors/redact.js";
import type { executeClose } from "../execute/executor.js";
import type { FetchLike } from "../reader/horizon-json.js";
import { channel, type Channel, type OutputMode } from "./channel.js";
import {
  closeExecute,
  ignoredFlagsNote,
  type CloseCommandOptions,
  type Prompt,
  type SignalSource,
} from "./commands/close.js";
import { fixtureCreate, fixtureVerify, type CommandContext } from "./commands/fixture.js";
import type { SecretPrompt } from "./secrets.js";
import { buildPlan, planCommand, printPlan, type PlanCommandOptions } from "./commands/plan.js";
import type { ExitCode } from "./exit-codes.js";

export interface CliIo {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
}

export interface CliDeps {
  /** The process environment: the network settings, and the secrets for `close --execute`. */
  env: Record<string, string | undefined>;
  /**
   * The working directory whose `.env` supplies the two secrets to `close --execute`, and only to
   * it (review R7). Without it no `.env` is read.
   */
  cwd?: string;
  fetch?: FetchLike;
  horizon?: { retries?: number; backoffMs?: number; sleep?: Sleep };
  /**
   * Asks the typed confirmation of `close --execute` and resolves with the answer, with null on
   * EOF or Ctrl-C, or with `{ unasked }` when it could not be asked (a stream that is not a
   * terminal). Without it the input counts as non-interactive.
   */
  prompt?: Prompt;
  /**
   * The hidden prompt of `close --execute` for a secret that neither the environment nor `.env`
   * holds (review finding CA-18, PRD decision D-11). It asks only when standard input and standard
   * error are terminals, never with --json; without it a missing secret is refused (exit 2).
   */
  secretPrompt?: SecretPrompt;
  /**
   * Executor overrides for tests: the pause function (pauses are at least 200 ms, so a test that
   * must not wait injects one that returns at once), or the executor itself.
   */
  execute?: { sleep?: Sleep; executeClose?: typeof executeClose };
  /**
   * SIGINT and SIGTERM while `close --execute` runs, from its start (review finding CL-1; Epic 4
   * review EX-9): `process` in the binary, a fake in tests. Without it no handler is added.
   */
  signals?: SignalSource;
  /**
   * Ends the process with this code after a second signal: in the binary `process.exit` once both
   * streams have flushed (src/cli/output.ts, `exitAfterFlush`).
   */
  exit?: (code: number) => void;
}

/** Commands report their exit code here; `run()` returns it. */
export interface CliState {
  exitCode: ExitCode;
}

/**
 * Builds the `dustin` command tree. Flags follow docs/README.md canonical decision 4:
 * `--to` is canonical and `--destination` is an alias; `close` without `--execute` is a dry run.
 * Settings are applied before the subcommands are added so that they inherit them.
 */
export function buildProgram(
  version: string,
  io: CliIo,
  deps: CliDeps = { env: {} },
  state: CliState = { exitCode: 0 },
  mode: OutputMode = { json: false, verbose: false },
  out: Channel = channel(io, mode),
): Command {
  const ctx: CommandContext & { out: Channel } = {
    io,
    out,
    config: () => resolveConfig(configFromEnv(deps.env)),
    ...(deps.fetch ? { fetch: deps.fetch } : {}),
    ...(deps.horizon ? { horizon: deps.horizon } : {}),
  };
  const program = new Command("dustin")
    .description(
      "Plan and close messy Stellar testnet accounts with fee-bumped, sponsor-paid transactions.",
    )
    .version(version)
    .exitOverride()
    .configureOutput({
      // Commander echoes arguments in its errors; never let it print a secret. In machine mode
      // its human text is held back: run() reports a usage error as one `error` line (AA-10).
      writeOut: (text) => io.stdout(redact(text)),
      writeErr: (text) => {
        if (!mode.json) io.stderr(redact(text));
      },
    })
    .showHelpAfterError()
    .option("--network <name>", "network to use; only testnet is supported", "testnet")
    .option(
      "--verbose",
      "on an error, print its full detail: cause chain, Horizon result codes, details (secrets redacted)",
    );

  program.hook("preAction", (command, action) => {
    // The parsed options decide the output mode from here on (review finding AA-10).
    const name = action.name();
    mode.json =
      (name === "plan" || name === "close") && action.opts<{ json?: boolean }>().json === true;
    mode.verbose = action.optsWithGlobals<{ verbose?: boolean }>().verbose === true;
    const { network } = command.opts<{ network: string }>();
    if (network !== "testnet") {
      throw new DustinError(
        "MAINNET_REFUSED",
        `Dustin is testnet-only in this release; network "${network}" is refused.`,
        { stage: "config", remedy: "Use --network testnet or leave the option out." },
      );
    }
  });

  program
    .command("plan")
    .description(
      "Print the ordered close plan for an account. Dry run: nothing is signed or submitted.",
    )
    .argument("<account>", "G... address of the account to close")
    .option("--to <destination>", "G... address that receives the XLM through the merge")
    .addOption(
      new Option("--destination <destination>", "alias of --to").hideHelp().conflicts("to"),
    )
    .option("--sponsor <sponsor>", "G... address of the fee sponsor, used for the fee attribution")
    .option("--prefer-destination", "try the destination transfer before the return to issuer")
    .option("--memo <memo>", "memo for destinations that require one (SEP-29)")
    .option("--base-fee <stroops>", "fee bid per operation instead of the fee_stats estimate")
    .option(
      "--json",
      "machine mode: print the plan as one JSON document; errors go to standard error as NDJSON",
    )
    .action(async (account: string, options: PlanCommandOptions) => {
      state.exitCode = await planCommand(account, options, ctx);
    });

  program
    .command("close")
    .description(
      "Close an account with fee-bumped transactions. Without --execute this only prints the plan.",
    )
    .argument("<account>", "G... address of the account to close")
    .option("--to <destination>", "G... address that receives the XLM through the merge")
    .addOption(
      new Option("--destination <destination>", "alias of --to").hideHelp().conflicts("to"),
    )
    .option("--execute", "sign and submit the plan after confirmation")
    .option("--yes", "skip the typed confirmation (only honoured with --execute)")
    .option("--partial", "proceed even if some items are unclosable; the account is not merged")
    .option(
      "--sponsor <sponsor>",
      "G... address of the fee sponsor for the fee attribution; with --execute, it must own DUSTIN_SPONSOR_SECRET",
    )
    .option("--prefer-destination", "try the destination transfer before the return to issuer")
    .option("--memo <memo>", "memo for destinations that require one (SEP-29)")
    .option(
      "--base-fee <stroops>",
      "fee bid per operation instead of the fee_stats estimate; with --execute, the highest bid",
    )
    .option(
      "--json",
      "machine mode: one JSON document on standard output (the plan, or with --execute the final close report), NDJSON progress on standard error, never a question (with --execute it needs --yes)",
    )
    .option(
      "--report <file>",
      "with --execute, keep the close report (JSON) in this file, updated as the run goes",
    )
    .addHelpText(
      "after",
      "\nWith --execute, the secrets DUSTIN_ACCOUNT_SECRET and DUSTIN_SPONSOR_SECRET come from the\n" +
        "environment, else from .env in the working directory, else from a hidden prompt when standard\n" +
        "input and standard error are terminals and --json is not given; never from the command line.\n",
    )
    .action(async (account: string, options: CloseCommandOptions) => {
      if (options.execute) {
        state.exitCode = await closeExecute(account, options, {
          ...ctx,
          // Secrets and `.env` are reachable only from here (review R7).
          secrets: { env: deps.env, ...(deps.cwd !== undefined ? { cwd: deps.cwd } : {}) },
          ...(deps.prompt ? { prompt: deps.prompt } : {}),
          ...(deps.secretPrompt ? { secretPrompt: deps.secretPrompt } : {}),
          ...(deps.execute ? { execute: deps.execute } : {}),
          ...(deps.signals ? { signals: deps.signals } : {}),
          ...(deps.exit ? { exit: deps.exit } : {}),
        });
        return;
      }
      // Canonical decision 4: without --execute, close behaves exactly like plan.
      const note = ignoredFlagsNote(options);
      if (note) out.notice(note);
      const plan = await buildPlan(account, options, ctx);
      printPlan(plan, options, ctx, "add --execute to run this plan");
      state.exitCode = 0;
    });

  const fixture = program
    .command("fixture")
    .description("Build and verify testnet fixture accounts (testnet only).");

  fixture
    .command("create")
    .description("Build a fresh fixture account on testnet from Friendbot funding.")
    .option("--profile <name>", "fixture profile: messy (the metric account) or edge", "messy")
    .option(
      "--dir <path>",
      "directory for the manifest, keys and recorded Horizon JSON",
      ".fixture",
    )
    .option("--out <file>", "also write the public manifest to this file")
    .option("--json", "print the manifest as JSON")
    .action(async (options: { profile: string; dir: string; out?: string; json?: boolean }) => {
      state.exitCode = await fixtureCreate(options, ctx);
    });

  fixture
    .command("verify")
    .description("Check a fixture against SOW Appendix B. Read-only.")
    .argument("<manifest>", "manifest.json written by `dustin fixture create`")
    .option("--snapshot <file>", "write the Horizon evidence as JSON")
    .option("--json", "print the result as JSON")
    .action(async (manifest: string, options: { snapshot?: string; json?: boolean }) => {
      state.exitCode = await fixtureVerify(manifest, options, ctx);
    });

  return program;
}
