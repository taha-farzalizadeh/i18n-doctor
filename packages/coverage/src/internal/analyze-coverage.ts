/**
 * Coverage Analyzer — compare locales against a base locale.
 * Deterministic ordering and coverage math; no re-parsing.
 */

import path from "node:path";
import type {
  TranslationCatalog,
  TranslationKeyDefinition,
} from "@i18n-doctor/sources";
import type {
  CoverageAnalyzerOptions,
  CoverageDiagnostic,
  CoverageFileLocation,
  CoverageResult,
  CoverageStats,
  ExtraKeyFinding,
  KeyCoverage,
  LocaleCoverageStat,
  MergedLocaleModel,
  NamespaceCoverage,
} from "../api/types.js";
import { buildCoverageIssues } from "./build-issues.js";
import { DEFAULT_NS, mergeLocaleCatalogs } from "./merge-locales.js";
import { pickBaseLocale, resolveLocales } from "./resolve-locales.js";

export { pickBaseLocale } from "./resolve-locales.js";

export function analyzeMergedModel(
  model: MergedLocaleModel,
  options: CoverageAnalyzerOptions = {},
  extraDiagnostics: readonly CoverageDiagnostic[] = [],
): CoverageResult {
  const analyzeStart = now();

  const resolution = resolveLocales({
    catalogLocales: model.locales,
    ...(options.baseLocale !== undefined
      ? { requestedBase: options.baseLocale }
      : {}),
    ...(options.locales !== undefined
      ? { requestedLocales: options.locales }
      : {}),
    ...(options.fallbackLocales !== undefined
      ? { configFallbackLocales: options.fallbackLocales }
      : {}),
  });

  const baseLocale = resolution.baseLocale;
  const localeList = resolution.locales;

  const allKeys: KeyCoverage[] = [];
  const missing: KeyCoverage[] = [];
  const extra: ExtraKeyFinding[] = [];
  const nsStats: NamespaceCoverage[] = [];

  // Per-locale tallies vs base key set
  const localePresent = new Map<string, number>();
  const localeExtra = new Map<string, number>();
  for (const l of localeList) {
    localePresent.set(l, 0);
    localeExtra.set(l, 0);
  }

  let presentCells = 0;
  let totalCells = 0;
  let baseKeyCount = 0;

  for (const ns of model.namespaces) {
    const bucket = model.byNamespace.get(ns)!;
    const nsLabel = ns === DEFAULT_NS ? undefined : ns;
    let nsMissing = 0;
    let nsExtra = 0;
    let nsPresent = 0;
    let nsTotal = 0;
    let nsKeyCount = 0;

    // Pre-sorted keys for determinism (Map iteration order is insertion — re-sort)
    const keys = sortStrings([...bucket.entries.keys()]);

    for (const key of keys) {
      const byLocale = bucket.entries.get(key)!;
      const inBase = byLocale.has(baseLocale);

      const presence: Record<string, boolean> = {};
      const missingLocales: string[] = [];
      const files: CoverageFileLocation[] = [];
      let maxConf = 0;

      for (const locale of localeList) {
        const def = byLocale.get(locale);
        const present = def !== undefined;
        presence[locale] = present;
        if (def) {
          files.push(toFileLocation(model.root, def, locale, nsLabel));
          if (def.confidence > maxConf) maxConf = def.confidence;
        }
      }

      // Stable file order by locale
      files.sort((a, b) => a.locale.localeCompare(b.locale));

      if (!inBase) {
        const extrasOnly = localeList.filter(
          (l) => l !== baseLocale && byLocale.has(l),
        );
        if (extrasOnly.length === 0) continue;

        nsExtra += 1;
        nsKeyCount += 1;
        for (const locale of extrasOnly) {
          localeExtra.set(locale, (localeExtra.get(locale) ?? 0) + 1);
        }

        const findingFiles = extrasOnly.map((locale) =>
          toFileLocation(model.root, byLocale.get(locale)!, locale, nsLabel),
        );
        findingFiles.sort((a, b) => a.locale.localeCompare(b.locale));

        const finding: ExtraKeyFinding = {
          key,
          ...(nsLabel !== undefined ? { namespace: nsLabel } : {}),
          baseLocale,
          locales: extrasOnly,
          files: findingFiles,
          confidence: maxConf || 1,
        };
        extra.push(finding);

        const coverage =
          localeList.length === 0
            ? 0
            : countTrue(presence, localeList) / localeList.length;

        allKeys.push({
          key,
          ...(nsLabel !== undefined ? { namespace: nsLabel } : {}),
          baseLocale,
          locales: presence,
          missingLocales: [baseLocale],
          extraLocales: extrasOnly,
          files,
          coverage,
          confidence: maxConf || 1,
        });
        continue;
      }

      // Base key — count coverage cells
      baseKeyCount += 1;
      nsKeyCount += 1;
      for (const locale of localeList) {
        nsTotal += 1;
        totalCells += 1;
        if (presence[locale]) {
          nsPresent += 1;
          presentCells += 1;
          localePresent.set(locale, (localePresent.get(locale) ?? 0) + 1);
        } else if (locale !== baseLocale) {
          missingLocales.push(locale);
        }
      }

      const coverage =
        localeList.length === 0
          ? 0
          : countTrue(presence, localeList) / localeList.length;

      const kc: KeyCoverage = {
        key,
        ...(nsLabel !== undefined ? { namespace: nsLabel } : {}),
        baseLocale,
        locales: presence,
        missingLocales,
        extraLocales: [],
        files,
        coverage,
        confidence: maxConf || 1,
      };
      allKeys.push(kc);
      if (missingLocales.length > 0) {
        missing.push(kc);
        nsMissing += 1;
      }
    }

    nsStats.push({
      namespace: nsLabel ?? "(default)",
      keyCount: nsKeyCount,
      missingCount: nsMissing,
      extraCount: nsExtra,
      coverage: nsTotal === 0 ? 1 : round4(nsPresent / nsTotal),
    });
  }

  allKeys.sort(compareKeyCoverage);
  missing.sort(compareKeyCoverage);
  extra.sort((a, b) => {
    const ns = (a.namespace ?? "").localeCompare(b.namespace ?? "");
    if (ns !== 0) return ns;
    return a.key.localeCompare(b.key);
  });

  const byLocale: LocaleCoverageStat[] = localeList.map((locale) => {
    const presentCount = localePresent.get(locale) ?? 0;
    return {
      locale,
      presentCount,
      baseKeyCount,
      coverage: baseKeyCount === 0 ? 1 : round4(presentCount / baseKeyCount),
      extraCount: localeExtra.get(locale) ?? 0,
    };
  });

  const coveragePercent =
    totalCells === 0 ? 100 : round2((presentCells / totalCells) * 100);

  const stats: CoverageStats = {
    totalKeys: allKeys.length,
    comparedLocales: localeList.length,
    missingCount: missing.length,
    extraCount: extra.length,
    coveragePercent,
    byNamespace: nsStats,
    byLocale,
  };

  const issues = buildCoverageIssues(missing, extra);
  const diagnostics = [
    ...(model.diagnostics ?? []),
    ...resolution.diagnostics,
    ...extraDiagnostics,
  ].sort((a, b) => a.message.localeCompare(b.message));

  return {
    root: model.root,
    baseLocale,
    locales: localeList,
    namespaces: model.namespaces.map((n) =>
      n === DEFAULT_NS ? "(default)" : n,
    ),
    keys: allKeys,
    missing,
    extra,
    stats,
    timings: {
      totalMs: 0,
      buildMs: 0,
      analyzeMs: now() - analyzeStart,
    },
    issues,
    diagnostics,
  };
}

