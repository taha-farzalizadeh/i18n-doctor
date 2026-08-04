import type { ConstantEvaluator } from "@i18n-doctor/constants";
import type { ImportResolver, ModuleGraph } from "@i18n-doctor/imports";
import ts from "typescript";
import type {
  AnalysisType,
  DynamicExpressionEvaluator,
  DynamicKeyAnalysis,
  EvaluationContext,
  PossibleValueSet,
  ResolutionStep,
  SourceLocation,
} from "../api/types.js";
import {
  locationOf,
  relativeToRoot,
  resolveAgainstRoot,
} from "./location.js";
import { isUserInputExpression } from "./heuristics.js";
import type { MutablePropagationGraph } from "./propagation-graph.js";
import {
  concatSets,
  emptySet,
  fromValues,
  pushStep,
  singleton,
  toAnalysis,
  unionSets,
} from "./possible-set.js";

export interface EvaluatorHost {
  readonly root: string;
  readonly maxDepth: number;
  readonly maxValues: number;
  readonly constants: ConstantEvaluator;
  readonly importResolver: ImportResolver;
  moduleGraph: ModuleGraph;
  readonly graph: MutablePropagationGraph;
  readonly readFile: (absolutePath: string) => string | undefined;
  readonly parseFile: (absolutePath: string) => ts.SourceFile | undefined;
  readonly cache: Map<string, DynamicKeyAnalysis>;
  /** Collected call-site arg sets: `absPath::fnName::paramName` → values */
  readonly paramFlow: Map<string, PossibleValueSet>;
}

export function createDynamicEvaluator(
  host: EvaluatorHost,
): DynamicExpressionEvaluator {
  return {
    evaluate(filePath, expression, sourceFile, context) {
      return evaluateExpr(host, filePath, expression, sourceFile, context);
    },
  };
}

