/**
 * Extract next-intl routing / request / i18n module config.
 * Supports:
 *   export const locales = ['en','de']
 *   export const defaultLocale = 'en'
 *   defineRouting({ locales, defaultLocale })
 *   getRequestConfig(async () => ({ locale, ... }))
 */

import { traversalApi } from "@i18n-doctor/ast";
import ts from "typescript";
import { locationOf } from "../location.js";
import {
  calleeName,
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

const NEXT_INTL_HELPERS = new Set([
  "defineRouting",
  "createSharedPathnamesNavigation",
  "createLocalizedPathnamesNavigation",
  "createNavigation",
  "getRequestConfig",
]);

export function extractNextIntlConfigs(
  sourceFile: ts.SourceFile,
  options?: { requireSignal?: boolean },
): ConfigDraft[] {
  const drafts: ConfigDraft[] = [];
  const signal = hasNextIntlSignal(sourceFile);
  if (options?.requireSignal && !signal) {
    return drafts;
  }

  // Named exports only when file has next-intl signal or is a known path
  if (signal || !options?.requireSignal) {
    const named = extractNamedLocaleExports(sourceFile, signal);
    if (named && hasAnySetting(named)) {
      drafts.push(named);
    }
  }

  traversalApi.forEachChild(sourceFile, (node) => {
    if (!ts.isCallExpression(node)) {
      return;
    }
    const name = calleeName(node.expression);
    if (!name || !NEXT_INTL_HELPERS.has(name)) {
      return;
    }

    const objects = collectHelperOptionObjects(node, sourceFile);
    for (const obj of objects) {
      const draft = objectToDraft(obj, sourceFile, name);
      if (draft && hasAnySetting(draft)) {
        drafts.push(draft);
      }
    }
  });

  return drafts;
}

function hasNextIntlSignal(sourceFile: ts.SourceFile): boolean {
  let found = false;
  traversalApi.forEachChild(sourceFile, (node) => {
    if (found) return;
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      const spec = node.moduleSpecifier.text;
      if (
        spec === "next-intl" ||
        spec.startsWith("next-intl/") ||
        spec === "use-intl"
      ) {
        found = true;
      }
    }
    if (ts.isCallExpression(node)) {
      const name = calleeName(node.expression);
      if (name && NEXT_INTL_HELPERS.has(name)) {
        found = true;
      }
    }
  });
  return found;
}

function collectHelperOptionObjects(
  call: ts.CallExpression,
  sourceFile: ts.SourceFile,
): ts.ObjectLiteralExpression[] {
  const out: ts.ObjectLiteralExpression[] = [];
  const name = calleeName(call.expression);
  const arg = call.arguments[0];
  if (!arg) return out;

  const node = unwrap(arg);
  if (ts.isObjectLiteralExpression(node)) {
    out.push(node);
    return out;
  }

  // getRequestConfig(async ({locale}) => ({ ... })) / () => ({...})
  if (
    name === "getRequestConfig" &&
    (ts.isArrowFunction(node) || ts.isFunctionExpression(node))
  ) {
    pushReturnedObjects(node.body, out);
  }

  // defineRouting(routing) where routing is a local const
  if (ts.isIdentifier(node)) {
    const resolved = resolveLocalObject(sourceFile, node.text);
    if (resolved) out.push(resolved);
  }

  return out;
}

function pushReturnedObjects(
  body: ts.ConciseBody,
  out: ts.ObjectLiteralExpression[],
): void {
  if (ts.isObjectLiteralExpression(body)) {
    out.push(body);
    return;
  }
  if (ts.isParenthesizedExpression(body)) {
    const inner = unwrap(body);
    if (ts.isObjectLiteralExpression(inner)) out.push(inner);
    return;
  }
  if (!ts.isBlock(body)) return;
  for (const stmt of body.statements) {
    if (ts.isReturnStatement(stmt) && stmt.expression) {
      const ret = unwrap(stmt.expression);
      if (ts.isObjectLiteralExpression(ret)) {
        out.push(ret);
      }
    }
  }
}

function objectToDraft(
  obj: ts.ObjectLiteralExpression,
  sourceFile: ts.SourceFile,
  helperName: string,
): ConfigDraft | undefined {
  const defaultLocale = staticString(
    findObjectPropertyDeep(obj, ["defaultLocale", "locale"]),
    sourceFile,
  );
  let locales = staticStringArray(
    findObjectPropertyDeep(obj, ["locales"]),
    sourceFile,
  );

  // Resolve locales identifier against local const
  if (!locales) {
    const localesExpr = findObjectPropertyDeep(obj, ["locales"]);
    if (localesExpr && ts.isIdentifier(unwrap(localesExpr))) {
      locales = staticStringArray(localesExpr, sourceFile);
    }
  }

  const localePrefix = staticString(
    findObjectPropertyDeep(obj, ["localePrefix"]),
    sourceFile,
  );

  return {
    kind: "next-intl",
    library: "next-intl",
    confidence: 0.93,
    ...(defaultLocale !== undefined
      ? { defaultLocale: normalizeLocaleToken(defaultLocale) }
      : {}),
    ...(locales !== undefined
      ? { supportedLocales: locales.map(normalizeLocaleToken) }
      : {}),
    evidence: [
      `next-intl.${helperName}()`,
      ...(localePrefix !== undefined ? [`localePrefix=${localePrefix}`] : []),
    ],
    location: locationOf(sourceFile, obj),
  };
}

function extractNamedLocaleExports(
  sourceFile: ts.SourceFile,
  strongSignal: boolean,
): ConfigDraft | undefined {
  let defaultLocale: string | undefined;
  let locales: string[] | undefined;
  let location = locationOf(sourceFile, sourceFile);
  const evidence: string[] = [];

  traversalApi.forEachChild(sourceFile, (node) => {
    if (!ts.isVariableStatement(node)) return;
    const isExported = node.modifiers?.some(
      (m) => m.kind === ts.SyntaxKind.ExportKeyword,
    );
    for (const decl of node.declarationList.declarations) {
      if (!ts.isIdentifier(decl.name) || !decl.initializer) continue;
      const name = decl.name.text;
      if (name === "defaultLocale" || name === "locale") {
        const v = staticString(decl.initializer, sourceFile);
        if (v !== undefined) {
          defaultLocale = normalizeLocaleToken(v);
          location = locationOf(sourceFile, decl);
          evidence.push(
            isExported ? "export defaultLocale" : "const defaultLocale",
          );
        }
      }
      if (name === "locales" || name === "supportedLocales") {
        const v = staticStringArray(decl.initializer, sourceFile);
        if (v !== undefined) {
          locales = v.map(normalizeLocaleToken);
          location = locationOf(sourceFile, decl);
          evidence.push(isExported ? "export locales" : "const locales");
        }
      }
    }
  });

  if (!defaultLocale && !locales) {
    return undefined;
  }

  // Without next-intl import/helper, require exported names to avoid false positives
  if (!strongSignal && !evidence.some((e) => e.startsWith("export"))) {
    return undefined;
  }

  return {
    kind: "next-intl",
    library: "next-intl",
    confidence: strongSignal ? 0.9 : 0.7,
    ...(defaultLocale !== undefined ? { defaultLocale } : {}),
    ...(locales !== undefined ? { supportedLocales: locales } : {}),
    evidence: evidence.length > 0 ? evidence : ["next-intl-named-exports"],
    location,
  };
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
