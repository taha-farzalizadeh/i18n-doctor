import path from "node:path";
import { queryApi, type SourceLocation as AstSourceLocation } from "@i18n-unused/ast";
import type ts from "typescript";
import type { TranslationUsage, UsageLocation } from "../api/types.js";

/** Convert AST engine location (1-based) to UsageLocation. */
export function toUsageLocation(loc: AstSourceLocation): UsageLocation {
  return {
    line: loc.startLine,
    column: loc.startCharacter,
    endLine: loc.endLine,
    endColumn: loc.endCharacter,
    start: loc.start,
    end: loc.end,
  };
}

/** Location of a specific AST node. */
export function locationOf(
  sourceFile: ts.SourceFile,
  node: ts.Node,
): UsageLocation {
  return toUsageLocation(queryApi.getLocation(sourceFile, node));
}

/** Resolve absolute path for a workspace-relative file. */
export function resolveAbsolutePath(root: string, relativePath: string): string {
  return path.resolve(root, relativePath);
}

/**
 * Map offsets in a full file to line/column.
 */
export function locationFromOffsets(
  sourceText: string,
  absoluteStart: number,
  absoluteEnd: number,
): UsageLocation {
  const startLc = offsetToLineCol(sourceText, absoluteStart);
  const endLc = offsetToLineCol(sourceText, Math.max(absoluteStart, absoluteEnd));
  return {
    line: startLc.line,
    column: startLc.column,
    endLine: endLc.line,
    endColumn: endLc.column,
    start: absoluteStart,
    end: absoluteEnd,
  };
}

/** Shift usages extracted from a sliced script (e.g. Vue SFC) into file coordinates. */
export function offsetUsages(
  usages: readonly TranslationUsage[],
  fullSourceText: string,
  scriptOffset: number,
): TranslationUsage[] {
  if (scriptOffset === 0) {
    return [...usages];
  }
  return usages.map((usage) => {
    const start = usage.location.start + scriptOffset;
    const end = usage.location.end + scriptOffset;
    return {
      ...usage,
      location: locationFromOffsets(fullSourceText, start, end),
    };
  });
}

function offsetToLineCol(
  text: string,
  offset: number,
): { line: number; column: number } {
  let line = 1;
  let column = 1;
  const clamped = Math.max(0, Math.min(offset, text.length));
  for (let i = 0; i < clamped; i += 1) {
    if (text[i] === "\n") {
      line += 1;
      column = 1;
    } else {
      column += 1;
    }
  }
  return { line, column };
}
