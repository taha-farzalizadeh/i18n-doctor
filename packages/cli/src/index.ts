/**
 * @i18n-doctor/cli
 *
 * Production CLI — command parsing, config, discovery, reporting, exit codes.
 * Analysis is delegated to @i18n-doctor/{detect,sources,usages,issues,config}.
 */

export type {
  CheckCliOptions,
  CheckRunResult,
  CliOutputFormat,
  CliReportContext,
  CliReporter,
  CliTimings,
  ProgressRenderer,
  SeverityCounts,
} from "./api/types.js";

export { countBySeverity } from "./api/types.js";

export { createProgram, runCli } from "./cli.js";
export { runCheck, writeCheckReport } from "./internal/run-check.js";
export {
  assertConfigReadable,
  discoverProject,
} from "./internal/discover.js";
export { selectReporter, stabilizeResult, sortIssues } from "./internal/reporters/select.js";
export { createProgressRenderer, shouldShowProgress } from "./internal/progress.js";
export {
  CliError,
  cliErrorFromErrno,
  formatCliError,
  handleCliError,
} from "./internal/errors.js";
export { getPackageVersion } from "./internal/version.js";
export { toPosixPath, normalizeAbsolute, pathsEqual } from "./internal/paths.js";
export { detectTerminalCapabilities } from "./internal/supports.js";
export { resolveScanLimits } from "./internal/scan-limits.js";
export { mergeAnalysisResults } from "./internal/merge-results.js";
