/**
 * Post/pre-analysis filtering using @i18n-doctor/config engines.
 * Does not change issue matching logic — only drops/remaps findings.
 */

import fs from "node:fs";
import type {
  EffectiveConfig,
  IgnoreEngine,
  RuleId,
  RuleSeverity,
  SuppressionEngine,
} from "@i18n-doctor/config";
import type {
  AnalysisResult,
  DefinitionFact,
  Issue,
  IssueSeverity,
  IssueStats,
  UsageFact,
} from "@i18n-doctor/issues";

export function filterDefinitionFacts(
  definitions: readonly DefinitionFact[],
  ignore: IgnoreEngine,
  filters: { readonly locale?: string; readonly namespace?: string },
): DefinitionFact[] {
  return definitions.filter((d) => {
    if (ignore.shouldAnalyzeFile(d.relativePath).ignored) return false;
    if (ignore.isKeyIgnored(d.key).ignored) return false;
    if (d.locale !== undefined && ignore.isLocaleIgnored(d.locale).ignored) {
      return false;
    }
    if (
      d.namespace !== undefined &&
      ignore.isNamespaceIgnored(d.namespace).ignored
    ) {
      return false;
    }
    if (filters.locale && d.locale !== undefined && d.locale !== filters.locale) {
      return false;
    }
    if (
      filters.namespace &&
      d.namespace !== undefined &&
      d.namespace !== filters.namespace
    ) {
      return false;
    }
    return true;
  });
}

export function filterUsageFacts(
  usages: readonly UsageFact[],
  ignore: IgnoreEngine,
  filters: { readonly locale?: string; readonly namespace?: string },
): UsageFact[] {
  void filters.locale; // usages typically lack locale; namespace filter applies
  return usages.filter((u) => {
    if (ignore.shouldAnalyzeFile(u.relativePath).ignored) return false;
    if (ignore.isKeyIgnored(u.key).ignored) return false;
    if (
      u.namespace !== undefined &&
      ignore.isNamespaceIgnored(u.namespace).ignored
    ) {
      return false;
    }
    if (
      filters.namespace &&
      u.namespace !== undefined &&
      u.namespace !== filters.namespace
    ) {
      return false;
    }
    return true;
  });
}

export function applyIssuePolicies(
  result: AnalysisResult,
  config: EffectiveConfig,
  suppress: SuppressionEngine,
  readFile: ReadFile = readFileFromDisk,
): AnalysisResult {
  const cache = new Map<
    string,
    ReturnType<SuppressionEngine["parseFile"]> | null
  >();

  const issues: Issue[] = [];
  for (const issue of result.issues) {
    const rule = issue.type as RuleId;
    if (!config.rules.isEnabled(rule)) continue;

    const severity = mapRuleSeverity(config.rules.getSeverity(rule));
    if (severity === undefined) continue;

    if (isSuppressed(issue, suppress, cache, readFile)) continue;

    issues.push(severity === issue.severity ? issue : { ...issue, severity });
  }

  return {
    root: result.root,
    issues,
    stats: computeStats(issues),
    timings: result.timings,
  };
}

/** Reads a file's text, or returns undefined when unavailable. */
export type ReadFile = (absolutePath: string) => string | undefined;

function readFileFromDisk(absolutePath: string): string | undefined {
  try {
    return fs.readFileSync(absolutePath, "utf8");
  } catch {
    return undefined;
  }
}

function isSuppressed(
  issue: Issue,
  suppress: SuppressionEngine,
  cache: Map<string, ReturnType<SuppressionEngine["parseFile"]> | null>,
  readFile: ReadFile,
): boolean {
  const abs = issue.location.absolutePath;
  let file = cache.get(abs);
  if (file === undefined) {
    const sourceText = readFile(abs);
    if (sourceText === undefined) {
      file = null;
    } else {
      try {
        file = suppress.parseFile({
          absolutePath: abs,
          relativePath: issue.location.relativePath,
          sourceText,
        });
      } catch {
        file = null;
      }
    }
    cache.set(abs, file);
  }
  if (!file) return false;
  return suppress.isSuppressed(file, {
    line: issue.location.line,
    rule: issue.type as RuleId,
  }).suppressed;
}

function mapRuleSeverity(
  severity: RuleSeverity,
): IssueSeverity | undefined {
  if (severity === "off") return undefined;
  return severity;
}

export function computeStats(issues: readonly Issue[]): IssueStats {
  let unusedKey = 0;
  let missingKey = 0;
  let duplicateKey = 0;
  const bySeverity: Partial<Record<IssueSeverity, number>> = {};

  for (const issue of issues) {
    if (issue.type === "unused-key") unusedKey += 1;
    else if (issue.type === "missing-key") missingKey += 1;
    else duplicateKey += 1;
    bySeverity[issue.severity] = (bySeverity[issue.severity] ?? 0) + 1;
  }

  return {
    total: issues.length,
    unusedKey,
    missingKey,
    duplicateKey,
    bySeverity,
  };
}
