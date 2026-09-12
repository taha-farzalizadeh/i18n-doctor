/**
 * Index helpers that only return static string literals (switch / if / return)
 * so `t(getTitleByStatusType(variant))` can mark those keys as used.
 *
 * Also indexes helpers that return arrays of static strings / string-enum
 * members, e.g. `return [IPropertyType.BOOLEAN, IPropertyType.STRING]`.
 */

import ts from "typescript";
import { staticStringKeys, type StaticKeyOptions } from "./ast-helpers.js";
import type { EnumValueIndex } from "./enum-values.js";

/** `fileRel#fnName` → static string return values. */
export type HelperReturnIndex = Map<string, readonly string[]>;

export function helperIndexKey(fileRel: string, name: string): string {
  return `${normalizeRel(fileRel)}#${name}`;
}

export function indexHelperStringReturns(
  sourceFile: ts.SourceFile,
  relativePath: string,
  enumIndex?: EnumValueIndex,
): HelperReturnIndex {
  const out: HelperReturnIndex = new Map();
  const fileRel = normalizeRel(relativePath);
  const keyOpts: StaticKeyOptions = {
    relativePath,
    ...(enumIndex ? { enumIndex } : {}),
  };

  for (const stmt of sourceFile.statements) {
    if (ts.isFunctionDeclaration(stmt) && stmt.name && stmt.body) {
      const keys = collectStaticStringReturns(stmt, sourceFile, keyOpts);
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
      const keys = collectStaticStringReturns(init, sourceFile, keyOpts);
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
  enumIndex?: EnumValueIndex,
): readonly string[] {
  const call = unwrap(expr);
  if (!ts.isCallExpression(call)) return [];
  const callee = unwrap(call.expression);
  if (!ts.isIdentifier(callee)) return [];

  const keyOpts: StaticKeyOptions | undefined = enumIndex
    ? { relativePath, enumIndex }
    : relativePath
      ? { relativePath }
      : undefined;
  const local = findLocalHelperReturns(callee.text, sourceFile, keyOpts);
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
 * (or empty string), including arrays of static strings / enum members.
 * Any dynamic return → no keys (conservative).
 */
export function collectStaticStringReturns(
  fn: ts.FunctionLikeDeclaration,
  sourceFile: ts.SourceFile,
  keyOpts?: StaticKeyOptions,
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
    const keys = staticKeysFromReturnExpr(expr, sourceFile, keyOpts);
    // Empty return / `return ""` / `return` → allow (default branch).
    if (keys === undefined) {
      return [];
    }
    for (const key of keys) {
      if (key.length > 0 && !out.includes(key)) out.push(key);
    }
  }
  return out;
}

/**
 * `undefined` = dynamic / unresolvable (abort helper).
 * Empty array = explicitly empty contribution (e.g. `return ""`).
 */
function staticKeysFromReturnExpr(
  expr: ts.Expression,
  sourceFile: ts.SourceFile,
  keyOpts?: StaticKeyOptions,
): readonly string[] | undefined {
  const node = unwrap(expr);

  if (ts.isArrayLiteralExpression(node)) {
    const out: string[] = [];
    for (const el of node.elements) {
      if (ts.isSpreadElement(el)) return undefined;
      const keys = staticStringKeys(el, sourceFile, new Set(), keyOpts);
      if (keys.length === 0) return undefined;
      for (const key of keys) {
        if (key.length > 0 && !out.includes(key)) out.push(key);
      }
    }
    return out;
  }

  const keys = staticStringKeys(node, sourceFile, new Set(), keyOpts);
  if (keys.length === 0) {
    if (
      (ts.isStringLiteral(node) ||
        ts.isNoSubstitutionTemplateLiteral(node)) &&
      node.text === ""
    ) {
      return [];
    }
    return undefined;
  }
  return keys;
}

function findLocalHelperReturns(
  name: string,
  sourceFile: ts.SourceFile,
  keyOpts?: StaticKeyOptions,
): readonly string[] {
  for (const stmt of sourceFile.statements) {
    if (ts.isFunctionDeclaration(stmt) && stmt.name?.text === name) {
      return collectStaticStringReturns(stmt, sourceFile, keyOpts);
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
            return collectStaticStringReturns(init, sourceFile, keyOpts);
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
