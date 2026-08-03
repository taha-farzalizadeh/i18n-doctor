import type {
  TemplateFrameworkId,
  TemplateLibraryId,
  TemplateUsage,
  TemplateUsageContext,
} from "../api/types.js";
import { buildLineIndex, type LineIndex } from "./location.js";
import { parseStringLiteralAt, skipWs } from "./string-literal.js";
import { createTemplateUsage } from "./usage-hit.js";

export interface CallPattern {
  /**
   * Callee matcher. Matched against the text immediately before `(`.
   * Examples: `$t`, `i18n.t`, `\bt` (word-boundary bare t).
   * Do not include the opening `(`.
   */
  readonly callee: RegExp;
  readonly evidence: string;
  readonly confidence: number;
  readonly context?: TemplateUsageContext;
  readonly library?: TemplateLibraryId;
}

/**
 * Scan `text` (a slice of `sourceText`) for `callee( 'key' | "key" )` patterns.
 * Uses real string-literal parsing (escapes) and precise content offsets.
 */
export function scanCallPatterns(input: {
  text: string;
  sliceOffset: number;
  sourceText: string;
  absolutePath: string;
  relativePath: string;
  framework: TemplateFrameworkId;
  detector: string;
  defaultLibrary: TemplateLibraryId;
  patterns: readonly CallPattern[];
  lineIndex?: LineIndex;
}): TemplateUsage[] {
  const usages: TemplateUsage[] = [];
  const lineIndex = input.lineIndex ?? buildLineIndex(input.sourceText);
  const seen = new Set<string>();

  for (const pattern of input.patterns) {
    const calleeRe = ensureGlobal(pattern.callee);
    let m: RegExpExecArray | null;
    while ((m = calleeRe.exec(input.text))) {
      const afterCallee = m.index + m[0].length;
      const paren = skipWs(input.text, afterCallee);
      if (input.text[paren] !== "(") {
        continue;
      }
      const argStart = skipWs(input.text, paren + 1);
      const lit = parseStringLiteralAt(input.text, argStart);
      if (!lit || !lit.value) {
        continue;
      }
      const absStart = input.sliceOffset + lit.contentStart;
      const absEnd = input.sliceOffset + lit.contentEnd;
      const dedupe = `${absStart}:${absEnd}:${lit.value}:${pattern.evidence}`;
      if (seen.has(dedupe)) {
        continue;
      }
      seen.add(dedupe);
      usages.push(
        createTemplateUsage({
          key: lit.value,
          absolutePath: input.absolutePath,
          relativePath: input.relativePath,
          sourceText: input.sourceText,
          keyStart: absStart,
          keyEnd: absEnd,
          library: pattern.library ?? input.defaultLibrary,
          confidence: pattern.confidence,
          context: pattern.context ?? "function-call",
          framework: input.framework,
          detector: input.detector,
          evidence: pattern.evidence,
          lineIndex,
        }),
      );
    }
  }
  return usages;
}

function ensureGlobal(re: RegExp): RegExp {
  const flags = re.flags.includes("g") ? re.flags : `${re.flags}g`;
  // Drop sticky; keep unicode/ignoreCase.
  return new RegExp(re.source, flags.replace("y", ""));
}

/** True when Nuxt i18n is suggested by dependency / library hints. */
export function hasNuxtHint(hints: ReadonlySet<string> | undefined): boolean {
  if (!hints) {
    return false;
  }
  for (const h of hints) {
    const id = h.toLowerCase();
    if (
      id === "nuxt-i18n" ||
      id === "@nuxtjs/i18n" ||
      id === "nuxt-i18n-module" ||
      (id.includes("nuxt") && id.includes("i18n"))
    ) {
      return true;
    }
  }
  return false;
}
