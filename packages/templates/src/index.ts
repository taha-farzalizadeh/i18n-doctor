/**
 * @i18n-unused/templates
 *
 * Framework-specific template analyzers for static translation usage detection.
 * Returns TemplateUsage values structurally compatible with TranslationUsage.
 * Never executes templates or renders in a browser.
 */

export type {
  Confidence,
  TemplateAnalysisInput,
  TemplateAnalysisResult,
  TemplateAnalyzer,
  TemplateAnalyzerOptions,
  TemplateFrameworkId,
  TemplateLibraryId,
  TemplateLocation,
  TemplateParser,
  TemplateUsage,
  TemplateUsageContext,
  TemplateWarning,
} from "./api/types.js";

export {
  createTemplateAnalyzer,
  createDefaultParsers,
} from "./internal/create-analyzer.js";

export { createVueTemplateParser } from "./internal/parsers/vue.js";
export { createNuxtTemplateParser } from "./internal/parsers/nuxt.js";
export { createAngularTemplateParser } from "./internal/parsers/angular.js";
export { createSvelteTemplateParser } from "./internal/parsers/svelte.js";
export { createAstroTemplateParser } from "./internal/parsers/astro.js";

export {
  extractVueTemplate,
  extractVueScripts,
  type VueScriptSlice,
} from "./internal/vue-extract.js";

export { hasNuxtHint } from "./internal/scan-calls.js";
export { parseStringLiteralAt } from "./internal/string-literal.js";
