/**
 * Example usage of @i18n-unused/ast
 *
 * Run after build:
 *   node --experimental-strip-types examples/basic-usage.ts
 * or import from dist in a small script.
 */

import ts from "typescript";
import {
  createAstEngine,
  queryApi,
  traversalApi,
} from "../src/index.js";

const engine = createAstEngine({
  concurrency: 4,
  cache: true,
});

const source = `
// greeting helper
export function greet(name: string) {
  return t('hello.world', { name });
}

export const App = () => <div>{greet('Ada')}</div>;
`;

const parsed = engine.parse({
  fileId: "src/App.tsx",
  fileName: "src/App.tsx",
  sourceText: source,
  contentHash: "demo-hash-1",
});

console.log("ok:", parsed.ok);
console.log("language:", parsed.language, "jsx:", parsed.jsx);
console.log("diagnostics:", parsed.diagnostics.length);

const calls = traversalApi.findAll(
  parsed.sourceFile,
  (node) => ts.isCallExpression(node),
);

for (const call of calls) {
  const loc = queryApi.getLocation(parsed.sourceFile, call);
  const text = queryApi.getText(parsed.sourceFile, call);
  const comments = queryApi.getLeadingComments(parsed.sourceFile, call);
  console.log(`call ${text} at ${loc.startLine}:${loc.startCharacter}`);
  if (comments.length > 0) {
    console.log("  leading comments:", comments.map((c) => c.text.trim()));
  }
}

// Batch parse (large-repo path)
const batch = await engine.parseMany([
  {
    fileName: "src/a.ts",
    sourceText: "export const a = 1;",
    contentHash: "a1",
  },
  {
    fileName: "src/b.tsx",
    sourceText: "export const B = () => <span />;",
    contentHash: "b1",
  },
  {
    // Syntax error — does not abort the batch
    fileName: "src/bad.ts",
    sourceText: "export const x = (",
    contentHash: "bad1",
  },
]);

console.log(
  "batch:",
  batch.files.map((f) => ({ file: f.fileName, ok: f.ok, diags: f.diagnostics.length })),
);
console.log("timings:", batch.timings);

// Cache hit
const again = engine.parse({
  fileId: "src/App.tsx",
  fileName: "src/App.tsx",
  sourceText: source,
  contentHash: "demo-hash-1",
});
console.log("fromCache:", again.fromCache);
