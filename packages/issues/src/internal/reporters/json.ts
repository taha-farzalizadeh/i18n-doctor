import type {
  AnalysisResult,
  FileLocation,
  Issue,
  IssueSeverity,
  IssueSourceInfo,
  JsonReporterOptions,
  Reporter,
} from "../../api/types.js";
import { toPosixPath } from "../location.js";

export function createJsonReporter(
  options: JsonReporterOptions = {},
): Reporter {
  return {
    id: "json",
    report(result: AnalysisResult): string {
      return formatJsonReport(result, options);
    },
  };
}

export function formatJsonReport(
  result: AnalysisResult,
  options: JsonReporterOptions = {},
): string {
  const verbose = options.verbose ?? true;
  const pretty = options.pretty ?? true;

  // Explicit property order for stable machine-readable output.
  const payload = {
    root: result.root,
    stats: {
      total: result.stats.total,
      unusedKey: result.stats.unusedKey,
      missingKey: result.stats.missingKey,
      duplicateKey: result.stats.duplicateKey,
      bySeverity: stableSeverityMap(result.stats.bySeverity),
    },
    timings: {
      totalMs: roundMs(result.timings.totalMs),
      analyzeMs: roundMs(result.timings.analyzeMs),
    },
    issues: result.issues.map((issue) =>
      verbose ? toVerboseIssue(issue) : toCompactIssue(issue),
    ),
  };

  return pretty
    ? `${JSON.stringify(payload, null, 2)}\n`
    : JSON.stringify(payload);
}

function toCompactIssue(issue: Issue): Record<string, unknown> {
  return {
    type: issue.type,
    severity: issue.severity,
    key: issue.key,
    file: toPosixPath(issue.location.relativePath),
    line: issue.location.line,
    column: issue.location.column,
    message: issue.message,
  };
}

function toVerboseIssue(issue: Issue): Record<string, unknown> {
  return {
    type: issue.type,
    severity: issue.severity,
    key: issue.key,
    message: issue.message,
    location: stableLocation(issue.location),
    relatedLocations: issue.relatedLocations.map(stableLocation),
    source: stableSource(issue.source),
  };
}

function stableLocation(location: FileLocation): Record<string, unknown> {
  const out: Record<string, unknown> = {
    absolutePath: location.absolutePath,
    relativePath: toPosixPath(location.relativePath),
    line: location.line,
    column: location.column,
  };
  if (location.endLine !== undefined) out.endLine = location.endLine;
  if (location.endColumn !== undefined) out.endColumn = location.endColumn;
  if (location.start !== undefined) out.start = location.start;
  if (location.end !== undefined) out.end = location.end;
  if (location.locale !== undefined) out.locale = location.locale;
  if (location.namespace !== undefined) out.namespace = location.namespace;
  return out;
}

function stableSource(source: IssueSourceInfo): Record<string, unknown> {
  const out: Record<string, unknown> = {
    kind: source.kind,
  };
  if (source.locale !== undefined) out.locale = source.locale;
  if (source.namespace !== undefined) out.namespace = source.namespace;
  if (source.library !== undefined) out.library = source.library;
  if (source.confidence !== undefined) out.confidence = source.confidence;
  return out;
}

function stableSeverityMap(
  counts: Readonly<Partial<Record<IssueSeverity, number>>>,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const severity of ["error", "warning", "info"] as const) {
    if (counts[severity] !== undefined) {
      out[severity] = counts[severity];
    }
  }
  return out;
}

/** Integer milliseconds — avoids float jitter across runs. */
function roundMs(ms: number): number {
  return Math.round(ms);
}
