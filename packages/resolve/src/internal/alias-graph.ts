import ts from "typescript";
import type {
  AliasBinding,
  AliasGraph,
  AliasKind,
  AliasTarget,
  FunctionAlias,
} from "../api/types.js";
import { locationOf } from "./location.js";
import type { ScopeTable } from "./scopes.js";

const CONFIDENCE: Record<Exclude<AliasKind, "seed" | "wrapper">, number> = {
  identifier: 0.95,
  destructure: 0.9,
  member: 0.9,
  reassignment: 0.85,
};

export class MutableAliasGraph {
  readonly bindings: AliasBinding[] = [];

  add(binding: AliasBinding): void {
    this.bindings.push(binding);
  }

  bindingAt(
    name: string,
    position: number,
    scopes: ScopeTable,
    byName: ReadonlyMap<string, readonly AliasBinding[]>,
  ): AliasBinding | undefined {
    const candidates = byName.get(name);
    if (!candidates || candidates.length === 0) {
      return undefined;
    }

    const scope = scopes.scopeAt(position);
    const ancestorIds = new Set(scopes.ancestors(scope.id).map((s) => s.id));

    let best: AliasBinding | undefined;
    let bestDepth = -1;

    // candidates are sorted by declPos ascending — scan latest-first among visible.
    for (let i = candidates.length - 1; i >= 0; i -= 1) {
      const binding = candidates[i]!;
      if (binding.declPos > position) {
        continue;
      }
      if (!ancestorIds.has(binding.scopeId)) {
        continue;
      }
      const depth = scopes.scopes[binding.scopeId]?.depth ?? 0;
      if (
        !best ||
        depth > bestDepth ||
        (depth === bestDepth && binding.declPos >= best.declPos)
      ) {
        best = binding;
        bestDepth = depth;
        // Within a single scope, later declPos wins; since we scan descending
        // declPos, the first visible binding at max depth is optimal if we
        // continue only when depth could still increase… keep scanning for
        // deeper scopes that may have earlier declPos.
      }
    }
    return best;
  }

  freeze(scopes: ScopeTable): AliasGraph {
    // Deterministic order for public graph.bindings
    const sorted = [...this.bindings].sort(
      (a, b) =>
        a.declPos - b.declPos ||
        a.name.localeCompare(b.name) ||
        a.kind.localeCompare(b.kind),
    );

    const byName = new Map<string, AliasBinding[]>();
    for (const binding of sorted) {
      const list = byName.get(binding.name) ?? [];
      list.push(binding);
      byName.set(binding.name, list);
    }

    const self = this;
    const bindings = Object.freeze(sorted) as readonly AliasBinding[];
    return {
      bindings,
      bindingAt(name: string, position: number): AliasBinding | undefined {
        return self.bindingAt(name, position, scopes, byName);
      },
    };
  }
}

/**
 * Collect identifier / destructure / member / reassignment alias bindings.
 * Import bindings are intentionally omitted (imports are terminals).
 */
export function collectAliasBindings(
  sourceFile: ts.SourceFile,
  scopes: ScopeTable,
  wrappers: readonly FunctionAlias[],
): MutableAliasGraph {
  const graph = new MutableAliasGraph();
  const wrapperKeys = new Set(
    wrappers.map((w) => `${w.name}@${w.declPos}`),
  );

  for (const wrapper of wrappers) {
    graph.add({
      name: wrapper.name,
      kind: "wrapper",
      target: wrapper.target,
      location: wrapper.location,
      declPos: wrapper.declPos,
      scopeId: wrapper.scopeId,
      confidence: wrapper.confidence,
    });
  }

  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node)) {
      collectVariableDeclaration(
        node,
        sourceFile,
        scopes,
        graph,
        wrapperKeys,
      );
    } else if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken
    ) {
      collectAssignment(node, sourceFile, scopes, graph);
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return graph;
}

