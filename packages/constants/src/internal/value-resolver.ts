import type { ImportResolver, ModuleGraph } from "@i18n-doctor/imports";
import ts from "typescript";
import type {
  EvaluationContext,
  EvaluationResult,
  EvaluationStep,
  SourceLocation,
  ValueResolver,
} from "../api/types.js";
import {
  findBindingAt,
  isFoldableBinding,
  type ResolvedBinding,
} from "./bindings.js";
import type { MutableConstantGraph } from "./dependency-graph.js";
import {
  locationOf,
  relativeToRoot,
  resolveAgainstRoot,
} from "./location.js";
import { asString, fail, ok, pushStep } from "./result.js";

export interface ValueResolverHost {
  readonly root: string;
  readonly maxDepth: number;
  readonly graph: MutableConstantGraph;
  readonly importResolver: ImportResolver;
  /** Mutable — updated when the evaluator rebuilds its module graph. */
  moduleGraph: ModuleGraph;
  readonly readFile: (absolutePath: string) => string | undefined;
  readonly parseFile: (
    absolutePath: string,
  ) => ts.SourceFile | undefined;
  readonly cache: Map<string, EvaluationResult>;
}

/**
 * Confidence policy (deterministic, conservative):
 * - string / no-sub template literal → 1.0
 * - pure concat / template of parts → min(parts)  (no artificial cap)
 * - const alias → min(init, 0.99)
 * - immutable let → min(init, 0.9)
 * - object / array member → min(init, 0.98)
 * - string enum member → min(init, 0.98)
 * - static conditional branch → min(branch, 0.95)
 * - imported binding → min(init, importConfidence)
 */

export function createValueResolver(host: ValueResolverHost): ValueResolver {
  return {
    resolve(filePath, expression, sourceFile, context) {
      return evaluateExpr(host, filePath, expression, sourceFile, context);
    },
  };
}

function evaluateExpr(
  host: ValueResolverHost,
  filePath: string,
  expression: ts.Expression,
  sourceFile: ts.SourceFile,
  context: EvaluationContext,
): EvaluationResult {
  if (context.depth >= host.maxDepth) {
    // Depth exhaustion is not a cycle — refuse without claiming circularity.
    return fail(locationOf(sourceFile, expression), context.chain, {
      circular: false,
      confidence: 0,
    });
  }

  const expr = unwrap(expression);
  const loc = locationOf(sourceFile, expr);
  const absFile = resolveAgainstRoot(host.root, filePath);

  if (ts.isStringLiteral(expr) || ts.isNoSubstitutionTemplateLiteral(expr)) {
    const chain = pushStep(context.chain, {
      kind: "literal",
      absolutePath: absFile,
      relativePath: relativeToRoot(host.root, absFile),
      value: expr.text,
      location: loc,
    });
    return ok(expr.text, loc, chain, 1);
  }

  // Booleans / numbers are not translation keys. Handled only via conditions.
  if (
    expr.kind === ts.SyntaxKind.TrueKeyword ||
    expr.kind === ts.SyntaxKind.FalseKeyword ||
    ts.isNumericLiteral(expr) ||
    expr.kind === ts.SyntaxKind.NullKeyword ||
    (ts.isIdentifier(expr) &&
      (expr.text === "undefined" || expr.text === "NaN" || expr.text === "Infinity"))
  ) {
    return fail(loc, pushStep(context.chain, { kind: "expression", location: loc }));
  }

  if (ts.isTemplateExpression(expr)) {
    return evaluateTemplate(host, absFile, expr, sourceFile, context);
  }

  if (
    ts.isBinaryExpression(expr) &&
    expr.operatorToken.kind === ts.SyntaxKind.PlusToken
  ) {
    return evaluateConcat(host, absFile, expr, sourceFile, context);
  }

  if (ts.isConditionalExpression(expr)) {
    return evaluateConditional(host, absFile, expr, sourceFile, context);
  }

  if (ts.isPropertyAccessExpression(expr) && ts.isIdentifier(expr.name)) {
    return evaluatePropertyAccess(host, absFile, expr, sourceFile, context);
  }

  if (ts.isElementAccessExpression(expr)) {
    return evaluateElementAccess(host, absFile, expr, sourceFile, context);
  }

  if (ts.isArrayLiteralExpression(expr)) {
    return evaluateArrayLiteral(host, absFile, expr, sourceFile, context);
  }

  if (ts.isIdentifier(expr)) {
    return evaluateIdentifier(
      host,
      absFile,
      expr.text,
      safeStart(expr, sourceFile),
      sourceFile,
      loc,
      context,
    );
  }

  return fail(loc, pushStep(context.chain, { kind: "expression", location: loc }));
}

