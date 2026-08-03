/** Confidence in [0, 1]. */
export type Confidence = number;

/** How a local name was bound to its target. */
export type AliasKind =
  | "seed"
  | "identifier"
  | "destructure"
  | "member"
  | "wrapper"
  | "reassignment";

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

/** Terminal / intermediate alias target inside one file. */
export type AliasTarget =
  | { readonly type: "name"; readonly name: string }
  | {
      readonly type: "member";
      readonly object: string;
      readonly property: string;
    }
  | { readonly type: "unresolved" };

export interface AliasChainStep {
  /** Identifier (or `object.property`) at this step. */
  readonly identifier: string;
  readonly kind: AliasKind;
  /** Declaration / assignment site when known. */
  readonly location?: SourceLocation;
}

/**
 * Result of resolving a local identifier at a use site.
 * File-local only — never follows imports or other files.
 */
export interface ResolutionResult {
  readonly originalIdentifier: string;
  /**
   * Ultimate local name or member string (`i18n.t`).
   * Equals originalIdentifier when nothing further resolves.
   */
  readonly resolvedIdentifier: string;
  /** Present when the chain ends at a member access root. */
  readonly resolvedMember?: {
    readonly object: string;
    readonly property: string;
  };
  readonly aliasChain: readonly AliasChainStep[];
  /** Location of the original identifier at the use site. */
  readonly location: SourceLocation;
  readonly confidence: Confidence;
  /** True when a cycle was detected while walking the alias graph. */
  readonly circular: boolean;
  /** True when the name has no usable binding at the position. */
  readonly unresolved: boolean;
}

/** One edge in the file-local alias graph. */
export interface AliasBinding {
  readonly name: string;
  readonly kind: AliasKind;
  readonly target: AliasTarget;
  readonly location: SourceLocation;
  /** UTF-16 start of the binding (for TDZ / reassignment ordering). */
  readonly declPos: number;
  readonly scopeId: number;
  readonly confidence: Confidence;
}

/** Detected simple wrapper: `(key) => t(key)` / `function tr(key) { return t(key) }`. */
export interface FunctionAlias {
  readonly name: string;
  readonly target: AliasTarget;
  readonly location: SourceLocation;
  readonly declPos: number;
  readonly scopeId: number;
  readonly confidence: Confidence;
  readonly parameterName: string;
}

/**
 * Directed alias graph for a single source file.
 * Does not include import edges (imports are terminals).
 */
export interface AliasGraph {
  readonly bindings: readonly AliasBinding[];
  /**
   * Innermost binding for `name` visible at `position`
   * (respects shadowing, scopes, and reassignment order).
   */
  bindingAt(name: string, position: number): AliasBinding | undefined;
}

export interface FileAliasAnalysis {
  readonly fileName: string;
  readonly graph: AliasGraph;
  readonly wrappers: readonly FunctionAlias[];
  readonly seeds: ReadonlySet<string>;
  readonly seedMembers: ReadonlySet<string>;
  readonly maxChainLength: number;
}

export interface LocalResolverOptions {
  /**
   * Identifier names treated as resolution terminals (e.g. `t`, `i18n`).
   * @default ["t", "i18n", "i18next", "$t"]
   */
  readonly seedIdentifiers?: readonly string[];
  /**
   * Member roots treated as terminals (e.g. `i18n.t`).
   * Stored as `"object.property"`.
   * @default ["i18n.t", "i18next.t"]
   */
  readonly seedMembers?: readonly string[];
  /**
   * Maximum alias chain length (cycle / runaway guard).
   * @default 32
   */
  readonly maxChainLength?: number;
}

export interface AnalyzeInput {
  readonly sourceFile: import("typescript").SourceFile;
  readonly fileName?: string;
  readonly options?: LocalResolverOptions;
}

export interface ResolveIdentifierInput {
  readonly analysis: FileAliasAnalysis;
  readonly name: string;
  /** UTF-16 position of the use site. */
  readonly position: number;
  /** Optional precise location for the use-site identifier. */
  readonly location?: SourceLocation;
}

export interface LocalResolver {
  /** Build the alias graph + wrappers for one file. */
  analyze(input: AnalyzeInput): FileAliasAnalysis;
  /** Resolve a local identifier at a position. */
  resolve(input: ResolveIdentifierInput): ResolutionResult;
}
