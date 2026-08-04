/**
 * Public CLI types — orchestration only; no analyzer logic.
 */

import type { EffectiveConfig } from "@i18n-unused/config";
import type { ProjectDetectionResult } from "@i18n-unused/detect";
import type { AnalysisResult, IssueSeverity } from "@i18n-unused/issues";

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
  /** Disable the duplicate-key rule. */
  readonly ignoreDuplicates?: boolean;
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
