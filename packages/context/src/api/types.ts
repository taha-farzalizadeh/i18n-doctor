/** Confidence in [0, 1]. */
export type Confidence = number;

/**
 * Portable source location (1-based line/column, UTF-16 offsets).
 */
export interface SourceLocation {
  readonly line: number;
  readonly column: number;
  readonly endLine: number;
  readonly endColumn: number;
  readonly start: number;
  readonly end: number;
}

/** Libraries whose configuration this package understands. */
export type ConfigLibraryId =
  | "i18next"
  | "react-i18next"
  | "next-i18next"
  | "next-intl"
  | "vue-i18n"
  | "nuxt-i18n"
  | "unknown";

/** Kind of configuration surface that was statically parsed. */
export type ConfigKind =
  | "i18next-init"
  | "i18next-create-instance"
  | "next-intl"
  | "next-i18next"
  | "next-config"
  | "i18n-module"
  | "vue-i18n"
  | "nuxt-i18n"
  | "unknown";

/**
 * Provenance of a resolved namespace / locale / key field.
 * Prefer specific call-site evidence over config defaults.
 */
export type ResolutionSource =
  | "call-site"
  | "options"
  | "key-prefix"
  | "defaultNS"
  | "fallbackNS"
  | "config-ns"
  | "default-locale"
  | "fallback-locale"
  | "supported-locales"
  | "locale-inheritance"
  | "inferred"
  | "unknown";

export interface ConfigConflict {
  readonly field: string;
  readonly values: readonly string[];
  readonly paths: readonly string[];
  readonly message: string;
}

export interface ContextWarning {
  readonly code: string;
  readonly message: string;
  readonly path?: string;
}

/**
 * One statically extracted configuration fragment
 * (never executed — AST / object-literal only).
 */
export interface TranslationConfig {
  readonly id: string;
  readonly absolutePath: string;
  readonly relativePath: string;
  readonly kind: ConfigKind;
  readonly library: ConfigLibraryId;
  readonly confidence: Confidence;
  readonly defaultNS?: string | readonly string[];
  readonly fallbackNS?: string | readonly string[];
  readonly ns?: readonly string[];
  readonly defaultLocale?: string;
  readonly fallbackLocale?: string | readonly string[];
  readonly supportedLocales?: readonly string[];
  /** child locale → parent locale (inheritance / fallbackLng object form). */
  readonly localeInheritance?: Readonly<Record<string, string>>;
  readonly keySeparator?: string;
  readonly nsSeparator?: string;
  readonly evidence: readonly string[];
  readonly conflicts?: readonly ConfigConflict[];
  readonly location?: SourceLocation;
  /** Monorepo package root this config belongs to (absolute). */
  readonly packageRoot?: string;
}

/**
 * Merged effective settings for a package / workspace root.
 */
export interface EffectiveI18nSettings {
  readonly defaultNS?: string;
  readonly fallbackNS?: readonly string[];
  readonly namespaces?: readonly string[];
  readonly defaultLocale?: string;
  readonly fallbackLocales?: readonly string[];
  readonly supportedLocales?: readonly string[];
  readonly localeInheritance?: Readonly<Record<string, string>>;
  readonly keySeparator: string;
  readonly nsSeparator: string;
  /** Provenance of each populated field. */
  readonly fieldSources: Readonly<Partial<Record<string, ResolutionSource>>>;
  readonly confidence: Confidence;
  readonly conflicts: readonly ConfigConflict[];
}

/**
 * Translation context for a workspace (or one monorepo package).
 */
export interface TranslationContext {
  readonly root: string;
  /** Absolute package root when scoped to a monorepo unit. */
  readonly packageRoot?: string;
  readonly configs: readonly TranslationConfig[];
  readonly effective: EffectiveI18nSettings;
  readonly warnings: readonly ContextWarning[];
  readonly timings: {
    readonly discoverMs: number;
    readonly analyzeMs: number;
    readonly totalMs: number;
  };
}

/**
 * Call-site / binding facts needed to resolve a usage against config.
 */
export interface UsageResolveInput {
  readonly key: string;
  readonly absolutePath: string;
  readonly relativePath: string;
  readonly location: SourceLocation;
  readonly library?: string;
  /**
   * Namespace(s) from useTranslation("auth") /
   * useTranslation(["auth","common"]) / useTranslations("Dashboard").
   */
  readonly callSiteNamespace?: string | readonly string[];
  /** keyPrefix from useTranslations("Dashboard", { keyPrefix: "..." }) etc. */
  readonly keyPrefix?: string;
  /** Namespace from t(key, { ns }) / options. */
  readonly optionsNamespace?: string | readonly string[];
  /** Explicit static locale when known. */
  readonly locale?: string;
  readonly confidence?: Confidence;
}

