/** Confidence in [0, 1]. */
export type Confidence = number;

export type UsageLibraryId =
  | "i18next"
  | "react-i18next"
  | "next-i18next"
  | "next-intl"
  | "react-intl"
  | "lingui"
  | "vue-i18n"
  | "ngx-translate"
  | "transloco"
  | "unknown";

export type UsageContext =
  | "function-call"
  | "member-call"
  | "method-call"
  | "jsx-attribute"
  | "jsx-child"
  | "tagged-template"
  | "pipe"
  | "unknown";

export interface UsageLocation {
  /** 1-based line of the key literal / primary node. */
  readonly line: number;
  /** 1-based column of the key literal / primary node. */
  readonly column: number;
  readonly endLine: number;
  readonly endColumn: number;
  /** Absolute UTF-16 offsets into the file. */
  readonly start: number;
  readonly end: number;
}

export interface TranslationUsage {
  readonly key: string;
  /** Absolute OS path. */
  readonly absolutePath: string;
  /** Workspace-relative POSIX path. */
  readonly relativePath: string;
  readonly location: UsageLocation;
  readonly library: UsageLibraryId;
  readonly namespace?: string;
  readonly confidence: Confidence;
  readonly context: UsageContext;
  /** Short explanation of why this was treated as a usage. */
  readonly evidence?: string;
}

export interface UsageWarning {
  readonly code: string;
  readonly message: string;
  readonly path?: string;
}

export interface UsageCatalog {
  readonly root: string;
  readonly usages: readonly TranslationUsage[];
  readonly libraries: readonly UsageLibraryId[];
  readonly warnings: readonly UsageWarning[];
  readonly stats: {
    readonly fileCount: number;
    readonly usageCount: number;
    readonly byLibrary: Readonly<Partial<Record<UsageLibraryId, number>>>;
    readonly byContext: Readonly<Partial<Record<UsageContext, number>>>;
  };
  readonly timings: {
    readonly totalMs: number;
    readonly scanMs: number;
    readonly detectMs: number;
    readonly analyzeMs: number;
  };
}

export interface UsageDetectorOptions {
  /** Project root. Defaults to process.cwd(). */
  readonly root?: string;
  /**
   * Run framework/i18n detection for library hints.
   * @default true
   */
  readonly useDetection?: boolean;
  /** Explicit library hints. */
  readonly libraryHints?: readonly string[];
  /**
   * Minimum confidence to keep a usage.
   * @default 0.4
   */
  readonly minConfidence?: number;
  /**
   * Max source files to analyze.
   * @default 2000
   */
  readonly maxFiles?: number;
  /**
   * Include lightweight Vue/Angular template scans.
   * @default true
   */
  readonly scanTemplates?: boolean;
}

/** Per-library detector over a single parsed script file. */
export interface LibraryUsageDetector {
  readonly id: UsageLibraryId;
  detect(input: LibraryDetectInput): readonly TranslationUsage[];
}

export interface LibraryDetectInput {
  readonly absolutePath: string;
  readonly relativePath: string;
  readonly sourceText: string;
  readonly sourceFile: import("typescript").SourceFile;
  /** File-local binding facts (no cross-file resolution). */
  readonly bindings: FileBindingTable;
  readonly libraryHints: ReadonlySet<string>;
}

/**
 * File-scoped binding table.
 * Tracks local aliases from hooks/destructuring in the current file only.
 */
export interface FileBindingTable {
  /** Local names that refer to a translation function (t, translate, …). */
  readonly tFunctions: ReadonlyMap<string, TFunctionBinding>;
  /** Local names bound to formatMessage. */
  readonly formatMessageNames: ReadonlySet<string>;
  /** Local object names that expose `.t` (i18n, i18next). */
  readonly i18nObjects: ReadonlySet<string>;
  /** Local TranslateService-like names. */
  readonly translateServices: ReadonlySet<string>;
  /** Whether useTranslation / useTranslations / useIntl appeared. */
  readonly hooks: {
    readonly useTranslation: boolean;
    readonly useTranslations: boolean;
    readonly useIntl: boolean;
  };
  /** Static import module specifiers seen in this file. */
  readonly importSpecifiers: ReadonlySet<string>;
}

export interface TFunctionBinding {
  readonly library: UsageLibraryId;
  readonly namespace?: string;
  readonly confidence: Confidence;
  readonly origin: string;
}

export interface UsageDetector {
  detect(options?: UsageDetectorOptions): Promise<UsageCatalog>;
}
