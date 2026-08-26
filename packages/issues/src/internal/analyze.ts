import type {
  AnalysisResult,
  AnalyzeInput,
  DefinitionFact,
  DynamicUsageFact,
  Issue,
  IssueEngineOptions,
  IssueSeverity,
  IssueStats,
  UntranslatedLiteralFact,
  UsageFact,
} from "../api/types.js";
import {
  definitionMatchesUsage,
  duplicateIdentity,
  logicalDefinitionKey,
  logicalUsageKey,
  matchContextFromOptions,
  resolveUsageNamespaces,
  type MatchContext,
} from "./identity.js";
import { definitionToLocation, usageToLocation } from "./location.js";

const DEFAULT_SEVERITIES = {
  unusedKey: "warning" as IssueSeverity,
  missingKey: "error" as IssueSeverity,
  duplicateKey: "warning" as IssueSeverity,
  untranslatedText: "info" as IssueSeverity,
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
  issues.push(
    ...findUnusedKeys(
      definitions,
      usages,
      input.dynamicUsages ?? [],
      options,
    ),
  );
  issues.push(...findMissingKeys(definitions, usages, options));
  issues.push(
    ...findUntranslatedText(input.untranslatedLiterals ?? [], options),
  );

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
      untranslatedText:
        options.severities?.untranslatedText ??
        DEFAULT_SEVERITIES.untranslatedText,
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
  dynamicUsages: readonly DynamicUsageFact[],
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

    const dynamicHits = dynamicUsages.filter((dyn) =>
      defs.some((def) => definitionMatchesDynamicUsage(def, dyn, options.match)),
    );

    // One issue per definition site so every locale/catalog file that carries
    // the unused key is underlined — not only the base locale.
    const ordered = sortDefinitions(defs);
    for (const def of ordered) {
      const relatedDefs = ordered
        .filter((d) => d !== def)
        .map(definitionToLocation);
      const relatedDynamic = dynamicHits.map(dynamicUsageToLocation);
      const related = [...relatedDynamic, ...relatedDefs];
      const nsHint = def.namespace
        ? ` in namespace "${def.namespace}"`
        : "";

      if (dynamicHits.length > 0) {
        const hint = formatDynamicHint(def.key, dynamicHits);
        issues.push({
          type: "unused-key",
          severity: "info",
          message: `Translation key "${def.key}"${nsHint} may be unused — ${hint}`,
          key: def.key,
          location: definitionToLocation(def),
          relatedLocations: related,
          source: {
            kind: "definition",
            reason: "dynamic-usage",
            ...(def.locale !== undefined ? { locale: def.locale } : {}),
            ...(def.namespace !== undefined ? { namespace: def.namespace } : {}),
            ...(def.confidence !== undefined
              ? { confidence: def.confidence }
              : {}),
          },
        });
        continue;
      }

      issues.push({
        type: "unused-key",
        severity: options.severities.unusedKey,
        message: `Unused translation key "${def.key}"${nsHint} — defined but never referenced.`,
        key: def.key,
        location: definitionToLocation(def),
        relatedLocations: related,
        source: {
          kind: "definition",
          ...(def.locale !== undefined ? { locale: def.locale } : {}),
          ...(def.namespace !== undefined ? { namespace: def.namespace } : {}),
          ...(def.confidence !== undefined
            ? { confidence: def.confidence }
            : {}),
        },
      });
    }
  }
  return issues;
}

function definitionMatchesDynamicUsage(
  definition: DefinitionFact,
  dynamic: DynamicUsageFact,
  ctx: MatchContext,
): boolean {
  if (!keyMatchesDynamicFragments(definition.key, dynamic)) {
    return false;
  }
  if (!ctx.matchNamespace || !definition.namespace) {
    return true;
  }
  const namespaces = resolveUsageNamespaces(
    {
      key: definition.key,
      absolutePath: dynamic.absolutePath,
      relativePath: dynamic.relativePath,
      line: dynamic.line,
      column: dynamic.column,
      ...(dynamic.namespace !== undefined
        ? { namespace: dynamic.namespace }
        : {}),
      ...(dynamic.namespaces !== undefined
        ? { namespaces: dynamic.namespaces }
        : {}),
    },
    ctx,
  );
  return namespaces.includes(definition.namespace);
}

