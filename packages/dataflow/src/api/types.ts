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

export type AnalysisType =
  | "literal"
  | "concat"
  | "template"
  | "variable"
  | "conditional"
  | "object-lookup"
  | "array-lookup"
  | "parameter"
  | "union"
  | "constant"
  | "unresolved";

export type ResolutionStepKind =
  | "expression"
  | "literal"
  | "identifier"
  | "import"
  | "declaration"
  | "property"
  | "element"
  | "concat"
  | "template"
  | "conditional"
  | "parameter"
  | "union"
  | "lookup"
  | "cycle";

export interface ResolutionStep {
  readonly kind: ResolutionStepKind;
  readonly absolutePath?: string;
  readonly relativePath?: string;
  readonly label?: string;
  readonly location?: SourceLocation;
  readonly values?: readonly string[];
}

/**
 * Finite set of statically possible string values for an expression.
 * Prefer a wider set over a wrong singleton.
 */
export interface PossibleValueSet {
  /** Distinct possible string values (sorted for determinism). */
  readonly values: readonly string[];
  /** True when the set may be incomplete (unknown contributors). */
  readonly incomplete: boolean;
  readonly confidence: Confidence;
  readonly circular: boolean;
}

/**
 * Result of dynamic key / data-flow analysis for one expression.
 */
export interface DynamicKeyAnalysis {
  readonly resolved: boolean;
  readonly possibleKeys: readonly string[];
  readonly confidence: Confidence;
  readonly sourceLocations: readonly SourceLocation[];
  readonly resolutionChain: readonly ResolutionStep[];
  readonly analysisType: AnalysisType;
  readonly circular: boolean;
  /** True when analysis may have missed contributors. */
  readonly incomplete: boolean;
}

export interface DataFlowEngineOptions {
  readonly root: string;
  readonly aliases?: Readonly<Record<string, string>>;
  readonly tsconfigPath?: string;
  readonly fileExists?: (absolutePath: string) => boolean;
  readonly readFile?: (absolutePath: string) => string | undefined;
  /**
   * Max propagation depth.
   * @default 64
   */
  readonly maxDepth?: number;
  /**
   * Max keys retained in a PossibleValueSet (overflow ⇒ incomplete).
   * @default 64
   */
  readonly maxValues?: number;
}

export interface AnalyzeExpressionInput {
  readonly filePath: string;
  readonly sourceFile: import("typescript").SourceFile;
  readonly expression: import("typescript").Expression;
  /**
   * Optional parameter environment for the current function scope
   * (`paramName → possible values`).
   */
  readonly paramEnv?: ReadonlyMap<string, PossibleValueSet>;
}

export interface AnalyzeFileInput {
  readonly filePath: string;
  readonly sourceText?: string;
  readonly sourceFile?: import("typescript").SourceFile;
}

/** Node in the value propagation graph. */
export interface PropagationNode {
  readonly id: string;
  readonly name: string;
  readonly absolutePath: string;
  readonly relativePath: string;
  readonly location: SourceLocation;
  readonly values: readonly string[];
  readonly dependsOn: readonly string[];
  readonly analysisType: AnalysisType;
}

/** Directed graph of value bindings used during analysis. */
export interface ValuePropagationGraph {
  readonly nodes: readonly PropagationNode[];
  get(id: string): PropagationNode | undefined;
}

export interface DataFlowEngine {
  /** Analyze a single expression into possible translation keys. */
  analyzeExpression(input: AnalyzeExpressionInput): DynamicKeyAnalysis;
  /**
   * Analyze a file: build param environments from call sites and evaluate
   * arguments of calls that look like translation usages (`t(...)`, wrappers).
   */
  analyzeFile(input: AnalyzeFileInput): {
    readonly absolutePath: string;
    readonly relativePath: string;
    readonly analyses: readonly DynamicKeyAnalysis[];
  };
  getPropagationGraph(): ValuePropagationGraph;
  clearCache(): void;
}

export interface DynamicExpressionEvaluator {
  evaluate(
    filePath: string,
    expression: import("typescript").Expression,
    sourceFile: import("typescript").SourceFile,
    context: EvaluationContext,
  ): DynamicKeyAnalysis;
}

export interface EvaluationContext {
  readonly depth: number;
  readonly visited: ReadonlySet<string>;
  readonly chain: readonly ResolutionStep[];
  readonly paramEnv: ReadonlyMap<string, PossibleValueSet>;
  readonly analysisTypeHint?: AnalysisType;
}
