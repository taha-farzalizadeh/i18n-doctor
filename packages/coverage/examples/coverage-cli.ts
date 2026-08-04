/**
 * Example CLI for @i18n-unused/coverage
 *
 *   npx tsx packages/coverage/examples/coverage-cli.ts [root] [--json] [--base en]
 */

import path from "node:path";
import {
  createCoverageAnalyzer,
  formatCoverageJson,
  formatCoverageReport,
} from "../src/index.js";

const args = process.argv.slice(2);
const jsonMode = args.includes("--json");
const baseIdx = args.indexOf("--base");
const baseLocale =
  baseIdx >= 0 && args[baseIdx + 1] ? args[baseIdx + 1] : undefined;
const rootArg = args.find(
  (a, i) => !a.startsWith("--") && (baseIdx < 0 || i !== baseIdx + 1),
);
const root = path.resolve(rootArg ?? process.cwd());

const result = await createCoverageAnalyzer().analyzeFromRoot({
  root,
  ...(baseLocale ? { options: { baseLocale } } : {}),
});

if (jsonMode) {
  process.stdout.write(formatCoverageJson(result));
} else {
  process.stdout.write(`${formatCoverageReport(result)}\n`);
}

process.exitCode = result.stats.missingCount > 0 ? 1 : 0;
