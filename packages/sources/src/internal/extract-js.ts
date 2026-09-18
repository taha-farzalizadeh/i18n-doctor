import {
  createAstEngine,
  queryApi,
  traversalApi,
  type AstEngine,
  type SourceLocation as AstSourceLocation,
} from "@i18n-doctor/ast";
import ts from "typescript";
import type { SourceLocation } from "../api/types.js";
import {
  flattenLocated,
  scoreStringLeafRatio,
  type FlatEntry,
  type LocatedNode,
} from "./flatten.js";
import { looksLikeLocale, looksLikeLocaleMap } from "./locale.js";
import { looksLikeNamespaceKey } from "./namespace.js";

const MESSAGE_PROP_NAMES = new Set([
  "messages",
  "message",
  "translations",
  "translation",
  "resources",
  "locales",
  "dictionary",
  "dictionaries",
  "catalog",
  "catalogs",
  "defaultMessages",
  "i18nMessages",
]);

const BINDING_NAMES = new Set([
  ...MESSAGE_PROP_NAMES,
  "i18n",
]);

const MESSAGE_FN_NAMES = new Set([
  "getMessages",
  "loadMessages",
  "createMessages",
  "defineMessages",
  "messages",
  "getTranslations",
  "loadTranslations",
]);

const MAX_OBJECTS_PER_FILE = 200;

export interface JsExtractionRegion {
  readonly entries: FlatEntry[];
  readonly location: SourceLocation;
  readonly kind:
    | "i18next-resources"
    | "messages-object"
    | "embedded-object"
    | "unknown";
  readonly locale?: string;
  readonly namespace?: string;
  readonly confidence: number;
  readonly evidence: string[];
}

function toLoc(loc: AstSourceLocation): SourceLocation {
  return {
    start: loc.start,
    end: loc.end,
    startLine: loc.startLine,
    startCharacter: loc.startCharacter,
    endLine: loc.endLine,
    endCharacter: loc.endCharacter,
  };
}

function originFilePath(sourceFile: ts.SourceFile): string {
  return sourceFile.fileName.replace(/\\/g, "/");
}

function withOrigin(
  node: LocatedNode,
  sourceFile: ts.SourceFile,
): LocatedNode {
  if (node.filePath) return node;
  return { ...node, filePath: originFilePath(sourceFile) };
}

function objectLiteralToLocated(
  node: ts.ObjectLiteralExpression,
  sourceFile: ts.SourceFile,
  ctx?: SpreadResolveContext,
): LocatedNode {
  const children = new Map<string, LocatedNode>();
  const filePath = originFilePath(sourceFile);

  // Spreads first so own properties override (runtime merge order).
  for (const prop of node.properties) {
    if (!ts.isSpreadAssignment(prop)) continue;
    const spread = resolveSpreadExpression(prop.expression, sourceFile, ctx);
    if (!spread?.children || !(spread.children instanceof Map)) continue;
    for (const [key, child] of spread.children) {
      if (!children.has(key)) children.set(key, child);
    }
  }

  for (const prop of node.properties) {
    if (ts.isSpreadAssignment(prop)) continue;
    if (!ts.isPropertyAssignment(prop)) {
      continue;
    }
    const key = propertyNameText(prop.name);
    if (key === undefined) {
      continue;
    }
    const child = expressionToLocated(prop.initializer, sourceFile, ctx);
    if (!child) {
      continue;
    }
    // Leaf entries underline the property key, not the translated value.
    if (child.children === undefined) {
      children.set(key, {
        ...child,
        location: toLoc(queryApi.getLocation(sourceFile, prop.name)),
        filePath,
      });
    } else {
      children.set(key, withOrigin(child, sourceFile));
    }
  }
  return {
    value: undefined,
    location: toLoc(queryApi.getLocation(sourceFile, node)),
    filePath,
    children,
  };
}

