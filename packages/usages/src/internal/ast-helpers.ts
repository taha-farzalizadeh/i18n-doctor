import ts from "typescript";
import type { EnumValueIndex } from "./enum-values.js";
import { resolveEnumMemberString } from "./enum-values.js";

export interface StaticKeyOptions {
  readonly relativePath?: string;
  readonly enumIndex?: EnumValueIndex;
}

/**
 * Statically resolve every translation key an expression can evaluate to.
 * Supports everything {@link staticStringKey} does, plus:
 * - `cond ? "A" : "B"` → both keys when each branch is static
 * - same-file `const k = cond ? "A" : "B"` followed by `t(k)`
 * - string enum members: `WpNavbar.SENSITIVE_TERMS` → `"SENSITIVE_TERMS"`
 *
 * Returns an empty array for anything partially dynamic
 * (e.g. `"HELLO_" + suffix`, or a ternary with a dynamic branch).
 */
export function staticStringKeys(
  node: ts.Expression | undefined,
  sourceFile?: ts.SourceFile,
  seen: Set<ts.Node> = new Set(),
  options?: StaticKeyOptions,
): readonly string[] {
  if (!node) {
    return [];
  }
  if (seen.has(node)) {
    return [];
  }
  seen.add(node);

  if (
    ts.isAsExpression(node) ||
    ts.isSatisfiesExpression(node) ||
    ts.isParenthesizedExpression(node)
  ) {
    return staticStringKeys(node.expression, sourceFile, seen, options);
  }

  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return [node.text];
  }

  if (
    ts.isBinaryExpression(node) &&
    node.operatorToken.kind === ts.SyntaxKind.PlusToken
  ) {
    const left = staticStringKeys(node.left, sourceFile, seen, options);
    const right = staticStringKeys(node.right, sourceFile, seen, options);
    if (left.length === 1 && right.length === 1) {
      return [left[0]! + right[0]!];
    }
    return [];
  }

  if (ts.isTemplateExpression(node)) {
    let out = node.head.text;
    for (const span of node.templateSpans) {
      const part = staticStringKeys(span.expression, sourceFile, seen, options);
      if (part.length !== 1) {
        return [];
      }
      out += part[0]! + span.literal.text;
    }
    return [out];
  }

  if (ts.isConditionalExpression(node)) {
    const whenTrue = staticStringKeys(
      node.whenTrue,
      sourceFile,
      new Set(seen),
      options,
    );
    const whenFalse = staticStringKeys(
      node.whenFalse,
      sourceFile,
      new Set(seen),
      options,
    );
    if (whenTrue.length === 0 || whenFalse.length === 0) {
      return [];
    }
    return uniqueStrings([...whenTrue, ...whenFalse]);
  }

  if (sourceFile) {
    const enumValue = resolveEnumMemberString(
      node,
      sourceFile,
      options?.relativePath,
      options?.enumIndex,
    );
    if (enumValue !== undefined) {
      return [enumValue];
    }
  }

  if (ts.isIdentifier(node) && sourceFile) {
    return resolveConstStringBindings(node, sourceFile, seen, options);
  }

  return [];
}

/**
 * Statically resolve a single translation-key expression.
 * Returns undefined when the expression is dynamic or expands to multiple keys
 * (e.g. a ternary with two static branches — use {@link staticStringKeys}).
 */
export function staticStringKey(
  node: ts.Expression | undefined,
  sourceFile?: ts.SourceFile,
  seen: Set<ts.Node> = new Set(),
): string | undefined {
  const keys = staticStringKeys(node, sourceFile, seen);
  return keys.length === 1 ? keys[0] : undefined;
}

export interface StaticKeyFragments {
  readonly prefixes: readonly string[];
  readonly suffixes: readonly string[];
  readonly contains: readonly string[];
}

/**
 * Extract known static pieces from a key expression that cannot be fully
 * resolved (e.g. `"HELLO_" + suffix` → prefix `HELLO_`).
 * Used to soften unused-key findings that may still be covered at runtime.
 */
