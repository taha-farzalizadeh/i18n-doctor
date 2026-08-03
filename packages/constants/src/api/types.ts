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

export type EvaluationStepKind =
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
  | "enum"
  | "cache";

export interface EvaluationStep {
  readonly kind: EvaluationStepKind;
  readonly absolutePath?: string;
  readonly relativePath?: string;
  readonly label?: string;
  readonly location?: SourceLocation;
  readonly value?: string | string[];
}

/**
 * Result of statically evaluating an expression to a translation-key value.
 * Never produced by executing JavaScript.
 */
export interface EvaluationResult {
  readonly resolved: boolean;
  readonly value?: string | string[];
  readonly sourceLocation: SourceLocation;
  readonly resolutionChain: readonly EvaluationStep[];
  readonly confidence: Confidence;
  /** True when a constant dependency cycle was detected. */
  readonly circular: boolean;
}

/** One constant binding in the dependency graph. */
export interface ConstantBinding {
  readonly name: string;
  readonly absolutePath: string;
  readonly relativePath: string;
  readonly location: SourceLocation;
  /** Names this binding depends on (same file or imported). */
  readonly dependsOn: readonly string[];
}

/**
 * Directed dependency graph of constant bindings.
 * Used for cycle detection and cache invalidation.
 */
export interface ConstantDependencyGraph {
  readonly bindings: readonly ConstantBinding[];
  get(absolutePath: string, name: string): ConstantBinding | undefined;
}

export interface ConstantEvaluatorOptions {
  /** Project root (absolute). */
  readonly root: string;
  /**
   * Optional pre-built import module graph. When omitted, a graph is created
   * lazily via @i18n-unused/imports.
   */
  readonly moduleGraph?: import("@i18n-unused/imports").ModuleGraph;
  /** Forwarded to ImportResolver when creating a graph. */
  readonly aliases?: Readonly<Record<string, string>>;
  readonly tsconfigPath?: string;
  readonly fileExists?: (absolutePath: string) => boolean;
  readonly readFile?: (absolutePath: string) => string | undefined;
  /**
   * Max dependency hops (cycles / runaway).
   * @default 256
   */
  readonly maxDepth?: number;
}

export interface EvaluateExpressionInput {
  readonly filePath: string;
  readonly sourceFile: import("typescript").SourceFile;
  readonly expression: import("typescript").Expression;
}

export interface EvaluateIdentifierInput {
  readonly filePath: string;
  readonly sourceFile: import("typescript").SourceFile;
  readonly name: string;
  readonly position?: number;
}

export interface ConstantEvaluator {
  /** Evaluate an expression node to a static string / string[]. */
  evaluateExpression(input: EvaluateExpressionInput): EvaluationResult;
  /** Evaluate a named constant / import binding. */
  evaluateIdentifier(input: EvaluateIdentifierInput): EvaluationResult;
  /** Access the constant dependency graph built so far. */
  getDependencyGraph(): ConstantDependencyGraph;
  clearCache(): void;
}

/** Lower-level value resolution over a single binding / expression. */
export interface ValueResolver {
  resolve(
    filePath: string,
    expression: import("typescript").Expression,
    sourceFile: import("typescript").SourceFile,
    context: EvaluationContext,
  ): EvaluationResult;
}

export interface EvaluationContext {
  readonly depth: number;
  readonly visited: ReadonlySet<string>;
  readonly chain: readonly EvaluationStep[];
}
