/**
 * Extract i18next.init() / createInstance() options.
 * Static AST only — never executes init.
 */

import { traversalApi } from "@i18n-doctor/ast";
import ts from "typescript";
import { locationOf } from "../location.js";
import {
  calleeName,
  findObjectPropertyDeep,
  getObjectProperty,
  rootCalleeObject,
  staticBoolean,
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

const I18N_OBJECTS = new Set(["i18n", "i18next"]);
const INIT_METHODS = new Set(["init", "createInstance"]);

export function extractI18nextConfigs(
  sourceFile: ts.SourceFile,
): ConfigDraft[] {
  const drafts: ConfigDraft[] = [];
  const hasI18nextImport = fileImportsI18next(sourceFile);

  traversalApi.forEachChild(sourceFile, (node) => {
    if (!ts.isCallExpression(node) || node.arguments.length === 0) {
      return;
    }

    const method = calleeName(node.expression);
    if (!method || !INIT_METHODS.has(method)) {
      return;
    }

    if (!isI18nextInitCall(node.expression, method, hasI18nextImport)) {
      return;
    }

    const optionsArg = findOptionsObject(node.arguments[0], sourceFile);
    if (!optionsArg) {
      return;
    }

    const draft = optionsToDraft(
      optionsArg,
      sourceFile,
      method === "createInstance"
        ? "i18next-create-instance"
        : "i18next-init",
      `i18next.${method}()`,
    );
    if (hasAnySetting(draft)) {
      drafts.push(draft);
    }
  });

  return drafts;
}

function fileImportsI18next(sourceFile: ts.SourceFile): boolean {
  let found = false;
  traversalApi.forEachChild(sourceFile, (node) => {
    if (found) return;
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      const spec = node.moduleSpecifier.text;
      if (
        spec === "i18next" ||
        spec === "react-i18next" ||
        spec === "next-i18next" ||
        spec.startsWith("i18next/")
      ) {
        found = true;
      }
    }
  });
  return found;
}

function isI18nextInitCall(
  expr: ts.Expression,
  method: string,
  hasI18nextImport: boolean,
): boolean {
  const obj = rootCalleeObject(expr);
  if (method === "createInstance") {
    if (obj !== undefined) {
      return I18N_OBJECTS.has(obj);
    }
    // Bare createInstance(...) only with i18next import evidence
    return hasI18nextImport && ts.isIdentifier(unwrap(expr));
  }
  if (obj !== undefined && I18N_OBJECTS.has(obj)) {
    return true;
  }
  return isChainedInit(expr);
}

function isChainedInit(expr: ts.Expression): boolean {
  const top = unwrap(expr);
  if (!ts.isPropertyAccessExpression(top) || top.name.text !== "init") {
    return false;
  }
  let current: ts.Expression = unwrap(top.expression);
  while (
    ts.isCallExpression(current) ||
    ts.isPropertyAccessExpression(current)
  ) {
    if (ts.isCallExpression(current)) {
      current = unwrap(current.expression);
      continue;
    }
    if (
      ts.isIdentifier(current.expression) &&
      I18N_OBJECTS.has(current.expression.text)
    ) {
      return true;
    }
    current = unwrap(current.expression);
  }
  return ts.isIdentifier(current) && I18N_OBJECTS.has(current.text);
}

function findOptionsObject(
  arg: ts.Expression | undefined,
  sourceFile: ts.SourceFile,
): ts.ObjectLiteralExpression | undefined {
  if (!arg) {
    return undefined;
  }
  const node = unwrap(arg);
  if (ts.isObjectLiteralExpression(node)) {
    return node;
  }
  if (ts.isIdentifier(node)) {
    return resolveLocalObjectLiteral(sourceFile, node.text);
  }
  return undefined;
}

