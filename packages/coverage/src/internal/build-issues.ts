/**
 * Build structured CoverageIssue[] from analysis results.
 */

import type {
  CoverageIssue,
  ExtraKeyFinding,
  KeyCoverage,
} from "../api/types.js";

export function buildCoverageIssues(
  missing: readonly KeyCoverage[],
  extra: readonly ExtraKeyFinding[],
): CoverageIssue[] {
  const issues: CoverageIssue[] = [];

  for (const m of missing) {
    const baseFile = m.files.find((f) => f.locale === m.baseLocale);
    const confidence = m.confidence ?? maxConfidence(m);
    for (const locale of m.missingLocales) {
      // Primary location: base definition (what needs mirroring)
      const filePath = baseFile?.relativePath ?? "";
      const absolutePath = baseFile?.absolutePath ?? "";
      const line = baseFile?.line ?? 1;
      const column = baseFile?.column ?? 1;
      issues.push({
        type: "missing-translation",
        key: m.key,
        locale,
        baseLocale: m.baseLocale,
        ...(m.namespace !== undefined ? { namespace: m.namespace } : {}),
        filePath,
        absolutePath,
        line,
        column,
        confidence,
        suggestion: suggestMissing(m.key, locale, m.namespace, baseFile?.relativePath),
        ...(baseFile
          ? {
              relatedFilePath: baseFile.relativePath,
              relatedAbsolutePath: baseFile.absolutePath,
              relatedLine: baseFile.line,
              relatedColumn: baseFile.column,
            }
          : {}),
      });
    }
  }

  for (const e of extra) {
    const confidence = e.confidence ?? 1;
    for (const locale of e.locales) {
      const file = e.files.find((f) => f.locale === locale) ?? e.files[0];
      if (!file) continue;
      issues.push({
        type: "extra-translation",
        key: e.key,
        locale,
        baseLocale: e.baseLocale,
        ...(e.namespace !== undefined ? { namespace: e.namespace } : {}),
        filePath: file.relativePath,
        absolutePath: file.absolutePath,
        line: file.line,
        column: file.column,
        confidence,
        suggestion: suggestExtra(e.key, e.baseLocale, e.namespace),
      });
    }
  }

  issues.sort(compareIssues);
  return issues;
}

function suggestMissing(
  key: string,
  locale: string,
  namespace: string | undefined,
  basePath: string | undefined,
): string {
  const ns = namespace ? ` (namespace "${namespace}")` : "";
  const from = basePath ? ` (defined in ${basePath})` : "";
  return `Add key "${key}"${ns} to locale "${locale}"${from}`;
}

function suggestExtra(
  key: string,
  baseLocale: string,
  namespace: string | undefined,
): string {
  const ns = namespace ? ` in namespace "${namespace}"` : "";
  return `Remove key "${key}"${ns} or add it to base locale "${baseLocale}"`;
}

function maxConfidence(m: KeyCoverage): number {
  // files don't carry confidence — default high when present in base
  return m.locales[m.baseLocale] ? 1 : 0.8;
}

function compareIssues(a: CoverageIssue, b: CoverageIssue): number {
  const byType = a.type.localeCompare(b.type);
  if (byType !== 0) return byType;
  const byNs = (a.namespace ?? "").localeCompare(b.namespace ?? "");
  if (byNs !== 0) return byNs;
  const byKey = a.key.localeCompare(b.key);
  if (byKey !== 0) return byKey;
  return a.locale.localeCompare(b.locale);
}
