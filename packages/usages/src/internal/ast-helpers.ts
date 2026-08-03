import ts from "typescript";

/** Static string key from a call/JSX argument. No constant folding. */
export function staticStringKey(
  node: ts.Expression | undefined,
): string | undefined {
  if (!node) {
    return undefined;
  }
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return node.text;
  }
  return undefined;
}

export function calleeIdentifier(expr: ts.Expression): string | undefined {
  if (ts.isIdentifier(expr)) {
    return expr.text;
  }
  return undefined;
}

export function memberAccess(
  expr: ts.Expression,
): { object: string; property: string } | undefined {
  if (!ts.isPropertyAccessExpression(expr)) {
    return undefined;
  }
  if (!ts.isIdentifier(expr.expression) || !ts.isIdentifier(expr.name)) {
    return undefined;
  }
  return { object: expr.expression.text, property: expr.name.text };
}

/**
 * True when expression is a property access chain ending in `.t` or `.$t`
 * e.g. i18n.t, i18n.global.t, this.$t
 */
export function endsWithProperty(
  expr: ts.Expression,
  property: string,
): boolean {
  return (
    ts.isPropertyAccessExpression(expr) &&
    ts.isIdentifier(expr.name) &&
    expr.name.text === property
  );
}

/** Root identifier of a property access chain, if any. */
export function rootIdentifier(expr: ts.Expression): string | undefined {
  let current: ts.Expression = expr;
  while (ts.isPropertyAccessExpression(current)) {
    current = current.expression;
  }
  if (ts.isIdentifier(current)) {
    return current.text;
  }
  if (
    current.kind === ts.SyntaxKind.ThisKeyword ||
    current.kind === ts.SyntaxKind.SuperKeyword
  ) {
    return "this";
  }
  return undefined;
}

/** formatMessage({ id: "key" }) → key node + text */
export function idFromObjectLiteral(
  expr: ts.Expression | undefined,
): { key: string; node: ts.Node } | undefined {
  if (!expr || !ts.isObjectLiteralExpression(expr)) {
    return undefined;
  }
  for (const prop of expr.properties) {
    if (!ts.isPropertyAssignment(prop)) {
      continue;
    }
    const name = ts.isIdentifier(prop.name)
      ? prop.name.text
      : ts.isStringLiteral(prop.name)
        ? prop.name.text
        : undefined;
    if (name !== "id") {
      continue;
    }
    const key = staticStringKey(prop.initializer);
    if (key !== undefined) {
      return { key, node: prop.initializer };
    }
  }
  return undefined;
}

export function jsxTagName(
  node: ts.JsxOpeningElement | ts.JsxSelfClosingElement,
): string {
  return node.tagName.getText();
}

export function jsxAttributeValue(
  element: ts.JsxOpeningElement | ts.JsxSelfClosingElement,
  attrName: string,
): { key: string; node: ts.Node } | undefined {
  for (const attr of element.attributes.properties) {
    if (!ts.isJsxAttribute(attr) || !ts.isIdentifier(attr.name)) {
      continue;
    }
    if (attr.name.text !== attrName || !attr.initializer) {
      continue;
    }
    if (ts.isStringLiteral(attr.initializer)) {
      return { key: attr.initializer.text, node: attr.initializer };
    }
    if (ts.isJsxExpression(attr.initializer) && attr.initializer.expression) {
      const key = staticStringKey(attr.initializer.expression);
      if (key !== undefined) {
        return { key, node: attr.initializer.expression };
      }
    }
  }
  return undefined;
}

/** Enclosing block/function scope end position for a declaration. */
export function enclosingScopeEnd(node: ts.Node): number {
  let current: ts.Node | undefined = node.parent;
  while (current) {
    if (
      ts.isFunctionDeclaration(current) ||
      ts.isFunctionExpression(current) ||
      ts.isArrowFunction(current) ||
      ts.isMethodDeclaration(current) ||
      ts.isConstructorDeclaration(current) ||
      ts.isModuleBlock(current) ||
      ts.isSourceFile(current)
    ) {
      return current.end;
    }
    if (ts.isBlock(current) && current.parent && ts.isFunctionLike(current.parent)) {
      return current.end;
    }
    current = current.parent;
  }
  return node.getSourceFile().end;
}
