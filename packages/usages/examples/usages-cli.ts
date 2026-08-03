/**
 * Example CLI usage for @i18n-unused/usages
 *
 *   npx tsx packages/usages/examples/usages-cli.ts [root]
 */

import path from "node:path";
import {
  createUsageDetector,
  formatUsageReport,
  usageToDiagnostic,
} from "../src/index.js";

const root = path.resolve(process.argv[2] ?? process.cwd());
const detector = createUsageDetector();
const catalog = await detector.detect({ root });

console.log(formatUsageReport(catalog));
console.log("");
console.log(
  JSON.stringify(
    {
      usageCount: catalog.stats.usageCount,
      libraries: catalog.libraries,
      usages: catalog.usages.slice(0, 20).map(usageToDiagnostic),
    },
    null,
    2,
  ),
);
