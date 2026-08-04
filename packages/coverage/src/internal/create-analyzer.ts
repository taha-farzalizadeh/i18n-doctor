/**
 * createCoverageAnalyzer — wires merger + analyzer; reuses source discovery.
 * Optionally loads framework defaultLocale via @i18n-unused/context.
 */

import { createContextAnalyzer } from "@i18n-unused/context";
import { createSourceDetector } from "@i18n-unused/sources";
import type { CoverageAnalyzerFactory } from "../api/analyzer.js";
import type {
  AnalyzeCoverageInput,
  AnalyzeFromRootInput,
  CoverageAnalyzer,
  CoverageAnalyzerOptions,
  CoverageDiagnostic,
  CoverageResult,
} from "../api/types.js";
import type { TranslationCatalog } from "@i18n-unused/sources";
import { analyzeCatalogs } from "./analyze-coverage.js";

class DefaultCoverageAnalyzer implements CoverageAnalyzer {
  constructor(private readonly defaults: CoverageAnalyzerOptions = {}) {}

  analyze(input: AnalyzeCoverageInput): CoverageResult {
    return analyzeCatalogs([input.catalog], {
      ...this.defaults,
      ...input.options,
    });
  }

  async analyzeFromRoot(input: AnalyzeFromRootInput): Promise<CoverageResult> {
    const useContext =
      input.options?.useContext ?? this.defaults.useContext ?? true;

    const catalogPromise = createSourceDetector().discover({
      root: input.root,
      ...(input.discover ?? {}),
    });

    let ctx: ReturnType<
      ReturnType<typeof createContextAnalyzer>["analyze"]
    > | undefined;
    if (useContext) {
      try {
        ctx = createContextAnalyzer({ root: input.root }).analyze();
      } catch {
        ctx = undefined;
      }
    }

    const catalog = await catalogPromise;

    const diagnostics: CoverageDiagnostic[] = [];
    const options: CoverageAnalyzerOptions = {
      ...this.defaults,
      ...input.options,
    };

    if (ctx?.effective) {
      const eff = ctx.effective;
      if (!options.baseLocale && eff.defaultLocale) {
        (options as { baseLocale?: string }).baseLocale = eff.defaultLocale;
      }
      if (
        (!options.locales || options.locales.length === 0) &&
        eff.supportedLocales &&
        eff.supportedLocales.length > 0
      ) {
        (options as { locales?: readonly string[] }).locales =
          eff.supportedLocales;
      }
      if (
        (!options.fallbackLocales || options.fallbackLocales.length === 0) &&
        eff.fallbackLocales &&
        eff.fallbackLocales.length > 0
      ) {
        (options as { fallbackLocales?: readonly string[] }).fallbackLocales =
          eff.fallbackLocales;
      }
    } else if (useContext) {
      diagnostics.push({
        code: "context-unavailable",
        severity: "info",
        message:
          "Framework i18n config was not resolved; using catalog heuristics for base locale",
      });
    }

    for (const w of ctx?.warnings ?? []) {
      diagnostics.push({
        code: `context:${w.code}`,
        severity: "info",
        message: w.message,
      });
    }

    return analyzeCatalogs([catalog], options, diagnostics);
  }

  analyzeMonorepo(
    catalogs: readonly TranslationCatalog[],
    options?: CoverageAnalyzerOptions,
  ): CoverageResult {
    return analyzeCatalogs(catalogs, {
      ...this.defaults,
      ...options,
    });
  }
}

export function createCoverageAnalyzer(
  defaults: CoverageAnalyzerOptions = {},
): CoverageAnalyzer {
  return new DefaultCoverageAnalyzer(defaults);
}

export const coverageAnalyzerFactory: CoverageAnalyzerFactory = {
  createCoverageAnalyzer,
};
