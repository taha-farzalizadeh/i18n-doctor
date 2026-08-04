import path from "node:path";
import { queryApi } from "@i18n-unused/ast";
import type ts from "typescript";
import type { SourceLocation } from "../api/types.js";

export function resolveAgainstRoot(root: string, filePath: string): string {
  return path.isAbsolute(filePath)
    ? path.normalize(filePath)
    : path.resolve(root, filePath);
}

export function relativeToRoot(root: string, absolutePath: string): string {
  const rel = path.relative(root, absolutePath);
  return rel.split(path.sep).join("/");
}

export function locationOf(
  sourceFile: ts.SourceFile,
  node: ts.Node,
): SourceLocation {
  const loc = queryApi.getLocation(sourceFile, node);
  return {
    line: loc.startLine,
    column: loc.startCharacter,
    endLine: loc.endLine,
    endColumn: loc.endCharacter,
    start: loc.start,
    end: loc.end,
  };
}

export function roundConfidence(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  const clamped = Math.min(1, Math.max(0, value));
  return Math.round(clamped * 1000) / 1000;
}
