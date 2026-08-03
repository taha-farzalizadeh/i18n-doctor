import ts from "typescript";

export interface ScopeNode {
  readonly id: number;
  readonly parentId: number | undefined;
  readonly start: number;
  readonly end: number;
  /** Depth from the source-file scope (0). */
  readonly depth: number;
  /** Kind — used for var-hoisting and function-name binding. */
  readonly kind: ScopeKind;
}

export type ScopeKind =
  | "source"
  | "function"
  | "class"
  | "block"
  | "module"
  | "catch"
  | "for"
  | "case";

export interface ScopeTable {
  readonly scopes: readonly ScopeNode[];
  /** Scope that lexically contains `position` (innermost). */
  scopeAt(position: number): ScopeNode;
  /** Ancestor chain from innermost to root. */
  ancestors(scopeId: number): readonly ScopeNode[];
  /** Nearest function-like or source scope (for `var` hoisting). */
  functionScope(scopeId: number): ScopeNode;
  /**
   * Declaration scope for a binding name node.
   * Handles function-declaration names (bind in parent) and `var` hoisting.
   */
  declarationScope(
    nameNode: ts.Node,
    sourceFile: ts.SourceFile,
    flags?: { readonly isVar?: boolean },
  ): ScopeNode;
}

/**
 * Build a lightweight lexical scope table for one SourceFile.
 * Not a full TS checker — block/function/module/catch/for only.
 */
export function buildScopeTable(sourceFile: ts.SourceFile): ScopeTable {
  const scopes: ScopeNode[] = [];
  let nextId = 0;

  const rootId = nextId++;
  scopes.push({
    id: rootId,
    parentId: undefined,
    start: 0,
    end: sourceFile.end,
    depth: 0,
    kind: "source",
  });

  const stack: number[] = [rootId];

  const visit = (node: ts.Node): void => {
    const kind = scopeKind(node);
    if (kind && node !== sourceFile) {
      const parentId = stack[stack.length - 1]!;
      const parent = scopes[parentId]!;
      const id = nextId++;
      scopes.push({
        id,
        parentId,
        start: node.getStart(sourceFile),
        end: node.end,
        depth: parent.depth + 1,
        kind,
      });
      stack.push(id);
      ts.forEachChild(node, visit);
      stack.pop();
      return;
    }
    ts.forEachChild(node, visit);
  };

  ts.forEachChild(sourceFile, visit);

  // Depth-descending index speeds innermost scopeAt for large files.
  const byDepthDesc = [...scopes].sort((a, b) => b.depth - a.depth || b.start - a.start);

  const table: ScopeTable = {
    scopes,
    scopeAt(position: number): ScopeNode {
      for (const scope of byDepthDesc) {
        if (position >= scope.start && position <= scope.end) {
          return scope;
        }
      }
      return scopes[0]!;
    },
    ancestors(scopeId: number): readonly ScopeNode[] {
      const chain: ScopeNode[] = [];
      let current: ScopeNode | undefined = scopes[scopeId];
      while (current) {
        chain.push(current);
        current =
          current.parentId !== undefined
            ? scopes[current.parentId]
            : undefined;
      }
      return chain;
    },
    functionScope(scopeId: number): ScopeNode {
      let current: ScopeNode | undefined = scopes[scopeId];
      while (current) {
        if (
          current.kind === "function" ||
          current.kind === "source" ||
          current.kind === "module"
        ) {
          return current;
        }
        current =
          current.parentId !== undefined
            ? scopes[current.parentId]
            : undefined;
      }
      return scopes[0]!;
    },
    declarationScope(nameNode, _sf, flags): ScopeNode {
      const atName = table.scopeAt(nameNode.getStart(sourceFile));

      // function foo() {} — name binds in the enclosing scope, not the body.
      if (
        ts.isFunctionDeclaration(nameNode.parent) &&
        nameNode.parent.name === nameNode
      ) {
        return atName.parentId !== undefined
          ? scopes[atName.parentId]!
          : atName;
      }

      // var is function-scoped
      if (flags?.isVar) {
        return table.functionScope(atName.id);
      }

      return atName;
    },
  };

  return table;
}

function scopeKind(node: ts.Node): ScopeKind | undefined {
  if (
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isConstructorDeclaration(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isSetAccessorDeclaration(node)
  ) {
    return "function";
  }
  if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) {
    return "class";
  }
  if (ts.isModuleDeclaration(node)) {
    return "module";
  }
  if (ts.isModuleBlock(node) || ts.isBlock(node)) {
    return "block";
  }
  if (ts.isCatchClause(node)) {
    return "catch";
  }
  if (
    ts.isForStatement(node) ||
    ts.isForInStatement(node) ||
    ts.isForOfStatement(node)
  ) {
    return "for";
  }
  if (ts.isCaseBlock(node)) {
    return "case";
  }
  return undefined;
}
