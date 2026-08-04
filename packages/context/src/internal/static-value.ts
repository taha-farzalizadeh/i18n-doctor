/**
 * Static value extraction from AST expressions.
 * Never executes code — literals, arrays, simple object maps, and
 * file-local const aliases only.
 */

import { traversalApi } from "@i18n-doctor/ast";
import ts from "typescript";

export function unwrap(expr: ts.Expression): ts.Expression {
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

export function staticString(
  expr: ts.Expression | undefined,
  sourceFile?: ts.SourceFile,
): string | undefined {
  if (!expr) {
    return undefined;
  }
  const node = unwrap(expr);
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return node.text;
  }
  if (ts.isIdentifier(node) && sourceFile) {
    return resolveLocalConstString(sourceFile, node.text);
  }
  return undefined;
}

export function staticBoolean(
  expr: ts.Expression | undefined,
): boolean | undefined {
  if (!expr) return undefined;
  const node = unwrap(expr);
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
  return undefined;
}

export function staticStringArray(
  expr: ts.Expression | undefined,
  sourceFile?: ts.SourceFile,
): string[] | undefined {
  if (!expr) {
    return undefined;
  }
  const node = unwrap(expr);
  if (ts.isArrayLiteralExpression(node)) {
    const values: string[] = [];
    for (const el of node.elements) {
      if (ts.isSpreadElement(el)) {
        continue;
      }
      const s = staticString(el, sourceFile);
      if (s === undefined) {
        return undefined;
      }
      values.push(s);
    }
    return values;
  }
  if (ts.isIdentifier(node) && sourceFile) {
    const resolved = resolveLocalConstArray(sourceFile, node.text);
    if (resolved) return resolved;
  }
  const single = staticString(node, sourceFile);
  return single !== undefined ? [single] : undefined;
}

export function staticStringOrArray(
  expr: ts.Expression | undefined,
  sourceFile?: ts.SourceFile,
): string | readonly string[] | undefined {
  if (!expr) {
    return undefined;
  }
  const node = unwrap(expr);
  if (ts.isArrayLiteralExpression(node)) {
    return staticStringArray(node, sourceFile);
  }
  return staticString(node, sourceFile);
}

/** Object literal → Record<string, string> for locale inheritance maps. */
export function staticStringMap(
  expr: ts.Expression | undefined,
  sourceFile?: ts.SourceFile,
): Record<string, string> | undefined {
  if (!expr) {
    return undefined;
  }
  const node = unwrap(expr);
  if (!ts.isObjectLiteralExpression(node)) {
    return undefined;
  }
  const out: Record<string, string> = {};
  for (const prop of node.properties) {
    if (!ts.isPropertyAssignment(prop)) {
      continue;
    }
    const key = propertyNameText(prop.name);
    if (key === undefined) {
      continue;
    }
    const valueNode = unwrap(prop.initializer);
    // fallbackLng: { 'de-CH': ['de', 'en'] } → first parent
    if (ts.isArrayLiteralExpression(valueNode)) {
      const first = staticString(valueNode.elements[0], sourceFile);
      if (first !== undefined) {
        out[key] = first;
      }
      continue;
    }
    const value = staticString(valueNode, sourceFile);
    if (value !== undefined) {
      out[key] = value;
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

export function propertyNameText(
  name: ts.PropertyName,
): string | undefined {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }
  if (ts.isComputedPropertyName(name)) {
    return staticString(name.expression);
  }
  return undefined;
}

export function getObjectProperty(
  obj: ts.ObjectLiteralExpression,
  name: string,
): ts.Expression | undefined {
  for (const prop of obj.properties) {
    if (!ts.isPropertyAssignment(prop)) {
      continue;
    }
    if (propertyNameText(prop.name) === name) {
      return prop.initializer;
    }
  }
  return undefined;
}

export function findObjectPropertyDeep(
  obj: ts.ObjectLiteralExpression,
  names: readonly string[],
): ts.Expression | undefined {
  for (const name of names) {
    const direct = getObjectProperty(obj, name);
    if (direct) {
      return direct;
    }
  }
  // Nested under common wrappers: i18n / options / config
  for (const wrapper of ["i18n", "options", "config", "localePrefix"]) {
    const nested = getObjectProperty(obj, wrapper);
    if (nested && ts.isObjectLiteralExpression(unwrap(nested))) {
      const found = findObjectPropertyDeep(
        unwrap(nested) as ts.ObjectLiteralExpression,
        names,
      );
      if (found) {
        return found;
      }
    }
  }
  return undefined;
}

function resolveLocalConstArray(
  sourceFile: ts.SourceFile,
  name: string,
): string[] | undefined {
  let found: string[] | undefined;
  traversalApi.forEachChild(sourceFile, (node) => {
    if (found !== undefined) return;
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === name &&
      node.initializer
    ) {
      const init = unwrap(node.initializer);
      if (ts.isArrayLiteralExpression(init)) {
        found = staticStringArray(init, sourceFile);
      }
    }
    if (
      ts.isVariableStatement(node) &&
      (node.declarationList.flags & ts.NodeFlags.Const) !== 0
    ) {
      for (const decl of node.declarationList.declarations) {
        if (
          ts.isIdentifier(decl.name) &&
          decl.name.text === name &&
          decl.initializer
        ) {
          const init = unwrap(decl.initializer);
          if (ts.isArrayLiteralExpression(init)) {
            found = staticStringArray(init, sourceFile);
          }
        }
      }
    }
  });
  return found;
}

function resolveLocalConstString(
  sourceFile: ts.SourceFile,
  name: string,
): string | undefined {
  let found: string | undefined;
  traversalApi.forEachChild(sourceFile, (node) => {
    if (found !== undefined) {
      return;
    }
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === name &&
      node.initializer &&
      node.parent &&
      ts.isVariableDeclarationList(node.parent) &&
      (node.parent.flags & ts.NodeFlags.Const) !== 0
    ) {
      const init = unwrap(node.initializer);
      if (ts.isStringLiteral(init) || ts.isNoSubstitutionTemplateLiteral(init)) {
        found = init.text;
      }
    }
    // export const foo = "bar"
    if (
      ts.isVariableStatement(node) &&
      (node.declarationList.flags & ts.NodeFlags.Const) !== 0
    ) {
      for (const decl of node.declarationList.declarations) {
        if (
          ts.isIdentifier(decl.name) &&
          decl.name.text === name &&
          decl.initializer
        ) {
          const init = unwrap(decl.initializer);
          if (
            ts.isStringLiteral(init) ||
            ts.isNoSubstitutionTemplateLiteral(init)
          ) {
            found = init.text;
          }
        }
      }
    }
  });
  return found;
}

export function calleeName(expr: ts.Expression): string | undefined {
  const node = unwrap(expr);
  if (ts.isIdentifier(node)) {
    return node.text;
  }
  if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.name)) {
    return node.name.text;
  }
  return undefined;
}

export function rootCalleeObject(expr: ts.Expression): string | undefined {
  const node = unwrap(expr);
  if (ts.isPropertyAccessExpression(node)) {
    const left = unwrap(node.expression);
    if (ts.isIdentifier(left)) {
      return left.text;
    }
  }
  if (ts.isIdentifier(node)) {
    return node.text;
  }
  return undefined;
}
