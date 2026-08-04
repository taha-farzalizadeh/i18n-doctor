import path from "node:path";
import { createAstEngine } from "@i18n-doctor/ast";
import ts from "typescript";
import {
  createConstantEvaluator,
  type ConstantEvaluator,
  type EvaluationResult,
} from "../src/index.js";

const engine = createAstEngine({ cache: false });
let seq = 0;

export function project(
  files: Record<string, string>,
  options: {
    aliases?: Record<string, string>;
    tsconfig?: string;
    maxDepth?: number;
  } = {},
): {
  root: string;
  evaluator: ConstantEvaluator;
  abs: (...parts: string[]) => string;
  parse: (rel: string) => ts.SourceFile;
  evalExpr: (rel: string, pick: (sf: ts.SourceFile) => ts.Expression) => EvaluationResult;
  evalName: (rel: string, name: string) => EvaluationResult;
} {
  const root = path.resolve(`/virtual-constants-${++seq}`);
  const store = new Map<string, string>();
  for (const [rel, content] of Object.entries(files)) {
    store.set(path.resolve(root, rel), content);
  }
  if (options.tsconfig) {
    store.set(path.resolve(root, "tsconfig.json"), options.tsconfig);
  }

  const evaluator = createConstantEvaluator({
    root,
    ...(options.aliases ? { aliases: options.aliases } : {}),
    ...(options.maxDepth !== undefined ? { maxDepth: options.maxDepth } : {}),
    fileExists: (abs) => store.has(path.normalize(abs)),
    readFile: (abs) => store.get(path.normalize(abs)),
  });

  const abs = (...parts: string[]) => path.resolve(root, ...parts);

  const parse = (rel: string) => {
    const text = store.get(abs(rel));
    if (!text) throw new Error(`missing ${rel}`);
    return engine.parse({ fileName: abs(rel), sourceText: text }).sourceFile;
  };

  return {
    root,
    evaluator,
    abs,
    parse,
    evalExpr(rel, pick) {
      const sf = parse(rel);
      return evaluator.evaluateExpression({
        filePath: abs(rel),
        sourceFile: sf,
        expression: pick(sf),
      });
    },
    evalName(rel, name) {
      const sf = parse(rel);
      return evaluator.evaluateIdentifier({
        filePath: abs(rel),
        sourceFile: sf,
        name,
      });
    },
  };
}

/** Last argument of the last CallExpression in the file. */
export function lastCallArg(sf: ts.SourceFile): ts.Expression {
  let found: ts.Expression | undefined;
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && node.arguments.length > 0) {
      found = node.arguments[0];
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  if (!found) throw new Error("no call argument");
  return found;
}
