import type ts from "typescript";
import type { AstComment, SourceLocation } from "./types.js";

/**
 * Node query utilities. Pure helpers over ParsedFile / SourceFile.
 */
export interface AstQueryApi {
  getLocation(sourceFile: ts.SourceFile, node: ts.Node): SourceLocation;

  getNodeAtPosition(
    sourceFile: ts.SourceFile,
    position: number,
  ): ts.Node | undefined;

  getNodesInRange(
    sourceFile: ts.SourceFile,
    start: number,
    end: number,
  ): ts.Node[];

  getLeadingComments(
    sourceFile: ts.SourceFile,
    node: ts.Node,
  ): readonly AstComment[];

  getTrailingComments(
    sourceFile: ts.SourceFile,
    node: ts.Node,
  ): readonly AstComment[];

  getAllComments(sourceFile: ts.SourceFile): readonly AstComment[];

  getText(sourceFile: ts.SourceFile, node: ts.Node): string;

  isKind<T extends ts.SyntaxKind>(
    node: ts.Node,
    kind: T,
  ): node is Extract<ts.Node, { kind: T }>;

  matchKinds(
    root: ts.Node,
    kinds: readonly ts.SyntaxKind[],
  ): ts.Node[];
}