function arrayLiteralToLocated(
  node: ts.ArrayLiteralExpression,
  sourceFile: ts.SourceFile,
  ctx?: SpreadResolveContext,
): LocatedNode {
  const children: LocatedNode[] = [];
  for (const element of node.elements) {
    const child = expressionToLocated(element, sourceFile, ctx);
    children.push(
      child ?? {
        value: null,
        location: toLoc(queryApi.getLocation(sourceFile, element)),
      },
    );
  }
  return {
    value: undefined,
    location: toLoc(queryApi.getLocation(sourceFile, node)),
    children,
  };
}

function expressionToLocated(
  node: ts.Expression,
  sourceFile: ts.SourceFile,
  ctx?: SpreadResolveContext,
): LocatedNode | undefined {
  if (ts.isObjectLiteralExpression(node)) {
    return objectLiteralToLocated(node, sourceFile, ctx);
  }
  if (ts.isArrayLiteralExpression(node)) {
    return arrayLiteralToLocated(node, sourceFile, ctx);
  }
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return {
      value: node.text,
      location: toLoc(queryApi.getLocation(sourceFile, node)),
      filePath: originFilePath(sourceFile),
    };
  }
  // "a" + "b" (+ nested concatenations) — common for long catalog values.
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = expressionToLocated(node.left, sourceFile, ctx);
    const right = expressionToLocated(node.right, sourceFile, ctx);
    if (
      left &&
      right &&
      typeof left.value === "string" &&
      typeof right.value === "string" &&
      left.children === undefined &&
      right.children === undefined
    ) {
      return {
        value: left.value + right.value,
        location: toLoc(queryApi.getLocation(sourceFile, node)),
        filePath: originFilePath(sourceFile),
      };
    }
  }
  if (ts.isNumericLiteral(node)) {
    return {
      value: Number(node.text),
      location: toLoc(queryApi.getLocation(sourceFile, node)),
      filePath: originFilePath(sourceFile),
    };
  }
  if (node.kind === ts.SyntaxKind.TrueKeyword) {
    return {
      value: true,
      location: toLoc(queryApi.getLocation(sourceFile, node)),
      filePath: originFilePath(sourceFile),
    };
  }
  if (node.kind === ts.SyntaxKind.FalseKeyword) {
    return {
      value: false,
      location: toLoc(queryApi.getLocation(sourceFile, node)),
      filePath: originFilePath(sourceFile),
    };
  }
  if (node.kind === ts.SyntaxKind.NullKeyword) {
    return {
      value: null,
      location: toLoc(queryApi.getLocation(sourceFile, node)),
      filePath: originFilePath(sourceFile),
    };
  }
  if (
    ts.isAsExpression(node) ||
    ts.isSatisfiesExpression(node) ||
    ts.isParenthesizedExpression(node) ||
    ts.isTypeAssertionExpression(node)
  ) {
    return expressionToLocated(node.expression, sourceFile, ctx);
  }
  if (ts.isCallExpression(node)) {
    // defineMessages({ ... }) / defineMessage({ ... })
    const callee = getCalleeName(node.expression);
    if (
      callee &&
      (callee === "defineMessages" || callee === "defineMessage") &&
      node.arguments[0] &&
      ts.isObjectLiteralExpression(node.arguments[0])
    ) {
      return objectLiteralToLocated(node.arguments[0], sourceFile, ctx);
    }
  }
  // Identifier / import / other calls — resolved only via spread context.
  return undefined;
}