function evaluateArrayLiteral(
  host: ValueResolverHost,
  absFile: string,
  expr: ts.ArrayLiteralExpression,
  sourceFile: ts.SourceFile,
  context: EvaluationContext,
): EvaluationResult {
  const values: string[] = [];
  let chain = context.chain;
  let confidence = 1;
  for (const element of expr.elements) {
    if (ts.isOmittedExpression(element) || ts.isSpreadElement(element)) {
      return fail(locationOf(sourceFile, expr), chain);
    }
    if (!ts.isExpression(element)) {
      return fail(locationOf(sourceFile, expr), chain);
    }
    const part = evaluateExpr(host, absFile, element, sourceFile, {
      ...context,
      depth: context.depth + 1,
      chain,
    });
    const s = asString(part.value ?? "");
    if (!part.resolved || s === undefined) {
      return fail(locationOf(sourceFile, expr), part.resolutionChain, {
        circular: part.circular,
      });
    }
    values.push(s);
    chain = part.resolutionChain;
    confidence = Math.min(confidence, part.confidence);
  }
  chain = pushStep(chain, {
    kind: "element",
    absolutePath: absFile,
    value: values,
    location: locationOf(sourceFile, expr),
  });
  return ok(values, locationOf(sourceFile, expr), chain, confidence);
}

function evaluateConcat(
  host: ValueResolverHost,
  absFile: string,
  expr: ts.BinaryExpression,
  sourceFile: ts.SourceFile,
  context: EvaluationContext,
): EvaluationResult {
  const left = evaluateExpr(host, absFile, expr.left, sourceFile, {
    ...context,
    depth: context.depth + 1,
  });
  const right = evaluateExpr(host, absFile, expr.right, sourceFile, {
    ...context,
    depth: context.depth + 1,
    chain: left.resolutionChain,
  });
  const l = asString(left.value ?? "");
  const r = asString(right.value ?? "");
  if (!left.resolved || !right.resolved || l === undefined || r === undefined) {
    return fail(locationOf(sourceFile, expr), right.resolutionChain, {
      circular: left.circular || right.circular,
    });
  }
  const value = l + r;
  const chain = pushStep(right.resolutionChain, {
    kind: "concat",
    absolutePath: absFile,
    value,
    location: locationOf(sourceFile, expr),
  });
  return ok(
    value,
    locationOf(sourceFile, expr),
    chain,
    Math.min(left.confidence, right.confidence),
  );
}

function evaluateTemplate(
  host: ValueResolverHost,
  absFile: string,
  expr: ts.TemplateExpression,
  sourceFile: ts.SourceFile,
  context: EvaluationContext,
): EvaluationResult {
  let value = expr.head.text;
  let chain = context.chain;
  let confidence = 1;
  for (const span of expr.templateSpans) {
    const part = evaluateExpr(host, absFile, span.expression, sourceFile, {
      ...context,
      depth: context.depth + 1,
      chain,
    });
    const s = asString(part.value ?? "");
    if (!part.resolved || s === undefined) {
      return fail(locationOf(sourceFile, expr), part.resolutionChain, {
        circular: part.circular,
      });
    }
    value += s + span.literal.text;
    chain = part.resolutionChain;
    confidence = Math.min(confidence, part.confidence);
  }
  chain = pushStep(chain, {
    kind: "template",
    absolutePath: absFile,
    value,
    location: locationOf(sourceFile, expr),
  });
  return ok(value, locationOf(sourceFile, expr), chain, confidence);
}

