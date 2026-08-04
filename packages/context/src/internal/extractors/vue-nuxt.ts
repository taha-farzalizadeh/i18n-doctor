/**
 * Extract vue-i18n createI18n() and nuxt-i18n / i18n.config settings.
 */

import { traversalApi } from "@i18n-doctor/ast";
import ts from "typescript";
import { locationOf } from "../location.js";
import {
  calleeName,
  findObjectPropertyDeep,
  staticString,
  staticStringArray,
  staticStringMap,
  staticStringOrArray,
  unwrap,
} from "../static-value.js";
import {
  type ConfigDraft,
  hasAnySetting,
  normalizeLocaleToken,
  normalizeLocaleValue,
} from "./shared.js";

export function extractVueI18nConfigs(
  sourceFile: ts.SourceFile,
): ConfigDraft[] {
  const drafts: ConfigDraft[] = [];

  traversalApi.forEachChild(sourceFile, (node) => {
    if (!ts.isCallExpression(node) || node.arguments.length === 0) {
      return;
    }
    const name = calleeName(node.expression);
    if (name !== "createI18n") {
      return;
    }
    const arg = unwrap(node.arguments[0]!);
    if (!ts.isObjectLiteralExpression(arg)) {
      return;
    }

    const locale = staticString(
      findObjectPropertyDeep(arg, ["locale"]),
      sourceFile,
    );
    const fallbackLocale = staticStringOrArray(
      findObjectPropertyDeep(arg, ["fallbackLocale"]),
      sourceFile,
    );
    const fallbackExpr = findObjectPropertyDeep(arg, ["fallbackLocale"]);
    let localeInheritance: Record<string, string> | undefined;
    if (fallbackExpr && ts.isObjectLiteralExpression(unwrap(fallbackExpr))) {
      const raw = staticStringMap(unwrap(fallbackExpr), sourceFile);
      if (raw) {
        localeInheritance = Object.fromEntries(
          Object.entries(raw)
            .filter(([k]) => k !== "default")
            .map(([k, v]) => [
              normalizeLocaleToken(k),
              normalizeLocaleToken(v),
            ]),
        );
      }
    }

    const messages = findObjectPropertyDeep(arg, ["messages"]);
    let supported: string[] | undefined;
    if (messages && ts.isObjectLiteralExpression(unwrap(messages))) {
      supported = [];
      for (const prop of (unwrap(messages) as ts.ObjectLiteralExpression)
        .properties) {
        if (!ts.isPropertyAssignment(prop)) continue;
        const key =
          ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name)
            ? prop.name.text
            : undefined;
        if (key) supported.push(normalizeLocaleToken(key));
      }
    }

    const draft: ConfigDraft = {
      kind: "vue-i18n",
      library: "vue-i18n",
      confidence: 0.9,
      ...(locale !== undefined
        ? { defaultLocale: normalizeLocaleToken(locale) }
        : {}),
      ...(fallbackLocale !== undefined
        ? { fallbackLocale: normalizeLocaleValue(fallbackLocale) }
        : {}),
      ...(supported !== undefined && supported.length > 0
        ? { supportedLocales: supported }
        : {}),
      ...(localeInheritance !== undefined ? { localeInheritance } : {}),
      evidence: ["vue-i18n.createI18n()"],
      location: locationOf(sourceFile, arg),
    };

    if (hasAnySetting(draft)) {
      drafts.push(draft);
    }
  });

  return drafts;
}

export function extractNuxtI18nConfigs(
  sourceFile: ts.SourceFile,
): ConfigDraft[] {
  const drafts: ConfigDraft[] = [];
  const objects = collectExportedObjects(sourceFile);

  for (const obj of objects) {
    // nuxt.config: modules + i18n: { ... } OR top-level i18n key
    const i18nProp = findObjectPropertyDeep(obj, ["i18n"]);
    const target =
      i18nProp && ts.isObjectLiteralExpression(unwrap(i18nProp))
        ? (unwrap(i18nProp) as ts.ObjectLiteralExpression)
        : obj;

    const defaultLocale = staticString(
      findObjectPropertyDeep(target, ["defaultLocale", "locale"]),
      sourceFile,
    );
    const localesExpr = findObjectPropertyDeep(target, ["locales"]);
    let supported: string[] | undefined;
    if (localesExpr) {
      const unwrapped = unwrap(localesExpr);
      if (ts.isArrayLiteralExpression(unwrapped)) {
        supported = [];
        for (const el of unwrapped.elements) {
          if (ts.isSpreadElement(el)) continue;
          const s = staticString(el, sourceFile);
          if (s !== undefined) {
            supported.push(normalizeLocaleToken(s));
            continue;
          }
          const objEl = unwrap(el);
          if (ts.isObjectLiteralExpression(objEl)) {
            const code = staticString(
              findObjectPropertyDeep(objEl, ["code", "iso", "language"]),
              sourceFile,
            );
            if (code) supported.push(normalizeLocaleToken(code));
          }
        }
        if (supported.length === 0) supported = undefined;
      } else {
        supported = staticStringArray(unwrapped, sourceFile)?.map(
          normalizeLocaleToken,
        );
      }
    }

    const strategy = staticString(
      findObjectPropertyDeep(target, ["strategy"]),
      sourceFile,
    );

    const draft: ConfigDraft = {
      kind: "nuxt-i18n",
      library: "nuxt-i18n",
      confidence: i18nProp ? 0.9 : 0.7,
      ...(defaultLocale !== undefined
        ? { defaultLocale: normalizeLocaleToken(defaultLocale) }
        : {}),
      ...(supported !== undefined ? { supportedLocales: supported } : {}),
      evidence: [
        i18nProp ? "nuxt.i18n" : "i18n.config",
        ...(strategy !== undefined ? [`strategy=${strategy}`] : []),
      ],
      location: locationOf(sourceFile, target),
    };

    if (hasAnySetting(draft)) {
      drafts.push(draft);
    }
  }

  return drafts;
}

function collectExportedObjects(
  sourceFile: ts.SourceFile,
): ts.ObjectLiteralExpression[] {
  const out: ts.ObjectLiteralExpression[] = [];
  traversalApi.forEachChild(sourceFile, (node) => {
    if (ts.isExportAssignment(node) && !node.isExportEquals) {
      const expr = unwrap(node.expression);
      if (ts.isObjectLiteralExpression(expr)) {
        out.push(expr);
      } else if (ts.isCallExpression(expr) && expr.arguments[0]) {
        const arg = unwrap(expr.arguments[0]);
        if (ts.isObjectLiteralExpression(arg)) out.push(arg);
      } else if (ts.isArrowFunction(expr) || ts.isFunctionExpression(expr)) {
        if (ts.isObjectLiteralExpression(expr.body)) {
          out.push(expr.body);
        } else if (ts.isParenthesizedExpression(expr.body)) {
          const inner = unwrap(expr.body);
          if (ts.isObjectLiteralExpression(inner)) out.push(inner);
        }
      } else if (ts.isIdentifier(expr)) {
        const resolved = resolveLocal(sourceFile, expr.text);
        if (resolved) out.push(resolved);
      }
    }
    if (
      ts.isExpressionStatement(node) &&
      ts.isBinaryExpression(node.expression) &&
      node.expression.operatorToken.kind === ts.SyntaxKind.EqualsToken
    ) {
      const left = unwrap(node.expression.left);
      const right = unwrap(node.expression.right);
      if (
        ts.isPropertyAccessExpression(left) &&
        left.name.text === "exports" &&
        ts.isObjectLiteralExpression(right)
      ) {
        out.push(right);
      }
    }
  });
  return out;
}

function resolveLocal(
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
