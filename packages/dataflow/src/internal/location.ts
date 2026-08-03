import path from "node:path";
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

export function toPosix(filePath: string): string {
  return filePath.replace(/\\/g, "/");
}

export function relativeToRoot(root: string, absolutePath: string): string {
  return toPosix(path.relative(root, absolutePath));
}

export function resolveAgainstRoot(root: string, filePath: string): string {
  if (path.isAbsolute(filePath)) {
    return path.normalize(filePath);
  }
  return path.normalize(path.resolve(root, filePath));
}
