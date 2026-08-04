/**
 * Static extraction of i18next resource registrations.
 *
 * Supports:
 * - addResourceBundle(lng, ns, resource)
 * - addResource(lng, ns, key, value)
 * - init({ resources }) / createInstance({ resources }) (inline + named)
 *
 * Does not execute application code. Import targets are resolved via
 * @i18n-doctor/imports (relative + tsconfig paths).
 */

import path from "node:path";
import {
  createAstEngine,
  queryApi,
  traversalApi,
  type AstEngine,
} from "@i18n-doctor/ast";
import { createImportResolver, type ImportResolver } from "@i18n-doctor/imports";
import type { ProjectSnapshotView } from "@i18n-doctor/scanner";
import ts from "typescript";
import type {
  CatalogWarning,
  SourceLocation,
  TranslationSource,
  TranslationValue,
} from "../api/types.js";
import {
  buildSourceFromEntries,
  formatOfPath,
} from "./build-source.js";
import type { JsExtractionRegion } from "./extract-js.js";
import {
  flattenLocated,
  scoreStringLeafRatio,
  type FlatEntry,
  type LocatedNode,
} from "./flatten.js";

/** Only registration call shapes — avoid re-parsing every `.init(` in the app. */
const REGISTRATION_HINT_RE = /\baddResource(Bundle)?\s*\(/;

const SCRIPT_EXT = new Set([
  "ts",
  "tsx",
  "js",
  "jsx",
  "mts",
  "cts",
  "mjs",
  "cjs",
]);

const MAX_REGISTRATION_FILES = 2500;
const MAX_FILE_BYTES = 2 * 1024 * 1024;

export interface ResourceFileAttribution {
  readonly relativePath: string;
  readonly locale?: string;
  readonly namespace: string;
  readonly confidence: number;
  readonly evidence: string;
  readonly registrationFile: string;
}

export interface RegistrationScanResult {
  readonly attributions: readonly ResourceFileAttribution[];
  readonly inlineSources: readonly TranslationSource[];
  readonly warnings: readonly CatalogWarning[];
}

export async function scanI18nextRegistrations(input: {
  root: string;
  snapshot: ProjectSnapshotView;
  minConfidence: number;
  libraryHint?: string;
  astEngine?: AstEngine;
}): Promise<RegistrationScanResult> {
  const warnings: CatalogWarning[] = [];
  const attributions: ResourceFileAttribution[] = [];
  const inlineSources: TranslationSource[] = [];
  const engine = input.astEngine ?? createAstEngine({ cache: true });
  const importResolver = createImportResolver({ root: input.root });

  const files = [...input.snapshot.files()]
    .filter(
      (f) =>
        SCRIPT_EXT.has(f.extension) &&
        !f.relativePath.endsWith(".d.ts") &&
        f.role !== "generated",
    )
    .sort((a, b) => a.relativePath.localeCompare(b.relativePath))
    .slice(0, MAX_REGISTRATION_FILES);

  for (const file of files) {
    const read = await input.snapshot.content.read(file.fileId);
    if (!read.ok || read.bytes.byteLength > MAX_FILE_BYTES) {
      continue;
    }
    const text = Buffer.from(read.bytes).toString("utf8");
    if (!REGISTRATION_HINT_RE.test(text)) {
      continue;
    }

    const absolutePath = path.resolve(input.root, file.relativePath);
    const parsed = engine.parse({
      fileName: absolutePath,
      sourceText: text,
    });

    const hits = collectRegistrations(parsed.sourceFile, {
      relativePath: file.relativePath,
      absolutePath,
      importResolver,
      graphRoot: input.root,
    });

    for (const hit of hits) {
      if (hit.kind === "file" && hit.namespace) {
        attributions.push({
          relativePath: toPosix(hit.resourceRelativePath),
          ...(hit.locale !== undefined ? { locale: hit.locale } : {}),
          namespace: hit.namespace,
          confidence: hit.confidence,
          evidence: hit.evidence,
          registrationFile: file.relativePath,
        });
      } else if (hit.kind === "inline") {
        for (const region of hit.regions) {
          const source = buildSourceFromEntries({
            filePath: file.relativePath,
            format: formatOfPath(file.relativePath),
            kind: region.kind === "i18next-resources"
              ? "i18next-resources"
              : "embedded-object",
            entries: region.entries,
            confidence: Math.max(region.confidence, hit.confidence),
            evidence: [...region.evidence, hit.evidence],
            ...(region.locale ?? hit.locale
              ? { locale: region.locale ?? hit.locale }
              : {}),
            ...(region.namespace ?? hit.namespace
              ? { namespace: region.namespace ?? hit.namespace }
              : {}),
            ...(input.libraryHint ? { libraryHint: input.libraryHint } : {}),
            location: region.location,
            minConfidence: input.minConfidence,
          });
          if (source) {
            inlineSources.push(source);
          }
        }
      } else if (hit.kind === "single-key" && hit.namespace && hit.key) {
        const entry: FlatEntry = {
          key: hit.key,
          value: hit.value ?? null,
          location: hit.location,
        };
        const source = buildSourceFromEntries({
          filePath: file.relativePath,
          format: formatOfPath(file.relativePath),
          kind: "i18next-resources",
          entries: [entry],
          confidence: hit.confidence,
          evidence: [hit.evidence],
          ...(hit.locale !== undefined ? { locale: hit.locale } : {}),
          namespace: hit.namespace,
          ...(input.libraryHint ? { libraryHint: input.libraryHint } : {}),
          location: hit.location,
          minConfidence: input.minConfidence,
        });
        if (source) {
          inlineSources.push(source);
        }
      } else if (hit.kind === "unresolved") {
        warnings.push({
          code: "unresolved-resource-registration",
          message: hit.evidence,
          path: file.relativePath,
        });
      }
    }
  }

  return { attributions, inlineSources, warnings };
}

/**
 * Apply addResourceBundle / addResource file attributions onto discovered sources.
 * Registration namespace wins over path-inferred namespace for i18next co-located files.
 *
 * Deterministic: attributions are sorted; duplicate same file+locale+ns are folded;
 * conflicting namespaces for one file keep the first and emit a warning.
 */
export function applyResourceAttributions(
  sources: readonly TranslationSource[],
  attributions: readonly ResourceFileAttribution[],
): { sources: TranslationSource[]; warnings: CatalogWarning[] } {
  if (attributions.length === 0) {
    return { sources: [...sources], warnings: [] };
  }

  const warnings: CatalogWarning[] = [];
  const sorted = [...attributions].sort(
    (a, b) =>
      a.relativePath.localeCompare(b.relativePath) ||
      a.registrationFile.localeCompare(b.registrationFile) ||
      a.namespace.localeCompare(b.namespace) ||
      (a.locale ?? "").localeCompare(b.locale ?? ""),
  );

  const byFile = new Map<string, ResourceFileAttribution>();
  const seenExact = new Set<string>();

  for (const attr of sorted) {
    const fileKey = toPosix(attr.relativePath);
    const exact = `${fileKey}\0${attr.locale ?? "*"}\0${attr.namespace}`;
    if (seenExact.has(exact)) {
      // Idempotent duplicate registration of the same bundle.
      continue;
    }
    seenExact.add(exact);

    const prev = byFile.get(fileKey);
    if (!prev) {
      byFile.set(fileKey, attr);
      continue;
    }
    if (prev.namespace !== attr.namespace || prev.locale !== attr.locale) {
      warnings.push({
        code: "conflicting-resource-registration",
        message: `Resource file "${fileKey}" registered as ${prev.locale ?? "?"}:${prev.namespace} and ${attr.locale ?? "?"}:${attr.namespace}; keeping ${prev.locale ?? "?"}:${prev.namespace}`,
        path: fileKey,
      });
    }
  }

  const next = sources.map((source) => {
    const attr = byFile.get(toPosix(source.filePath));
    if (!attr) {
      return source;
    }

    const namespace = attr.namespace;
    const locale = attr.locale ?? source.locale;
    if (source.namespace === namespace && source.locale === locale) {
      return source;
    }

    const evidence = [
      ...source.evidence,
      attr.evidence,
      `registration ns='${namespace}' from ${attr.registrationFile}`,
    ];

    return {
      ...source,
      ...(locale !== undefined ? { locale } : {}),
      namespace,
      kind:
        source.kind === "unknown" || source.kind === "embedded-object"
          ? "i18next-resources"
          : source.kind,
      confidence: Math.min(
        1,
        Math.round(Math.max(source.confidence, attr.confidence) * 1000) / 1000,
      ),
      evidence,
      keys: source.keys.map((key) => ({
        ...key,
        ...(locale !== undefined ? { locale } : {}),
        namespace,
        fullKey: `${locale ?? "*"}::${namespace}::${key.key}`,
        confidence: Math.min(
          1,
          Math.round(Math.max(key.confidence, attr.confidence) * 1000) / 1000,
        ),
      })),
    };
  });

  return { sources: next, warnings };
}

type Hit =
  | {
      kind: "file";
      resourceRelativePath: string;
      locale?: string;
      namespace?: string;
      confidence: number;
      evidence: string;
    }
  | {
      kind: "inline";
      regions: JsExtractionRegion[];
      locale?: string;
      namespace?: string;
      confidence: number;
      evidence: string;
    }
  | {
      kind: "single-key";
      key: string;
      value?: TranslationValue;
      locale?: string;
      namespace?: string;
      location: SourceLocation;
      confidence: number;
      evidence: string;
    }
  | {
      kind: "unresolved";
      evidence: string;
    };

function collectRegistrations(
  sourceFile: ts.SourceFile,
  ctx: {
    relativePath: string;
    absolutePath: string;
    importResolver: ImportResolver;
    graphRoot: string;
  },
): Hit[] {
  const hits: Hit[] = [];
  const localObjects = indexLocalObjectBindings(sourceFile);

  traversalApi.forEachChild(sourceFile, (node) => {
    if (!ts.isCallExpression(node)) {
      return;
    }
    const callee = getCalleeName(node.expression);
    if (!callee) {
      return;
    }

    if (callee === "addResourceBundle" && node.arguments.length >= 3) {
      const locale = staticString(node.arguments[0]);
      const namespace = staticString(node.arguments[1]);
      const resource = node.arguments[2];
      if (!namespace || !resource) {
        if (namespace === undefined) {
          hits.push({
            kind: "unresolved",
            evidence: `addResourceBundle namespace is not a static string in ${ctx.relativePath}`,
          });
        }
        return;
      }
      const resolved = resolveResourceArg(resource, sourceFile, ctx, localObjects);
      if (resolved.kind === "file") {
        hits.push({
          kind: "file",
          resourceRelativePath: resolved.relativePath,
          ...(locale !== undefined ? { locale } : {}),
          namespace,
          confidence: locale !== undefined ? 0.92 : 0.75,
          evidence: `addResourceBundle('${locale ?? "?"}', '${namespace}', …)`,
        });
      } else if (resolved.kind === "object") {
        const region = regionFromObject(
          resolved.object,
          sourceFile,
          locale,
          namespace,
          0.9,
          [`addResourceBundle('${locale ?? "?"}', '${namespace}', {…})`],
        );
        if (region) {
          hits.push({
            kind: "inline",
            regions: [region],
            ...(locale !== undefined ? { locale } : {}),
            namespace,
            confidence: 0.9,
            evidence: `addResourceBundle inline resource ns='${namespace}'`,
          });
        }
      } else {
        hits.push({
          kind: "unresolved",
          evidence: `Could not resolve addResourceBundle resource for ns='${namespace}' in ${ctx.relativePath}`,
        });
      }
      return;
    }

    if (callee === "addResource" && node.arguments.length >= 4) {
      const locale = staticString(node.arguments[0]);
      const namespace = staticString(node.arguments[1]);
      const key = staticString(node.arguments[2]);
      const valueNode = node.arguments[3];
      if (!namespace || key === undefined || !valueNode) {
        return;
      }
      const value = staticLeafValue(valueNode);
      hits.push({
        kind: "single-key",
        key,
        ...(value !== undefined ? { value } : {}),
        ...(locale !== undefined ? { locale } : {}),
        namespace,
        location: toLoc(queryApi.getLocation(sourceFile, node.arguments[2]!)),
        confidence: locale !== undefined ? 0.9 : 0.7,
        evidence: `addResource('${locale ?? "?"}', '${namespace}', '${key}', …)`,
      });
      return;
    }

    // init/createInstance({ resources }) is handled by extract-js collectTargets
    // to avoid double-extracting the same object literal.
  });

  return hits;
}

function resolveResourceArg(
  expr: ts.Expression,
  sourceFile: ts.SourceFile,
  ctx: {
    relativePath: string;
    absolutePath: string;
    importResolver: ImportResolver;
    graphRoot: string;
  },
  localObjects: Map<string, ts.ObjectLiteralExpression>,
):
  | { kind: "file"; relativePath: string }
  | { kind: "object"; object: ts.ObjectLiteralExpression }
  | { kind: "unresolved" } {
  const unwrapped = unwrapExpression(expr);

  if (ts.isObjectLiteralExpression(unwrapped)) {
    return { kind: "object", object: unwrapped };
  }

  if (ts.isIdentifier(unwrapped)) {
    const local = localObjects.get(unwrapped.text);
    if (local) {
      return { kind: "object", object: local };
    }

    // Prefer direct import specifier resolution (cheap, no symbol follow).
    const importSpec = findImportSpecifier(sourceFile, unwrapped.text);
    if (importSpec) {
      const resolved = ctx.importResolver.resolveSpecifier({
        fromFile: ctx.absolutePath,
        specifier: importSpec,
      });
      if (resolved) {
        return { kind: "file", relativePath: resolved.relativePath };
      }
    }

    // Fall back to symbol resolution (re-exports / local aliases).
    try {
      const graph = ctx.importResolver.buildGraph({
        entryFiles: [ctx.absolutePath],
      });
      const symbol = ctx.importResolver.resolveSymbol({
        graph,
        filePath: ctx.absolutePath,
        identifier: unwrapped.text,
        position: unwrapped.getStart(sourceFile),
      });
      if (!symbol.unresolved && symbol.resolvedRelativePath) {
        return { kind: "file", relativePath: symbol.resolvedRelativePath };
      }
    } catch {
      // best-effort
    }
  }

  return { kind: "unresolved" };
}

function indexLocalObjectBindings(
  sourceFile: ts.SourceFile,
): Map<string, ts.ObjectLiteralExpression> {
  const map = new Map<string, ts.ObjectLiteralExpression>();
  traversalApi.forEachChild(sourceFile, (node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer
    ) {
      const obj = unwrapObjectLiteral(node.initializer);
      if (obj) {
        map.set(node.name.text, obj);
      }
    }
  });
  return map;
}

