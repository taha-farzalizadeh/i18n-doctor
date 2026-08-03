import type {
  UsageCatalog,
  UsageDetector,
  UsageDetectorOptions,
  LibraryUsageDetector,
} from "./types.js";

export interface UsageDetectorFactory {
  createUsageDetector(defaults?: UsageDetectorOptions): UsageDetector;
}

export type {
  UsageCatalog,
  UsageDetector,
  UsageDetectorOptions,
  LibraryUsageDetector,
};
