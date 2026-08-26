/**
 * Single-scope analysis pipeline — wires existing packages only.
 *
 * Shared by the `check` command and long-lived hosts (language server).
 * No analyzer logic lives here: sources, usages, context, and issue matching
 * all come from their owning packages.
 */

import {
  createIgnoreEngine,
  createSuppressionEngine,
  type EffectiveConfig,
} from "@i18n-doctor/config";
import {
  createContextAnalyzer,
  type TranslationContext,
} from "@i18n-doctor/context";
import {
  createIssueEngine,
  definitionsFromCatalog,
  dynamicUsagesFromCatalog,
  untranslatedLiteralsFromCatalog,
  usagesFromCatalog,
  type AnalysisResult,
  type IssueSeverity,
} from "@i18n-doctor/issues";
import type { FileSystemPort } from "@i18n-doctor/scanner";
import {
  createSourceDetector,
  type TranslationCatalog,
} from "@i18n-doctor/sources";
import { createUsageDetector, type UsageCatalog } from "@i18n-doctor/usages";
import {
  applyIssuePolicies,
  filterDefinitionFacts,
  filterDynamicUsageFacts,
  filterUntranslatedLiteralFacts,
  filterUsageFacts,
} from "./filter.js";
import { resolveScanLimits } from "./scan-limits.js";

/** Thrown when an analysis is abandoned through {@link AnalyzeScopeInput.signal}. */
export class AnalysisCancelledError extends Error {
  constructor(message = "Analysis cancelled") {
    super(message);
    this.name = "AnalysisCancelledError";
  }
}

/**
 * Filesystem overrides. Defaults read from disk.
 *
 * `fs` is forwarded to the project scanner (source/usage discovery); the
 * synchronous hooks are used for framework config discovery and inline
 * suppression comments. Editors pass unsaved buffer contents this way.
 */
export interface ScopeAnalysisIo {
  readonly fs?: FileSystemPort;
  readonly fileExists?: (absolutePath: string) => boolean;
  readonly readFile?: (absolutePath: string) => string | undefined;
  readonly readDir?: (absolutePath: string) => readonly string[] | undefined;
}

export interface ScopeAnalysisFilters {
  readonly locale?: string;
  readonly namespace?: string;
}

export interface AnalyzeScopeInput {
  /** Effective config for this scope (workspace root or monorepo package). */
  readonly scope: EffectiveConfig;
  readonly filters?: ScopeAnalysisFilters;
  readonly libraryHints?: readonly string[];
  readonly limits?: {
    readonly maxCandidates: number;
    readonly maxFiles: number;
  };
  /** Run framework/i18n detection for library hints. @default true */
  readonly useDetection?: boolean;
  readonly io?: ScopeAnalysisIo;
  /**
   * Reuse a previously discovered translation catalog instead of rediscovering.
   * Only safe when no translation source file changed.
   */
  readonly sourceCatalog?: TranslationCatalog;
  /**
   * Reuse a previously detected usage catalog instead of redetecting.
   * Only safe when no analyzed source file changed.
   */
  readonly usageCatalog?: UsageCatalog;
  readonly signal?: AbortSignal;
}

export interface ScopeAnalysis {
  readonly analysis: AnalysisResult;
  readonly sourceCatalog: TranslationCatalog;
  readonly usageCatalog: UsageCatalog;
  readonly context: TranslationContext;
  readonly sourcesMs: number;
  readonly usagesMs: number;
  readonly analyzeMs: number;
  readonly filterMs: number;
}

