/**
 * @i18n-doctor/issues
 *
 * Issue Engine + reporters.
 * Compares definition/usage facts — no AST, no CLI coupling.
 */

export type {
  AnalysisResult,
  AnalyzeInput,
  DefinitionFact,
  DynamicUsageFact,
  FileLocation,
  Issue,
  IssueEngine,
  IssueEngineOptions,
  IssueSeverity,
  IssueSourceInfo,
  IssueStats,
  IssueType,
  JsonReporterOptions,
  Reporter,
  TerminalReporterOptions,
  UntranslatedLiteralFact,
  UsageFact,
} from "./api/types.js";

export type { IssueEngineFactory } from "./api/engine.js";

export {
  createIssueEngine,
  issueEngineFactory,
} from "./internal/create-engine.js";

export {
  definitionsFromCatalog,
  definitionFromKey,
  usagesFromCatalog,
  usageFromTranslationUsage,
  dynamicUsagesFromCatalog,
  dynamicUsageFromTranslation,
  untranslatedLiteralsFromCatalog,
  untranslatedFromLiteral,
} from "./internal/adapters.js";

export {
  definitionMatchesUsage,
  duplicateIdentity,
  logicalDefinitionKey,
  logicalKey,
  logicalUsageKey,
  matchContextFromOptions,
  resolveUsageNamespaces,
  type MatchContext,
} from "./internal/identity.js";

export {
  createTerminalReporter,
  formatTerminalReport,
} from "./internal/reporters/terminal.js";

export {
  createJsonReporter,
  formatJsonReport,
} from "./internal/reporters/json.js";

export { toFileUrl } from "./internal/location.js";