function findImportSpecifier(
  sourceFile: ts.SourceFile,
  localName: string,
): string | undefined {
  for (const stmt of sourceFile.statements) {
    if (!ts.isImportDeclaration(stmt) || !ts.isStringLiteral(stmt.moduleSpecifier)) {
      continue;
    }
    const clause = stmt.importClause;
    if (!clause) {
      continue;
    }
    if (clause.name?.text === localName) {
      return stmt.moduleSpecifier.text;
    }
    if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
      for (const el of clause.namedBindings.elements) {
        if (el.name.text === localName) {
          return stmt.moduleSpecifier.text;
        }
      }
    }
  }
  return undefined;
}

function regionFromObject(
  object: ts.ObjectLiteralExpression,
  sourceFile: ts.SourceFile,
  locale: string | undefined,
  namespace: string,
  confidence: number,
  evidence: string[],
): JsExtractionRegion | undefined {
  const located = objectLiteralToLocated(object, sourceFile);
  const entries = flattenLocated(located);
  if (entries.length === 0 || scoreStringLeafRatio(entries) < 0.4) {
    return undefined;
  }
  return {
    entries,
    location: located.location,
    kind: "i18next-resources",
    ...(locale !== undefined ? { locale } : {}),
    namespace,
    confidence,
    evidence: [...evidence, `namespace='${namespace}'`],
  };
}