function collectVariableDeclaration(
  node: ts.VariableDeclaration,
  sourceFile: ts.SourceFile,
  scopes: ScopeTable,
  graph: MutableAliasGraph,
  wrapperKeys: ReadonlySet<string>,
): void {
  if (!node.initializer) {
    return;
  }

  const isVar = isVarDeclaration(node);

  if (ts.isIdentifier(node.name)) {
    const key = `${node.name.text}@${node.name.getStart(sourceFile)}`;
    if (wrapperKeys.has(key)) {
      return;
    }

    const target = expressionTarget(unwrap(node.initializer));
    // Non-alias initializers do not create edges (unknown value).
    if (!target) {
      return;
    }
    pushBinding(graph, {
      name: node.name.text,
      kind: target.type === "member" ? "member" : "identifier",
      target,
      nameNode: node.name,
      sourceFile,
      scopes,
      isVar,
      confidence:
        target.type === "member"
          ? CONFIDENCE.member
          : CONFIDENCE.identifier,
    });
    return;
  }

  if (ts.isObjectBindingPattern(node.name)) {
    collectDestructure(node.name, sourceFile, scopes, graph, isVar);
  }
}

function collectDestructure(
  pattern: ts.ObjectBindingPattern,
  sourceFile: ts.SourceFile,
  scopes: ScopeTable,
  graph: MutableAliasGraph,
  isVar: boolean,
): void {
  for (const element of pattern.elements) {
    if (element.dotDotDotToken || !ts.isIdentifier(element.name)) {
      continue;
    }
    const local = element.name.text;
    const prop = element.propertyName
      ? propertyNameText(element.propertyName)
      : local;
    if (!prop) {
      continue;
    }
    // Identity destructure (`{ t }`) — local is the seed name itself.
    if (local === prop) {
      continue;
    }
    pushBinding(graph, {
      name: local,
      kind: "destructure",
      target: { type: "name", name: prop },
      nameNode: element.name,
      sourceFile,
      scopes,
      isVar,
      confidence: CONFIDENCE.destructure,
    });
  }
}

function collectAssignment(
  node: ts.BinaryExpression,
  sourceFile: ts.SourceFile,
  scopes: ScopeTable,
  graph: MutableAliasGraph,
): void {
  if (!ts.isIdentifier(node.left)) {
    return;
  }
  // Skip pattern defaults / destructuring defaults handled elsewhere.
  // Kill or retarget the alias at this assignment position.
  const target =
    expressionTarget(unwrap(node.right)) ??
    ({ type: "unresolved" } as const);

  pushBinding(graph, {
    name: node.left.text,
    kind: "reassignment",
    target,
    nameNode: node.left,
    sourceFile,
    scopes,
    isVar: false,
    confidence:
      target.type === "unresolved" ? 0 : CONFIDENCE.reassignment,
  });
}

function expressionTarget(expr: ts.Expression): AliasTarget | undefined {
  if (ts.isIdentifier(expr)) {
    return { type: "name", name: expr.text };
  }
  if (
    ts.isPropertyAccessExpression(expr) &&
    ts.isIdentifier(expr.expression) &&
    ts.isIdentifier(expr.name)
  ) {
    return {
      type: "member",
      object: expr.expression.text,
      property: expr.name.text,
    };
  }
  return undefined;
}

function pushBinding(
  graph: MutableAliasGraph,
  input: {
    name: string;
    kind: AliasKind;
    target: AliasTarget;
    nameNode: ts.Identifier;
    sourceFile: ts.SourceFile;
    scopes: ScopeTable;
    isVar: boolean;
    confidence: number;
  },
): void {
  const declPos = input.nameNode.getStart(input.sourceFile);
  const scope = input.scopes.declarationScope(input.nameNode, input.sourceFile, {
    isVar: input.isVar,
  });
  graph.add({
    name: input.name,
    kind: input.kind,
    target: input.target,
    location: locationOf(input.sourceFile, input.nameNode),
    declPos,
    scopeId: scope.id,
    confidence: input.confidence,
  });
}

function isVarDeclaration(node: ts.VariableDeclaration): boolean {
  const list = node.parent;
  if (!list || !ts.isVariableDeclarationList(list)) {
    return false;
  }
  return (list.flags & ts.NodeFlags.Let) === 0 &&
    (list.flags & ts.NodeFlags.Const) === 0;
}

function propertyNameText(name: ts.PropertyName): string | undefined {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name)) {
    return name.text;
  }
  return undefined;
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
