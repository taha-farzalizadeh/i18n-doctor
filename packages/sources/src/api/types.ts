/** Confidence in [0, 1]. */
export type Confidence = number;

export type SourceFormat = "json" | "yaml" | "javascript" | "typescript";

export type SourceKind =
  | "resource-file"
  | "embedded-object"
  | "i18next-resources"
  | "messages-object"
  | "unknown";

export type TranslationValue = string | number | boolean | null;

export interface SourceLocation {
  readonly startLine: number;
  readonly startCharacter: number;
  readonly endLine: number;
  readonly endCharacter: number;
  readonly start?: number;
  readonly end?: number;
}

export interface TranslationKeyDefinition {
  /** Dotted key path, e.g. "nav.home" or "items[0].label". */
  readonly key: string;
  readonly value: TranslationValue;
  readonly filePath: string;
  readonly location: SourceLocation;
  readonly locale?: string;
  readonly namespace?: string;
  /**
   * Stable identity: `${locale ?? "*"}::${namespace ?? "*"}::${key}`.
   * Always populated by the detector; optional for backward-compatible callers.
   */
  readonly fullKey?: string;
  readonly confidence: Confidence;
  /** Id of the owning TranslationSource. */
  readonly sourceId: string;
}

/**
 * Namespace-aware translation entry (Phase 013.5).
 * Prefer this over reading bare `key` when matching unused/missing/duplicates.
 *
 * Projects without namespaces keep `namespace: null` (backward compatible).
 */
export interface TranslationEntry {
  readonly locale: string | null;
  readonly namespace: string | null;
  /** Dotted key path within the locale/namespace (same as TranslationKeyDefinition.key). */
  readonly keyPath: string;
  /** `${locale ?? "*"}::${namespace ?? "*"}::${keyPath}` */
  readonly fullKey: string;
  readonly sourceFile: string;
  readonly location?: SourceLocation;
  readonly value?: TranslationValue;
  readonly confidence: Confidence;
  readonly sourceId?: string;
}

export interface TranslationSource {
  readonly id: string;
  readonly filePath: string;
  readonly format: SourceFormat;
  readonly kind: SourceKind;
  readonly locale?: string;
  readonly namespace?: string;
  /** Detected library hint when available (e.g. i18next, next-intl). */
  readonly libraryHint?: string;
  readonly confidence: Confidence;
  readonly keys: readonly TranslationKeyDefinition[];
  /** Region of an embedded object when applicable. */
  readonly location?: SourceLocation;
  readonly evidence: readonly string[];
}

export interface CatalogWarning {
  readonly code: string;
  readonly message: string;
  readonly path?: string;
}

export interface TranslationCatalog {
  readonly root: string;
  readonly sources: readonly TranslationSource[];
  /** Flattened key definitions across all sources. */
  readonly keys: readonly TranslationKeyDefinition[];
  readonly locales: readonly string[];
  readonly namespaces: readonly string[];
  readonly warnings: readonly CatalogWarning[];
  readonly stats: {
    readonly sourceCount: number;
    readonly keyCount: number;
    readonly candidateCount: number;
    readonly byFormat: Readonly<Record<SourceFormat, number>>;
    readonly byKind: Readonly<Partial<Record<SourceKind, number>>>;
  };
  readonly timings: {
    readonly totalMs: number;
    readonly scanMs: number;
    readonly detectMs: number;
    readonly extractMs: number;
  };
}

export interface SourceDetectorOptions {
  /** Project root. Defaults to process.cwd(). */
  readonly root?: string;
  /**
   * Run framework/i18n detection for library hints.
   * @default true
   */
  readonly useDetection?: boolean;
  /**
   * Explicit library hints (overrides/extends detection).
   */
  readonly libraryHints?: readonly string[];
  /**
   * Minimum confidence to keep a source or key.
   * @default 0.35
   */
  readonly minConfidence?: number;
  /**
   * Max candidate files to extract from.
   * @default 500
   */
  readonly maxCandidates?: number;
  /**
   * Also consider heuristic "string-leaf object" sources outside known paths.
   * @default true
   */
  readonly includeUnknownStructures?: boolean;
}

export interface TranslationSourceDetector {
  discover(options?: SourceDetectorOptions): Promise<TranslationCatalog>;
}
