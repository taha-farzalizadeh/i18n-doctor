import ts from "typescript";
import { locationOf } from "./location.js";

/**
 * A statically resolvable variable binding (const, or immutable let/var).
 */
export interface ResolvedBinding {
  readonly name: string;
  readonly nameNode: ts.Identifier;
  readonly declaration: ts.VariableDeclaration;
  readonly initializer: ts.Expression;
  readonly flags: ts.NodeFlags;
  readonly isConst: boolean;
  /** True when let/var and an assignment/update was found in scope. */
  readonly reassigned: boolean;
}

/** Per-file index: avoids rescanning the AST for every identifier. */
export interface BindingIndex {
  readonly byName: ReadonlyMap<string, readonly ts.VariableDeclaration[]>;
  /** Declarations known to be written after init (let/var). */
  readonly reassigned: ReadonlySet<ts.VariableDeclaration>;
}

const indexCache = new WeakMap<ts.SourceFile, BindingIndex>();

export function getBindingIndex(sourceFile: ts.SourceFile): BindingIndex {
  const cached = indexCache.get(sourceFile);
  if (cached) return cached;

  const byName = new Map<string, ts.VariableDeclaration[]>();
  const declarations: ts.VariableDeclaration[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
      const list = byName.get(node.name.text);
      if (list) list.push(node);
      else byName.set(node.name.text, [node]);
      declarations.push(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  const reassigned = findReassignments(sourceFile, byName);

  const index: BindingIndex = {
    byName,
    reassigned,
  };
  indexCache.set(sourceFile, index);
  return index;
}

/**
 * Resolve the binding for `name` that is in scope at `position`.
 * Prefers innermost (highest declaration start).
 */
export function findBindingAt(
  sourceFile: ts.SourceFile,
  name: string,
  position: number,
): ResolvedBinding | undefined {
  const index = getBindingIndex(sourceFile);
  const candidates = index.byName.get(name);
  if (!candidates || candidates.length === 0) return undefined;

  let best: ts.VariableDeclaration | undefined;
  let bestStart = -1;

  for (const decl of candidates) {
    if (!decl.initializer || !ts.isIdentifier(decl.name)) continue;
    const declStart = decl.name.getStart(sourceFile);
    // TDZ: declaration must precede the use (or be the use itself).
    if (position > 0 && declStart > position) continue;
    if (!isInScopeAt(decl, position, sourceFile)) continue;
    if (declStart >= bestStart) {
      best = decl;
      bestStart = declStart;
    }
  }

  if (!best || !best.initializer || !ts.isIdentifier(best.name)) {
    return undefined;
  }

  const flags = best.parent && ts.isVariableDeclarationList(best.parent)
    ? best.parent.flags
    : 0;
  const isConst = (flags & ts.NodeFlags.Const) !== 0;
  const reassigned = index.reassigned.has(best);

  return {
    name,
    nameNode: best.name,
    declaration: best,
    initializer: best.initializer,
    flags,
    isConst,
    reassigned,
  };
}

/**
 * Whether a binding is safe to fold: `const`, or `let`/`var` with initializer
 * and no observed reassignment in its scope.
 */
export function isFoldableBinding(binding: ResolvedBinding): boolean {
  if (!binding.initializer) return false;
  if (binding.isConst) return true;
  return !binding.reassigned;
}

export function bindingLocation(
  sourceFile: ts.SourceFile,
  binding: ResolvedBinding,
) {
  return locationOf(sourceFile, binding.nameNode);
}

function isInScopeAt(
  decl: ts.VariableDeclaration,
  position: number,
  sourceFile: ts.SourceFile,
): boolean {
  const container = scopeContainer(decl);
  const start = container.getStart(sourceFile);
  const end = container.end;
  return position >= start && position <= end;
}

function scopeContainer(decl: ts.VariableDeclaration): ts.Node {
  const list = decl.parent;
  const statement = list?.parent;
  const flags =
    list && ts.isVariableDeclarationList(list) ? list.flags : 0;
  const isBlockScoped =
    (flags & ts.NodeFlags.Const) !== 0 || (flags & ts.NodeFlags.Let) !== 0;

  let current: ts.Node | undefined = statement ?? decl;
  while (current) {
    if (isBlockScoped) {
      if (
        ts.isBlock(current) ||
        ts.isModuleBlock(current) ||
        ts.isSourceFile(current) ||
        ts.isCaseClause(current) ||
        ts.isDefaultClause(current)
      ) {
        return current;
      }
    } else {
      // var: function / module / source file
      if (ts.isSourceFile(current) || ts.isModuleBlock(current)) {
        return current;
      }
      if (
        (ts.isFunctionDeclaration(current) ||
          ts.isFunctionExpression(current) ||
          ts.isArrowFunction(current) ||
          ts.isMethodDeclaration(current) ||
          ts.isConstructorDeclaration(current) ||
          ts.isGetAccessorDeclaration(current) ||
          ts.isSetAccessorDeclaration(current)) &&
        current.body
      ) {
        return current.body;
      }
    }
    current = current.parent;
  }
  return decl.getSourceFile();
}

function findReassignments(
  sourceFile: ts.SourceFile,
  byName: ReadonlyMap<string, readonly ts.VariableDeclaration[]>,
): Set<ts.VariableDeclaration> {
  const reassigned = new Set<ts.VariableDeclaration>();

  const visit = (node: ts.Node): void => {
    // x = ..., x += ...
    if (
      ts.isBinaryExpression(node) &&
      isAssignmentOperator(node.operatorToken.kind) &&
      ts.isIdentifier(node.left)
    ) {
      markWrite(node.left, sourceFile, byName, reassigned);
    }

    // ++x / x++
    if (
      (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) &&
      (node.operator === ts.SyntaxKind.PlusPlusToken ||
        node.operator === ts.SyntaxKind.MinusMinusToken) &&
      ts.isIdentifier(node.operand)
    ) {
      markWrite(node.operand, sourceFile, byName, reassigned);
    }

    // for (let x = ...; ...) — the initializer is not a reassignment
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return reassigned;
}

function markWrite(
  ident: ts.Identifier,
  sourceFile: ts.SourceFile,
  byName: ReadonlyMap<string, readonly ts.VariableDeclaration[]>,
  reassigned: Set<ts.VariableDeclaration>,
): void {
  const candidates = byName.get(ident.text);
  if (!candidates) return;
  const pos = ident.getStart(sourceFile);
  let best: ts.VariableDeclaration | undefined;
  let bestStart = -1;
  for (const decl of candidates) {
    if (!ts.isIdentifier(decl.name)) continue;
    const declStart = decl.name.getStart(sourceFile);
    if (declStart > pos) continue;
    // Writing to the declaration name in the initializer isn't reassignment
    if (ident === decl.name) continue;
    if (!isInScopeAt(decl, pos, sourceFile)) continue;
    if (declStart >= bestStart) {
      best = decl;
      bestStart = declStart;
    }
  }
  if (best) {
    const flags =
      best.parent && ts.isVariableDeclarationList(best.parent)
        ? best.parent.flags
        : 0;
    // const can't be reassigned — ignore (type error)
    if ((flags & ts.NodeFlags.Const) === 0) {
      reassigned.add(best);
    }
  }
}

function isAssignmentOperator(kind: ts.SyntaxKind): boolean {
  return (
    kind === ts.SyntaxKind.EqualsToken ||
    kind === ts.SyntaxKind.PlusEqualsToken ||
    kind === ts.SyntaxKind.MinusEqualsToken ||
    kind === ts.SyntaxKind.AsteriskEqualsToken ||
    kind === ts.SyntaxKind.SlashEqualsToken ||
    kind === ts.SyntaxKind.PercentEqualsToken ||
    kind === ts.SyntaxKind.AsteriskAsteriskEqualsToken ||
    kind === ts.SyntaxKind.AmpersandEqualsToken ||
    kind === ts.SyntaxKind.BarEqualsToken ||
    kind === ts.SyntaxKind.CaretEqualsToken ||
    kind === ts.SyntaxKind.LessThanLessThanEqualsToken ||
    kind === ts.SyntaxKind.GreaterThanGreaterThanEqualsToken ||
    kind === ts.SyntaxKind.GreaterThanGreaterThanGreaterThanEqualsToken ||
    kind === ts.SyntaxKind.BarBarEqualsToken ||
    kind === ts.SyntaxKind.AmpersandAmpersandEqualsToken ||
    kind === ts.SyntaxKind.QuestionQuestionEqualsToken
  );
}
