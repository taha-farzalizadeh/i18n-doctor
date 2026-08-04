/**
 * Translation Coverage / Locale Consistency types.
 *
 * Consumes TranslationCatalog from @i18n-unused/sources — no re-parsing.
 * Additive extensions only — existing fields remain stable.
 */

import type {
  TranslationCatalog,
  TranslationKeyDefinition,
} from "@i18n-unused/sources";

/** Exact location of a key definition in a locale file. */
export interface CoverageFileLocation {
  readonly absolutePath: string;
  readonly relativePath: string;
  readonly line: number;
  readonly column: number;
  readonly endLine?: number;
  readonly endColumn?: number;
  readonly locale: string;
  readonly namespace?: string;
}

/**
 * Per-key coverage across locales (user-facing shape).
 *
 * ```json
 * {
 *   "key": "auth.login",
 *   "baseLocale": "en",
 *   "locales": { "en": true, "fa": false },
 *   "missingLocales": ["fa"],
 *   "files": [...],
 *   "coverage": 0.5
 * }
 * ```
 */
export interface KeyCoverage {
  readonly key: string;
  readonly namespace?: string;
  readonly baseLocale: string;
  /** Presence map: locale id → defined in that locale. */
  readonly locales: Readonly<Record<string, boolean>>;
  readonly missingLocales: readonly string[];
  /** Locales that have this key while the base locale does not (extra). */
  readonly extraLocales: readonly string[];
  /** Exact definition sites for locales where the key exists. */
  readonly files: readonly CoverageFileLocation[];
  /** Fraction of compared locales that define this key [0, 1]. */
  readonly coverage: number;
  /** Max confidence among definitions for this key. */
  readonly confidence?: number;
}

/** Key present in a non-base locale but absent from the base locale. */
export interface ExtraKeyFinding {
  readonly key: string;
  readonly namespace?: string;
  readonly baseLocale: string;
  readonly locales: readonly string[];
  readonly files: readonly CoverageFileLocation[];
  readonly confidence?: number;
}

/** Structured coverage finding for reporters / CI. */
export type CoverageIssueType =
  | "missing-translation"
  | "extra-translation"
  | "duplicate-locale-definition";

export interface CoverageIssue {
  readonly type: CoverageIssueType;
  readonly key: string;
  readonly locale: string;
  readonly baseLocale: string;
  readonly namespace?: string;
  /** Relative POSIX path for the primary location. */
  readonly filePath: string;
  readonly absolutePath: string;
  readonly line: number;
  readonly column: number;
  readonly confidence: number;
  readonly suggestion: string;
  /** Base-locale definition site (for missing-translation). */
  readonly relatedFilePath?: string;
  readonly relatedAbsolutePath?: string;
  readonly relatedLine?: number;
  readonly relatedColumn?: number;
}

export interface CoverageDiagnostic {
  readonly code: string;
  readonly severity: "error" | "warning" | "info";
  readonly message: string;
  readonly hint?: string;
}

export interface NamespaceCoverage {
  readonly namespace: string;
  readonly keyCount: number;
  readonly missingCount: number;
  readonly extraCount: number;
  /** Overall presence ratio for keys×locales in this namespace [0, 1]. */
  readonly coverage: number;
}

/** Per-locale completeness vs the base key set. */
export interface LocaleCoverageStat {
  readonly locale: string;
  /** Base keys present in this locale. */
  readonly presentCount: number;
  /** Base key count. */
  readonly baseKeyCount: number;
  /** presentCount / baseKeyCount [0, 1]. */
  readonly coverage: number;
  /** Extra keys in this locale not in base. */
  readonly extraCount: number;
}

export interface CoverageStats {
  readonly totalKeys: number;
  readonly comparedLocales: number;
  readonly missingCount: number;
  readonly extraCount: number;
  /**
   * Overall coverage percentage [0, 100].
   * Among (baseKey × locale) cells: fraction present × 100.
   */
  readonly coveragePercent: number;
  readonly byNamespace: readonly NamespaceCoverage[];
  /** Per-locale coverage vs base key set (additive). */
  readonly byLocale?: readonly LocaleCoverageStat[];
}

