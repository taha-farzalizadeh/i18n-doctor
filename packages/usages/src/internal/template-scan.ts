import {
  createTemplateAnalyzer,
  extractVueScripts as extractVueScriptsFromTemplates,
  type TemplateUsage,
  type VueScriptSlice,
} from "@i18n-doctor/templates";
import type {
  TemplateFrameworkId,
  TranslationUsage,
  UsageLibraryId,
  UsageWarning,
} from "../api/types.js";
import { buildUsage } from "./usage-builder.js";

const analyzer = createTemplateAnalyzer();

/** Re-export SFC script extraction (used for script-side detectors). */
export function extractVueScripts(sourceText: string): VueScriptSlice[] {
  return extractVueScriptsFromTemplates(sourceText);
}

export type { VueScriptSlice };

/** Map a TemplateUsage into the shared TranslationUsage model. */
export function toTranslationUsage(hit: TemplateUsage): TranslationUsage {
  return buildUsage({
    key: hit.key,
    absolutePath: hit.absolutePath,
    relativePath: hit.relativePath,
    location: hit.location,
    library: hit.library as UsageLibraryId,
    ...(hit.namespace !== undefined ? { namespace: hit.namespace } : {}),
    confidence: hit.confidence,
    context: hit.context,
    ...(hit.evidence !== undefined ? { evidence: hit.evidence } : {}),
    framework: hit.framework as TemplateFrameworkId,
    detector: hit.detector,
  });
}

/**
 * Run framework template analyzers for a single file.
 * Syntax problems become warnings — never throws.
 */
export function analyzeTemplates(input: {
  absolutePath: string;
  relativePath: string;
  sourceText: string;
  libraryHints?: ReadonlySet<string>;
  warnings?: UsageWarning[];
}): TranslationUsage[] {
  const result = analyzer.analyzeFile({
    absolutePath: input.absolutePath,
    relativePath: input.relativePath,
    sourceText: input.sourceText,
    ...(input.libraryHints !== undefined
      ? { libraryHints: input.libraryHints }
      : {}),
  });
  if (input.warnings) {
    for (const w of result.warnings) {
      input.warnings.push({
        code: w.code,
        message: w.message,
        ...(w.path !== undefined ? { path: w.path } : {}),
      });
    }
  }
  return result.usages.map(toTranslationUsage);
}

/** @deprecated Prefer analyzeTemplates — kept for focused Vue callers/tests. */
export function scanVueTemplateUsages(input: {
  absolutePath: string;
  relativePath: string;
  sourceText: string;
  libraryHints?: ReadonlySet<string>;
}): TranslationUsage[] {
  return analyzeTemplates({
    ...input,
    libraryHints: input.libraryHints ?? new Set(["vue-i18n"]),
  }).filter((u) => u.framework === "vue" || u.framework === "nuxt");
}

/** @deprecated Prefer analyzeTemplates — kept for focused Angular callers/tests. */
export function scanAngularTemplateUsages(input: {
  absolutePath: string;
  relativePath: string;
  sourceText: string;
  library?: UsageLibraryId;
  libraryHints?: ReadonlySet<string>;
}): TranslationUsage[] {
  const hints = new Set(input.libraryHints ?? []);
  if (input.library === "transloco") {
    hints.add("transloco");
  } else if (input.library === "ngx-translate") {
    hints.add("ngx-translate");
  }
  return analyzeTemplates({
    absolutePath: input.absolutePath,
    relativePath: input.relativePath,
    sourceText: input.sourceText,
    libraryHints: hints,
  }).filter((u) => u.framework === "angular");
}

export function templateSupportedExtension(extension: string): boolean {
  return analyzer.supportsExtension(extension);
}