export async function analyzeScope(
  input: AnalyzeScopeInput,
): Promise<ScopeAnalysis> {
  const root = input.scope.packageRoot ?? input.scope.root;
  const limits = input.limits ?? resolveScanLimits();
  const useDetection = input.useDetection ?? true;
  const filters = input.filters ?? {};
  const io = input.io ?? {};

  throwIfCancelled(input.signal);

  // Parallel source + usage collection (largest wall-time win on big trees).
  // Either side can be served from a caller-supplied catalog.
  const tSources = now();
  const tUsages = now();
  const [sourceCatalog, usageCatalog] = await Promise.all([
    input.sourceCatalog ??
      createSourceDetector().discover({
        root,
        useDetection,
        ...(input.libraryHints ? { libraryHints: input.libraryHints } : {}),
        minConfidence: input.scope.minConfidence,
        maxCandidates: limits.maxCandidates,
        ...(io.fs ? { fs: io.fs } : {}),
      }),
    input.usageCatalog ??
      createUsageDetector().detect({
        root,
        useDetection,
        ...(input.libraryHints ? { libraryHints: input.libraryHints } : {}),
        minConfidence: input.scope.minConfidence,
        maxFiles: limits.maxFiles,
        ...(io.fs ? { fs: io.fs } : {}),
      }),
  ]);
  // Attribute wall time of the parallel section to both (sum used for totals).
  const parallelMs = Math.max(now() - tSources, now() - tUsages);
  const sourcesMs = parallelMs / 2;
  const usagesMs = parallelMs / 2;

  throwIfCancelled(input.signal);

  const ignore = createIgnoreEngine(input.scope);
  const factFilters = {
    ...(filters.locale !== undefined ? { locale: filters.locale } : {}),
    ...(filters.namespace !== undefined ? { namespace: filters.namespace } : {}),
  };

  const definitions = filterDefinitionFacts(
    definitionsFromCatalog(sourceCatalog),
    ignore,
    factFilters,
  );
  const usages = filterUsageFacts(
    usagesFromCatalog(usageCatalog),
    ignore,
    factFilters,
  );
  const dynamicUsages = filterDynamicUsageFacts(
    dynamicUsagesFromCatalog(usageCatalog),
    ignore,
    factFilters,
  );
  const untranslatedLiterals = filterUntranslatedLiteralFacts(
    untranslatedLiteralsFromCatalog(usageCatalog),
    ignore,
  );

  const severities = toEngineSeverities(input.scope);
  const context = createContextAnalyzer({
    root,
    ...(io.fileExists ? { fileExists: io.fileExists } : {}),
    ...(io.readFile ? { readFile: io.readFile } : {}),
    ...(io.readDir ? { readDir: io.readDir } : {}),
  }).analyze({ packageRoot: root });
  const defaultNS = context.effective.defaultNS;
  const fallbackNS = context.effective.fallbackNS;

  throwIfCancelled(input.signal);

  let t0 = now();
  const raw = createIssueEngine().analyze({
    root,
    definitions,
    usages,
    dynamicUsages,
    untranslatedLiterals,
    options: {
      minConfidence: input.scope.minConfidence,
      ...(filters.locale !== undefined
        ? { defaultLocale: filters.locale }
        : context.effective.defaultLocale !== undefined
          ? { defaultLocale: context.effective.defaultLocale }
          : {}),
      ...(defaultNS !== undefined ? { defaultNS } : {}),
      ...(fallbackNS !== undefined && fallbackNS.length > 0
        ? { fallbackNS }
        : {}),
      ...(severities ? { severities } : {}),
    },
  });
  const analyzeMs = now() - t0;

  t0 = now();
  const analysis = applyIssuePolicies(
    raw,
    input.scope,
    createSuppressionEngine(),
    io.readFile,
  );
  const filterMs = now() - t0;

  return {
    analysis,
    sourceCatalog,
    usageCatalog,
    context,
    sourcesMs,
    usagesMs,
    analyzeMs,
    filterMs,
  };
}

function throwIfCancelled(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new AnalysisCancelledError();
  }
}

function toEngineSeverities(config: EffectiveConfig):
  | {
      unusedKey?: IssueSeverity;
      missingKey?: IssueSeverity;
      duplicateKey?: IssueSeverity;
      untranslatedText?: IssueSeverity;
    }
  | undefined {
  const mapOne = (
    rule:
      | "unused-key"
      | "missing-key"
      | "duplicate-key"
      | "untranslated-text",
  ): IssueSeverity | undefined => {
    const s = config.rules.getSeverity(rule);
    if (s === "off") return undefined;
    if (s === "info" || s === "warning" || s === "error") return s;
    return undefined;
  };

  const unusedKey = mapOne("unused-key");
  const missingKey = mapOne("missing-key");
  const duplicateKey = mapOne("duplicate-key");
  const untranslatedText = mapOne("untranslated-text");

  const out: {
    unusedKey?: IssueSeverity;
    missingKey?: IssueSeverity;
    duplicateKey?: IssueSeverity;
    untranslatedText?: IssueSeverity;
  } = {};
  if (unusedKey) out.unusedKey = unusedKey;
  if (missingKey) out.missingKey = missingKey;
  if (duplicateKey) out.duplicateKey = duplicateKey;
  if (untranslatedText) out.untranslatedText = untranslatedText;
  return Object.keys(out).length > 0 ? out : undefined;
}

function now(): number {
  return performance.now();
}
