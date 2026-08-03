import ts from "typescript";
import type {
  CallEdge,
  CallEdgeKind,
  FunctionKind,
  FunctionNode,
  SourceLocation,
} from "../api/types.js";
import {
  functionId,
  locationOf,
  moduleInitId,
  relativeToRoot,
} from "./location.js";
import { ScopeMetaStore } from "./scope-meta.js";

export interface ExtractedFile {
  readonly functions: FunctionNode[];
  readonly edges: CallEdge[];
  readonly scopes: ScopeMetaStore;
}

/**
 * Extract function nodes and call/return/alias edges from one SourceFile.
 * Pure AST walk — no execution.
 */
export function extractFileGraph(input: {
  root: string;
  absolutePath: string;
  sourceFile: ts.SourceFile;
}): ExtractedFile {
  const { root, absolutePath, sourceFile } = input;
  const relativePath = relativeToRoot(root, absolutePath);
  const functions: FunctionNode[] = [];
  const edges: CallEdge[] = [];
  const scopes = new ScopeMetaStore();
  const fnById = new Map<string, FunctionNode>();
  let edgeSeq = 0;

  const moduleId = moduleInitId(absolutePath);
  const moduleNode: FunctionNode = {
    id: moduleId,
    name: "<module>",
    kind: "declaration",
    absolutePath,
    relativePath,
    location: {
      line: 1,
      column: 1,
      endLine: 1,
      endColumn: 1,
      start: 0,
      end: 0,
    },
    synthetic: true,
  };
  functions.push(moduleNode);
  fnById.set(moduleId, moduleNode);
  scopes.setFunction({
    id: moduleId,
    scopeStart: 0,
    scopeEnd: sourceFile.end,
    hoisted: true,
  });

  const stack: string[] = [moduleId];

  const addFn = (
    name: string,
    kind: FunctionKind,
    nameNode: ts.Node,
    fn: ts.FunctionLikeDeclaration,
    hoisted: boolean,
  ): FunctionNode => {
    const loc = locationOf(sourceFile, nameNode);
    const id = functionId(absolutePath, name, loc.start);
    const parameterName = firstParamName(fn);
    const node: FunctionNode = {
      id,
      name,
      kind,
      absolutePath,
      relativePath,
      location: loc,
      ...(parameterName !== undefined ? { parameterName } : {}),
    };
    functions.push(node);
    fnById.set(id, node);

    const container = enclosingScopeRange(fn, sourceFile);
    scopes.setFunction({
      id,
      scopeStart: container.start,
      scopeEnd: container.end,
      hoisted,
    });
    scopes.addLocal({
      absolutePath,
      name,
      declPos: loc.start,
      scopeStart: container.start,
      scopeEnd: container.end,
      hoisted,
      functionId: id,
    });
    return node;
  };

  const addEdge = (partial: {
    kind: CallEdgeKind;
    from: string;
    calleeName: string;
    to?: string;
    location: SourceLocation;
    forwardsKeyParam?: boolean;
    aliasName?: string;
    confidence?: number;
  }): void => {
    edges.push({
      id: `${absolutePath}::edge@${edgeSeq++}`,
      kind: partial.kind,
      from: partial.from,
      calleeName: partial.calleeName,
      ...(partial.to !== undefined ? { to: partial.to } : {}),
      absolutePath,
      relativePath,
      location: partial.location,
      ...(partial.forwardsKeyParam !== undefined
        ? { forwardsKeyParam: partial.forwardsKeyParam }
        : {}),
      ...(partial.aliasName !== undefined
        ? { aliasName: partial.aliasName }
        : {}),
      confidence: partial.confidence ?? 0.85,
    });
  };

  const visitFunctionBody = (
    fn: ts.FunctionLikeDeclaration,
    fnNode: FunctionNode,
  ): void => {
    stack.push(fnNode.id);
    if (fn.body) {
      visit(fn.body);
    }
    stack.pop();

    for (const ret of collectReturnExpressions(fn)) {
      const unwrapped = unwrap(ret);
      if (ts.isIdentifier(unwrapped)) {
        addEdge({
          kind: "return-identity",
          from: fnNode.id,
          calleeName: unwrapped.text,
          location: locationOf(sourceFile, unwrapped),
          confidence: 0.9,
        });
      } else if (
        ts.isPropertyAccessExpression(unwrapped) &&
        ts.isIdentifier(unwrapped.name)
      ) {
        addEdge({
          kind: "return-member",
          from: fnNode.id,
          calleeName: memberCalleeName(unwrapped),
          location: locationOf(sourceFile, unwrapped),
          confidence: 0.88,
        });
      }
    }
  };

  const visit = (node: ts.Node): void => {
    if (ts.isFunctionDeclaration(node) && node.name && node.body) {
      const fnNode = addFn(
        node.name.text,
        "declaration",
        node.name,
        node,
        true,
      );
      visitFunctionBody(node, fnNode);
      return;
    }

    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer
    ) {
      const init = unwrap(node.initializer);
      if (isFunctionLike(init)) {
        const kind: FunctionKind = ts.isArrowFunction(init)
          ? "arrow"
          : "expression";
        const fnNode = addFn(node.name.text, kind, node.name, init, false);
        visitFunctionBody(init, fnNode);
        return;
      }

      const aliasLoc = locationOf(sourceFile, node.name);
      const container = enclosingScopeRange(node, sourceFile);

      if (ts.isIdentifier(init)) {
        scopes.addLocal({
          absolutePath,
          name: node.name.text,
          declPos: aliasLoc.start,
          scopeStart: container.start,
          scopeEnd: container.end,
          hoisted: false,
        });
        addEdge({
          kind: "assign-alias",
          from: stack[stack.length - 1]!,
          calleeName: init.text,
          aliasName: node.name.text,
          location: aliasLoc,
          confidence: 0.9,
        });
      } else if (ts.isCallExpression(init)) {
        const callee = calleeNameOf(init.expression);
        if (callee) {
          scopes.addLocal({
            absolutePath,
            name: node.name.text,
            declPos: aliasLoc.start,
            scopeStart: container.start,
            scopeEnd: container.end,
            hoisted: false,
          });
          addEdge({
            kind: "assign-alias",
            from: stack[stack.length - 1]!,
            calleeName: callee,
            aliasName: node.name.text,
            location: aliasLoc,
            confidence: 0.8,
          });
        }
      } else if (
        ts.isPropertyAccessExpression(init) &&
        ts.isIdentifier(init.name)
      ) {
        scopes.addLocal({
          absolutePath,
          name: node.name.text,
          declPos: aliasLoc.start,
          scopeStart: container.start,
          scopeEnd: container.end,
          hoisted: false,
        });
        addEdge({
          kind: "assign-alias",
          from: stack[stack.length - 1]!,
          calleeName: memberCalleeName(init),
          aliasName: node.name.text,
          location: aliasLoc,
          confidence: 0.9,
        });
      }
    }

    if (ts.isPropertyAssignment(node) && ts.isIdentifier(node.name)) {
      const init = unwrap(node.initializer);
      if (isFunctionLike(init)) {
        const fnNode = addFn(node.name.text, "method", node.name, init, false);
        visitFunctionBody(init, fnNode);
        return;
      }
    }
    if (
      ts.isMethodDeclaration(node) &&
      node.name &&
      ts.isIdentifier(node.name) &&
      node.body
    ) {
      const fnNode = addFn(node.name.text, "method", node.name, node, false);
      visitFunctionBody(node, fnNode);
      return;
    }

    if (ts.isCallExpression(node)) {
      const from = stack[stack.length - 1]!;
      const calleeName = calleeNameOf(node.expression);
      if (calleeName) {
        const callerFn = fnById.get(from);
        const forwards =
          callerFn?.parameterName !== undefined &&
          node.arguments.length > 0 &&
          isIdentifierNamed(node.arguments[0]!, callerFn.parameterName);

        const kind: CallEdgeKind =
          ts.isPropertyAccessExpression(unwrap(node.expression)) ||
          ts.isElementAccessExpression(unwrap(node.expression))
            ? "member-call"
            : "call";

        addEdge({
          kind,
          from,
          calleeName,
          location: locationOf(sourceFile, node.expression),
          ...(forwards ? { forwardsKeyParam: true } : {}),
          confidence: 0.85,
        });
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  // Resolve local `to` with scope-aware linking.
  for (let i = 0; i < edges.length; i++) {
    const edge = edges[i]!;
    if (edge.calleeName.includes(".") || edge.calleeName.includes("(")) {
      continue;
    }
    const local = scopes.findLocal(
      absolutePath,
      edge.calleeName,
      edge.location.start,
    );
    if (local?.functionId) {
      edges[i] = { ...edge, to: local.functionId };
    }
  }

  return { functions, edges, scopes };
}

function enclosingScopeRange(
  node: ts.Node,
  sourceFile: ts.SourceFile,
): { start: number; end: number } {
  let current: ts.Node | undefined = node.parent;
  while (current) {
    if (
      ts.isBlock(current) ||
      ts.isModuleBlock(current) ||
      ts.isSourceFile(current) ||
      ts.isCaseClause(current) ||
      ts.isDefaultClause(current)
    ) {
      return {
        start: current.getStart(sourceFile),
        end: current.end,
      };
    }
    if (
      ts.isFunctionDeclaration(current) ||
      ts.isFunctionExpression(current) ||
      ts.isArrowFunction(current) ||
      ts.isMethodDeclaration(current) ||
      ts.isConstructorDeclaration(current)
    ) {
      const body = current.body;
      if (body) {
        return { start: body.getStart(sourceFile), end: body.end };
      }
    }
    current = current.parent;
  }
  return { start: 0, end: sourceFile.end };
}

function firstParamName(fn: ts.FunctionLikeDeclaration): string | undefined {
  const p = fn.parameters[0];
  if (!p || !ts.isIdentifier(p.name)) return undefined;
  if (p.dotDotDotToken) return undefined;
  return p.name.text;
}

function isFunctionLike(node: ts.Node): node is ts.FunctionLikeDeclaration {
  return (
    ts.isArrowFunction(node) ||
    ts.isFunctionExpression(node) ||
    ts.isFunctionDeclaration(node) ||
    ts.isMethodDeclaration(node)
  );
}

function unwrap(expr: ts.Expression): ts.Expression {
  let current = expr;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isTypeAssertionExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isNonNullExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

/** Prefer `useTranslation().t` over `useTranslation.t`. */
function memberCalleeName(expr: ts.PropertyAccessExpression): string {
  const prop = expr.name.text;
  const inner = unwrap(expr.expression);
  if (ts.isCallExpression(inner)) {
    const hook = calleeNameOf(inner.expression);
    if (hook) return `${hook}().${prop}`;
  }
  const obj = rootIdentifier(expr.expression);
  return obj ? `${obj}.${prop}` : prop;
}

function calleeNameOf(expression: ts.Expression): string | undefined {
  const expr = unwrap(expression);
  if (ts.isIdentifier(expr)) return expr.text;
  if (ts.isPropertyAccessExpression(expr) && ts.isIdentifier(expr.name)) {
    return memberCalleeName(expr);
  }
  return undefined;
}

function rootIdentifier(expr: ts.Expression): string | undefined {
  const e = unwrap(expr);
  if (ts.isIdentifier(e)) return e.text;
  if (ts.isPropertyAccessExpression(e)) return rootIdentifier(e.expression);
  if (ts.isCallExpression(e)) return rootIdentifier(e.expression);
  return undefined;
}

function isIdentifierNamed(node: ts.Node, name: string): boolean {
  return ts.isIdentifier(node) && node.text === name;
}

function collectReturnExpressions(
  fn: ts.FunctionLikeDeclaration,
): ts.Expression[] {
  const out: ts.Expression[] = [];
  if (!fn.body) return out;

  if (ts.isArrowFunction(fn) && !ts.isBlock(fn.body)) {
    out.push(fn.body);
    return out;
  }

  if (!ts.isBlock(fn.body)) return out;

  const visit = (node: ts.Node): void => {
    if (ts.isFunctionLike(node) && node !== fn) {
      return;
    }
    if (ts.isReturnStatement(node) && node.expression) {
      out.push(node.expression);
    }
    ts.forEachChild(node, visit);
  };
  visit(fn.body);
  return out;
}
