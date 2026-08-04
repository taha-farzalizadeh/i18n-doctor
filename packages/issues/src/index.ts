/**
 * @i18n-unused/issues
 *
 * Issue Engine + reporters.
 * Compares definition/usage facts — no AST, no CLI coupling.
 */

export type {
  AnalysisResult,
  AnalyzeInput,
  DefinitionFact,
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
} from "./internal/adapters.js";

export {
  definitionMatchesUsage,
  duplicateIdentity,
  logicalDefinitionKey,
  logicalUsageKey,
  matchContextFromOptions,
  resolveUsageNamespaces,
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