function evaluateConditional(
  host: ValueResolverHost,
  absFile: string,
  expr: ts.ConditionalExpression,
  sourceFile: ts.SourceFile,
  context: EvaluationContext,
): EvaluationResult {
  const cond = staticBoolean(expr.condition, sourceFile, host, absFile, context);
  if (cond === undefined) {
    return fail(
      locationOf(sourceFile, expr),
      pushStep(context.chain, {
        kind: "conditional",
        location: locationOf(sourceFile, expr),
        label: "unknown-condition",
      }),
    );
  }
  const branch = cond ? expr.whenTrue : expr.whenFalse;
  const result = evaluateExpr(host, absFile, branch, sourceFile, {
    ...context,
    depth: context.depth + 1,
    chain: pushStep(context.chain, {
      kind: "conditional",
      absolutePath: absFile,
      label: cond ? "then" : "else",
      location: locationOf(sourceFile, expr),
    }),
  });
  if (!result.resolved || result.value === undefined) {
    return result;
  }
  return ok(
    result.value,
    locationOf(sourceFile, expr),
    result.resolutionChain,
    Math.min(result.confidence, 0.95),
  );
}

/**
 * Evaluate a condition without treating booleans as string keys.
 * Only true/false literals and const aliases to those are accepted.
 * String `"true"` / `"false"` are NOT booleans.
 */
