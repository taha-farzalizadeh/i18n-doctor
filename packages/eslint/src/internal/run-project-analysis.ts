import fs from "node:fs";
import {
  analyzeScope,
  discoverProject,
  mergeAnalysisResults,
  resolveAnalysisScopes,
} from "@i18n-doctor/cli";
import { createEffectiveConfigResolver } from "@i18n-doctor/config";
import {
  createCoverageAnalyzer,
  type CoverageResult,
} from "@i18n-doctor/coverage";
import type { Issue } from "@i18n-doctor/issues";

export interface RunProjectAnalysisOptions {
  readonly cwd: string;
  readonly filename: string;
  readonly readFile?: (absolutePath: string) => string | undefined;
}

export interface AnalysisSessionSnapshot {
  readonly root: string;
  readonly issues: readonly Issue[];
  readonly coverage: CoverageResult | undefined;
  readonly analyzeScopeCalls: number;
}

export async function runProjectAnalysis(
  options: RunProjectAnalysisOptions,
): Promise<AnalysisSessionSnapshot> {
  const project = discoverProject({
    cwd: options.cwd,
    pathArg: options.filename,
  });
  const root = project.root;

  const resolver = createEffectiveConfigResolver();
  const rootConfig = resolver.resolve({ root });
  const scopes = resolveAnalysisScopes(resolver, rootConfig, { root });

  const readFile =
    options.readFile ??
    ((absolutePath: string): string | undefined => {
      try {
        return fs.readFileSync(absolutePath, "utf8");
      } catch {
        return undefined;
      }
    });

  const partialResults = [];
  let analyzeScopeCalls = 0;
  let lastSourceCatalog: Awaited<
    ReturnType<typeof analyzeScope>
  >["sourceCatalog"] | undefined;
  let defaultLocale: string | undefined;

  for (const scope of scopes) {
    analyzeScopeCalls += 1;
    const result = await analyzeScope({
      scope,
      io: { readFile },
    });
    partialResults.push(result.analysis);
    lastSourceCatalog = result.sourceCatalog;
    defaultLocale = result.context.effective.defaultLocale;
  }

  const merged = mergeAnalysisResults(root, partialResults);
  const coverage = lastSourceCatalog
    ? analyzeCoverage(rootConfig, lastSourceCatalog, defaultLocale)
    : undefined;

  return {
    root,
    issues: merged.issues,
    coverage,
    analyzeScopeCalls,
  };
}

function analyzeCoverage(
  scope: ReturnType<ReturnType<typeof createEffectiveConfigResolver>["resolve"]>,
  catalog: Parameters<
    ReturnType<typeof createCoverageAnalyzer>["analyze"]
  >[0]["catalog"],
  defaultLocale: string | undefined,
): CoverageResult | undefined {
  try {
    return createCoverageAnalyzer().analyze({
      catalog,
      options: {
        ...(defaultLocale !== undefined ? { baseLocale: defaultLocale } : {}),
        ...(scope.ignoreKeys.length > 0
          ? { ignoreKeys: scope.ignoreKeys }
          : {}),
        minConfidence: scope.minConfidence,
      },
    });
  } catch {
    return undefined;
  }
}
