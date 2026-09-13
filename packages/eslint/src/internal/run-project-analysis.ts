import fs from "node:fs";
import path from "node:path";
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
import { createOverlayFileSystemFromReadFile } from "./overlay-fs.js";

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
  /** Absolute paths of translation catalog files (for cache invalidation). */
  readonly catalogPaths: readonly string[];
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

  const diskRead = (absolutePath: string): string | undefined => {
    try {
      return fs.readFileSync(absolutePath, "utf8");
    } catch {
      return undefined;
    }
  };
  const readFile = options.readFile
    ? (absolutePath: string): string | undefined => {
        const overlay = options.readFile!(absolutePath);
        return overlay !== undefined ? overlay : diskRead(absolutePath);
      }
    : diskRead;

  const fsPort = options.readFile
    ? createOverlayFileSystemFromReadFile(readFile)
    : undefined;

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
      io: {
        readFile,
        ...(fsPort ? { fs: fsPort } : {}),
      },
    });
    partialResults.push(result.analysis);
    lastSourceCatalog = result.sourceCatalog;
    defaultLocale = result.context.effective.defaultLocale;
  }

  const merged = mergeAnalysisResults(root, partialResults);
  const coverage = lastSourceCatalog
    ? analyzeCoverage(rootConfig, lastSourceCatalog, defaultLocale)
    : undefined;

  const catalogPaths = uniquePaths(
    (lastSourceCatalog?.sources ?? []).map((source) =>
      path.isAbsolute(source.filePath)
        ? source.filePath
        : path.join(lastSourceCatalog!.root, source.filePath),
    ),
  );

  return {
    root,
    issues: merged.issues,
    coverage,
    analyzeScopeCalls,
    catalogPaths,
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
        minConfidence: scope.minConfidence,
      },
    });
  } catch {
    return undefined;
  }
}

function uniquePaths(paths: readonly string[]): readonly string[] {
  return [...new Set(paths.map((p) => path.resolve(p)))].sort();
}
