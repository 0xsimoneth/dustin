import { Command, Option } from "commander";
import { configFromEnv, resolveConfig } from "../config/network.js";
import { DustinError, notImplemented } from "../errors/dustin-error.js";
import { redact } from "../errors/redact.js";
import type { FetchLike } from "../reader/horizon-json.js";
import { fixtureCreate, fixtureVerify, type CommandContext } from "./commands/fixture.js";
import type { ExitCode } from "./exit-codes.js";

export interface CliIo {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
}

export interface CliDeps {
  env: Record<string, string | undefined>;
  fetch?: FetchLike;
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
): Command {
  const ctx: CommandContext = {
    io,
    config: () => resolveConfig(configFromEnv(deps.env)),
    ...(deps.fetch ? { fetch: deps.fetch } : {}),
  };
  const program = new Command("dustin")
    .description(
      "Plan and close messy Stellar testnet accounts with fee-bumped, sponsor-paid transactions.",
    )
    .version(version)
    .exitOverride()
    .configureOutput({
      // Commander echoes arguments in its errors; never let it print a secret.
      writeOut: (text) => io.stdout(redact(text)),
      writeErr: (text) => io.stderr(redact(text)),
    })
    .showHelpAfterError()
    .option("--network <name>", "network to use; only testnet is supported", "testnet");

  program.hook("preAction", (command) => {
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
    .option("--json", "print the plan as one JSON document")
    .action(() => {
      throw notImplemented("dustin plan", "plan");
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
    .option("--prefer-destination", "try the destination transfer before the return to issuer")
    .option("--memo <memo>", "memo for destinations that require one (SEP-29)")
    .option("--json", "print the report as one JSON document")
    .action(() => {
      throw notImplemented("dustin close", "plan");
    });

  const fixture = program
    .command("fixture")
    .description("Build and verify testnet fixture accounts (testnet only).");

  fixture
    .command("create")
    .description("Build a fresh fixture account on testnet from Friendbot funding.")
    .option("--profile <name>", "fixture profile", "messy")
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