/**
 * Fully resolved usage identity for matching against translation sources.
 */
export interface ResolvedTranslationUsage {
  readonly originalKey: string;
  readonly resolvedKey: string;
  readonly namespace?: string;
  /** All candidate namespaces when an array was provided. */
  readonly namespaces?: readonly string[];
  readonly keyPrefix?: string;
  readonly locale?: string;
  readonly fallbackLocale?: string | readonly string[];
  readonly resolutionSource: ResolutionSource;
  readonly resolutionChain: readonly ResolutionSource[];
  readonly confidence: Confidence;
  readonly absolutePath: string;
  readonly relativePath: string;
  readonly location: SourceLocation;
  readonly library?: ConfigLibraryId;
  readonly evidence?: string;
}

export interface NamespaceResolveResult {
  readonly namespace?: string;
  readonly namespaces?: readonly string[];
  readonly keyPrefix?: string;
  readonly resolvedKey: string;
  readonly originalKey: string;
  readonly resolutionSource: ResolutionSource;
  readonly resolutionChain: readonly ResolutionSource[];
  readonly confidence: Confidence;
}

export interface LocaleResolveResult {
  readonly locale?: string;
  readonly fallbackLocale?: string | readonly string[];
  readonly supportedLocales?: readonly string[];
  readonly inheritanceChain?: readonly string[];
  readonly resolutionSource: ResolutionSource;
  readonly resolutionChain: readonly ResolutionSource[];
  readonly confidence: Confidence;
}

export interface ContextAnalyzerOptions {
  /** Workspace / project root. */
  readonly root: string;
  /**
   * Explicit monorepo package roots to analyze.
   * When omitted, package roots are discovered from workspace package.json files.
   */
  readonly packageRoots?: readonly string[];
  /** Extra config file paths (absolute or root-relative). */
  readonly configPaths?: readonly string[];
  readonly fileExists?: (absolutePath: string) => boolean;
  readonly readFile?: (absolutePath: string) => string | undefined;
  readonly readDir?: (absolutePath: string) => readonly string[] | undefined;
  /**
   * Max config files to analyze.
   * @default 64
   */
  readonly maxConfigs?: number;
  /**
   * Prefer this library when multiple configs conflict.
   */
  readonly preferredLibrary?: ConfigLibraryId;
}

export interface AnalyzeContextInput {
  /** Override package root for this analysis. */
  readonly packageRoot?: string;
}

export interface ResolveUsageOptions {
  /** Context to resolve against. Defaults to last analyze(). */
  readonly context?: TranslationContext;
}

export interface ContextAnalyzer {
  /** Discover + statically parse configs into a TranslationContext. */
  analyze(input?: AnalyzeContextInput): TranslationContext;
  /** Analyze every discovered monorepo package root. */
  analyzeMonorepo(): readonly TranslationContext[];
  /** Resolve namespace / keyPrefix for a usage. */
  resolveNamespace(
    input: UsageResolveInput,
    options?: ResolveUsageOptions,
  ): NamespaceResolveResult;
  /** Resolve locale / fallback / inheritance for a usage. */
  resolveLocale(
    input: UsageResolveInput,
    options?: ResolveUsageOptions,
  ): LocaleResolveResult;
  /**
   * Full resolution: original key → resolved key + namespace + locale.
   * Each TranslationUsage-shaped result includes resolution provenance.
   */
  resolveUsage(
    input: UsageResolveInput,
    options?: ResolveUsageOptions,
  ): ResolvedTranslationUsage;
  /** Cached configs from the last analyze() call. */
  getContext(): TranslationContext | undefined;
  clearCache(): void;
}

export interface ConfigAnalyzer {
  discover(options: ContextAnalyzerOptions): readonly string[];
  analyzeFile(
    absolutePath: string,
    options: ContextAnalyzerOptions,
  ): readonly TranslationConfig[];
}

export interface NamespaceResolver {
  resolve(
    input: UsageResolveInput,
    settings: EffectiveI18nSettings,
  ): NamespaceResolveResult;
}

export interface LocaleResolver {
  resolve(
    input: UsageResolveInput,
    settings: EffectiveI18nSettings,
  ): LocaleResolveResult;
}
