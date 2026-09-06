/**
 * Index helpers that only return static string literals (switch / if / return)
 * so `t(getTitleByStatusType(variant))` can mark those keys as used.
 */

import ts from "typescript";
import { staticStringKeys } from "./ast-helpers.js";

/** `fileRel#fnName` → static string return values. */
export type HelperReturnIndex = Map<string, readonly string[]>;

export function helperIndexKey(fileRel: string, name: string): string {
  return `${normalizeRel(fileRel)}#${name}`;
}

export function indexHelperStringReturns(
  sourceFile: ts.SourceFile,
  relativePath: string,
): HelperReturnIndex {
  const out: HelperReturnIndex = new Map();
  const fileRel = normalizeRel(relativePath);

  for (const stmt of sourceFile.statements) {
    if (ts.isFunctionDeclaration(stmt) && stmt.name && stmt.body) {
      const keys = collectStaticStringReturns(stmt, sourceFile);
      if (keys.length > 0) {
        out.set(helperIndexKey(fileRel, stmt.name.text), keys);
      }
      continue;
    }
    if (!ts.isVariableStatement(stmt)) continue;
    for (const decl of stmt.declarationList.declarations) {
      if (!ts.isIdentifier(decl.name) || !decl.initializer) continue;
      const init = unwrap(decl.initializer);
      if (!ts.isArrowFunction(init) && !ts.isFunctionExpression(init)) {
        continue;
      }
      const keys = collectStaticStringReturns(init, sourceFile);
      if (keys.length > 0) {
        out.set(helperIndexKey(fileRel, decl.name.text), keys);
      }
    }
  }

  return out;
}

export function mergeHelperReturnIndex(
  target: HelperReturnIndex,
  source: HelperReturnIndex,
): void {
  for (const [key, values] of source) {
    target.set(key, values);
  }
}

/**
 * Resolve `fn(...)` / imported `fn(...)` to static string return keys.
 */
export function resolveHelperCallKeys(
  expr: ts.Expression,
  sourceFile: ts.SourceFile,
  relativePath: string,
  index: HelperReturnIndex,
): readonly string[] {
  const call = unwrap(expr);
  if (!ts.isCallExpression(call)) return [];
  const callee = unwrap(call.expression);
  if (!ts.isIdentifier(callee)) return [];

  const local = findLocalHelperReturns(callee.text, sourceFile);
  if (local.length > 0) return local;

  const fromIndex = index.get(helperIndexKey(relativePath, callee.text));
  if (fromIndex && fromIndex.length > 0) return fromIndex;

  const modulePath = findImportModulePath(callee.text, sourceFile);
  if (!modulePath) return [];

  if (modulePath.startsWith(".")) {
    const targetRel = resolveRelativeModule(relativePath, modulePath);
    if (!targetRel) return [];
    for (const candidate of moduleCandidates(targetRel)) {
      const hit = index.get(helperIndexKey(candidate, callee.text));
      if (hit && hit.length > 0) return hit;
    }
    return [];
  }

  // Path-alias / package imports: match by function name.
  const suffix = `#${callee.text}`;
  for (const [key, values] of index) {
    if (!key.endsWith(suffix)) continue;
    if (values.length > 0) return values;
  }
  return [];
}

/**
 * All return expressions in a function must resolve to static strings
 * (or empty string). Any dynamic return → no keys (conservative).
 */
export function collectStaticStringReturns(
  fn: ts.FunctionLikeDeclaration,
  sourceFile: ts.SourceFile,
): readonly string[] {
  if (!fn.body) return [];

  const returns: ts.Expression[] = [];

  if (!ts.isBlock(fn.body)) {
    // Arrow with expression body: `() => "KEY"`
    returns.push(fn.body);
  } else {
    const visit = (node: ts.Node): void => {
      if (ts.isReturnStatement(node)) {
        // Bare `return;` is fine (e.g. default branch) — no key contribution.
        if (node.expression) returns.push(node.expression);
        return;
      }
      // Don't walk nested functions.
      if (
        ts.isFunctionDeclaration(node) ||
        ts.isFunctionExpression(node) ||
        ts.isArrowFunction(node) ||
        ts.isMethodDeclaration(node)
      ) {
        return;
      }
      ts.forEachChild(node, visit);
    };
    visit(fn.body);
  }

  if (returns.length === 0) return [];

  const out: string[] = [];
  for (const expr of returns) {
    const keys = staticStringKeys(expr, sourceFile);
    // Empty return / `return ""` / `return` → allow (default branch).
    if (keys.length === 0) {
      const text = unwrap(expr);
      if (
        (ts.isStringLiteral(text) ||
          ts.isNoSubstitutionTemplateLiteral(text)) &&
        text.text === ""
      ) {
        continue;
      }
      return [];
    }
    for (const key of keys) {
      if (key.length > 0 && !out.includes(key)) out.push(key);
    }
  }
  return out;
}

function findLocalHelperReturns(
  name: string,
  sourceFile: ts.SourceFile,
): readonly string[] {
  for (const stmt of sourceFile.statements) {
    if (ts.isFunctionDeclaration(stmt) && stmt.name?.text === name) {
      return collectStaticStringReturns(stmt, sourceFile);
    }
    if (ts.isVariableStatement(stmt)) {
      for (const decl of stmt.declarationList.declarations) {
        if (
          ts.isIdentifier(decl.name) &&
          decl.name.text === name &&
          decl.initializer
        ) {
          const init = unwrap(decl.initializer);
          if (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) {
            return collectStaticStringReturns(init, sourceFile);
          }
        }
      }
    }
  }
  return [];
}

function findImportModulePath(
  localName: string,
  sourceFile: ts.SourceFile,
): string | undefined {
  for (const stmt of sourceFile.statements) {
    if (!ts.isImportDeclaration(stmt) || !stmt.importClause) continue;
    if (!ts.isStringLiteral(stmt.moduleSpecifier)) continue;
    const named = stmt.importClause.namedBindings;
    if (named && ts.isNamedImports(named)) {
      for (const el of named.elements) {
        if (el.name.text === localName) {
          return stmt.moduleSpecifier.text;
        }
      }
    }
    if (
      stmt.importClause.name &&
      stmt.importClause.name.text === localName
    ) {
      return stmt.moduleSpecifier.text;
    }
  }
  return undefined;
}

function resolveRelativeModule(
  fromFile: string,
  moduleSpec: string,
): string | undefined {
  if (!moduleSpec.startsWith(".")) return undefined;
  const fromDir = fromFile.includes("/")
    ? fromFile.slice(0, fromFile.lastIndexOf("/"))
    : "";
  const joined = fromDir ? `${fromDir}/${moduleSpec}` : moduleSpec;
  return normalizeRel(joined);
}

function moduleCandidates(base: string): readonly string[] {
  const normalized = normalizeRel(base);
  if (/\.[cm]?[jt]sx?$/.test(normalized)) return [normalized];
  return [
    `${normalized}.ts`,
    `${normalized}.tsx`,
    `${normalized}.js`,
    `${normalized}.jsx`,
    `${normalized}.mjs`,
    `${normalized}.cjs`,
    `${normalized}/index.ts`,
    `${normalized}/index.tsx`,
    `${normalized}/index.js`,
  ];
}

function unwrap(expr: ts.Expression): ts.Expression {
  let current = expr;
  while (
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isParenthesizedExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

function normalizeRel(rel: string): string {
  const parts: string[] = [];
  for (const part of rel.replace(/\\/g, "/").split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      parts.pop();
      continue;
    }
    parts.push(part);
  }
  return parts.join("/");
}
