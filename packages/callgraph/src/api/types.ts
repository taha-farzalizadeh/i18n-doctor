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

/** Stable function identity: file + name + declaration offset. */
export type FunctionId = string;

export type FunctionKind =
  | "declaration"
  | "arrow"
  | "expression"
  | "method"
  | "seed";

/**
 * A callable unit in the function graph.
 * Seeds (known translation functions) are synthetic and may lack a body.
 */
export interface FunctionNode {
  readonly id: FunctionId;
  readonly name: string;
  readonly kind: FunctionKind;
  readonly absolutePath: string;
  readonly relativePath: string;
  readonly location: SourceLocation;
  /** First parameter name when this is a key-forwarding candidate. */
  readonly parameterName?: string;
  /** True for synthetic seed nodes (library `t`, `i18n.t`, …). */
  readonly synthetic?: boolean;
}

export type CallEdgeKind =
  | "call"
  | "member-call"
  | "return-identity"
  | "return-member"
  | "assign-alias";

/** One static call / return / alias edge. */
export interface CallEdge {
  readonly id: string;
  readonly kind: CallEdgeKind;
  /** Caller function id, or module init id. */
  readonly from: FunctionId;
  /**
   * Callee name as written (`t`, `translate`, `translator.t`).
   * May be unresolved to a FunctionId.
   */
  readonly calleeName: string;
  /** Resolved callee FunctionId when known. */
  readonly to?: FunctionId;
  readonly absolutePath: string;
  readonly relativePath: string;
  readonly location: SourceLocation;
  /**
   * When the call forwards the caller's first parameter as the first argument.
   * Used by wrapper detection.
   */
  readonly forwardsKeyParam?: boolean;
  /**
   * For `assign-alias` edges: the local binding name on the left-hand side
   * (`const tr = t` → `aliasName: "tr"`).
   */
  readonly aliasName?: string;
  readonly confidence: Confidence;
}

/** Inventory of functions discovered in analyzed files. */
export interface FunctionGraph {
  readonly functions: readonly FunctionNode[];
  get(id: FunctionId): FunctionNode | undefined;
  /** Functions declared in a file (by absolute path). */
  inFile(absolutePath: string): readonly FunctionNode[];
  /** Lookup by name within a file (innermost / latest declaration wins). */
  findByName(
    absolutePath: string,
    name: string,
    position?: number,
  ): FunctionNode | undefined;
}

/** Directed call / return / alias graph. */
export interface CallGraph {
  readonly edges: readonly CallEdge[];
  callees(from: FunctionId): readonly CallEdge[];
  callers(to: FunctionId): readonly CallEdge[];
}

/**
 * A function that eventually reaches a translation function.
 */
export interface WrapperInfo {
  readonly functionId: FunctionId;
  readonly name: string;
  readonly absolutePath: string;
  readonly relativePath: string;
  readonly location: SourceLocation;
  /** Terminal translation function name (`t`, `i18n.t`, …). */
  readonly resolvedTranslationFunction: string;
  /** Chain from this wrapper down to the seed, e.g. `["a","b","t"]`. */
  readonly callChain: readonly string[];
  readonly confidence: Confidence;
  readonly kind:
    | "passthrough"
    | "return-alias"
    | "hook-return"
    | "member"
    | "nested";
  readonly circular: boolean;
}

/**
 * A call site whose callee resolves (transitively) to a translation function.
 */
export interface ResolvedTranslationCall {
  readonly key: string;
  /** Callee as written at the call site (`translate`, `tr`, …). */
  readonly calledFunction: string;
  /** Terminal translation function (`t`, `i18n.t`, …). */
  readonly resolvedTranslationFunction: string;
  /** `calledFunction` → … → seed. */
  readonly callChain: readonly string[];
  readonly location: SourceLocation;
  readonly confidence: Confidence;
  readonly absolutePath: string;
  readonly relativePath: string;
}

/** Seed describing a known translation function (i18n-specific, injectable). */
export interface TranslationSeed {
  /** Local / imported identifier (`t`, `translate`). */
  readonly name?: string;
  /** Member form (`i18n.t`, `*.t`). */
  readonly member?: {
    readonly object?: string;
    readonly property: string;
  };
  /** Import module specifiers that confirm the seed. */
  readonly modules?: readonly string[];
  /** Hook names whose `.t` / return is a translator. */
  readonly hook?: string;
  readonly confidence?: Confidence;
}

export interface CallGraphAnalyzerOptions {
  readonly root: string;
  readonly aliases?: Readonly<Record<string, string>>;
  readonly tsconfigPath?: string;
  readonly fileExists?: (absolutePath: string) => boolean;
  readonly readFile?: (absolutePath: string) => string | undefined;
  /**
   * Translation seeds. Defaults to common i18n libraries (separate module).
   */
  readonly seeds?: readonly TranslationSeed[];
  /**
   * Max wrapper propagation depth.
   * @default 64
   */
  readonly maxDepth?: number;
}

export interface AnalyzeFileInput {
  readonly filePath: string;
  readonly sourceText?: string;
  readonly sourceFile?: import("typescript").SourceFile;
}

export interface FileCallAnalysis {
  readonly absolutePath: string;
  readonly relativePath: string;
  readonly functions: readonly FunctionNode[];
  readonly edges: readonly CallEdge[];
  readonly wrappers: readonly WrapperInfo[];
  readonly translationCalls: readonly ResolvedTranslationCall[];
}

export interface ProjectCallAnalysis {
  readonly root: string;
  readonly files: readonly FileCallAnalysis[];
  readonly functionGraph: FunctionGraph;
  readonly callGraph: CallGraph;
  readonly wrappers: readonly WrapperInfo[];
  readonly translationCalls: readonly ResolvedTranslationCall[];
}

export interface CallGraphAnalyzer {
  /** Analyze one file; updates cached graphs. */
  analyzeFile(input: AnalyzeFileInput): FileCallAnalysis;
  /** Analyze many files (deterministic path order). */
  analyzeFiles(filePaths: readonly string[]): ProjectCallAnalysis;
  getFunctionGraph(): FunctionGraph;
  getCallGraph(): CallGraph;
  getWrappers(): readonly WrapperInfo[];
  clearCache(): void;
}

/** Propagation result for one function id. */
export interface PropagationRecord {
  readonly functionId: FunctionId;
  readonly resolvedTranslationFunction: string;
  readonly callChain: readonly string[];
  readonly confidence: Confidence;
  readonly kind: WrapperInfo["kind"];
  readonly circular: boolean;
}
