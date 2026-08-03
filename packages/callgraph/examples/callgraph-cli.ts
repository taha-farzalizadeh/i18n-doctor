/**
 * Example CLI for @i18n-unused/callgraph
 *
 *   npx tsx packages/callgraph/examples/callgraph-cli.ts <root> <file> [file...]
 */

import path from "node:path";
import { createCallGraphAnalyzer } from "../src/index.js";

const rootArg = process.argv[2];
const files = process.argv.slice(3);

if (!rootArg || files.length === 0) {
  console.error(
    "Usage: npx tsx packages/callgraph/examples/callgraph-cli.ts <root> <file> [file...]",
  );
  process.exit(1);
}

const root = path.resolve(rootArg);
const analyzer = createCallGraphAnalyzer({ root });
const result = analyzer.analyzeFiles(
  files.map((f) => path.resolve(root, f)),
);

console.log(`Root: ${result.root}`);
console.log(`Files: ${result.files.length}`);
console.log(`Functions: ${result.functionGraph.functions.length}`);
console.log(`Call edges: ${result.callGraph.edges.length}`);
console.log(`Wrappers: ${result.wrappers.length}`);
console.log("");

for (const w of result.wrappers) {
  console.log(
    `Wrapper ${w.name} → ${w.resolvedTranslationFunction} [${w.callChain.join(" → ")}] (${w.kind}, conf=${w.confidence})`,
  );
}

console.log("");
console.log(`Translation calls: ${result.translationCalls.length}`);
for (const c of result.translationCalls) {
  console.log(
    `  ${c.relativePath}:${c.location.line}  ${c.calledFunction}(${JSON.stringify(c.key)}) → ${c.resolvedTranslationFunction}  chain=[${c.callChain.join(" → ")}]`,
  );
}