export function analyzeCatalogs(
  catalogs: readonly TranslationCatalog[],
  options: CoverageAnalyzerOptions = {},
  extraDiagnostics: readonly CoverageDiagnostic[] = [],
): CoverageResult {
  const t0 = now();
  // Skip tree build during flat coverage analysis (large-catalog optimization).
  const model = mergeLocaleCatalogs(catalogs, {
    ...(options.locales ? { locales: options.locales } : {}),
    ...(options.namespaces ? { namespaces: options.namespaces } : {}),
    ...(options.ignoreKeys ? { ignoreKeys: options.ignoreKeys } : {}),
    ...(options.minConfidence !== undefined
      ? { minConfidence: options.minConfidence }
      : {}),
    buildTrees: false,
  });
  const buildMs = now() - t0;
  const result = analyzeMergedModel(model, options, extraDiagnostics);
  const totalMs = now() - t0;
  return {
    ...result,
    timings: {
      totalMs,
      buildMs,
      analyzeMs: result.timings.analyzeMs,
    },
  };
}

function toFileLocation(
  root: string,
  def: TranslationKeyDefinition,
  locale: string,
  namespace: string | undefined,
): CoverageFileLocation {
  const absolutePath = path.isAbsolute(def.filePath)
    ? path.normalize(def.filePath)
    : path.normalize(path.resolve(root, def.filePath));
  const relativePath = path.isAbsolute(def.filePath)
    ? toPosix(path.relative(root, def.filePath))
    : toPosix(def.filePath);

  return {
    absolutePath,
    relativePath,
    line: def.location.startLine,
    column: def.location.startCharacter,
    ...(def.location.endLine !== undefined
      ? { endLine: def.location.endLine }
      : {}),
    ...(def.location.endCharacter !== undefined
      ? { endColumn: def.location.endCharacter }
      : {}),
    locale,
    ...(namespace !== undefined ? { namespace } : {}),
  };
}

function toPosix(p: string): string {
  return p.replaceAll("\\", "/");
}

function sortStrings(items: string[]): string[] {
  return items.sort((a, b) => a.localeCompare(b));
}

function countTrue(
  presence: Record<string, boolean>,
  locales: readonly string[],
): number {
  let n = 0;
  for (const l of locales) {
    if (presence[l]) n += 1;
  }
  return n;
}

function compareKeyCoverage(a: KeyCoverage, b: KeyCoverage): number {
  const ns = (a.namespace ?? "").localeCompare(b.namespace ?? "");
  if (ns !== 0) return ns;
  return a.key.localeCompare(b.key);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}

function now(): number {
  return performance.now();
}

/** Re-export model type for tests. */
export type { MergedLocaleModel };