/** Resolve `...ident` to a located object (local binding or imported default/named). */
function resolveSpreadExpression(
  expr: ts.Expression,
  sourceFile: ts.SourceFile,
  ctx: SpreadResolveContext | undefined,
): LocatedNode | undefined {
  const unwrapped =
    ts.isAsExpression(expr) ||
    ts.isParenthesizedExpression(expr) ||
    ts.isSatisfiesExpression(expr)
      ? expr.expression
      : expr;

  if (ts.isObjectLiteralExpression(unwrapped)) {
    return objectLiteralToLocated(unwrapped, sourceFile, ctx);
  }

  if (!ts.isIdentifier(unwrapped)) return undefined;

  const depth = ctx?.depth ?? 0;
  if (depth >= MAX_SPREAD_DEPTH) return undefined;

  // Same-file `const extra = { ... }`.
  const local = findLocalObjectBinding(sourceFile, unwrapped.text);
  if (local) {
    return objectLiteralToLocated(local, sourceFile, {
      depth: depth + 1,
      fromFileName: ctx?.fromFileName ?? sourceFile.fileName,
      ...(ctx?.resolveImport ? { resolveImport: ctx.resolveImport } : {}),
      ...(ctx?.engine ? { engine: ctx.engine } : {}),
    });
  }

  if (!ctx?.resolveImport || !ctx.fromFileName) return undefined;

  const specifierInfo = findImportInfo(sourceFile, unwrapped.text);
  if (!specifierInfo) return undefined;

  const resolved = ctx.resolveImport({
    fromFileName: ctx.fromFileName,
    specifier: specifierInfo.specifier,
    localName: unwrapped.text,
  });
  if (!resolved) return undefined;

  const engine = ctx.engine ?? createAstEngine({ cache: true });
  const parsed = engine.parse({
    fileName: resolved.fileName,
    sourceText: resolved.sourceText,
  });
  const target = findExportObject(
    parsed.sourceFile,
    specifierInfo.isDefault ? undefined : (specifierInfo.importedName ?? unwrapped.text),
  );
  if (!target) return undefined;

  return objectLiteralToLocated(target, parsed.sourceFile, {
    resolveImport: ctx.resolveImport,
    fromFileName: resolved.fileName,
    engine,
    depth: depth + 1,
  });
}

interface SpreadResolveContext {
  readonly resolveImport?: (input: {
    fromFileName: string;
    specifier: string;
    localName: string;
  }) =>
    | { fileName: string; sourceText: string }
    | undefined;
  readonly fromFileName?: string;
  readonly engine?: AstEngine;
  readonly depth?: number;
}

const MAX_SPREAD_DEPTH = 4;

function findLocalObjectBinding(
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
      const init = node.initializer;
      if (ts.isObjectLiteralExpression(init)) {
        found = init;
      } else if (
        (ts.isAsExpression(init) || ts.isParenthesizedExpression(init)) &&
        ts.isObjectLiteralExpression(init.expression)
      ) {
        found = init.expression;
      }
    }
  });
  return found;
}

function findImportInfo(
  sourceFile: ts.SourceFile,
  localName: string,
):
  | { specifier: string; isDefault: true }
  | { specifier: string; isDefault: false; importedName: string }
  | undefined {
  for (const stmt of sourceFile.statements) {
    if (!ts.isImportDeclaration(stmt) || !ts.isStringLiteral(stmt.moduleSpecifier)) {
      continue;
    }
    const clause = stmt.importClause;
    if (!clause) continue;
    if (clause.name?.text === localName) {
      return { specifier: stmt.moduleSpecifier.text, isDefault: true };
    }
    if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
      for (const el of clause.namedBindings.elements) {
        if (el.name.text === localName) {
          return {
            specifier: stmt.moduleSpecifier.text,
            isDefault: false,
            importedName: (el.propertyName ?? el.name).text,
          };
        }
      }
    }
  }
  return undefined;
}

function findExportObject(
  sourceFile: ts.SourceFile,
  exportName?: string,
): ts.ObjectLiteralExpression | undefined {
  // Default import → export default {…} or export default ident.
  if (exportName === undefined) {
    for (const stmt of sourceFile.statements) {
      if (ts.isExportAssignment(stmt) && !stmt.isExportEquals) {
        const expr = stmt.expression;
        if (ts.isObjectLiteralExpression(expr)) return expr;
        if (ts.isIdentifier(expr)) {
          return findLocalObjectBinding(sourceFile, expr.text);
        }
      }
    }
    return undefined;
  }

  // Named import → export const name = {…}.
  const local = findLocalObjectBinding(sourceFile, exportName);
  if (local) return local;

  for (const stmt of sourceFile.statements) {
    if (
      !ts.isVariableStatement(stmt) ||
      !stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
    ) {
      continue;
    }
    for (const decl of stmt.declarationList.declarations) {
      if (
        ts.isIdentifier(decl.name) &&
        decl.name.text === exportName &&
        decl.initializer &&
        ts.isObjectLiteralExpression(decl.initializer)
      ) {
        return decl.initializer;
      }
    }
  }
  return undefined;
}

