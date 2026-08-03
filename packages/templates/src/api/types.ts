/** Confidence in [0, 1]. */
export type Confidence = number;

export type TemplateFrameworkId =
  | "vue"
  | "nuxt"
  | "angular"
  | "svelte"
  | "astro";

export type TemplateLibraryId =
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

export type TemplateUsageContext =
  | "function-call"
  | "member-call"
  | "method-call"
  | "jsx-attribute"
  | "jsx-child"
  | "tagged-template"
  | "pipe"
  | "unknown";

export interface TemplateLocation {
  readonly line: number;
  readonly column: number;
  readonly endLine: number;
  readonly endColumn: number;
  readonly start: number;
  readonly end: number;
}

/**
 * Structurally compatible with @i18n-unused/usages TranslationUsage.
 * Framework analyzers never import the usages package (avoids cycles).
 */
export interface TemplateUsage {
  readonly key: string;
  readonly absolutePath: string;
  readonly relativePath: string;
  readonly location: TemplateLocation;
  readonly library: TemplateLibraryId;
  readonly namespace?: string;
  readonly confidence: Confidence;
  readonly context: TemplateUsageContext;
  readonly evidence?: string;
  readonly framework: TemplateFrameworkId;
  readonly detector: string;
}

export interface TemplateAnalysisInput {
  readonly absolutePath: string;
  readonly relativePath: string;
  readonly sourceText: string;
  /** Detected / hinted i18n library ids. */
  readonly libraryHints?: ReadonlySet<string>;
}

export interface TemplateAnalysisResult {
  readonly usages: readonly TemplateUsage[];
  readonly warnings: readonly TemplateWarning[];
}

export interface TemplateWarning {
  readonly code: string;
  readonly message: string;
  readonly path?: string;
}

export interface TemplateParser {
  readonly id: string;
  readonly framework: TemplateFrameworkId;
  /** File extensions this parser handles (without dot). */
  readonly extensions: readonly string[];
  /**
   * Analyze a template / SFC file.
   * Must never throw — syntax problems become warnings.
   */
  analyze(input: TemplateAnalysisInput): TemplateAnalysisResult;
}

export interface TemplateAnalyzerOptions {
  /** Extra parsers to register after defaults. */
  readonly parsers?: readonly TemplateParser[];
  /** Disable a built-in parser by id. */
  readonly disable?: readonly string[];
}

export interface TemplateAnalyzer {
  /** Parsers in registration order. */
  readonly parsers: readonly TemplateParser[];
  /** Analyze one file; picks parsers by extension. */
  analyzeFile(input: TemplateAnalysisInput): TemplateAnalysisResult;
  /** Whether any parser claims this extension. */
  supportsExtension(extension: string): boolean;
  /** Supported extensions (unique, sorted). */
  supportedExtensions(): readonly string[];
}
