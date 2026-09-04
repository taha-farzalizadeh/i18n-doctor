import type {
  SourceLocation,
  TranslationCatalog,
  TranslationKeyDefinition,
  TranslationSource,
} from "@i18n-doctor/sources";
import { buildTranslationIndex, matchContextFromOptions } from "../src/index.js";

export function loc(
  line = 1,
  col = 1,
  endCol = col + 5,
): SourceLocation {
  return {
    startLine: line,
    startCharacter: col,
    endLine: line,
    endCharacter: endCol,
  };
}

export function keyDef(
  key: string,
  filePath: string,
  locale: string,
  opts: {
    namespace?: string;
    line?: number;
    col?: number;
    endCol?: number;
    value?: string;
    sourceId?: string;
  } = {},
): TranslationKeyDefinition {
  const namespace = opts.namespace;
  const location = loc(opts.line ?? 1, opts.col ?? 1, opts.endCol ?? 8);
  return {
    key,
    value: opts.value ?? key,
    filePath,
    location,
    locale,
    ...(namespace !== undefined ? { namespace } : {}),
    fullKey: `${locale}::${namespace ?? "*"}::${key}`,
    confidence: 1,
    sourceId: opts.sourceId ?? `${locale}:${filePath}`,
  };
}

export function catalog(
  root: string,
  keys: TranslationKeyDefinition[],
  formats: Partial<Record<string, TranslationSource["format"]>> = {},
): TranslationCatalog {
  const locales = [
    ...new Set(keys.map((k) => k.locale).filter(Boolean) as string[]),
  ].sort();
  const namespaces = [
    ...new Set(keys.map((k) => k.namespace).filter(Boolean) as string[]),
  ].sort();

  const bySource = new Map<string, TranslationKeyDefinition[]>();
  for (const key of keys) {
    const list = bySource.get(key.sourceId) ?? [];
    list.push(key);
    bySource.set(key.sourceId, list);
  }

  const sources: TranslationSource[] = [...bySource.entries()].map(
    ([id, sourceKeys]) => {
      const first = sourceKeys[0]!;
      return {
        id,
        filePath: first.filePath,
        format: formats[id] ?? "json",
        kind: "resource-file",
        confidence: 1,
        keys: sourceKeys,
        evidence: ["test"],
        ...(first.locale ? { locale: first.locale } : {}),
        ...(first.namespace ? { namespace: first.namespace } : {}),
      };
    },
  );

  return {
    root,
    sources,
    keys,
    locales,
    namespaces,
    warnings: [],
    stats: {
      sourceCount: sources.length,
      keyCount: keys.length,
      candidateCount: sources.length,
      byFormat: { json: sources.length, yaml: 0, javascript: 0, typescript: 0 },
      byKind: { "resource-file": sources.length },
    },
    timings: { totalMs: 0, scanMs: 0, detectMs: 0, extractMs: 0 },
  };
}

export const defaultMatch = matchContextFromOptions({
  matchNamespace: true,
  defaultNS: "translation",
});
