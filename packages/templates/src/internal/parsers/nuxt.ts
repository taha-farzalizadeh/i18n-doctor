import type {
  TemplateAnalysisInput,
  TemplateAnalysisResult,
  TemplateParser,
} from "../../api/types.js";
import { hasNuxtHint, type CallPattern } from "../scan-calls.js";
import { scanVueTemplateRegion } from "./vue.js";

const DETECTOR = "nuxt-template-analyzer";

const NUXT_EXTRA_CALL_PATTERNS: readonly CallPattern[] = [
  {
    callee: /\$tm\b/g,
    evidence: "nuxt-template-analyzer: $tm(...)",
    confidence: 0.8,
  },
  {
    callee: /\$td\b/g,
    evidence: "nuxt-template-analyzer: $td(...)",
    confidence: 0.75,
  },
  {
    callee: /\$rt\b/g,
    evidence: "nuxt-template-analyzer: $rt(...)",
    confidence: 0.75,
  },
];

/**
 * Nuxt i18n template analyzer.
 * Activates only when Nuxt i18n library hints are present.
 * Reuses the Vue template scanner (single extract/strip) + Nuxt helpers.
 */
export function createNuxtTemplateParser(): TemplateParser {
  return {
    id: DETECTOR,
    framework: "nuxt",
    extensions: ["vue"],
    analyze(input: TemplateAnalysisInput): TemplateAnalysisResult {
      try {
        if (!hasNuxtHint(input.libraryHints)) {
          return { usages: [], warnings: [] };
        }
        return {
          usages: scanVueTemplateRegion(input, {
            framework: "nuxt",
            detector: DETECTOR,
            extraCallPatterns: NUXT_EXTRA_CALL_PATTERNS,
          }),
          warnings: [],
        };
      } catch (error) {
        return {
          usages: [],
          warnings: [
            {
              code: "template-parse-failed",
              message: `Nuxt template analysis failed for ${input.relativePath}: ${error instanceof Error ? error.message : String(error)}`,
              path: input.relativePath,
            },
          ],
        };
      }
    },
  };
}
