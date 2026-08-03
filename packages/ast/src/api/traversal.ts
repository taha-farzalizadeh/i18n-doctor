import type ts from "typescript";

export type VisitResult = void | "skip" | "stop";

export interface AstVisitor {
  readonly enter?: (node: ts.Node, parent: ts.Node | undefined) => VisitResult;
  readonly leave?: (node: ts.Node, parent: ts.Node | undefined) => VisitResult;
}

/**
 * Tree traversal helpers over TypeScript nodes with parent awareness.
 */
export interface AstTraversalApi {
  /** Depth-first walk with enter/leave hooks. */
  walk(root: ts.Node, visitor: AstVisitor): void;

  /** Visit every node; return false to stop, "skip" to skip children. */
  forEachChild(
    root: ts.Node,
    visitor: (node: ts.Node, parent: ts.Node | undefined) => VisitResult,
  ): void;

  /** Immediate children (syntax list flattened via forEachChild). */
  getChildren(node: ts.Node): ts.Node[];

  /** Parent chain from node up to SourceFile (excluding node). */
  getAncestors(node: ts.Node): ts.Node[];

  /** Nearest ancestor matching predicate. */
  findAncestor(
    node: ts.Node,
    predicate: (node: ts.Node) => boolean,
  ): ts.Node | undefined;

  /** First descendant matching predicate (DFS preorder). */
  find(
    root: ts.Node,
    predicate: (node: ts.Node) => boolean,
  ): ts.Node | undefined;

  /** All descendants matching predicate. */
  findAll(
    root: ts.Node,
    predicate: (node: ts.Node) => boolean,
  ): ts.Node[];
}
