import type ts from "typescript";

/** Supported script kinds for this engine. */
export type AstLanguage = "javascript" | "typescript";

export type AstJsxMode = "none" | "jsx" | "tsx";

/**
 * Opaque file identity. Prefer stable ids from the Project Scanner when available.
 * Falls back to path when not provided.
 */
export type AstFileId = string;

/** Content fingerprint for future incremental parsing. */
export interface AstContentKey {
  readonly fileId: AstFileId;
  /** Absolute or workspace-relative path used for ScriptKind inference and diagnostics. */
  readonly fileName: string;
  /** Optional precomputed hash (e.g. scanner content hash). */
  readonly contentHash?: string;
  /** Byte length of source text. */
  readonly size: number;
  /** Optional mtime probe for cheap invalidation. */
  readonly mtimeMs?: number;
}

export interface ParseInput {
  readonly fileId?: AstFileId;
  readonly fileName: string;
  readonly sourceText: string;
  /** Explicit language; inferred from fileName when omitted. */
  readonly language?: AstLanguage;
  /** Explicit JSX mode; inferred from extension when omitted. */
  readonly jsx?: AstJsxMode;
  readonly contentHash?: string;
  readonly mtimeMs?: number;
}

export type DiagnosticSeverity = "error" | "warning" | "suggestion" | "message";

export interface AstDiagnostic {
  readonly code: number;
  readonly message: string;
  readonly severity: DiagnosticSeverity;
  readonly fileName: string;
  readonly fileId: AstFileId;
  readonly start: number | undefined;
  readonly length: number | undefined;
  readonly line: number | undefined;
  readonly character: number | undefined;
  readonly category: "parse" | "engine";
}

export interface SourceLocation {
  readonly start: number;
  readonly end: number;
  readonly startLine: number;
  readonly startCharacter: number;
  readonly endLine: number;
  readonly endCharacter: number;
}

export interface AstComment {
  readonly kind: "line" | "block" | "hashbang";
  readonly text: string;
  readonly fullText: string;
  readonly start: number;
  readonly end: number;
  readonly hasTrailingNewLine: boolean;
}

/**
 * Parsed file result. Always returned even when diagnostics are present.
 * `ok` is false when parse errors exist; `sourceFile` remains usable best-effort AST.
 */
export interface ParsedFile {
  readonly fileId: AstFileId;
  readonly fileName: string;
  readonly language: AstLanguage;
  readonly jsx: AstJsxMode;
  readonly scriptKind: ts.ScriptKind;
  readonly sourceText: string;
  readonly sourceFile: ts.SourceFile;
  readonly diagnostics: readonly AstDiagnostic[];
  readonly ok: boolean;
  readonly contentKey: AstContentKey;
  readonly parsedAt: string;
  /** True when result was served from cache (incremental path). */
  readonly fromCache: boolean;
}

export interface ParseBatchResult {
  readonly files: readonly ParsedFile[];
  /** Files that threw engine-level failures (not syntax errors). */
  readonly engineErrors: readonly AstDiagnostic[];
  readonly timings: {
    readonly totalMs: number;
    readonly parseMs: number;
    readonly cacheHits: number;
    readonly cacheMisses: number;
  };
}

export interface AstEngineOptions {
  /**
   * Target language version for parsing.
   * @default Latest
   */
  readonly target?: ts.ScriptTarget;
  /**
   * Max concurrent parses for batch APIs.
   * @default 4
   */
  readonly concurrency?: number;
  /**
   * Enable in-memory parse cache keyed by content identity.
   * @default true
   */
  readonly cache?: boolean;
  /**
   * Max cached ParsedFile entries (LRU).
   * @default 2000
   */
  readonly cacheSize?: number;
  /**
   * Attach parent pointers on nodes (TS createSourceFile setParentNodes).
   * @default true
   */
  readonly setParentNodes?: boolean;
  /**
   * Retain full source text on ParsedFile (required for comment utilities).
   * @default true
   */
  readonly retainSourceText?: boolean;
}