function getCalleeName(expr: ts.Expression): string | undefined {
  if (ts.isIdentifier(expr)) {
    return expr.text;
  }
  if (ts.isPropertyAccessExpression(expr) && ts.isIdentifier(expr.name)) {
    return expr.name.text;
  }
  return undefined;
}

function propertyNameText(name: ts.PropertyName): string | undefined {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }
  if (ts.isComputedPropertyName(name)) {
    if (ts.isStringLiteral(name.expression) || ts.isNoSubstitutionTemplateLiteral(name.expression)) {
      return name.expression.text;
    }
    // Dynamic computed key — skip (no resolve).
    return undefined;
  }
  return undefined;
}

function unwrapObjectLiteral(
  expr: ts.Expression | undefined,
): ts.ObjectLiteralExpression | undefined {
  if (!expr) {
    return undefined;
  }
  if (ts.isObjectLiteralExpression(expr)) {
    return expr;
  }
  if (
    ts.isAsExpression(expr) ||
    ts.isSatisfiesExpression(expr) ||
    ts.isParenthesizedExpression(expr) ||
    ts.isTypeAssertionExpression(expr)
  ) {
    return unwrapObjectLiteral(expr.expression);
  }
  if (ts.isCallExpression(expr)) {
    const callee = getCalleeName(expr.expression);
    if (
      callee &&
      (callee === "defineMessages" || callee === "defineMessage") &&
      expr.arguments[0] &&
      ts.isObjectLiteralExpression(expr.arguments[0])
    ) {
      return expr.arguments[0];
    }
  }
  return undefined;
}

interface TargetHit {
  readonly object: ts.ObjectLiteralExpression;
  readonly hint: string;
  readonly evidence: string;
}

function collectTargets(sourceFile: ts.SourceFile): TargetHit[] {
  const hits: TargetHit[] = [];
  const seen = new Set<ts.ObjectLiteralExpression>();

  const add = (obj: ts.ObjectLiteralExpression | undefined, hint: string, evidence: string) => {
    if (!obj || seen.has(obj)) {
      return;
    }
    seen.add(obj);
    hits.push({ object: obj, hint, evidence });
  };

  traversalApi.forEachChild(sourceFile, (node) => {
    if (hits.length >= MAX_OBJECTS_PER_FILE) {
      return;
    }

    // export default { ... }
    if (ts.isExportAssignment(node) && !node.isExportEquals) {
      add(unwrapObjectLiteral(node.expression), "default", "default export object literal");
    }

    // const/let/var messages = { ... }  (+ export)
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
      const name = node.name.text;
      if (BINDING_NAMES.has(name)) {
        add(
          unwrapObjectLiteral(node.initializer),
          name,
          `const/let binding '${name}'`,
        );
      }
    }

    // { messages: { ... } } property
    // Skip `translation` / `messages` nested under i18next resources locale maps:
    //   resources = { en: { translation: { KEY: "…" } }, fa: { translation: { KEY: "…" } } }
    // Those are expanded from the outer locale map; extracting them again without
    // locale causes false duplicate-key issues across en/fa.
    if (ts.isPropertyAssignment(node)) {
      const key = propertyNameText(node.name);
      if (key && MESSAGE_PROP_NAMES.has(key)) {
        const obj = unwrapObjectLiteral(node.initializer);
        if (obj && !isNestedUnderLocaleResourceMap(obj)) {
          add(obj, key, `property '${key}'`);
        }
      }
    }

    // defineMessages({ ... })
    // i18n.init({ resources }) / createInstance({ resources })
    if (ts.isCallExpression(node)) {
      const callee = getCalleeName(node.expression);
      if (callee === "defineMessages" || callee === "defineMessage") {
        const arg = node.arguments[0];
        if (arg && ts.isObjectLiteralExpression(arg)) {
          add(arg, "defineMessages", `${callee}(...) call`);
        }
      }
      if (
        (callee === "init" || callee === "createInstance") &&
        node.arguments[0] &&
        ts.isObjectLiteralExpression(node.arguments[0])
      ) {
        for (const prop of node.arguments[0].properties) {
          if (!ts.isPropertyAssignment(prop)) {
            continue;
          }
          const key = propertyNameText(prop.name);
          if (key === "resources") {
            add(
              unwrapObjectLiteral(prop.initializer),
              "resources",
              `${callee}({ resources })`,
            );
          }
        }
      }
    }

    // function getMessages() { return { ... } }
    if (
      (ts.isFunctionDeclaration(node) ||
        ts.isFunctionExpression(node) ||
        ts.isArrowFunction(node)) &&
      node.body
    ) {
      const fnName = functionName(node);
      if (fnName && MESSAGE_FN_NAMES.has(fnName)) {
        for (const ret of findReturnObjects(node.body)) {
          add(ret, fnName, `return from '${fnName}'`);
        }
      }
    }
  });

  return hits;
}

