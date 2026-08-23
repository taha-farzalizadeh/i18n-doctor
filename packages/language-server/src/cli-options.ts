/**
 * Argument parsing for the `i18n-doctor-language-server` binary.
 *
 * Kept separate from `bin.ts` so it can be tested without starting a server on
 * the current process's stdio.
 */

import { LANGUAGE_SERVER_LOG_LEVELS } from "@i18n-doctor/config";
import type { LogLevel } from "./logger.js";

export type CliAction = "help" | "version" | "serve";

export interface CliOptions {
  readonly action: CliAction;
  readonly logLevel?: LogLevel;
  readonly debounce?: number;
  /** Unrecognized arguments, reported to stderr but never fatal. */
  readonly unknown: readonly string[];
}

const FLAGS = new Set(["--stdio", "--help", "-h", "--version", "-v"]);
const VALUE_OPTIONS = new Set(["--log-level", "--debounce"]);

export function parseCliOptions(argv: readonly string[]): CliOptions {
  if (argv.includes("--help") || argv.includes("-h")) {
    return { action: "help", unknown: [] };
  }
  if (argv.includes("--version") || argv.includes("-v")) {
    return { action: "version", unknown: [] };
  }

  const logLevel = readOption(argv, "--log-level");
  const debounce = readOption(argv, "--debounce");
  const parsedDebounce = debounce === undefined ? NaN : Number(debounce);

  return {
    action: "serve",
    ...(isLogLevel(logLevel) ? { logLevel } : {}),
    ...(Number.isFinite(parsedDebounce) && parsedDebounce >= 0
      ? { debounce: Math.round(parsedDebounce) }
      : {}),
    unknown: collectUnknown(argv),
  };
}

export const HELP_TEXT = [
  "i18n-doctor-language-server — live i18n diagnostics over LSP",
  "",
  "Usage:",
  "  i18n-doctor-language-server [--stdio] [--log-level <level>] [--debounce <ms>]",
  "",
  "Options:",
  "  --stdio               Use stdio transport (default).",
  `  --log-level <level>   ${LANGUAGE_SERVER_LOG_LEVELS.join(" | ")}`,
  "  --debounce <ms>       Analysis debounce window.",
  "  --version             Print the server version.",
  "  -h, --help            Print this help.",
  "",
  "Configuration is read from the project's i18n-doctor config:",
  '  { "languageServer": { "debounce": 250, "logLevel": "error" } }',
  "",
].join("\n");

function readOption(
  args: readonly string[],
  name: string,
): string | undefined {
  const inline = args.find((arg) => arg.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  return args[index + 1];
}

function collectUnknown(argv: readonly string[]): string[] {
  const unknown: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (FLAGS.has(arg)) continue;
    if (VALUE_OPTIONS.has(arg)) {
      i += 1;
      continue;
    }
    if ([...VALUE_OPTIONS].some((name) => arg.startsWith(`${name}=`))) continue;
    unknown.push(arg);
  }
  return unknown;
}

function isLogLevel(value: string | undefined): value is LogLevel {
  return (
    value !== undefined &&
    (LANGUAGE_SERVER_LOG_LEVELS as readonly string[]).includes(value)
  );
}
