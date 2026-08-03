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
  stripJsComments,
} from "../strip.js";

const DETECTOR = "astro-template-analyzer";

const ASTRO_PATTERNS: readonly CallPattern[] = [
  {
    callee: /(?<![\w$.])\bt\b/g,
    evidence: "astro-template-analyzer: t(...)",
    confidence: 0.8,
  },
  {
    callee: /\$t\b/g,
    evidence: "astro-template-analyzer: $t(...)",
    confidence: 0.8,
  },
  {
    callee: /\bi18next\.t\b/g,
    evidence: "astro-template-analyzer: i18next.t(...)",
    confidence: 0.85,
    library: "i18next",
  },
];

/**
 * Astro analyzer for `.astro` files.
 * Covers frontmatter (`---` … `---`) and template expressions.
 */
export function createAstroTemplateParser(): TemplateParser {
  return {
    id: DETECTOR,
    framework: "astro",
    extensions: ["astro"],
    analyze(input: TemplateAnalysisInput): TemplateAnalysisResult {
      try {
        return { usages: scanAstro(input), warnings: [] };
      } catch (error) {
        return {
          usages: [],
          warnings: [
            {
              code: "template-parse-failed",
              message: `Astro template analysis failed for ${input.relativePath}: ${error instanceof Error ? error.message : String(error)}`,
              path: input.relativePath,
            },
          ],
        };
      }
    },
  };
}

function scanAstro(input: TemplateAnalysisInput): TemplateUsage[] {
  let text = blankTagBodies(input.sourceText, "style");
  text = stripHtmlComments(text);
  text = stripFrontmatterJsComments(text);

  const library: TemplateLibraryId =
    input.libraryHints?.has("i18next") ||
    input.libraryHints?.has("astro-i18next")
      ? "i18next"
      : "unknown";

  return scanCallPatterns({
    text,
    sliceOffset: 0,
    sourceText: input.sourceText,
    absolutePath: input.absolutePath,
    relativePath: input.relativePath,
    framework: "astro",
    detector: DETECTOR,
    defaultLibrary: library,
    patterns: ASTRO_PATTERNS,
    lineIndex: buildLineIndex(input.sourceText),
  });
}

/** Blank JS comments inside the first frontmatter fence only. */
function stripFrontmatterJsComments(source: string): string {
  if (!source.startsWith("---")) {
    return source;
  }
  const end = source.indexOf("\n---", 3);
  if (end === -1) {
    return source;
  }
  const body = source.slice(3, end);
  const rest = source.slice(end);
  return `---${stripJsComments(body)}${rest}`;
}
