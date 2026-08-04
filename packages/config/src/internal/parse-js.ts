/**
 * Statically extract `export default {…}` / `module.exports = {…}`
 * from JS/TS config files. Never executes the file.
 */

import { createAstEngine, traversalApi } from "@i18n-unused/ast";
import ts from "typescript";
import type { ConfigDiagnostic } from "../api/types.js";
import { validateUserConfig } from "./validate.js";

const ast = createAstEngine({
  cache: true,
  cacheSize: 64,
  setParentNodes: true,
});

export function parseJsConfig(
  text: string,
  path: string,
): ReturnType<typeof validateUserConfig> {
  const diagnostics: ConfigDiagnostic[] = [];

  let sourceFile: ts.SourceFile;
  try {
    sourceFile = ast.parse({ fileName: path, sourceText: text }).sourceFile;
  } catch (err) {
    diagnostics.push({
      code: "config-parse-error",
      severity: "error",
      message: err instanceof Error ? err.message : String(err),
      path,
    });
    return { config: {}, diagnostics };
  }

  const obj = findConfigObject(sourceFile);
  if (!obj) {
    diagnostics.push({
      code: "config-object-not-found",
      severity: "error",
      message:
        "Could not find a static config object (export default {…} or module.exports = {…})",
      path,
      hint: "Dynamic config factories are not executed; use a plain object literal",
    });
    return { config: {}, diagnostics };
  }

  const raw = objectLiteralToJsonValue(obj, sourceFile, diagnostics, path);
  if (raw === undefined) {
    return { config: {}, diagnostics };
  }
  const validated = validateUserConfig(raw, path);
  return {
    config: validated.config,
    diagnostics: [...diagnostics, ...validated.diagnostics],
  };
}

function findConfigObject(
  sourceFile: ts.SourceFile,
): ts.ObjectLiteralExpression | undefined {
  let found: ts.ObjectLiteralExpression | undefined;

  traversalApi.forEachChild(sourceFile, (node) => {
    if (found) return;

    // export default { … }
    if (ts.isExportAssignment(node) && !node.isExportEquals) {
      found = expressionToObject(node.expression, sourceFile);
    }

    // export default defineConfig({ … }) / wrap({…})
    if (ts.isExportAssignment(node) && !node.isExportEquals) {
      const expr = unwrap(node.expression);
      if (ts.isCallExpression(expr) && expr.arguments[0]) {
        found = expressionToObject(expr.arguments[0], sourceFile) ?? found;
      }
    }

    // module.exports = { … }
    if (
      ts.isExpressionStatement(node) &&
      ts.isBinaryExpression(node.expression) &&
      node.expression.operatorToken.kind === ts.SyntaxKind.EqualsToken
    ) {
      const left = unwrap(node.expression.left);
      if (
        ts.isPropertyAccessExpression(left) &&
        ts.isIdentifier(left.expression) &&
        left.expression.text === "module" &&
        left.name.text === "exports"
      ) {
        found = expressionToObject(node.expression.right, sourceFile);
      }
    }

    // export const config = { … } — only if named config / defaultConfig
    if (ts.isVariableStatement(node)) {
      const isExported = node.modifiers?.some(
        (m) => m.kind === ts.SyntaxKind.ExportKeyword,
      );
      if (!isExported) return;
      for (const decl of node.declarationList.declarations) {
        if (
          ts.isIdentifier(decl.name) &&
          (decl.name.text === "config" ||
            decl.name.text === "defaultConfig" ||
            decl.name.text === "i18nUnusedConfig") &&
          decl.initializer
        ) {
          found = expressionToObject(decl.initializer, sourceFile) ?? found;
        }
      }
    }
  });

  return found;
}

function expressionToObject(
  expr: ts.Expression,
  sourceFile: ts.SourceFile,
): ts.ObjectLiteralExpression | undefined {
  const node = unwrap(expr);
  if (ts.isObjectLiteralExpression(node)) return node;
  if (ts.isIdentifier(node)) {
    return resolveLocalObject(sourceFile, node.text);
  }
  if (ts.isCallExpression(node) && node.arguments[0]) {
    return expressionToObject(node.arguments[0], sourceFile);
  }
  if (ts.isSatisfiesExpression(node) || ts.isAsExpression(node)) {
    return expressionToObject(node.expression, sourceFile);
  }
  return undefined;
}

