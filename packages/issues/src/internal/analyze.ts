import type {
  AnalysisResult,
  AnalyzeInput,
  DefinitionFact,
  Issue,
  IssueEngineOptions,
  IssueSeverity,
  IssueStats,
  UsageFact,
} from "../api/types.js";
import {
  definitionMatchesUsage,
  duplicateIdentity,
  logicalDefinitionKey,
  logicalUsageKey,
  matchContextFromOptions,
  type MatchContext,
} from "./identity.js";
import { definitionToLocation, usageToLocation } from "./location.js";

const DEFAULT_SEVERITIES = {
  unusedKey: "warning" as IssueSeverity,
  missingKey: "error" as IssueSeverity,
  duplicateKey: "warning" as IssueSeverity,
};

type NormalizedOptions = Required<
  Pick<
    IssueEngineOptions,
    "matchNamespace" | "strictLocale" | "minConfidence"
  >
> & {
  defaultLocale?: string;
  defaultNS?: string;
  fallbackNS?: readonly string[];
  severities: typeof DEFAULT_SEVERITIES;
  match: MatchContext;
};

export function analyzeIssues(input: AnalyzeInput): AnalysisResult {
  const started = performance.now();
  const options = normalizeOptions(input.options);
  const definitions = filterDefs(input.definitions, options.minConfidence);
  const usages = filterUsages(input.usages, options.minConfidence);

  const issues: Issue[] = [];
  issues.push(...findDuplicateKeys(definitions, options));
  issues.push(...findUnusedKeys(definitions, usages, options));
  issues.push(...findMissingKeys(definitions, usages, options));

  issues.sort(compareIssues);

  const analyzeMs = performance.now() - started;
  return {
    root: input.root,
    issues,
    stats: buildStats(issues),
    timings: {
      totalMs: analyzeMs,
      analyzeMs,
    },
  };
}

function normalizeOptions(options: IssueEngineOptions = {}): NormalizedOptions {
  const matchNamespace = options.matchNamespace ?? true;
  return {
    matchNamespace,
    strictLocale: options.strictLocale ?? false,
    minConfidence: options.minConfidence ?? 0,
    ...(options.defaultLocale !== undefined
      ? { defaultLocale: options.defaultLocale }
      : {}),
    ...(options.defaultNS !== undefined ? { defaultNS: options.defaultNS } : {}),
    ...(options.fallbackNS !== undefined
      ? { fallbackNS: options.fallbackNS }
      : {}),
    match: matchContextFromOptions({
      matchNamespace,
      ...(options.defaultNS !== undefined
        ? { defaultNS: options.defaultNS }
        : {}),
      ...(options.fallbackNS !== undefined
        ? { fallbackNS: options.fallbackNS }
        : {}),
    }),
    severities: {
      unusedKey: options.severities?.unusedKey ?? DEFAULT_SEVERITIES.unusedKey,
      missingKey: options.severities?.missingKey ?? DEFAULT_SEVERITIES.missingKey,
      duplicateKey:
        options.severities?.duplicateKey ?? DEFAULT_SEVERITIES.duplicateKey,
    },
  };
}

function filterDefs(
  facts: readonly DefinitionFact[],
  min: number,
): DefinitionFact[] {
  return facts.filter((f) => (f.confidence ?? 1) >= min);
}

function filterUsages(facts: readonly UsageFact[], min: number): UsageFact[] {
  return facts.filter((f) => (f.confidence ?? 1) >= min);
}

