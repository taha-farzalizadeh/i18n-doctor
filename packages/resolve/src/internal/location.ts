import ts from "typescript";
import type { SourceLocation } from "../api/types.js";

export function locationOf(
  sourceFile: ts.SourceFile,
  node: ts.Node,
): SourceLocation {
  const start = node.getStart(sourceFile);
  const end = node.getEnd();
  const startLc = sourceFile.getLineAndCharacterOfPosition(start);
  const endLc = sourceFile.getLineAndCharacterOfPosition(end);
  return {
    line: startLc.line + 1,
    column: startLc.character + 1,
    endLine: endLc.line + 1,
    endColumn: endLc.character + 1,
    start,
    end,
  };
}

export function locationAt(
  sourceFile: ts.SourceFile,
  position: number,
): SourceLocation {
  return locationSpan(sourceFile, position, position);
}

/** Location covering [start, end) UTF-16 offsets. */
export function locationSpan(
  sourceFile: ts.SourceFile,
  start: number,
  end: number,
): SourceLocation {
  const safeEnd = Math.max(start, end);
  const startLc = sourceFile.getLineAndCharacterOfPosition(start);
  const endLc = sourceFile.getLineAndCharacterOfPosition(
    Math.min(safeEnd, sourceFile.text.length),
  );
  return {
    line: startLc.line + 1,
    column: startLc.character + 1,
    endLine: endLc.line + 1,
    endColumn: endLc.character + 1,
    start,
    end: safeEnd,
  };
}
