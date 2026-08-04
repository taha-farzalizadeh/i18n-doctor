/**
 * Resolve base locale + compared locales from options, catalog, and optional
 * framework EffectiveI18nSettings (from @i18n-unused/context).
 */

import type { CoverageDiagnostic } from "../api/types.js";

export interface LocaleResolutionInput {
  readonly catalogLocales: readonly string[];
  readonly requestedBase?: string;
  readonly requestedLocales?: readonly string[];
  readonly configDefaultLocale?: string;
  readonly configSupportedLocales?: readonly string[];
  readonly configFallbackLocales?: readonly string[];
}

export interface LocaleResolution {
  readonly baseLocale: string;
  readonly locales: readonly string[];
  readonly fallbackLocales: readonly string[];
  readonly diagnostics: readonly CoverageDiagnostic[];
  readonly baseSource:
    | "option"
    | "config"
    | "heuristic-en"
    | "heuristic-first"
    | "fallback";
}

export function resolveLocales(
  input: LocaleResolutionInput,
): LocaleResolution {
  const diagnostics: CoverageDiagnostic[] = [];
  const catalogSet = new Set(input.catalogLocales);

  // Supported locales: explicit option > config > catalog
  let locales: string[];
  if (input.requestedLocales && input.requestedLocales.length > 0) {
    locales = uniqueSorted(input.requestedLocales);
    for (const l of locales) {
      if (!catalogSet.has(l) && l !== input.requestedBase) {
        diagnostics.push({
          code: "locale-not-in-catalog",
          severity: "warning",
          message: `Requested locale "${l}" has no keys in the translation catalog`,
          hint: "Check locale folder names and source detection confidence.",
        });
      }
    }
  } else if (
    input.configSupportedLocales &&
    input.configSupportedLocales.length > 0
  ) {
    locales = uniqueSorted([
      ...input.configSupportedLocales,
      ...input.catalogLocales,
    ]);
  } else {
    locales = uniqueSorted(input.catalogLocales);
  }

  const fallbackLocales = uniqueSorted(input.configFallbackLocales ?? []);

  // Base locale resolution chain
  let baseLocale: string;
  let baseSource: LocaleResolution["baseSource"];

  if (input.requestedBase) {
    baseLocale = input.requestedBase;
    baseSource = "option";
    if (locales.length > 0 && !locales.includes(baseLocale) && !catalogSet.has(baseLocale)) {
      diagnostics.push({
        code: "base-locale-missing",
        severity: "warning",
        message: `Base locale "${baseLocale}" has no keys in the catalog`,
        hint: "Coverage will treat every non-base key as extra until base files are detected.",
      });
    }
  } else if (
    input.configDefaultLocale &&
    (catalogSet.has(input.configDefaultLocale) ||
      locales.includes(input.configDefaultLocale))
  ) {
    baseLocale = input.configDefaultLocale;
    baseSource = "config";
  } else if (input.configDefaultLocale) {
    diagnostics.push({
      code: "config-default-locale-unresolved",
      severity: "info",
      message: `Framework defaultLocale "${input.configDefaultLocale}" was not found among catalog locales; falling back to heuristics`,
    });
    const picked = pickHeuristicBase(locales.length ? locales : input.catalogLocales);
    baseLocale = picked.base;
    baseSource = picked.source;
  } else {
    const picked = pickHeuristicBase(locales.length ? locales : input.catalogLocales);
    baseLocale = picked.base;
    baseSource = picked.source;
  }

  // Ensure base is in the compared set
  if (!locales.includes(baseLocale)) {
    locales = uniqueSorted([baseLocale, ...locales]);
  }

  for (const fb of fallbackLocales) {
    if (!catalogSet.has(fb) && !locales.includes(fb)) {
      diagnostics.push({
        code: "fallback-locale-missing",
        severity: "info",
        message: `Fallback locale "${fb}" has no keys in the catalog`,
      });
    }
  }

  if (locales.length <= 1 && catalogSet.size <= 1) {
    diagnostics.push({
      code: "single-locale",
      severity: "info",
      message: "Only one locale detected — coverage comparison is a no-op",
    });
  }

  return {
    baseLocale,
    locales,
    fallbackLocales,
    diagnostics,
    baseSource,
  };
}

export function pickBaseLocale(
  locales: readonly string[],
  requested?: string,
): string {
  return resolveLocales({
    catalogLocales: locales,
    ...(requested !== undefined ? { requestedBase: requested } : {}),
  }).baseLocale;
}

function pickHeuristicBase(locales: readonly string[]): {
  base: string;
  source: "heuristic-en" | "heuristic-first" | "fallback";
} {
  if (locales.includes("en")) return { base: "en", source: "heuristic-en" };
  if (locales.includes("en-US")) return { base: "en-US", source: "heuristic-en" };
  if (locales.includes("en-GB")) return { base: "en-GB", source: "heuristic-en" };
  if (locales[0]) return { base: locales[0], source: "heuristic-first" };
  return { base: "en", source: "fallback" };
}

function uniqueSorted(items: readonly string[]): string[] {
  return [...new Set(items)].sort((a, b) => a.localeCompare(b));
}
