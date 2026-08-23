#!/usr/bin/env node
/**
 * `i18n-doctor-language-server` — stdio LSP entry point.
 *
 * stdout carries the JSON-RPC stream, so all diagnostics about the server
 * itself go to the LSP log channel or stderr.
 */

import { HELP_TEXT, parseCliOptions } from "./cli-options.js";
import { SERVER_VERSION, startLanguageServer } from "./index.js";

const options = parseCliOptions(process.argv.slice(2));

if (options.action === "help") {
  process.stderr.write(HELP_TEXT);
  process.exitCode = 0;
} else if (options.action === "version") {
  process.stderr.write(`${SERVER_VERSION}\n`);
  process.exitCode = 0;
} else {
  for (const arg of options.unknown) {
    process.stderr.write(`[i18n-doctor] ignoring unknown argument: ${arg}\n`);
  }
  startLanguageServer({
    ...(options.logLevel !== undefined ? { logLevel: options.logLevel } : {}),
    ...(options.debounce !== undefined ? { debounce: options.debounce } : {}),
  });
}
