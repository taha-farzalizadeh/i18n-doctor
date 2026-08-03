/**
 * @i18n-unused/ast
 *
 * TypeScript Compiler API based AST engine.
 * Parses JS/JSX/TS/TSX, preserves locations/comments/parents,
 * and exposes traversal + query helpers.
 *
 * Does not perform symbol resolution, scope analysis, import graph, or i18n.
 */

export type {
  AstComment,
  AstContentKey,
  AstDiagnostic,
  AstEngine,
  AstEngineFactory,
  AstEngineOptions,
  AstFileId,
  AstJsxMode,
  AstLanguage,
  AstQueryApi,
  AstTraversalApi,
  AstVisitor,
  DiagnosticSeverity,
  ParseBatchResult,
  ParsedFile,
  ParseInput,
  SourceLocation,
  VisitResult,
} from "./api/index.js";

export { createAstEngine, astEngineFactory } from "./internal/create-engine.js";
export { traversalApi } from "./internal/traversal.js";
export { queryApi } from "./internal/query.js";
export {
  isSupportedSourceFileName,
  resolveScriptMeta,
} from "./internal/script-kind.js";
