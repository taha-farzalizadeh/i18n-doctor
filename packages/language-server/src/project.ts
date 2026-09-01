/**
 * Analyzer host.
 *
 * Owns workspace state and drives the existing i18n-doctor pipeline through
 * `analyzeScope` from @i18n-doctor/cli. Every finding published by the language
 * server originates here; no analysis logic is reimplemented.
 */

import {
  AnalysisCancelledError,
  analyzeScope,
  resolveScanLimits,
  type ScanLimits,
} from "@i18n-doctor/cli";
import {
  DEFAULT_LANGUAGE_SERVER,
  type EffectiveConfig,
  type LanguageServerConfig,
} from "@i18n-doctor/config";
import { createCoverageAnalyzer } from "@i18n-doctor/coverage";
import {
  createDetector,
  type ProjectDetectionResult,
} from "@i18n-doctor/detect";
import type { FileSystemPort } from "@i18n-doctor/scanner";
import { createAnalysisCache, type AnalysisCache } from "./cache.js";
import {
  coverageToDiagnostics,
  issueToDiagnostic,
  namespaceToDiagnostics,
  type LocatedDiagnostic,
} from "./diagnostics.js";
import { describeError, type Logger } from "./logger.js";
import type { PlatformId } from "./workspace.js";
import { discoverWorkspace, type DiscoveredWorkspace } from "./workspace.js";

export interface ProjectIo {
  readonly fs?: FileSystemPort;
  readonly fileExists?: (absolutePath: string) => boolean;
  readonly readFile?: (absolutePath: string) => string | undefined;
  readonly readDir?: (absolutePath: string) => readonly string[] | undefined;
  /** Buffer text for exact diagnostic ranges. */
  readonly textOf?: (absolutePath: string) => string | undefined;
}

export interface ProjectOptions {
  /** Workspace folder to analyze. */
  readonly folder: string;
  readonly logger: Logger;
  readonly io?: ProjectIo;
  readonly platform?: PlatformId;
  readonly limits?: ScanLimits;
  /** Overrides layered on top of the file-based `languageServer` config. */
  readonly overrides?: LanguageServerConfig;
}

export interface ProjectAnalysis {
  readonly root: string;
  readonly diagnostics: readonly LocatedDiagnostic[];
  readonly scopeRoots: readonly string[];
  readonly durationMs: number;
  /** Non-fatal per-scope failures. Analysis continues around them. */
  readonly errors: readonly string[];
  /** Scopes served entirely from cache. */
  readonly cachedScopes: number;
}

export interface Project {
  readonly root: string;
  readonly cache: AnalysisCache;
  /** Re-reads config and scopes from disk on the next analysis. */
  refresh(): void;
  /** Records a changed file so the next analysis reruns only what it affects. */
  invalidateFile(absolutePath: string): void;
  analyze(options?: { readonly signal?: AbortSignal }): Promise<ProjectAnalysis>;
  /** Effective language-server settings, including caller overrides. */
  settings(): Required<LanguageServerConfig>;
  setOverrides(overrides: LanguageServerConfig): void;
  scopeRoots(): readonly string[];
  workspace(): DiscoveredWorkspace;
}