function staticBoolean(
  condition: ts.Expression,
  sourceFile: ts.SourceFile,
  host: ValueResolverHost,
  absFile: string,
  context: EvaluationContext,
): boolean | undefined {
  if (context.depth >= host.maxDepth) return undefined;

  const expr = unwrap(condition);
  if (expr.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (expr.kind === ts.SyntaxKind.FalseKeyword) return false;

  if (
    ts.isPrefixUnaryExpression(expr) &&
    expr.operator === ts.SyntaxKind.ExclamationToken
  ) {
    const inner = staticBoolean(
      expr.operand,
      sourceFile,
      host,
      absFile,
      { ...context, depth: context.depth + 1 },
    );
    return inner === undefined ? undefined : !inner;
  }

  if (ts.isIdentifier(expr)) {
    return resolveBooleanIdentifier(
      host,
      absFile,
      expr.text,
      safeStart(expr, sourceFile),
      sourceFile,
      { ...context, depth: context.depth + 1 },
    );
  }

  return undefined;
}

function resolveBooleanIdentifier(
  host: ValueResolverHost,
  absFile: string,
  name: string,
  position: number,
  sourceFile: ts.SourceFile,
  context: EvaluationContext,
): boolean | undefined {
  const visitKey = `bool::${absFile}::${name}`;
  if (context.visited.has(visitKey)) return undefined;

  const visited = new Set(context.visited);
  visited.add(visitKey);
  const nextCtx = { ...context, visited };

  const local = resolveLocalBinding(host, absFile, name, position, sourceFile);
  if (local && isFoldableBinding(local.binding)) {
    return staticBoolean(
      local.binding.initializer,
      local.sourceFile,
      host,
      local.filePath,
      nextCtx,
    );
  }

  const sym = host.importResolver.resolveSymbol({
    graph: host.moduleGraph,
    filePath: absFile,
    identifier: name,
    position,
  });
  if (sym.unresolved || sym.circular) return undefined;

  const declFile = sym.resolvedSourceFile;
  const declSf = host.parseFile(declFile);
  if (!declSf) return undefined;
  const localName = sym.localName ?? sym.exportedSymbol;
  const imported = resolveLocalBinding(
    host,
    declFile,
    localName,
    sym.declarationLocation.start,
    declSf,
  );
  if (!imported || !isFoldableBinding(imported.binding)) return undefined;
  return staticBoolean(
    imported.binding.initializer,
    imported.sourceFile,
    host,
    imported.filePath,
    nextCtx,
  );
}

function evaluatePropertyAccess(
  host: ValueResolverHost,
  absFile: string,
  expr: ts.PropertyAccessExpression,
  sourceFile: ts.SourceFile,
  context: EvaluationContext,
): EvaluationResult {
  const prop = expr.name.text;
  const target = unwrap(expr.expression);

  if (ts.isIdentifier(target)) {
    const enumResult = tryEvaluateEnumMember(
      host,
      absFile,
      target.text,
      prop,
      sourceFile,
      context,
    );
    if (enumResult !== undefined) {
      return enumResult;
    }

    const objectExpr = resolveObjectOrArrayInitializer(
      host,
      absFile,
      target.text,
      safeStart(target, sourceFile),
      sourceFile,
      context,
    );
    if (objectExpr && ts.isObjectLiteralExpression(objectExpr.initializer)) {
      const propAssign = findObjectProperty(objectExpr.initializer, prop);
      if (propAssign) {
        const chain = pushStep(context.chain, {
          kind: "property",
          absolutePath: objectExpr.filePath,
          relativePath: relativeToRoot(host.root, objectExpr.filePath),
          label: `${target.text}.${prop}`,
          location: locationOf(sourceFile, expr),
        });
        const result = evaluateExpr(
          host,
          objectExpr.filePath,
          propAssign,
          objectExpr.sourceFile,
          {
            depth: context.depth + 1,
            visited: context.visited,
            chain,
          },
        );
        if (!result.resolved || result.value === undefined) return result;
        return ok(
          result.value,
          locationOf(sourceFile, expr),
          result.resolutionChain,
          Math.min(result.confidence, 0.98),
        );
      }
    }
  }

  // Nested: obj.inner.prop — fold through static nested object literals.
  if (ts.isPropertyAccessExpression(target) && ts.isIdentifier(target.name)) {
    const nested = resolveNestedObjectProperty(
      host,
      absFile,
      target,
      sourceFile,
      context,
    );
    if (nested) {
      const propAssign = findObjectProperty(nested.object, prop);
      if (propAssign) {
        const chain = pushStep(context.chain, {
          kind: "property",
          absolutePath: nested.filePath,
          label: prop,
          location: locationOf(sourceFile, expr),
        });
        const result = evaluateExpr(
          host,
          nested.filePath,
          propAssign,
          nested.sourceFile,
          {
            depth: context.depth + 1,
            visited: context.visited,
            chain,
          },
        );
        if (!result.resolved || result.value === undefined) return result;
        return ok(
          result.value,
          locationOf(sourceFile, expr),
          result.resolutionChain,
          Math.min(result.confidence, 0.97),
        );
      }
    }
  }

  return fail(
    locationOf(sourceFile, expr),
    pushStep(context.chain, {
      kind: "property",
      label: prop,
      location: locationOf(sourceFile, expr),
    }),
  );
}

function evaluateElementAccess(
  host: ValueResolverHost,
  absFile: string,
  expr: ts.ElementAccessExpression,
  sourceFile: ts.SourceFile,
  context: EvaluationContext,
): EvaluationResult {
  const arg = expr.argumentExpression;
  if (!arg) {
    return fail(locationOf(sourceFile, expr), context.chain);
  }

  const target = unwrap(expr.expression);
  if (!ts.isIdentifier(target)) {
    return fail(locationOf(sourceFile, expr), context.chain);
  }

  const container = resolveObjectOrArrayInitializer(
    host,
    absFile,
    target.text,
    safeStart(target, sourceFile),
    sourceFile,
    context,
  );
  if (!container) {
    return fail(locationOf(sourceFile, expr), context.chain);
  }

  // obj["login"]
  const stringKey = staticStringKey(arg, sourceFile, host, absFile, context);
  if (stringKey !== undefined && ts.isObjectLiteralExpression(container.initializer)) {
    const propAssign = findObjectProperty(container.initializer, stringKey);
    if (propAssign) {
      const chain = pushStep(context.chain, {
        kind: "property",
        absolutePath: container.filePath,
        label: `${target.text}[${JSON.stringify(stringKey)}]`,
        location: locationOf(sourceFile, expr),
      });
      const result = evaluateExpr(
        host,
        container.filePath,
        propAssign,
        container.sourceFile,
        { depth: context.depth + 1, visited: context.visited, chain },
      );
      if (!result.resolved || result.value === undefined) return result;
      return ok(
        result.value,
        locationOf(sourceFile, expr),
        result.resolutionChain,
        Math.min(result.confidence, 0.98),
      );
    }
  }

  // arr[0] or arr[INDEX] when INDEX is a static non-negative integer
  const index = staticNonNegativeInt(arg, sourceFile, host, absFile, context);
  if (
    index !== undefined &&
    ts.isArrayLiteralExpression(container.initializer)
  ) {
    const element = container.initializer.elements[index];
    if (
      element &&
      !ts.isOmittedExpression(element) &&
      !ts.isSpreadElement(element) &&
      ts.isExpression(element)
    ) {
      const chain = pushStep(context.chain, {
        kind: "element",
        absolutePath: container.filePath,
        label: `${target.text}[${index}]`,
        location: locationOf(sourceFile, expr),
      });
      const result = evaluateExpr(
        host,
        container.filePath,
        element,
        container.sourceFile,
        { depth: context.depth + 1, visited: context.visited, chain },
      );
      if (!result.resolved || result.value === undefined) return result;
      return ok(
        result.value,
        locationOf(sourceFile, expr),
        result.resolutionChain,
        Math.min(result.confidence, 0.98),
      );
    }
  }

  return fail(locationOf(sourceFile, expr), context.chain);
}

function evaluateIdentifier(
  host: ValueResolverHost,
  absFile: string,
  name: string,
  position: number,
  sourceFile: ts.SourceFile,
  useLocation: SourceLocation,
  context: EvaluationContext,
): EvaluationResult {
  const visitKey = `${absFile}::${name}`;
  if (context.visited.has(visitKey)) {
    return fail(
      useLocation,
      pushStep(context.chain, { kind: "identifier", label: name }),
      { circular: true },
    );
  }

  // Cache by declaration identity when known; else by name@file.
  const localPreview = resolveLocalBinding(
    host,
    absFile,
    name,
    position,
    sourceFile,
  );
  const cacheKey = localPreview
    ? `${absFile}::${name}@${localPreview.binding.nameNode.getStart(sourceFile)}`
    : `${visitKey}@eval`;

  const cached = host.cache.get(cacheKey);
  if (cached) {
    if (context.chain.length === 0) {
      return cached;
    }
    if (cached.resolved && cached.value !== undefined) {
      return ok(
        cached.value,
        cached.sourceLocation,
        mergeChains(context.chain, cached.resolutionChain),
        cached.confidence,
      );
    }
    return fail(
      cached.sourceLocation,
      mergeChains(context.chain, cached.resolutionChain),
      { circular: cached.circular, confidence: cached.confidence },
    );
  }

  const visited = new Set(context.visited);
  visited.add(visitKey);

  const chain = pushStep(context.chain, {
    kind: "identifier",
    absolutePath: absFile,
    relativePath: relativeToRoot(host.root, absFile),
    label: name,
    location: useLocation,
  });

  if (localPreview) {
    if (!isFoldableBinding(localPreview.binding)) {
      const failed = fail(
        useLocation,
        pushStep(chain, {
          kind: "declaration",
          absolutePath: absFile,
          label: localPreview.binding.reassigned
            ? `${name}:reassigned`
            : `${name}:mutable`,
          location: locationOf(
            localPreview.sourceFile,
            localPreview.binding.nameNode,
          ),
        }),
      );
      host.cache.set(cacheKey, failed);
      return failed;
    }

    const deps = collectDirectDeps(localPreview.binding.initializer);
    host.graph.set({
      name,
      absolutePath: absFile,
      relativePath: relativeToRoot(host.root, absFile),
      location: locationOf(
        localPreview.sourceFile,
        localPreview.binding.nameNode,
      ),
      dependsOn: deps,
    });

    const confidenceCap = localPreview.binding.isConst ? 0.99 : 0.9;
    const result = evaluateExpr(
      host,
      localPreview.filePath,
      localPreview.binding.initializer,
      localPreview.sourceFile,
      {
        depth: context.depth + 1,
        visited,
        chain: pushStep(chain, {
          kind: "declaration",
          absolutePath: localPreview.filePath,
          relativePath: relativeToRoot(host.root, localPreview.filePath),
          label: name,
          location: locationOf(
            localPreview.sourceFile,
            localPreview.binding.nameNode,
          ),
        }),
      },
    );

    const adjusted =
      result.resolved && result.value !== undefined
        ? ok(
            result.value,
            result.sourceLocation,
            result.resolutionChain,
            Math.min(result.confidence, confidenceCap),
          )
        : result;
    host.cache.set(cacheKey, adjusted);
    return adjusted;
  }

  // Cross-file via import resolver
  const sym = host.importResolver.resolveSymbol({
    graph: host.moduleGraph,
    filePath: absFile,
    identifier: name,
    position,
  });

  if (!sym.unresolved && !sym.circular) {
    const declFile = sym.resolvedSourceFile;
    const declSf = host.parseFile(declFile);
    if (declSf) {
      const localName = sym.localName ?? sym.exportedSymbol;
      const imported = resolveLocalBinding(
        host,
        declFile,
        localName,
        sym.declarationLocation.start,
        declSf,
      );
      if (imported && isFoldableBinding(imported.binding)) {
        const importChain = pushStep(chain, {
          kind: "import",
          absolutePath: declFile,
          relativePath: sym.resolvedRelativePath,
          label: name,
          location: sym.declarationLocation,
        });
        host.graph.set({
          name,
          absolutePath: absFile,
          relativePath: relativeToRoot(host.root, absFile),
          location: useLocation,
          dependsOn: [`${sym.resolvedRelativePath}::${localName}`],
        });
        const result = evaluateExpr(
          host,
          imported.filePath,
          imported.binding.initializer,
          imported.sourceFile,
          {
            depth: context.depth + 1,
            visited,
            chain: pushStep(importChain, {
              kind: "declaration",
              absolutePath: imported.filePath,
              relativePath: relativeToRoot(host.root, imported.filePath),
              label: localName,
              location: locationOf(
                imported.sourceFile,
                imported.binding.nameNode,
              ),
            }),
          },
        );
        const adjusted =
          result.resolved && result.value !== undefined
            ? ok(
                result.value,
                result.sourceLocation,
                result.resolutionChain,
                Math.min(result.confidence, sym.confidence),
              )
            : result;
        host.cache.set(cacheKey, adjusted);
        return adjusted;
      }

      // export default "literal"
      if (sym.exportedSymbol === "default") {
        const defaultLit = findDefaultExportLiteral(declSf);
        if (defaultLit) {
          const result = evaluateExpr(host, declFile, defaultLit, declSf, {
            depth: context.depth + 1,
            visited,
            chain: pushStep(chain, {
              kind: "import",
              absolutePath: declFile,
              relativePath: sym.resolvedRelativePath,
              label: "default",
            }),
          });
          const adjusted =
            result.resolved && result.value !== undefined
              ? ok(
                  result.value,
                  result.sourceLocation,
                  result.resolutionChain,
                  Math.min(result.confidence, sym.confidence),
                )
              : result;
          host.cache.set(cacheKey, adjusted);
          return adjusted;
        }
      }
    }
  }

  if (sym.circular) {
    return fail(useLocation, chain, { circular: true });
  }

  const failed = fail(useLocation, chain);
  host.cache.set(cacheKey, failed);
  return failed;
}

function tryEvaluateEnumMember(
  host: ValueResolverHost,
  absFile: string,
  enumName: string,
  memberName: string,
  sourceFile: ts.SourceFile,
  context: EvaluationContext,
): EvaluationResult | undefined {
  for (const stmt of sourceFile.statements) {
    if (!ts.isEnumDeclaration(stmt) || stmt.name.text !== enumName) {
      continue;
    }
    for (const member of stmt.members) {
      const name = enumMemberName(member);
      if (name !== memberName) continue;
      if (member.initializer) {
        const chain = pushStep(context.chain, {
          kind: "enum",
          absolutePath: absFile,
          label: `${enumName}.${memberName}`,
          location: locationOf(sourceFile, member),
        });
        const result = evaluateExpr(
          host,
          absFile,
          member.initializer,
          sourceFile,
          {
            depth: context.depth + 1,
            visited: context.visited,
            chain,
          },
        );
        if (!result.resolved || result.value === undefined) return result;
        return ok(
          result.value,
          locationOf(sourceFile, member),
          result.resolutionChain,
          Math.min(result.confidence, 0.98),
        );
      }
      // Ambient / auto numeric enums — not string keys
      return fail(locationOf(sourceFile, member), context.chain);
    }
    // Enum exists but member missing
    return fail(locationOf(sourceFile, stmt), context.chain);
  }

  const sym = host.importResolver.resolveSymbol({
    graph: host.moduleGraph,
    filePath: absFile,
    identifier: enumName,
  });
  if (sym.unresolved || sym.circular) {
    return undefined;
  }

  const nextFile = sym.resolvedSourceFile;
  const nextName = sym.localName ?? enumName;
  if (nextFile === absFile && nextName === enumName) {
    return undefined;
  }

  const declSf = host.parseFile(nextFile);
  if (!declSf) return undefined;

  const hasEnum = declSf.statements.some(
    (stmt) => ts.isEnumDeclaration(stmt) && stmt.name.text === nextName,
  );
  if (!hasEnum) {
    return undefined;
  }

  return tryEvaluateEnumMember(host, nextFile, nextName, memberName, declSf, {
    ...context,
    depth: context.depth + 1,
    chain: pushStep(context.chain, {
      kind: "import",
      absolutePath: nextFile,
      relativePath: sym.resolvedRelativePath,
      label: enumName,
    }),
  });
}

// ── Binding / initializer helpers ───────────────────────────────────────────

interface BindingSite {
  readonly filePath: string;
  readonly sourceFile: ts.SourceFile;
  readonly binding: ResolvedBinding;
}

function resolveLocalBinding(
  _host: ValueResolverHost,
  absFile: string,
  name: string,
  position: number,
  sourceFile: ts.SourceFile,
): BindingSite | undefined {
  const binding = findBindingAt(sourceFile, name, position);
  if (!binding) return undefined;
  return { filePath: absFile, sourceFile, binding };
}

interface InitializerSite {
  readonly filePath: string;
  readonly sourceFile: ts.SourceFile;
  readonly initializer: ts.Expression;
}

function resolveObjectOrArrayInitializer(
  host: ValueResolverHost,
  absFile: string,
  name: string,
  position: number,
  sourceFile: ts.SourceFile,
  context: EvaluationContext,
): InitializerSite | undefined {
  const local = resolveLocalBinding(host, absFile, name, position, sourceFile);
  if (local && isFoldableBinding(local.binding)) {
    const init = unwrap(local.binding.initializer);
    if (
      ts.isObjectLiteralExpression(init) ||
      ts.isArrayLiteralExpression(init)
    ) {
      return {
        filePath: local.filePath,
        sourceFile: local.sourceFile,
        initializer: init,
      };
    }
    // const keys = OTHER; follow alias to object/array
    if (ts.isIdentifier(init)) {
      if (context.depth + 1 >= host.maxDepth) return undefined;
      return resolveObjectOrArrayInitializer(
        host,
        local.filePath,
        init.text,
        safeStart(init, local.sourceFile),
        local.sourceFile,
        { ...context, depth: context.depth + 1 },
      );
    }
  }

  const sym = host.importResolver.resolveSymbol({
    graph: host.moduleGraph,
    filePath: absFile,
    identifier: name,
    position,
  });
  if (sym.unresolved || sym.circular) return undefined;

  const declFile = sym.resolvedSourceFile;
  const declSf = host.parseFile(declFile);
  if (!declSf) return undefined;
  const localName = sym.localName ?? sym.exportedSymbol;
  const imported = resolveLocalBinding(
    host,
    declFile,
    localName,
    sym.declarationLocation.start,
    declSf,
  );
  if (!imported || !isFoldableBinding(imported.binding)) return undefined;
  const init = unwrap(imported.binding.initializer);
  if (
    ts.isObjectLiteralExpression(init) ||
    ts.isArrayLiteralExpression(init)
  ) {
    return {
      filePath: imported.filePath,
      sourceFile: imported.sourceFile,
      initializer: init,
    };
  }
  if (ts.isIdentifier(init)) {
    if (context.depth + 1 >= host.maxDepth) return undefined;
    return resolveObjectOrArrayInitializer(
      host,
      imported.filePath,
      init.text,
      safeStart(init, imported.sourceFile),
      imported.sourceFile,
      { ...context, depth: context.depth + 1 },
    );
  }
  return undefined;
}

function resolveNestedObjectProperty(
  host: ValueResolverHost,
  absFile: string,
  expr: ts.PropertyAccessExpression,
  sourceFile: ts.SourceFile,
  context: EvaluationContext,
):
  | {
      filePath: string;
      sourceFile: ts.SourceFile;
      object: ts.ObjectLiteralExpression;
    }
  | undefined {
  const prop = expr.name.text;
  const target = unwrap(expr.expression);
  if (!ts.isIdentifier(target)) return undefined;
  const objectExpr = resolveObjectOrArrayInitializer(
    host,
    absFile,
    target.text,
    safeStart(target, sourceFile),
    sourceFile,
    context,
  );
  if (!objectExpr || !ts.isObjectLiteralExpression(objectExpr.initializer)) {
    return undefined;
  }
  const inner = findObjectProperty(objectExpr.initializer, prop);
  if (!inner) return undefined;
  const unwrapped = unwrap(inner);
  if (!ts.isObjectLiteralExpression(unwrapped)) return undefined;
  return {
    filePath: objectExpr.filePath,
    sourceFile: objectExpr.sourceFile,
    object: unwrapped,
  };
}

function staticStringKey(
  arg: ts.Expression,
  sourceFile: ts.SourceFile,
  host: ValueResolverHost,
  absFile: string,
  context: EvaluationContext,
): string | undefined {
  const expr = unwrap(arg);
  if (ts.isStringLiteral(expr) || ts.isNoSubstitutionTemplateLiteral(expr)) {
    return expr.text;
  }
  if (ts.isIdentifier(expr)) {
    const result = evaluateIdentifier(
      host,
      absFile,
      expr.text,
      safeStart(expr, sourceFile),
      sourceFile,
      locationOf(sourceFile, expr),
      { ...context, depth: context.depth + 1 },
    );
    return result.resolved ? asString(result.value ?? "") : undefined;
  }
  return undefined;
}

function staticNonNegativeInt(
  arg: ts.Expression,
  sourceFile: ts.SourceFile,
  host: ValueResolverHost,
  absFile: string,
  context: EvaluationContext,
): number | undefined {
  const expr = unwrap(arg);
  if (ts.isNumericLiteral(expr)) {
    const n = Number(expr.text);
    return Number.isInteger(n) && n >= 0 ? n : undefined;
  }
  // const INDEX = 0;
  if (ts.isIdentifier(expr)) {
    const binding = resolveLocalBinding(
      host,
      absFile,
      expr.text,
      safeStart(expr, sourceFile),
      sourceFile,
    );
    if (binding && isFoldableBinding(binding.binding)) {
      const init = unwrap(binding.binding.initializer);
      if (ts.isNumericLiteral(init)) {
        const n = Number(init.text);
        return Number.isInteger(n) && n >= 0 ? n : undefined;
      }
    }
  }
  return undefined;
}

function findObjectProperty(
  object: ts.ObjectLiteralExpression,
  prop: string,
): ts.Expression | undefined {
  // Last assignment wins (matches JS object literal semantics).
  let found: ts.Expression | undefined;
  for (const p of object.properties) {
    if (ts.isSpreadAssignment(p)) {
      // Spread makes the object non-static for our purposes.
      return undefined;
    }
    if (!ts.isPropertyAssignment(p)) continue;
    const name = propertyNameText(p.name);
    if (name === prop) {
      found = p.initializer;
    }
  }
  return found;
}

function propertyNameText(name: ts.PropertyName): string | undefined {
  if (
    ts.isIdentifier(name) ||
    ts.isStringLiteral(name) ||
    ts.isNumericLiteral(name)
  ) {
    return name.text;
  }
  return undefined;
}

function enumMemberName(member: ts.EnumMember): string | undefined {
  if (ts.isIdentifier(member.name) || ts.isStringLiteral(member.name)) {
    return member.name.text;
  }
  return undefined;
}

function findDefaultExportLiteral(
  sourceFile: ts.SourceFile,
): ts.Expression | undefined {
  for (const stmt of sourceFile.statements) {
    if (ts.isExportAssignment(stmt) && !stmt.isExportEquals) {
      return stmt.expression;
    }
  }
  return undefined;
}

function collectDirectDeps(initializer: ts.Expression): string[] {
  const deps: string[] = [];
  const expr = unwrap(initializer);
  if (ts.isIdentifier(expr)) {
    deps.push(expr.text);
  } else if (
    ts.isPropertyAccessExpression(expr) &&
    ts.isIdentifier(expr.expression)
  ) {
    deps.push(expr.expression.text);
  } else if (
    ts.isElementAccessExpression(expr) &&
    ts.isIdentifier(expr.expression)
  ) {
    deps.push(expr.expression.text);
  }
  return deps;
}

/**
 * Avoid duplicating a prefix already present when composing cached chains.
 */
function mergeChains(
  prefix: readonly EvaluationStep[],
  cached: readonly EvaluationStep[],
): EvaluationStep[] {
  if (prefix.length === 0) return [...cached];
  return [...prefix, ...cached];
}

function safeStart(node: ts.Node, sourceFile: ts.SourceFile): number {
  try {
    return node.getStart(sourceFile);
  } catch {
    return sourceFile.end;
  }
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
