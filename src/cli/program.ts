import { Command, Option } from "commander";
import { DustinError, notImplemented } from "../errors/dustin-error.js";

export interface CliIo {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
}

/**
 * Builds the `dustin` command tree. Flags follow docs/README.md canonical decision 4:
 * `--to` is canonical and `--destination` is an alias; `close` without `--execute` is a dry run.
 * Settings are applied before the subcommands are added so that they inherit them.
 */
export function buildProgram(version: string, io: CliIo): Command {
  const program = new Command("dustin")
    .description(
      "Plan and close messy Stellar testnet accounts with fee-bumped, sponsor-paid transactions.",
    )
    .version(version)
    .exitOverride()
    .configureOutput({ writeOut: io.stdout, writeErr: io.stderr })
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
    .addOption(new Option("--destination <destination>", "alias of --to").hideHelp())
    .option("--sponsor <sponsor>", "G... address of the fee sponsor, used for the fee attribution")
    .option("--prefer-destination", "try the destination transfer before the return to issuer")
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
    .addOption(new Option("--destination <destination>", "alias of --to").hideHelp())
    .option("--execute", "sign and submit the plan after confirmation")
    .option("--yes", "skip the typed confirmation (only honoured with --execute)")
    .option("--partial", "proceed even if some items are unclosable; the account is not merged")
    .option("--prefer-destination", "try the destination transfer before the return to issuer")
    .option("--memo <memo>", "memo for destinations that require one (SEP-29)")
    .option("--json", "print the report as one JSON document")
    .action(() => {
      throw notImplemented("dustin close", "plan");
    });

  return program;
}
