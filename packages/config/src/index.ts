/**
 * @i18n-doctor/config
 *
 * Configuration loading, ignore rules, and inline suppression.
 * Config files are never executed — JSON parse or static AST only.
 *
 * Does not implement CLI parsing or reporters.
 */

export type {
  ConfigDiagnostic,
  ConfigFragment,
  ConfigLoader,
  ConfigLoaderOptions,
  ConfigSourceKind,
  EffectiveConfig,
  EffectiveConfigResolver,
  ExitBehavior,
  FileSuppressions,
  IgnoreEngine,
  IgnoreMatch,
  LanguageServerConfig,
  LanguageServerLogLevel,
  LoadedConfig,
  OutputConfig,
  OutputFormat,
  ResolveEffectiveOptions,
  RuleConfiguration,
  RuleId,
  RuleSeverity,
  SuppressionDirective,
  SuppressionEngine,
  SuppressionKind,
  SuppressionMatch,
  SuppressionQuery,
  UserConfig,
} from "./api/types.js";

export type { ConfigLoaderFactory } from "./api/loader.js";
export type {
  LoadConfigOptions,
  LoadConfigResult,
} from "./api/define-config.js";
export { defineConfig, loadConfig } from "./api/define-config.js";

export type {
  EffectiveConfigResolverFactory,
  IgnoreEngineFactory,
  SuppressionEngineFactory,
} from "./api/resolver.js";

export {
  createConfigLoader,
  configLoaderFactory,
} from "./internal/create-loader.js";

export {
  createEffectiveConfigResolver,
  effectiveConfigResolverFactory,
} from "./internal/create-resolver.js";

export {
  createIgnoreEngine,
  ignoreEngineFactory,
} from "./internal/ignore-engine.js";

export {
  createSuppressionEngine,
  suppressionEngineFactory,
  parseDirectives,
  matchSuppression,
} from "./internal/suppression-engine.js";

export {
  createRuleConfiguration,
  createExitBehavior,
  mergeFragments,
  defaultsFragment,
} from "./internal/merge.js";

export { validateUserConfig } from "./internal/validate.js";
export {
  RULE_IDS,
  DEFAULT_RULE_SEVERITIES,
  DEFAULT_LANGUAGE_SERVER,
  LANGUAGE_SERVER_LOG_LEVELS,
  CONFIG_FILENAMES,
} from "./internal/defaults.js";
export { compileGlob } from "./internal/glob.js";
export type { CompileGlobOptions } from "./internal/glob.js";
