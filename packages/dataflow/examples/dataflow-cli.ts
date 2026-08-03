/**
 * Example CLI for @i18n-unused/dataflow
 *
 *   npx tsx packages/dataflow/examples/dataflow-cli.ts <root> <file>
 */

import path from "node:path";
import { createDataFlowEngine } from "../src/index.js";

const rootArg = process.argv[2];
const fileArg = process.argv[3];

if (!rootArg || !fileArg) {
  console.error(
    "Usage: npx tsx packages/dataflow/examples/dataflow-cli.ts <root> <file>",
  );
  process.exit(1);
}

const root = path.resolve(rootArg);
const filePath = path.resolve(root, fileArg);
const engine = createDataFlowEngine({ root });
const result = engine.analyzeFile({ filePath });

console.log(`File: ${result.relativePath}`);
console.log(`Analyses: ${result.analyses.length}`);
console.log("");

for (const a of result.analyses) {
  console.log(
    `  [${a.analysisType}] keys=${JSON.stringify(a.possibleKeys)} conf=${a.confidence} incomplete=${a.incomplete} circular=${a.circular}`,
  );
  console.log(
    `    locs=${a.sourceLocations.map((l) => `${l.line}:${l.column}`).join(", ")}`,
  );
  console.log(
    `    chain=${a.resolutionChain.map((s) => s.kind).join(" → ")}`,
  );
}