export function staticKeyFragments(
  node: ts.Expression | undefined,
  sourceFile?: ts.SourceFile,
  seen: Set<ts.Node> = new Set(),
): StaticKeyFragments {
  const prefixes: string[] = [];
  const suffixes: string[] = [];
  const contains: string[] = [];

  const add = (list: string[], value: string | undefined): void => {
    if (value && value.length > 0 && !list.includes(value)) {
      list.push(value);
    }
  };

  const walk = (expr: ts.Expression | undefined): void => {
    if (!expr || seen.has(expr)) {
      return;
    }
    seen.add(expr);

    if (
      ts.isAsExpression(expr) ||
      ts.isSatisfiesExpression(expr) ||
      ts.isParenthesizedExpression(expr)
    ) {
      walk(expr.expression);
      return;
    }

    const fully = staticStringKeys(expr, sourceFile, new Set(seen));
    if (fully.length > 0) {
      for (const key of fully) add(contains, key);
      return;
    }

    if (ts.isIdentifier(expr) && sourceFile) {
      const initializer = findConstInitializer(expr, sourceFile);
      if (initializer) {
        walk(initializer);
      }
      return;
    }

    if (
      ts.isBinaryExpression(expr) &&
      expr.operatorToken.kind === ts.SyntaxKind.PlusToken
    ) {
      const left = staticStringKey(expr.left, sourceFile, new Set(seen));
      const right = staticStringKey(expr.right, sourceFile, new Set(seen));
      if (left !== undefined && right === undefined) {
        add(prefixes, left);
        walk(expr.right);
        return;
      }
      if (right !== undefined && left === undefined) {
        add(suffixes, right);
        walk(expr.left);
        return;
      }
      walk(expr.left);
      walk(expr.right);
      return;
    }

    if (ts.isTemplateExpression(expr)) {
      add(prefixes, expr.head.text || undefined);
      for (let i = 0; i < expr.templateSpans.length; i++) {
        const span = expr.templateSpans[i]!;
        const hole = staticStringKey(span.expression, sourceFile, new Set(seen));
        if (hole !== undefined) {
          add(contains, hole);
        } else {
          walk(span.expression);
        }
        const lit = span.literal.text;
        if (!lit) {
          continue;
        }
        if (i === expr.templateSpans.length - 1) {
          add(suffixes, lit);
        } else {
          add(contains, lit);
        }
      }
      return;
    }

    if (ts.isConditionalExpression(expr)) {
      walk(expr.whenTrue);
      walk(expr.whenFalse);
    }
  };

  walk(node);
  return { prefixes, suffixes, contains };
}

/**
 * Resolve `const name = <static string expr>` declared before `id` in the same file.
 * Supports multi-key initializers (ternaries). Innermost / latest declaration wins.
 */
function resolveConstStringBindings(
  id: ts.Identifier,
  sourceFile: ts.SourceFile,
  seen: Set<ts.Node>,
  options?: StaticKeyOptions,
): readonly string[] {
  const name = id.text;
  const usePos = id.getStart(sourceFile);
  let best: { declPos: number; values: readonly string[] } | undefined;

  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === name &&
      node.initializer
    ) {
      const list = node.parent;
      const stmt = list?.parent;
      const isConst =
        list &&
        ts.isVariableDeclarationList(list) &&
        (list.flags & ts.NodeFlags.Const) !== 0;
      if (
        isConst &&
        stmt &&
        ts.isVariableStatement(stmt) &&
        node.name.getStart(sourceFile) < usePos
      ) {
        const values = staticStringKeys(
          node.initializer,
          sourceFile,
          new Set(seen),
          options,
        );
        if (values.length > 0) {
          const declPos = node.name.getStart(sourceFile);
          if (!best || declPos >= best.declPos) {
            best = { declPos, values };
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return best?.values ?? [];
}

/** Same-file `const` initializer for an identifier, if any. */
function findConstInitializer(
  id: ts.Identifier,
  sourceFile: ts.SourceFile,
): ts.Expression | undefined {
  const name = id.text;
  const usePos = id.getStart(sourceFile);
  let best: { declPos: number; initializer: ts.Expression } | undefined;

  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === name &&
      node.initializer
    ) {
      const list = node.parent;
      const stmt = list?.parent;
      const isConst =
        list &&
        ts.isVariableDeclarationList(list) &&
        (list.flags & ts.NodeFlags.Const) !== 0;
      if (
        isConst &&
        stmt &&
        ts.isVariableStatement(stmt) &&
        node.name.getStart(sourceFile) < usePos
      ) {
        const declPos = node.name.getStart(sourceFile);
        if (!best || declPos >= best.declPos) {
          best = { declPos, initializer: node.initializer };
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return best?.initializer;
}

function uniqueStrings(values: readonly string[]): readonly string[] {
  const out: string[] = [];
  for (const value of values) {
    if (!out.includes(value)) out.push(value);
  }
  return out;
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
  sourceFile?: ts.SourceFile,
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
    const key = staticStringKey(prop.initializer, sourceFile);
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
  sourceFile?: ts.SourceFile,
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
      const key = staticStringKey(attr.initializer.expression, sourceFile);
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
