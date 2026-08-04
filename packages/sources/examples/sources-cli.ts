/**
 * Example CLI usage for @i18n-doctor/sources
 *
 *   npx tsx packages/sources/examples/sources-cli.ts [root]
 */

import path from "node:path";
import {
  createSourceDetector,
  formatCatalogReport,
} from "../src/index.js";

const root = path.resolve(process.argv[2] ?? process.cwd());
const detector = createSourceDetector();
const catalog = await detector.discover({ root });

console.log(formatCatalogReport(catalog));
console.log("");
console.log(
  JSON.stringify(
    {
      locales: catalog.locales,
      namespaces: catalog.namespaces,
      keyCount: catalog.stats.keyCount,
      sources: catalog.sources.map((s) => ({
        filePath: s.filePath,
        kind: s.kind,
        locale: s.locale,
        namespace: s.namespace,
        keys: s.keys.length,
        confidence: s.confidence,
      })),
    },
    null,
    2,
  ),
);
