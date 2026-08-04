/**
 * Extract Next.js `i18n: { defaultLocale, locales }` from next.config.*.
 */

import { traversalApi } from "@i18n-doctor/ast";
import ts from "typescript";
import { locationOf } from "../location.js";
import {
  findObjectPropertyDeep,
  staticString,
  staticStringArray,
  unwrap,
} from "../static-value.js";
import {
  type ConfigDraft,
  hasAnySetting,
  normalizeLocaleToken,
} from "./shared.js";

export function extractNextConfig(
  sourceFile: ts.SourceFile,
): ConfigDraft[] {
  const drafts: ConfigDraft[] = [];
  const objects = collectConfigObjects(sourceFile);

  for (const obj of objects) {
    const i18nProp = findObjectPropertyDeep(obj, ["i18n"]);
    if (!i18nProp) {
      continue;
    }
    const i18nObj = unwrap(i18nProp);
    if (!ts.isObjectLiteralExpression(i18nObj)) {
      continue;
    }

    const defaultLocale = staticString(
      findObjectPropertyDeep(i18nObj, ["defaultLocale"]),
      sourceFile,
    );
    const locales = staticStringArray(
      findObjectPropertyDeep(i18nObj, ["locales"]),
      sourceFile,
    );

    const draft: ConfigDraft = {
      kind: "next-config",
      library: "unknown",
      confidence: 0.88,
      ...(defaultLocale !== undefined
        ? { defaultLocale: normalizeLocaleToken(defaultLocale) }
        : {}),
      ...(locales !== undefined
        ? { supportedLocales: locales.map(normalizeLocaleToken) }
        : {}),
      evidence: ["next.config.i18n"],
      location: locationOf(sourceFile, i18nObj),
    };

    if (hasAnySetting(draft)) {
      drafts.push(draft);
    }
  }

  return drafts;
}

function collectConfigObjects(
  sourceFile: ts.SourceFile,
): ts.ObjectLiteralExpression[] {
  const out: ts.ObjectLiteralExpression[] = [];

  const pushObject = (expr: ts.Expression | undefined): void => {
    if (!expr) return;
    const node = unwrap(expr);
    if (ts.isObjectLiteralExpression(node)) {
      out.push(node);
      return;
    }
    if (ts.isCallExpression(node)) {
      // withNextIntl(nextConfig) / defineConfig({...}) / plugin wrappers
      for (const arg of node.arguments) {
        pushObject(arg);
      }
      // withX({...})( {...} ) — rare
      return;
    }
    if (ts.isIdentifier(node)) {
      const resolved = resolveLocalObject(sourceFile, node.text);
      if (resolved) out.push(resolved);
    }
  };

  traversalApi.forEachChild(sourceFile, (node) => {
    if (ts.isExportAssignment(node) && !node.isExportEquals) {
      pushObject(node.expression);
    }
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
        pushObject(node.expression.right);
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
