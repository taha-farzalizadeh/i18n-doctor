/**
 * @i18n-doctor/translation-index
 *
 * Derived, cached lookup over TranslationCatalog for Go-to Definition,
 * Hover, and Completion. Does not re-parse locale files.
 */

export type {
  CompletionItemModel,
  DefinitionHit,
  HoverModel,
  LocaleValue,
  TranslationIndex,
  TranslationIndexEntry,
  TranslationIndexOptions,
  UsageQuery,
} from "./api/types.js";

export { buildTranslationIndex } from "./internal/build-index.js";

export {
  definitionMatchesUsage,
  logicalKey,
  matchContextFromOptions,
  resolveUsageNamespaces,
  type MatchContext,
} from "@i18n-doctor/issues";
