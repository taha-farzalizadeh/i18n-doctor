import type {
  TemplateAnalysisInput,
  TemplateAnalysisResult,
  TemplateLibraryId,
  TemplateParser,
  TemplateUsage,
} from "../../api/types.js";
import { buildLineIndex } from "../location.js";
import { scanAttrPatterns } from "../scan-attrs.js";
import { parseStringLiteralAt } from "../string-literal.js";
import { stripMarkupNoise } from "../strip.js";
import { createTemplateUsage } from "../usage-hit.js";

const DETECTOR = "angular-template-analyzer";

/**
 * Angular HTML template analyzer:
 * - `'key' | translate` / `| transloco`
 * - `translate="key"` / `[translate]="'key'"`
 * - `*translate="'key'"`
 */
export function createAngularTemplateParser(): TemplateParser {
  return {
    id: DETECTOR,
    framework: "angular",
    extensions: ["html", "htm"],
    analyze(input: TemplateAnalysisInput): TemplateAnalysisResult {
      try {
        const library: TemplateLibraryId = input.libraryHints?.has("transloco")
          ? "transloco"
          : "ngx-translate";
        return {
          usages: scanAngular(input, library),
          warnings: [],
        };
      } catch (error) {
        return {
          usages: [],
          warnings: [
            {
              code: "template-parse-failed",
              message: `Angular template analysis failed for ${input.relativePath}: ${error instanceof Error ? error.message : String(error)}`,
              path: input.relativePath,
            },
          ],
        };
      }
    },
  };
}

function scanAngular(
  input: TemplateAnalysisInput,
  library: TemplateLibraryId,
): TemplateUsage[] {
  const text = stripMarkupNoise(input.sourceText);
  const lineIndex = buildLineIndex(input.sourceText);
  const usages: TemplateUsage[] = [];
  const seen = new Set<string>();

  const push = (
    key: string,
    keyStart: number,
    keyEnd: number,
    evidence: string,
    confidence: number,
    context: TemplateUsage["context"],
    lib: TemplateLibraryId = library,
  ) => {
    const dedupe = `${keyStart}:${keyEnd}:${key}:${lib}`;
    if (seen.has(dedupe)) {
      return;
    }
    seen.add(dedupe);
    usages.push(
      createTemplateUsage({
        key,
        absolutePath: input.absolutePath,
        relativePath: input.relativePath,
        sourceText: input.sourceText,
        keyStart,
        keyEnd,
        library: lib,
        confidence,
        context,
        framework: "angular",
        detector: DETECTOR,
        evidence,
        lineIndex,
      }),
    );
  };

  // Pipe: <expr> | translate — expr is a string literal
  const pipeRe = /\|\s*(translate|transloco)\b/g;
  let m: RegExpExecArray | null;
  while ((m = pipeRe.exec(text))) {
    const pipeName = m[1];
    // Walk left over whitespace to a string literal ending just before `|`.
    const lit = findStringLiteralBefore(text, m.index);
    if (!lit) {
      continue;
    }
    const lib: TemplateLibraryId =
      pipeName === "transloco" ? "transloco" : "ngx-translate";
    push(
      lit.value,
      lit.contentStart,
      lit.contentEnd,
      `angular-template-analyzer: 'key' | ${pipeName}`,
      0.85,
      "pipe",
      lib,
    );
  }

  const attrUsages = scanAttrPatterns({
    text,
    sliceOffset: 0,
    sourceText: input.sourceText,
    absolutePath: input.absolutePath,
    relativePath: input.relativePath,
    framework: "angular",
    detector: DETECTOR,
    defaultLibrary: library,
    lineIndex,
    patterns: [
      {
        // Plain attribute only — not [translate] or *translate.
        re: /(?<![*[])\btranslate\s*=\s*/g,
        valueKind: "raw",
        evidence: "angular-template-analyzer: translate=\"key\"",
        confidence: 0.82,
        library: "ngx-translate",
      },
      {
        re: /\[translate\]\s*=\s*/g,
        valueKind: "auto",
        evidence: "angular-template-analyzer: [translate]",
        confidence: 0.84,
        library: "ngx-translate",
      },
      {
        re: /\*translate\s*=\s*/g,
        valueKind: "auto",
        evidence: "angular-template-analyzer: *translate",
        confidence: 0.8,
        library: "ngx-translate",
      },
    ],
  });

  for (const u of attrUsages) {
    const dedupe = `${u.location.start}:${u.location.end}:${u.key}:${u.library}`;
    if (seen.has(dedupe)) {
      continue;
    }
    seen.add(dedupe);
    usages.push(u);
  }

  return usages;
}

/** Find a string literal that ends at (or just before) `beforeIndex`, skipping ws. */
function findStringLiteralBefore(
  text: string,
  beforeIndex: number,
): { value: string; contentStart: number; contentEnd: number } | undefined {
  let i = beforeIndex - 1;
  while (i >= 0 && /\s/.test(text[i]!)) {
    i -= 1;
  }
  if (i < 0) {
    return undefined;
  }
  const quote = text[i]!;
  if (quote !== "'" && quote !== '"') {
    return undefined;
  }
  // Scan backward for the matching opener, respecting escapes.
  let j = i - 1;
  while (j >= 0) {
    if (text[j] === quote) {
      // Count preceding backslashes.
      let bs = 0;
      let k = j - 1;
      while (k >= 0 && text[k] === "\\") {
        bs += 1;
        k -= 1;
      }
      if (bs % 2 === 0) {
        // Unescaped opener at j.
        const lit = parseStringLiteralAt(text, j);
        if (lit && lit.end - 1 === i) {
          return lit;
        }
        return undefined;
      }
    }
    if (text[j] === "\n") {
      return undefined;
    }
    j -= 1;
  }
  return undefined;
}
