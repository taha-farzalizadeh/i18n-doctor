/**
 * @i18n-unused/sources
 *
 * Translation source detection: finds where keys are defined.
 * Does not detect usages, t() calls, or resolve symbols across files.
 */

export type {
  CatalogWarning,
  Confidence,
  SourceDetectorOptions,
  SourceFormat,
  SourceKind,
  SourceLocation,
  TranslationCatalog,
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
