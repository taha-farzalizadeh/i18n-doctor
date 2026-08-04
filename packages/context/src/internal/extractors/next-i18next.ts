/**
 * Extract next-i18next.config.* module.exports / export default.
 */

import { traversalApi } from "@i18n-unused/ast";
import ts from "typescript";
import {
  findObjectPropertyDeep,
  staticString,
  staticStringArray,
  unwrap,
} from "../static-value.js";
import { optionsToDraft } from "./i18next.js";
import {
  type ConfigDraft,
  hasAnySetting,
  normalizeLocaleToken,
} from "./shared.js";

export function extractNextI18nextConfigs(
  sourceFile: ts.SourceFile,
  options?: { filename?: string },
): ConfigDraft[] {
  const base = options?.filename ?? "";
  // Only parse files that look like next-i18next config (avoid false positives)
  if (base && !base.startsWith("next-i18next.config")) {
    return [];
  }

  const drafts: ConfigDraft[] = [];
  const roots = findExportedObjects(sourceFile);

  for (const obj of roots) {
    const draft = optionsToDraft(
      obj,
      sourceFile,
      "next-i18next",
      "next-i18next.config",
      "next-i18next",
      0.92,
    );

    // next-i18next nests locales under `i18n: { defaultLocale, locales }`
    const i18nProp = findObjectPropertyDeep(obj, ["i18n"]);
    let enriched = draft;
    if (i18nProp && ts.isObjectLiteralExpression(unwrap(i18nProp))) {
      const i18nObj = unwrap(i18nProp) as ts.ObjectLiteralExpression;
      const defaultLocale = staticString(
        findObjectPropertyDeep(i18nObj, ["defaultLocale"]),
        sourceFile,
      );
      const locales = staticStringArray(
        findObjectPropertyDeep(i18nObj, ["locales"]),
        sourceFile,
      );
      enriched = {
        ...draft,
        ...(defaultLocale !== undefined && draft.defaultLocale === undefined
          ? { defaultLocale: normalizeLocaleToken(defaultLocale) }
          : {}),
        ...(locales !== undefined && draft.supportedLocales === undefined
          ? { supportedLocales: locales.map(normalizeLocaleToken) }
          : {}),
        evidence: [...draft.evidence, "next-i18next.i18n"],
      };
    }

    if (hasAnySetting(enriched)) {
      drafts.push(enriched);
    }
  }

  return drafts;
}

function findExportedObjects(
  sourceFile: ts.SourceFile,
): ts.ObjectLiteralExpression[] {
  const out: ts.ObjectLiteralExpression[] = [];

  traversalApi.forEachChild(sourceFile, (node) => {
    // module.exports = { ... }
    if (
      ts.isExpressionStatement(node) &&
      ts.isBinaryExpression(node.expression) &&
      node.expression.operatorToken.kind === ts.SyntaxKind.EqualsToken
    ) {
      const left = unwrap(node.expression.left);
      const right = unwrap(node.expression.right);
      if (
        ts.isPropertyAccessExpression(left) &&
        ts.isIdentifier(left.expression) &&
        left.expression.text === "module" &&
        left.name.text === "exports" &&
        ts.isObjectLiteralExpression(right)
      ) {
        out.push(right);
      }
      // exports.default = { ... } / module.exports.default
      if (
        ts.isPropertyAccessExpression(left) &&
        left.name.text === "default" &&
        ts.isObjectLiteralExpression(right)
      ) {
        out.push(right);
      }
    }

    // export default { ... }
    if (ts.isExportAssignment(node) && !node.isExportEquals) {
      const expr = unwrap(node.expression);
      if (ts.isObjectLiteralExpression(expr)) {
        out.push(expr);
      } else if (ts.isIdentifier(expr)) {
        const resolved = resolveLocalObject(sourceFile, expr.text);
        if (resolved) {
          out.push(resolved);
        }
      }
    }

    // export default defineConfig({ ... }) / export default () => ({...})
    if (ts.isExportAssignment(node) && !node.isExportEquals) {
      const expr = unwrap(node.expression);
      if (ts.isCallExpression(expr) && expr.arguments[0]) {
        const arg = unwrap(expr.arguments[0]);
        if (ts.isObjectLiteralExpression(arg)) {
          out.push(arg);
        }
      }
      if (ts.isArrowFunction(expr) || ts.isFunctionExpression(expr)) {
        const body = expr.body;
        if (ts.isObjectLiteralExpression(body)) {
          out.push(body);
        } else if (ts.isParenthesizedExpression(body)) {
          const inner = unwrap(body);
          if (ts.isObjectLiteralExpression(inner)) {
            out.push(inner);
          }
        } else if (ts.isBlock(body)) {
          for (const stmt of body.statements) {
            if (ts.isReturnStatement(stmt) && stmt.expression) {
              const ret = unwrap(stmt.expression);
              if (ts.isObjectLiteralExpression(ret)) {
                out.push(ret);
              }
            }
          }
        }
      }
    }
  });

  return out;
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
      if (ts.isObjectLiteralExpression(init)) {
        found = init;
      }
    }
  });
  return found;
}