function findDuplicateKeys(
  definitions: readonly DefinitionFact[],
  options: NormalizedOptions,
): Issue[] {
  const groups = new Map<string, DefinitionFact[]>();
  for (const def of definitions) {
    const id = duplicateIdentity(def);
    const list = groups.get(id) ?? [];
    list.push(def);
    groups.set(id, list);
  }

  const issues: Issue[] = [];
  for (const [, group] of groups) {
    if (group.length < 2) {
      continue;
    }
    const ordered = sortDefinitions(group);
    const primary = ordered[0]!;
    const related = ordered.slice(1).map(definitionToLocation);
    const localePart = primary.locale ? ` (locale "${primary.locale}")` : "";
    const nsPart = primary.namespace
      ? ` (namespace "${primary.namespace}")`
      : "";
    issues.push({
      type: "duplicate-key",
      severity: options.severities.duplicateKey,
      message: `Duplicate translation key "${primary.key}" defined ${ordered.length} times${localePart}${nsPart}.`,
      key: primary.key,
      location: definitionToLocation(primary),
      relatedLocations: related,
      source: {
        kind: "definition-collision",
        ...(primary.locale !== undefined ? { locale: primary.locale } : {}),
        ...(primary.namespace !== undefined
          ? { namespace: primary.namespace }
          : {}),
        ...(primary.confidence !== undefined
          ? { confidence: primary.confidence }
          : {}),
      },
    });
  }
  return issues;
}

function findUnusedKeys(
  definitions: readonly DefinitionFact[],
  usages: readonly UsageFact[],
  options: NormalizedOptions,
): Issue[] {
  const byLogical = new Map<string, DefinitionFact[]>();
  for (const def of definitions) {
    const logical = logicalDefinitionKey(def, options.matchNamespace);
    const list = byLogical.get(logical) ?? [];
    list.push(def);
    byLogical.set(logical, list);
  }

  const issues: Issue[] = [];
  for (const [, defs] of byLogical) {
    const isUsed = usages.some((usage) =>
      defs.some((def) => definitionMatchesUsage(def, usage, options.match)),
    );
    if (isUsed) {
      continue;
    }

    const ordered = sortDefinitions(defs);
    const primary = pickPrimaryDefinition(ordered, options.defaultLocale);
    const related = ordered
      .filter((d) => d !== primary)
      .map(definitionToLocation);

    const nsHint = primary.namespace
      ? ` in namespace "${primary.namespace}"`
      : "";
    issues.push({
      type: "unused-key",
      severity: options.severities.unusedKey,
      message: `Unused translation key "${primary.key}"${nsHint} — defined but never referenced.`,
      key: primary.key,
      location: definitionToLocation(primary),
      relatedLocations: related,
      source: {
        kind: "definition",
        ...(primary.locale !== undefined ? { locale: primary.locale } : {}),
        ...(primary.namespace !== undefined
          ? { namespace: primary.namespace }
          : {}),
        ...(primary.confidence !== undefined
          ? { confidence: primary.confidence }
          : {}),
      },
    });
  }
  return issues;
}

function findMissingKeys(
  definitions: readonly DefinitionFact[],
  usages: readonly UsageFact[],
  options: NormalizedOptions,
): Issue[] {
  const activeDefinitions = definitionsInScope(definitions, options);

  const missingGroups = new Map<string, UsageFact[]>();
  for (const usage of usages) {
    const found = activeDefinitions.some((def) =>
      definitionMatchesUsage(def, usage, options.match),
    );
    if (found) {
      continue;
    }
    const logical = logicalUsageKey(usage, options.match);
    const list = missingGroups.get(logical) ?? [];
    list.push(usage);
    missingGroups.set(logical, list);
  }

  const issues: Issue[] = [];
  for (const [, group] of missingGroups) {
    const ordered = sortUsages(group);
    const primary = ordered[0]!;
    const related = ordered.slice(1).map(usageToLocation);
    const nsHint = primary.namespace
      ? ` in namespace "${primary.namespace}"`
      : "";
    issues.push({
      type: "missing-key",
      severity: options.severities.missingKey,
      message: `Missing translation key "${primary.key}"${nsHint} — used in code but not defined in translation sources.`,
      key: primary.key,
      location: usageToLocation(primary),
      relatedLocations: related,
      source: {
        kind: "usage",
        ...(primary.namespace !== undefined
          ? { namespace: primary.namespace }
          : {}),
        ...(primary.library !== undefined ? { library: primary.library } : {}),
        ...(primary.confidence !== undefined
          ? { confidence: primary.confidence }
          : {}),
      },
    });
  }
  return issues;
}

