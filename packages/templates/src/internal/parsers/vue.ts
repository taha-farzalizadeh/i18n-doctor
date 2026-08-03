import type {
  TemplateAnalysisInput,
  TemplateAnalysisResult,
  TemplateFrameworkId,
  TemplateParser,
  TemplateUsage,
} from "../../api/types.js";
import { buildLineIndex } from "../location.js";
import { hasNuxtHint, scanCallPatterns, type CallPattern } from "../scan-calls.js";
import { scanAttrPatterns, type AttrPattern } from "../scan-attrs.js";
import { stripMarkupNoise } from "../strip.js";
import { extractVueTemplate } from "../vue-extract.js";

const DETECTOR = "vue-template-analyzer";

export const VUE_CALL_PATTERNS: readonly CallPattern[] = [
  {
    callee: /\$t\b/g,
    evidence: "vue-template-analyzer: $t(...)",
    confidence: 0.85,
  },
  {
    callee: /\$tc\b/g,
    evidence: "vue-template-analyzer: $tc(...)",
    confidence: 0.8,
  },
  {
    callee: /\$te\b/g,
    evidence: "vue-template-analyzer: $te(...)",
    confidence: 0.75,
  },
  {
    callee: /\bi18n\.t\b/g,
    evidence: "vue-template-analyzer: i18n.t(...)",
    confidence: 0.85,
  },
  // Composition API / script-setup bindings used in templates: t('key')
  {
    callee: /(?<![\w$.])\bt\b/g,
    evidence: "vue-template-analyzer: t(...)",
    confidence: 0.78,
  },
];

const VUE_ATTR_PATTERNS: readonly AttrPattern[] = [
  {
    re: /\bv-t\s*=\s*/g,
    valueKind: "auto",
    evidence: "vue-template-analyzer: v-t",
    confidence: 0.84,
  },
  {
    // Avoid matching `:keypath` via the bare `keypath` pattern.
    re: /(?<!:)\bkeypath\s*=\s*/g,
    valueKind: "raw",
    evidence: "vue-template-analyzer: keypath",
    confidence: 0.8,
  },
  {
    re: /:keypath\s*=\s*/g,
    valueKind: "auto",
    evidence: "vue-template-analyzer: :keypath",
    confidence: 0.82,
  },
];

export function createVueTemplateParser(options?: {
  framework?: TemplateFrameworkId;
  detector?: string;
  /** When true, only accept files with Nuxt i18n hints. */
  requireNuxt?: boolean;
  /** When true, reject files with Nuxt i18n hints (defer to Nuxt parser). */
  rejectNuxt?: boolean;
  /** Extra call patterns (Nuxt helpers). */
  extraCallPatterns?: readonly CallPattern[];
}): TemplateParser {
  const framework = options?.framework ?? "vue";
  const detector = options?.detector ?? DETECTOR;
  const requireNuxt = options?.requireNuxt ?? false;
  const rejectNuxt = options?.rejectNuxt ?? false;
  const extraCallPatterns = options?.extraCallPatterns ?? [];

  return {
    id: detector,
    framework,
    extensions: ["vue"],
    analyze(input: TemplateAnalysisInput): TemplateAnalysisResult {
      try {
        if (requireNuxt && !hasNuxtHint(input.libraryHints)) {
          return { usages: [], warnings: [] };
        }
        if (rejectNuxt && hasNuxtHint(input.libraryHints)) {
          return { usages: [], warnings: [] };
        }
        return {
          usages: scanVueTemplateRegion(input, {
            framework,
            detector,
            extraCallPatterns,
          }),
          warnings: [],
        };
      } catch (error) {
        return {
          usages: [],
          warnings: [
            {
              code: "template-parse-failed",
              message: `Vue template analysis failed for ${input.relativePath}: ${error instanceof Error ? error.message : String(error)}`,
              path: input.relativePath,
            },
          ],
        };
      }
    },
  };
}

/** Shared Vue/Nuxt template region scan (single extract + strip pass). */
export function scanVueTemplateRegion(
  input: TemplateAnalysisInput,
  options: {
    framework: TemplateFrameworkId;
    detector: string;
    extraCallPatterns?: readonly CallPattern[];
  },
): TemplateUsage[] {
  const tpl = extractVueTemplate(input.sourceText);
  if (!tpl) {
    return [];
  }
  const text = stripMarkupNoise(tpl.text);
  const lineIndex = buildLineIndex(input.sourceText);
  const callUsages = scanCallPatterns({
    text,
    sliceOffset: tpl.offset,
    sourceText: input.sourceText,
    absolutePath: input.absolutePath,
    relativePath: input.relativePath,
    framework: options.framework,
    detector: options.detector,
    defaultLibrary: "vue-i18n",
    patterns: [...VUE_CALL_PATTERNS, ...(options.extraCallPatterns ?? [])],
    lineIndex,
  });
  const attrUsages = scanAttrPatterns({
    text,
    sliceOffset: tpl.offset,
    sourceText: input.sourceText,
    absolutePath: input.absolutePath,
    relativePath: input.relativePath,
    framework: options.framework,
    detector: options.detector,
    defaultLibrary: "vue-i18n",
    patterns: VUE_ATTR_PATTERNS,
    lineIndex,
  });
  return [...callUsages, ...attrUsages];
}
