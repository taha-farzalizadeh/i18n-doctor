import type {
  SourceDetectorOptions,
  TranslationCatalog,
  TranslationSourceDetector,
} from "./types.js";

export interface TranslationSourceDetectorFactory {
  createSourceDetector(
    defaults?: SourceDetectorOptions,
  ): TranslationSourceDetector;
}

export type {
  SourceDetectorOptions,
  TranslationCatalog,
  TranslationSourceDetector,
};