function definitionsInScope(
  definitions: readonly DefinitionFact[],
  options: NormalizedOptions,
): DefinitionFact[] {
  if (!options.strictLocale || !options.defaultLocale) {
    return [...definitions];
  }
  const locale = options.defaultLocale;
  // Prefer definitions for the default locale; if none exist for a key group,
  // still allow unlocale'd definitions (unknown locale) as a soft fallback.
  const scoped = definitions.filter(
    (d) => !d.locale || d.locale === locale,
  );
  return scoped;
}

function pickPrimaryDefinition(
  defs: readonly DefinitionFact[],
  defaultLocale?: string,
): DefinitionFact {
  const ranked = [...defs].sort((a, b) => {
    const score = (d: DefinitionFact) => {
      if (defaultLocale && d.locale === defaultLocale) return 0;
      if (d.locale === "en" || d.locale === "en-US") return 1;
      if (!d.locale) return 2;
      return 3;
    };
    return (
      score(a) - score(b) ||
      compareDefinitionOrder(a, b)
    );
  });
  return ranked[0]!;
}

function sortDefinitions(
  defs: readonly DefinitionFact[],
): DefinitionFact[] {
  return [...defs].sort(compareDefinitionOrder);
}

function sortUsages(usages: readonly UsageFact[]): UsageFact[] {
  return [...usages].sort(compareUsageOrder);
}

function compareDefinitionOrder(a: DefinitionFact, b: DefinitionFact): number {
  return (
    a.relativePath.localeCompare(b.relativePath) ||
    a.line - b.line ||
    a.column - b.column ||
    (a.locale ?? "").localeCompare(b.locale ?? "") ||
    (a.namespace ?? "").localeCompare(b.namespace ?? "") ||
    a.key.localeCompare(b.key)
  );
}

function compareUsageOrder(a: UsageFact, b: UsageFact): number {
  return (
    a.relativePath.localeCompare(b.relativePath) ||
    a.line - b.line ||
    a.column - b.column ||
    (a.namespace ?? "").localeCompare(b.namespace ?? "") ||
    a.key.localeCompare(b.key)
  );
}

function compareIssues(a: Issue, b: Issue): number {
  const order: Record<Issue["type"], number> = {
    "missing-key": 0,
    "duplicate-key": 1,
    "unused-key": 2,
  };
  return (
    order[a.type] - order[b.type] ||
    a.key.localeCompare(b.key) ||
    (a.source.namespace ?? "").localeCompare(b.source.namespace ?? "") ||
    a.location.relativePath.localeCompare(b.location.relativePath) ||
    a.location.line - b.location.line ||
    a.location.column - b.location.column ||
    severityRank(a.severity) - severityRank(b.severity)
  );
}

function severityRank(severity: IssueSeverity): number {
  switch (severity) {
    case "error":
      return 0;
    case "warning":
      return 1;
    case "info":
      return 2;
  }
}

function buildStats(issues: readonly Issue[]): IssueStats {
  const bySeverity: Partial<Record<IssueSeverity, number>> = {};
  let unusedKey = 0;
  let missingKey = 0;
  let duplicateKey = 0;
  for (const issue of issues) {
    bySeverity[issue.severity] = (bySeverity[issue.severity] ?? 0) + 1;
    if (issue.type === "unused-key") unusedKey += 1;
    if (issue.type === "missing-key") missingKey += 1;
    if (issue.type === "duplicate-key") duplicateKey += 1;
  }
  return {
    total: issues.length,
    unusedKey,
    missingKey,
    duplicateKey,
    bySeverity: orderSeverityCounts(bySeverity),
  };
}

/** Stable key order for machine-readable consumers. */
function orderSeverityCounts(
  counts: Partial<Record<IssueSeverity, number>>,
): Partial<Record<IssueSeverity, number>> {
  const ordered: Partial<Record<IssueSeverity, number>> = {};
  for (const severity of ["error", "warning", "info"] as const) {
    if (counts[severity] !== undefined) {
      ordered[severity] = counts[severity];
    }
  }
  return ordered;
}
