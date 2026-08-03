import ts from "typescript";
import type { PossibleValueSet } from "../api/types.js";
import type { EvaluatorHost } from "./dynamic-evaluator.js";
import { createDynamicEvaluator } from "./dynamic-evaluator.js";
import { isIgnoredParamFlowCallee } from "./heuristics.js";
import { fromValues, unionSets } from "./possible-set.js";

/**
 * Collect simple function-parameter value sets from call sites in analyzed files.
 *
 * For:
 *   function translate(section) { t(section + ".title") }
 *   translate("profile")
 *
 * records: `file::translate::section` → { "profile" }
 */
export function collectParamFlow(
  host: EvaluatorHost,
  files: ReadonlyMap<string, ts.SourceFile>,
): void {
  host.paramFlow.clear();

  // Index function declarations: name → { file, fn, paramNames }
  const functions: {
    absolutePath: string;
    name: string;
    params: string[];
    sourceFile: ts.SourceFile;
  }[] = [];

  for (const [abs, sf] of files) {
    const visit = (node: ts.Node): void => {
      if (ts.isFunctionDeclaration(node) && node.name && node.body) {
        const params = paramNames(node);
        if (params.length > 0) {
          functions.push({
            absolutePath: abs,
            name: node.name.text,
            params,
            sourceFile: sf,
          });
        }
      }
      if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.initializer
      ) {
        const init = unwrap(node.initializer);
        if (
          (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) &&
          init.parameters.length > 0
        ) {
          functions.push({
            absolutePath: abs,
            name: node.name.text,
            params: paramNames(init),
            sourceFile: sf,
          });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }

  const byName = new Map<string, typeof functions>();
  for (const fn of functions) {
    const list = byName.get(fn.name);
    if (list) list.push(fn);
    else byName.set(fn.name, [fn]);
  }

  const evaluator = createDynamicEvaluator(host);

  for (const [abs, sf] of files) {
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
        const name = node.expression.text;
        if (isIgnoredParamFlowCallee(name)) {
          ts.forEachChild(node, visit);
          return;
        }
        const targets = byName.get(name);
        if (targets && targets.length > 0) {
          // Prefer same-file target; else first (conservative, may merge overloads)
          const target =
            targets.find((t) => t.absolutePath === abs) ?? targets[0]!;
          for (let i = 0; i < target.params.length; i++) {
            const arg = node.arguments[i];
            if (!arg || ts.isSpreadElement(arg)) continue;
            const param = target.params[i]!;
            const analysis = evaluator.evaluate(abs, arg, sf, {
              depth: 0,
              visited: new Set(),
              chain: [],
              paramEnv: new Map(),
            });
            if (!analysis.resolved) continue;
            const key = `${target.absolutePath}::${target.name}::${param}`;
            const next = fromValues(analysis.possibleKeys, {
              confidence: Math.min(analysis.confidence, 0.85),
              incomplete: analysis.incomplete,
              maxValues: host.maxValues,
            });
            const prev = host.paramFlow.get(key);
            host.paramFlow.set(
              key,
              prev ? unionSets([prev, next], host.maxValues) : next,
            );
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
}

function paramNames(fn: ts.FunctionLikeDeclaration): string[] {
  const out: string[] = [];
  for (const p of fn.parameters) {
    if (ts.isIdentifier(p.name) && !p.dotDotDotToken) {
      out.push(p.name.text);
    } else {
      break; // stop at complex params
    }
  }
  return out;
}

function unwrap(expr: ts.Expression): ts.Expression {
  let current = expr;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isTypeAssertionExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isNonNullExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}
