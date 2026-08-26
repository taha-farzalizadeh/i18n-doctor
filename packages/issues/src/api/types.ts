/** Issue classification produced by the Issue Engine. */
export type IssueType =
  | "unused-key"
  | "missing-key"
  | "duplicate-key"
  | "untranslated-text";

export type IssueSeverity = "warning" | "error" | "info";

/**
 * Portable file location for diagnostics and future reporters
 * (GitHub Actions, VS Code, SARIF).
 */
export interface FileLocation {
  readonly absolutePath: string;
  readonly relativePath: string;
  /** 1-based line. */
  readonly line: number;
  /** 1-based column. */
  readonly column: number;
  readonly endLine?: number;
  readonly endColumn?: number;
  readonly start?: number;
  readonly end?: number;
  readonly locale?: string;
  readonly namespace?: string;
}

export interface IssueSourceInfo {
  /** Where the primary signal came from. */
  readonly kind: "definition" | "usage" | "definition-collision" | "literal";
  readonly locale?: string;
  readonly namespace?: string;
  readonly library?: string;
  readonly confidence?: number;
  /**
   * Unused key may still be referenced via a dynamic key expression
   * (e.g. `t("HELLO_" + suffix)`). Softened to info when present.
   */
  readonly reason?: "dynamic-usage";
}

export interface Issue {
  readonly type: IssueType;
  readonly severity: IssueSeverity;
  readonly message: string;
  readonly key: string;
  readonly location: FileLocation;
  readonly relatedLocations: readonly FileLocation[];
  readonly source: IssueSourceInfo;
}

export interface IssueStats {
  readonly total: number;
  readonly unusedKey: number;
  readonly missingKey: number;
  readonly duplicateKey: number;
  readonly untranslatedText: number;
  readonly bySeverity: Readonly<Partial<Record<IssueSeverity, number>>>;
}

export interface AnalysisResult {
  readonly root: string;
  readonly issues: readonly Issue[];
  readonly stats: IssueStats;
  readonly timings: {
    readonly totalMs: number;
    readonly analyzeMs: number;
  };
}

/**
 * Normalized definition fact for the engine.
 * Issue Engine does not depend on AST — only these facts.
 */
export interface DefinitionFact {
  readonly key: string;
  readonly absolutePath: string;
  readonly relativePath: string;
  readonly line: number;
  readonly column: number;
  readonly endLine?: number;
  readonly endColumn?: number;
  readonly start?: number;
  readonly end?: number;
  readonly locale?: string;
  readonly namespace?: string;
  readonly confidence?: number;
}

/**
 * Normalized usage fact for the engine.
 */
export interface UsageFact {
  readonly key: string;
  readonly absolutePath: string;
  readonly relativePath: string;
  readonly line: number;
  readonly column: number;
  readonly endLine?: number;
  readonly endColumn?: number;
  readonly start?: number;
  readonly end?: number;
  readonly namespace?: string;
  /** Candidate namespaces (useTranslation array / options.ns array). */
  readonly namespaces?: readonly string[];
  readonly namespaceResolved?: boolean;
  readonly library?: string;
  readonly confidence?: number;
}

/**
 * Partial key expression from a dynamic `t(...)` call.
 * Used to soften unused-key findings when a catalog key matches a fragment.
 */
export interface DynamicUsageFact {
  readonly absolutePath: string;
  readonly relativePath: string;
  readonly line: number;
  readonly column: number;
  readonly endLine?: number;
  readonly endColumn?: number;
  readonly start?: number;
  readonly end?: number;
  readonly namespace?: string;
  readonly namespaces?: readonly string[];
  readonly library?: string;
  readonly confidence?: number;
  readonly prefixes: readonly string[];
  readonly suffixes: readonly string[];
  readonly contains: readonly string[];
}

/** Hardcoded UI text that is not passed through a translation helper. */
export interface UntranslatedLiteralFact {
  readonly text: string;
  readonly absolutePath: string;
  readonly relativePath: string;
  readonly line: number;
  readonly column: number;
  readonly endLine?: number;
  readonly endColumn?: number;
  readonly start?: number;
  readonly end?: number;
  readonly confidence?: number;
  readonly library?: string;
  readonly context?: string;
  readonly attribute?: string;
}

export interface IssueEngineOptions {
  /**
   * When true, unused/missing matching is namespace-aware.
   * Namespaced definitions only match usages that resolve to the same
   * namespace (or one of usage.namespaces / defaultNS / fallbackNS).
   * Unnamespaced definitions remain backward-compatible (match by key).
   * @default true
   */
  readonly matchNamespace?: boolean;
  /**
   * Locale used when checking missing keys against definitions.
   * When set, a usage is missing only if no definition exists for that locale
   * (and still none in other locales as fallback unless strictLocale is true).
   */
  readonly defaultLocale?: string;
  /**
   * When true with defaultLocale, missing keys ignore other locales.
   * @default false
   */
  readonly strictLocale?: boolean;
  /**
   * i18next defaultNS — applied when a usage has no call-site / options namespace.
   */
  readonly defaultNS?: string;
  /**
   * i18next fallbackNS — secondary namespace candidates for matching.
   */
  readonly fallbackNS?: readonly string[];
  /** Severity overrides. */
  readonly severities?: {
    readonly unusedKey?: IssueSeverity;
    readonly missingKey?: IssueSeverity;
    readonly duplicateKey?: IssueSeverity;
    readonly untranslatedText?: IssueSeverity;
  };
  /**
   * Minimum definition/usage confidence to include in analysis.
   * @default 0
   */
  readonly minConfidence?: number;
}

export interface AnalyzeInput {
  readonly root: string;
  readonly definitions: readonly DefinitionFact[];
  readonly usages: readonly UsageFact[];
  readonly dynamicUsages?: readonly DynamicUsageFact[];
  readonly untranslatedLiterals?: readonly UntranslatedLiteralFact[];
  readonly options?: IssueEngineOptions;
}

export interface IssueEngine {
  analyze(input: AnalyzeInput): AnalysisResult;
}

/** Reporter contract — no AST knowledge. */
export interface Reporter {
  readonly id: string;
  report(result: AnalysisResult): string | void;
}

export interface TerminalReporterOptions {
  /**
   * Enable ANSI colors.
   * `true` forces color, `false` disables, omit for TTY auto-detect.
   */
  readonly color?: boolean;
  /**
   * Emit OSC-8 hyperlinks.
   * `true` forces links, `false` disables, omit for terminal auto-detect.
   */
  readonly hyperlinks?: boolean;
  /** Max issues to print (0 = unlimited). @default 0 */
  readonly maxIssues?: number;
}

export interface JsonReporterOptions {
  /** Include full FileLocation objects. @default true */
  readonly verbose?: boolean;
  /** Pretty-print JSON. @default true */
  readonly pretty?: boolean;
}
