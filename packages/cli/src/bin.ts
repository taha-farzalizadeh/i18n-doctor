#!/usr/bin/env node
/**
 * Binary entry for `i18n-unused`.
 * Works under npm, pnpm, yarn, and bun via the package bin field.
 */

import { runCli } from "./cli.js";
import { handleCliError } from "./internal/errors.js";

try {
  const code = await runCli(process.argv);
  process.exitCode = code;
} catch (error) {
  process.exitCode = handleCliError(error);
}
