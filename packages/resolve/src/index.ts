/**
 * @i18n-unused/resolve
 *
 * File-local alias and variable resolution.
 * Builds an alias graph + detects simple wrappers to improve usage accuracy.
 *
 * Constraints:
 * - Single file only
 * - No import resolution
 * - No cross-file references
 * - No full data-flow analysis
 */

export type {
  AliasBinding,
  AliasChainStep,
  AliasGraph,
  AliasKind,
  AliasTarget,
  AnalyzeInput,
  Confidence,
  FileAliasAnalysis,
  FunctionAlias,
  LocalResolver,
  LocalResolverOptions,
  ResolutionResult,
  ResolveIdentifierInput,
  SourceLocation,
} from "./api/types.js";

export type { LocalResolverFactory } from "./api/resolver.js";

export {
  createLocalResolver,
  localResolverFactory,
  resolveLocalIdentifier,
} from "./internal/create-resolver.js";

export { detectFunctionAliases } from "./internal/function-alias.js";
export { buildScopeTable } from "./internal/scopes.js";