function functionName(
  node: ts.FunctionDeclaration | ts.FunctionExpression | ts.ArrowFunction,
): string | undefined {
  if (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node)) {
    return node.name?.text;
  }
  // const getMessages = () => ...
  const parent = node.parent;
  if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) {
    return parent.name.text;
  }
  return undefined;
}

function findReturnObjects(body: ts.ConciseBody): ts.ObjectLiteralExpression[] {
  const out: ts.ObjectLiteralExpression[] = [];
  if (ts.isObjectLiteralExpression(body)) {
    out.push(body);
    return out;
  }
  if (ts.isParenthesizedExpression(body)) {
    const inner = unwrapObjectLiteral(body.expression);
    if (inner) {
      out.push(inner);
    }
    return out;
  }
  traversalApi.forEachChild(body, (node) => {
    if (ts.isReturnStatement(node) && node.expression) {
      const obj = unwrapObjectLiteral(node.expression);
      if (obj) {
        out.push(obj);
      }
    }
  });
  return out;
}

function classifyFromHint(
  hint: string,
  entries: FlatEntry[],
  location: SourceLocation,
  evidence: string[],
): JsExtractionRegion | undefined {
  if (entries.length === 0) {
    return undefined;
  }
  const stringRatio = scoreStringLeafRatio(entries);
  let confidence = 0.25;
  let kind: JsExtractionRegion["kind"] = "embedded-object";

  if (hint === "resources") {
    kind = "i18next-resources";
    confidence += 0.35;
  } else if (MESSAGE_PROP_NAMES.has(hint) || hint === "defineMessages") {
    kind = "messages-object";
    confidence += 0.35;
  } else if (hint === "default") {
    kind = "embedded-object";
    confidence += 0.15;
  } else if (MESSAGE_FN_NAMES.has(hint)) {
    kind = "messages-object";
    confidence += 0.3;
  }

  if (stringRatio >= 0.85) {
    confidence += 0.25;
  } else if (stringRatio >= 0.6) {
    confidence += 0.1;
  } else if (stringRatio < 0.4 && hint !== "defineMessages") {
    return undefined;
  }

  confidence = Math.min(1, Math.round(confidence * 1000) / 1000);
  return {
    entries,
    location,
    kind,
    confidence,
    evidence: [...evidence, `${Math.round(stringRatio * 100)}% string leaves`],
  };
}

