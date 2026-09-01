/**
 * Public CLI types — orchestration only; no analyzer logic.
 */

import type { EffectiveConfig } from "@i18n-doctor/config";
import type { CoverageResult } from "@i18n-doctor/coverage";
import type { ProjectDetectionResult } from "@i18n-doctor/detect";
import type { AnalysisResult, IssueSeverity } from "@i18n-doctor/issues";

/** Reporter formats supported by the CLI (beyond issues package). */
export type CliOutputFormat =
  | "terminal"
  | "json"
  | "sarif"
  | "markdown"
  | "html"
  | "silent";

export interface CheckCliOptions {
  /** Project path argument (relative or absolute). */
  readonly path?: string;
  /** Explicit config file path. */
  readonly config?: string;
  readonly json?: boolean;
  readonly sarif?: boolean;
  readonly markdown?: boolean;
  readonly html?: boolean;
  /** Reserved — not implemented. */
  readonly fix?: boolean;
  readonly silent?: boolean;
  readonly verbose?: boolean;
  /** Working directory for path resolution. */
  readonly cwd?: string;
  readonly noColor?: boolean;
  /** Framework override (detect FrameworkId or free string). */
  readonly framework?: string;
  /** Restrict analysis to this locale (also sets engine defaultLocale). */
  readonly locale?: string;
  /** Restrict analysis to this namespace. */
  readonly namespace?: string;
  /**
   * Limit usage analysis and reported issues to this directory (relative to
   * the project root). Translation catalogs are still loaded from the whole project.
   */
  readonly dir?: string;
  /** Disable the duplicate-key rule. */
  readonly ignoreDuplicates?: boolean;
  /**
   * Base locale for cross-locale coverage (keys missing in other langs).
   * Defaults to framework defaultLocale or "en".
   */
  readonly baseLocale?: string;
  /** Skip locale consistency / coverage analysis. */
  readonly noCoverage?: boolean;
}

export interface CliTimings {
  readonly totalMs: number;
  readonly discoverMs: number;
  readonly configMs: number;
  readonly detectMs: number;
  readonly sourcesMs: number;
  readonly usagesMs: number;
  readonly analyzeMs: number;
  readonly filterMs: number;
  readonly reportMs: number;
  readonly coverageMs?: number;
}

export interface CheckRunResult {
  readonly root: string;
  readonly config: EffectiveConfig;
  readonly detection: ProjectDetectionResult;
  readonly analysis: AnalysisResult;
  readonly format: CliOutputFormat;
  readonly report: string;
  readonly timings: CliTimings;
  readonly exitCode: number;
  readonly frameworkOverride?: string;
  /** Cross-locale coverage (keys missing/extra across languages). */
  readonly coverage?: CoverageResult;
}

export interface ProgressRenderer {
  start(label: string): void;
  step(label: string): void;
  succeed(label?: string): void;
  fail(label?: string): void;
  clear(): void;
}

export interface CliReporter {
  readonly id: CliOutputFormat;
  report(result: AnalysisResult, context?: CliReportContext): string;
}

export interface CliReportContext {
  readonly color?: boolean;
  readonly hyperlinks?: boolean;
  readonly verbose?: boolean;
  readonly timings?: CliTimings;
  readonly detection?: ProjectDetectionResult;
  readonly coverage?: CoverageResult;
}

export type SeverityCounts = {
  readonly error: number;
  readonly warning: number;
  readonly info: number;
};

export function countBySeverity(
  issues: readonly { readonly severity: IssueSeverity }[],
): SeverityCounts {
  let error = 0;
  let warning = 0;
  let info = 0;
  for (const issue of issues) {
    if (issue.severity === "error") error += 1;
    else if (issue.severity === "warning") warning += 1;
    else info += 1;
  }
  return { error, warning, info };
}
