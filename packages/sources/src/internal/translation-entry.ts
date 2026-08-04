import type {
  TranslationCatalog,
  TranslationEntry,
  TranslationKeyDefinition,
} from "../api/types.js";

/** Build the stable identity used across unused / missing / duplicate / coverage. */
export function buildFullKey(
  locale: string | null | undefined,
  namespace: string | null | undefined,
  keyPath: string,
): string {
  return `${locale ?? "*"}::${namespace ?? "*"}::${keyPath}`;
}

/** Adapt a catalog key definition into the namespace-aware TranslationEntry model. */
export function toTranslationEntry(
  key: TranslationKeyDefinition,
): TranslationEntry {
  const locale = key.locale ?? null;
  const namespace = key.namespace ?? null;
  return {
    locale,
    namespace,
    keyPath: key.key,
    fullKey: key.fullKey ?? buildFullKey(locale, namespace, key.key),
    sourceFile: key.filePath,
    location: key.location,
    value: key.value,
    confidence: key.confidence,
    sourceId: key.sourceId,
  };
}

export function entriesFromCatalog(
  catalog: TranslationCatalog,
): TranslationEntry[] {
  return catalog.keys.map(toTranslationEntry);
}
