/**
 * @i18n-doctor/usages
 *
 * Translation key usage detection with full source locations.
 * File-local binding aliases only — no cross-file resolution,
 * import graphs, constant folding, or data-flow analysis.
 */

export type {
  Confidence,
  FileBindingTable,
  LibraryDetectInput,
  LibraryUsageDetector,
  TFunctionBinding,
  TemplateFrameworkId,
  TranslationUsage,
  UsageCatalog,
  UsageContext,
  UsageDetector,
  UsageDetectorOptions,
  UsageLibraryId,
  UsageLocation,
  UsageWarning,
} from "./api/types.js";

export type { UsageDetectorFactory } from "./api/detector.js";

export {
  createUsageDetector,
  usageDetectorFactory,
} from "./internal/create-detector.js";

export {
  formatUsageReport,
  formatUsageLine,
  usageToDiagnostic,
} from "./internal/format-report.js";
