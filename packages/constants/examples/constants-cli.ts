/**
 * Example CLI for @i18n-doctor/constants
 *
 *   npx tsx packages/constants/examples/constants-cli.ts <root> <file> <identifier>
 *
 * Statically evaluates a named constant (never executes JS).
 */

import fs from "node:fs";
import path from "node:path";
import { createAstEngine } from "@i18n-doctor/ast";
import { createConstantEvaluator } from "../src/index.js";

const rootArg = process.argv[2];
const fileArg = process.argv[3];
const name = process.argv[4];

if (!rootArg || !fileArg || !name) {
  console.error(
    "Usage: npx tsx packages/constants/examples/constants-cli.ts <root> <file> <identifier>",
  );
  process.exit(1);
}

const root = path.resolve(rootArg);
const filePath = path.resolve(root, fileArg);
const sourceText = fs.readFileSync(filePath, "utf8");
const sourceFile = createAstEngine({ cache: false }).parse({
  fileName: filePath,
  sourceText,
}).sourceFile;

const evaluator = createConstantEvaluator({ root });
const result = evaluator.evaluateIdentifier({
  filePath,
  sourceFile,
  name,
});

console.log(`Identifier: ${name}`);
console.log(`Resolved:   ${result.resolved}`);
console.log(`Circular:   ${result.circular}`);
console.log(`Confidence: ${result.confidence}`);
console.log(`Value:      ${JSON.stringify(result.value)}`);
console.log(
  `Location:   ${result.sourceLocation.line}:${result.sourceLocation.column}`,
);
console.log("");
console.log("Chain:");
for (const step of result.resolutionChain) {
  console.log(
    `  [${step.kind}] ${step.label ?? ""} ${step.relativePath ?? ""} ${
      step.value !== undefined ? JSON.stringify(step.value) : ""
    }`,
  );
}
