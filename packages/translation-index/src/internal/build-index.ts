import path from "node:path";
import {
  definitionMatchesUsage,
  logicalKey,
  matchContextFromOptions,
  resolveUsageNamespaces,
  type MatchContext,
  type UsageFact,
} from "@i18n-doctor/issues";
import type {
  SourceFormat,
  TranslationCatalog,
  TranslationKeyDefinition,
  TranslationSource,
  TranslationValue,
} from "@i18n-doctor/sources";
import type {
  CompletionItemModel,
  DefinitionHit,
  HoverModel,
  LocaleValue,
  TranslationIndex,
  TranslationIndexEntry,
  TranslationIndexOptions,
  UsageQuery,
} from "../api/types.js";

function toPosix(filePath: string): string {
  return filePath.split(path.sep).join("/");
}

function resolveAbsolute(root: string, filePath: string): string {
  return path.isAbsolute(filePath) ? filePath : path.resolve(root, filePath);
}

function buildFullKey(
  locale: string | null | undefined,
  namespace: string | null | undefined,
  key: string,
): string {
  return `${locale ?? "*"}::${namespace ?? "*"}::${key}`;
}

function sourceFormatOf(
  sourcesById: Map<string, TranslationSource>,
  key: TranslationKeyDefinition,
): SourceFormat {
  const source = sourcesById.get(key.sourceId);
  return source?.format ?? guessFormat(key.filePath);
}

function guessFormat(filePath: string): SourceFormat {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".json") || lower.endsWith(".jsonc")) return "json";
  if (lower.endsWith(".yaml") || lower.endsWith(".yml")) return "yaml";
  if (lower.endsWith(".ts") || lower.endsWith(".tsx")) return "typescript";
  return "javascript";
}

function toUsageFact(usage: UsageQuery): UsageFact {
  return {
    key: usage.key,
    absolutePath: "",
    relativePath: "",
    line: 1,
    column: 1,
    ...(usage.namespace !== undefined ? { namespace: usage.namespace } : {}),
    ...(usage.namespaces !== undefined ? { namespaces: usage.namespaces } : {}),
    ...(usage.namespaceResolved !== undefined
      ? { namespaceResolved: usage.namespaceResolved }
      : {}),
  };
}

function localeRank(
  locale: string | null,
  preferred: readonly string[],
): number {
  if (!locale) return preferred.length + 1;
  const idx = preferred.indexOf(locale);
  return idx === -1 ? preferred.length : idx;
}

function formatValue(value: TranslationValue): string {
  if (value === null) return "null";
  return String(value);
}

function entryMatchesUsage(
  entry: TranslationIndexEntry,
  usage: UsageQuery,
  ctx: MatchContext,
): boolean {
  return definitionMatchesUsage(
    {
      key: entry.key,
      absolutePath: entry.sourceFile,
      relativePath: entry.relativePath,
      line: entry.range.startLine,
      column: entry.range.startCharacter,
      ...(entry.locale ? { locale: entry.locale } : {}),
      ...(entry.namespace ? { namespace: entry.namespace } : {}),
    },
    toUsageFact(usage),
    ctx,
  );
}

/**
 * Builds an immutable translation index from an existing TranslationCatalog.
 * Does not re-parse locale files.
 */
