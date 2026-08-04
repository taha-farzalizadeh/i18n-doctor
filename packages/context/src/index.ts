/**
 * @i18n-doctor/context
 *
 * Namespace, locale, and configuration intelligence.
 * Resolves translation keys using framework configuration and static
 * call-site context — never executes configuration files.
 *
 * Does not model runtime locale switching, browser behavior,
 * network loading, or plugin-specific execution.
 */

export type {
  AnalyzeContextInput,
  Confidence,
  ConfigAnalyzer,
  ConfigConflict,
  ConfigKind,
  ConfigLibraryId,
  ContextAnalyzer,
  ContextAnalyzerOptions,
  ContextWarning,
  EffectiveI18nSettings,
  LocaleResolveResult,
  LocaleResolver,
  NamespaceResolveResult,
  NamespaceResolver,
  ResolutionSource,
  ResolvedTranslationUsage,
  ResolveUsageOptions,
  SourceLocation,
  TranslationConfig,
  TranslationContext,
  UsageResolveInput,
} from "./api/types.js";

export type { ContextAnalyzerFactory } from "./api/analyzer.js";

export {
  createContextAnalyzer,
  contextAnalyzerFactory,
} from "./internal/create-analyzer.js";

export { createConfigAnalyzer } from "./internal/config-analyzer.js";
export { createNamespaceResolver } from "./internal/namespace-resolver.js";
export { createLocaleResolver } from "./internal/locale-resolver.js";
export { mergeConfigs } from "./internal/merge-config.js";