function evaluateExpr(
  host: EvaluatorHost,
  filePath: string,
  expression: ts.Expression,
  sourceFile: ts.SourceFile,
  context: EvaluationContext,
): DynamicKeyAnalysis {
  if (context.depth >= host.maxDepth) {
    return unresolved(
      locationOf(sourceFile, expression),
      context.chain,
      false,
    );
  }

  const absFile = resolveAgainstRoot(host.root, filePath);
  const expr = unwrap(expression);
  const loc = locationOf(sourceFile, expr);

  // Never invent keys from user / runtime input.
  if (isUserInputExpression(expr)) {
    return unresolved(
      loc,
      pushStep(context.chain, {
        kind: "expression",
        label: "user-input",
        location: loc,
      }),
      true,
    );
  }

  // Fast path: precise constant fold when no param env influence
  if (context.paramEnv.size === 0) {
    const folded = tryConstantFold(host, absFile, expr, sourceFile, loc, context);
    if (folded) return folded;
  }

  if (ts.isStringLiteral(expr) || ts.isNoSubstitutionTemplateLiteral(expr)) {
    const chain = pushStep(context.chain, {
      kind: "literal",
      absolutePath: absFile,
      relativePath: relativeToRoot(host.root, absFile),
      values: [expr.text],
      location: loc,
    });
    return toAnalysis(singleton(expr.text, 1), [loc], chain, "literal");
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

  return unresolved(loc, pushStep(context.chain, { kind: "expression", location: loc }));
}

function tryConstantFold(
  host: EvaluatorHost,
  absFile: string,
  expr: ts.Expression,
  sourceFile: ts.SourceFile,
  loc: SourceLocation,
  context: EvaluationContext,
): DynamicKeyAnalysis | undefined {
  // Identifiers go through evaluateIdentifier (variable / parameter typing).
  if (ts.isIdentifier(expr)) {
    return undefined;
  }
  // Skip forms that constants refuse but we handle multi-value (unknown cond).
  if (ts.isConditionalExpression(expr)) {
    return undefined;
  }
  if (ts.isElementAccessExpression(expr)) {
    const arg = expr.argumentExpression;
    if (
      arg &&
      !ts.isStringLiteral(arg) &&
      !ts.isNoSubstitutionTemplateLiteral(arg) &&
      !ts.isNumericLiteral(arg)
    ) {
      return undefined; // dynamic index — our path
    }
  }

  const result = host.constants.evaluateExpression({
    filePath: absFile,
    sourceFile,
    expression: expr,
  });
  if (!result.resolved || result.value === undefined) {
    return undefined;
  }
  const values = Array.isArray(result.value) ? result.value : [result.value];
  const stringValues = values.filter((v): v is string => typeof v === "string");
  if (stringValues.length === 0) return undefined;

  const chain = pushStep(context.chain, {
    kind: "literal",
    absolutePath: absFile,
    label: "constant-fold",
    values: stringValues,
    location: loc,
  });
  return toAnalysis(
    fromValues(stringValues, {
      confidence: result.confidence,
      circular: result.circular,
      maxValues: host.maxValues,
    }),
    [loc, result.sourceLocation],
    chain,
    "constant",
  );
}

function evaluateConcat(
  host: EvaluatorHost,
  absFile: string,
  expr: ts.BinaryExpression,
  sourceFile: ts.SourceFile,
  context: EvaluationContext,
): DynamicKeyAnalysis {
  const left = evaluateExpr(host, absFile, expr.left, sourceFile, {
    ...context,
    depth: context.depth + 1,
  });
  const right = evaluateExpr(host, absFile, expr.right, sourceFile, {
    ...context,
    depth: context.depth + 1,
    chain: left.resolutionChain,
  });
  // Mixed static/dynamic: do not invent keys when a side is unresolved.
  if (!left.resolved || !right.resolved) {
    return unresolved(
      locationOf(sourceFile, expr),
      pushStep(right.resolutionChain, {
        kind: "concat",
        label: "mixed-dynamic",
        location: locationOf(sourceFile, expr),
      }),
      true,
    );
  }
  const set = concatSets(toSet(left), toSet(right), host.maxValues);
  const chain = pushStep(right.resolutionChain, {
    kind: "concat",
    absolutePath: absFile,
    values: set.values,
    location: locationOf(sourceFile, expr),
  });
  return toAnalysis(
    set,
    uniqueLocs([
      ...left.sourceLocations,
      ...right.sourceLocations,
      locationOf(sourceFile, expr),
    ]),
    chain,
    "concat",
  );
}

function evaluateTemplate(
  host: EvaluatorHost,
  absFile: string,
  expr: ts.TemplateExpression,
  sourceFile: ts.SourceFile,
  context: EvaluationContext,
): DynamicKeyAnalysis {
  let set = singleton(expr.head.text, 1);
  let chain = context.chain;
  const locs: SourceLocation[] = [locationOf(sourceFile, expr)];

  for (const span of expr.templateSpans) {
    const part = evaluateExpr(host, absFile, span.expression, sourceFile, {
      ...context,
      depth: context.depth + 1,
      chain,
    });
    locs.push(...part.sourceLocations);
    if (!part.resolved) {
      return unresolved(
        locationOf(sourceFile, expr),
        pushStep(part.resolutionChain, {
          kind: "template",
          label: "mixed-dynamic",
          location: locationOf(sourceFile, expr),
        }),
        true,
      );
    }
    set = concatSets(set, toSet(part), host.maxValues);
    set = concatSets(set, singleton(span.literal.text, 1), host.maxValues);
    chain = part.resolutionChain;
  }

  chain = pushStep(chain, {
    kind: "template",
    absolutePath: absFile,
    values: set.values,
    location: locationOf(sourceFile, expr),
  });
  return toAnalysis(set, uniqueLocs(locs), chain, "template");
}

function evaluateConditional(
  host: EvaluatorHost,
  absFile: string,
  expr: ts.ConditionalExpression,
  sourceFile: ts.SourceFile,
  context: EvaluationContext,
): DynamicKeyAnalysis {
  const cond = staticBoolean(host, absFile, expr.condition, sourceFile, context);
  const chainBase = pushStep(context.chain, {
    kind: "conditional",
    absolutePath: absFile,
    label: cond === undefined ? "unknown" : cond ? "then" : "else",
    location: locationOf(sourceFile, expr),
  });

  if (cond === true) {
    const thenR = evaluateExpr(host, absFile, expr.whenTrue, sourceFile, {
      ...context,
      depth: context.depth + 1,
      chain: chainBase,
    });
    return {
      ...thenR,
      analysisType: "conditional",
      confidence: Math.min(thenR.confidence, 0.95),
    };
  }
  if (cond === false) {
    const elseR = evaluateExpr(host, absFile, expr.whenFalse, sourceFile, {
      ...context,
      depth: context.depth + 1,
      chain: chainBase,
    });
    return {
      ...elseR,
      analysisType: "conditional",
      confidence: Math.min(elseR.confidence, 0.95),
    };
  }

  // Unknown condition — union both branches (conservative).
  const thenR = evaluateExpr(host, absFile, expr.whenTrue, sourceFile, {
    ...context,
    depth: context.depth + 1,
    chain: chainBase,
  });
  const elseR = evaluateExpr(host, absFile, expr.whenFalse, sourceFile, {
    ...context,
    depth: context.depth + 1,
    chain: thenR.resolutionChain,
  });
  const set = unionSets([toSet(thenR), toSet(elseR)], host.maxValues);
  const lowered = fromValues(set.values, {
    incomplete: set.incomplete || !thenR.resolved || !elseR.resolved,
    confidence: Math.min(set.confidence, 0.7),
    circular: set.circular,
    maxValues: host.maxValues,
  });
  const chain = pushStep(elseR.resolutionChain, {
    kind: "union",
    absolutePath: absFile,
    values: lowered.values,
    location: locationOf(sourceFile, expr),
  });
  return toAnalysis(
    lowered,
    uniqueLocs([
      ...thenR.sourceLocations,
      ...elseR.sourceLocations,
      locationOf(sourceFile, expr),
    ]),
    chain,
    "conditional",
  );
}

function evaluatePropertyAccess(
  host: EvaluatorHost,
  absFile: string,
  expr: ts.PropertyAccessExpression,
  sourceFile: ts.SourceFile,
  context: EvaluationContext,
): DynamicKeyAnalysis {
  // Reuse constant evaluator for obj.prop when static
  const folded = tryConstantFold(
    host,
    absFile,
    expr,
    sourceFile,
    locationOf(sourceFile, expr),
    context,
  );
  if (folded) {
    return { ...folded, analysisType: "object-lookup" };
  }
  return unresolved(
    locationOf(sourceFile, expr),
    pushStep(context.chain, {
      kind: "property",
      label: expr.name.text,
      location: locationOf(sourceFile, expr),
    }),
  );
}

function evaluateElementAccess(
  host: EvaluatorHost,
  absFile: string,
  expr: ts.ElementAccessExpression,
  sourceFile: ts.SourceFile,
  context: EvaluationContext,
): DynamicKeyAnalysis {
  const loc = locationOf(sourceFile, expr);
  const arg = expr.argumentExpression;
  if (!arg) {
    return unresolved(loc, context.chain);
  }

  const target = unwrap(expr.expression);
  if (!ts.isIdentifier(target)) {
    // Precise fold for non-identifier bases when possible
    const folded = tryConstantFold(host, absFile, expr, sourceFile, loc, context);
    if (folded) return { ...folded, analysisType: "object-lookup" };
    return unresolved(loc, context.chain);
  }

  const init = findInitializer(
    host,
    absFile,
    target.text,
    safeStart(target, sourceFile),
    sourceFile,
  );
  if (!init) {
    const folded = tryConstantFold(host, absFile, expr, sourceFile, loc, context);
    if (folded) return { ...folded, analysisType: "object-lookup" };
    return unresolved(loc, context.chain);
  }

  // Prefer precise constant fold when index is a static literal
  if (
    ts.isStringLiteral(arg) ||
    ts.isNoSubstitutionTemplateLiteral(arg) ||
    ts.isNumericLiteral(arg)
  ) {
    const folded = tryConstantFold(host, absFile, expr, sourceFile, loc, context);
    if (folded) {
      const analysisType: AnalysisType = ts.isArrayLiteralExpression(
        init.initializer,
      )
        ? "array-lookup"
        : "object-lookup";
      return { ...folded, analysisType };
    }
  }

  if (isUserInputExpression(arg)) {
    return unresolved(
      loc,
      pushStep(context.chain, {
        kind: "lookup",
        label: "user-input-index",
        location: loc,
      }),
      true,
    );
  }

  const indexSet = evaluateExpr(host, absFile, arg, sourceFile, {
    ...context,
    depth: context.depth + 1,
  });

  // Object literal: keys[name]
  if (ts.isObjectLiteralExpression(init.initializer)) {
    const props = staticObjectStringProps(init.initializer, host.maxValues);
    if (props === undefined) {
      // Spread / non-static / huge → refuse rather than explode
      return unresolved(loc, context.chain, true);
    }
    if (props.size === 0) {
      return unresolved(loc, context.chain, true);
    }

    if (indexSet.resolved && indexSet.possibleKeys.length > 0) {
      const values: string[] = [];
      for (const key of indexSet.possibleKeys) {
        const v = props.get(key);
        if (v !== undefined) values.push(v);
      }
      const missing = indexSet.possibleKeys.some((k) => !props.has(k));
      const set = fromValues(values, {
        incomplete: missing || indexSet.incomplete,
        confidence: Math.min(indexSet.confidence, missing ? 0.6 : 0.8),
        maxValues: host.maxValues,
      });
      const chain = pushStep(indexSet.resolutionChain, {
        kind: "lookup",
        absolutePath: absFile,
        label: `${target.text}[...]`,
        values: set.values,
        location: loc,
      });
      return toAnalysis(
        set,
        uniqueLocs([loc, ...indexSet.sourceLocations]),
        chain,
        "object-lookup",
      );
    }

    // Unknown index — widen to all static values (capped), low confidence
    const values = [...props.values()];
    const set = fromValues(values, {
      incomplete: true,
      confidence: values.length > host.maxValues ? 0.4 : 0.5,
      maxValues: host.maxValues,
    });
    const chain = pushStep(context.chain, {
      kind: "lookup",
      absolutePath: absFile,
      label: `${target.text}[*]`,
      values: set.values,
      location: loc,
    });
    return toAnalysis(set, [loc], chain, "object-lookup");
  }

  // Array literal: keys[index]
  if (ts.isArrayLiteralExpression(init.initializer)) {
    const elements = staticArrayStringElements(
      init.initializer,
      host.maxValues,
    );
    if (elements === undefined) {
      return unresolved(loc, context.chain, true);
    }
    if (elements.length === 0) {
      return unresolved(loc, context.chain, true);
    }

    if (indexSet.resolved && indexSet.possibleKeys.length > 0) {
      const values: string[] = [];
      for (const k of indexSet.possibleKeys) {
        const n = Number(k);
        if (Number.isInteger(n) && n >= 0 && n < elements.length) {
          const v = elements[n];
          if (v !== undefined) values.push(v);
        }
      }
      const set = fromValues(values, {
        incomplete: indexSet.incomplete || values.length === 0,
        confidence: Math.min(indexSet.confidence, 0.8),
        maxValues: host.maxValues,
      });
      const chain = pushStep(indexSet.resolutionChain, {
        kind: "lookup",
        absolutePath: absFile,
        label: `${target.text}[i]`,
        values: set.values,
        location: loc,
      });
      return toAnalysis(
        set,
        uniqueLocs([loc, ...indexSet.sourceLocations]),
        chain,
        "array-lookup",
      );
    }

    const set = fromValues(elements, {
      incomplete: true,
      confidence: elements.length > host.maxValues ? 0.4 : 0.5,
      maxValues: host.maxValues,
    });
    const chain = pushStep(context.chain, {
      kind: "lookup",
      absolutePath: absFile,
      label: `${target.text}[*]`,
      values: set.values,
      location: loc,
    });
    return toAnalysis(set, [loc], chain, "array-lookup");
  }

  return unresolved(loc, context.chain);
}

function evaluateIdentifier(
  host: EvaluatorHost,
  absFile: string,
  name: string,
  position: number,
  sourceFile: ts.SourceFile,
  useLocation: SourceLocation,
  context: EvaluationContext,
): DynamicKeyAnalysis {
  // Cycle by name (coarser) for param/binding loops
  const cycleKey = `${absFile}::${name}`;
  if (context.visited.has(cycleKey)) {
    return toAnalysis(
      fromValues([], { circular: true, confidence: 0, incomplete: true }),
      [useLocation],
      pushStep(context.chain, { kind: "cycle", label: name }),
      "unresolved",
    );
  }

  // Parameter environment (interprocedural / local)
  const param = context.paramEnv.get(name);
  if (param && param.values.length > 0) {
    const chain = pushStep(context.chain, {
      kind: "parameter",
      absolutePath: absFile,
      label: name,
      values: param.values,
      location: useLocation,
    });
    return toAnalysis(
      fromValues(param.values, {
        confidence: Math.min(param.confidence, 0.9),
        incomplete: param.incomplete,
        circular: param.circular,
        maxValues: host.maxValues,
      }),
      [useLocation],
      chain,
      "parameter",
    );
  }

  // Collected param-flow from call sites of enclosing function
  const flowKey = findParamFlowKey(host, absFile, name, position, sourceFile);
  if (flowKey) {
    const flowed = host.paramFlow.get(flowKey);
    if (flowed && flowed.values.length > 0) {
      const chain = pushStep(context.chain, {
        kind: "parameter",
        absolutePath: absFile,
        label: name,
        values: flowed.values,
        location: useLocation,
      });
      return toAnalysis(
        fromValues(flowed.values, {
          confidence: Math.min(flowed.confidence, 0.85),
          incomplete: flowed.incomplete,
          maxValues: host.maxValues,
        }),
        [useLocation],
        chain,
        "parameter",
      );
    }
  }

  const cacheKey = `${cycleKey}@df`;
  const cached = host.cache.get(cacheKey);
  if (cached && context.chain.length === 0 && context.paramEnv.size === 0) {
    return cached;
  }

  const visited = new Set(context.visited);
  visited.add(cycleKey);

  const init = findInitializer(host, absFile, name, position, sourceFile);
  if (init) {
    const chain = pushStep(context.chain, {
      kind: "identifier",
      absolutePath: absFile,
      relativePath: relativeToRoot(host.root, absFile),
      label: name,
      location: useLocation,
    });
    const result = evaluateExpr(
      host,
      init.filePath,
      init.initializer,
      init.sourceFile,
      {
        depth: context.depth + 1,
        visited,
        chain: pushStep(chain, {
          kind: "declaration",
          absolutePath: init.filePath,
          label: name,
          location: locationOf(init.sourceFile, init.nameNode),
        }),
        paramEnv: context.paramEnv,
      },
    );
    const analysis: DynamicKeyAnalysis = {
      ...result,
      analysisType: result.resolved ? "variable" : "unresolved",
    };

    host.graph.set({
      id: cacheKey,
      name,
      absolutePath: absFile,
      relativePath: relativeToRoot(host.root, absFile),
      location: locationOf(init.sourceFile, init.nameNode),
      values: analysis.possibleKeys,
      dependsOn: (() => {
        const u = unwrap(init.initializer);
        return ts.isIdentifier(u) ? [u.text] : [];
      })(),
      analysisType: analysis.analysisType,
    });

    if (context.paramEnv.size === 0) {
      host.cache.set(cacheKey, analysis);
    }
    return analysis;
  }

  // Import follow via constants identifier eval
  const constResult = host.constants.evaluateIdentifier({
    filePath: absFile,
    sourceFile,
    name,
    position,
  });
  if (constResult.resolved && typeof constResult.value === "string") {
    const chain = pushStep(context.chain, {
      kind: "import",
      label: name,
      values: [constResult.value],
      location: useLocation,
    });
    const analysis = toAnalysis(
      singleton(constResult.value, Math.min(constResult.confidence, 0.92)),
      [useLocation, constResult.sourceLocation],
      chain,
      "variable",
    );
    host.cache.set(cacheKey, analysis);
    return analysis;
  }

  return unresolved(
    useLocation,
    pushStep(context.chain, {
      kind: "identifier",
      label: name,
      location: useLocation,
    }),
  );
}

// ── helpers ─────────────────────────────────────────────────────────────────

function findParamFlowKey(
  host: EvaluatorHost,
  absFile: string,
  paramName: string,
  position: number,
  sourceFile: ts.SourceFile,
): string | undefined {
  const fn = enclosingFunction(sourceFile, position);
  if (!fn) return undefined;
  const fnName = functionName(fn);
  if (!fnName) return undefined;
  const params = fn.parameters;
  const match = params.find(
    (p) => ts.isIdentifier(p.name) && p.name.text === paramName,
  );
  if (!match) return undefined;
  return `${absFile}::${fnName}::${paramName}`;
}

function enclosingFunction(
  sourceFile: ts.SourceFile,
  position: number,
): ts.FunctionLikeDeclaration | undefined {
  let best: ts.FunctionLikeDeclaration | undefined;
  const visit = (node: ts.Node): void => {
    if (
      (ts.isFunctionDeclaration(node) ||
        ts.isFunctionExpression(node) ||
        ts.isArrowFunction(node) ||
        ts.isMethodDeclaration(node)) &&
      node.body
    ) {
      const start = node.getStart(sourceFile);
      const end = node.end;
      if (position >= start && position <= end) {
        if (!best || start >= best.getStart(sourceFile)) {
          best = node;
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return best;
}

function functionName(fn: ts.FunctionLikeDeclaration): string | undefined {
  if (fn.name && ts.isIdentifier(fn.name)) return fn.name.text;
  const parent = fn.parent;
  if (
    ts.isVariableDeclaration(parent) &&
    ts.isIdentifier(parent.name)
  ) {
    return parent.name.text;
  }
  return undefined;
}

function findInitializer(
  host: EvaluatorHost,
  absFile: string,
  name: string,
  position: number,
  sourceFile: ts.SourceFile,
):
  | {
      filePath: string;
      sourceFile: ts.SourceFile;
      initializer: ts.Expression;
      nameNode: ts.Identifier;
    }
  | undefined {
  let best:
    | {
        filePath: string;
        sourceFile: ts.SourceFile;
        initializer: ts.Expression;
        nameNode: ts.Identifier;
        declPos: number;
      }
    | undefined;

  const consider = (sf: ts.SourceFile, file: string): void => {
    const visit = (node: ts.Node): void => {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
        if (
          node.name.text === name &&
          node.initializer &&
          node.name.getStart(sf) <= position
        ) {
          const declPos = node.name.getStart(sf);
          if (!best || declPos >= best.declPos) {
            best = {
              filePath: file,
              sourceFile: sf,
              initializer: node.initializer,
              nameNode: node.name,
              declPos,
            };
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  };

  consider(sourceFile, absFile);

  if (!best) {
    // Cross-file via import resolver
    const sym = host.importResolver.resolveSymbol({
      graph: host.moduleGraph,
      filePath: absFile,
      identifier: name,
      position,
    });
    if (!sym.unresolved && !sym.circular) {
      const declSf = host.parseFile(sym.resolvedSourceFile);
      if (declSf) {
        const localName = sym.localName ?? sym.exportedSymbol;
        best = undefined;
        const visit = (node: ts.Node): void => {
          if (
            ts.isVariableDeclaration(node) &&
            ts.isIdentifier(node.name) &&
            node.name.text === localName &&
            node.initializer
          ) {
            best = {
              filePath: sym.resolvedSourceFile,
              sourceFile: declSf,
              initializer: node.initializer,
              nameNode: node.name,
              declPos: node.name.getStart(declSf),
            };
          }
          ts.forEachChild(node, visit);
        };
        visit(declSf);
      }
    }
  }

  if (!best) return undefined;
  return {
    filePath: best.filePath,
    sourceFile: best.sourceFile,
    initializer: best.initializer,
    nameNode: best.nameNode,
  };
}

/**
 * Extract static string props. Returns `undefined` when the object is not
 * safely enumerable (spread / computed / oversized).
 */
function staticObjectStringProps(
  obj: ts.ObjectLiteralExpression,
  maxValues: number,
): Map<string, string> | undefined {
  const map = new Map<string, string>();
  let count = 0;
  for (const p of obj.properties) {
    if (ts.isSpreadAssignment(p)) return undefined;
    if (ts.isShorthandPropertyAssignment(p)) return undefined;
    if (!ts.isPropertyAssignment(p)) continue;
    if (ts.isComputedPropertyName(p.name)) return undefined;
    const name =
      ts.isIdentifier(p.name) ||
      ts.isStringLiteral(p.name) ||
      ts.isNumericLiteral(p.name)
        ? p.name.text
        : undefined;
    if (name === undefined) return undefined;
    const init = unwrap(p.initializer);
    if (
      !(ts.isStringLiteral(init) || ts.isNoSubstitutionTemplateLiteral(init))
    ) {
      return undefined;
    }
    map.set(name, init.text);
    count++;
    if (count > maxValues * 2) {
      // Huge object: still return capped map for [*] widen, caller marks incomplete
      break;
    }
  }
  return map;
}

/**
 * Extract static string array elements. `undefined` ⇒ unsafe / non-static.
 */
function staticArrayStringElements(
  arr: ts.ArrayLiteralExpression,
  maxValues: number,
): string[] | undefined {
  const out: string[] = [];
  for (const el of arr.elements) {
    if (ts.isOmittedExpression(el) || ts.isSpreadElement(el)) return undefined;
    const u = unwrap(el);
    if (ts.isStringLiteral(u) || ts.isNoSubstitutionTemplateLiteral(u)) {
      out.push(u.text);
      if (out.length > maxValues * 2) break;
    } else {
      return undefined;
    }
  }
  return out;
}

function staticBoolean(
  host: EvaluatorHost,
  absFile: string,
  condition: ts.Expression,
  sourceFile: ts.SourceFile,
  context: EvaluationContext,
): boolean | undefined {
  if (context.depth + 1 >= host.maxDepth) return undefined;
  const expr = unwrap(condition);
  if (expr.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (expr.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (
    ts.isPrefixUnaryExpression(expr) &&
    expr.operator === ts.SyntaxKind.ExclamationToken
  ) {
    const inner = staticBoolean(
      host,
      absFile,
      expr.operand,
      sourceFile,
      { ...context, depth: context.depth + 1 },
    );
    return inner === undefined ? undefined : !inner;
  }
  // const flag = true;
  if (ts.isIdentifier(expr)) {
    const init = findInitializer(
      host,
      absFile,
      expr.text,
      safeStart(expr, sourceFile),
      sourceFile,
    );
    if (init) {
      return staticBoolean(
        host,
        init.filePath,
        init.initializer,
        init.sourceFile,
        { ...context, depth: context.depth + 1 },
      );
    }
  }
  return undefined;
}

function toSet(analysis: DynamicKeyAnalysis): PossibleValueSet {
  return fromValues(analysis.possibleKeys, {
    incomplete: analysis.incomplete || !analysis.resolved,
    confidence: analysis.confidence,
    circular: analysis.circular,
  });
}

function unresolved(
  loc: SourceLocation,
  chain: readonly ResolutionStep[],
  incomplete = true,
): DynamicKeyAnalysis {
  return toAnalysis(emptySet(incomplete), [loc], chain, "unresolved");
}

function uniqueLocs(locs: readonly SourceLocation[]): SourceLocation[] {
  const seen = new Set<string>();
  const out: SourceLocation[] = [];
  for (const l of locs) {
    const k = `${l.start}:${l.end}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(l);
  }
  return out;
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

function safeStart(node: ts.Node, sourceFile: ts.SourceFile): number {
  try {
    return node.getStart(sourceFile);
  } catch {
    return sourceFile.end;
  }
}