export function buildTranslationIndex(
  catalog: TranslationCatalog,
  options: TranslationIndexOptions = {},
): TranslationIndex {
  const matchContext: MatchContext =
    options.matchContext ?? matchContextFromOptions({});
  const preferredLocales = options.preferredLocales ?? [];

  const sourcesById = new Map(catalog.sources.map((s) => [s.id, s]));
  const entries: TranslationIndexEntry[] = catalog.keys.map((key) => {
    const namespace = key.namespace ?? null;
    const locale = key.locale ?? null;
    const relativePath = toPosix(key.filePath);
    return {
      key: key.key,
      namespace,
      locale,
      value: key.value,
      sourceFile: resolveAbsolute(catalog.root, key.filePath),
      relativePath,
      range: key.location,
      sourceType: sourceFormatOf(sourcesById, key),
      catalogId: key.sourceId,
      fullKey: key.fullKey ?? buildFullKey(locale, namespace, key.key),
    };
  });

  // logicalKey → entries (all locales)
  const byLogical = new Map<string, TranslationIndexEntry[]>();
  // key alone → entries (for unnamespaced / prefix completion)
  const byKey = new Map<string, TranslationIndexEntry[]>();

  for (const entry of entries) {
    const lk = logicalKey(
      entry.key,
      entry.namespace ?? undefined,
      matchContext.matchNamespace,
    );
    const list = byLogical.get(lk);
    if (list) list.push(entry);
    else byLogical.set(lk, [entry]);

    const keyList = byKey.get(entry.key);
    if (keyList) keyList.push(entry);
    else byKey.set(entry.key, [entry]);
  }

  const sortEntries = (
    list: readonly TranslationIndexEntry[],
    preferred: readonly string[],
  ): TranslationIndexEntry[] =>
    [...list].sort(
      (a, b) =>
        localeRank(a.locale, preferred) - localeRank(b.locale, preferred) ||
        a.relativePath.localeCompare(b.relativePath) ||
        a.range.startLine - b.range.startLine,
    );

  const lookup = (input: {
    readonly key: string;
    readonly namespace?: string | null;
    readonly locale?: string | null;
  }): readonly TranslationIndexEntry[] => {
    const lk = logicalKey(
      input.key,
      input.namespace ?? undefined,
      matchContext.matchNamespace,
    );
    let found = byLogical.get(lk) ?? [];
    // Also try key-only when namespace matching would miss legacy catalogs.
    if (found.length === 0 && input.namespace) {
      found = byKey.get(input.key)?.filter((e) => !e.namespace) ?? [];
    }
    if (input.locale) {
      found = found.filter((e) => e.locale === input.locale);
    }
    return sortEntries(found, preferredLocales);
  };

  const hasKey = (usage: UsageQuery): boolean => {
    for (const entry of entries) {
      if (entryMatchesUsage(entry, usage, matchContext)) return true;
    }
    return false;
  };

  const definitionsForUsage = (
    usage: UsageQuery,
    defOptions?: { readonly preferredLocales?: readonly string[] },
  ): readonly DefinitionHit[] => {
    const preferred = defOptions?.preferredLocales ?? preferredLocales;
    const matched = entries.filter((e) =>
      entryMatchesUsage(e, usage, matchContext),
    );
    if (matched.length === 0) return [];
    const sorted = sortEntries(matched, preferred);
    return sorted.map((entry) => ({
      entry,
      uriPath: entry.sourceFile,
      range: entry.range,
    }));
  };

  const hoverForUsage = (usage: UsageQuery): HoverModel => {
    const matched = sortEntries(
      entries.filter((e) => entryMatchesUsage(e, usage, matchContext)),
      preferredLocales,
    );
    if (matched.length === 0) {
      const namespaces = resolveUsageNamespaces(
        toUsageFact(usage),
        matchContext,
      );
      return {
        key: usage.key,
        namespace: namespaces[0] ?? usage.namespace ?? null,
        missing: true,
        locales: [],
      };
    }

    const seenLocales = new Set<string>();
    const locales: LocaleValue[] = [];
    for (const entry of matched) {
      const locale = entry.locale ?? "*";
      if (seenLocales.has(locale)) continue;
      seenLocales.add(locale);
      locales.push({
        locale,
        value: entry.value,
        relativePath: entry.relativePath,
        line: entry.range.startLine,
      });
    }

    const primary = matched[0]!;
    const namespaces = resolveUsageNamespaces(
      toUsageFact(usage),
      matchContext,
    );

    return {
      key: usage.key,
      namespace:
        primary.namespace ??
        namespaces[0] ??
        usage.namespace ??
        null,
      missing: false,
      locales,
      source: {
        relativePath: primary.relativePath,
        line: primary.range.startLine,
      },
    };
  };

  const completionsForPrefix = (
    prefix: string,
    completionOptions?: {
      readonly namespace?: string | null;
      readonly namespaces?: readonly string[];
      readonly limit?: number;
    },
  ): readonly CompletionItemModel[] => {
    const limit = completionOptions?.limit ?? 200;
    const nsFilter: string[] = [];
    if (completionOptions?.namespace) nsFilter.push(completionOptions.namespace);
    if (completionOptions?.namespaces) {
      for (const ns of completionOptions.namespaces) {
        if (!nsFilter.includes(ns)) nsFilter.push(ns);
      }
    }
    if (nsFilter.length === 0 && matchContext.defaultNS) {
      nsFilter.push(matchContext.defaultNS);
    }

    const seen = new Set<string>();
    const out: CompletionItemModel[] = [];

    for (const entry of entries) {
      if (nsFilter.length > 0 && matchContext.matchNamespace) {
        // Known namespace: only that namespace, or legacy unnamespaced defs.
        if (entry.namespace && !nsFilter.includes(entry.namespace)) {
          continue;
        }
      }

      if (!entry.key.startsWith(prefix)) continue;

      const dedupeId = matchContext.matchNamespace
        ? `${entry.namespace ?? ""}\u0000${entry.key}`
        : entry.key;
      if (seen.has(dedupeId)) continue;
      seen.add(dedupeId);

      // Prefer preferred-locale value for detail.
      const sameKey = sortEntries(
        (byLogical.get(
          logicalKey(
            entry.key,
            entry.namespace ?? undefined,
            matchContext.matchNamespace,
          ),
        ) ?? [entry]).filter(
          (e) =>
            e.key === entry.key &&
            (e.namespace ?? null) === (entry.namespace ?? null),
        ),
        preferredLocales,
      );
      const sample = sameKey[0] ?? entry;
      const detail = formatValue(sample.value);

      out.push({
        key: entry.key,
        namespace: entry.namespace,
        label: entry.key,
        detail,
        documentation: detail,
      });

      if (out.length >= limit) break;
    }

    out.sort((a, b) => a.label.localeCompare(b.label));
    return out;
  };

  return {
    size: entries.length,
    entries,
    matchContext,
    preferredLocales,
    lookup,
    hasKey,
    definitionsForUsage,
    hoverForUsage,
    completionsForPrefix,
  };
}