function resolveLocalObjectLiteral(
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

export function optionsToDraft(
  obj: ts.ObjectLiteralExpression,
  sourceFile: ts.SourceFile,
  kind: ConfigDraft["kind"],
  evidenceLabel: string,
  library: ConfigDraft["library"] = "i18next",
  confidence = 0.9,
): ConfigDraft {
  const defaultNS = staticStringOrArray(
    findObjectPropertyDeep(obj, ["defaultNS"]),
    sourceFile,
  );
  const fallbackNS = staticStringOrArray(
    findObjectPropertyDeep(obj, ["fallbackNS"]),
    sourceFile,
  );
  const ns = staticStringArray(
    findObjectPropertyDeep(obj, ["ns"]),
    sourceFile,
  );

  const lng = staticString(
    findObjectPropertyDeep(obj, ["lng", "defaultLocale", "locale"]),
    sourceFile,
  );

  const { fallbackLocale, localeInheritance } = parseFallbackLng(
    findObjectPropertyDeep(obj, [
      "fallbackLng",
      "fallbackLocale",
      "fallbackLocales",
    ]),
    sourceFile,
  );

  const supported = staticStringArray(
    findObjectPropertyDeep(obj, [
      "supportedLngs",
      "locales",
      "supportedLocales",
    ]),
    sourceFile,
  );

  const keySeparator = parseSeparator(
    findObjectPropertyDeep(obj, ["keySeparator"]),
    sourceFile,
  );
  const nsSeparator = parseSeparator(
    findObjectPropertyDeep(obj, ["nsSeparator"]),
    sourceFile,
  );

  let draft: ConfigDraft = {
    kind,
    library,
    confidence,
    ...(defaultNS !== undefined ? { defaultNS } : {}),
    ...(fallbackNS !== undefined ? { fallbackNS } : {}),
    ...(ns !== undefined ? { ns } : {}),
    ...(lng !== undefined
      ? { defaultLocale: normalizeLocaleToken(lng) }
      : {}),
    ...(fallbackLocale !== undefined
      ? { fallbackLocale: normalizeLocaleValue(fallbackLocale) }
      : {}),
    ...(supported !== undefined
      ? { supportedLocales: supported.map(normalizeLocaleToken) }
      : {}),
    ...(localeInheritance !== undefined
      ? { localeInheritance }
      : {}),
    ...(keySeparator !== undefined ? { keySeparator } : {}),
    ...(nsSeparator !== undefined ? { nsSeparator } : {}),
    evidence: [evidenceLabel],
    location: locationOf(sourceFile, obj),
  };

  // resources: { en: { common: {...} } } → locales + namespaces (catalog only)
  const resources = findObjectPropertyDeep(obj, ["resources"]);
  if (resources && ts.isObjectLiteralExpression(unwrap(resources))) {
    const resObj = unwrap(resources) as ts.ObjectLiteralExpression;
    const locales: string[] = [];
    const namespaces = new Set<string>(draft.ns ?? []);
    for (const prop of resObj.properties) {
      if (!ts.isPropertyAssignment(prop)) continue;
      const localeKey =
        ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name)
          ? prop.name.text
          : undefined;
      if (localeKey) {
        locales.push(normalizeLocaleToken(localeKey));
      }
      const nsObj = unwrap(prop.initializer);
      if (ts.isObjectLiteralExpression(nsObj)) {
        for (const nsProp of nsObj.properties) {
          if (!ts.isPropertyAssignment(nsProp)) continue;
          const nsName =
            ts.isIdentifier(nsProp.name) || ts.isStringLiteral(nsProp.name)
              ? nsProp.name.text
              : undefined;
          if (nsName) namespaces.add(nsName);
        }
      }
    }
    draft = {
      ...draft,
      ...(draft.supportedLocales === undefined && locales.length > 0
        ? { supportedLocales: locales }
        : {}),
      ...(draft.ns === undefined && namespaces.size > 0
        ? { ns: [...namespaces].sort((a, b) => a.localeCompare(b)) }
        : {}),
      confidence: Math.min(draft.confidence, 0.85),
      evidence: [...draft.evidence, "i18next.resources"],
    };
  }

  return draft;
}

/**
 * fallbackLng forms:
 *   'en' | ['en','de']
 *   { default: ['en'], 'de-CH': ['de','en'] }
 * Object keys (except "default") → localeInheritance only.
 * Only `default` (or non-object forms) → fallbackLocale.
 */
function parseFallbackLng(
  expr: ts.Expression | undefined,
  sourceFile: ts.SourceFile,
): {
  fallbackLocale?: string | readonly string[];
  localeInheritance?: Readonly<Record<string, string>>;
} {
  if (!expr) return {};
  const unwrapped = unwrap(expr);

  if (ts.isObjectLiteralExpression(unwrapped)) {
    const rawMap = staticStringMap(unwrapped, sourceFile) ?? {};
    const inheritance: Record<string, string> = {};
    for (const [k, v] of Object.entries(rawMap)) {
      if (k === "default") continue;
      inheritance[normalizeLocaleToken(k)] = normalizeLocaleToken(v);
    }

    const defaultArr = getObjectProperty(unwrapped, "default");
    const fallbackLocale = defaultArr
      ? staticStringOrArray(defaultArr, sourceFile)
      : undefined;

    return {
      ...(fallbackLocale !== undefined ? { fallbackLocale } : {}),
      ...(Object.keys(inheritance).length > 0
        ? { localeInheritance: inheritance }
        : {}),
    };
  }

  const fallbackLocale = staticStringOrArray(unwrapped, sourceFile);
  return fallbackLocale !== undefined ? { fallbackLocale } : {};
}

/** string separator, or false → "" (disabled). */
function parseSeparator(
  expr: ts.Expression | undefined,
  sourceFile: ts.SourceFile,
): string | undefined {
  if (!expr) return undefined;
  const bool = staticBoolean(expr);
  if (bool === false) return "";
  if (bool === true) return undefined;
  return staticString(expr, sourceFile);
}
