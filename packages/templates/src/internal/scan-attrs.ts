import type {
  TemplateFrameworkId,
  TemplateLibraryId,
  TemplateUsage,
  TemplateUsageContext,
} from "../api/types.js";
import { buildLineIndex, type LineIndex } from "./location.js";
import { parseStringLiteralAt, skipWs } from "./string-literal.js";
import { createTemplateUsage } from "./usage-hit.js";

export interface AttrPattern {
  /** Matches the attribute assignment up to (not including) the value literal. */
  readonly re: RegExp;
  /**
   * - auto: unwrap one level of nested quotes when present
   * - raw: never unwrap (attribute quotes wrap the key)
   * - nested-literal: require inner string literal
   */
  readonly valueKind: "auto" | "nested-literal" | "raw";
  readonly evidence: string;
  readonly confidence: number;
  readonly context?: TemplateUsageContext;
  readonly library?: TemplateLibraryId;
}

export function scanAttrPatterns(input: {
  text: string;
  sliceOffset: number;
  sourceText: string;
  absolutePath: string;
  relativePath: string;
  framework: TemplateFrameworkId;
  detector: string;
  defaultLibrary: TemplateLibraryId;
  patterns: readonly AttrPattern[];
  lineIndex?: LineIndex;
}): TemplateUsage[] {
  const usages: TemplateUsage[] = [];
  const lineIndex = input.lineIndex ?? buildLineIndex(input.sourceText);
  const seen = new Set<string>();

  for (const pattern of input.patterns) {
    const re = new RegExp(
      pattern.re.source,
      pattern.re.flags.includes("g") ? pattern.re.flags : `${pattern.re.flags}g`,
    );
    let m: RegExpExecArray | null;
    while ((m = re.exec(input.text))) {
      const valueOffset = m.index + m[0].length;
      const parsed = parseAttrValue(input.text, valueOffset, pattern.valueKind);
      if (!parsed || !parsed.value) {
        continue;
      }
      const absStart = input.sliceOffset + parsed.contentStart;
      const absEnd = input.sliceOffset + parsed.contentEnd;
      const dedupe = `${absStart}:${absEnd}:${parsed.value}:${pattern.evidence}`;
      if (seen.has(dedupe)) {
        continue;
      }
      seen.add(dedupe);
      usages.push(
        createTemplateUsage({
          key: parsed.value,
          absolutePath: input.absolutePath,
          relativePath: input.relativePath,
          sourceText: input.sourceText,
          keyStart: absStart,
          keyEnd: absEnd,
          library: pattern.library ?? input.defaultLibrary,
          confidence: pattern.confidence,
          context: pattern.context ?? "unknown",
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

function parseAttrValue(
  text: string,
  offset: number,
  kind: AttrPattern["valueKind"],
): { value: string; contentStart: number; contentEnd: number } | undefined {
  const start = skipWs(text, offset);
  const outer = parseStringLiteralAt(text, start);
  if (!outer) {
    return undefined;
  }

  if (kind === "raw") {
    return {
      value: outer.value,
      contentStart: outer.contentStart,
      contentEnd: outer.contentEnd,
    };
  }

  const inner = parseStringLiteralAt(text, outer.contentStart);
  const nested =
    inner && inner.end <= outer.contentEnd
      ? {
          value: inner.value,
          contentStart: inner.contentStart,
          contentEnd: inner.contentEnd,
        }
      : undefined;

  if (kind === "nested-literal") {
    return nested;
  }

  // auto: prefer nested string literal when the attribute value is itself quoted
  return (
    nested ?? {
      value: outer.value,
      contentStart: outer.contentStart,
      contentEnd: outer.contentEnd,
    }
  );
}
