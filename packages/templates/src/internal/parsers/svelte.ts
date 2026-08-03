import type {
  TemplateAnalysisInput,
  TemplateAnalysisResult,
  TemplateLibraryId,
  TemplateParser,
  TemplateUsage,
} from "../../api/types.js";
import { buildLineIndex } from "../location.js";
import { scanCallPatterns, type CallPattern } from "../scan-calls.js";
import {
  blankTagBodies,
  stripHtmlComments,
  stripJsCommentsInTagBodies,
} from "../strip.js";

const DETECTOR = "svelte-template-analyzer";

const SVELTE_PATTERNS: readonly CallPattern[] = [
  {
    callee: /\$t\b/g,
    evidence: "svelte-template-analyzer: $t(...)",
    confidence: 0.85,
  },
  {
    callee: /(?<![\w$.])\bt\b/g,
    evidence: "svelte-template-analyzer: t(...)",
    confidence: 0.75,
  },
  // svelte-i18n store: $_('key')
  {
    callee: /\$_\b/g,
    evidence: "svelte-template-analyzer: $_(...)",
    confidence: 0.86,
  },
  {
    callee: /\$format\b/g,
    evidence: "svelte-template-analyzer: $format(...)",
    confidence: 0.8,
  },
];

/**
 * Svelte template analyzer for `.svelte` files.
 * Scans markup + script for `$t`, `$_`, `$format`, and bare `t()`.
 */
export function createSvelteTemplateParser(): TemplateParser {
  return {
    id: DETECTOR,
    framework: "svelte",
    extensions: ["svelte"],
    analyze(input: TemplateAnalysisInput): TemplateAnalysisResult {
      try {
        return { usages: scanSvelte(input), warnings: [] };
      } catch (error) {
        return {
          usages: [],
          warnings: [
            {
              code: "template-parse-failed",
              message: `Svelte template analysis failed for ${input.relativePath}: ${error instanceof Error ? error.message : String(error)}`,
              path: input.relativePath,
            },
          ],
        };
      }
    },
  };
}

function scanSvelte(input: TemplateAnalysisInput): TemplateUsage[] {
  // Blank styles; strip HTML comments globally; JS comments only inside <script>.
  let text = blankTagBodies(input.sourceText, "style");
  text = stripHtmlComments(text);
  text = stripJsCommentsInTagBodies(text, "script");

  const library: TemplateLibraryId = "unknown";

  return scanCallPatterns({
    text,
    sliceOffset: 0,
    sourceText: input.sourceText,
    absolutePath: input.absolutePath,
    relativePath: input.relativePath,
    framework: "svelte",
    detector: DETECTOR,
    defaultLibrary: library,
    patterns: SVELTE_PATTERNS,
    lineIndex: buildLineIndex(input.sourceText),
  });
}