function keyMatchesDynamicFragments(
  key: string,
  dynamic: DynamicUsageFact,
): boolean {
  for (const prefix of dynamic.prefixes) {
    if (prefix.length > 0 && key.startsWith(prefix)) {
      return true;
    }
  }
  for (const suffix of dynamic.suffixes) {
    if (suffix.length > 0 && key.endsWith(suffix)) {
      return true;
    }
  }
  for (const part of dynamic.contains) {
    if (part.length > 0 && key.includes(part)) {
      return true;
    }
  }
  return false;
}

function formatDynamicHint(
  key: string,
  hits: readonly DynamicUsageFact[],
): string {
  const primary = hits[0]!;
  const fragment =
    primary.prefixes.find((p) => key.startsWith(p)) ??
    primary.suffixes.find((s) => key.endsWith(s)) ??
    primary.contains.find((c) => key.includes(c)) ??
    primary.prefixes[0] ??
    primary.suffixes[0] ??
    primary.contains[0] ??
    "…";
  const where = `${primary.relativePath}:${primary.line}`;
  const more =
    hits.length > 1 ? ` (+${hits.length - 1} other dynamic site(s))` : "";
  return `possible dynamic usage matching "${fragment}" in ${where}${more}`;
}

function dynamicUsageToLocation(dyn: DynamicUsageFact) {
  return {
    absolutePath: dyn.absolutePath,
    relativePath: dyn.relativePath,
    line: dyn.line,
    column: dyn.column,
    ...(dyn.endLine !== undefined ? { endLine: dyn.endLine } : {}),
    ...(dyn.endColumn !== undefined ? { endColumn: dyn.endColumn } : {}),
    ...(dyn.start !== undefined ? { start: dyn.start } : {}),
    ...(dyn.end !== undefined ? { end: dyn.end } : {}),
    ...(dyn.namespace !== undefined ? { namespace: dyn.namespace } : {}),
  };
}

function findUntranslatedText(
  literals: readonly UntranslatedLiteralFact[],
  options: NormalizedOptions,
): Issue[] {
  const issues: Issue[] = [];
  for (const lit of literals) {
    if ((lit.confidence ?? 1) < options.minConfidence) {
      continue;
    }
    const display =
      lit.text.length > 60 ? `${lit.text.slice(0, 59)}…` : lit.text;
    const where =
      lit.attribute !== undefined
        ? ` in attribute "${lit.attribute}"`
        : lit.context === "jsx-text"
          ? " in JSX text"
          : "";
    issues.push({
      type: "untranslated-text",
      severity: options.severities.untranslatedText,
      message: `This text has no translation${where}: "${display}"`,
      key: lit.text,
      location: {
        absolutePath: lit.absolutePath,
        relativePath: lit.relativePath,
        line: lit.line,
        column: lit.column,
        ...(lit.endLine !== undefined ? { endLine: lit.endLine } : {}),
        ...(lit.endColumn !== undefined ? { endColumn: lit.endColumn } : {}),
        ...(lit.start !== undefined ? { start: lit.start } : {}),
        ...(lit.end !== undefined ? { end: lit.end } : {}),
      },
      relatedLocations: [],
      source: {
        kind: "literal",
        ...(lit.library !== undefined ? { library: lit.library } : {}),
        ...(lit.confidence !== undefined
          ? { confidence: lit.confidence }
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
    "untranslated-text": 3,
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
  let untranslatedText = 0;
  for (const issue of issues) {
    bySeverity[issue.severity] = (bySeverity[issue.severity] ?? 0) + 1;
    if (issue.type === "unused-key") unusedKey += 1;
    if (issue.type === "missing-key") missingKey += 1;
    if (issue.type === "duplicate-key") duplicateKey += 1;
    if (issue.type === "untranslated-text") untranslatedText += 1;
  }
  return {
    total: issues.length,
    unusedKey,
    missingKey,
    duplicateKey,
    untranslatedText,
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
