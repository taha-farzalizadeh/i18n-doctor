/**
 * Commander program factory for i18n-unused.
 */

import { Command, CommanderError } from "commander";
import { registerCheckCommand } from "./commands/check.js";
import { handleCliError } from "./internal/errors.js";
import { getPackageVersion } from "./internal/version.js";

export function createProgram(): Command {
  const program = new Command();

  program
    .name("i18n-unused")
    .description(
      "Static localization analysis — unused, missing, and duplicate translation keys",
    )
    .version(getPackageVersion(), "-V, --version", "Print CLI version")
    .helpOption("-h, --help", "Display help")
    .addHelpText(
      "after",
      `
Exit codes:
  0  Success (no failing issues per exit policy)
  1  Analysis reported errors/warnings that fail the exit policy
  2  Usage, configuration, or I/O error

Examples:
  $ i18n-unused check
  $ i18n-unused check ./apps/web --json
  $ i18n-unused check --config ./i18n-unused.config.json --verbose
`,
    )
    .showHelpAfterError()
    .showSuggestionAfterError()
    .exitOverride();

  registerCheckCommand(program);

  return program;
}

/**
 * Parse argv and run. Returns the process exit code.
 */
export async function runCli(
  argv: readonly string[] = process.argv,
): Promise<number> {
  // Isolate exitCode mutations from prior calls (important for tests).
  const previousExit = process.exitCode;
  process.exitCode = undefined;

  const program = createProgram();
  try {
    await program.parseAsync([...argv]);
  } catch (error) {
    if (error instanceof CommanderError) {
      if (
        error.code === "commander.helpDisplayed" ||
        error.code === "commander.version" ||
        error.code === "commander.help"
      ) {
        process.exitCode = previousExit;
        return 0;
      }
      // Unknown option / missing argument → usage failure
      process.exitCode = previousExit;
      return typeof error.exitCode === "number" ? error.exitCode : 2;
    }
    const code = handleCliError(error);
    process.exitCode = previousExit;
    return code;
  }

  const code = typeof process.exitCode === "number" ? process.exitCode : 0;
  process.exitCode = previousExit;
  return code;
}
