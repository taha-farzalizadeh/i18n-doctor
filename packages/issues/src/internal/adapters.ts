import type {
  TranslationCatalog,
  TranslationKeyDefinition,
} from "@i18n-unused/sources";
import type { TranslationUsage, UsageCatalog } from "@i18n-unused/usages";
import type { DefinitionFact, UsageFact } from "../api/types.js";
import { resolveAbsolute, toPosixPath } from "./location.js";

/** Adapt TranslationCatalog keys → DefinitionFact[] (no AST). */
export function definitionsFromCatalog(
  catalog: TranslationCatalog,
): DefinitionFact[] {
  return catalog.keys.map((key) => definitionFromKey(catalog.root, key));
}

export function definitionFromKey(
  root: string,
  key: TranslationKeyDefinition,
): DefinitionFact {
  return {
    key: key.key,
    absolutePath: resolveAbsolute(root, key.filePath),
    relativePath: toPosixPath(key.filePath),
    line: key.location.startLine,
    column: key.location.startCharacter,
    endLine: key.location.endLine,
    endColumn: key.location.endCharacter,
    ...(key.location.start !== undefined ? { start: key.location.start } : {}),
    ...(key.location.end !== undefined ? { end: key.location.end } : {}),
    ...(key.locale !== undefined ? { locale: key.locale } : {}),
    ...(key.namespace !== undefined ? { namespace: key.namespace } : {}),
    confidence: key.confidence,
  };
}

/** Adapt UsageCatalog → UsageFact[] (no AST). */
export function usagesFromCatalog(catalog: UsageCatalog): UsageFact[] {
  return catalog.usages.map(usageFromTranslationUsage);
}

export function usageFromTranslationUsage(usage: TranslationUsage): UsageFact {
  return {
    key: usage.key,
    absolutePath: usage.absolutePath,
    relativePath: toPosixPath(usage.relativePath),
    line: usage.location.line,
    column: usage.location.column,
    endLine: usage.location.endLine,
    endColumn: usage.location.endColumn,
    start: usage.location.start,
    end: usage.location.end,
    ...(usage.namespace !== undefined ? { namespace: usage.namespace } : {}),
    library: usage.library,
    confidence: usage.confidence,
  };
}
