import type {
  TranslationCatalog,
  TranslationKeyDefinition,
} from "@i18n-doctor/sources";
import type {
  DynamicTranslationUsage,
  TranslationUsage,
  UntranslatedLiteral,
  UsageCatalog,
} from "@i18n-doctor/usages";
import type {
  DefinitionFact,
  DynamicUsageFact,
  UntranslatedLiteralFact,
  UsageFact,
} from "../api/types.js";
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
    ...(usage.namespaces !== undefined ? { namespaces: usage.namespaces } : {}),
    ...(usage.namespaceResolved !== undefined
      ? { namespaceResolved: usage.namespaceResolved }
      : {}),
    library: usage.library,
    confidence: usage.confidence,
  };
}

/** Adapt UsageCatalog dynamic sites → DynamicUsageFact[]. */
export function dynamicUsagesFromCatalog(
  catalog: UsageCatalog,
): DynamicUsageFact[] {
  return (catalog.dynamicUsages ?? []).map(dynamicUsageFromTranslation);
}

export function dynamicUsageFromTranslation(
  usage: DynamicTranslationUsage,
): DynamicUsageFact {
  return {
    absolutePath: usage.absolutePath,
    relativePath: toPosixPath(usage.relativePath),
    line: usage.location.line,
    column: usage.location.column,
    endLine: usage.location.endLine,
    endColumn: usage.location.endColumn,
    start: usage.location.start,
    end: usage.location.end,
    ...(usage.namespace !== undefined ? { namespace: usage.namespace } : {}),
    ...(usage.namespaces !== undefined ? { namespaces: usage.namespaces } : {}),
    ...(usage.library !== undefined ? { library: usage.library } : {}),
    confidence: usage.confidence,
    prefixes: usage.prefixes,
    suffixes: usage.suffixes,
    contains: usage.contains,
  };
}

export function untranslatedLiteralsFromCatalog(
  catalog: UsageCatalog,
): UntranslatedLiteralFact[] {
  return (catalog.untranslatedLiterals ?? []).map(untranslatedFromLiteral);
}

export function untranslatedFromLiteral(
  literal: UntranslatedLiteral,
): UntranslatedLiteralFact {
  return {
    text: literal.text,
    absolutePath: literal.absolutePath,
    relativePath: toPosixPath(literal.relativePath),
    line: literal.location.line,
    column: literal.location.column,
    endLine: literal.location.endLine,
    endColumn: literal.location.endColumn,
    start: literal.location.start,
    end: literal.location.end,
    confidence: literal.confidence,
    library: literal.library,
    context: literal.context,
    ...(literal.attribute !== undefined
      ? { attribute: literal.attribute }
      : {}),
  };
}
