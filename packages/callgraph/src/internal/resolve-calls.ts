import type { ConstantEvaluator } from "@i18n-doctor/constants";
import type { ImportResolver, ModuleGraph } from "@i18n-doctor/imports";
import ts from "typescript";
import type {
  FunctionGraph,
  PropagationRecord,
  ResolvedTranslationCall,
  SourceLocation,
} from "../api/types.js";
import { locationOf, relativeToRoot } from "./location.js";
import {
  findAliasAt,
  type ScopedAliasRecord,
} from "./propagation.js";
import type { ScopeMetaStore } from "./scope-meta.js";

/**
 * Walk call sites in a file and emit ResolvedTranslationCall when the callee
 * is a known wrapper / alias / seed and the first argument is a static key.
 */
export function resolveTranslationCallsInFile(input: {
  root: string;
  absolutePath: string;
  sourceFile: ts.SourceFile;
  functionGraph: FunctionGraph;
  records: ReadonlyMap<string, PropagationRecord>;
  aliasRecords: readonly ScopedAliasRecord[];
  scopes: ScopeMetaStore;
  evaluator: ConstantEvaluator;
  importResolver?: ImportResolver;
  moduleGraph?: ModuleGraph;
}): ResolvedTranslationCall[] {
  const { root, absolutePath, sourceFile } = input;
  const relativePath = relativeToRoot(root, absolutePath);
  const results: ResolvedTranslationCall[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && node.arguments.length > 0) {
      const callee = calleeLabel(node.expression);
      if (callee) {
        const position = node.expression.getStart(sourceFile);
        const resolved = resolveCallee(callee, absolutePath, position, input);
        if (resolved) {
          const arg = node.arguments[0]!;
          if (!ts.isSpreadElement(arg)) {
            const keyResult = input.evaluator.evaluateExpression({
              filePath: absolutePath,
              sourceFile,
              expression: arg,
            });
            if (
              keyResult.resolved &&
              typeof keyResult.value === "string" &&
              keyResult.value.length > 0
            ) {
              results.push({
                key: keyResult.value,
                calledFunction: callee,
                resolvedTranslationFunction:
                  resolved.resolvedTranslationFunction,
                callChain: chainForCall(callee, resolved),
                location: locationOf(sourceFile, node.expression),
                confidence: round(
                  Math.min(resolved.confidence, keyResult.confidence, 0.95),
                ),
                absolutePath,
                relativePath,
              });
            }
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  results.sort(
    (a, b) =>
      a.location.start - b.location.start || a.key.localeCompare(b.key),
  );
  return results;
}

function resolveCallee(
  callee: string,
  absolutePath: string,
  position: number,
  input: {
    functionGraph: FunctionGraph;
    records: ReadonlyMap<string, PropagationRecord>;
    aliasRecords: readonly ScopedAliasRecord[];
    scopes: ScopeMetaStore;
    importResolver?: ImportResolver;
    moduleGraph?: ModuleGraph;
  },
): PropagationRecord | undefined {
  // Scoped alias: const tr = t
  const alias = findAliasAt(
    input.aliasRecords,
    absolutePath,
    bareName(callee),
    position,
  );
  if (alias && !callee.includes(".")) {
    return alias;
  }

  // Simple name
  if (!callee.includes(".") && !callee.includes("(")) {
    const local = input.scopes.findLocal(absolutePath, callee, position);

    if (local?.functionId) {
      const rec = input.records.get(local.functionId);
      if (rec && !rec.circular) return rec;
      // Local function shadows the seed — do not fall back to seed::t
      if (local.functionId) return undefined;
    }

    // Non-function local binding (const x = ...) that is not a translator alias
    if (local && !local.functionId) {
      // alias already checked; shadowing a seed with a non-translator binding
      if (!alias) return undefined;
    }

    const imported = resolveImportedWrapper(
      callee,
      absolutePath,
      position,
      input,
    );
    if (imported) return imported;

    // Only use seed when nothing local shadows the name
    if (!local) {
      return input.records.get(`seed::${callee}`);
    }
    return undefined;
  }

  // Member / hook: i18n.t, useTranslation().t
  const seedExact = input.records.get(`seed::${callee}`);
  if (seedExact) return seedExact;

  const prop = propertyOf(callee);
  if (prop) {
    const methodLocal = input.scopes.findLocal(absolutePath, prop, position);
    if (methodLocal?.functionId) {
      const method = input.functionGraph.get(methodLocal.functionId);
      if (method?.kind === "method") {
        const rec = input.records.get(method.id);
        if (rec && !rec.circular) {
          return {
            ...rec,
            callChain: [callee, ...rec.callChain.filter((s) => s !== prop)],
          };
        }
      }
    }
  }

  return undefined;
}

function resolveImportedWrapper(
  callee: string,
  absolutePath: string,
  position: number,
  input: {
    functionGraph: FunctionGraph;
    records: ReadonlyMap<string, PropagationRecord>;
    importResolver?: ImportResolver;
    moduleGraph?: ModuleGraph;
  },
): PropagationRecord | undefined {
  if (!input.importResolver || !input.moduleGraph) return undefined;
  const sym = input.importResolver.resolveSymbol({
    graph: input.moduleGraph,
    filePath: absolutePath,
    identifier: callee,
    position,
  });
  if (sym.unresolved || sym.circular) return undefined;
  const localName = sym.localName ?? sym.exportedSymbol;
  const fn = input.functionGraph.findByName(
    sym.resolvedSourceFile,
    localName,
    sym.declarationLocation.end,
  );
  if (!fn) return undefined;
  const rec = input.records.get(fn.id);
  if (!rec || rec.circular) return undefined;
  return {
    ...rec,
    callChain: [callee, ...rec.callChain.filter((s) => s !== localName)],
    confidence: Math.min(rec.confidence, sym.confidence),
  };
}

function chainForCall(
  callee: string,
  resolved: PropagationRecord,
): readonly string[] {
  if (resolved.callChain[0] === callee) return resolved.callChain;
  if (resolved.functionId.startsWith("seed::")) {
    return [callee];
  }
  return [callee, ...resolved.callChain.filter((s) => s !== callee)];
}

function calleeLabel(expression: ts.Expression): string | undefined {
  const expr = unwrap(expression);
  if (ts.isIdentifier(expr)) return expr.text;
  if (ts.isPropertyAccessExpression(expr) && ts.isIdentifier(expr.name)) {
    const inner = unwrap(expr.expression);
    if (ts.isCallExpression(inner)) {
      const hook = calleeLabel(inner.expression);
      if (hook) return `${hook}().${expr.name.text}`;
    }
    const obj = rootIdentifier(expr.expression);
    return obj ? `${obj}.${expr.name.text}` : expr.name.text;
  }
  return undefined;
}

function rootIdentifier(expr: ts.Expression): string | undefined {
  const e = unwrap(expr);
  if (ts.isIdentifier(e)) return e.text;
  if (ts.isPropertyAccessExpression(e)) return rootIdentifier(e.expression);
  return undefined;
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

function bareName(callee: string): string {
  return callee.includes(".") ? callee.slice(0, callee.indexOf(".")) : callee;
}

function propertyOf(callee: string): string | undefined {
  if (!callee.includes(".")) return undefined;
  return callee.slice(callee.lastIndexOf(".") + 1);
}

function round(n: number): number {
  return Math.round(Math.max(0, Math.min(1, n)) * 100) / 100;
}

export type { SourceLocation };
