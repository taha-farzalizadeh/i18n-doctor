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

export type ImportKind =
  | "named"
  | "default"
  | "namespace"
  | "side-effect";

export type ExportKind =
  | "local"
  | "re-export"
  | "default"
  | "export-all";

export type ResolutionStepKind =
  | "usage"
  | "import"
  | "export"
  | "re-export"
  | "star-export"
  | "declaration"
  | "module";

/** One hop in a cross-file resolution chain. */
export interface ResolutionStep {
  readonly kind: ResolutionStepKind;
  /** Absolute OS path when known. */
  readonly absolutePath?: string;
  /** Workspace-relative POSIX path when known. */
  readonly relativePath?: string;
  readonly symbol?: string;
  readonly specifier?: string;
  readonly location?: SourceLocation;
}

/**
 * Result of resolving an identifier through import/export edges
 * to its source declaration (file-local or cross-file).
 */
export interface SymbolResolution {
  /** Original usage site. */
  readonly originalUsage: {
    readonly absolutePath: string;
    readonly relativePath: string;
    readonly identifier: string;
    readonly location: SourceLocation;
  };
  /** Module that ultimately declares the value. */
  readonly resolvedSourceFile: string;
  /** Relative path of the declaration module. */
  readonly resolvedRelativePath: string;
  /** Exported symbol name (`"default"` for default exports). */
  readonly exportedSymbol: string;
  /** Local declaration name in the source module when known. */
  readonly localName?: string;
  readonly declarationLocation: SourceLocation;
  readonly resolutionChain: readonly ResolutionStep[];
  readonly confidence: Confidence;
  readonly circular: boolean;
  readonly unresolved: boolean;
}

/** Import binding recorded for a module. */
export interface ImportBinding {
  readonly localName: string;
  /**
   * Name requested from the target module:
   * - named: exported name
   * - default: `"default"`
   * - namespace: `"*"`
   */
  readonly importedName: string;
  readonly specifier: string;
  readonly kind: ImportKind;
  readonly location: SourceLocation;
}

/** Export binding recorded for a module. */
export interface ExportBinding {
  /** Public export name (`"default"` for default). */
  readonly exportName: string;
  /** Local binding name when the export is local. */
  readonly localName?: string;
  readonly kind: ExportKind;
  readonly location: SourceLocation;
  /** For re-exports / export-all source specifier. */
  readonly fromSpecifier?: string;
  /** Export name in the source module (defaults to exportName). */
  readonly fromExportName?: string;
}

/** One analyzed module in the graph. */
export interface ModuleRecord {
  readonly absolutePath: string;
  readonly relativePath: string;
  readonly imports: readonly ImportBinding[];
  readonly exports: readonly ExportBinding[];
  /** `export * from "..."` edges. */
  readonly starExports: readonly {
    readonly specifier: string;
    readonly location: SourceLocation;
  }[];
  readonly sideEffectImports: readonly {
    readonly specifier: string;
    readonly location: SourceLocation;
  }[];
}

/**
 * Directed module graph with lazy/cached module records.
 * Framework/i18n agnostic.
 */
export interface ModuleGraph {
  readonly root: string;
  /** Absolute paths known to the graph (requested or discovered). */
  readonly modulePaths: readonly string[];
  getModule(absolutePath: string): ModuleRecord | undefined;
  /** Ensure a module is parsed and cached. */
  loadModule(absolutePath: string): ModuleRecord | undefined;
}

export interface ModuleResolveResult {
  readonly absolutePath: string;
  readonly relativePath: string;
  readonly confidence: Confidence;
  /** How the specifier was resolved. */
  readonly strategy:
    | "relative"
    | "alias"
    | "tsconfig-paths"
    | "index"
    | "extension";
}

export interface ImportResolverOptions {
  /** Project root (absolute). */
  readonly root: string;
  /**
   * Path aliases: prefix → root-relative or absolute directory.
   * Example: { "@/": "src/" }
   */
  readonly aliases?: Readonly<Record<string, string>>;
  /**
   * Explicit tsconfig path (defaults to `<root>/tsconfig.json` when present).
   */
  readonly tsconfigPath?: string;
  /**
   * Try these extensions when resolving bare file paths.
   * @default [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"]
   */
  readonly extensions?: readonly string[];
  /**
   * Index basenames tried inside directories.
   * @default ["index"]
   */
  readonly indexNames?: readonly string[];
  /**
   * Max re-export / star-export hops.
   * @default 32
   */
  readonly maxDepth?: number;
  /** Custom file existence probe (tests / virtual FS). */
  readonly fileExists?: (absolutePath: string) => boolean;
  /** Custom file reader (tests / virtual FS). */
  readonly readFile?: (absolutePath: string) => string | undefined;
}

export interface BuildGraphInput {
  /**
   * Absolute (or root-relative) entry files to seed the graph.
   * When omitted, only modules touched by resolve calls are loaded (lazy).
   */
  readonly entryFiles?: readonly string[];
  /** Eagerly follow import edges from entries up to this depth. @default 0 (lazy) */
  readonly followDepth?: number;
}

export interface ResolveSymbolInput {
  readonly graph: ModuleGraph;
  /** Absolute or root-relative path of the usage file. */
  readonly filePath: string;
  /** Identifier to resolve (import local name or local binding). */
  readonly identifier: string;
  /** UTF-16 offset of the usage (selects the correct import when shadowed). */
  readonly position?: number;
  readonly location?: SourceLocation;
}

export interface ResolveSpecifierInput {
  readonly fromFile: string;
  readonly specifier: string;
}

export interface ImportResolver {
  /** Create / extend a module graph for a project root. */
  buildGraph(input?: BuildGraphInput): ModuleGraph;
  /** Resolve an import specifier to a module file. */
  resolveSpecifier(input: ResolveSpecifierInput): ModuleResolveResult | undefined;
  /**
   * Resolve an identifier through imports/exports to its declaration.
   * Does not perform type checking or runtime evaluation.
   */
  resolveSymbol(input: ResolveSymbolInput): SymbolResolution;
  /** Drop cached modules / path resolutions. */
  clearCache(): void;
}