export interface CoverageResult {
  readonly root: string;
  readonly baseLocale: string;
  readonly locales: readonly string[];
  readonly namespaces: readonly string[];
  /** All keys observed (base ∪ others), with presence maps. */
  readonly keys: readonly KeyCoverage[];
  /** Subset: missing in at least one compared locale (relative to base). */
  readonly missing: readonly KeyCoverage[];
  /** Keys that exist only outside the base locale. */
  readonly extra: readonly ExtraKeyFinding[];
  readonly stats: CoverageStats;
  readonly timings: {
    readonly totalMs: number;
    readonly buildMs: number;
    readonly analyzeMs: number;
  };
  /** Structured issues (additive — one per missing/extra locale pair). */
  readonly issues?: readonly CoverageIssue[];
  /** Non-fatal analysis diagnostics (additive). */
  readonly diagnostics?: readonly CoverageDiagnostic[];
}

/** Locale Tree Model — nested key structure for comparison. */
export interface LocaleTreeNode {
  /** Path segment (e.g. "auth" or "login"). */
  readonly segment: string;
  /** Full dotted key from namespace root ("" for tree root). */
  readonly fullKey: string;
  readonly children: ReadonlyMap<string, LocaleTreeNode>;
  /**
   * Leaf definitions by locale. Empty when this node is only structural.
   */
  readonly byLocale: ReadonlyMap<string, TranslationKeyDefinition>;
  readonly isLeaf: boolean;
}

export interface LocaleTree {
  readonly namespace?: string;
  readonly locales: readonly string[];
  readonly root: LocaleTreeNode;
  /** Flat index: dotted key → node (leaves and intermediate). */
  readonly byKey: ReadonlyMap<string, LocaleTreeNode>;
  readonly leafCount: number;
}

/** Merged view of one namespace across locales. */
export interface MergedLocaleNamespace {
  readonly namespace?: string;
  readonly locales: readonly string[];
  readonly tree: LocaleTree;
  /** key → locale → definition */
  readonly entries: ReadonlyMap<
    string,
    ReadonlyMap<string, TranslationKeyDefinition>
  >;
}

export interface MergedLocaleModel {
  readonly root: string;
  readonly locales: readonly string[];
  readonly namespaces: readonly string[];
  readonly byNamespace: ReadonlyMap<string, MergedLocaleNamespace>;
  /** Merge-time diagnostics (duplicates, etc.). */
  readonly diagnostics?: readonly CoverageDiagnostic[];
}

export interface CoverageAnalyzerOptions {
  /**
   * Locale treated as the source of truth.
   * Defaults to framework config defaultLocale, else "en" if present, else first locale.
   */
  readonly baseLocale?: string;
  /**
   * Locales to compare. Defaults to all locales in the catalog (except none).
   * When framework supportedLocales are known, they are preferred.
   */
  readonly locales?: readonly string[];
  /**
   * Restrict to these namespaces. Empty/omit ⇒ all.
   */
  readonly namespaces?: readonly string[];
  /**
   * Ignore keys matching these glob-like prefixes (exact or `*` suffix).
   */
  readonly ignoreKeys?: readonly string[];
  /**
   * Minimum key confidence to include.
   * @default 0
   */
  readonly minConfidence?: number;
  /**
   * Fallback locales from framework config (informational / diagnostics).
   */
  readonly fallbackLocales?: readonly string[];
  /**
   * When analyzing from root, load framework i18n config via @i18n-unused/context.
   * @default true for analyzeFromRoot
   */
  readonly useContext?: boolean;
}

export interface AnalyzeCoverageInput {
  readonly catalog: TranslationCatalog;
  readonly options?: CoverageAnalyzerOptions;
}

export interface AnalyzeFromRootInput {
  readonly root: string;
  readonly options?: CoverageAnalyzerOptions;
  /** Forwarded to createSourceDetector().discover */
  readonly discover?: {
    readonly useDetection?: boolean;
    readonly libraryHints?: readonly string[];
    readonly minConfidence?: number;
    readonly maxCandidates?: number;
  };
}

export interface CoverageAnalyzer {
  /** Analyze an already-discovered catalog (preferred — no re-parse). */
  analyze(input: AnalyzeCoverageInput): CoverageResult;
  /** Discover sources then analyze (convenience). */
  analyzeFromRoot(input: AnalyzeFromRootInput): Promise<CoverageResult>;
  /** Analyze multiple package catalogs (monorepo). */
  analyzeMonorepo(
    catalogs: readonly TranslationCatalog[],
    options?: CoverageAnalyzerOptions,
  ): CoverageResult;
}

export interface CoverageAnalyzerFactory {
  createCoverageAnalyzer(
    defaults?: CoverageAnalyzerOptions,
  ): CoverageAnalyzer;
}
