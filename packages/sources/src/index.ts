/**
 * @i18n-unused/sources
 *
 * Translation source detection: finds where keys are defined.
 * Namespace-aware for i18next registrations (addResourceBundle, etc.).
 * Does not detect usages or t() calls.
 */

export type {
  CatalogWarning,
  Confidence,
  SourceDetectorOptions,
  SourceFormat,
  SourceKind,
  SourceLocation,
  TranslationCatalog,
  TranslationEntry,
  TranslationKeyDefinition,
  TranslationSource,
  TranslationSourceDetector,
  TranslationValue,
} from "./api/types.js";

export type { TranslationSourceDetectorFactory } from "./api/detector.js";

export {
  createSourceDetector,
  translationSourceDetectorFactory,
} from "./internal/create-detector.js";

export { formatCatalogReport } from "./internal/format-report.js";

export {
  buildFullKey,
  entriesFromCatalog,
  toTranslationEntry,
} from "./internal/translation-entry.js";
