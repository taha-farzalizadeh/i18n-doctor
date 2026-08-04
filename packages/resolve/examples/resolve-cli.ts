/**
 * Example CLI for @i18n-doctor/resolve
 *
 *   npx tsx packages/resolve/examples/resolve-cli.ts <file> [identifier]
 *
 * Prints alias-graph bindings and resolves every CallExpression identifier
 * in a single file (no import / cross-file resolution).
 */

import fs from "node:fs";
import path from "node:path";
import { createAstEngine } from "@i18n-doctor/ast";
import ts from "typescript";
import { createLocalResolver } from "../src/index.js";

const fileArg = process.argv[2];
const onlyName = process.argv[3];

if (!fileArg) {
  console.error(
    "Usage: npx tsx packages/resolve/examples/resolve-cli.ts <file> [identifier]",
  );
  process.exit(1);
}

const absolutePath = path.resolve(fileArg);
const sourceText = fs.readFileSync(absolutePath, "utf8");
const fileName = path.basename(absolutePath);

const engine = createAstEngine({ cache: false });
const parsed = engine.parse({ fileName, sourceText });
const resolver = createLocalResolver();
const analysis = resolver.analyze({
  sourceFile: parsed.sourceFile,
  fileName: absolutePath,
});

console.log(`File: ${absolutePath}`);
console.log(`Bindings: ${analysis.graph.bindings.length}`);
console.log(`Wrappers: ${analysis.wrappers.length}`);
console.log("");

for (const binding of analysis.graph.bindings) {
  const target =
    binding.target.type === "member"
      ? `${binding.target.object}.${binding.target.property}`
      : binding.target.type === "name"
        ? binding.target.name
        : "<unresolved>";
  console.log(
    `  [${binding.kind}] ${binding.name} -> ${target}  (${binding.location.line}:${binding.location.column})`,
  );
}

console.log("");
console.log("Resolutions:");

const visit = (node: ts.Node): void => {
  if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
    const name = node.expression.text;
    if (onlyName && name !== onlyName) {
      ts.forEachChild(node, visit);
      return;
    }
    const position = node.expression.getStart(parsed.sourceFile);
    const result = resolver.resolve({
      analysis,
      name,
      position,
    });
    const chain = result.aliasChain.map((s) => s.identifier).join(" -> ");
    console.log(
      `  ${name}() @${result.location.line}:${result.location.column}` +
        ` => ${result.resolvedIdentifier}` +
        `  confidence=${result.confidence.toFixed(2)}` +
        (result.circular ? "  circular" : "") +
        (result.unresolved ? "  unresolved" : "") +
        `\n    chain: ${chain}`,
    );
  }
  ts.forEachChild(node, visit);
};

visit(parsed.sourceFile);
