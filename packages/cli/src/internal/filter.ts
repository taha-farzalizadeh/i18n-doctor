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
  DynamicUsageFact,
  Issue,
  IssueSeverity,
  IssueStats,
  UntranslatedLiteralFact,
  UsageFact,
} from "@i18n-doctor/issues";
import { toPosixPath } from "./paths.js";

export function filterDefinitionFacts(
  definitions: readonly DefinitionFact[],
  ignore: IgnoreEngine,
  filters: { readonly locale?: string; readonly namespace?: string },
): DefinitionFact[] {
  // NOTE: keys are deliberately NOT filtered here. `ignoreKeys` must only
  // suppress `unused-key` diagnostics (see applyIssuePolicies) — dropping
  // definitions here would also disable duplicate-key detection.
  return definitions.filter((d) => {
    if (ignore.shouldAnalyzeFile(d.relativePath).ignored) return false;
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
  // NOTE: keys are deliberately NOT filtered here. `ignoreKeys` must only
  // suppress `unused-key` diagnostics (see applyIssuePolicies) — dropping
  // usages here would also disable missing-key detection.
  return usages.filter((u) => {
    if (ignore.shouldAnalyzeFile(u.relativePath).ignored) return false;
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

export function filterDynamicUsageFacts(
  usages: readonly DynamicUsageFact[],
  ignore: IgnoreEngine,
  filters: { readonly locale?: string; readonly namespace?: string },
): DynamicUsageFact[] {
  void filters.locale;
  return usages.filter((u) => {
    if (ignore.shouldAnalyzeFile(u.relativePath).ignored) return false;
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

export function filterUntranslatedLiteralFacts(
  literals: readonly UntranslatedLiteralFact[],
  ignore: IgnoreEngine,
): UntranslatedLiteralFact[] {
  // NOTE: literal *text* is not a translation key — `ignoreKeys` must not
  // suppress hardcoded-text diagnostics (see applyIssuePolicies for the
  // single place where ignoreKeys applies).
  return literals.filter((lit) => {
    if (ignore.shouldAnalyzeFile(lit.relativePath).ignored) return false;
    return true;
  });
}

export function applyIssuePolicies(
  result: AnalysisResult,
  config: EffectiveConfig,
  suppress: SuppressionEngine,
  readFile: ReadFile = readFileFromDisk,
  ignore?: IgnoreEngine,
): AnalysisResult {
  const cache = new Map<
    string,
    ReturnType<SuppressionEngine["parseFile"]> | null
  >();

  const issues: Issue[] = [];
  for (const issue of result.issues) {
    const rule = issue.type as RuleId;
    if (!config.rules.isEnabled(rule)) continue;

    // `ignoreKeys` suppresses ONLY `unused-key` diagnostics for matching
    // keys. Missing-key, duplicate-key, locale consistency, and hardcoded
    // text detection stay fully active (single shared matcher — the same
    // IgnoreEngine the fact filters use).
    if (
      rule === "unused-key" &&
      ignore !== undefined &&
      ignore.isKeyIgnored(issue.key).ignored
    ) {
      continue;
    }

    const severity = mapRuleSeverity(config.rules.getSeverity(rule));
    if (severity === undefined) continue;

    if (isSuppressed(issue, suppress, cache, readFile)) continue;

    const nextSeverity = softenDynamicUnusedSeverity(issue, severity);
    issues.push(
      nextSeverity === issue.severity
        ? issue
        : { ...issue, severity: nextSeverity },
    );
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

/**
 * Keep dynamic-maybe-unused softer than a hard unused finding even when the
 * unused-key rule is configured as warning/error.
 */
function softenDynamicUnusedSeverity(
  issue: Issue,
  ruleSeverity: IssueSeverity,
): IssueSeverity {
  if (
    issue.type !== "unused-key" ||
    issue.source.reason !== "dynamic-usage"
  ) {
    return ruleSeverity;
  }
  if (ruleSeverity === "error") {
    return "warning";
  }
  if (ruleSeverity === "warning") {
    return "info";
  }
  return ruleSeverity;
}

export function computeStats(issues: readonly Issue[]): IssueStats {
  let unusedKey = 0;
  let missingKey = 0;
  let duplicateKey = 0;
  let untranslatedText = 0;
  const bySeverity: Partial<Record<IssueSeverity, number>> = {};

  for (const issue of issues) {
    if (issue.type === "unused-key") unusedKey += 1;
    else if (issue.type === "missing-key") missingKey += 1;
    else if (issue.type === "duplicate-key") duplicateKey += 1;
    else if (issue.type === "untranslated-text") untranslatedText += 1;
    bySeverity[issue.severity] = (bySeverity[issue.severity] ?? 0) + 1;
  }

  return {
    total: issues.length,
    unusedKey,
    missingKey,
    duplicateKey,
    untranslatedText,
    bySeverity,
  };
}

/** Whether a workspace-relative path is inside a scan directory. */
export function isUnderScanDir(
  relativePath: string,
  scanDir: string,
): boolean {
  const normalized = toPosixPath(relativePath);
  const prefix = toPosixPath(scanDir).replace(/\/$/, "");
  if (prefix.length === 0) {
    return true;
  }
  return normalized === prefix || normalized.startsWith(`${prefix}/`);
}

export function filterIssuesByScanDir(
  issues: readonly Issue[],
  scanDir: string,
): Issue[] {
  return issues.filter((issue) => issueMatchesScanDir(issue, scanDir));
}

export function filterAnalysisByScanDir(
  result: AnalysisResult,
  scanDir: string,
): AnalysisResult {
  const issues = filterIssuesByScanDir(result.issues, scanDir);
  return {
    root: result.root,
    issues,
    stats: computeStats(issues),
    timings: result.timings,
  };
}

function issueMatchesScanDir(issue: Issue, scanDir: string): boolean {
  if (isUnderScanDir(issue.location.relativePath, scanDir)) {
    return true;
  }
  if (issue.type === "duplicate-key") {
    return issue.relatedLocations.some((loc) =>
      isUnderScanDir(loc.relativePath, scanDir),
    );
  }
  return false;
}
