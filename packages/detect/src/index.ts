/**
 * @i18n-doctor/detect
 *
 * Framework, package manager, language, and localization library detection.
 * Does not detect translation keys, analyze usages, build symbol tables,
 * or resolve imports.
 */

export type {
  Confidence,
  DetectedFramework,
  DetectedI18nLibrary,
  DetectedItem,
  DetectedLanguage,
  DetectedPackageManager,
  DetectionEvidence,
  DetectionWarning,
  DetectorOptions,
  EvidenceKind,
  FrameworkId,
  I18nLibraryId,
  LanguageId,
  NextRouterKind,
  PackageManagerId,
  ProjectDetectionResult,
  ProjectDetector,
  UnknownConfiguration,
} from "./api/types.js";

export type { ProjectDetectorFactory } from "./api/detector.js";

export {
  createDetector,
  projectDetectorFactory,
} from "./internal/create-detector.js";

export { formatDetectionReport } from "./internal/format-report.js";
