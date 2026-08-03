import type {
  AstEngineOptions,
  AstFileId,
  ParseBatchResult,
  ParsedFile,
  ParseInput,
} from "./types.js";

/**
 * Public AST engine port.
 *
 * Responsibilities: parse source → AST + diagnostics.
 * Non-responsibilities: symbol/scope/import resolution, i18n.
 */
export interface AstEngine {
  /** Parse a single file. Never throws on syntax errors. */
  parse(input: ParseInput): ParsedFile;

  /**
   * Parse many files with bounded concurrency.
   * Per-file syntax failures become diagnostics; batch continues.
   */
  parseMany(inputs: readonly ParseInput[]): Promise<ParseBatchResult>;

  /** Drop a single cache entry (future incremental invalidation). */
  invalidate(fileId: AstFileId): void;

  /** Drop all cache entries. */
  clearCache(): void;

  readonly options: Readonly<Required<AstEngineOptions>>;
}

export interface AstEngineFactory {
  createAstEngine(options?: AstEngineOptions): AstEngine;
}
