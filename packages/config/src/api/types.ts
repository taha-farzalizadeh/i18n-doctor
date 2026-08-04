/**
 * User-facing configuration, ignore rules, and inline suppression.
 * Config files are never executed — JSON parse or static AST only.
 */

/** Known analysis rule identifiers (aligned with IssueType). */
export type RuleId = "unused-key" | "missing-key" | "duplicate-key";

export type RuleSeverity = "off" | "info" | "warning" | "error";

export type OutputFormat = "terminal" | "json" | "sarif" | "github" | "silent";

export type ConfigSourceKind =
  | "defaults"
  | "package-json"
  | "config-file"
  | "package-config"
  | "cli"
  | "inline";

export interface ConfigDiagnostic {
  readonly code: string;
  readonly severity: "error" | "warning" | "info";
  readonly message: string;
  readonly path?: string;
  readonly hint?: string;
}

/** Raw user configuration shape (partial, unvalidated). */
export interface UserConfig {
  readonly root?: string;
  readonly ignoreKeys?: readonly string[];
  readonly ignoreFiles?: readonly string[];
  readonly ignoreLocales?: readonly string[];
  readonly ignoreNamespaces?: readonly string[];
  readonly include?: readonly string[];
  readonly exclude?: readonly string[];
  /** Rule severity map. Unknown keys are reported as diagnostics. */
  readonly rules?: Readonly<Partial<Record<string, RuleSeverity | boolean>>>;
  /**
   * Exit process with non-zero status when errors are reported.
   * @default true
   */
  readonly exitOnError?: boolean;
  /**
   * Treat warnings as failures for exit status.
   * @default false
   */
  readonly failOnWarning?: boolean;
  readonly output?: OutputConfig;
  /** Explicit monorepo package roots / globs. */
  readonly packages?: readonly string[];
  /**
   * Minimum confidence [0,1] for reported findings.
   * @default 0
   */
  readonly minConfidence?: number;
}

export interface OutputConfig {
  readonly format?: OutputFormat;
  /** Optional output file path (relative to root or absolute). */
  readonly file?: string;
  readonly color?: boolean;
  readonly verbose?: boolean;
}

/** Validated + normalized configuration fragment from one source. */
export interface ConfigFragment {
  readonly source: ConfigSourceKind;
  readonly path?: string;
  readonly config: UserConfig;
  readonly diagnostics: readonly ConfigDiagnostic[];
}

export interface LoadedConfig {
  readonly root: string;
  /** Absolute path of the primary config file, if any. */
  readonly configPath?: string;
  readonly fragments: readonly ConfigFragment[];
  readonly diagnostics: readonly ConfigDiagnostic[];
}

export interface RuleConfiguration {
  readonly severities: Readonly<Record<RuleId, RuleSeverity>>;
  isEnabled(rule: RuleId): boolean;
  getSeverity(rule: RuleId): RuleSeverity;
}

export interface ExitBehavior {
  readonly exitOnError: boolean;
  readonly failOnWarning: boolean;
  /**
   * Compute process exit code from issue severity counts.
   * 0 = success, 1 = failures present.
   */
  exitCode(counts: {
    readonly error: number;
    readonly warning: number;
  }): number;
}

/**
 * Fully merged effective configuration for one analysis scope
 * (workspace root or monorepo package).
 */
export interface EffectiveConfig {
  readonly root: string;
  readonly packageRoot?: string;
  readonly ignoreKeys: readonly string[];
  readonly ignoreFiles: readonly string[];
  readonly ignoreLocales: readonly string[];
  readonly ignoreNamespaces: readonly string[];
  readonly include: readonly string[];
  readonly exclude: readonly string[];
  readonly rules: RuleConfiguration;
  readonly exit: ExitBehavior;
  readonly output: Required<OutputConfig>;
  readonly packages?: readonly string[];
  readonly minConfidence: number;
  /** Provenance of each top-level field. */
  readonly fieldSources: Readonly<
    Partial<Record<keyof UserConfig | "output.format", ConfigSourceKind>>
  >;
  readonly diagnostics: readonly ConfigDiagnostic[];
  readonly fragments: readonly ConfigFragment[];
}