export function expandI18nextResources(
  located: LocatedNode,
  baseConfidence: number,
  evidence: string[],
): JsExtractionRegion[] {
  if (!(located.children instanceof Map)) {
    return [];
  }
  const regions: JsExtractionRegion[] = [];
  for (const [localeKey, localeNode] of located.children) {
    if (!looksLikeLocale(localeKey, "loose") || !(localeNode.children instanceof Map)) {
      continue;
    }

    const childEntries = [...localeNode.children.entries()];
    const namespaced =
      childEntries.length > 0 &&
      childEntries.every(([, child]) => {
        return child.children instanceof Map || Array.isArray(child.children);
      });

    if (namespaced) {
      for (const [nsKey, nsNode] of childEntries) {
        const entries = flattenLocated(nsNode);
        if (entries.length === 0 || scoreStringLeafRatio(entries) < 0.5) {
          continue;
        }
        regions.push({
          entries,
          location: nsNode.location,
          kind: "i18next-resources",
          locale: localeKey,
          ...(looksLikeNamespaceKey(nsKey) || nsKey === "translation"
            ? { namespace: nsKey }
            : {}),
          confidence: Math.min(1, baseConfidence + 0.2),
          evidence: [
            ...evidence,
            `resources locale='${localeKey}' namespace='${nsKey}'`,
          ],
        });
      }
    } else {
      const entries = flattenLocated(localeNode);
      if (entries.length === 0 || scoreStringLeafRatio(entries) < 0.5) {
        continue;
      }
      regions.push({
        entries,
        location: localeNode.location,
        kind: "messages-object",
        locale: localeKey,
        confidence: Math.min(1, baseConfidence + 0.15),
        evidence: [...evidence, `locale messages for '${localeKey}'`],
      });
    }
  }
  return regions;
}

function pushRegion(
  regions: JsExtractionRegion[],
  seen: Set<string>,
  region: JsExtractionRegion,
): void {
  const rangeKey = `${region.location.start}-${region.location.end}-${region.locale ?? ""}-${region.namespace ?? ""}-${region.kind}`;
  if (seen.has(rangeKey)) {
    return;
  }
  if (isCoveredByExisting(regions, region)) {
    return;
  }
  seen.add(rangeKey);
  regions.push(region);
}

function isCoveredByExisting(
  regions: readonly JsExtractionRegion[],
  candidate: JsExtractionRegion,
): boolean {
  const cStart = candidate.location.start ?? -1;
  const cEnd = candidate.location.end ?? -1;
  if (cStart < 0 || cEnd < 0) {
    return false;
  }
  return regions.some((r) => {
    const s = r.location.start ?? -1;
    const e = r.location.end ?? -1;
    if (s < 0 || e < 0) {
      return false;
    }
    // Same object already emitted (resources expand vs nested translation prop).
    if (s === cStart && e === cEnd) {
      return true;
    }
    return s <= cStart && e >= cEnd;
  });
}

/**
 * True when `obj` is `resources[locale].translation` / `.messages` style nesting
 * under a locale-keyed map (i18next init resources).
 */
function isNestedUnderLocaleResourceMap(
  obj: ts.ObjectLiteralExpression,
): boolean {
  const prop = obj.parent;
  if (!prop || !ts.isPropertyAssignment(prop)) {
    return false;
  }
  const localeBag = prop.parent;
  if (!localeBag || !ts.isObjectLiteralExpression(localeBag)) {
    return false;
  }
  const localeProp = localeBag.parent;
  if (!localeProp || !ts.isPropertyAssignment(localeProp)) {
    return false;
  }
  const localeName = propertyNameText(localeProp.name);
  if (!localeName || !looksLikeLocale(localeName, "loose")) {
    return false;
  }
  const resourcesObj = localeProp.parent;
  if (!resourcesObj || !ts.isObjectLiteralExpression(resourcesObj)) {
    return false;
  }
  const topKeys: string[] = [];
  for (const p of resourcesObj.properties) {
    if (!ts.isPropertyAssignment(p) && !ts.isShorthandPropertyAssignment(p)) {
      continue;
    }
    const name = ts.isPropertyAssignment(p)
      ? propertyNameText(p.name)
      : p.name.text;
    if (name) topKeys.push(name);
  }
  return looksLikeLocaleMap(topKeys);
}

