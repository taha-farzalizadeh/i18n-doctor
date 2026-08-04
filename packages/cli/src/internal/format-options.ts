/**
 * Map CLI flags → output format and config CLI overrides.
 */

import type { OutputFormat, UserConfig } from "@i18n-unused/config";
import type { CheckCliOptions, CliOutputFormat } from "../api/types.js";
import { CliError } from "./errors.js";

export function resolveOutputFormat(
  options: CheckCliOptions,
  configFormat: OutputFormat | CliOutputFormat,
): CliOutputFormat {
  const selected: CliOutputFormat[] = [];
  if (options.silent) selected.push("silent");
  if (options.json) selected.push("json");
  if (options.sarif) selected.push("sarif");
  if (options.markdown) selected.push("markdown");
  if (options.html) selected.push("html");

  if (selected.length > 1) {
    throw new CliError(
      "USAGE",
      `Conflicting output flags: ${selected.map((f) => `--${f}`).join(", ")}`,
      { hint: "Choose a single output format." },
    );
  }
  if (selected.length === 1) return selected[0]!;

  return normalizeConfigFormat(configFormat);
}

function normalizeConfigFormat(
  format: OutputFormat | CliOutputFormat,
): CliOutputFormat {
  if (format === "github") return "terminal";
  return format;
}

export function buildCliUserConfig(options: CheckCliOptions): UserConfig {
  const output: {
    format?: OutputFormat;
    color?: boolean;
    verbose?: boolean;
  } = {};

  const format = pickExplicitFormat(options);
  if (format === "silent") {
    output.format = "silent";
  } else if (format === "json" || format === "sarif") {
    output.format = format;
  }

  if (options.noColor) output.color = false;
  if (options.verbose) output.verbose = true;

  if (Object.keys(output).length === 0) return {};
  return { output };
}

function pickExplicitFormat(
  options: CheckCliOptions,
): CliOutputFormat | undefined {
  if (options.silent) return "silent";
  if (options.json) return "json";
  if (options.sarif) return "sarif";
  if (options.markdown) return "markdown";
  if (options.html) return "html";
  return undefined;
}

export function earlyFormatGuess(options: CheckCliOptions): string {
  if (options.silent) return "silent";
  if (options.json) return "json";
  if (options.sarif) return "sarif";
  if (options.markdown) return "markdown";
  if (options.html) return "html";
  return "terminal";
}
