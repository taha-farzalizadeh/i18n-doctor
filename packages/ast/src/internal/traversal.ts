import ts from "typescript";
import type { AstTraversalApi, AstVisitor, VisitResult } from "../api/traversal.js";

export const traversalApi: AstTraversalApi = {
  walk(root, visitor) {
    walkNode(root, undefined, visitor);
  },

  forEachChild(root, visitor) {
    walkNode(root, undefined, {
      enter: visitor,
    });
  },

  getChildren(node) {
    const children: ts.Node[] = [];
    ts.forEachChild(node, (child) => {
      children.push(child);
    });
    return children;
  },

  getAncestors(node) {
    const ancestors: ts.Node[] = [];
    let current: ts.Node | undefined = node.parent;
    while (current) {
      ancestors.push(current);
      current = current.parent;
    }
    return ancestors;
  },

  findAncestor(node, predicate) {
    let current: ts.Node | undefined = node.parent;
    while (current) {
      if (predicate(current)) {
        return current;
      }
      current = current.parent;
    }
    return undefined;
  },

  find(root, predicate) {
    let found: ts.Node | undefined;
    walkNode(root, undefined, {
      enter(node) {
        if (predicate(node)) {
          found = node;
          return "stop";
        }
        return undefined;
      },
    });
    return found;
  },

  findAll(root, predicate) {
    const results: ts.Node[] = [];
    walkNode(root, undefined, {
      enter(node) {
        if (predicate(node)) {
          results.push(node);
        }
      },
    });
    return results;
  },
};

/**
 * Depth-first walk without allocating a children array per node.
 * Uses TypeScript's forEachChild early-exit (truthy return stops siblings).
 */
function walkNode(
  node: ts.Node,
  parent: ts.Node | undefined,
  visitor: AstVisitor,
): "stop" | undefined {
  const enterResult = visitor.enter?.(node, parent);
  if (enterResult === "stop") {
    return "stop";
  }

  if (enterResult !== "skip") {
    let stopped = false;
    ts.forEachChild(node, (child) => {
      if (walkNode(child, node, visitor) === "stop") {
        stopped = true;
        return true;
      }
      return undefined;
    });
    if (stopped) {
      return "stop";
    }
  }

  const leaveResult = visitor.leave?.(node, parent);
  if (leaveResult === "stop") {
    return "stop";
  }
  return undefined;
}

export type { VisitResult };
