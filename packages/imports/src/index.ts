/**
 * @i18n-unused/imports
 *
 * Cross-file import/export resolution and module graph.
 * Uses the AST Engine. No type checking, runtime evaluation, or i18n logic.
 */

export type {
  BuildGraphInput,
  Confidence,
  ExportBinding,
  ExportKind,
  ImportBinding,
  ImportKind,
  ImportResolver,
  ImportResolverOptions,
  ModuleGraph,
  ModuleRecord,
  ModuleResolveResult,
  ResolutionStep,
  ResolutionStepKind,
  ResolveSpecifierInput,
  ResolveSymbolInput,
  SourceLocation,
  SymbolResolution,
} from "./api/types.js";

export type { ImportResolverFactory } from "./api/resolver.js";

export {
  createImportResolver,
  importResolverFactory,
} from "./internal/create-resolver.js";
