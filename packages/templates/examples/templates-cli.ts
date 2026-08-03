/**
 * Example: analyze framework templates for translation usages.
 *
 *   npx tsx packages/templates/examples/templates-cli.ts path/to/file.vue
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { createTemplateAnalyzer } from "../src/index.js";

const target = process.argv[2];
if (!target) {
  console.error("Usage: templates-cli <file>");
  process.exit(1);
}

const absolutePath = path.resolve(target);
const relativePath = path.basename(absolutePath);
const sourceText = readFileSync(absolutePath, "utf8");
const analyzer = createTemplateAnalyzer();

const result = analyzer.analyzeFile({
  absolutePath,
  relativePath,
  sourceText,
  libraryHints: new Set(process.argv.slice(3)),
});

for (const w of result.warnings) {
  console.warn(`[${w.code}] ${w.message}`);
}

for (const u of result.usages) {
  console.log(
    `${u.framework}/${u.detector} ${u.key} @ ${u.relativePath}:${u.location.line}:${u.location.column} (${u.confidence})`,
  );
}

console.log(`\n${result.usages.length} usage(s)`);