function objectLiteralToLocated(
  node: ts.ObjectLiteralExpression,
  sourceFile: ts.SourceFile,
): LocatedNode {
  const children = new Map<string, LocatedNode>();
  for (const prop of node.properties) {
    if (ts.isSpreadAssignment(prop) || !ts.isPropertyAssignment(prop)) {
      continue;
    }
    const key = propertyNameText(prop.name);
    if (key === undefined) {
      continue;
    }
    const child = expressionToLocated(prop.initializer, sourceFile);
    if (child) {
      children.set(key, child);
    }
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
): LocatedNode | undefined {
  const unwrapped = unwrapExpression(node);
  if (ts.isObjectLiteralExpression(unwrapped)) {
    return objectLiteralToLocated(unwrapped, sourceFile);
  }
  if (
    ts.isStringLiteral(unwrapped) ||
    ts.isNoSubstitutionTemplateLiteral(unwrapped)
  ) {
    return {
      value: unwrapped.text,
      location: toLoc(queryApi.getLocation(sourceFile, unwrapped)),
    };
  }
  if (ts.isNumericLiteral(unwrapped)) {
    return {
      value: Number(unwrapped.text),
      location: toLoc(queryApi.getLocation(sourceFile, unwrapped)),
    };
  }
  if (unwrapped.kind === ts.SyntaxKind.TrueKeyword) {
    return {
      value: true,
      location: toLoc(queryApi.getLocation(sourceFile, unwrapped)),
    };
  }
  if (unwrapped.kind === ts.SyntaxKind.FalseKeyword) {
    return {
      value: false,
      location: toLoc(queryApi.getLocation(sourceFile, unwrapped)),
    };
  }
  if (unwrapped.kind === ts.SyntaxKind.NullKeyword) {
    return {
      value: null,
      location: toLoc(queryApi.getLocation(sourceFile, unwrapped)),
    };
  }
  return undefined;
}

function unwrapObjectLiteral(
  expr: ts.Expression | undefined,
): ts.ObjectLiteralExpression | undefined {
  if (!expr) {
    return undefined;
  }
  const unwrapped = unwrapExpression(expr);
  return ts.isObjectLiteralExpression(unwrapped) ? unwrapped : undefined;
}

function unwrapExpression(expr: ts.Expression): ts.Expression {
  if (
    ts.isAsExpression(expr) ||
    ts.isSatisfiesExpression(expr) ||
    ts.isParenthesizedExpression(expr) ||
    ts.isTypeAssertionExpression(expr)
  ) {
    return unwrapExpression(expr.expression);
  }
  return expr;
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

function staticString(expr: ts.Expression | undefined): string | undefined {
  if (!expr) {
    return undefined;
  }
  const unwrapped = unwrapExpression(expr);
  if (
    ts.isStringLiteral(unwrapped) ||
    ts.isNoSubstitutionTemplateLiteral(unwrapped)
  ) {
    return unwrapped.text;
  }
  return undefined;
}

function staticLeafValue(
  expr: ts.Expression,
): TranslationValue | undefined {
  const unwrapped = unwrapExpression(expr);
  if (
    ts.isStringLiteral(unwrapped) ||
    ts.isNoSubstitutionTemplateLiteral(unwrapped)
  ) {
    return unwrapped.text;
  }
  if (ts.isNumericLiteral(unwrapped)) {
    return Number(unwrapped.text);
  }
  if (unwrapped.kind === ts.SyntaxKind.TrueKeyword) {
    return true;
  }
  if (unwrapped.kind === ts.SyntaxKind.FalseKeyword) {
    return false;
  }
  if (unwrapped.kind === ts.SyntaxKind.NullKeyword) {
    return null;
  }
  return undefined;
}

function propertyNameText(name: ts.PropertyName): string | undefined {
  if (
    ts.isIdentifier(name) ||
    ts.isStringLiteral(name) ||
    ts.isNumericLiteral(name)
  ) {
    return name.text;
  }
  return undefined;
}

function toLoc(loc: {
  start: number;
  end: number;
  startLine: number;
  startCharacter: number;
  endLine: number;
  endCharacter: number;
}): SourceLocation {
  return {
    start: loc.start,
    end: loc.end,
    startLine: loc.startLine,
    startCharacter: loc.startCharacter,
    endLine: loc.endLine,
    endCharacter: loc.endCharacter,
  };
}

function toPosix(filePath: string): string {
  return filePath.split(path.sep).join("/");
}
