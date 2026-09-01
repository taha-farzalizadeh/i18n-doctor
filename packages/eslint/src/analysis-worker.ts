/**
 * Standalone worker entry — runs one project analysis and prints JSON to stdout.
 * Invoked synchronously from ESLint rules via `node analysis-worker.js <cwd> <file>`.
 */

import path from "node:path";
import { runProjectAnalysis } from "./internal/run-project-analysis.js";

const cwd = process.argv[2];
const filename = process.argv[3];

if (!cwd || !filename) {
  process.stderr.write("usage: analysis-worker <cwd> <filename>\n");
  process.exit(2);
}

try {
  const snapshot = await runProjectAnalysis({
    cwd,
    filename: path.resolve(filename),
  });
  process.stdout.write(JSON.stringify(snapshot));
} catch (error) {
  process.stderr.write(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
