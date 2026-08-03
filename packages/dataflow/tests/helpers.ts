import path from "node:path";
import { createAstEngine } from "@i18n-unused/ast";
import ts from "typescript";
import {
  createDataFlowEngine,
  type DataFlowEngine,
  type DynamicKeyAnalysis,
} from "../src/index.js";

const engine = createAstEngine({ cache: false, setParentNodes: true });
let seq = 0;

export function project(files: Record<string, string>): {
  root: string;
  dataflow: DataFlowEngine;
  abs: (...parts: string[]) => string;
  parse: (rel: string) => ts.SourceFile;
  /** Analyze first arg of the last call to `callee` (default: last call). */
  analyzeCall: (rel: string, callee?: string) => DynamicKeyAnalysis;
  analyzeExpr: (
    rel: string,
    pick: (sf: ts.SourceFile) => ts.Expression,
  ) => DynamicKeyAnalysis;
  analyzeFile: (rel: string) => ReturnType<DataFlowEngine["analyzeFile"]>;
} {
  const root = path.resolve(`/virtual-dataflow-${++seq}`);
  const store = new Map<string, string>();
  for (const [rel, content] of Object.entries(files)) {
    store.set(path.resolve(root, rel), content);
  }

  const dataflow = createDataFlowEngine({
    root,
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
    dataflow,
    abs,
    parse,
    analyzeFile(rel) {
      const sf = parse(rel);
      return dataflow.analyzeFile({ filePath: abs(rel), sourceFile: sf });
    },
    analyzeCall(rel, callee) {
      const sf = parse(rel);
      dataflow.analyzeFile({ filePath: abs(rel), sourceFile: sf });
      return dataflow.analyzeExpression({
        filePath: abs(rel),
        sourceFile: sf,
        expression: callArg(sf, callee),
      });
    },
    analyzeExpr(rel, pick) {
      const sf = parse(rel);
      dataflow.analyzeFile({ filePath: abs(rel), sourceFile: sf });
      return dataflow.analyzeExpression({
        filePath: abs(rel),
        sourceFile: sf,
        expression: pick(sf),
      });
    },
  };
}

function callArg(sf: ts.SourceFile, callee?: string): ts.Expression {
  let found: ts.Expression | undefined;
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && node.arguments.length > 0) {
      const arg = node.arguments[0];
      if (!arg || ts.isSpreadElement(arg)) return;
      if (callee) {
        if (
          ts.isIdentifier(node.expression) &&
          node.expression.text === callee
        ) {
          found = arg;
        }
      } else {
        found = arg;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  if (!found) {
    throw new Error(callee ? `no call to ${callee}` : "no call argument");
  }
  return found;
}
