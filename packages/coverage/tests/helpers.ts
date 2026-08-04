import type {
  SourceLocation,
  TranslationCatalog,
  TranslationKeyDefinition,
  TranslationSource,
} from "@i18n-unused/sources";

export function loc(
  line = 1,
  col = 1,
): SourceLocation {
  return {
    startLine: line,
    startCharacter: col,
    endLine: line,
    endCharacter: col + 3,
  };
}

export function keyDef(
  key: string,
  filePath: string,
  locale: string,
  opts: {
    namespace?: string;
    line?: number;
    value?: string;
    confidence?: number;
  } = {},
): TranslationKeyDefinition {
  return {
    key,
    value: opts.value ?? key,
    filePath,
    location: loc(opts.line ?? 1, 1),
    locale,
    ...(opts.namespace !== undefined ? { namespace: opts.namespace } : {}),
    confidence: opts.confidence ?? 1,
    sourceId: `${locale}:${filePath}`,
  };
}

export function catalog(
  root: string,
  keys: TranslationKeyDefinition[],
): TranslationCatalog {
  const locales = [
    ...new Set(keys.map((k) => k.locale).filter(Boolean) as string[]),
  ].sort();
  const namespaces = [
    ...new Set(keys.map((k) => k.namespace).filter(Boolean) as string[]),
  ].sort();

  const sources: TranslationSource[] = [
    {
      id: "synthetic",
      filePath: "synthetic.json",
      format: "json",
      kind: "resource-file",
      confidence: 1,
      keys,
      evidence: ["test"],
    },
  ];

  return {
    root,
    sources,
    keys,
    locales,
    namespaces,
    warnings: [],
    stats: {
      sourceCount: 1,
      keyCount: keys.length,
      candidateCount: 1,
      byFormat: { json: 1, yaml: 0, javascript: 0, typescript: 0 },
      byKind: { "resource-file": 1 },
    },
    timings: { totalMs: 0, scanMs: 0, detectMs: 0, extractMs: 0 },
  };
}
