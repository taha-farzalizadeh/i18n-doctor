/**
 * Merge multiple package AnalysisResults (monorepo) without re-analyzing.
 */

import type { AnalysisResult, Issue } from "@i18n-doctor/issues";
import { computeStats } from "./filter.js";
import { sortIssues } from "./reporters/select.js";
import { toPosixPath } from "./paths.js";

export function mergeAnalysisResults(
  workspaceRoot: string,
  parts: readonly AnalysisResult[],
): AnalysisResult {
  if (parts.length === 0) {
    return {
      root: workspaceRoot,
      issues: [],
      stats: {
        total: 0,
        unusedKey: 0,
        missingKey: 0,
        duplicateKey: 0,
        untranslatedText: 0,
        bySeverity: {},
      },
      timings: { totalMs: 0, analyzeMs: 0 },
    };
  }
  if (parts.length === 1) {
    const only = parts[0]!;
    return { ...only, root: workspaceRoot };
  }

  const issues: Issue[] = [];
  let analyzeMs = 0;
  let totalMs = 0;
  for (const part of parts) {
    issues.push(...part.issues);
    analyzeMs += part.timings.analyzeMs;
    totalMs += part.timings.totalMs;
  }

  const sorted = sortIssues(issues);
  return {
    root: toPosixPath(workspaceRoot),
    issues: sorted,
    stats: computeStats(sorted),
    timings: {
      totalMs: Math.round(totalMs),
      analyzeMs: Math.round(analyzeMs),
    },
  };
}
