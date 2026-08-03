/**
 * Example CLI wiring for @i18n-unused/issues
 *
 *   npx tsx packages/issues/examples/issues-cli.ts [root] [--json]
 *
 * Orchestration lives here — Issue Engine only receives facts.
 */

import path from "node:path";
import { createSourceDetector } from "@i18n-unused/sources";
import { createUsageDetector } from "@i18n-unused/usages";
import {
  createIssueEngine,
  createJsonReporter,
  createTerminalReporter,
  definitionsFromCatalog,
  usagesFromCatalog,
} from "../src/index.js";

const args = process.argv.slice(2);
const jsonMode = args.includes("--json");
const rootArg = args.find((a) => !a.startsWith("--"));
const root = path.resolve(rootArg ?? process.cwd());

const sourceCatalog = await createSourceDetector().discover({
  root,
  useDetection: true,
});
const usageCatalog = await createUsageDetector().detect({
  root,
  useDetection: true,
});

const engine = createIssueEngine();
const result = engine.analyze({
  root,
  definitions: definitionsFromCatalog(sourceCatalog),
  usages: usagesFromCatalog(usageCatalog),
});

if (jsonMode) {
  const reporter = createJsonReporter({ verbose: false });
  console.log(reporter.report(result));
} else {
  const reporter = createTerminalReporter({ color: true, hyperlinks: true });
  console.log(reporter.report(result));
}

process.exitCode = result.stats.missingKey > 0 ? 1 : 0;