function resolveLocalObject(
  sourceFile: ts.SourceFile,
  name: string,
): ts.ObjectLiteralExpression | undefined {
  let found: ts.ObjectLiteralExpression | undefined;
  traversalApi.forEachChild(sourceFile, (node) => {
    if (found) return;
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === name &&
      node.initializer
    ) {
      const init = unwrap(node.initializer);
      if (ts.isObjectLiteralExpression(init)) found = init;
    }
  });
  return found;
}

function objectLiteralToJsonValue(
  obj: ts.ObjectLiteralExpression,
  sourceFile: ts.SourceFile,
  diagnostics: ConfigDiagnostic[],
  path: string,
): unknown {
  const out: Record<string, unknown> = {};
  for (const prop of obj.properties) {
    if (ts.isSpreadAssignment(prop)) {
      diagnostics.push({
        code: "config-spread-skipped",
        severity: "warning",
        message: "Object spreads are not evaluated in config files",
        path,
        hint: "Inline properties statically instead of using ...spread",
      });
      continue;
    }
    if (!ts.isPropertyAssignment(prop)) continue;
    const key = propertyName(prop.name);
    if (key === undefined) continue;
    const value = expressionToValue(prop.initializer, sourceFile, diagnostics, path);
    if (value !== undefined) {
      out[key] = value;
    }
  }
  return out;
}

function expressionToValue(
  expr: ts.Expression,
  sourceFile: ts.SourceFile,
  diagnostics: ConfigDiagnostic[],
  path: string,
): unknown {
  const node = unwrap(expr);
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return node.text;
  }
  if (ts.isNumericLiteral(node)) {
    return Number(node.text);
  }
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (node.kind === ts.SyntaxKind.NullKeyword) return null;
  if (ts.isArrayLiteralExpression(node)) {
    const items: unknown[] = [];
    for (const el of node.elements) {
      if (ts.isSpreadElement(el)) {
        diagnostics.push({
          code: "config-spread-skipped",
          severity: "warning",
          message: "Array spreads are not evaluated in config files",
          path,
        });
        continue;
      }
      const value = expressionToValue(el, sourceFile, diagnostics, path);
      // Keep only statically resolved entries
      if (value !== undefined) {
        items.push(value);
      }
    }
    return items;
  }
  if (ts.isObjectLiteralExpression(node)) {
    return objectLiteralToJsonValue(node, sourceFile, diagnostics, path);
  }
  if (ts.isIdentifier(node)) {
    // Resolve file-local const string/array/object
    const resolved = resolveLocalValue(sourceFile, node.text);
    if (resolved !== undefined) return resolved;
  }

  diagnostics.push({
    code: "config-dynamic-value",
    severity: "warning",
    message: `Skipping non-static config expression: ${node.getText(sourceFile).slice(0, 40)}`,
    path,
    hint: "Use string/number/boolean/array/object literals only",
  });
  return undefined;
}

function resolveLocalValue(
  sourceFile: ts.SourceFile,
  name: string,
): unknown {
  let found: unknown;
  traversalApi.forEachChild(sourceFile, (node) => {
    if (found !== undefined) return;
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === name &&
      node.initializer
    ) {
      const init = unwrap(node.initializer);
      if (ts.isStringLiteral(init) || ts.isNoSubstitutionTemplateLiteral(init)) {
        found = init.text;
      } else if (ts.isArrayLiteralExpression(init)) {
        found = init.elements
          .filter((el): el is ts.Expression => !ts.isSpreadElement(el))
          .map((el) => {
            const u = unwrap(el);
            return ts.isStringLiteral(u) || ts.isNoSubstitutionTemplateLiteral(u)
              ? u.text
              : undefined;
          })
          .filter((x): x is string => x !== undefined);
      } else if (ts.isObjectLiteralExpression(init)) {
        // shallow — only for nested references; validation handles shape
        const o: Record<string, unknown> = {};
        for (const p of init.properties) {
          if (!ts.isPropertyAssignment(p)) continue;
          const k = propertyName(p.name);
          const v = unwrap(p.initializer);
          if (
            k &&
            (ts.isStringLiteral(v) || ts.isNoSubstitutionTemplateLiteral(v))
          ) {
            o[k] = v.text;
          }
        }
        found = o;
      }
    }
  });
  return found;
}

function propertyName(name: ts.PropertyName): string | undefined {
  if (
    ts.isIdentifier(name) ||
    ts.isStringLiteral(name) ||
    ts.isNumericLiteral(name)
  ) {
    return name.text;
  }
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