/**
 * Extract translation object regions from JS/TS.
 * Resolves same-file and imported object spreads when `resolveImport` is set.
 * Does not resolve dynamic computed keys.
 */
export function extractJsRegions(
  fileName: string,
  sourceText: string,
  options: {
    includeUnknown: boolean;
    engine?: AstEngine;
    resolveImport?: SpreadResolveContext["resolveImport"];
  },
): JsExtractionRegion[] {
  const engine = options.engine ?? createAstEngine({ cache: true });
  const parsed = engine.parse({ fileName, sourceText });
  const regions: JsExtractionRegion[] = [];
  const seen = new Set<string>();
  const targets = collectTargets(parsed.sourceFile);
  const spreadCtx: SpreadResolveContext = {
    ...(options.resolveImport ? { resolveImport: options.resolveImport } : {}),
    fromFileName: fileName,
    engine,
    depth: 0,
  };

  for (const target of targets) {
    const located = objectLiteralToLocated(
      target.object,
      parsed.sourceFile,
      spreadCtx,
    );
    const topKeys =
      located.children instanceof Map ? [...located.children.keys()] : [];

    if (looksLikeLocaleMap(topKeys)) {
      const expanded = expandI18nextResources(located, 0.55, [
        target.evidence,
        "top-level locale map",
      ]);
      for (const region of expanded) {
        pushRegion(regions, seen, region);
      }
      if (expanded.length > 0) {
        continue;
      }
    }

    const entries = flattenLocated(located);
    const region = classifyFromHint(
      target.hint,
      entries,
      located.location,
      [target.evidence],
    );
    if (region) {
      pushRegion(regions, seen, region);
    }
  }

  // Heuristic fallback: only for includeUnknown, and only top-level-ish objects
  // already missed — limited to avoid config-object false positives.
  if (options.includeUnknown && regions.length === 0) {
    let scanned = 0;
    traversalApi.forEachChild(parsed.sourceFile, (node) => {
      if (scanned >= 40 || !ts.isObjectLiteralExpression(node)) {
        return;
      }
      // Prefer module-level objects
      if (!isModuleLevelObject(node)) {
        return;
      }
      scanned += 1;
      const located = objectLiteralToLocated(node, parsed.sourceFile, spreadCtx);
      const topKeys =
        located.children instanceof Map ? [...located.children.keys()] : [];
      if (looksLikeLocaleMap(topKeys)) {
        for (const region of expandI18nextResources(located, 0.45, [
          "heuristic locale map",
        ])) {
          pushRegion(regions, seen, region);
        }
        return;
      }
      const entries = flattenLocated(located);
      if (entries.length < 2 || scoreStringLeafRatio(entries) < 0.9) {
        return;
      }
      pushRegion(regions, seen, {
        entries,
        location: located.location,
        kind: "unknown",
        confidence: 0.4,
        evidence: ["heuristic string-leaf object"],
      });
    });
  }

  return regions;
}

function isModuleLevelObject(node: ts.ObjectLiteralExpression): boolean {
  let current: ts.Node | undefined = node.parent;
  while (current) {
    if (ts.isSourceFile(current)) {
      return true;
    }
    if (
      ts.isBlock(current) &&
      !ts.isModuleBlock(current) &&
      current.parent &&
      !ts.isSourceFile(current.parent) &&
      !ts.isModuleDeclaration(current.parent)
    ) {
      // Inside function/block — skip for heuristic pass
      if (
        ts.isFunctionLike(current.parent) ||
        ts.isIfStatement(current.parent) ||
        ts.isIterationStatement(current.parent, false)
      ) {
        return false;
      }
    }
    current = current.parent;
  }
  return true;
}
