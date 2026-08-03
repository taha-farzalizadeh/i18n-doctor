import type { TemplateLocation } from "../api/types.js";

/** Precomputed line-start offsets for O(log n) offset→line/col lookups. */
export interface LineIndex {
  readonly lineStarts: readonly number[];
}

export function buildLineIndex(text: string): LineIndex {
  const lineStarts: number[] = [0];
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === "\n") {
      lineStarts.push(i + 1);
    }
  }
  return { lineStarts };
}

export function locationFromOffsets(
  sourceText: string,
  absoluteStart: number,
  absoluteEnd: number,
  lineIndex?: LineIndex,
): TemplateLocation {
  const index = lineIndex ?? buildLineIndex(sourceText);
  const startLc = offsetToLineCol(index, absoluteStart, sourceText.length);
  const endLc = offsetToLineCol(
    index,
    Math.max(absoluteStart, absoluteEnd),
    sourceText.length,
  );
  return {
    line: startLc.line,
    column: startLc.column,
    endLine: endLc.line,
    endColumn: endLc.column,
    start: absoluteStart,
    end: absoluteEnd,
  };
}

function offsetToLineCol(
  index: LineIndex,
  offset: number,
  textLength: number,
): { line: number; column: number } {
  const clamped = Math.max(0, Math.min(offset, textLength));
  const starts = index.lineStarts;
  let lo = 0;
  let hi = starts.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const start = starts[mid]!;
    const next = starts[mid + 1] ?? Number.POSITIVE_INFINITY;
    if (clamped < start) {
      hi = mid - 1;
    } else if (clamped >= next) {
      lo = mid + 1;
    } else {
      return { line: mid + 1, column: clamped - start + 1 };
    }
  }
  const line = Math.max(1, lo);
  const start = starts[line - 1] ?? 0;
  return { line, column: clamped - start + 1 };
}
