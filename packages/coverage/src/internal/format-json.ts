/**
 * JSON coverage reporter — stable, deterministic machine output.
 */

import type {
  CoverageIssue,
  CoverageResult,
  KeyCoverage,
} from "../api/types.js";

export interface JsonCoverageReporterOptions {
  /** Include full key list (not only missing/extra). @default true */
  readonly includeAllKeys?: boolean;
  /** Include structured issues[]. @default true */
  readonly includeIssues?: boolean;
  readonly pretty?: boolean;
}

/**
 * Shape matches the product contract:
 * `{ key, baseLocale, locales, missingLocales, files, coverage }`
 */
export function formatCoverageJson(
  result: CoverageResult,
  options: JsonCoverageReporterOptions = {},
): string {
  const includeAllKeys = options.includeAllKeys ?? true;
  const includeIssues = options.includeIssues ?? true;
  const pretty = options.pretty ?? true;

  const payload = {
    root: toPosix(result.root),
    baseLocale: result.baseLocale,
    locales: result.locales,
    namespaces: result.namespaces,
    stats: {
      totalKeys: result.stats.totalKeys,
      comparedLocales: result.stats.comparedLocales,
      missingCount: result.stats.missingCount,
      extraCount: result.stats.extraCount,
      coveragePercent: result.stats.coveragePercent,
      byNamespace: result.stats.byNamespace,
      ...(result.stats.byLocale ? { byLocale: result.stats.byLocale } : {}),
    },
    missing: result.missing.map(serializeKey),
    extra: result.extra.map((e) => ({
      key: e.key,
      ...(e.namespace !== undefined ? { namespace: e.namespace } : {}),
      baseLocale: e.baseLocale,
      locales: e.locales,
      files: e.files.map(serializeFile),
      ...(e.confidence !== undefined ? { confidence: e.confidence } : {}),
    })),
    ...(includeAllKeys ? { keys: result.keys.map(serializeKey) } : {}),
    ...(includeIssues
      ? { issues: (result.issues ?? []).map(serializeIssue) }
      : {}),
    ...(result.diagnostics && result.diagnostics.length > 0
      ? { diagnostics: result.diagnostics }
      : {}),
    timings: {
      totalMs: Math.round(result.timings.totalMs),
      buildMs: Math.round(result.timings.buildMs),
      analyzeMs: Math.round(result.timings.analyzeMs),
    },
  };

  return pretty
    ? `${JSON.stringify(payload, null, 2)}\n`
    : JSON.stringify(payload);
}

function serializeKey(k: KeyCoverage) {
  return {
    key: k.key,
    ...(k.namespace !== undefined ? { namespace: k.namespace } : {}),
    baseLocale: k.baseLocale,
    locales: k.locales,
    missingLocales: k.missingLocales,
    extraLocales: k.extraLocales,
    files: k.files.map(serializeFile),
    coverage: round4(k.coverage),
    ...(k.confidence !== undefined ? { confidence: k.confidence } : {}),
  };
}

function serializeIssue(i: CoverageIssue) {
  return {
    type: i.type,
    key: i.key,
    locale: i.locale,
    baseLocale: i.baseLocale,
    ...(i.namespace !== undefined ? { namespace: i.namespace } : {}),
    filePath: toPosix(i.filePath),
    absolutePath: i.absolutePath,
    line: i.line,
    column: i.column,
    confidence: i.confidence,
    suggestion: i.suggestion,
    ...(i.relatedFilePath !== undefined
      ? { relatedFilePath: toPosix(i.relatedFilePath) }
      : {}),
    ...(i.relatedAbsolutePath !== undefined
      ? { relatedAbsolutePath: i.relatedAbsolutePath }
      : {}),
    ...(i.relatedLine !== undefined ? { relatedLine: i.relatedLine } : {}),
    ...(i.relatedColumn !== undefined
      ? { relatedColumn: i.relatedColumn }
      : {}),
  };
}

function serializeFile(f: KeyCoverage["files"][number]) {
  return {
    relativePath: toPosix(f.relativePath),
    absolutePath: f.absolutePath,
    line: f.line,
    column: f.column,
    ...(f.endLine !== undefined ? { endLine: f.endLine } : {}),
    ...(f.endColumn !== undefined ? { endColumn: f.endColumn } : {}),
    locale: f.locale,
    ...(f.namespace !== undefined ? { namespace: f.namespace } : {}),
  };
}

function toPosix(p: string): string {
  return p.replaceAll("\\", "/");
}

function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}