export interface IgnoreMatch {
  readonly ignored: boolean;
  readonly pattern?: string;
  readonly kind?:
    | "ignoreKeys"
    | "ignoreFiles"
    | "ignoreLocales"
    | "ignoreNamespaces"
    | "exclude"
    | "include";
}

export interface IgnoreEngine {
  isKeyIgnored(key: string): IgnoreMatch;
  isFileIgnored(relativePath: string): IgnoreMatch;
  isLocaleIgnored(locale: string): IgnoreMatch;
  isNamespaceIgnored(namespace: string): IgnoreMatch;
  /**
   * Whether a file path should be analyzed given include/exclude.
   * Empty include ⇒ all files included (then exclude applied).
   */
  shouldAnalyzeFile(relativePath: string): IgnoreMatch;
  /** Explain the winning ignore/include decision. */
  explainFile(relativePath: string): IgnoreMatch;
}

export type SuppressionKind =
  | "ignore-line"
  | "ignore-next-line"
  | "disable"
  | "enable";

export interface SuppressionDirective {
  readonly kind: SuppressionKind;
  /** 1-based line of the comment itself. */
  readonly line: number;
  /** Optional rule filter; empty ⇒ all rules. */
  readonly rules: readonly RuleId[];
  readonly raw: string;
}

export interface FileSuppressions {
  readonly absolutePath: string;
  readonly relativePath: string;
  readonly directives: readonly SuppressionDirective[];
}

export interface SuppressionQuery {
  /** 1-based line of the finding. */
  readonly line: number;
  readonly rule?: RuleId;
}

export interface SuppressionMatch {
  readonly suppressed: boolean;
  readonly directive?: SuppressionDirective;
  readonly reason?: string;
}

export interface SuppressionEngine {
  parseFile(input: {
    readonly absolutePath: string;
    readonly relativePath: string;
    readonly sourceText: string;
  }): FileSuppressions;
  isSuppressed(
    file: FileSuppressions,
    query: SuppressionQuery,
  ): SuppressionMatch;
}

export interface ConfigLoaderOptions {
  readonly root: string;
  readonly fileExists?: (absolutePath: string) => boolean;
  readonly readFile?: (absolutePath: string) => string | undefined;
  /** Extra explicit config path (absolute or root-relative). */
  readonly configPath?: string;
  /**
   * When true, also read package.json "i18n-doctor".
   * @default true
   */
  readonly readPackageJson?: boolean;
}

export interface ConfigLoader {
  /** Discover + load config fragments for a root (or package root). */
  load(options?: { packageRoot?: string }): LoadedConfig;
  /** Load a single config file path. */
  loadFile(absolutePath: string): ConfigFragment;
}

export interface ResolveEffectiveOptions {
  readonly root: string;
  readonly packageRoot?: string;
  /** CLI / programmatic overrides (highest precedence). */
  readonly cli?: UserConfig;
  /** Pre-loaded fragments; when omitted, loader runs. */
  readonly loaded?: LoadedConfig;
  readonly fileExists?: (absolutePath: string) => boolean;
  readonly readFile?: (absolutePath: string) => string | undefined;
  readonly configPath?: string;
}

export interface EffectiveConfigResolver {
  resolve(options: ResolveEffectiveOptions): EffectiveConfig;
  /** Resolve every discovered monorepo package (+ root). */
  resolveMonorepo(options: {
    readonly root: string;
    readonly packageRoots?: readonly string[];
    readonly cli?: UserConfig;
    readonly fileExists?: (absolutePath: string) => boolean;
    readonly readFile?: (absolutePath: string) => string | undefined;
    readonly readDir?: (absolutePath: string) => readonly string[] | undefined;
  }): readonly EffectiveConfig[];
}
