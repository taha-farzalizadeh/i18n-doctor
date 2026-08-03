/**
 * Example CLI for @i18n-unused/imports
 *
 *   npx tsx packages/imports/examples/imports-cli.ts <root> <file> <identifier>
 *
 * Resolves an identifier through imports/exports to its declaration.
 */

import path from "node:path";
import { createImportResolver } from "../src/index.js";

const rootArg = process.argv[2];
const fileArg = process.argv[3];
const identifier = process.argv[4];

if (!rootArg || !fileArg || !identifier) {
  console.error(
    "Usage: npx tsx packages/imports/examples/imports-cli.ts <root> <file> <identifier>",
  );
  process.exit(1);
}

const root = path.resolve(rootArg);
const filePath = path.resolve(root, fileArg);

const resolver = createImportResolver({ root });
const graph = resolver.buildGraph({
  entryFiles: [filePath],
  followDepth: 16,
});

const result = resolver.resolveSymbol({
  graph,
  filePath,
  identifier,
});

console.log(`Identifier: ${identifier}`);
console.log(`Usage file: ${result.originalUsage.relativePath}`);
console.log(`Unresolved: ${result.unresolved}`);
console.log(`Circular:   ${result.circular}`);
console.log(`Confidence: ${result.confidence}`);
console.log(`Export:     ${result.exportedSymbol}`);
console.log(`Source:     ${result.resolvedRelativePath}`);
console.log(
  `Decl:       ${result.declarationLocation.line}:${result.declarationLocation.column}`,
);
console.log("");
console.log("Chain:");
for (const step of result.resolutionChain) {
  const where = step.relativePath ?? step.specifier ?? "";
  const sym = step.symbol ? ` ${step.symbol}` : "";
  console.log(`  [${step.kind}]${sym}  ${where}`);
}
