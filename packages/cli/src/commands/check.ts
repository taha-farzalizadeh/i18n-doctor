/**
 * `check` command handler.
 */

import type { Command } from "commander";
import type { CheckCliOptions } from "../api/types.js";
import { handleCliError } from "../internal/errors.js";
import { runCheck, writeCheckReport } from "../internal/run-check.js";

export function registerCheckCommand(program: Command): void {
  program
    .command("check", { isDefault: true })
    .description("Analyze a project for unused, missing, and duplicate keys")
    .argument("[path]", "Project or subdirectory path (default: current directory)")
    .option("-c, --config <path>", "Path to i18n-doctor config file")
    .option("--json", "Emit JSON report")
    .option("--sarif", "Emit SARIF 2.1.0 report")
    .option("--markdown", "Emit Markdown report")
    .option("--html", "Emit HTML report")
    .option("--fix", "Auto-fix issues (reserved)")
    .option("--silent", "No report output (exit code only)")
    .option("--verbose", "Verbose output including CLI timings")
    .option("--cwd <path>", "Working directory for path resolution")
    .option(
      "--dir <path>",
      "Analyze only files under this directory (relative to project root)",
    )
    .option("--no-color", "Disable ANSI colors and hyperlinks")
    .option("--framework <id>", "Framework / library hint override")
    .option("--locale <locale>", "Restrict analysis to a locale")
    .option("--namespace <ns>", "Restrict analysis to a namespace")
    .option(
      "--ignore-duplicates",
      "Ignore duplicate translation keys (turns off duplicate-key)",
    )
    .option(
      "--base-locale <locale>",
      "Base locale for cross-locale coverage (keys missing in other langs)",
    )
    .option("--no-coverage", "Skip locale consistency / coverage analysis")
    .action(async (pathArg: string | undefined, opts) => {
      if (opts.fix) {
        process.stdout.write("Not implemented yet\n");
        process.exitCode = 0;
        return;
      }
      const options = toCheckOptions(pathArg, opts);
      try {
        const result = await runCheck(options);
        writeCheckReport(result);
        process.exitCode = result.exitCode;
      } catch (error) {
        process.exitCode = handleCliError(error, {
          verbose: Boolean(opts.verbose),
        });
      }
    });
}

export function toCheckOptions(
  pathArg: string | undefined,
  opts: Record<string, unknown>,
): CheckCliOptions {
  const out: CheckCliOptions = {};
  if (pathArg !== undefined) (out as { path?: string }).path = pathArg;
  if (typeof opts["config"] === "string")
    (out as { config?: string }).config = opts["config"];
  if (opts["json"]) (out as { json?: boolean }).json = true;
  if (opts["sarif"]) (out as { sarif?: boolean }).sarif = true;
  if (opts["markdown"]) (out as { markdown?: boolean }).markdown = true;
  if (opts["html"]) (out as { html?: boolean }).html = true;
  if (opts["fix"]) (out as { fix?: boolean }).fix = true;
  if (opts["silent"]) (out as { silent?: boolean }).silent = true;
  if (opts["verbose"]) (out as { verbose?: boolean }).verbose = true;
  if (typeof opts["cwd"] === "string")
    (out as { cwd?: string }).cwd = opts["cwd"];
  if (opts["color"] === false) (out as { noColor?: boolean }).noColor = true;
  if (typeof opts["framework"] === "string")
    (out as { framework?: string }).framework = opts["framework"];
  if (typeof opts["locale"] === "string")
    (out as { locale?: string }).locale = opts["locale"];
  if (typeof opts["namespace"] === "string")
    (out as { namespace?: string }).namespace = opts["namespace"];
  if (typeof opts["dir"] === "string")
    (out as { dir?: string }).dir = opts["dir"];
  if (opts["ignoreDuplicates"])
    (out as { ignoreDuplicates?: boolean }).ignoreDuplicates = true;
  if (typeof opts["baseLocale"] === "string")
    (out as { baseLocale?: string }).baseLocale = opts["baseLocale"];
  // commander --no-coverage sets coverage: false
  if (opts["coverage"] === false)
    (out as { noCoverage?: boolean }).noCoverage = true;
  return out;
}
