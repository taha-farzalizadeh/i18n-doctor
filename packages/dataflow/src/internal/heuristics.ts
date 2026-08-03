import ts from "typescript";

/** Callees whose first argument is treated as a translation key site. */
const KEY_CALLEES = new Set([
  "t",
  "$t",
  "formatMessage",
  "msg",
  "i18n",
]);

const KEY_MEMBER_PROPS = new Set(["t", "$t", "formatMessage"]);

/**
 * True when a call expression is a plausible translation key usage site.
 * Used by analyzeFile to avoid treating wrapper args (`translate("auth")`)
 * as keys themselves.
 */
export function isTranslationKeyCallee(expression: ts.Expression): boolean {
  const expr = unwrap(expression);
  if (ts.isIdentifier(expr)) {
    return KEY_CALLEES.has(expr.text);
  }
  if (ts.isPropertyAccessExpression(expr) && ts.isIdentifier(expr.name)) {
    return KEY_MEMBER_PROPS.has(expr.name.text);
  }
  // useTranslation().t(...)
  if (
    ts.isPropertyAccessExpression(expr) &&
    ts.isIdentifier(expr.name) &&
    KEY_MEMBER_PROPS.has(expr.name.text) &&
    ts.isCallExpression(unwrap(expr.expression))
  ) {
    return true;
  }
  return false;
}

const USER_INPUT_NAMES = new Set([
  "input",
  "userInput",
  "user_input",
  "search",
  "query",
  "searchQuery",
  "formValue",
  "formData",
  "req",
  "request",
  "body",
  "params",
  "argv",
  "process",
]);

const USER_INPUT_MEMBERS = new Set([
  "value",
  "text",
  "innerText",
  "textContent",
  "target",
  "currentTarget",
  "data",
  "payload",
  "query",
  "body",
  "params",
  "searchParams",
]);

/**
 * Conservative detection of expressions that depend on user/runtime input.
 * These must never invent keys.
 */
export function isUserInputExpression(expr: ts.Expression): boolean {
  const e = unwrap(expr);
  if (ts.isIdentifier(e)) {
    return USER_INPUT_NAMES.has(e.text);
  }
  if (ts.isPropertyAccessExpression(e)) {
    if (ts.isIdentifier(e.name) && USER_INPUT_MEMBERS.has(e.name.text)) {
      return true;
    }
    return isUserInputExpression(e.expression);
  }
  if (ts.isElementAccessExpression(e)) {
    return isUserInputExpression(e.expression);
  }
  if (ts.isCallExpression(e)) {
    const callee = unwrap(e.expression);
    if (ts.isIdentifier(callee)) {
      const n = callee.text;
      if (
        /^(get|read|fetch|prompt|ask)/i.test(n) ||
        n === "prompt" ||
        n === "confirm"
      ) {
        return true;
      }
    }
    if (
      ts.isPropertyAccessExpression(callee) &&
      ts.isIdentifier(callee.name)
    ) {
      if (
        /^(get|read|fetch)/i.test(callee.name.text) ||
        callee.name.text === "getItem"
      ) {
        return true;
      }
    }
  }
  return false;
}

/** Builtins / non-key APIs — skip param-flow collection. */
export function isIgnoredParamFlowCallee(name: string): boolean {
  return IGNORED_PARAM_FLOW.has(name);
}

const IGNORED_PARAM_FLOW = new Set([
  "console",
  "require",
  "fetch",
  "setTimeout",
  "setInterval",
  "Boolean",
  "Number",
  "String",
  "Object",
  "Array",
  "Error",
  "Promise",
  "parseInt",
  "parseFloat",
  "encodeURIComponent",
  "decodeURIComponent",
  "JSON",
  "Math",
  "Date",
  "Map",
  "Set",
  "WeakMap",
  "WeakSet",
]);

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