export function createProject(options: ProjectOptions): Project {
  const logger = options.logger.child("project");
  const io = options.io ?? {};
  const limits = options.limits ?? resolveScanLimits();
  const cache = createAnalysisCache(
    options.platform !== undefined ? { platform: options.platform } : {},
  );

  let overrides: LanguageServerConfig = options.overrides ?? {};
  let workspace = discoverWorkspace(options.folder, logger);
  let detection: ProjectDetectionResult | undefined;
  let detectionFailed = false;
  let configDirty = false;

  /** Caller overrides win over the config file, which wins over defaults. */
  const settings = (): Required<LanguageServerConfig> => {
    const base = workspace.scopes[0]?.languageServer ?? DEFAULT_LANGUAGE_SERVER;
    return {
      enabled: overrides.enabled ?? base.enabled,
      debounce: overrides.debounce ?? base.debounce,
      logLevel: overrides.logLevel ?? base.logLevel,
      maxDiagnosticsPerFile:
        overrides.maxDiagnosticsPerFile ?? base.maxDiagnosticsPerFile,
      coverage: overrides.coverage ?? base.coverage,
    };
  };

  const refresh = (): void => {
    configDirty = true;
  };

  const applyRefresh = (): void => {
    configDirty = false;
    try {
      workspace = discoverWorkspace(options.folder, logger);
    } catch (error) {
      // Keep the previous workspace: a half-typed config file must not
      // deconfigure a working server.
      logger.exception("workspace discovery failed", error);
    }
    detection = undefined;
    detectionFailed = false;
    cache.reset();
  };

  const ensureDetection = async (): Promise<ProjectDetectionResult | undefined> => {
    if (detection || detectionFailed) return detection;
    try {
      detection = await createDetector().detect({
        root: workspace.root,
        maxSourceFiles: limits.maxSourceFiles,
      });
    } catch (error) {
      // Detection only supplies library hints; analysis still works without it.
      detectionFailed = true;
      logger.exception("framework detection failed", error);
    }
    return detection;
  };

  return {
    get root() {
      return workspace.root;
    },
    cache,
    refresh,
    settings,

    invalidateFile(absolutePath) {
      const invalidation = cache.invalidateFile(absolutePath);
      if (invalidation.config) configDirty = true;
    },

    setOverrides(next) {
      overrides = next;
    },
    scopeRoots() {
      return workspace.scopes.map(scopeRootOf);
    },
    workspace() {
      return workspace;
    },

    async analyze(analyzeOptions) {
      const signal = analyzeOptions?.signal;
      const started = performance.now();

      if (configDirty) {
        applyRefresh();
      }
      cache.retainScopes(workspace.scopes.map(scopeRootOf));

      const detected = await ensureDetection();
      throwIfCancelled(signal);

      const libraryHints = resolveLibraryHints(detected);
      const config = settings();
      const diagnostics: LocatedDiagnostic[] = [];
      const errors: string[] = [];
      let cachedScopes = 0;

      for (const scope of workspace.scopes) {
        throwIfCancelled(signal);
        const scopeRoot = scopeRootOf(scope);
        const entry = cache.entry(scopeRoot);
        const dirty = entry.dirty;
        const isDirty = dirty.sources || dirty.usages || dirty.config;

        if (!isDirty && entry.analysis) {
          cachedScopes += 1;
        } else {
          try {
            const result = await analyzeScope({
              scope,
              ...(libraryHints ? { libraryHints } : {}),
              limits,
              useDetection: true,
              io: {
                ...(io.fs ? { fs: io.fs } : {}),
                ...(io.fileExists ? { fileExists: io.fileExists } : {}),
                ...(io.readFile ? { readFile: io.readFile } : {}),
                ...(io.readDir ? { readDir: io.readDir } : {}),
              },
              // Reuse whichever catalog this change could not have affected.
              ...(!dirty.sources && entry.sourceCatalog
                ? { sourceCatalog: entry.sourceCatalog }
                : {}),
              ...(!dirty.usages && entry.usageCatalog
                ? { usageCatalog: entry.usageCatalog }
                : {}),
              ...(signal ? { signal } : {}),
            });

            entry.sourceCatalog = result.sourceCatalog;
            entry.usageCatalog = result.usageCatalog;
            entry.analysis = result.analysis;
            delete entry.lastError;

            const coverage = config.coverage
              ? analyzeCoverage(
                  scope,
                  result.sourceCatalog,
                  result.context.effective.defaultLocale,
                  logger,
                )
              : undefined;
            if (coverage) entry.coverage = coverage;
            else delete entry.coverage;

            entry.dirty = { sources: false, usages: false, config: false };
            logger.debug(
              `analyzed ${scopeRoot}: ${result.analysis.issues.length} issues ` +
                `(sources=${dirty.sources ? "fresh" : "cached"}, usages=${dirty.usages ? "fresh" : "cached"})`,
            );
          } catch (error) {
            if (error instanceof AnalysisCancelledError) throw error;
            // Keep the previous result for this scope so the editor does not
            // flicker between findings and nothing on a transient failure.
            const message = `${scopeRoot}: ${describeError(error)}`;
            entry.lastError = message;
            errors.push(message);
            logger.exception(`analysis failed for ${scopeRoot}`, error);
          }
        }

        collectScopeDiagnostics(entry, diagnostics, {
          ...(io.textOf ? { textOf: io.textOf } : {}),
          ...(options.platform ? { platform: options.platform } : {}),
        });
      }

      throwIfCancelled(signal);

      return {
        root: workspace.root,
        diagnostics,
        scopeRoots: workspace.scopes.map(scopeRootOf),
        durationMs: performance.now() - started,
        errors,
        cachedScopes,
      };
    },
  };
}

function collectScopeDiagnostics(
  entry: ReturnType<AnalysisCache["entry"]>,
  out: LocatedDiagnostic[],
  context: {
    readonly textOf?: (absolutePath: string) => string | undefined;
    readonly platform?: PlatformId;
  },
): void {
  const occupied = new Set<string>();

  for (const issue of entry.analysis?.issues ?? []) {
    const located = issueToDiagnostic(issue, context);
    if (!located) continue;
    occupied.add(spanId(located));
    out.push(located);
  }

  if (entry.coverage) {
    out.push(...coverageToDiagnostics(entry.coverage, context));
  }

  if (entry.usageCatalog) {
    const namespaceIssues = namespaceToDiagnostics(
      entry.usageCatalog.usages,
      entry.sourceCatalog?.namespaces ?? [],
      context,
    );
    // A key already reported as missing does not also need a namespace hint.
    for (const located of namespaceIssues) {
      if (occupied.has(spanId(located))) continue;
      out.push(located);
    }
  }
}

function spanId(located: LocatedDiagnostic): string {
  const { start, end } = located.diagnostic.range;
  return [
    located.absolutePath,
    start.line,
    start.character,
    end.line,
    end.character,
  ].join("\u0000");
}

function analyzeCoverage(
  scope: EffectiveConfig,
  catalog: Parameters<
    ReturnType<typeof createCoverageAnalyzer>["analyze"]
  >[0]["catalog"],
  defaultLocale: string | undefined,
  logger: Logger,
): ReturnType<ReturnType<typeof createCoverageAnalyzer>["analyze"]> | undefined {
  try {
    return createCoverageAnalyzer().analyze({
      catalog,
      options: {
        ...(defaultLocale !== undefined ? { baseLocale: defaultLocale } : {}),
        minConfidence: scope.minConfidence,
      },
    });
  } catch (error) {
    logger.exception("coverage analysis failed", error);
    return undefined;
  }
}

function scopeRootOf(scope: EffectiveConfig): string {
  return scope.packageRoot ?? scope.root;
}

function resolveLibraryHints(
  detection: ProjectDetectionResult | undefined,
): readonly string[] | undefined {
  const library = detection?.primary.i18nLibrary?.id;
  return library ? [library] : undefined;
}

function throwIfCancelled(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new AnalysisCancelledError();
}
