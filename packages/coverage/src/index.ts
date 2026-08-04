/**
 * @i18n-doctor/coverage
 *
 * Translation coverage and locale consistency.
 * Reuses @i18n-doctor/sources catalogs — does not re-parse locale files.
 */

export type {
  AnalyzeCoverageInput,
  AnalyzeFromRootInput,
  CoverageAnalyzer,
  CoverageAnalyzerOptions,
  CoverageDiagnostic,
  CoverageFileLocation,
  CoverageIssue,
  CoverageIssueType,
  CoverageResult,
  CoverageStats,
  ExtraKeyFinding,
  KeyCoverage,
  LocaleCoverageStat,
  LocaleTree,
  LocaleTreeNode,
  MergedLocaleModel,
  MergedLocaleNamespace,
  NamespaceCoverage,
} from "./api/types.js";

export type { CoverageAnalyzerFactory } from "./api/analyzer.js";

export {
  createCoverageAnalyzer,
  coverageAnalyzerFactory,
} from "./internal/create-analyzer.js";

export { mergeLocaleCatalogs } from "./internal/merge-locales.js";
export {
  buildLocaleTree,
  emptyLocaleTree,
  splitKeyPath,
  walkLocaleTree,
} from "./internal/build-tree.js";
export {
  analyzeCatalogs,
  analyzeMergedModel,
  pickBaseLocale,
} from "./internal/analyze-coverage.js";
export { resolveLocales } from "./internal/resolve-locales.js";
export { buildCoverageIssues } from "./internal/build-issues.js";

export { formatCoverageJson } from "./internal/format-json.js";
export type { JsonCoverageReporterOptions } from "./internal/format-json.js";

export { formatCoverageReport } from "./internal/format-report.js";
export type { TerminalCoverageReporterOptions } from "./internal/format-report.js";
