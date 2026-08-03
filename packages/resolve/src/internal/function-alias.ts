import ts from "typescript";
import type { AliasTarget, FunctionAlias } from "../api/types.js";
import { locationOf } from "./location.js";
import type { ScopeTable } from "./scopes.js";

const WRAPPER_CONFIDENCE = 0.75;
const WRAPPER_MEMBER_PROPS = new Set(["t", "$t"]);

export interface FunctionAliasDetectorOptions {
  readonly seedIdentifiers: ReadonlySet<string>;
  readonly seedMembers: ReadonlySet<string>;
}

/**
 * Detect simple key-forwarding wrappers in one file:
 *   const tr = (key) => t(key)
 *   const tr = (key) => t(key, opts)
 *   function tr(key) { return t(key); }
 *
 * Rejects non-i18n callees (`fetch`, `console.log`, …) to avoid false positives.
 * No data-flow beyond a single return / expression body.
 */
export function detectFunctionAliases(
  sourceFile: ts.SourceFile,
  scopes: ScopeTable,
  options: FunctionAliasDetectorOptions,
): FunctionAlias[] {
  const found: FunctionAlias[] = [];

  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      node.initializer &&
      ts.isIdentifier(node.name)
    ) {
      const fn = unwrap(node.initializer);
      if (isFunctionLike(fn)) {
        const alias = analyzeWrapper(
          fn,
          node.name,
          sourceFile,
          scopes,
          options,
        );
        if (alias) {
          found.push(alias);
        }
      }
    }
    if (ts.isFunctionDeclaration(node) && node.name && node.body) {
      const alias = analyzeWrapper(
        node,
        node.name,
        sourceFile,
        scopes,
        options,
      );
      if (alias) {
        found.push(alias);
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  // Deterministic order
  found.sort((a, b) => a.declPos - b.declPos || a.name.localeCompare(b.name));
  return found;
}

function analyzeWrapper(
  fn: ts.FunctionLikeDeclaration,
  nameNode: ts.Identifier,
  sourceFile: ts.SourceFile,
  scopes: ScopeTable,
  options: FunctionAliasDetectorOptions,
): FunctionAlias | undefined {
  const params = fn.parameters;
  if (params.length < 1) {
    return undefined;
  }
  const first = params[0]!;
  if (!ts.isIdentifier(first.name)) {
    return undefined;
  }
  // Reject defaults / rest / optional — keep wrappers trivial.
  if (first.initializer || first.dotDotDotToken || first.questionToken) {
    return undefined;
  }

  const paramName = first.name.text;
  const call = extractForwardingCall(fn, paramName);
  if (!call) {
    return undefined;
  }

  // Disallow spread / extra positional complexity beyond optional 2nd+ args.
  if (call.arguments.some((arg) => ts.isSpreadElement(arg))) {
    return undefined;
  }

  const target = calleeTarget(call.expression);
  if (!target || target.type === "unresolved") {
    return undefined;
  }
  if (!isPlausibleI18nCallee(target, options)) {
    return undefined;
  }

  const declPos = nameNode.getStart(sourceFile);
  const scope = scopes.declarationScope(nameNode, sourceFile, {
    isVar: false,
  });

  return {
    name: nameNode.text,
    target,
    location: locationOf(sourceFile, nameNode),
    declPos,
    scopeId: scope.id,
    confidence: WRAPPER_CONFIDENCE,
    parameterName: paramName,
  };
}

/**
 * Only accept wrappers that forward into known i18n seeds / `.t` members.
 * Local alias identifiers (e.g. `translate`) are allowed so
 * `const tr = (k) => translate(k)` still works when translate → t.
 */
function isPlausibleI18nCallee(
  target: AliasTarget,
  options: FunctionAliasDetectorOptions,
): boolean {
  if (target.type === "name") {
    if (options.seedIdentifiers.has(target.name)) {
      return true;
    }
    // Allow non-seed identifiers (local aliases). Reject obvious builtins.
    return !REJECTED_CALLEES.has(target.name);
  }
  if (target.type === "member") {
    const id = `${target.object}.${target.property}`;
    if (options.seedMembers.has(id)) {
      return true;
    }
    return WRAPPER_MEMBER_PROPS.has(target.property);
  }
  return false;
}

const REJECTED_CALLEES = new Set([
  "fetch",
  "require",
  "eval",
  "setTimeout",
  "setInterval",
  "queueMicrotask",
  "requestAnimationFrame",
  "parseInt",
  "parseFloat",
  "Number",
  "String",
  "Boolean",
  "JSON",
  "console",
  "Math",
  "Object",
  "Array",
  "Promise",
  "Error",
  "Map",
  "Set",
  "WeakMap",
  "WeakSet",
  "Proxy",
  "Reflect",
  "decodeURI",
  "encodeURI",
  "decodeURIComponent",
  "encodeURIComponent",
  "isNaN",
  "isFinite",
  "alert",
  "confirm",
  "prompt",
]);

function extractForwardingCall(
  fn: ts.FunctionLikeDeclaration,
  paramName: string,
): ts.CallExpression | undefined {
  if (ts.isArrowFunction(fn) && !ts.isBlock(fn.body)) {
    return matchForwardCall(fn.body, paramName);
  }
  const body = fn.body;
  if (!body || !ts.isBlock(body)) {
    return undefined;
  }
  const stmts = body.statements.filter((s) => !ts.isEmptyStatement(s));
  if (stmts.length !== 1) {
    return undefined;
  }
  const only = stmts[0]!;
  if (!ts.isReturnStatement(only) || !only.expression) {
    return undefined;
  }
  return matchForwardCall(only.expression, paramName);
}

function matchForwardCall(
  expr: ts.Expression,
  paramName: string,
): ts.CallExpression | undefined {
  const call = unwrap(expr);
  if (!ts.isCallExpression(call) || call.arguments.length < 1) {
    return undefined;
  }
  const firstArg = unwrap(call.arguments[0]!);
  if (!ts.isIdentifier(firstArg) || firstArg.text !== paramName) {
    return undefined;
  }
  return call;
}

function calleeTarget(expr: ts.Expression): AliasTarget | undefined {
  const inner = unwrap(expr);
  if (ts.isIdentifier(inner)) {
    return { type: "name", name: inner.text };
  }
  if (
    ts.isPropertyAccessExpression(inner) &&
    ts.isIdentifier(inner.expression) &&
    ts.isIdentifier(inner.name)
  ) {
    return {
      type: "member",
      object: inner.expression.text,
      property: inner.name.text,
    };
  }
  return undefined;
}

function isFunctionLike(node: ts.Node): node is ts.FunctionLikeDeclaration {
  return (
    ts.isArrowFunction(node) ||
    ts.isFunctionExpression(node) ||
    ts.isFunctionDeclaration(node)
  );
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
